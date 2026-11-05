import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { api, AppError, json } from "@/lib/http";
export const runtime = "nodejs";
const MAX_BYTES = 3 * 1024 * 1024;
function imageType(data: Buffer) {
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255)
    return "image/jpeg";
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}
export const POST = api(async (request) => {
  const actor = await requireUser("catalog:write");
  const advertisedSize = Number(request.headers.get("content-length") || 0);
  if (advertisedSize > MAX_BYTES + 65536)
    throw new AppError("A imagem deve ter até 3 MB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("Envie uma imagem.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES + 65536) {
      await reader.cancel();
      throw new AppError("A imagem deve ter até 3 MB.", 413);
    }
    chunks.push(value);
  }
  const boundedBody = new Response(new Uint8Array(Buffer.concat(chunks)), {
    headers: { "Content-Type": request.headers.get("content-type") ?? "" },
  });
  let form: FormData;
  try {
    form = await boundedBody.formData();
  } catch {
    throw new AppError("Formulário de imagem inválido.");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES)
    throw new AppError("Envie uma imagem PNG, JPEG ou WebP de até 3 MB.");
  const data = Buffer.from(await file.arrayBuffer());
  const mimeType = imageType(data);
  if (!mimeType) throw new AppError("Formato inválido. Use PNG, JPEG ou WebP.");
  const asset = await prisma.imageAsset.create({
    data: { unitId: actor.unitId, data, mimeType, name: file.name.slice(0, 200), userId: actor.id },
    select: { id: true },
  });
  return json({ id: asset.id, url: `/api/files/${asset.id}` }, 201);
});
