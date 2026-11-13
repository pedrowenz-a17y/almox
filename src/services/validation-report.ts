import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import { VALIDATION_STEPS, type ValidationState } from "@/lib/validation-plan";
import { canSaveReconciliation, canViewReports } from "@/lib/access-profiles";
import {
  serializable,
  requireAnyPermission,
  idempotencyKeySchema,
  payloadHash,
  findIdempotentResource,
  type StockActor,
  type StockTransaction,
} from "@/services/stock";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + "T00:00:00Z");
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Informe uma data válida.");
export function validationPeriod(raw: unknown, now = new Date()) {
  const today = now.toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
  const defaultFrom = new Date(Date.parse(today + "T12:00:00Z") - 29 * 86400000)
    .toISOString()
    .slice(0, 10);
  const input = z
    .object({ from: day.default(defaultFrom), to: day.default(today) })
    .strict()
    .parse(raw);
  const from = new Date(input.from + "T00:00:00-03:00"),
    until = new Date(Date.parse(input.to + "T00:00:00-03:00") + 86400000);
  const days = (until.getTime() - from.getTime()) / 86400000;
  if (days < 1 || days > 93 || input.to > today)
    throw new AppError(
      "Escolha um período de até 93 dias, encerrado até hoje.",
      400,
    );
  return {
    ...input,
    fromDate: from,
    untilDate: until,
    previousFrom: new Date(from.getTime() - days * 86400000),
    previousUntil: from,
    days,
  };
}
const percent = (n: number, d: number) =>
  d ? Math.round((n / d) * 10000) / 100 : null;
async function periodMetrics(
  tx: StockTransaction,
  actor: StockActor,
  from: Date,
  until: Date,
) {
  const [row] = await tx.$queryRaw<
    Array<{
      exits: number;
      linked: number;
      deliveries: number;
      handoffs: number;
      counted: number;
      divergent: number;
    }>
  >(Prisma.sql`
    SELECT
      (SELECT count(*)::int FROM "StockMovement" m WHERE m."unitId"=${actor.unitId}::uuid AND m.type='EXIT' AND m."createdAt">=${from} AND m."createdAt"<${until}) AS exits,
      (SELECT count(*)::int FROM "StockMovement" m JOIN "WorkOrder" o ON o.id=m."workOrderId" AND o."unitId"=m."unitId"
        WHERE m."unitId"=${actor.unitId}::uuid AND m.type='EXIT' AND m."createdAt">=${from} AND m."createdAt"<${until}) AS linked,
      (SELECT count(*)::int FROM "OrderEvent" e JOIN "WorkOrder" o ON o.id=e."orderId" AND o."unitId"=e."unitId"
        WHERE e."unitId"=${actor.unitId}::uuid AND e.type='APPLIED' AND e."createdAt">=${from} AND e."createdAt"<${until}) AS deliveries,
      (SELECT count(*)::int FROM "OrderEvent" e JOIN "WorkOrder" o ON o.id=e."orderId" AND o."unitId"=e."unitId"
        WHERE e."unitId"=${actor.unitId}::uuid AND e.type='APPLIED' AND e."createdAt">=${from} AND e."createdAt"<${until}
        AND e.metadata #>> '{handoff,deliveredById}'=e."userId"::text
        AND jsonb_typeof(e.metadata #> '{handoff,receivedByName}')='string'
        AND jsonb_typeof(e.metadata #> '{handoff,receivedByIdentifier}')='string'
        AND length(trim(COALESCE(e.metadata #>> '{handoff,receivedByName}','')))>0
        AND length(trim(COALESCE(e.metadata #>> '{handoff,receivedByIdentifier}','')))>0) AS handoffs,
      (SELECT count(*)::int FROM "InventoryCountItem" i JOIN "InventoryCount" c ON c.id=i."countId" AND c."unitId"=i."unitId"
        WHERE i."unitId"=${actor.unitId}::uuid AND c.status='APPROVED' AND c."approvedAt">=${from} AND c."approvedAt"<${until}) AS counted,
      (SELECT count(*)::int FROM "InventoryCountItem" i JOIN "InventoryCount" c ON c.id=i."countId" AND c."unitId"=i."unitId"
        WHERE i."unitId"=${actor.unitId}::uuid AND c.status='APPROVED' AND c."approvedAt">=${from} AND c."approvedAt"<${until} AND i.difference<>0) AS divergent`);
  return {
    ...row,
    linkedPercent: percent(row.linked, row.exits),
    handoffPercent: percent(row.handoffs, row.deliveries),
    divergentPercent: percent(row.divergent, row.counted),
  };
}
export async function validationIndicatorsIn(
  tx: StockTransaction,
  actor: StockActor,
  raw: unknown,
  now = new Date(),
) {
  requireAnyPermission(actor, ["reports:read", "reports:view"]);
  const period = validationPeriod(raw, now);
  const unit = await tx.operationalUnit.findUnique({
    where: { id: actor.unitId },
    select: { id: true, code: true, name: true },
  });
  if (!unit) throw new AppError("Unidade não encontrada.", 404);
  const current = await periodMetrics(
    tx,
    actor,
    period.fromDate,
    period.untilDate,
  );
  const previous = await periodMetrics(
    tx,
    actor,
    period.previousFrom,
    period.previousUntil,
  );
  const [pending] = await tx.$queryRaw<
    Array<{ awaitingInvoice: number; returns: number; unapplied: number }>
  >(Prisma.sql`
    SELECT count(*) FILTER (WHERE o.status='OPEN' AND m."appliedQuantity">0)::int AS "awaitingInvoice",
      count(*) FILTER (WHERE o.status IN ('OPEN','INVOICED') AND m."pendingReturnQuantity">0)::int AS returns,
      count(*) FILTER (WHERE o.status='OPEN' AND m."requestedQuantity"-m."appliedQuantity"-m."consumedQuantity"+m."returnedQuantity">0)::int AS unapplied
    FROM "OrderMaterial" m JOIN "WorkOrder" o ON o.id=m."orderId" AND o."unitId"=m."unitId" WHERE m."unitId"=${actor.unitId}::uuid`);
  return {
    unit,
    generatedAt: now.toISOString(),
    period: {
      from: period.from,
      to: period.to,
      timezone: "UTC-03:00",
      previousFrom: period.previousFrom.toISOString(),
      previousUntilExclusive: period.previousUntil.toISOString(),
    },
    current,
    previous,
    pending,
    definitions: [
      "Baixas vinculadas: movimentações de saída com O.S./O.P. sobre todas as saídas contábeis do período. Saídas avulsas podem ter finalidade legítima e devem ser analisadas separadamente.",
      "Entregas documentadas: eventos de aplicação com entregador identificado e recebedor com nome e identificação. É uma declaração do operador, não um aceite digital do recebedor. Aplicação e baixa são contadas separadamente.",
      "Diferenças de contagem: itens com diferença diferente de zero sobre os itens de contagens aprovadas na janela. Representam a observação registrada, não a divergência física atual.",
      "Pendências atuais: número de linhas de materiais, consultadas agora, sem somar unidades de medida diferentes. Não são uma reconstrução do período selecionado.",
      "Sem registros, a taxa fica sem base. A comparação com a janela anterior é descritiva e não comprova que o sistema causou uma melhoria. Não há linha de base anterior ao uso sem coleta específica.",
    ],
  };
}
export async function validationIndicators(actor: StockActor, raw: unknown) {
  return prisma.$transaction((tx) => validationIndicatorsIn(tx, actor, raw), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 15000,
  });
}
export type ValidationIndicators = Awaited<
  ReturnType<typeof validationIndicators>
>;
const stepIds = VALIDATION_STEPS.map((step) => step.id) as [
  (typeof VALIDATION_STEPS)[number]["id"],
  ...Array<(typeof VALIDATION_STEPS)[number]["id"]>,
];
const startSchema = z
  .object({
    title: z.string().trim().min(5).max(150),
    objective: z.string().trim().min(10).max(1500),
    origin: z.enum(["DEMONSTRATION", "COMPANY_PILOT"]),
    from: day,
    to: day,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("STEP"),
      stepId: z.enum(stepIds),
      outcome: z.enum(["PASS", "FAIL"]),
      note: z.string().trim().min(10).max(1500),
      reference: z.string().trim().min(3).max(200),
      expectedVersion: z.number().int().min(0).max(100),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("CLOSE"),
      conclusion: z.string().trim().min(20).max(3000),
      expectedVersion: z.number().int().min(0).max(100),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
]);
async function writer(tx: StockTransaction, actor: StockActor) {
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
    !canViewReports(permissions)
  )
    throw new AppError(
      "Seu acesso ao registro de validações nesta unidade foi alterado.",
      403,
    );
  return membership.user.name;
}
type StartData = {
  title: string;
  objective: string;
  origin: ValidationState["origin"];
  recordedByName: string;
  snapshot: ValidationIndicators;
};
async function state(tx: StockTransaction, actor: StockActor, id: string) {
  const logs = await tx.auditLog.findMany({
    where: { unitId: actor.unitId, entity: "ValidationRun", entityId: id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 103,
  });
  const start = logs.find((log) => log.action === "VALIDATION_STARTED");
  if (!start)
    throw new AppError("Validação não encontrada nesta unidade.", 404);
  const data = start.after as unknown as StartData;
  const changes = logs
    .filter((log) => log.action !== "VALIDATION_STARTED")
    .sort(
      (a, b) =>
        Number((a.after as { version: number }).version) -
        Number((b.after as { version: number }).version),
    );
  const steps = new Map<string, ValidationState["steps"][number]>();
  type Closure = {
    status: ValidationState["status"];
    conclusion: string;
    recordedByName: string;
  };
  let closed: Closure | null = null,
    closedAt: string | null = null;
  for (const log of changes) {
    const info = log.after as unknown as Record<string, unknown>;
    if (log.action === "VALIDATION_STEP_RECORDED")
      steps.set(String(info.stepId), {
        id: info.stepId as ValidationState["steps"][number]["id"],
        outcome: info.outcome as "PASS" | "FAIL",
        note: String(info.note),
        reference: String(info.reference),
        recordedByName: String(info.recordedByName),
        recordedAt: log.createdAt.toISOString(),
      });
    if (log.action === "VALIDATION_CLOSED") {
      closed = info as unknown as Closure;
      closedAt = log.createdAt.toISOString();
    }
  }
  const writable = canSaveReconciliation(actor.permissions);
  const result: ValidationState = {
    id,
    title: data.title,
    objective: data.objective,
    origin: data.origin,
    createdAt: start.createdAt.toISOString(),
    createdById: start.userId!,
    createdByName: data.recordedByName,
    version: changes.length,
    status: closed?.status ?? "OPEN",
    closedAt,
    closedByName: closed?.recordedByName ?? null,
    conclusion: closed?.conclusion ?? null,
    canRecord: writable && !closed,
    canClose:
      writable &&
      !closed &&
      (data.origin === "DEMONSTRATION" || start.userId !== actor.id),
    steps: [...steps.values()],
  };
  return {
    ...result,
    snapshot: data.snapshot,
    history: changes.map((log) => {
      const info = log.after as Record<string, Prisma.JsonValue>;
      return {
        action: log.action,
        version: Number(info.version),
        recordedAt: log.createdAt.toISOString(),
        recordedByName: String(info.recordedByName),
        stepId: typeof info.stepId === "string" ? info.stepId : null,
        outcome: typeof info.outcome === "string" ? info.outcome : null,
        note: String(info.note ?? info.conclusion ?? ""),
        reference: typeof info.reference === "string" ? info.reference : null,
      };
    }),
  };
}
export async function getValidationRun(actor: StockActor, rawId: string) {
  requireAnyPermission(actor, ["reports:read", "reports:view"]);
  const id = z.string().uuid().parse(rawId);
  return prisma.$transaction((tx) => state(tx, actor, id), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}
export async function listValidationRuns(actor: StockActor) {
  requireAnyPermission(actor, ["reports:read", "reports:view"]);
  return prisma.$transaction(
    async (tx) => {
      const starts = await tx.auditLog.findMany({
        where: {
          unitId: actor.unitId,
          entity: "ValidationRun",
          action: "VALIDATION_STARTED",
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      return Promise.all(
        starts.map(async (log) => {
          const run = await state(tx, actor, log.entityId);
          return {
            id: run.id,
            title: run.title,
            origin: run.origin,
            status: run.status,
            createdAt: run.createdAt,
            completedSteps: run.steps.length,
          };
        }),
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15000,
    },
  );
}
export async function startValidationRun(actor: StockActor, raw: unknown) {
  requireAnyPermission(actor, ["reports:read", "reconciliation:write"]);
  const input = startSchema.parse(raw);
  const hash = payloadHash(actor, "validation:start", input);
  return serializable(async (tx) => {
    const name = await writer(tx, actor);
    const prior = await findIdempotentResource(
      tx,
      actor,
      input.idempotencyKey,
      hash,
      "validation",
    );
    if (prior) return state(tx, actor, prior);
    const snapshot = await validationIndicatorsIn(tx, actor, {
      from: input.from,
      to: input.to,
    });
    const id = randomUUID();
    await tx.auditLog.create({
      data: {
        unitId: actor.unitId,
        userId: actor.id,
        entity: "ValidationRun",
        entityId: id,
        action: "VALIDATION_STARTED",
        after: {
          title: input.title,
          objective: input.objective,
          origin: input.origin,
          recordedByName: name,
          snapshot,
        } as Prisma.InputJsonValue,
      },
    });
    await tx.idempotencyRecord.create({
      data: {
        key: input.idempotencyKey,
        actorId: actor.id,
        unitId: actor.unitId,
        payloadHash: hash,
        resourceType: "validation",
        resourceId: id,
      },
    });
    return state(tx, actor, id);
  });
}
export async function recordValidation(
  actor: StockActor,
  rawId: string,
  raw: unknown,
) {
  requireAnyPermission(actor, ["reports:read", "reconciliation:write"]);
  const id = z.string().uuid().parse(rawId);
  const input = actionSchema.parse(raw);
  const hash = payloadHash(actor, "validation:record", { id, ...input });
  return serializable(async (tx) => {
    const name = await writer(tx, actor);
    const prior = await findIdempotentResource(
      tx,
      actor,
      input.idempotencyKey,
      hash,
      "validation",
    );
    if (prior) return state(tx, actor, id);
    const lock = `validation:${actor.unitId}:${id}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))`;
    const run = await state(tx, actor, id);
    if (run.status !== "OPEN")
      throw new AppError(
        "Esta validação já foi encerrada. Inicie outra para registrar um novo teste.",
        409,
      );
    if (run.version !== input.expectedVersion)
      throw new AppError(
        "Outra pessoa atualizou o roteiro. Reabra a validação antes de registrar.",
        409,
        "VALIDATION_CHANGED",
      );
    if (input.action === "STEP" && run.version >= 100)
      throw new AppError(
        "Limite de registros desta validação atingido. Encerre ou inicie outro roteiro.",
        409,
      );
    let after: Prisma.InputJsonValue;
    if (input.action === "STEP")
      after = {
        stepId: input.stepId,
        outcome: input.outcome,
        note: input.note,
        reference: input.reference,
      };
    else {
      if (!run.canClose)
        throw new AppError(
          "O piloto com a empresa precisa ser encerrado por outra pessoa autorizada.",
          403,
        );
      if (
        VALIDATION_STEPS.some(
          (step) => !run.steps.some((saved) => saved.id === step.id),
        )
      )
        throw new AppError(
          "Registre resultado e evidência das sete etapas antes de encerrar.",
          409,
        );
      after = {
        status: run.steps.some((step) => step.outcome === "FAIL")
          ? "ISSUES"
          : "REPORTED_PASS",
        conclusion: input.conclusion,
      };
    }
    await tx.auditLog.create({
      data: {
        unitId: actor.unitId,
        userId: actor.id,
        entity: "ValidationRun",
        entityId: id,
        action:
          input.action === "STEP"
            ? "VALIDATION_STEP_RECORDED"
            : "VALIDATION_CLOSED",
        after: { ...after, version: run.version + 1, recordedByName: name },
      },
    });
    await tx.idempotencyRecord.create({
      data: {
        key: input.idempotencyKey,
        actorId: actor.id,
        unitId: actor.unitId,
        payloadHash: hash,
        resourceType: "validation",
        resourceId: id,
      },
    });
    return state(tx, actor, id);
  });
}
