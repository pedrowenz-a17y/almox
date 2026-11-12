import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAnyUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { api, AppError, json } from "@/lib/http";

export const runtime = "nodejs";
type Row = Record<string, string | number>;
type Column = { key: string; label: string };
const MAX_ROWS = 50000;
const titles = {
  position: "Posição atual de estoque",
  low: "Produtos abaixo do estoque mínimo",
  zero: "Produtos sem estoque",
  entry: "Entradas de estoque",
  exit: "Saídas de estoque",
  transfer: "Transferências entre localizações",
  adjustments: "Ajustes de inventário",
  "by-user": "Movimentações por usuário",
  "by-location": "Estoque por localização",
  counts: "Inventários",
  divergences: "Divergências de inventário",
};
const input = z.object({
  type: z
    .enum([
      "position",
      "low",
      "zero",
      "entry",
      "exit",
      "transfer",
      "adjustments",
      "by-user",
      "by-location",
      "counts",
      "divergences",
    ])
    .default("position"),
  format: z.enum(["csv", "xlsx", "json"]).default("csv"),
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
});

function dateFilter(value: string | undefined, end: boolean) {
  if (!value) return undefined;
  // Date-only filters represent full local days at the installation's Brazilian timezone.
  const isDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!isDay && !z.string().datetime({ offset: true }).safeParse(value).success)
    throw new AppError(
      "Período inválido. Informe datas no formato AAAA-MM-DD.",
    );
  const date = new Date(
    isDay ? `${value}T${end ? "23:59:59.999" : "00:00:00.000"}-03:00` : value,
  );
  if (
    Number.isNaN(date.getTime()) ||
    (isDay &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
  )
    throw new AppError("Data inválida.");
  return date;
}

function checkLimit(length: number) {
  if (length > MAX_ROWS)
    throw new AppError(
      "O relatório excede 50.000 linhas. Restrinja a localização ou o período para exportar.",
      413,
    );
}

const dateText = (date: Date) =>
  date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const column = (key: string, label: string): Column => ({ key, label });
const movementLabels = {
  ENTRY: "Entrada",
  EXIT: "Saída",
  TRANSFER: "Transferência",
  ADJUSTMENT: "Ajuste",
};

function csvCell(value: string | number) {
  let text = String(value ?? "");
  // Quoting alone does not prevent spreadsheet formula injection in user-supplied fields.
  if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export const GET = api(async (request) => {
  const user = await requireAnyUser(["reports:read", "reports:view"]);
  const params = input.parse(
    Object.fromEntries(
      [...request.nextUrl.searchParams].filter(([, value]) => value !== ""),
    ),
  );
  const from = dateFilter(params.from, false);
  const to = dateFilter(params.to, true);
  if (from && to && from > to)
    throw new AppError("A data inicial deve ser anterior à data final.");
  const createdAt =
    from || to
      ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
      : undefined;
  const showCosts = user.permissions.includes("costs:read");
  let columns: Column[] = [];
  let rows: Row[] = [];

  await prisma.$transaction(async (tx) => {
    if (params.locationId && !(await tx.location.findFirst({ where: { id: params.locationId, unitId: user.unitId }, select: { id: true } }))) {
      throw new AppError("Localização não encontrada nesta unidade.", 404);
    }
  if (["position", "low", "zero"].includes(params.type)) {
    const products = await tx.product.findMany({
      where: {
        unitId: user.unitId,
        active: true,
        ...(params.locationId
          ? { balances: { some: { locationId: params.locationId } } }
          : {}),
      },
      select: {
        id: true,
        internalCode: true,
        sku: true,
        name: true,
        unit: true,
        minStock: true,
        maxStock: true,
        ...(showCosts ? { unitCost: true } : {}),
        category: { select: { name: true } },
        supplier: { select: { legalName: true } },
        balances: {
          where: { unitId: user.unitId, ...(params.locationId ? { locationId: params.locationId } : {}) },
          select: { quantity: true },
        },
      },
      orderBy: { name: "asc" },
      take: MAX_ROWS + 1,
    });
    checkLimit(products.length);
    columns = [
      column("code", "Código"),
      column("sku", "SKU"),
      column("product", "Produto"),
      column("category", "Categoria"),
      column("supplier", "Fornecedor"),
      column("unit", "Unidade"),
      column("quantity", "Saldo registrado (antes da baixa)"),
      column("physical", "Físico no almoxarifado"),
      column("reserved", "Reservado"),
      column("applied", "Aplicado sem baixa"),
      column("available", "Disponível"),
      column("minimum", "Estoque mínimo"),
      column("maximum", "Estoque máximo"),
      column("status", "Situação"),
    ];
    if (showCosts)
      columns.push(
        column("unitCost", "Custo unitário (R$)"),
        column("totalCost", "Custo total (R$)"),
      );
    const pending = await tx.orderMaterial.groupBy({
      by: ["productId"], where: { unitId: user.unitId, ...(params.locationId ? { locationId: params.locationId } : {}) },
      _sum: { reservedQuantity: true, appliedQuantity: true },
    });
    const pendingByProduct = new Map(pending.map((row) => [row.productId, row._sum]));
    rows = products.flatMap((product) => {
      const quantity = product.balances.reduce(
        (sum, balance) => sum.plus(balance.quantity),
        new Prisma.Decimal(0),
      );
      const commitment = pendingByProduct.get(product.id);
      const reserved = commitment?.reservedQuantity ?? new Prisma.Decimal(0);
      const applied = commitment?.appliedQuantity ?? new Prisma.Decimal(0);
      const physical = quantity.minus(applied);
      const available = physical.minus(reserved);
      if (params.type === "low" && !available.lessThan(product.minStock))
        return [];
      if (params.type === "zero" && available.greaterThan(0)) return [];
      const status = available.lessThanOrEqualTo(0)
        ? "Sem disponibilidade"
        : available.lessThan(product.minStock)
          ? available.lessThanOrEqualTo(product.minStock.div(2))
            ? "Crítico"
            : "Baixo"
          : "Normal";
      const row: Row = {
        code: product.internalCode,
        sku: product.sku || "",
        product: product.name,
        category: product.category?.name || "",
        supplier: product.supplier?.legalName || "",
        unit: product.unit,
        quantity: quantity.toString(),
        physical: physical.toString(), reserved: reserved.toString(), applied: applied.toString(), available: available.toString(),
        minimum: product.minStock.toString(),
        maximum: product.maxStock?.toString() || "",
        status,
      };
      if (showCosts) {
        row.unitCost = product.unitCost == null ? "Não informado" : product.unitCost.toFixed(2);
        row.totalCost = product.unitCost == null ? "Não informado" : quantity.mul(product.unitCost).toFixed(2);
      }
      return [row];
    });
  } else if (params.type === "by-location") {
    const balances = await tx.inventoryBalance.findMany({
      where: { unitId: user.unitId, ...(params.locationId ? { locationId: params.locationId } : {}) },
      include: {
        product: {
          select: {
            internalCode: true,
            name: true,
            unit: true,
            ...(showCosts ? { unitCost: true } : {}),
          },
        },
        location: { include: { warehouse: true } },
      },
      orderBy: [{ location: { code: "asc" } }, { product: { name: "asc" } }],
      take: MAX_ROWS + 1,
    });
    checkLimit(balances.length);
    columns = [
      column("warehouse", "Almoxarifado"),
      column("locationCode", "Código da localização"),
      column("location", "Localização"),
      column("code", "Código do produto"),
      column("product", "Produto"),
      column("unit", "Unidade"),
      column("quantity", "Saldo registrado (antes da baixa)"),
      column("physical", "Físico no almoxarifado"),
      column("reserved", "Reservado"),
      column("applied", "Aplicado sem baixa"),
      column("available", "Disponível"),
    ];
    if (showCosts)
      columns.push(
        column("unitCost", "Custo unitário (R$)"),
        column("totalCost", "Custo total (R$)"),
      );
    const pending = await tx.orderMaterial.groupBy({
      by: ["productId", "locationId"], where: { unitId: user.unitId, ...(params.locationId ? { locationId: params.locationId } : {}) },
      _sum: { reservedQuantity: true, appliedQuantity: true },
    });
    const pendingByBalance = new Map(pending.map((row) => [`${row.productId}:${row.locationId}`, row._sum]));
    rows = balances.map((balance) => {
      const commitment = pendingByBalance.get(`${balance.productId}:${balance.locationId}`);
      const reserved = commitment?.reservedQuantity ?? new Prisma.Decimal(0);
      const applied = commitment?.appliedQuantity ?? new Prisma.Decimal(0);
      const row: Row = {
        warehouse: balance.location.warehouse.name,
        locationCode: balance.location.code,
        location: balance.location.name,
        code: balance.product.internalCode,
        product: balance.product.name,
        unit: balance.product.unit,
        quantity: balance.quantity.toString(),
        physical: balance.quantity.minus(applied).toString(), reserved: reserved.toString(), applied: applied.toString(), available: balance.quantity.minus(applied).minus(reserved).toString(),
      };
      if (showCosts) {
        row.unitCost = balance.product.unitCost == null ? "Não informado" : balance.product.unitCost.toFixed(2);
        row.totalCost = balance.product.unitCost == null ? "Não informado" : balance.quantity.mul(balance.product.unitCost).toFixed(2);
      }
      return row;
    });
  } else if (["counts", "divergences"].includes(params.type)) {
    const items = await tx.inventoryCountItem.findMany({
      where: {
        unitId: user.unitId,
        ...(params.type === "divergences" ? { difference: { not: 0 } } : {}),
        count: {
          unitId: user.unitId,
          createdAt,
          ...(params.userId ? { userId: params.userId } : {}),
          ...(params.locationId ? { locationId: params.locationId } : {}),
        },
      },
      include: {
        product: { select: { internalCode: true, name: true, unit: true } },
        count: {
          include: {
            user: { select: { name: true } },
            approvedBy: { select: { name: true } },
            location: { select: { name: true, code: true } },
          },
        },
      },
      orderBy: { count: { createdAt: "desc" } },
      take: MAX_ROWS + 1,
    });
    checkLimit(items.length);
    columns = [
      column("id", "Inventário"),
      column("date", "Data / hora (Brasília)"),
      column("location", "Localização"),
      column("locationCode", "Código da localização"),
      column("code", "Código do produto"),
      column("product", "Produto"),
      column("unit", "Unidade"),
      column("expected", "Saldo registrado"),
      column("counted", "Contagem física"),
      column("difference", "Diferença"),
      column("status", "Situação"),
      column("user", "Responsável"),
      column("approver", "Aprovador"),
      column("approvedAt", "Aprovado em"),
      column("note", "Observação"),
    ];
    rows = items.map((item) => ({
      id: item.count.id,
      date: dateText(item.count.createdAt),
      location: item.count.location.name,
      locationCode: item.count.location.code,
      code: item.product.internalCode,
      product: item.product.name,
      unit: item.product.unit,
      expected: item.expectedQuantity.toString(),
      counted: item.countedQuantity.toString(),
      difference: item.difference.toString(),
      status: item.count.status === "APPROVED" ? "Aprovado" : "Pendente",
      user: item.count.user.name,
      approver: item.count.approvedBy?.name || "",
      approvedAt: item.count.approvedAt ? dateText(item.count.approvedAt) : "",
      note: item.count.note,
    }));
  } else {
    const type =
      params.type === "entry"
        ? "ENTRY"
        : params.type === "exit"
          ? "EXIT"
          : params.type === "transfer"
            ? "TRANSFER"
            : params.type === "adjustments"
              ? "ADJUSTMENT"
              : undefined;
    const movements = await tx.stockMovement.findMany({
      where: {
        unitId: user.unitId,
        createdAt,
        type,
        ...(params.userId ? { userId: params.userId } : {}),
        ...(params.locationId
          ? {
              OR: [
                { sourceId: params.locationId },
                { destinationId: params.locationId },
              ],
            }
          : {}),
      },
      include: {
        product: { select: { internalCode: true, name: true, unit: true } },
        user: { select: { name: true } },
        source: { select: { name: true, code: true } },
        destination: { select: { name: true, code: true } },
      },
      orderBy:
        params.type === "by-user"
          ? [{ user: { name: "asc" } }, { createdAt: "desc" }]
          : [{ createdAt: "desc" }],
      take: MAX_ROWS + 1,
    });
    checkLimit(movements.length);
    columns = [
      column("id", "Movimentação"),
      column("date", "Data / hora (Brasília)"),
      column("type", "Tipo"),
      column("code", "Código do produto"),
      column("product", "Produto"),
      column("unit", "Unidade"),
      column("quantity", "Quantidade"),
      column("source", "Origem"),
      column("destination", "Destino"),
      column("sourceBefore", "Origem antes"),
      column("sourceAfter", "Origem depois"),
      column("destinationBefore", "Destino antes"),
      column("destinationAfter", "Destino depois"),
      column("user", "Usuário"),
      column("reference", "Documento / referência"),
      column("note", "Observação"),
    ];
    rows = movements.map((movement) => ({
      id: movement.id,
      date: dateText(movement.createdAt),
      type: movementLabels[movement.type],
      code: movement.product.internalCode,
      product: movement.product.name,
      unit: movement.product.unit,
      quantity: movement.quantity.toString(),
      source: movement.source
        ? `${movement.source.code} · ${movement.source.name}`
        : "",
      destination: movement.destination
        ? `${movement.destination.code} · ${movement.destination.name}`
        : "",
      sourceBefore: movement.sourceBefore?.toString() || "",
      sourceAfter: movement.sourceAfter?.toString() || "",
      destinationBefore: movement.destinationBefore?.toString() || "",
      destinationAfter: movement.destinationAfter?.toString() || "",
      user: movement.user.name,
      reference: movement.reference,
      note: movement.note,
    }));
  }

  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });

  const title = titles[params.type];
  const generatedAt = new Date().toISOString();
  if (params.format === "json")
    return json({ columns, rows, title, generatedAt, unitId: user.unitId });
  const filename = `almox-${params.type}-${generatedAt.slice(0, 10)}.${params.format}`;
  const headers = {
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
  if (params.format === "csv") {
    const csv =
      "\uFEFF" +
      [
        columns.map((entry) => csvCell(entry.label)).join(";"),
        ...rows.map((row) =>
          columns.map((entry) => csvCell(row[entry.key] ?? "")).join(";"),
        ),
      ].join("\r\n");
    return new Response(csv, {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
    });
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Almox ERP";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Relatório", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = columns.map((entry) => ({
    header: entry.label,
    key: entry.key,
    width: Math.max(18, Math.min(40, entry.label.length + 4)),
  }));
  // ExcelJS writes plain strings as text, never as formulas; Decimal strings retain precision.
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF147D64" },
  };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: columns.length },
  };
  sheet.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      ...headers,
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
});
