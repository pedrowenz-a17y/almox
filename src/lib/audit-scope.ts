import type { Prisma } from "@prisma/client";

/** Cost-review notes can contain monetary values, even when they are free text. */
export function unitAuditScope(
  unitId: string,
  permissions: readonly string[],
): Prisma.AuditLogWhereInput {
  return {
    unitId,
    ...(permissions.includes("costs:read")
      ? {}
      : {
          NOT: {
            entity: "ReconciliationBatch",
            after: { path: ["kind"], equals: "ORDER_COST" },
          },
        }),
  };
}
