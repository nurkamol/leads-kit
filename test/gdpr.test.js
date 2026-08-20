import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleErasure, handleSubjectAccess, sweepExpired } from '../dist/src/handlers/gdpr.js';
import { readAudit } from '../dist/src/handlers/audit.js';
import { authed, lead, seeded } from './fake-store.js';

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const ctxFor = (store) => ({ store, token: 'secret' });

const three = () =>
  seeded(
    lead({ id: id(1), receivedAt: '2026-01-01T00:00:00.000Z', email: 'ann@example.com' }),
    lead({ id: id(2), receivedAt: '2026-02-01T00:00:00.000Z', email: 'bob@example.com' }),
    lead({ id: id(3), receivedAt: '2026-03-01T00:00:00.000Z', email: 'ANN@example.com' }),
  );

test('subject access returns every record for that person, case-insensitively', async () => {
  const store = three();
  const res = await handleSubjectAccess(authed('https://x/api/leads/subject?email=Ann@Example.com'), ctxFor(store));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, 2);
  assert.deepEqual(body.leads.map((l) => l.id), [id(1), id(3)]);
});

test('subject access is itself logged — "who looked this up" is a real question', async () => {
  const store = three();
  await handleSubjectAccess(authed('https://x/api/leads/subject?email=ann@example.com'), ctxFor(store));
  const [entry] = await readAudit(ctxFor(store));
  assert.equal(entry.action, 'subject-access');
  assert.equal(entry.matched, 2);
  assert.equal(entry.subjectEmailDomain, 'example.com');
  assert.ok(!JSON.stringify(entry).includes('ann@example.com'), 'domain only');
});

test('erasure refuses GET and refuses without confirmation', async () => {
  const store = three();
  assert.equal((await handleErasure(new Request('https://x/e'), ctxFor(store))).status, 405);

  const noConfirm = await handleErasure(
    authed('https://x/e', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ann@example.com' }),
    }),
    ctxFor(store),
  );
  assert.equal(noConfirm.status, 400);
  assert.equal([...store.data.keys()].filter((k) => k.startsWith('lead:')).length, 3);
});

test('erasure removes every record for that address and nobody else', async () => {
  const store = three();
  const res = await handleErasure(
    authed('https://x/e', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ann@example.com', confirm: 'ann@example.com' }),
    }),
    ctxFor(store),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).erased, 2);

  const remaining = [...store.data.keys()].filter((k) => k.startsWith('lead:'));
  assert.equal(remaining.length, 1);
  assert.ok(remaining[0].includes(id(2)), 'bob untouched');

  const [entry] = await readAudit(ctxFor(store));
  assert.equal(entry.action, 'erase-subject');
  assert.equal(entry.erased, 2);
  assert.ok(!JSON.stringify(entry).includes('ann@example.com'));
});

test('a mismatched confirmation erases nothing', async () => {
  const store = three();
  const res = await handleErasure(
    authed('https://x/e', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ann@example.com', confirm: 'anne@example.com' }),
    }),
    ctxFor(store),
  );
  assert.equal(res.status, 400);
  assert.equal([...store.data.keys()].filter((k) => k.startsWith('lead:')).length, 3);
});

test('sweep dry run touches nothing', async () => {
  const store = seeded(
    lead({ id: id(1), receivedAt: new Date(Date.now() - 400 * 864e5).toISOString() }),
    lead({ id: id(2), receivedAt: new Date().toISOString() }),
  );
  const result = await sweepExpired(ctxFor(store), 365, { dryRun: true });
  assert.equal(result.matched, 1);
  assert.equal(result.deleted, 0);
  assert.equal([...store.data.keys()].length, 2, 'a dry run that writes an audit record is not dry');
});

test('sweep deletes only what is past the cutoff', async () => {
  const old = lead({ id: id(1), receivedAt: new Date(Date.now() - 400 * 864e5).toISOString() });
  const fresh = lead({ id: id(2), receivedAt: new Date().toISOString() });
  const store = seeded(old, fresh);
  const result = await sweepExpired(ctxFor(store), 365);
  assert.equal(result.deleted, 1);
  const leads = [...store.data.keys()].filter((k) => k.startsWith('lead:'));
  assert.equal(leads.length, 1);
  assert.ok(leads[0].includes(id(2)));
});

test('a nonsense retention period throws rather than deleting everything', async () => {
  // retentionDays = 0 would put the cutoff at "now" and take the lot.
  const store = seeded(lead());
  for (const bad of [0, -1, NaN, Infinity]) {
    await assert.rejects(() => sweepExpired(ctxFor(store), bad));
  }
  assert.equal([...store.data.keys()].length, 1);
});

test('audit is newest first, and a limit reads the newest', async () => {
  const store = seeded(lead({ id: id(1) }), lead({ id: id(2), receivedAt: '2026-02-01T00:00:00.000Z' }));
  const ctx = ctxFor(store);
  await handleSubjectAccess(authed('https://x/s?email=a@b.com'), ctx);
  await handleSubjectAccess(authed('https://x/s?email=c@d.com'), ctx);
  const all = await readAudit(ctx);
  assert.equal(all.length, 2);
  assert.ok(all[0].at >= all[1].at, 'newest first');
  assert.equal((await readAudit(ctx, { limit: 1 }))[0].at, all[0].at, 'limit keeps the newest');
});
