import { timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only the owning local desktop process can identify this server. No database access. */
export async function GET(request: Request) {
  const expected = process.env.ALMOX_DESKTOP_TOKEN;
  const supplied = request.headers.get('x-almox-desktop-token') || '';
  const valid = expected && /^[a-f0-9]{64}$/.test(expected) && /^[a-f0-9]{64}$/.test(supplied) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  return Response.json(valid ? { token: expected } : { error: 'Não encontrado.' }, {
    status: valid ? 200 : 404, headers: { 'Cache-Control': 'no-store' },
  });
}
