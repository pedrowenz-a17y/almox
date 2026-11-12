import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/auth";
import { api } from "@/lib/http";
export const runtime = "nodejs";
/** A fixed, reviewable migration file; this endpoint never executes SQL. */
export const GET = api(async () => {
  await requireUser("users:manage");
  const sql = await readFile(path.join(process.cwd(), "prisma/migrations/20261112180000_operational_responsibility/migration.sql"), "utf8");
  return new Response(sql, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="almox-etapa-3.sql"' } });
});
