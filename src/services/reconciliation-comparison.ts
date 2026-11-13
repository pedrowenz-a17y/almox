import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/http";
import {
  mappedReconciliationCsv,
  type ReconciliationInput,
} from "@/lib/reconciliation-format";
import {
  CostDecimal,
  costOrderSelect,
  MATERIAL_COST_CRITERION,
  summarizeOrderCost,
} from "@/services/order-costs";
import type { StockActor, StockTransaction } from "@/services/stock";

type ReconciliationRow = {
  code: string;
  location: string | null;
  externalValue: string;
  localValue: string | null;
  difference: string | null;
  status: "MATCH" | "DIFFERENCE" | "INCOMPLETE";
  reason: string | null;
};

function parseRows(input: ReconciliationInput, unitCode: string) {
  if (Buffer.byteLength(input.csv, "utf8") > 1_048_576)
    throw new AppError("Envie um CSV de até 1 MB.", 400);
  if (Date.parse(input.referenceAt) > Date.now() + 300_000)
    throw new AppError("A data de referência não pode estar no futuro.", 400);
  let rows: string[][];
  try {
    rows = mappedReconciliationCsv(input);
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

export async function compareReconciliation(
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
  if (
    input.context &&
    input.context.basis !==
      (input.kind === "STOCK" ? "LEDGER_BALANCE" : "INVOICED_MATERIALS")
  )
    throw new AppError(
      "O critério selecionado não corresponde ao tipo de conferência.",
      400,
    );
  if (input.recheckOf && !input.context)
    throw new AppError(
      "Informe a origem e os critérios para fazer uma nova conferência.",
      400,
    );
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
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        kind: input.kind,
        unitId: actor.unitId,
        referenceAt: new Date(input.referenceAt).toISOString(),
        rows: result
          .map((row) => [row.code, row.location, row.externalValue])
          .map((row) => JSON.stringify(row))
          .sort(),
      }),
    )
    .digest("hex");
  let revision = 1;
  if (input.recheckOf) {
    const parent = await tx.reconciliationBatch.findFirst({
      where: { id: input.recheckOf, unitId: actor.unitId, kind: input.kind },
    });
    const source = (
      parent?.result as
        | { source?: { fingerprint?: string; revision?: number } }
        | undefined
    )?.source;
    if (!parent || source?.fingerprint !== fingerprint)
      throw new AppError(
        "O documento anterior não corresponde a este arquivo e referência. Abra a conferência novamente.",
        409,
      );
    revision = (source.revision ?? 1) + 1;
  }
  return {
    schemaVersion: 2 as const,
    kind: input.kind,
    unitCode: unit.code,
    sourceName: input.sourceName,
    referenceAt: input.referenceAt,
    comparedAt: new Date().toISOString(),
    snapshotHash: reconciliationSnapshotHash(result),
    source: input.context
      ? {
          ...input.context,
          fingerprint,
          revision,
          previousBatchId: input.recheckOf ?? null,
          mapping: input.mapping ?? null,
        }
      : null,
    scope:
      "Somente as linhas informadas no arquivo; itens ausentes não foram conciliados.",
    criterion:
      input.kind === "STOCK"
        ? "Saldo contábil atual do Almox menos saldo exportado do ERP. Reservas e aplicações abertas não são novas baixas."
        : MATERIAL_COST_CRITERION,
    notice:
      "O arquivo é comparado com o saldo atual do Almox. A data do ERP não reconstrói saldos antigos. A conferência não altera estoque nem envia lançamentos ao ERP.",
    totals: {
      rows: result.length,
      matches: result.filter((r) => r.status === "MATCH").length,
      differences: result.filter((r) => r.status === "DIFFERENCE").length,
      incomplete: result.filter((r) => r.status === "INCOMPLETE").length,
    },
    rows: result,
  };
}

export function reconciliationSnapshotHash(rows: unknown) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
