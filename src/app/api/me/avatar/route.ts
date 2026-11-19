import sharp from "sharp";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { api, AppError, json } from "@/lib/http";
import { readImageUpload } from "@/lib/image-upload";

export const runtime = "nodejs";
const avatarName = "profile-avatar";

function personalAsset(userId: string) {
  return { id: userId, userId, unitId: null, name: avatarName };
}

function photoResponse(data?: Uint8Array) {
  return json({
    photo: data
      ? `data:image/jpeg;base64,${Buffer.from(data).toString("base64")}`
      : null,
  });
}

export const GET = api(async () => {
  const { id: userId } = await requireUser();
  const avatar = await prisma.imageAsset.findUnique({
    where: personalAsset(userId),
    select: { data: true },
  });
  return photoResponse(avatar?.data);
});

export const PUT = api(async (request) => {
  const { id: userId } = await requireUser();
  const { data } = await readImageUpload(request);
  let photo: Buffer<ArrayBuffer>;
  try {
    photo = await sharp(data, { limitInputPixels: 24_000_000 })
      .rotate()
      .resize(160, 160, { fit: "cover" })
      .flatten({ background: "#eeeeee" })
      .jpeg({ quality: 84 })
      .toBuffer();
  } catch {
    throw new AppError(
      "Não foi possível ler a foto. Escolha uma imagem válida de até 24 megapixels.",
      422,
    );
  }
  // One private asset per account. Unit images have a unit ID and are never replaced here.
  const updated = await prisma.$executeRaw`
    INSERT INTO "ImageAsset" ("id", "userId", "mimeType", "name", "data")
    VALUES (${userId}::uuid, ${userId}::uuid, 'image/jpeg', ${avatarName}, ${photo})
    ON CONFLICT ("id") DO UPDATE SET "data" = EXCLUDED."data"
    WHERE "ImageAsset"."userId" = EXCLUDED."userId"
      AND "ImageAsset"."unitId" IS NULL
      AND "ImageAsset"."name" = EXCLUDED."name"
  `;
  if (updated === 0)
    throw new AppError(
      "Não foi possível reservar a foto para esta conta.",
      409,
    );
  return photoResponse(photo);
});

export const DELETE = api(async () => {
  const { id: userId } = await requireUser();
  await prisma.imageAsset.deleteMany({ where: personalAsset(userId) });
  return photoResponse();
});
