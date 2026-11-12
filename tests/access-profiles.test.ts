import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCESS_PROFILES, ALL_PERMISSION_KEYS, LEGACY_PERMISSION_KEYS, canMoveStock, canActOnOrder, canSaveReconciliation, canViewReports, canWriteCatalog, canViewPurchasePrices, matchesProfile, roleLabel } from "../src/lib/access-profiles";

test("modelos têm somente permissões conhecidas, sem gestão de usuários ou ajuste de estoque", () => {
  assert.equal(new Set(ALL_PERMISSION_KEYS).size, ALL_PERMISSION_KEYS.length);
  for (const profile of ACCESS_PROFILES) {
    assert.ok(profile.permissions.every(key => ALL_PERMISSION_KEYS.includes(key)));
    assert.equal(new Set(profile.permissions).size, profile.permissions.length);
    assert.ok(matchesProfile(profile.name, profile.permissions));
    for (const forbidden of ["users:manage", "settings:manage", "inventory:adjust", "orders:invoice", "records:delete"])
      assert.ok(!(profile.permissions as readonly string[]).includes(forbidden), `${profile.name}: ${forbidden}`);
  }
});
test("permissões amplas preexistentes conservam o significado e as novas são limitadas à ação", () => {
  for (const type of ["ENTRY", "EXIT", "TRANSFER"]) assert.equal(canMoveStock(["stock:move"], type), true);
  assert.equal(canMoveStock(["stock:entry"], "ENTRY"), true);
  for (const type of ["EXIT", "TRANSFER", "__proto__", "ADJUSTMENT"]) assert.equal(canMoveStock(["stock:entry"], type), false);
  for (const action of ["REQUEST", "RESERVE", "RELEASE", "REDUCE_REQUEST", "CANCEL"]) assert.equal(canActOnOrder(["orders:write"], action), true);
  for (const action of ["APPLY", "RETURN", "REQUEST_RETURN", "CANCEL_RETURN"]) assert.equal(canActOnOrder(["orders:apply"], action), true);
  assert.equal(canActOnOrder(["orders:reserve"], "RESERVE"), true);
  for (const action of ["REQUEST", "APPLY", "RETURN", "INVOICE", "CANCEL", "__proto__"]) assert.equal(canActOnOrder(["orders:reserve"], action), false);
  assert.equal(canActOnOrder(["orders:deliver"], "APPLY"), true);
  assert.equal(canActOnOrder(["orders:deliver"], "RETURN"), false);
  assert.equal(canViewReports(["reports:read"]), true);
  assert.equal(canSaveReconciliation(["reports:read"]), true);
  assert.equal(canViewReports(["reports:view"]), true);
  assert.equal(canSaveReconciliation(["reports:view"]), false);
  assert.equal(canWriteCatalog(["suppliers:write"], "suppliers"), true);
  for (const entity of ["products", "warehouses", "locations", "users", "__proto__"]) assert.equal(canWriteCatalog(["suppliers:write"], entity), false);
  assert.equal(canViewPurchasePrices(["purchases:prices"]), true);
  assert.equal(LEGACY_PERMISSION_KEYS.length, 16);
});
test("perfil com nome de modelo e permissões diferentes é identificado como personalizado", () => {
  assert.equal(roleLabel({ name: "AUDITOR", permissions: [{ permission: { key: "stock:move" } }] }), "Auditor (personalizado)");
  assert.equal(matchesProfile("AUDITOR", ["stock:move"]), false);
});
