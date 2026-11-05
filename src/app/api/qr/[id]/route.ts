import { appOrigin } from "@/lib/auth-config";
import QRCode from "qrcode";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma as db } from "@/lib/db";
import { api, AppError } from "@/lib/http";

export const runtime = "nodejs";

export const GET = api(async (request, context) => {
  const actor = await requireUser();
  const id = z
    .string()
    .uuid()
    .parse((await context.params).id);
  const location = await db.location.findUnique({
    where: { id, unitId: actor.unitId },
    select: { id: true, code: true },
  });
  if (!location) throw new AppError("Localização não encontrada.", 404);
  const base = appOrigin();
  const value = `${base}/localizacao/${location.id}`;
  const format = z
    .enum(["svg", "png"])
    .parse(request.nextUrl.searchParams.get("format") || "svg");
  const options = {
    errorCorrectionLevel: "M" as const,
    margin: 4,
    width: 512,
    color: { dark: "#152b23", light: "#ffffff" },
  };
  const fileName = `localizacao-${location.code.replace(/[^a-zA-Z0-9_-]/g, "_")}.${format}`;
  const headers = {
    "Content-Type": format === "svg" ? "image/svg+xml" : "image/png",
    "Content-Disposition": `${request.nextUrl.searchParams.has("download") ? "attachment" : "inline"}; filename="${fileName}"`,
  };
  if (format === "png")
    return new Response(new Uint8Array(await QRCode.toBuffer(value, options)), {
      headers,
    });
  return new Response(
    await QRCode.toString(value, { ...options, type: "svg" }),
    { headers },
  );
});
