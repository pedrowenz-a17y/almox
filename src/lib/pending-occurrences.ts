import { Prisma } from "@prisma/client";

type Quantities = Pick<Prisma.OrderMaterialGetPayload<object>,
  "requestedQuantity" | "reservedQuantity" | "appliedQuantity" | "consumedQuantity" | "returnedQuantity" | "pendingReturnQuantity">;

function signals(material: Quantities | null) {
  const zero = new Prisma.Decimal(0);
  return material ? {
    UNAPPLIED: material.requestedQuantity.minus(material.appliedQuantity).minus(material.consumedQuantity).plus(material.returnedQuantity),
    RESERVED: material.reservedQuantity, AWAITING_INVOICE: material.appliedQuantity, RETURN: material.pendingReturnQuantity,
  } : { UNAPPLIED: zero, RESERVED: zero, AWAITING_INVOICE: zero, RETURN: zero };
}

/** An opening marker survives quantity increases, but changes after closure/reopening. */
export function newlyOpenedPending(before: Quantities | null, after: Quantities) {
  const previous = signals(before), current = signals(after);
  return (Object.keys(current) as Array<keyof typeof current>).filter(key => previous[key].lte(0) && current[key].gt(0));
}
