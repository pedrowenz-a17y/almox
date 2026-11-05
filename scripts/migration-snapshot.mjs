import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// This command is read-only and never falls back to the application's DATABASE_URL.
const url = process.env.MIGRATION_DATABASE_URL;
const output = process.argv[process.argv.indexOf("--output") + 1];
if (!url || !process.argv.includes("--output") || !output) {
  console.error("Defina MIGRATION_DATABASE_URL em ambiente protegido e use --output /caminho/snapshot.json.");
  process.exit(1);
}
const db = new PrismaClient({ datasources: { db: { url } } });
const tables = ["Category", "Supplier", "Product", "Warehouse", "Location", "InventoryBalance", "StockMovement", "InventoryCount", "InventoryCountItem", "AuditLog", "ImageAsset", "User", "Role", "Permission", "RolePermission", "AppSettings", "IdempotencyRecord"];
const excludedColumns = ["passwordHash", "tokenHash", "authUserId", "unitId", "expectedAppliedQuantity", "workOrderId", "orderMaterialId", "receiptItemId", "returnOfId"];
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

try {
  const snapshot = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
    const [identity] = await tx.$queryRawUnsafe("SELECT current_database() AS database, current_timestamp AS captured_at");
    const result = { format: "almox-migration-snapshot-v1", capturedAt: identity.captured_at, database: identity.database, tables: {}, balances: [], omissions: ["Legacy session/token material and password hashes are intentionally excluded.", "New unit and identity links are excluded from legacy-row fingerprints."] };
    for (const table of tables) {
      const columns = await tx.$queryRawUnsafe("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", table);
      if (!columns.length) { result.tables[table] = { missing: true }; continue; }
      const names = columns.map((column) => column.column_name).filter((name) => !excludedColumns.includes(name));
      const selection = names.map((name) => name === "data" ? `md5(${quote(name)}) AS "dataFingerprint"` : quote(name)).join(",");
      const order = names.includes("id") ? '"id"' : names.includes("key") ? '"key"' : names.map(quote).join(",");
      await tx.$executeRawUnsafe(`DECLARE migration_rows NO SCROLL CURSOR FOR SELECT to_jsonb(record)::text AS payload FROM (SELECT ${selection} FROM public.${quote(table)} ORDER BY ${order}) AS record`);
      const hash = createHash("sha256");
      let count = 0;
      for (;;) {
        const rows = await tx.$queryRawUnsafe("FETCH 100 FROM migration_rows");
        if (!rows.length) break;
        for (const row of rows) { hash.update(row.payload).update("\n"); count += 1; }
      }
      await tx.$executeRawUnsafe("CLOSE migration_rows");
      result.tables[table] = { count, sha256: hash.digest("hex"), columns: names };
    }
    if (!result.tables.InventoryBalance?.missing) {
      result.balances = await tx.$queryRawUnsafe('SELECT "productId", "locationId", "quantity"::text AS quantity FROM "InventoryBalance" ORDER BY "productId", "locationId"');
    }
    return result;
  }, { isolationLevel: "RepeatableRead", timeout: 600_000, maxWait: 15_000 });
  await writeFile(resolve(output), JSON.stringify(snapshot, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(`Snapshot somente leitura salvo em ${resolve(output)}. Proteja o arquivo: contém identificadores e saldos empresariais.`);
} catch {
  console.error("Snapshot não concluído. Verifique a conexão de migração, as permissões de leitura e se o arquivo de destino já existe. Nenhum segredo foi registrado.");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
