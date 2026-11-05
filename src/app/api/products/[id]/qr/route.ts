import QRCode from "qrcode";
import { z } from "zod";
import { appOrigin } from "@/lib/auth-config";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { api, AppError } from "@/lib/http";
import { qrTargetUrl } from "@/lib/qr-code";

export const runtime = "nodejs";
export const GET = api(async (request, context) => {
  const actor = await requireUser();
  const id = z
    .string()
    .uuid()
    .parse((await context.params).id);
  const product = await prisma.product.findUnique({
    where: { id, unitId: actor.unitId },
    select: { id: true, internalCode: true },
  });
  if (!product)
    throw new AppError("Produto não encontrado nesta unidade.", 404);
  const value = qrTargetUrl(appOrigin(), { kind: "product", id });
  const format = z
    .enum(["svg", "png"])
    .parse(request.nextUrl.searchParams.get("format") || "svg");
  const filename = `produto-${product.internalCode.replace(/[^a-zA-Z0-9_-]/g, "_")}.${format}`;
  const options = {
    errorCorrectionLevel: "M" as const,
    margin: 4,
    width: 512,
    color: { dark: "#202c31", light: "#ffffff" },
  };
  const body =
    format === "png"
      ? new Uint8Array(await QRCode.toBuffer(value, options))
      : await QRCode.toString(value, { ...options, type: "svg" });
  return new Response(body, {
    headers: {
      "Content-Type": format === "png" ? "image/png" : "image/svg+xml",
      "Content-Disposition": `${request.nextUrl.searchParams.has("download") ? "attachment" : "inline"}; filename="${filename}"`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
