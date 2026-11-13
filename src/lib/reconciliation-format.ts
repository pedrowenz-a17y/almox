import { z } from "zod";
import { readReconciliationCsv } from "@/lib/reconciliation-csv";

export const reconciliationContextSchema = z
  .object({
    erpName: z.string().trim().min(2).max(100),
    cutoffNote: z.string().trim().min(10).max(1000),
    basis: z.enum(["LEDGER_BALANCE", "INVOICED_MATERIALS"]),
  })
  .strict();
export const reconciliationMappingSchema = z
  .object({
    unit: z.string().trim().min(1).max(200),
    code: z.string().trim().min(1).max(200),
    location: z.string().trim().min(1).max(200).optional(),
    value: z.string().trim().min(1).max(200),
  })
  .strict();
export const reconciliationInputSchema = z
  .object({
    kind: z.enum(["STOCK", "ORDER_COST"]),
    sourceName: z.string().trim().min(3).max(160),
    referenceAt: z.iso.datetime({ offset: true }),
    delimiter: z.enum([";", ","]),
    decimalFormat: z.enum(["BR", "CANONICAL"]),
    csv: z.string().min(1).max(1_048_576),
    mapping: reconciliationMappingSchema.optional(),
    context: reconciliationContextSchema.optional(),
    recheckOf: z.string().uuid().optional(),
  })
  .strict();
export type ReconciliationInput = z.infer<typeof reconciliationInputSchema>;
export type ReconciliationMapping = z.infer<typeof reconciliationMappingSchema>;
export type ReconciliationContext = z.infer<typeof reconciliationContextSchema>;

export const REVIEW_CAUSES = {
  CUTOFF: "Lançamento em outra data",
  POSTING: "Aplicação, baixa ou devolução pendente",
  CODE: "Código ou local diferente",
  COST: "Critério de custo diferente",
  OTHER: "Outra causa",
} as const;
export const REVIEW_LABELS = {
  PENDING: "Em revisão",
  MATCHED: "Conferido",
  WITH_DIFFERENCES: "Com ressalvas",
  RETURNED: "Devolvido para análise",
  LEGACY: "Registro anterior",
} as const;
export type ReviewStatus = keyof typeof REVIEW_LABELS;
export const reviewInputSchema = z
  .object({
    decision: z.enum(["ACCEPT", "RETURN"]),
    note: z.string().trim().min(10).max(2000),
    analyses: z
      .array(
        z
          .object({
            code: z.string().min(1).max(200),
            location: z.string().max(200).nullable(),
            cause: z.enum(["CUTOFF", "POSTING", "CODE", "COST", "OTHER"]),
            note: z.string().trim().min(10).max(600),
            reference: z.string().trim().min(3).max(200),
          })
          .strict(),
      )
      .max(1000),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: z
      .string()
      .min(16)
      .max(128)
      .regex(/^[A-Za-z0-9:_-]+$/),
  })
  .strict();
export type ReconciliationReviewInput = z.infer<typeof reviewInputSchema>;
export type ReconciliationReview = {
  status: ReviewStatus;
  canReview: boolean;
  reason: string | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  note: string | null;
  analyses: ReconciliationReviewInput["analyses"];
  nextBatchId: string | null;
};

/** Mapping is explicit. Unused columns are discarded, never stored in the document. */
export function mappedReconciliationCsv(input: ReconciliationInput) {
  const rows = readReconciliationCsv(
    input.csv,
    input.delimiter,
    input.mapping ? 32 : 8,
  );
  if (!input.mapping) return rows;
  const header = rows[0] ?? [];
  if (
    !header.length ||
    header.some((h) => !h || h.length > 200) ||
    new Set(header).size !== header.length
  )
    throw new Error(
      "Use nomes diferentes e preenchidos no cabeçalho do arquivo.",
    );
  const fields =
    input.kind === "STOCK"
      ? [
          input.mapping.unit,
          input.mapping.code,
          input.mapping.location,
          input.mapping.value,
        ]
      : [input.mapping.unit, input.mapping.code, input.mapping.value];
  if (
    fields.some((field) => !field || !header.includes(field)) ||
    new Set(fields).size !== fields.length
  )
    throw new Error(
      "Associe uma coluna diferente a cada campo da conferência.",
    );
  return [
    input.kind === "STOCK"
      ? ["unidade", "produto", "local", "quantidade"]
      : ["unidade", "ordem", "custo"],
    ...rows.slice(1).map((row, index) => {
      if (row.length !== header.length)
        throw new Error(
          `Linha ${index + 2}: quantidade de colunas diferente do cabeçalho.`,
        );
      return fields.map((field) => row[header.indexOf(field!)]);
    }),
  ];
}
