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

test('an unbound store is a 503 from every adapter, not a crash', async () => {
  // leadsContext() returns null when the KV binding is missing. Before this,
  // every route had to write `!` or the same four-line guard — and `!` on a
  // value that is genuinely sometimes null turns a missing binding into a
  // stack trace about `undefined` instead of the one message that says what
  // to fix.
  const { astroExport, astroDelete, astroStatus, astroLeadsPage } = await import('../dist/src/adapters/astro.js');
  const { nextExport, nextLeadsPage } = await import('../dist/src/adapters/next.js');

  const req = () => new Request('https://x.test/api/leads.csv', { headers: { authorization: 'Bearer s' } });
  const nothing = () => null;

  for (const [name, res] of [
    ['astroExport', await astroExport(nothing)({ request: req() })],
    ['astroLeadsPage', await astroLeadsPage(nothing)({ request: req() })],
    ['astroDelete', await astroDelete(nothing)({ request: new Request('https://x/d', { method: 'POST' }) })],
    ['astroStatus', await astroStatus(nothing)({ request: new Request('https://x/s', { method: 'POST' }) })],
    ['nextExport', await nextExport(nothing)(req())],
    ['nextLeadsPage', await nextLeadsPage(nothing)(req())],
  ]) {
    assert.equal(res.status, 503, name);
    assert.match(await res.text(), /not bound/, name);
  }
});

test('a bound store still works through the same path', async () => {
  const { astroExport } = await import('../dist/src/adapters/astro.js');
  const res = await astroExport(() => ({ store, token: 'secret' }), { format: 'csv' })({
    request: new Request('https://x.test/api/leads.csv', { headers: { authorization: 'Bearer secret' } }),
  });
  assert.equal(res.status, 200);
});
