import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const tables = ["Category", "Supplier", "Product", "Warehouse", "Location", "InventoryBalance", "StockMovement", "InventoryCount", "InventoryCountItem", "ImageAsset", "AppSettings", "IdempotencyRecord", "AuditLog"];
const references = {
  Product: [["categoryId", "Category"], ["supplierId", "Supplier"]],
  Location: [["warehouseId", "Warehouse"], ["parentId", "Location"]],
  InventoryBalance: [["productId", "Product"], ["locationId", "Location"]],
  StockMovement: [["productId", "Product"], ["sourceId", "Location"], ["destinationId", "Location"], ["inventoryCountId", "InventoryCount"]],
  InventoryCount: [["locationId", "Location"]],
  InventoryCountItem: [["countId", "InventoryCount"], ["productId", "Product"]],
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const args = process.argv.slice(2);
const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const generate = value("--generate");
const planPath = value("--plan");
const apply = args.includes("--apply");
const url = process.env.MIGRATION_DATABASE_URL;
if (!url || (!generate && !planPath) || (generate && (planPath || apply))) {
  console.error("Defina MIGRATION_DATABASE_URL e use --generate plano.json ou --plan plano.json [--apply]. Sem --apply, apenas valida o plano.");
  process.exit(1);
}
const db = new PrismaClient({ datasources: { db: { url } } });
const keyFor = (table) => table === "IdempotencyRecord" ? "key" : "id";
class MappingError extends Error {}
try {
  if (generate) {
    const assignments = {};
    for (const table of tables) {
      const rows = await db.$queryRawUnsafe(`SELECT "${keyFor(table)}" AS id FROM "${table}" WHERE "unitId" IS NULL ORDER BY "${keyFor(table)}"`);
      assignments[table] = Object.fromEntries(rows.map((row) => [row.id, ""]));
    }
    const units = await db.operationalUnit.findMany({ where: { active: true, organization: { active: true } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
    await writeFile(resolve(generate), JSON.stringify({ format: "almox-unit-mapping-v1", changeReference: "", unitsForReview: units, assignments }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log("Plano gerado sem atribuições automáticas. Revise cada registro, preencha os UUIDs das unidades e registre a aprovação fora do sistema.");
  } else {
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    if (plan.format !== "almox-unit-mapping-v1" || !plan.assignments || typeof plan.assignments !== "object" || Array.isArray(plan.assignments)) throw new MappingError("Formato de plano inválido.");
    if (typeof plan.changeReference !== "string" || plan.changeReference.trim().length < 3 || plan.changeReference.length > 200) throw new MappingError("Informe uma referência real de aprovação da mudança no plano.");
    const assignments = [];
    for (const [table, records] of Object.entries(plan.assignments)) {
      if (!tables.includes(table) || !records || typeof records !== "object" || Array.isArray(records)) throw new MappingError("O plano contém uma tabela ou estrutura não permitida.");
      for (const [id, unitId] of Object.entries(records)) {
        if (typeof unitId !== "string" || !uuid.test(unitId) || id.length > 128 || !id.length) throw new MappingError("Todas as atribuições devem conter o identificador original e um UUID de unidade revisado. Remova do plano registros que ainda não foram aprovados.");
        if (!["AppSettings", "IdempotencyRecord"].includes(table) && !uuid.test(id)) throw new MappingError("Identificador de registro inválido.");
        assignments.push({ table, id, unitId });
      }
    }
    if (!assignments.length) throw new MappingError("O plano não contém atribuições.");
    const targetUnits = [...new Set(assignments.map((row) => row.unitId))];
    const actorId = process.env.MIGRATION_APPROVER_USER_ID;
    if (apply && (process.env.MIGRATION_APPLY_APPROVED !== "true" || !actorId || !uuid.test(actorId))) throw new MappingError("Aplicação exige MIGRATION_APPLY_APPROVED=true e MIGRATION_APPROVER_USER_ID de um administrador autorizado nas unidades do plano.");
    const result = await db.$transaction(async (tx) => {
      if (!apply) await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      else await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(728546211)::text");
      const units = await tx.operationalUnit.findMany({ where: { id: { in: targetUnits }, active: true, organization: { active: true } } });
      if (units.length !== targetUnits.length) throw new MappingError("Uma unidade do plano está ausente ou inativa.");
      if (apply) {
        const actor = await tx.user.findFirst({ where: { id: actorId, active: true, authUserId: { not: null } } });
        const memberships = await tx.unitMembership.findMany({ where: { userId: actorId, unitId: { in: targetUnits }, active: true, role: { permissions: { some: { permission: { key: "settings:manage" } } } } } });
        if (!actor || memberships.length !== targetUnits.length) throw new MappingError("O responsável precisa estar vinculado ao Supabase Auth e autorizado a administrar todas as unidades selecionadas.");
      }
      const scoped = new Map(assignments.map((row) => [`${row.table}:${row.id}`, row.unitId]));
      const cache = new Map();
      async function read(table, id) {
        const cacheKey = `${table}:${id}`;
        if (!cache.has(cacheKey)) {
          const fields = [keyFor(table), "unitId", ...(references[table] ?? []).map(([field]) => field), ...(table === "AuditLog" ? ["entity", "entityId"] : [])];
          const rows = await tx.$queryRawUnsafe(`SELECT ${fields.map((field) => `"${field}"`).join(",")} FROM "${table}" WHERE "${keyFor(table)}" = $1${["AppSettings", "IdempotencyRecord"].includes(table) ? "" : "::uuid"}`, id);
          cache.set(cacheKey, rows[0] ?? null);
        }
        return cache.get(cacheKey);
      }
      const counts = Object.fromEntries(targetUnits.map((id) => [id, {}]));
      let changed = 0;
      for (const assignment of assignments) {
        const row = await read(assignment.table, assignment.id);
        if (!row) throw new MappingError("O plano referencia um registro inexistente. Gere novamente o inventário de migração.");
        if (row.unitId && row.unitId !== assignment.unitId) throw new MappingError("Uma atribuição tenta transferir um registro já associado a outra unidade. Essa operação é recusada.");
        const links = [...(references[assignment.table] ?? [])];
        if (assignment.table === "AuditLog" && tables.includes(row.entity) && row.entity !== "AuditLog") links.push(["entityId", row.entity]);
        for (const [field, parentTable] of links) {
          if (!row[field]) continue;
          const parent = await read(parentTable, row[field]);
          if (!parent && assignment.table === "AuditLog") continue; // historical deletion records remain auditable
          const finalUnit = scoped.get(`${parentTable}:${row[field]}`) ?? parent?.unitId;
          if (!parent || finalUnit !== assignment.unitId) throw new MappingError("Um relacionamento ficaria sem unidade ou cruzaria unidades. Inclua no plano todos os registros relacionados e revise sua classificação.");
        }
        if (!row.unitId) {
          changed += 1;
          counts[assignment.unitId][assignment.table] = (counts[assignment.unitId][assignment.table] ?? 0) + 1;
        }
      }
      if (apply) {
        for (const assignment of assignments) {
          await tx.$executeRawUnsafe(`UPDATE "${assignment.table}" SET "unitId"=$1::uuid WHERE "${keyFor(assignment.table)}"=$2${["AppSettings", "IdempotencyRecord"].includes(assignment.table) ? "" : "::uuid"} AND "unitId" IS NULL`, assignment.unitId, assignment.id);
        }
        // Force all deferred cross-unit FKs to be checked before recording successful migration.
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
        for (const unitId of targetUnits) {
          if (!Object.keys(counts[unitId]).length) continue;
          await tx.auditLog.create({ data: {
            userId: actorId, unitId, action: "LEGACY_SCOPE_MAPPING", entity: "OperationalUnit", entityId: unitId,
            before: { scope: null }, after: { changeReference: plan.changeReference, mappedRecords: counts[unitId] },
          } });
        }
      }
      return { changed, selected: assignments.length };
    }, { isolationLevel: "Serializable", maxWait: 15_000, timeout: 600_000 });
    console.log(apply ? `Mapeamento concluído: ${result.changed} registros classificados; ${result.selected - result.changed} já estavam na unidade aprovada. Nenhum saldo ou identificador foi alterado.` : `Plano validado em transação somente leitura: ${result.changed} registros a classificar. Nenhuma alteração aplicada.`);
  }
} catch (error) {
  console.error(error instanceof MappingError ? error.message : "Operação não concluída. Revise conexão, permissões, arquivo de plano e conflitos de integridade. A transação de mapeamento é atômica; nenhum segredo foi registrado.");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
