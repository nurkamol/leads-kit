import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleDelete } from '../dist/src/handlers/delete.js';
import { handleExport } from '../dist/src/handlers/export.js';
import { readLeads, queryFromUrl } from '../dist/src/handlers/keys.js';
import { authed, lead, seeded } from './fake-store.js';

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const ctxFor = (store) => ({ store, token: 'secret' });

test('delete refuses GET', async () => {
  const store = seeded(lead());
  const res = await handleDelete(new Request('https://x/api/leads/delete'), ctxFor(store));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
  assert.equal(store.data.size, 1, 'nothing removed');
});

test('delete requires auth, and says nothing useful without it', async () => {
  const store = seeded(lead());
  const res = await handleDelete(
    new Request('https://x/api/leads/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: id(1) }),
    }),
    ctxFor(store),
  );
  assert.equal(res.status, 401);
  assert.equal(store.data.size, 1);
});

test('delete rejects anything that is not a lead id', async () => {
  const store = seeded(lead());
  for (const bad of ['lead:2026-01-01T00:00:00.000Z:x', '../../etc', '', 'audit:whatever', 1]) {
    const res = await handleDelete(
      authed('https://x/api/leads/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: bad }),
      }),
      ctxFor(store),
    );
    assert.equal(res.status, 400, `should refuse ${JSON.stringify(bad)}`);
  }
  assert.equal(store.data.size, 1, 'no key was touched by any of them');
});

test('delete removes the lead and writes an audit record first', async () => {
  const store = seeded(lead({ id: id(1) }), lead({ id: id(2), receivedAt: '2026-02-01T00:00:00.000Z' }));
  const res = await handleDelete(
    authed('https://x/api/leads/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: id(1) }),
    }),
    ctxFor(store),
  );
  assert.equal(res.status, 200);

  const keys = [...store.data.keys()];
  assert.equal(keys.filter((k) => k.startsWith('lead:')).length, 1, 'one lead left');
  assert.ok(!keys.some((k) => k.includes(id(1))), 'the right one went');

  const audit = JSON.parse(store.data.get(keys.find((k) => k.startsWith('audit:'))));
  assert.equal(audit.action, 'delete-lead');
  assert.equal(audit.leadId, id(1));
  assert.equal(audit.leadEmailDomain, 'example.com');
  assert.ok(!JSON.stringify(audit).includes('ann@example.com'),
    'the audit must not keep a second copy of the address it just erased');
});

test('deleting something already gone reports honestly', async () => {
  const store = seeded(lead({ id: id(1) }));
  const res = await handleDelete(
    authed('https://x/api/leads/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: id(9) }),
    }),
    ctxFor(store),
  );
  assert.equal(res.status, 404, 'a silent 200 makes a wrong-id bug look like success every time');
});

test('a form POST redirects, an API POST does not', async () => {
  const mk = (accept) =>
    handleDelete(
      authed('https://x/api/leads/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept },
        body: JSON.stringify({ id: id(1) }),
      }),
      ctxFor(seeded(lead({ id: id(1) }))),
      { redirectTo: '/leads/?deleted=1' },
    );
  const html = await mk('text/html');
  assert.equal(html.status, 303);
  assert.equal(html.headers.get('location'), '/leads/?deleted=1');
  const api = await mk('application/json');
  assert.equal(api.status, 200);
});

test('export never caches, and is never indexed', async () => {
  const res = await handleExport(authed('https://x/api/leads.csv'), ctxFor(seeded(lead())), { format: 'csv' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('export emits a real xlsx', async () => {
  const res = await handleExport(authed('https://x/api/leads.xlsx'), ctxFor(seeded(lead())), { format: 'xlsx' });
  assert.equal(res.status, 200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'ZIP magic number');
  assert.match(res.headers.get('content-disposition'), /\.xlsx"$/);
});

test('auth is checked before the format is validated', async () => {
  // Otherwise an unauthenticated caller enumerates supported formats by
  // watching which values 400 and which 401.
  const res = await handleExport(new Request('https://x/api/leads?format=nonsense'), ctxFor(seeded(lead())));
  assert.equal(res.status, 401);
});
