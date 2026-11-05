import { z } from "zod";

export type PurchaseDraft = {
  unitId: string;
  supplierId: string;
  items: { productId: string; quantity: string }[];
  source: "replenishment";
};
export type DraftSourceRow = {
  productId: string;
  supplierId: string | null;
  supplierActive?: boolean;
  suggested: string;
};
export function hasSuggestedQuantity(value: string) {
  return /^\d{1,15}(?:\.\d{1,3})?$/.test(value) && /[1-9]/.test(value);
}

/** A local, editable prefill only. The purchase service authorizes and validates again on save. */
export function buildPurchaseDraft(
  unitId: string,
  rows: DraftSourceRow[],
  selectedIds: string[],
): PurchaseDraft {
  if (!z.string().uuid().safeParse(unitId).success)
    throw new Error("Atualize a página e selecione uma unidade autorizada.");
  const ids = [...new Set(selectedIds)];
  if (!ids.length)
    throw new Error("Selecione ao menos um material com sugestão de compra.");
  if (ids.length > 200)
    throw new Error("Prepare no máximo 200 materiais por pedido.");
  const lookup = new Map(rows.map((row) => [row.productId, row]));
  const selected = ids.map((id) => lookup.get(id));
  if (selected.some((row) => !row || !hasSuggestedQuantity(row.suggested)))
    throw new Error(
      "Uma sugestão mudou ou não está disponível. Atualize a lista de reposição.",
    );
  const valid = selected as DraftSourceRow[];
  const supplierId = valid[0].supplierId;
  if (
    !supplierId ||
    !z.string().uuid().safeParse(supplierId).success ||
    valid.some((row) => !row.supplierId || row.supplierActive === false)
  )
    throw new Error(
      "Cadastre um fornecedor ativo para todos os materiais selecionados.",
    );
  if (valid.some((row) => row.supplierId !== supplierId))
    throw new Error(
      "Selecione materiais de um mesmo fornecedor. Use o filtro para separar os pedidos.",
    );
  if (valid.some((row) => !z.string().uuid().safeParse(row.productId).success))
    throw new Error(
      "A identificação de um material é inválida. Atualize a lista.",
    );
  return {
    unitId,
    supplierId,
    source: "replenishment",
    items: valid.map((row) => ({
      productId: row.productId,
      quantity: row.suggested,
    })),
  };
}
