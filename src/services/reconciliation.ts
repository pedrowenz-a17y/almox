import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import { readReconciliationCsv } from "@/lib/reconciliation-csv";
import {
  CostDecimal,
  costOrderSelect,
  MATERIAL_COST_CRITERION,
  summarizeOrderCost,
} from "@/services/order-costs";
import {
  findIdempotentResource,
  idempotencyKeySchema,
  payloadHash,
  requirePermission,
  serializable,
  type StockActor,
  type StockTransaction,
} from "@/services/stock";

const inputSchema = z
  .object({
    kind: z.enum(["STOCK", "ORDER_COST"]),
    sourceName: z.string().trim().min(3).max(160),
    referenceAt: z.iso.datetime({ offset: true }),
    delimiter: z.enum([";", ","]),
    decimalFormat: z.enum(["BR", "CANONICAL"]),
    csv: z.string().min(1).max(1_048_576),
  })
  .strict();
const saveSchema = inputSchema.extend({ idempotencyKey: idempotencyKeySchema });
type ReconciliationInput = z.infer<typeof inputSchema>;
type ReconciliationRow = {
  code: string;
  location: string | null;
  externalValue: string;
  localValue: string | null;
  difference: string | null;
  status: "MATCH" | "DIFFERENCE" | "INCOMPLETE";
  reason: string | null;
};

export async function readReconciliationBody(request: Request) {
  const limit = 2_200_000;
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new AppError("Arquivo acima do limite permitido.", 413);
  if (!request.body) throw new AppError("Envie os dados da conciliação.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AppError("Arquivo acima do limite permitido.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function authorize(actor: StockActor, kind: string) {
  requirePermission(actor, "reports:read");
  if (kind === "ORDER_COST") requirePermission(actor, "costs:read");
}

function parseRows(input: ReconciliationInput, unitCode: string) {
  if (Buffer.byteLength(input.csv, "utf8") > 1_048_576)
    throw new AppError("Envie um CSV de até 1 MB.", 400);
  if (Date.parse(input.referenceAt) > Date.now() + 300_000)
    throw new AppError("A data de referência não pode estar no futuro.", 400);
  let rows: string[][];
  try {
    rows = readReconciliationCsv(input.csv, input.delimiter);
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : "CSV inválido.",
      400,
    );
  }
  const expected =
    input.kind === "STOCK"
      ? ["unidade", "produto", "local", "quantidade"]
      : ["unidade", "ordem", "custo"];
  if (!rows.length || rows[0].join("|") !== expected.join("|"))
    throw new AppError(
      `Use o cabeçalho exato: ${expected.join(input.delimiter)}.`,
      400,
    );
  if (rows.length < 2)
    throw new AppError("Inclua pelo menos uma linha de dados no arquivo.", 400);
  const unique = new Set<string>();
  return rows.slice(1).map((row, index) => {
    const label = `Linha ${index + 2}`;
    if (row.length !== expected.length)
      throw new AppError(
        `${label}: quantidade de colunas diferente do modelo.`,
        400,
      );
    if (row[0] !== unitCode)
      throw new AppError(
        `${label}: o código da unidade não corresponde à unidade selecionada.`,
        400,
      );
    const code = row[1];
    const location = input.kind === "STOCK" ? row[2] : null;
    if (
      !code ||
      code.length > 200 ||
      (location !== null && (!location || location.length > 200))
    )
      throw new AppError(
        `${label}: informe códigos válidos de produto/ordem e local.`,
        400,
      );
    const rowKey = JSON.stringify([code, location]);
    if (unique.has(rowKey))
      throw new AppError(
        `${label}: código repetido. Consolide cada produto/local ou ordem em uma única linha.`,
        400,
      );
    unique.add(rowKey);
    const places = input.kind === "STOCK" ? 3 : 2;
    const rawValue = row.at(-1)!;
    // Thousands separators are intentionally rejected to avoid ambiguous 1.234 values.
    const pattern =
      input.decimalFormat === "BR"
        ? new RegExp(`^-?\\d{1,15}(?:,\\d{1,${places}})?$`)
        : new RegExp(`^-?\\d{1,15}(?:\\.\\d{1,${places}})?$`);
    if (!pattern.test(rawValue))
      throw new AppError(
        `${label}: número inválido. Use até ${places} casas, sem separador de milhar e com decimal ${input.decimalFormat === "BR" ? "vírgula" : "ponto"}.`,
        400,
      );
    const value = new Prisma.Decimal(rawValue.replace(",", "."));
    return { code, location, value, label };
  });
}

async function compare(
  tx: StockTransaction,
  actor: StockActor,
  input: ReconciliationInput,
) {
  const unit = await tx.operationalUnit.findUnique({
    where: { id: actor.unitId },
    select: { code: true },
  });
  if (!unit) throw new AppError("Unidade não encontrada.", 404);
  const entries = parseRows(input, unit.code);
  const result: ReconciliationRow[] = [];
  if (input.kind === "STOCK") {
    const [products, locations, balances] = await Promise.all([
      tx.product.findMany({
        where: {
          unitId: actor.unitId,
          internalCode: { in: entries.map((r) => r.code) },
        },
        select: { id: true, internalCode: true },
      }),
      tx.location.findMany({
        where: {
          unitId: actor.unitId,
          code: { in: entries.map((r) => r.location!) },
        },
        select: { id: true, code: true },
      }),
      tx.inventoryBalance.findMany({
        where: {
          unitId: actor.unitId,
          product: { internalCode: { in: entries.map((r) => r.code) } },
          location: { code: { in: entries.map((r) => r.location!) } },
        },
        select: { productId: true, locationId: true, quantity: true },
      }),
    ]);
    const productMap = new Map(products.map((p) => [p.internalCode, p.id]));
    const locationMap = new Map(locations.map((l) => [l.code, l.id]));
    const balanceMap = new Map(
      balances.map((b) => [
        JSON.stringify([b.productId, b.locationId]),
        b.quantity,
      ]),
    );
    for (const entry of entries) {
      const productId = productMap.get(entry.code);
      const locationId = locationMap.get(entry.location!);
      if (!productId || !locationId)
        throw new AppError(
          `${entry.label}: produto ou local não encontrado nesta unidade. Cadastre/mapeie os códigos antes de conciliar.`,
          400,
        );
      const local =
        balanceMap.get(JSON.stringify([productId, locationId])) ??
        new Prisma.Decimal(0);
      const difference = local.minus(entry.value);
      result.push({
        code: entry.code,
        location: entry.location,
        externalValue: entry.value.toFixed(3),
        localValue: local.toFixed(3),
        difference: difference.toFixed(3),
        status: difference.eq(0) ? "MATCH" : "DIFFERENCE",
        reason: null,
      });
    }
  } else {
    const orders = await tx.workOrder.findMany({
      where: { unitId: actor.unitId, code: { in: entries.map((r) => r.code) } },
      select: costOrderSelect,
    });
    const orderMap = new Map(orders.map((o) => [o.code, o]));
    for (const entry of entries) {
      const order = orderMap.get(entry.code);
      if (!order)
        throw new AppError(
          `${entry.label}: ordem não encontrada nesta unidade. Mapeie o código antes de conciliar.`,
          400,
        );
      if (order.status !== "INVOICED")
        throw new AppError(
          `${entry.label}: concilie somente ordens com faturamento confirmado.`,
          400,
        );
      const cost = summarizeOrderCost(order);
      const local = cost.netMaterialCost;
      const difference =
        local === null
          ? null
          : new CostDecimal(local).minus(entry.value.toString());
      result.push({
        code: entry.code,
        location: null,
        externalValue: entry.value.toFixed(2),
        localValue: local,
        difference: difference?.toFixed(2) ?? null,
        status:
          local === null
            ? "INCOMPLETE"
            : difference!.eq(0)
              ? "MATCH"
              : "DIFFERENCE",
        reason:
          local === null
            ? "Custo histórico ausente em um ou mais materiais. Não foi substituído por zero ou pelo preço atual."
            : null,
      });
    }
  }
  return {
    kind: input.kind,
    unitCode: unit.code,
    sourceName: input.sourceName,
    referenceAt: input.referenceAt,
    comparedAt: new Date().toISOString(),
    scope:
      "Somente as linhas informadas no arquivo; itens ausentes não foram conciliados.",
    criterion:
      input.kind === "STOCK"
        ? "Saldo contábil atual do Almox menos saldo exportado do ERP. Reservas e aplicações abertas não são novas baixas."
        : MATERIAL_COST_CRITERION,
    notice:
      "Comparação com o estado atual do Almox, não uma reconstrução histórica da data do arquivo. O ERP oficial e os critérios finais dependem de validação da empresa. Nenhum ajuste foi realizado.",
    totals: {
      rows: result.length,
      matches: result.filter((r) => r.status === "MATCH").length,
      differences: result.filter((r) => r.status === "DIFFERENCE").length,
      incomplete: result.filter((r) => r.status === "INCOMPLETE").length,
    },
    rows: result,
  };
}

export async function previewReconciliation(
  actor: StockActor,
  rawInput: unknown,
) {
  const input = inputSchema.parse(rawInput);
  authorize(actor, input.kind);
  return prisma.$transaction((tx) => compare(tx, actor, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 15_000,
  });
}

export async function saveReconciliation(actor: StockActor, rawInput: unknown) {
  const { idempotencyKey, ...input } = saveSchema.parse(rawInput);
  authorize(actor, input.kind);
  const hash = payloadHash(actor, "reconciliation:create", input);
  return serializable(async (tx) => {
    const previous = await findIdempotentResource(
      tx,
      actor,
      idempotencyKey,
      hash,
      "reconciliation",
    );
    if (previous)
      return tx.reconciliationBatch.findFirstOrThrow({
        where: { id: previous, unitId: actor.unitId },
      });
    // Recompute inside the same transaction as the saved document, never trust a client preview.
    const result = await compare(tx, actor, input);
    const batch = await tx.reconciliationBatch.create({
      data: {
        unitId: actor.unitId,
        sourceName: input.sourceName,
        referenceAt: new Date(input.referenceAt),
        kind: input.kind,
        createdById: actor.id,
        result: result as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: {
        unitId: actor.unitId,
        userId: actor.id,
        action: "RECONCILIATION_CREATED",
        entity: "ReconciliationBatch",
        entityId: batch.id,
        after: {
          kind: input.kind,
          sourceName: input.sourceName,
          totals: result.totals,
        },
      },
    });
    await tx.idempotencyRecord.create({
      data: {
        key: idempotencyKey,
        unitId: actor.unitId,
        actorId: actor.id,
        payloadHash: hash,
        resourceType: "reconciliation",
        resourceId: batch.id,
      },
    });
    return batch;
  });
}

export async function listReconciliations(actor: StockActor) {
  requirePermission(actor, "reports:read");
  const costs = actor.permissions.includes("costs:read");
  return prisma.reconciliationBatch.findMany({
    where: { unitId: actor.unitId, ...(costs ? {} : { kind: "STOCK" }) },
    select: {
      id: true,
      kind: true,
      sourceName: true,
      referenceAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getReconciliation(actor: StockActor, rawId: string) {
  requirePermission(actor, "reports:read");
  const id = z.string().uuid().parse(rawId);
  const batch = await prisma.reconciliationBatch.findFirst({
    where: {
      id,
      unitId: actor.unitId,
      ...(actor.permissions.includes("costs:read") ? {} : { kind: "STOCK" }),
    },
  });
  if (!batch)
    throw new AppError(
      "Conciliação não encontrada nesta unidade ou sem acesso ao tipo de relatório.",
      404,
    );
  return batch;
}

export async function reconciliationSetup(actor: StockActor) {
  requirePermission(actor, "reports:read");
  const unit = await prisma.operationalUnit.findUnique({
    where: { id: actor.unitId },
    select: { code: true, name: true },
  });
  if (!unit) throw new AppError("Unidade não encontrada.", 404);
  return { unitCode: unit.code, unitName: unit.name };
}
