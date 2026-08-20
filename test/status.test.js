import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleStatus, remainingTtl, setLeadStatus, statusOf } from '../dist/src/handlers/status.js';
import { summarise } from '../dist/src/handlers/stats.js';
import { readLeads } from '../dist/src/handlers/keys.js';
import { readAudit } from '../dist/src/handlers/audit.js';
import { authed, lead, seeded } from './fake-store.js';

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const YEAR = 365 * 24 * 3600;
const ctxFor = (store, extra = {}) => ({ store, token: 'secret', retentionSeconds: YEAR, ...extra });

test('a record with no status counts as new', () => {
  assert.equal(statusOf(lead()), 'new');
  assert.equal(statusOf(lead({ status: 'replied' })), 'replied');
  assert.equal(statusOf(lead({ status: 'nonsense' })), 'new', 'a bogus value must not become a status');
});

/* ── THE TTL TRAP ───────────────────────────────────────────────────────────
   KV cannot update a value while keeping its remaining expiry, so a careless
   rewrite silently extends retention past what the privacy notice promises.
   These are the tests that catch it, because nothing else would: the record
   simply does not expire, and no error is ever raised. */

test('remainingTtl counts down from receivedAt, it does not restart', () => {
  const now = Date.parse('2027-01-01T00:00:00Z');
  const old = { receivedAt: '2026-06-01T00:00:00Z' };   // ~214 days ago
  const left = remainingTtl(old, YEAR, now);
  assert.ok(left < YEAR, 'a rewrite must not grant a fresh year');
  assert.ok(Math.abs(left - (YEAR - 214 * 24 * 3600)) < 2 * 24 * 3600, `got ${left}`);
});

test('remainingTtl is 0 once the period has elapsed', () => {
  const now = Date.parse('2027-01-01T00:00:00Z');
  assert.equal(remainingTtl({ receivedAt: '2025-01-01T00:00:00Z' }, YEAR, now), 0);
});

test('no retention configured means no TTL, not a zero one', () => {
  assert.equal(remainingTtl({ receivedAt: '2026-01-01T00:00:00Z' }, undefined), undefined);
});

test('a status change writes back with the REMAINING ttl', async () => {
  const received = new Date(Date.now() - 300 * 24 * 3600 * 1000).toISOString();
  const store = seeded(lead({ id: id(1), receivedAt: received }));
  let seenTtl = 'not-called';
  const wrapped = { ...store, put: async (k, v, o) => { if (k.startsWith('lead:')) seenTtl = o?.expirationTtl; return store.put(k, v, o); } };

  const r = await setLeadStatus(ctxFor(wrapped), id(1), 'replied', 'me@example.com');
  assert.equal(r.ok, true);
  assert.ok(seenTtl < YEAR, `expected less than a year, got ${seenTtl}`);
  assert.ok(seenTtl > 60 * 24 * 3600, `expected roughly 65 days left, got ${seenTtl}`);
});

test('a lead past its retention is not resurrected by a status change', async () => {
  const received = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();
  const store = seeded(lead({ id: id(1), receivedAt: received }));
  const r = await setLeadStatus(ctxFor(store), id(1), 'replied', 'me@example.com');
  assert.equal(r.ok, false);
  assert.match(r.reason, /retention/);
});

/* ── BEHAVIOUR ─────────────────────────────────────────────────────────── */

test('setting a status records it, and audits the transition', async () => {
  const store = seeded(lead({ id: id(1) }));
  const ctx = ctxFor(store);
  const r = await setLeadStatus(ctx, id(1), 'replied', 'me@example.com');
  assert.deepEqual({ ok: r.ok, from: r.from, to: r.to }, { ok: true, from: 'new', to: 'replied' });

  const [saved] = await readLeads(store, 'lead:');
  assert.equal(saved.status, 'replied');
  assert.equal(saved.statusBy, 'me@example.com');
  assert.ok(saved.statusAt);
  assert.equal(saved.email, lead().email, 'the rest of the record survives the rewrite');

  const [entry] = await readAudit(ctx);
  assert.equal(entry.action, 'set-status');
  assert.equal(entry.from, 'new');
  assert.equal(entry.to, 'replied');
});

test('setting the same status again is a no-op, not a rewrite', async () => {
  const store = seeded(lead({ id: id(1), status: 'replied' }));
  let writes = 0;
  const wrapped = { ...store, put: async (...a) => { writes++; return store.put(...a); } };
  const r = await setLeadStatus(ctxFor(wrapped), id(1), 'replied', 'me@example.com');
  assert.equal(r.reason, 'unchanged');
  assert.equal(writes, 0, 'an unchanged status must not touch the TTL or the audit log');
});

test('the endpoint refuses GET, bad ids and bogus statuses', async () => {
  const store = seeded(lead({ id: id(1) }));
  const ctx = ctxFor(store);
  assert.equal((await handleStatus(new Request('https://x/s'), ctx)).status, 405);

  const send = (body) => handleStatus(
    authed('https://x/s', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    ctx,
  );
  assert.equal((await send({ id: 'nope', status: 'replied' })).status, 400);
  assert.equal((await send({ id: id(1), status: 'deleted' })).status, 400);
  assert.equal((await send({ id: id(1), status: 'replied' })).status, 200);
});

test('the endpoint requires auth', async () => {
  const res = await handleStatus(
    new Request('https://x/s', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id(1), status: 'spam' }) }),
    ctxFor(seeded(lead({ id: id(1) }))),
  );
  assert.equal(res.status, 401);
});

/* ── FILTERING AND SUMMARY ─────────────────────────────────────────────── */

test('filtering by status treats absent as new', async () => {
  const store = seeded(
    lead({ id: id(1) }),                        // no status at all
    lead({ id: id(2), receivedAt: '2026-02-01T00:00:00.000Z', status: 'replied' }),
    lead({ id: id(3), receivedAt: '2026-03-01T00:00:00.000Z', status: 'spam' }),
  );
  const ids = async (status) => (await readLeads(store, 'lead:', { status })).map((l) => l.id);
  assert.deepEqual(await ids('new'), [id(1)], 'a record predating statuses must not vanish');
  assert.deepEqual(await ids('replied'), [id(2)]);
  assert.deepEqual(await ids(['new', 'spam']), [id(1), id(3)]);
});

test('summarise reports what still needs an answer', () => {
  const rows = [
    lead({ id: id(1) }),
    lead({ id: id(2), status: 'replied' }),
    lead({ id: id(3), status: 'spam' }),
    lead({ id: id(4), status: 'archived' }),
  ];
  const s = summarise(rows, Date.parse('2026-01-02T00:00:00Z'));
  assert.equal(s.total, 4);
  assert.equal(s.unanswered, 1, '"3 unanswered" is the number worth showing, not "12 total"');
  assert.deepEqual(s.byStatus, { new: 1, replied: 1, archived: 1, spam: 1 });
});
