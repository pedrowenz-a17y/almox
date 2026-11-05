import { Prisma } from "@prisma/client";

type Amount = string | Prisma.Decimal;
export type ReplenishmentAmounts = {
  available: Amount;
  minimum: Amount;
  maximum?: Amount | null;
  incoming: Amount;
};
/** Planning only: quantities are exact and open purchases are deducted once. */
export function replenishmentAmounts(input: ReplenishmentAmounts) {
  const available = new Prisma.Decimal(input.available);
  const minimum = new Prisma.Decimal(input.minimum);
  const incoming = new Prisma.Decimal(input.incoming);
  const target = new Prisma.Decimal(input.maximum ?? input.minimum);
  return {
    needsAttention: available.lt(minimum) || available.lte(0),
    target: target.toFixed(3),
    suggested: Prisma.Decimal.max(
      0,
      target.minus(available).minus(incoming),
    ).toFixed(3),
  };
}
