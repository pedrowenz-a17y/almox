import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { StockActor } from "../src/services/stock";

const key = randomUUID;
const testUrl = process.env.TEST_DATABASE_URL;
if (
  !testUrl ||
  !/(^|[_-])tests?([_-]|$)/i.test(
    decodeURIComponent(new URL(testUrl).pathname.slice(1)),
  )
)
  throw new Error("Use uma base exclusiva de testes.");
process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = testUrl;
let db: PrismaClient;
let orders: typeof import("../src/services/orders");
let service: typeof import("../src/services/delivery-receipts");
let stock: typeof import("../src/services/stock");
let fixture: {
  organization: string;
  units: string[];
  locations: string[];
  products: string[];
  roles: string[];
  users: string[];
  sender: StockActor;
  receiver: StockActor;
  auditor: StockActor;
};
const permissions = [
  "orders:read",
  "orders:write",
  "orders:apply",
  "orders:invoice",
  "stock:move",
];
const status = (code: number) => (error: unknown) => {
  assert.equal((error as { status: number }).status, code);
  return true;
};
before(async () => {
  ({ prisma: db } = await import("../src/lib/db"));
  orders = await import("../src/services/orders");
  service = await import("../src/services/delivery-receipts");
  stock = await import("../src/services/stock");
  const [actual] = await db.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database()::text AS name`;
  assert.equal(actual.name, new URL(testUrl).pathname.slice(1));
});
beforeEach(async () => {
  const organization = await db.organization.create({
    data: { name: `TEST-DELIVERY-${key()}` },
  });
  const roles = await Promise.all(
    ["SENDER", "RECEIVER", "AUDITOR"].map((name) =>
      db.role.create({ data: { name: `TEST-${name}-${key()}` } }),
    ),
  );
  for (const [index, keys] of [permissions, [], ["orders:read"]].entries())
    for (const perm of keys) {
      const p = await db.permission.upsert({
        where: { key: perm },
        create: { key: perm },
        update: {},
      });
      await db.rolePermission.create({
        data: { roleId: roles[index].id, permissionId: p.id },
      });
    }
  const users = await Promise.all(
    roles.map((role, index) =>
      db.user.create({
        data: {
          name: [
            "Entregador de teste",
            "Destinatário de teste",
            "Auditor de teste",
          ][index],
          email: `${key()}@example.invalid`,
          authUserId: key(),
          roleId: role.id,
        },
      }),
    ),
  );
  const units = await Promise.all(
    ["A", "B"].map((code) =>
      db.operationalUnit.create({
        data: {
          organizationId: organization.id,
          code: `${code}-${key()}`,
          name: `Unidade de teste ${code}`,
          memberships: {
            create: users.map((user) => ({
              userId: user.id,
              roleId: user.roleId,
            })),
          },
        },
      }),
    ),
  );
  const warehouses = await Promise.all(
    units.map((unit) =>
      db.warehouse.create({
        data: {
          unitId: unit.id,
          code: "ALM-DELIVERY",
          name: "Almoxarifado de teste",
        },
      }),
    ),
  );
  const locations = await Promise.all(
    warehouses.map((warehouse, i) =>
      db.location.create({
        data: {
          unitId: units[i].id,
          warehouseId: warehouse.id,
          code: "A-01",
          name: "Local de teste",
        },
      }),
    ),
  );
  const products = await Promise.all(
    units.map((unit) =>
      db.product.create({
        data: {
          unitId: unit.id,
          internalCode: "ITEM-TEST",
          name: "Rolamento de teste",
          unit: "UN",
          unitCost: "9213.47",
        },
      }),
    ),
  );
  const actor = (i: number, perms: string[]): StockActor => ({
    id: users[i].id,
    unitId: units[0].id,
    permissions: perms,
  });
  fixture = {
    organization: organization.id,
    units: units.map((u) => u.id),
    products: products.map((p) => p.id),
    locations: locations.map((l) => l.id),
    roles: roles.map((r) => r.id),
    users: users.map((u) => u.id),
    sender: actor(0, permissions),
    receiver: actor(1, []),
    auditor: actor(2, ["orders:read"]),
  };
});
afterEach(async () => {
  if (!fixture) return;
  const where = { unitId: { in: fixture.units } };
  await db.$transaction(async (tx) => {
    await tx.idempotencyRecord.deleteMany({ where });
    await tx.auditLog.deleteMany({ where });
    await tx.stockMovement.deleteMany({
      where: { ...where, returnOfId: { not: null } },
    });
    await tx.stockMovement.deleteMany({ where });
    await tx.orderEvent.deleteMany({ where });
    await tx.orderMaterial.deleteMany({ where });
    await tx.workOrder.deleteMany({ where });
    await tx.inventoryBalance.deleteMany({ where });
    await tx.product.deleteMany({ where });
    await tx.location.deleteMany({ where });
    await tx.warehouse.deleteMany({ where });
    await tx.unitMembership.deleteMany({ where });
    await tx.operationalUnit.deleteMany({
      where: { id: { in: fixture.units } },
    });
    await tx.user.deleteMany({ where: { id: { in: fixture.users } } });
    await tx.role.deleteMany({ where: { id: { in: fixture.roles } } });
    await tx.organization.delete({ where: { id: fixture.organization } });
  });
});
after(async () => {
  await db?.$disconnect();
});
async function prepared(unit = 0) {
  const actor = { ...fixture.sender, unitId: fixture.units[unit] };
  await stock.createMovement(actor, {
    type: "ENTRY",
    productId: fixture.products[unit],
    destinationId: fixture.locations[unit],
    quantity: "20",
    idempotencyKey: key(),
  });
  const order = await orders.createOrder(actor, {
    kind: "PRODUCTION",
    code: `OP-${key()}`,
    title: unit ? "Ordem secreta de outra unidade" : "Montagem de teste",
    idempotencyKey: key(),
  });
  const requested = await orders.actOnOrder(actor, order.id, {
    action: "REQUEST",
    productId: fixture.products[unit],
    locationId: fixture.locations[unit],
    quantity: "10",
    idempotencyKey: key(),
  });
  const materialId = requested.materials[0].id;
  await orders.actOnOrder(actor, order.id, {
    action: "RESERVE",
    materialId,
    quantity: "10",
    idempotencyKey: key(),
  });
  return { actor, orderId: order.id, materialId };
}
async function deliver(unit = 0, linked = true) {
  const p = await prepared(unit);
  const updated = await orders.actOnOrder(p.actor, p.orderId, {
    action: "APPLY",
    materialId: p.materialId,
    quantity: "10",
    idempotencyKey: key(),
    ...(linked
      ? { recipientUserId: fixture.receiver.id }
      : {
          receivedByName: "Destinatário de teste",
          receivedByIdentifier: "Identificação declarada",
        }),
  });
  return { ...p, id: updated.events.find((e) => e.type === "APPLIED")!.id };
}
const command = (action: string, expectedVersion = 0, extra: object = {}) => ({
  action,
  expectedVersion,
  idempotencyKey: key(),
  ...extra,
});
async function ledger() {
  return {
    balances: await db.inventoryBalance.findMany({
      where: { unitId: fixture.units[0] },
    }),
    materials: await db.orderMaterial.findMany({
      where: { unitId: fixture.units[0] },
    }),
    movements: await db.stockMovement.findMany({
      where: { unitId: fixture.units[0] },
    }),
  };
}

test("entrega vincula identidade ativa e conserva dados do material, sem confiar no nome enviado", async () => {
  const p = await prepared();
  const result = await orders.actOnOrder(fixture.sender, p.orderId, {
    action: "APPLY",
    materialId: p.materialId,
    quantity: "10",
    recipientUserId: fixture.receiver.id,
    receivedByName: "Nome forjado",
    receivedByIdentifier: "forjado",
    idempotencyKey: key(),
  });
  const event = result.events.find((e) => e.type === "APPLIED")!;
  const handoff = (
    event.metadata as {
      handoff: {
        receivedByName: string;
        receivedByUserId: string;
        confirmation: string;
      };
    }
  ).handoff;
  assert.equal(handoff.receivedByName, "Destinatário de teste");
  assert.equal(handoff.receivedByUserId, fixture.receiver.id);
  assert.equal(handoff.confirmation, "DECLARED_BY_OPERATOR");
  await db.product.update({
    where: { id: fixture.products[0] },
    data: { name: "Nome alterado depois" },
  });
  const item = (await service.getDeliveryReceipt(fixture.receiver, event.id))
    .item;
  assert.equal(item.productName, "Rolamento de teste");
  assert.equal(item.status, "PENDING");
  assert.equal(item.canRespond, true);
  assert.equal(JSON.stringify(item).includes("9213.47"), false);
  assert.equal(JSON.stringify(item).includes("authUserId"), false);
});
test("somente o destinatário confirma, inclusive com administrador ou auditor tentando responder", async () => {
  const p = await deliver();
  await assert.rejects(
    service.respondToDelivery(fixture.sender, p.id, command("CONFIRM")),
    status(403),
  );
  await assert.rejects(
    service.respondToDelivery(fixture.auditor, p.id, command("CONFIRM")),
    status(403),
  );
  await assert.rejects(
    service.getDeliveryReceipt(
      { ...fixture.receiver, unitId: fixture.units[1] },
      p.id,
    ),
    status(404),
  );
  await assert.rejects(
    service.listDeliveryReceipts(fixture.receiver, { scope: "UNIT" }),
    status(403),
  );
  assert.equal(
    (await service.listDeliveryReceipts(fixture.receiver)).items.length,
    1,
  );
  await service.respondToDelivery(fixture.receiver, p.id, command("CONFIRM"));
  assert.equal(
    (await service.getDeliveryReceipt(fixture.sender, p.id)).item.status,
    "CONFIRMED",
  );
});
test("confirmar recebimento não movimenta estoque nem duplica baixa no faturamento", async () => {
  const p = await deliver(),
    before = await ledger();
  const input = command("CONFIRM"),
    a = await service.respondToDelivery(fixture.receiver, p.id, input),
    b = await service.respondToDelivery(fixture.receiver, p.id, input);
  assert.deepEqual(a, b);
  assert.deepEqual(await ledger(), before);
  await orders.actOnOrder(fixture.sender, p.orderId, {
    action: "INVOICE",
    reference: "NF-TEST",
    idempotencyKey: key(),
  });
  assert.equal(
    await db.stockMovement.count({
      where: { workOrderId: p.orderId, type: "EXIT" },
    }),
    1,
  );
  assert.equal(
    (await service.getDeliveryReceipt(fixture.receiver, p.id)).item.status,
    "CONFIRMED",
  );
  await service.respondToDelivery(fixture.receiver, p.id, input);
  assert.equal(
    await db.stockMovement.count({
      where: { workOrderId: p.orderId, type: "EXIT" },
    }),
    1,
  );
});
test("divergência, tratamento, recusa e aceite preservam relato original sem alterar saldos", async () => {
  const p = await deliver(),
    before = await ledger();
  await service.respondToDelivery(
    fixture.receiver,
    p.id,
    command("DISPUTE", 0, {
      receivedQuantity: "8",
      materialMatches: true,
      note: "Recebi apenas oito unidades nesta entrega.",
    }),
  );
  await assert.rejects(
    service.respondToDelivery(
      fixture.auditor,
      p.id,
      command("PROPOSE", 1, {
        note: "Conferência realizada no local indicado.",
        reference: "OS-TEST",
      }),
    ),
    status(403),
  );
  await service.respondToDelivery(
    fixture.sender,
    p.id,
    command("PROPOSE", 1, {
      note: "Conferência física registrada para revisão do destinatário.",
      reference: "CONT-TEST-01",
    }),
  );
  await assert.rejects(
    service.respondToDelivery(
      fixture.sender,
      p.id,
      command("ACCEPT", 2, {
        note: "Tentativa de encerrar no lugar do destinatário.",
      }),
    ),
    status(403),
  );
  await service.respondToDelivery(
    fixture.receiver,
    p.id,
    command("REJECT", 2, {
      note: "Ainda não conferimos a diferença no local.",
    }),
  );
  await service.respondToDelivery(
    fixture.sender,
    p.id,
    command("PROPOSE", 3, {
      note: "Providências conferidas e documento disponível para consulta.",
      reference: "CONT-TEST-02",
    }),
  );
  await service.respondToDelivery(
    fixture.receiver,
    p.id,
    command("ACCEPT", 4, {
      note: "Conferi o documento e aceito o tratamento informado.",
    }),
  );
  const detail = await service.getDeliveryReceipt(fixture.receiver, p.id);
  assert.equal(detail.item.status, "RESOLVED");
  assert.equal(detail.item.receivedQuantity, "8.000");
  assert.equal(detail.item.version, 5);
  assert.equal(detail.history.length, 5);
  assert.equal(detail.history.at(-1)?.type, "DELIVERY_DISPUTED");
  assert.deepEqual(await ledger(), before);
});
test("quantidade zero, material diferente e excesso são relatos válidos, sem conversão nem arredondamento", async () => {
  const p = await deliver();
  await assert.rejects(
    service.respondToDelivery(
      fixture.receiver,
      p.id,
      command("DISPUTE", 0, {
        receivedQuantity: "10",
        materialMatches: true,
        note: "Não há diferença de quantidade ou de material.",
      }),
    ),
    status(400),
  );
  await assert.rejects(
    service.respondToDelivery(
      fixture.receiver,
      p.id,
      command("DISPUTE", 0, {
        receivedQuantity: "-1",
        materialMatches: false,
        note: "Quantidade negativa inválida para o relato.",
      }),
    ),
  );
  await assert.rejects(
    service.respondToDelivery(
      fixture.receiver,
      p.id,
      command("DISPUTE", 0, {
        receivedQuantity: "0.0001",
        materialMatches: false,
        note: "Precisão que não pode ser representada pelo sistema.",
      }),
    ),
  );
  await service.respondToDelivery(
    fixture.receiver,
    p.id,
    command("DISPUTE", 0, {
      receivedQuantity: "0",
      materialMatches: false,
      note: "Não recebi o material indicado nesta entrega.",
    }),
  );
  assert.equal(
    (await service.getDeliveryReceipt(fixture.receiver, p.id)).item
      .receivedQuantity,
    "0.000",
  );
  const second = await deliver();
  await service.respondToDelivery(
    fixture.receiver,
    second.id,
    command("DISPUTE", 0, {
      receivedQuantity: "10.125",
      materialMatches: true,
      note: "Recebi uma quantidade maior que a declarada.",
    }),
  );
  assert.equal(
    (await service.getDeliveryReceipt(fixture.receiver, second.id)).item
      .receivedQuantity,
    "10.125",
  );
});
test("concorrência e repetição segura criam uma única resposta para a mesma versão", async () => {
  const p = await deliver();
  const input = command("CONFIRM");
  const results = await Promise.all([
    service.respondToDelivery(fixture.receiver, p.id, input),
    service.respondToDelivery(fixture.receiver, p.id, input),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(
    (await service.getDeliveryReceipt(fixture.receiver, p.id)).history.length,
    1,
  );
  const second = await deliver();
  const competing = await Promise.allSettled([
    service.respondToDelivery(fixture.receiver, second.id, command("CONFIRM")),
    service.respondToDelivery(
      fixture.receiver,
      second.id,
      command("DISPUTE", 0, {
        receivedQuantity: "9",
        materialMatches: true,
        note: "Faltou uma unidade na conferência da entrega.",
      }),
    ),
  ]);
  assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await service.getDeliveryReceipt(fixture.receiver, second.id)).history
      .length,
    1,
  );
  await assert.rejects(
    service.respondToDelivery(fixture.receiver, p.id, {
      ...input,
      action: "DISPUTE",
      receivedQuantity: "9",
      materialMatches: true,
      note: "Outra resposta usando a chave anterior.",
    }),
    status(409),
  );
});
test("versão desatualizada e campos de autoria enviados pelo cliente são recusados", async () => {
  const p = await deliver();
  await assert.rejects(
    service.respondToDelivery(fixture.receiver, p.id, {
      ...command("CONFIRM"),
      receivedQuantity: "10",
      userId: fixture.sender.id,
    }),
  );
  await service.respondToDelivery(
    fixture.receiver,
    p.id,
    command("DISPUTE", 0, {
      receivedQuantity: "9",
      materialMatches: true,
      note: "Faltou uma unidade na conferência da entrega.",
    }),
  );
  await assert.rejects(
    service.respondToDelivery(
      fixture.sender,
      p.id,
      command("PROPOSE", 0, {
        note: "Proposta baseada em uma versão já antiga.",
        reference: "REF-TEST",
      }),
    ),
    status(409),
  );
  assert.equal(
    (await service.getDeliveryReceipt(fixture.sender, p.id)).item.status,
    "DISPUTED",
  );
});
test("acesso inativo ou revogado bloqueia resposta e tratamento mesmo com ator antigo", async () => {
  const p = await deliver();
  await db.unitMembership.update({
    where: {
      userId_unitId: { userId: fixture.receiver.id, unitId: fixture.units[0] },
    },
    data: { active: false },
  });
  await assert.rejects(
    service.respondToDelivery(fixture.receiver, p.id, command("CONFIRM")),
    status(403),
  );
  assert.equal(
    (await service.getDeliveryReceipt(fixture.sender, p.id)).item
      .recipientActive,
    false,
  );
  await db.unitMembership.update({
    where: {
      userId_unitId: { userId: fixture.receiver.id, unitId: fixture.units[0] },
    },
    data: { active: true },
  });
  await service.respondToDelivery(
    fixture.receiver,
    p.id,
    command("DISPUTE", 0, {
      receivedQuantity: "9",
      materialMatches: true,
      note: "Faltou uma unidade na conferência da entrega.",
    }),
  );
  const permission = await db.permission.findUniqueOrThrow({
    where: { key: "orders:apply" },
  });
  await db.rolePermission.delete({
    where: {
      roleId_permissionId: {
        roleId: fixture.roles[0],
        permissionId: permission.id,
      },
    },
  });
  await assert.rejects(
    service.respondToDelivery(
      fixture.sender,
      p.id,
      command("PROPOSE", 1, {
        note: "Permissão já foi revogada no cadastro.",
        reference: "REF-TEST",
      }),
    ),
    status(403),
  );
});
test("entregas declaradas e legadas não são ligadas por coincidência de nome ou email", async () => {
  const p = await deliver(0, false);
  assert.equal((await service.listDeliveryReceipts(fixture.receiver)).total, 0);
  const monitor = await service.listDeliveryReceipts(fixture.sender, {
    scope: "UNIT",
  });
  assert.equal(monitor.items[0].status, "UNLINKED");
  await assert.rejects(
    service.respondToDelivery(fixture.receiver, p.id, command("CONFIRM")),
    status(404),
  );
  await db.orderEvent.update({ where: { id: p.id }, data: { metadata: {} } });
  assert.equal(
    (await service.getDeliveryReceipt(fixture.sender, p.id)).item.status,
    "UNLINKED",
  );
});
test("contas candidatas e nova entrega exigem identidade, unidade e pessoa distinta", async () => {
  const candidates = await service.receiptCandidates(fixture.sender);
  assert.ok(!candidates.people.some((p) => p.id === fixture.sender.id));
  assert.equal(JSON.stringify(candidates).includes("@"), false);
  await assert.rejects(
    service.receiptCandidates(fixture.receiver),
    status(403),
  );
  const p = await prepared(),
    before = await ledger();
  for (const invalid of [fixture.sender.id, key()])
    await assert.rejects(
      orders.actOnOrder(fixture.sender, p.orderId, {
        action: "APPLY",
        materialId: p.materialId,
        quantity: "10",
        recipientUserId: invalid,
        idempotencyKey: key(),
      }),
    );
  await db.unitMembership.update({
    where: {
      userId_unitId: { userId: fixture.receiver.id, unitId: fixture.units[0] },
    },
    data: { active: false },
  });
  await assert.rejects(
    orders.actOnOrder(fixture.sender, p.orderId, {
      action: "APPLY",
      materialId: p.materialId,
      quantity: "10",
      recipientUserId: fixture.receiver.id,
      idempotencyKey: key(),
    }),
    status(403),
  );
  await db.unitMembership.update({
    where: {
      userId_unitId: { userId: fixture.receiver.id, unitId: fixture.units[0] },
    },
    data: { active: true },
  });
  await db.user.update({
    where: { id: fixture.receiver.id },
    data: { authUserId: null },
  });
  await assert.rejects(
    orders.actOnOrder(fixture.sender, p.orderId, {
      action: "APPLY",
      materialId: p.materialId,
      quantity: "10",
      recipientUserId: fixture.receiver.id,
      idempotencyKey: key(),
    }),
    status(400),
  );
  assert.deepEqual(await ledger(), before);
  assert.ok(
    !(await service.receiptCandidates(fixture.sender)).people.some(
      (p) => p.id === fixture.receiver.id,
    ),
  );
});
test("filtros, paginação e histórico não expõem outra unidade ou outras entregas ao destinatário", async () => {
  const p = await deliver();
  await deliver(1);
  for (let i = 0; i < 26; i++)
    await db.orderEvent.create({
      data: {
        unitId: fixture.units[0],
        orderId: p.orderId,
        materialId: p.materialId,
        userId: fixture.sender.id,
        type: "APPLIED",
        quantity: "1",
        metadata: {
          handoff: {
            receivedByUserId: fixture.receiver.id,
            receivedByName: "Destinatário de teste",
          },
        },
      },
    });
  const page1 = await service.listDeliveryReceipts(fixture.receiver),
    page2 = await service.listDeliveryReceipts(fixture.receiver, { page: 2 });
  assert.equal(page1.total, 27);
  assert.equal(page1.items.length, 25);
  assert.equal(page2.items.length, 2);
  assert.equal(
    new Set([...page1.items, ...page2.items].map((i) => i.id)).size,
    27,
  );
  await service.respondToDelivery(fixture.receiver, p.id, command("CONFIRM"));
  const pending = await service.listDeliveryReceipts(fixture.receiver, {
    status: "PENDING",
  });
  assert.equal(pending.total, 26);
  assert.equal(pending.summary.CONFIRMED, 1);
  assert.equal(JSON.stringify(pending).includes("Ordem secreta"), false);
  assert.equal(JSON.stringify(pending).includes("9213.47"), false);
  await assert.rejects(
    service.listDeliveryReceipts({ ...fixture.receiver, unitId: "" }),
    status(403),
  );
});
