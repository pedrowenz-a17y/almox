import { destroySession } from '@/lib/auth';
import { api, json } from '@/lib/http';
export const POST = api(async () => { await destroySession(); return json({ ok: true }); });
