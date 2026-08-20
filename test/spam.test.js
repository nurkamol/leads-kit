import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicate, messageFingerprint, scoreSpam } from '../dist/src/write/spam.js';
import { handleSubmit } from '../dist/src/write/submit.js';
import { fakeStore } from './fake-store.js';

const codes = (input, opts) => scoreSpam(input, opts).signals.map((s) => s.code).sort();
const score = (input, opts) => scoreSpam(input, opts).score;

/* ── THE FALSE-POSITIVE CASES ───────────────────────────────────────────────
   These matter more than the detections. Every signal has a real customer who
   trips it, and the cost of refusing a client is that you never find out. */

test('a normal enquiry scores nothing', () => {
  assert.equal(score({
    name: 'Ann Jones',
    message: 'Hi — we need a new site for our dental clinic, roughly 8 pages. What would that cost?',
  }), 0);
});

test('a developer pasting two links is not spam', () => {
  const s = score({
    name: 'Ann Jones',
    message: 'Our staging is at https://staging.example.com and the old site is https://old.example.com — can you compare them?',
  });
  assert.ok(s <= 1, `two links must stay low, got ${s}`);
});

test('a short real message is not condemned for being short', () => {
  assert.ok(score({ name: 'Ann Jones', message: 'Can you help?' }) <= 1);
});

test('a non-English enquiry is not penalised', () => {
  assert.equal(score({
    name: 'Гулнора Каримова',
    message: 'Салом! Бизга веб-сайт керак. Илтимос, нархларингизни юборинг ва қачон бошлашимиз мумкинлигини айтинг.',
  }), 0, 'a whole message in another script is a customer, not a signal');
});

test('elapsed time only counts when the form actually reports it', () => {
  // Inferring it would penalise anyone whose browser or extension behaves oddly.
  assert.ok(!codes({ message: 'Hello there, we would like a quote please.' }).includes('too-fast'));
  assert.ok(codes({ message: 'Hello there, we would like a quote please.' }, { elapsedMs: 400 }).includes('too-fast'));
  assert.ok(!codes({ message: 'Hello there, we would like a quote please.' }, { elapsedMs: 30000 }).includes('too-fast'));
});

/* ── THE DETECTIONS ─────────────────────────────────────────────────────── */

test('an advertisement scores high', () => {
  const s = scoreSpam({
    name: 'SEO EXPERT',
    message: 'BUY BACKLINKS NOW! GUEST POST SERVICE! http://a.tld http://b.tld http://c.tld http://d.tld http://e.tld GET ON THE FIRST PAGE OF GOOGLE!',
  });
  assert.ok(s.score >= 6, `expected 6+, got ${s.score} (${s.signals.map((x) => x.code)})`);
  assert.ok(s.signals.some((x) => x.code === 'links'));
  assert.ok(s.signals.some((x) => x.code === 'phrases'));
  assert.ok(s.signals.some((x) => x.code === 'shouting'));
});

test('a wall of unbroken text is flagged', () => {
  assert.ok(codes({ message: 'a'.repeat(80) }).includes('unbroken'));
});

test('signals carry a readable detail, not just a code', () => {
  const s = scoreSpam({ message: 'link building https://a.tld https://b.tld' });
  for (const sig of s.signals) assert.ok(sig.detail && sig.detail.length > 3, sig.code);
});

/* ── DUPLICATES ─────────────────────────────────────────────────────────── */

const long = 'We are looking for a developer to rebuild our booking system before the spring.';

test('the same message twice is a duplicate the second time', async () => {
  const store = fakeStore();
  assert.equal((await findDuplicate(store, long)).isDuplicate, false);
  const second = await findDuplicate(store, long);
  assert.equal(second.isDuplicate, true);
  assert.ok(second.firstSeen);
});

test('whitespace and case do not defeat it', async () => {
  const store = fakeStore();
  await findDuplicate(store, long);
  assert.equal((await findDuplicate(store, `  ${long.toUpperCase()}\n\n `)).isDuplicate, true);
});

test('SHORT messages are exempt — two customers write the same sentence', async () => {
  // "Hi, can you help with a website?" is not a duplicate, it is a question.
  const store = fakeStore();
  await findDuplicate(store, 'Can you help with a website?');
  assert.equal((await findDuplicate(store, 'Can you help with a website?')).isDuplicate, false);
});

test('an unreachable store answers "not a duplicate"', async () => {
  const broken = { ...fakeStore(), get: async () => { throw new Error('kv down'); } };
  assert.equal((await findDuplicate(broken, long)).isDuplicate, false,
    'a storage blip must never look like abuse');
});

test('the fingerprint is stable and short', async () => {
  const a = await messageFingerprint(long);
  assert.equal(a, await messageFingerprint(long));
  assert.equal(a.length, 24);
});

/* ── AND IT NEVER BLOCKS ────────────────────────────────────────────────── */

const post = (body) => new Request('https://site.test/api/contact', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const leadKeys = (s) => [...s.data.keys()].filter((k) => k.startsWith('lead:'));

test('the worst possible submission is still stored', async () => {
  const store = fakeStore();
  const res = await handleSubmit(post({
    name: 'SEO EXPERT', email: 'spam@spam.test',
    message: 'BUY BACKLINKS! GUEST POST! http://a.tld http://b.tld http://c.tld http://d.tld http://e.tld',
  }), { store }, { spam: { elapsedMs: 20 } });

  assert.equal(res.status, 200, 'scoring must never refuse a submission');
  const saved = JSON.parse(store.data.get(leadKeys(store)[0]));
  assert.ok(saved.spamScore >= 6, `scored ${saved.spamScore}`);
  assert.ok(saved.spamSignals.includes('links'));
});

test('autoSpamAt files it, it does not discard it', async () => {
  const store = fakeStore();
  await handleSubmit(post({
    name: 'SEO EXPERT', email: 'spam@spam.test',
    message: 'BUY BACKLINKS! GUEST POST! http://a.tld http://b.tld http://c.tld http://d.tld http://e.tld',
  }), { store }, { spam: { autoSpamAt: 5 } });

  const saved = JSON.parse(store.data.get(leadKeys(store)[0]));
  assert.equal(saved.status, 'spam');
  assert.equal(saved.statusBy, 'spam-score');
  assert.equal(leadKeys(store).length, 1, 'stored, exported and readable — just filed elsewhere');
});

test('a clean lead below the threshold stays new', async () => {
  const store = fakeStore();
  await handleSubmit(post({
    name: 'Ann Jones', email: 'ann@example.com',
    message: 'Hi — we need a new site for our clinic. What would that cost?',
  }), { store }, { spam: { autoSpamAt: 5 } });
  const saved = JSON.parse(store.data.get(leadKeys(store)[0]));
  assert.ok(!saved.status || saved.status === 'new');
  assert.equal(saved.spamScore, 0);
});

test('spam:false skips the work entirely', async () => {
  const store = fakeStore();
  await handleSubmit(post({ name: 'Ann Jones', email: 'a@b.com', message: 'hello there' }), { store }, { spam: false });
  const saved = JSON.parse(store.data.get(leadKeys(store)[0]));
  assert.ok(!('spamScore' in saved));
});
