import { requireAnyPermission } from "@/services/stock";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import { reconciliationInputSchema as inputSchema } from "@/lib/reconciliation-format";
import {
  reconciliationDocument,
  reconciliationDocuments,
  assertReconciliationWriter,
} from "@/services/reconciliation-review";
import {
  findIdempotentResource,
  idempotencyKeySchema,
  payloadHash,
  requirePermission,
  serializable,
  type StockActor,
} from "@/services/stock";

import { compareReconciliation } from "@/services/reconciliation-comparison";

const saveSchema = inputSchema.extend({ idempotencyKey: idempotencyKeySchema });

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
  requireAnyPermission(actor, ["reports:read", "reports:view"]);
  if (kind === "ORDER_COST") requirePermission(actor, "costs:read");
}

export async function previewReconciliation(
  actor: StockActor,
  rawInput: unknown,
) {
  const input = inputSchema.parse(rawInput);
  authorize(actor, input.kind);
  return prisma.$transaction((tx) => compareReconciliation(tx, actor, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 15_000,
  });
}

export async function saveReconciliation(actor: StockActor, rawInput: unknown) {
  requireAnyPermission(actor, ["reports:read", "reconciliation:write"]);
  const { idempotencyKey, ...input } = saveSchema.parse(rawInput);
  authorize(actor, input.kind);
  const hash = payloadHash(actor, "reconciliation:create", input);
  return serializable(async (tx) => {
    await assertReconciliationWriter(tx, actor, input.kind);
    const previous = await findIdempotentResource(
      tx,
      actor,
      idempotencyKey,
      hash,
      "reconciliation",
    );
    if (previous)
      return reconciliationDocument(
        tx,
        actor,
        await tx.reconciliationBatch.findFirstOrThrow({
          where: { id: previous, unitId: actor.unitId },
        }),
      );
    // Recompute inside the same transaction as the saved document, never trust a client preview.
    const result = await compareReconciliation(tx, actor, input);
    if (result.source) {
      const lock = `reconciliation:${actor.unitId}:${result.source.fingerprint}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
      const existing = await tx.reconciliationBatch.findFirst({
        where: {
          unitId: actor.unitId,
          kind: input.kind,
          AND: [
            {
              result: {
                path: ["source", "fingerprint"],
                equals: result.source.fingerprint,
              },
            },
            ...(input.recheckOf
              ? [
                  {
                    result: {
                      path: ["source", "previousBatchId"],
                      equals: input.recheckOf,
                    },
                  },
                ]
              : []),
          ],
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        const source = (
          existing.result as {
            source: { erpName: string; cutoffNote: string; basis: string };
          }
        ).source;
        if (
          source.erpName !== input.context!.erpName ||
          source.cutoffNote !== input.context!.cutoffNote ||
          source.basis !== input.context!.basis
        )
          throw new AppError(
            "Este arquivo já foi registrado com outros critérios. Abra o documento e use Nova conferência para registrar uma revisão.",
            409,
            "RECONCILIATION_SOURCE_CONFLICT",
          );
        await tx.idempotencyRecord.create({
          data: {
            key: idempotencyKey,
            unitId: actor.unitId,
            actorId: actor.id,
            payloadHash: hash,
            resourceType: "reconciliation",
            resourceId: existing.id,
          },
        });
        return {
          ...(await reconciliationDocument(tx, actor, existing)),
          reused: true,
        };
      }
    }
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
    return {
      ...(await reconciliationDocument(tx, actor, batch)),
      reused: false,
    };
  });
}

export async function listReconciliations(actor: StockActor) {
  requireAnyPermission(actor, ["reports:read", "reports:view"]);
  const costs = actor.permissions.includes("costs:read");
  return prisma.$transaction(
    async (tx) => {
      // The list needs metadata, not up to 50 complete thousand-line snapshots.
      const batches = await tx.$queryRaw<
        import("@prisma/client").ReconciliationBatch[]
      >(Prisma.sql`
    SELECT id, "unitId", "sourceName", "referenceAt", kind, "createdById", "createdAt",
      jsonb_build_object('schemaVersion', result->'schemaVersion', 'source', result->'source', 'totals', result->'totals') AS result
    FROM "ReconciliationBatch" WHERE "unitId" = ${actor.unitId}::uuid ${costs ? Prisma.empty : Prisma.sql`AND kind = 'STOCK'`}
    ORDER BY "createdAt" DESC, id DESC LIMIT 50`);
      const documents = await reconciliationDocuments(
        tx,
        actor,
        batches,
        false,
      );
      return documents.map((document) => ({
        id: document.id,
        kind: document.kind,
        sourceName: document.sourceName,
        referenceAt: document.referenceAt,
        createdAt: document.createdAt,
        createdBy: document.createdBy,
        review: {
          status: document.review.status,
          nextBatchId: document.review.nextBatchId,
        },
        totals: (document.result as { totals?: unknown }).totals,
        revision:
          (document.result as { source?: { revision?: number } }).source
            ?.revision ?? null,
      }));
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15_000,
    },
  );
}

export async function getReconciliation(actor: StockActor, rawId: string) {
  requireAnyPermission(actor, ["reports:read", "reports:view"]);
  const id = z.string().uuid().parse(rawId);
  return prisma.$transaction(
    async (tx) => {
      const batch = await tx.reconciliationBatch.findFirst({
        where: {
          id,
          unitId: actor.unitId,
          ...(actor.permissions.includes("costs:read")
            ? {}
            : { kind: "STOCK" }),
        },
      });
      if (!batch)
        throw new AppError(
          "Conciliação não encontrada nesta unidade ou sem acesso ao tipo de relatório.",
          404,
        );
      return reconciliationDocument(tx, actor, batch);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function reconciliationSetup(actor: StockActor) {
  requireAnyPermission(actor, ["reports:read", "reports:view"]);
  const unit = await prisma.operationalUnit.findUnique({
    where: { id: actor.unitId },
    select: { code: true, name: true },
  });
  if (!unit) throw new AppError("Unidade não encontrada.", 404);
  return { unitCode: unit.code, unitName: unit.name };
}
