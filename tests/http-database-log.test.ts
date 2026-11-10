import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { api } from '../src/lib/http';

test('HTTP logs preserve database codes without provider messages, SQL or metadata', async () => {
  const original = console.error;
  const logs: unknown[][] = [];
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    for (const code of ['P2021', 'P2022', 'not-a-safe-code']) {
      const error = new Prisma.PrismaClientKnownRequestError('PRIVATE_PROVIDER_DETAIL', {
        code, clientVersion: '6.19.3', meta: { query: 'PRIVATE_SQL', password: 'PRIVATE_PASSWORD' },
      });
      const handler = api(async () => { throw error; });
      const response = await handler(new NextRequest('https://test.example.invalid/api/test'), { params: Promise.resolve({}) });
      assert.equal(response.status, 500);
      assert.deepEqual(logs.at(-1), ['API request failed', {
        type: 'database', ...(/^P\d{4}$/.test(code) ? { code } : {}),
      }]);
      assert.doesNotMatch(JSON.stringify(logs) + await response.text(), /PRIVATE_/);
    }
  } finally { console.error = original; }
});
