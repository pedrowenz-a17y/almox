import { Prisma, type ReconciliationBatch } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import { canSaveReconciliation, canViewReports } from "@/lib/access-profiles";
import {
  reviewInputSchema,
  type ReconciliationReview,
  type ReviewStatus,
} from "@/lib/reconciliation-format";
import {
  compareReconciliation,
  reconciliationSnapshotHash,
} from "@/services/reconciliation-comparison";
import {
  findIdempotentResource,
  payloadHash,
  requireAnyPermission,
  serializable,
  type StockActor,
  type StockTransaction,
} from "@/services/stock";

type Comparison = Awaited<ReturnType<typeof compareReconciliation>>;
const REVIEW_ACTION = "RECONCILIATION_REVIEWED";

export async function assertReconciliationWriter(
  tx: StockTransaction,
  actor: StockActor,
  kind: string,
) {
  requireAnyPermission(actor, ["reports:read", "reconciliation:write"]);
  const membership = await tx.unitMembership.findUnique({
    where: { userId_unitId: { userId: actor.id, unitId: actor.unitId } },
    include: {
      user: true,
      unit: { include: { organization: true } },
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });
  const permissions =
    membership?.role.permissions.map((link) => link.permission.key) ?? [];
  if (
    !membership?.active ||
    !membership.user.active ||
    !membership.unit.active ||
    !membership.unit.organization.active ||
    !canSaveReconciliation(permissions) ||
    !canViewReports(permissions) ||
    (kind === "ORDER_COST" && !permissions.includes("costs:read"))
  )
    throw new AppError(
      "Seu acesso à conciliação nesta unidade foi alterado. Entre novamente.",
      403,
    );
}

/** Immutable comparison + separate, append-only review receipt. No extra database tables. */
export async function reconciliationDocuments(
  tx: StockTransaction,
  actor: StockActor,
  batches: ReconciliationBatch[],
  includeReceipt = true,
) {
  if (!batches.length) return [];
  const ids = batches.map((batch) => batch.id);
  const [reviews, creators, successors] = await Promise.all([
    includeReceipt
      ? tx.auditLog.findMany({
          where: {
            unitId: actor.unitId,
            entity: "ReconciliationBatch",
            entityId: { in: ids },
            action: REVIEW_ACTION,
          },
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        })
      : tx.$queryRaw<
          Array<{
            entityId: string;
            createdAt: Date;
            after: Prisma.JsonValue;
            user: null;
          }>
        >(Prisma.sql`
        SELECT "entityId", "createdAt", jsonb_build_object('status', "after"->'status') AS "after", NULL AS "user"
        FROM "AuditLog" WHERE "unitId" = ${actor.unitId}::uuid AND entity = 'ReconciliationBatch'
          AND action = ${REVIEW_ACTION} AND "entityId" IN (${Prisma.join(ids)}) ORDER BY "createdAt" DESC`),
    tx.user.findMany({
      where: {
        id: { in: [...new Set(batches.map((batch) => batch.createdById))] },
      },
      select: { id: true, name: true },
    }),
    tx.$queryRaw<Array<{ id: string; previousBatchId: string }>>(Prisma.sql`
      SELECT id, result #>> '{source,previousBatchId}' AS "previousBatchId" FROM "ReconciliationBatch"
      WHERE "unitId" = ${actor.unitId}::uuid AND result #>> '{source,previousBatchId}' IN (${Prisma.join(ids)})`),
  ]);
  const creatorMap = new Map(
    creators.map((creator) => [creator.id, creator.name]),
  );
  const nextMap = new Map(
    successors.map((next) => [next.previousBatchId, next.id]),
  );
  const reviewMap = new Map<string, (typeof reviews)[number]>();
  for (const log of reviews)
    if (!reviewMap.has(log.entityId)) reviewMap.set(log.entityId, log);
  return batches.map((batch) => {
    const reviewLog = reviewMap.get(batch.id),
      nextBatchId = nextMap.get(batch.id) ?? null;
    const result = batch.result as unknown as Comparison;
    const receipt = reviewLog?.after as {
      status: ReviewStatus;
      note: string;
      analyses: ReconciliationReview["analyses"];
    } | null;
    const status =
      receipt?.status ??
      (result.schemaVersion === 2 && result.source ? "PENDING" : "LEGACY");
    const reason = nextBatchId
      ? "Há uma conferência mais recente deste arquivo. Abra a revisão seguinte."
      : status === "LEGACY"
        ? "Este registro é anterior ao acompanhamento. Importe o arquivo com a origem e os critérios."
        : status !== "PENDING"
          ? "A revisão deste documento já foi registrada."
          : batch.createdById === actor.id
            ? "Outra pessoa autorizada precisa concluir a conferência que você registrou."
            : !canSaveReconciliation(actor.permissions)
              ? "Seu perfil permite consultar esta conferência."
              : null;
    const review: ReconciliationReview = {
      status,
      canReview: !reason,
      reason,
      note: receipt?.note ?? null,
      analyses: receipt?.analyses ?? [],
      reviewerName: reviewLog?.user?.name ?? null,
      reviewedAt: reviewLog?.createdAt.toISOString() ?? null,
      nextBatchId,
    };
    return {
      ...batch,
      createdBy: {
        name: creatorMap.get(batch.createdById) ?? "Responsável pelo registro",
      },
      review,
    };
  });
}
export async function reconciliationDocument(
  tx: StockTransaction,
  actor: StockActor,
  batch: ReconciliationBatch,
) {
  return (await reconciliationDocuments(tx, actor, [batch]))[0];
}

/** Used to reconsult current Almox values without changing the external file or old document. */
export function reconciliationRecheckInput(batch: ReconciliationBatch) {
  const result = batch.result as unknown as Comparison;
  if (result.schemaVersion !== 2 || !result.source)
    throw new AppError(
      "Importe o arquivo novamente e informe a origem e os critérios.",
      400,
    );
  const { erpName, cutoffNote, basis } = result.source;
  return {
    kind: result.kind,
    sourceName: batch.sourceName,
    referenceAt: batch.referenceAt.toISOString(),
    delimiter: ";" as const,
    decimalFormat: "CANONICAL" as const,
    context: { erpName, cutoffNote, basis },
    recheckOf: batch.id,
    csv: [
      result.kind === "STOCK"
        ? ["unidade", "produto", "local", "quantidade"]
        : ["unidade", "ordem", "custo"],
      ...result.rows.map((row) =>
        result.kind === "STOCK"
          ? [result.unitCode, row.code, row.location!, row.externalValue]
          : [result.unitCode, row.code, row.externalValue],
      ),
    ]
      .map((row) =>
        row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(";"),
      )
      .join("\n"),
  };
}

export async function reviewReconciliation(
  actor: StockActor,
  rawId: string,
  rawInput: unknown,
) {
  requireAnyPermission(actor, ["reports:read", "reconciliation:write"]);
  const id = zId(rawId);
  const input = reviewInputSchema.parse(rawInput);
  const hash = payloadHash(actor, "reconciliation:review", {
    id,
    ...input,
    idempotencyKey: undefined,
  });
  return serializable(async (tx) => {
    const batch = await tx.reconciliationBatch.findFirst({
      where: {
        id,
        unitId: actor.unitId,
        ...(actor.permissions.includes("costs:read") ? {} : { kind: "STOCK" }),
      },
    });
    if (!batch)
      throw new AppError("Conferência não encontrada nesta unidade.", 404);
    await assertReconciliationWriter(tx, actor, batch.kind);
    const previous = await findIdempotentResource(
      tx,
      actor,
      input.idempotencyKey,
      hash,
      "reconciliation-review",
    );
    if (previous) return reconciliationDocument(tx, actor, batch);
    const lock = `reconciliation-review:${actor.unitId}:${id}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
    const document = await reconciliationDocument(tx, actor, batch);
    if (!document.review.canReview)
      throw new AppError(
        document.review.reason!,
        batch.createdById === actor.id ? 403 : 409,
        "RECONCILIATION_REVIEW_BLOCKED",
      );
    const result = batch.result as unknown as Comparison;
    if (result.snapshotHash !== input.snapshotHash)
      throw new AppError(
        "O documento aberto não corresponde à revisão enviada. Atualize a tela.",
        409,
      );
    let status: ReviewStatus = "RETURNED";
    if (input.decision === "ACCEPT") {
      if (result.rows.some((row) => row.status === "INCOMPLETE"))
        throw new AppError(
          "Há custos históricos ausentes. Devolva para análise antes de concluir.",
          409,
          "RECONCILIATION_INCOMPLETE",
        );
      const differences = result.rows.filter(
        (row) => row.status === "DIFFERENCE",
      );
      const keyed = (row: { code: string; location: string | null }) =>
        JSON.stringify([row.code, row.location]);
      if (
        new Set(input.analyses.map(keyed)).size !== input.analyses.length ||
        input.analyses.length !== differences.length ||
        differences.some(
          (row) =>
            !input.analyses.some((analysis) => keyed(analysis) === keyed(row)),
        )
      )
        throw new AppError(
          "Registre a causa, a análise e a referência de cada diferença.",
          400,
        );
      const current = await compareReconciliation(
        tx,
        actor,
        reconciliationRecheckInput(batch),
      );
      if (reconciliationSnapshotHash(current.rows) !== result.snapshotHash)
        throw new AppError(
          "Os valores do Almox mudaram depois deste documento. Use Nova conferência para consultar os valores atuais.",
          409,
          "RECONCILIATION_CHANGED",
        );
      status = differences.length ? "WITH_DIFFERENCES" : "MATCHED";
    } else if (input.analyses.length) {
      throw new AppError(
        "Para devolver a conferência, informe a orientação no parecer geral.",
        400,
      );
    }
    await tx.auditLog.create({
      data: {
        unitId: actor.unitId,
        userId: actor.id,
        action: REVIEW_ACTION,
        entity: "ReconciliationBatch",
        entityId: id,
        after: {
          schemaVersion: 1,
          kind: batch.kind,
          status,
          snapshotHash: result.snapshotHash,
          note: input.note,
          analyses: input.analyses,
        } as Prisma.InputJsonValue,
      },
    });
    await tx.idempotencyRecord.create({
      data: {
        key: input.idempotencyKey,
        unitId: actor.unitId,
        actorId: actor.id,
        payloadHash: hash,
        resourceType: "reconciliation-review",
        resourceId: id,
      },
    });
    return reconciliationDocument(tx, actor, batch);
  });
}

function zId(id: string) {
  return z.string().uuid().parse(id);
}

export async function getReconciliationRecheck(
  actor: StockActor,
  rawId: string,
) {
  requireAnyPermission(actor, ["reports:read", "reconciliation:write"]);
  const batch = await prisma.reconciliationBatch.findFirst({
    where: {
      id: zId(rawId),
      unitId: actor.unitId,
      ...(actor.permissions.includes("costs:read") ? {} : { kind: "STOCK" }),
    },
  });
  if (!batch)
    throw new AppError("Conferência não encontrada nesta unidade.", 404);
  return reconciliationRecheckInput(batch);
}
