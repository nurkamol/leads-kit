import { test } from 'node:test';
import assert from 'node:assert/strict';
import { astroExport } from '../dist/src/adapters/astro.js';
import { nextExport } from '../dist/src/adapters/next.js';

const store = { list: async () => [], get: async () => null, put: async () => {}, delete: async () => {} };

/**
 * The bug this file exists for: on Astro + Cloudflare the bindings are at
 * locals.runtime.env and only exist per request, so a context built at module
 * scope cannot reach KV. 0.1.0 accepted only a plain object, and the README
 * example referenced `locals` at the top level where it is not defined — it
 * could never have run.
 */
test('astro adapter builds the context per request, from locals', async () => {
  let sawLocals = null;
  const GET = astroExport((c) => {
    sawLocals = c.locals;
    return { store, token: 'secret' };
  });
  const res = await GET({
    request: new Request('https://x.test/api/leads.csv', {
      headers: { authorization: 'Bearer secret' },
    }),
    locals: { runtime: { env: { LEADS: 'binding' } } },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(sawLocals, { runtime: { env: { LEADS: 'binding' } } });
});

test('a plain object still works', async () => {
  const GET = astroExport({ store, token: 'secret' });
  const res = await GET({
    request: new Request('https://x.test/api/leads.csv', {
      headers: { authorization: 'Bearer secret' },
    }),
  });
  assert.equal(res.status, 200);
});

test('the factory is called per request, not once', async () => {
  let calls = 0;
  const GET = nextExport(() => { calls++; return { store, token: 'secret' }; });
  const req = () => new Request('https://x.test/api/leads', { headers: { authorization: 'Bearer secret' } });
  await GET(req());
  await GET(req());
  assert.equal(calls, 2, 'a cached context would hold a stale binding from a previous request');
});
