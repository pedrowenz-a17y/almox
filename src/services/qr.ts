import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import { parseQrCode } from "@/lib/qr-code";
import type { StockActor } from "@/services/stock";

export async function resolveQr(
  actor: StockActor,
  raw: string,
  origin: string,
  allowProducts = false,
) {
  if (!actor.unitId)
    throw new AppError("Selecione uma unidade autorizada.", 403);
  let parsed;
  try {
    parsed = parseQrCode(raw, origin, allowProducts);
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : "QR Code inválido.",
    );
  }
  const { code, kind } = parsed;
  const uuid = z.string().uuid().safeParse(code).success;
  // Preserve location-code precedence for existing labels; product URLs remove ambiguity.
  if (kind !== "product") {
    const location = await prisma.location.findFirst({
      where: {
        unitId: actor.unitId,
        ...(uuid
          ? { id: code }
          : { code: { equals: code, mode: "insensitive" as const } }),
      },
      select: {
        id: true,
        name: true,
        code: true,
        parentId: true,
        warehouseId: true,
      },
    });
    if (location) return { ...location, kind: "location" as const };
  }
  if (allowProducts && kind !== "location") {
    const product = await prisma.product.findFirst({
      where: {
        unitId: actor.unitId,
        ...(uuid
          ? { id: code }
          : {
              OR: [
                {
                  internalCode: { equals: code, mode: "insensitive" as const },
                },
                { sku: { equals: code, mode: "insensitive" as const } },
                { barcode: code },
              ],
            }),
      },
      select: { id: true, name: true, internalCode: true },
    });
    if (product)
      return {
        id: product.id,
        name: product.name,
        code: product.internalCode,
        kind: "product" as const,
      };
  }
  throw new AppError(
    allowProducts
      ? "Produto ou localização não encontrado nesta unidade. Confira o código ou a unidade selecionada."
      : "Localização não encontrada. Confira o código da etiqueta.",
    404,
  );
}
