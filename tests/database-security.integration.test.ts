import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";

const connection = process.env.TEST_DATABASE_URL;
if (!connection) throw new Error("Defina TEST_DATABASE_URL para banco exclusivo de testes.");
const url = new URL(connection);
const databaseName = decodeURIComponent(url.pathname.slice(1));
if (!["postgres:", "postgresql:"].includes(url.protocol) || !/(^|[_-])tests?([_-]|$)/i.test(databaseName)) {
  throw new Error("A auditoria SQL só aceita banco PostgreSQL explicitamente dedicado a testes.");
}
const db = new PrismaClient({ datasourceUrl: connection });
const tables = Prisma.dmmf.datamodel.models.map(model => model.dbName || model.name);
before(async () => {
  const [actual] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`;
  assert.equal(actual.name, databaseName);
});
after(async () => { await db.$disconnect(); });

test("todas as tabelas operacionais têm RLS e não possuem políticas amplas para Data API", async () => {
  const rows = await db.$queryRaw<Array<{ name: string; enabled: boolean }>>(Prisma.sql`
    SELECT c.relname::text AS name, c.relrowsecurity AS enabled FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN (${Prisma.join(tables)})`);
  assert.equal(rows.length, tables.length);
  assert.deepEqual(rows.filter(row => !row.enabled), []);
  const policies = await db.$queryRaw<Array<{ tablename: string; policyname: string }>>(Prisma.sql`
    SELECT tablename::text, policyname::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (${Prisma.join(tables)})`);
  assert.deepEqual(policies, [], "O contrato atual bloqueia Data API direta: acesso operacional somente pelo servidor autenticado.");
});

test("constraints e gatilhos de unidade permanecem instalados no PostgreSQL", async () => {
  const foreignKeys = await db.$queryRaw<Array<{ name: string }>>`
    SELECT conname::text AS name FROM pg_constraint WHERE contype = 'f' AND conname LIKE '%same_unit_fkey'`;
  assert.ok(foreignKeys.length >= 25, "Relações operacionais precisam de FKs compostas por unidade.");
  const triggers = await db.$queryRaw<Array<{ name: string }>>`
    SELECT tgname::text AS name FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%scope_immutable'`;
  assert.ok(triggers.length >= 20, "Registros classificados não devem poder mudar de unidade silenciosamente.");
  const indexes = await db.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
    SELECT indexname::text, indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='StockMovement_order_consumption_once_idx'`;
  assert.equal(indexes.length, 1);
  assert.match(indexes[0].indexdef, /UNIQUE/);
});

test("roles Supabase existentes não têm privilégios diretos nas tabelas operacionais", async context => {
  const roles = await db.$queryRaw<Array<{ rolname: string }>>`SELECT rolname::text FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`;
  if (roles.length !== 2) {
    context.skip("Instância PostgreSQL local sem roles Supabase anon/authenticated. Verificação de privilégios do ambiente Supabase pendente.");
    return;
  }
  const grants = await db.$queryRaw<Array<{ role: string; name: string; readable: boolean; writable: boolean }>>(Prisma.sql`
    SELECT r.rolname::text AS role, c.relname::text AS name,
      has_table_privilege(r.rolname, c.oid, 'SELECT') AS readable,
      has_table_privilege(r.rolname, c.oid, 'INSERT,UPDATE,DELETE') AS writable
    FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE r.rolname IN ('anon','authenticated') AND n.nspname='public'
      AND c.relname IN (${Prisma.join(tables)})`);
  assert.deepEqual(grants.filter(row => row.readable || row.writable), []);
});
