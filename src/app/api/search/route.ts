import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, redactCosts } from "@/lib/auth";
import { api, json } from "@/lib/http";
export const GET = api(async (request) => {
  const actor = await requireUser();
  let q = z
    .string()
    .trim()
    .max(200)
    .parse(request.nextUrl.searchParams.get("q") ?? "");
  if (q.length < 2) return json({ products: [], locations: [], suppliers: [] });
  if (q.startsWith("http://") || q.startsWith("https://")) {
    try {
      q = new URL(q).pathname.split("/").filter(Boolean).at(-1) ?? q;
    } catch {
      /* search as plain text */
    }
  }
  const match = { contains: q, mode: Prisma.QueryMode.insensitive };
  const uuid = z.string().uuid().safeParse(q).success;
  const [products, locations, suppliers] = await Promise.all([
    prisma.product.findMany({
      where: {
        unitId: actor.unitId,
        active: true,
        OR: [
          { name: match },
          { internalCode: match },
          { sku: match },
          { barcode: match },
          { category: { name: match } },
          { supplier: { OR: [{ legalName: match }, { tradeName: match }] } },
          {
            balances: {
              some: {
                location: {
                  OR: [
                    { code: match },
                    { name: match },
                    ...(uuid ? [{ id: q }] : []),
                  ],
                },
              },
            },
          },
        ],
      },
      include: { category: true, supplier: true },
      orderBy: { name: "asc" },
      take: 30,
    }),
    prisma.location.findMany({
      where: {
        unitId: actor.unitId,
        active: true,
        OR: [{ name: match }, { code: match }, ...(uuid ? [{ id: q }] : [])],
      },
      include: { warehouse: true, parent: true },
      orderBy: { code: "asc" },
      take: 30,
    }),
    prisma.supplier.findMany({
      where: {
        unitId: actor.unitId,
        active: true,
        OR: [{ legalName: match }, { tradeName: match }, { taxId: match }],
      },
      orderBy: { legalName: "asc" },
      take: 15,
    }),
  ]);
  return json(redactCosts({ products, locations, suppliers }, actor));
});
