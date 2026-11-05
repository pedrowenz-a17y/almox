import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { type SessionUser } from "@/lib/auth";
import { saveUserAccess, archiveUserAccess, listUserAccess, getUserAccess } from "@/services/user-access";
import { AppError } from "@/lib/http";

const name = z.string().trim().min(2, "Informe ao menos 2 caracteres").max(160);
const shortText = z.string().trim().max(255);
const notes = z.string().trim().max(4000);
const code = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[\p{L}\p{N}._\-/ ]+$/u, "Código contém caracteres inválidos");
const nullableId = z
  .union([z.string().uuid(), z.literal(""), z.null()])
  .transform((value) => value || null);
const nullableText = z
  .union([shortText, z.null()])
  .transform((value) => value || null);
function decimal(scale: number) {
  return z
    .union([z.string().trim().min(1), z.number()])
    .refine((value) => {
      const text = String(value);
      return (
        new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(text) &&
        Number(value) <= 1_000_000_000_000
      );
    }, `Informe um número positivo com até ${scale} casas decimais`)
    .transform(String);
}
const schemas = {
  products: z
    .object({
      internalCode: code,
      sku: nullableText.optional(),
      name,
      description: notes.optional(),
      categoryId: nullableId.optional(),
      unit: z.string().trim().min(1).max(20).optional(),
      manufacturer: shortText.optional(),
      supplierId: nullableId.optional(),
      barcode: nullableText.optional(),
      minStock: decimal(3).optional(),
      maxStock: z
        .union([decimal(3), z.null(), z.literal("")])
        .transform((value) => value || null)
        .optional(),
      unitCost: z.union([decimal(2), z.null(), z.literal("")])
        .transform((value) => value === "" ? null : value).optional(),
      imageUrl: z
        .union([
          z
            .string()
            .regex(/^\/api\/files\/[0-9a-f-]{36}$/)
            .refine(
              (value) =>
                z.string().uuid().safeParse(value.split("/").at(-1)).success,
              "Identificador de imagem inválido",
            ),
          z.null(),
          z.literal(""),
        ])
        .transform((value) => value || null)
        .optional(),
      active: z.boolean().optional(),
      notes: notes.optional(),
    })
    .strict(),
  categories: z
    .object({
      name,
      description: notes.optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  suppliers: z
    .object({
      legalName: name,
      tradeName: shortText.optional(),
      taxId: nullableText.optional(),
      phone: shortText.optional(),
      whatsapp: shortText.optional(),
      email: z
        .union([z.string().trim().email().max(254), z.literal("")])
        .optional(),
      address: notes.optional(),
      contact: shortText.optional(),
      notes: notes.optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  warehouses: z
    .object({
      name,
      code,
      description: notes.optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  locations: z
    .object({
      name,
      code,
      warehouseId: z.string().uuid(),
      parentId: nullableId.optional(),
      description: notes.optional(),
      notes: notes.optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  users: z.object({
    name, email: z.string().trim().email().max(254),
    authUserId: z.string().uuid().optional(),
    roleId: z.string().uuid(), active: z.boolean().optional(),
  }).strict(),
};
export type CatalogEntity = keyof typeof schemas;
export function parseEntity(entity: string): CatalogEntity {
  if (!Object.hasOwn(schemas, entity))
    throw new AppError("Cadastro não encontrado.", 404);
  return entity as CatalogEntity;
}
function requirePermission(actor: SessionUser, permission: string) {
  if (!actor.permissions.includes(permission))
    throw new AppError("Seu perfil não tem permissão para esta ação.", 403);
}
function snapshot(value: unknown): Prisma.InputJsonValue {
  const parsed = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete parsed.passwordHash;
  delete parsed.password;
  return parsed as Prisma.InputJsonValue;
}
async function audit(
  tx: Prisma.TransactionClient,
  actor: SessionUser,
  entity: string,
  id: string,
  before: unknown,
  after: unknown,
  action: string,
) {
  await tx.auditLog.create({
    data: {
      userId: actor.id,
      unitId: actor.unitId,
      action,
      entity,
      entityId: id,
      ...(before ? { before: snapshot(before) } : {}),
      after: snapshot(after),
    },
  });
}

async function transaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt === 2
      )
        throw error;
    }
  }
  throw new AppError("Operação concorrente. Tente novamente.", 409);
}
async function validateLocation(
  tx: Prisma.TransactionClient,
  id: string | undefined,
  warehouseId: string,
  parentId: string | null,
  unitId: string,
) {
  const warehouse = await tx.warehouse.findUnique({
    where: { id: warehouseId, unitId },
  });
  if (!warehouse?.active)
    throw new AppError("Selecione um almoxarifado ativo.");
  const visited = new Set<string>(id ? [id] : []);
  let cursor = parentId;
  while (cursor) {
    if (visited.has(cursor))
      throw new AppError(
        "Uma localização não pode ser filha de si mesma ou de seus descendentes.",
      );
    visited.add(cursor);
    const parent = await tx.location.findUnique({
      where: { id: cursor, unitId },
      select: { parentId: true, active: true, warehouseId: true },
    });
    if (!parent?.active)
      throw new AppError("A localização superior não existe ou está inativa.");
    if (parent.warehouseId !== warehouseId)
      throw new AppError(
        "A localização superior deve pertencer ao mesmo almoxarifado.",
      );
    cursor = parent.parentId;
  }
}
async function ensureArchivable(
  tx: Prisma.TransactionClient,
  entity: CatalogEntity,
  id: string,
  unitId: string,
) {
  if (
    entity === "products" &&
    (await tx.inventoryBalance.count({
      where: { unitId, productId: id, quantity: { not: 0 } },
    }))
  )
    throw new AppError(
      "Zere o saldo por movimentação ou inventário antes de desativar este produto.",
      409,
    );
  if ((entity === "products" || entity === "locations") && await tx.orderMaterial.count({
    where: { unitId, ...(entity === "products" ? { productId: id } : { locationId: id }), OR: [{ reservedQuantity: { gt: 0 } }, { appliedQuantity: { gt: 0 } }] },
  })) throw new AppError("Libere as reservas e devolva os materiais aplicados antes de desativar o cadastro.", 409);
  if (entity === "products" && await tx.purchaseOrderItem.count({ where: { unitId, productId: id, purchaseOrder: { status: "OPEN" } } })) {
    throw new AppError("O material possui pedido de compra em aberto.", 409);
  }
  if (entity === "locations") {
    if (
      await tx.inventoryBalance.count({
        where: { unitId, locationId: id, quantity: { not: 0 } },
      })
    )
      throw new AppError(
        "Transfira os materiais antes de desativar esta localização.",
        409,
      );
    if (await tx.location.count({ where: { unitId, parentId: id, active: true } }))
      throw new AppError("Desative as localizações filhas primeiro.", 409);
  }
  if (
    entity === "warehouses" &&
    (await tx.location.count({ where: { unitId, warehouseId: id, active: true } }))
  )
    throw new AppError(
      "Desative as localizações deste almoxarifado primeiro.",
      409,
    );
}

export async function saveCatalog(
  actor: SessionUser,
  entityValue: string,
  input: unknown,
  id?: string,
) {
  z.string().uuid().parse(actor.unitId);
  const entity = parseEntity(entityValue);
  if (entity === "users") return saveUserAccess(actor, input, id);
  requirePermission(actor, "catalog:write");
  if (id) z.string().uuid().parse(id);
  if (
    input &&
    typeof input === "object" &&
    "active" in input &&
    input.active === false
  )
    requirePermission(actor, "records:delete");
  return transaction(async (tx) => {
    let before: unknown = null;
    let after: { id: string };
    if (entity === "products") {
      const data = (id ? schemas.products.partial() : schemas.products).parse(
        input,
      );
      if (data.unitCost !== undefined) requirePermission(actor, "costs:read");
      const previous = id
        ? await tx.product.findUniqueOrThrow({ where: { id, unitId: actor.unitId } })
        : null;
      before = previous;
      if (previous && data.unit !== undefined && data.unit !== previous.unit) {
        const linked = await tx.product.findUniqueOrThrow({ where: { id: previous.id, unitId: actor.unitId }, select: { _count: { select: { balances: true, movements: true, countItems: true, orderMaterials: true, purchaseItems: true } } } });
        if (Object.values(linked._count).some((count) => count > 0)) {
          throw new AppError("Materiais com histórico, pedidos ou requisições não podem mudar de unidade de medida.", 409);
        }
      }
      const minimum = new Prisma.Decimal(data.minStock ?? previous?.minStock ?? 0);
      const maximum =
        data.maxStock === undefined ? previous?.maxStock : data.maxStock;
      if (
        maximum !== null &&
        maximum !== undefined &&
        new Prisma.Decimal(maximum).lessThan(minimum)
      )
        throw new AppError(
          "O estoque máximo deve ser maior ou igual ao mínimo.",
        );
      if (data.active === false && id) {
        requirePermission(actor, "records:delete");
        await ensureArchivable(tx, entity, id, actor.unitId);
      }
      if (
        data.categoryId &&
        !(await tx.category.findFirst({
          where: { id: data.categoryId, unitId: actor.unitId, active: true },
        }))
      )
        throw new AppError("Categoria inexistente ou inativa.");
      if (
        data.supplierId &&
        !(await tx.supplier.findFirst({
          where: { id: data.supplierId, unitId: actor.unitId, active: true },
        }))
      )
        throw new AppError("Fornecedor inexistente ou inativo.");
      if (
        data.imageUrl &&
        !(await tx.imageAsset.findUnique({
          where: { id: data.imageUrl.split("/").at(-1), unitId: actor.unitId },
        }))
      )
        throw new AppError("Imagem não encontrada. Envie novamente.");
      after = id
        ? await tx.product.update({
            where: { id, unitId: actor.unitId },
            data,
            include: { category: true, supplier: true },
          })
        : await tx.product.create({
            data: { ...data, unitId: actor.unitId } as Prisma.ProductUncheckedCreateInput,
            include: { category: true, supplier: true },
          });
    } else if (entity === "categories") {
      const data = (
        id ? schemas.categories.partial() : schemas.categories
      ).parse(input);
      before = id
        ? await tx.category.findUniqueOrThrow({ where: { id, unitId: actor.unitId } })
        : null;
      after = id
        ? await tx.category.update({ where: { id, unitId: actor.unitId }, data })
        : await tx.category.create({
            data: { ...data, unitId: actor.unitId } as Prisma.CategoryUncheckedCreateInput,
          });
    } else if (entity === "suppliers") {
      const data = (id ? schemas.suppliers.partial() : schemas.suppliers).parse(
        input,
      );
      before = id
        ? await tx.supplier.findUniqueOrThrow({ where: { id, unitId: actor.unitId } })
        : null;
      if (id && data.active === false && await tx.purchaseOrder.count({ where: { unitId: actor.unitId, supplierId: id, status: "OPEN" } })) {
        throw new AppError("O fornecedor possui pedidos de compra em aberto.", 409);
      }
      after = id
        ? await tx.supplier.update({ where: { id, unitId: actor.unitId }, data })
        : await tx.supplier.create({
            data: { ...data, unitId: actor.unitId } as Prisma.SupplierUncheckedCreateInput,
          });
    } else if (entity === "warehouses") {
      const data = (
        id ? schemas.warehouses.partial() : schemas.warehouses
      ).parse(input);
      before = id
        ? await tx.warehouse.findUniqueOrThrow({ where: { id, unitId: actor.unitId } })
        : null;
      if (data.active === false && id) {
        requirePermission(actor, "records:delete");
        await ensureArchivable(tx, entity, id, actor.unitId);
      }
      after = id
        ? await tx.warehouse.update({ where: { id, unitId: actor.unitId }, data })
        : await tx.warehouse.create({
            data: { ...data, unitId: actor.unitId } as Prisma.WarehouseUncheckedCreateInput,
          });
    } else if (entity === "locations") {
      const data = (id ? schemas.locations.partial() : schemas.locations).parse(
        input,
      );
      const previous = id
        ? await tx.location.findUniqueOrThrow({ where: { id, unitId: actor.unitId } })
        : null;
      before = previous;
      const warehouseId = data.warehouseId ?? previous?.warehouseId;
      if (!warehouseId) throw new AppError("Selecione o almoxarifado.");
      await validateLocation(
        tx,
        id,
        warehouseId,
        data.parentId === undefined
          ? (previous?.parentId ?? null)
          : data.parentId,
        actor.unitId,
      );
      if (data.active === false && id) {
        requirePermission(actor, "records:delete");
        await ensureArchivable(tx, entity, id, actor.unitId);
      }
      if (id && previous && warehouseId !== previous.warehouseId) {
        const links = await tx.location.findUnique({
          where: { id, unitId: actor.unitId },
          select: {
            _count: {
              select: {
                children: true,
                balances: true,
                outgoing: true,
                incoming: true,
                counts: true,
              },
            },
          },
        });
        if (links && Object.values(links._count).some((count) => count > 0))
          throw new AppError(
            "Localizações com histórico ou filhos não podem mudar de almoxarifado.",
            409,
          );
      }
      after = id
        ? await tx.location.update({
            where: { id, unitId: actor.unitId },
            data,
            include: { warehouse: true, parent: true },
          })
        : await tx.location.create({
            data: { ...data, unitId: actor.unitId } as Prisma.LocationUncheckedCreateInput,
            include: { warehouse: true, parent: true },
          });
    } else {
      throw new AppError("Cadastro não encontrado.", 404);
    }
    await audit(
      tx,
      actor,
      entity,
      after.id,
      before,
      after,
      id ? "UPDATE" : "CREATE",
    );
    return after;
  });
}

export async function archiveCatalog(
  actor: SessionUser,
  entityValue: string,
  id: string,
) {
  z.string().uuid().parse(actor.unitId);
  const entity = parseEntity(entityValue);
  if (entity === "users") return archiveUserAccess(actor, id);
  requirePermission(actor, "records:delete");
  requirePermission(actor, "catalog:write");
  z.string().uuid().parse(id);
  // Reuse full validation and audit; history and foreign keys remain intact.
  return saveCatalog(actor, entity, { active: false }, id);
}

export async function listCatalog(actor: SessionUser, entity: string) {
  z.string().uuid().parse(actor.unitId);
  if (entity === "roles") {
    requirePermission(actor, "users:manage");
    return prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: "asc" },
    });
  }
  switch (parseEntity(entity)) {
    case "products":
      return prisma.product.findMany({
        where: { unitId: actor.unitId },
        include: { category: true, supplier: true },
        orderBy: { name: "asc" },
      });
    case "categories":
      return prisma.category.findMany({ where: { unitId: actor.unitId }, orderBy: { name: "asc" } });
    case "suppliers":
      return prisma.supplier.findMany({ where: { unitId: actor.unitId }, orderBy: { legalName: "asc" } });
    case "warehouses":
      return prisma.warehouse.findMany({ where: { unitId: actor.unitId }, orderBy: { name: "asc" } });
    case "locations":
      return prisma.location.findMany({
        where: { unitId: actor.unitId },
        include: { warehouse: true, parent: true },
        orderBy: { code: "asc" },
      });
    case "users":
      return listUserAccess(actor);
  }
}

export async function getCatalog(
  actor: SessionUser,
  entity: string,
  id: string,
) {
  z.string().uuid().parse(actor.unitId);
  z.string().uuid().parse(id);
  let record: unknown;
  switch (parseEntity(entity)) {
    case "products":
      record = await prisma.product.findUnique({
        where: { id, unitId: actor.unitId },
        include: { category: true, supplier: true },
      });
      break;
    case "categories":
      record = await prisma.category.findUnique({ where: { id, unitId: actor.unitId } });
      break;
    case "suppliers":
      record = await prisma.supplier.findUnique({ where: { id, unitId: actor.unitId } });
      break;
    case "warehouses":
      record = await prisma.warehouse.findUnique({ where: { id, unitId: actor.unitId } });
      break;
    case "locations":
      record = await prisma.location.findUnique({
        where: { id, unitId: actor.unitId },
        include: { warehouse: true, parent: true },
      });
      break;
    case "users":
      record = await getUserAccess(actor, id);
      break;
  }
  if (!record) throw new AppError("Registro não encontrado.", 404);
  return record;
}
