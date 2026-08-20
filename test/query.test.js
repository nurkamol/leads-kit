import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLeads, queryFromUrl } from '../dist/src/handlers/keys.js';
import { lead, seeded } from './fake-store.js';

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const store = () =>
  seeded(
    lead({ id: id(1), receivedAt: '2026-01-01T00:00:00.000Z', email: 'ann@example.com', message: 'website redesign' }),
    lead({ id: id(2), receivedAt: '2026-06-01T00:00:00.000Z', email: 'Bob@Example.com', message: 'seo audit' }),
    lead({ id: id(3), receivedAt: '2026-08-01T00:00:00.000Z', email: 'ann@example.com', message: 'follow up' }),
  );

test('no query returns everything, oldest first', async () => {
  const all = await readLeads(store(), 'lead:');
  assert.deepEqual(all.map((l) => l.id), [id(1), id(2), id(3)]);
});

test('since is inclusive, until is exclusive', async () => {
  assert.deepEqual(
    (await readLeads(store(), 'lead:', { since: '2026-06-01T00:00:00.000Z' })).map((l) => l.id),
    [id(2), id(3)],
  );
  assert.deepEqual(
    (await readLeads(store(), 'lead:', { until: '2026-06-01T00:00:00.000Z' })).map((l) => l.id),
    [id(1)],
  );
});

test('email match is case-insensitive — the one a DSAR depends on', async () => {
  assert.deepEqual(
    (await readLeads(store(), 'lead:', { email: 'BOB@example.COM' })).map((l) => l.id),
    [id(2)],
  );
});

test('q searches across fields', async () => {
  assert.deepEqual((await readLeads(store(), 'lead:', { q: 'SEO' })).map((l) => l.id), [id(2)]);
  assert.deepEqual((await readLeads(store(), 'lead:', { q: 'ann@' })).map((l) => l.id), [id(1), id(3)]);
});

test('limit stops the read rather than trimming the result', async () => {
  const s = store();
  let reads = 0;
  const counted = { ...s, get: async (k) => { reads++; return s.get(k); } };
  const got = await readLeads(counted, 'lead:', { limit: 1 });
  assert.equal(got.length, 1);
  assert.equal(reads, 1, 'a limit that fetches everything first has not saved anything');
});

test('a nonsense limit means no limit, not zero results', async () => {
  // ?limit=abc returning nothing looks exactly like an empty dataset.
  assert.equal(queryFromUrl(new URL('https://x/?limit=abc')).limit, undefined);
  assert.equal(queryFromUrl(new URL('https://x/?limit=-5')).limit, undefined);
  assert.equal(queryFromUrl(new URL('https://x/?limit=0')).limit, undefined);
  assert.equal(queryFromUrl(new URL('https://x/?limit=25')).limit, 25);
});
