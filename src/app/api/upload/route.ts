import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { readImageUpload } from "@/lib/image-upload";

export const runtime = "nodejs";
export const POST = api(async (request) => {
  const actor = await requireUser("catalog:write");
  const { data, mimeType, name } = await readImageUpload(request);
  const asset = await prisma.imageAsset.create({
    data: { unitId: actor.unitId, data, mimeType, name: name.slice(0, 200), userId: actor.id },
    select: { id: true },
  });
  return json({ id: asset.id, url: `/api/files/${asset.id}` }, 201);
});
