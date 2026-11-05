import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { api, AppError } from "@/lib/http";
export const GET = api(async (_request, context) => {
  const actor = await requireUser();
  const { id } = await context.params;
  z.string().uuid().parse(id);
  const asset = await prisma.imageAsset.findUnique({ where: { id, unitId: actor.unitId } });
  if (!asset) throw new AppError("Imagem não encontrada.", 404);
  return new Response(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
