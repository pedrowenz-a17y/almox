import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../src/app/api/desktop-health/route';
import { supabasePublicConfig } from '../src/lib/auth-config';

test('sonda desktop só identifica instância com token correto, sem acessar banco', async () => {
  const previous = process.env.ALMOX_DESKTOP_TOKEN;
  try {
    delete process.env.ALMOX_DESKTOP_TOKEN;
    assert.equal((await GET(new Request('http://127.0.0.1/api/desktop-health'))).status, 404);
    process.env.ALMOX_DESKTOP_TOKEN = 'a'.repeat(64);
    for (const value of ['', 'b'.repeat(64), 'é'.repeat(64)]) {
      const response = await GET(new Request('http://127.0.0.1/api/desktop-health', { headers: { 'x-almox-desktop-token': value } }));
      assert.equal(response.status, 404);
      assert.ok(!(await response.text()).includes(process.env.ALMOX_DESKTOP_TOKEN));
    }
    const response = await GET(new Request('http://127.0.0.1/api/desktop-health', { headers: { 'x-almox-desktop-token': 'a'.repeat(64) } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { token: 'a'.repeat(64) });
  } finally { if (previous === undefined) delete process.env.ALMOX_DESKTOP_TOKEN; else process.env.ALMOX_DESKTOP_TOKEN = previous; }
});
test('configuração pública do servidor pode mudar depois da compilação', () => {
  const before = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://first.example.invalid';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_first_fixture';
    assert.equal(supabasePublicConfig().url, 'https://first.example.invalid');
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://second.example.invalid';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_second_fixture';
    assert.equal(supabasePublicConfig().url, 'https://second.example.invalid');
    assert.equal(supabasePublicConfig().key, 'sb_publishable_second_fixture');
  } finally {
    if (before.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = before.url;
    if (before.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = before.key;
  }
});
