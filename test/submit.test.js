import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSubmit } from '../dist/src/write/submit.js';
import { validate, DEFAULT_SCHEMA } from '../dist/src/write/validate.js';
import { checkRateLimit } from '../dist/src/write/ratelimit.js';
import { fakeStore } from './fake-store.js';

const REDIRECTS = { success: '/?sent=1#contact', invalid: '/?invalid=', honeypot: '/#contact' };

const post = (body, init = {}) => {
  // Spread `init` FIRST, then set headers from the merge. The other way round
  // re-applies init.headers over the merged object, dropping content-type —
  // the JSON body is then parsed as form data and every such test 400s,
  // which looks exactly like a handler bug.
  const { headers, ...rest } = init;
  return new Request('https://site.test/api/contact', {
    method: 'POST',
    ...rest,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  });
};

const good = { name: 'Ann Jones', email: 'ann@example.com', message: 'hello there' };
const leadKeys = (store) => [...store.data.keys()].filter((k) => k.startsWith('lead:'));

test('a good submission is stored', async () => {
  const store = fakeStore();
  const res = await handleSubmit(post(good), { store });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.stored, true);
  assert.equal(leadKeys(store).length, 1);
});

test('GET is refused', async () => {
  const res = await handleSubmit(new Request('https://site.test/api/contact'), { store: fakeStore() });
  assert.equal(res.status, 405);
});

/* ── ORDERING ─────────────────────────────────────────────────────────────
   Each of these passes trivially if you only check status codes. They exist
   because the bug they catch is a reordering, and a reordered version returns
   exactly the same statuses. */

test('cross-origin is refused BEFORE the body is even read', async () => {
  const store = fakeStore();
  const res = await handleSubmit(
    post(good, { headers: { origin: 'https://evil.test' } }),
    { store },
  );
  assert.equal(res.status, 403);
  assert.equal(leadKeys(store).length, 0);
});

test('cross-origin with a MALFORMED body is still 403, not 400', async () => {
  // This is the actual ordering assertion. If the refusal runs after parsing
  // or validation, a bad body short-circuits to 400 and the cross-origin check
  // only ever fires on requests that were being rejected anyway.
  const store = fakeStore();
  const res = await handleSubmit(
    new Request('https://site.test/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
      body: 'not json at all',
    }),
    { store },
  );
  assert.equal(res.status, 403, 'a cross-origin refusal must not depend on the body parsing');
});

test('an absent Origin is allowed — the no-JS path depends on it', async () => {
  const res = await handleSubmit(post(good), { store: fakeStore() });
  assert.equal(res.status, 200);
});

test('the honeypot never reaches Turnstile', async () => {
  // Free and local first: no network round trip on a request already known to
  // be a bot. A fetch here would be a real (billable, slow) mistake.
  let siteverifyCalled = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { siteverifyCalled = true; return realFetch('https://example.com'); };
  try {
    const store = fakeStore();
    const res = await handleSubmit(post({ ...good, company: 'ACME' }), { store }, {
      turnstile: { secret: 'x' },
    });
    assert.equal(res.status, 200, 'accepted silently — telling a bot it was caught teaches it');
    assert.equal(leadKeys(store).length, 0, 'and stored nothing');
    assert.equal(siteverifyCalled, false, 'and spent no network call');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('caught spam does NOT land on the success URL', async () => {
  // The success URL is the conversion. Sending caught spam there lets any bot
  // that runs JS inflate the only conversion the site owns, in a shape that
  // looks like the site performing unusually well.
  const res = await handleSubmit(
    post({ ...good, company: 'ACME' }, { headers: { accept: 'text/html' } }),
    { store: fakeStore() },
    { redirects: REDIRECTS },
  );
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), REDIRECTS.honeypot);
  assert.notEqual(res.headers.get('location'), REDIRECTS.success);
});

/* ── TURNSTILE ─────────────────────────────────────────────────────────── */

const withSiteverify = async (reply, fn) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => reply();
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
};

test('a bad token is refused', async () => {
  const store = fakeStore();
  const res = await withSiteverify(
    () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] })),
    () => handleSubmit(post({ ...good, 'cf-turnstile-response': 'bogus' }), { store },
      { turnstile: { secret: 'x' } }),
  );
  assert.equal(res.status, 422);
  assert.equal(leadKeys(store).length, 0);
});

test('an OUTAGE stores the lead and flags it — it must not cost an enquiry', async () => {
  for (const reply of [
    () => { throw new Error('network down'); },
    () => new Response('bad gateway', { status: 502 }),
    () => new Response(JSON.stringify({ success: false, 'error-codes': ['internal-error'] })),
  ]) {
    const store = fakeStore();
    const res = await withSiteverify(reply, () =>
      handleSubmit(post({ ...good, 'cf-turnstile-response': 'tok' }), { store },
        { turnstile: { secret: 'x' } }),
    );
    assert.equal(res.status, 200);
    const saved = JSON.parse(store.data.get(leadKeys(store)[0]));
    assert.equal(saved.verification, 'unavailable',
      'stored, and visibly different from one that passed a real challenge');
  }
});

test('internal-error is an outage, not a verdict', async () => {
  // It arrives wearing a 200 with success:false, which is exactly the shape of
  // a real rejection. Treating it as one refuses real people during a
  // Cloudflare incident.
  const store = fakeStore();
  await withSiteverify(
    () => new Response(JSON.stringify({ success: false, 'error-codes': ['internal-error'] })),
    () => handleSubmit(post({ ...good, 'cf-turnstile-response': 'tok' }), { store },
      { turnstile: { secret: 'x' } }),
  );
  assert.equal(leadKeys(store).length, 1);
});

test('no token: default accepts and flags, acceptWithoutToken:false refuses', async () => {
  const store = fakeStore();
  const lenient = await handleSubmit(post(good), { store }, { turnstile: { secret: 'x' } });
  assert.equal(lenient.status, 200);
  assert.equal(JSON.parse(store.data.get(leadKeys(store)[0])).verification, 'unverified');

  const strict = await handleSubmit(post(good), { store: fakeStore() }, {
    turnstile: { secret: 'x', acceptWithoutToken: false },
  });
  assert.equal(strict.status, 422);
});

/* ── DURABILITY ────────────────────────────────────────────────────────── */

test('the store write happens BEFORE the notifier', async () => {
  const order = [];
  const store = fakeStore();
  const wrapped = { ...store, put: async (k, v, o) => { order.push('store'); return store.put(k, v, o); } };
  await handleSubmit(post(good), { store: wrapped }, {
    notify: async () => { order.push('notify'); },
  });
  assert.deepEqual(order, ['store', 'notify'],
    'a provider outage must cost a notification, not a lead');
});

test('a throwing notifier does not lose the lead', async () => {
  const store = fakeStore();
  const res = await handleSubmit(post(good), { store }, {
    notify: async () => { throw new Error('provider down'); },
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).notified, false);
  assert.equal(leadKeys(store).length, 1, 'still stored');
});

test('a failing store still tries to notify', async () => {
  let notified = false;
  const store = { ...fakeStore(), put: async () => { throw new Error('kv down'); } };
  const res = await handleSubmit(post(good), { store }, { notify: async () => { notified = true; } });
  assert.equal(res.status, 200, 'an email in an inbox beats losing the enquiry');
  assert.equal(notified, true);
});

test('when BOTH fail the visitor is told, not thanked', async () => {
  const store = { ...fakeStore(), put: async () => { throw new Error('kv down'); } };
  const res = await handleSubmit(post(good), { store }, {
    notify: async () => { throw new Error('provider down'); },
  });
  assert.equal(res.status, 503, 'a cheerful thanks over a lost message is the worst outcome here');
});

test('retention is applied to the write', async () => {
  let ttl;
  const store = { ...fakeStore(), put: async (_k, _v, o) => { ttl = o?.expirationTtl; } };
  await handleSubmit(post(good), { store }, { retentionSeconds: 365 * 24 * 3600 });
  assert.equal(ttl, 31536000, 'without a TTL, KV keeps a lead forever');
});

/* ── VALIDATION ────────────────────────────────────────────────────────── */

test('phone validation is not a US rule', async () => {
  // A 10-digit rule silently rejects every UK, Irish and Australian visitor
  // with an error they cannot act on, because their number IS correct.
  for (const number of ['+44 20 7946 0958', '+353 1 234 5678', '+61 2 9374 4000', '+998 90 123 45 67']) {
    assert.equal(validate({ ...good, phone: number }, DEFAULT_SCHEMA).ok, true, number);
  }
  assert.equal(validate({ ...good, phone: '12345' }).ok, false, 'too short is still rejected');
});

test('an optional empty field does not produce an error about itself', () => {
  const r = validate({ name: 'Ann Jones', email: 'a@b.com' }, DEFAULT_SCHEMA);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
});

test('a select value not in the list is rejected, not silently defaulted', () => {
  const schema = { ...DEFAULT_SCHEMA, budget: { oneOf: ['Under $2k', '$2k+'] } };
  const r = validate({ ...good, budget: 'anything I like' }, schema);
  assert.equal(r.ok, false);
  assert.ok(r.errors.budget, 'recording a guess is worse than saying no');
});

test('invalid form POST redirects with the failing field names', async () => {
  const res = await handleSubmit(
    post({ name: 'A', email: 'nope' }, { headers: { accept: 'text/html' } }),
    { store: fakeStore() },
    { redirects: REDIRECTS },
  );
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /invalid=/);
  assert.match(decodeURIComponent(res.headers.get('location')), /name/);
  assert.match(decodeURIComponent(res.headers.get('location')), /email/);
});

/* ── RATE LIMIT ────────────────────────────────────────────────────────── */

test('rate limit blocks after the limit and reports a retry', async () => {
  const store = fakeStore();
  for (let i = 0; i < 3; i++) {
    const r = await checkRateLimit(store, '1.2.3.4', { limit: 3, windowSeconds: 60 });
    assert.equal(r.allowed, true, `attempt ${i + 1}`);
  }
  const blocked = await checkRateLimit(store, '1.2.3.4', { limit: 3, windowSeconds: 60 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter > 0);
});

test('rate limit is per identifier', async () => {
  const store = fakeStore();
  for (let i = 0; i < 3; i++) await checkRateLimit(store, 'a', { limit: 3, windowSeconds: 60 });
  assert.equal((await checkRateLimit(store, 'b', { limit: 3, windowSeconds: 60 })).allowed, true);
});

test('no identifier means allow, never a shared bucket', async () => {
  // Falling back to a header would give an attacker a fresh bucket per request
  // while the limit still looks present in the code.
  const store = fakeStore();
  for (let i = 0; i < 20; i++) {
    assert.equal((await checkRateLimit(store, '', { limit: 3 })).allowed, true);
  }
});

test('rate limit fails OPEN when the store is unreachable', async () => {
  const broken = { ...fakeStore(), get: async () => { throw new Error('kv down'); } };
  assert.equal((await checkRateLimit(broken, '1.2.3.4', { limit: 1 })).allowed, true,
    'a storage blip must not be indistinguishable from abuse');
});

test('submit returns 429 once the limit is hit', async () => {
  const store = fakeStore();
  const opts = { rateLimit: { limit: 2, windowSeconds: 60 }, clientAddress: '9.9.9.9' };
  assert.equal((await handleSubmit(post(good), { store }, opts)).status, 200);
  assert.equal((await handleSubmit(post(good), { store }, opts)).status, 200);
  assert.equal((await handleSubmit(post(good), { store }, opts)).status, 429);
});

test('the invalid redirect can be a function, so an anchor survives', async () => {
  // A string form gives /?invalid=name,email — which lands at the top of the
  // page with the form and its error state below the fold, so the visitor sees
  // something that looks like it merely scrolled rather than an error.
  const res = await handleSubmit(
    post({ name: 'A', email: 'nope' }, { headers: { accept: 'text/html' } }),
    { store: fakeStore() },
    {
      redirects: {
        ...REDIRECTS,
        invalid: (fields) => `/?invalid=${encodeURIComponent(fields.join(','))}#contact`,
      },
    },
  );
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /#contact$/);
  assert.match(decodeURIComponent(res.headers.get('location')), /name,email/);
});

test('a failed challenge also honours the function form', async () => {
  const res = await withSiteverify(
    () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] })),
    () => handleSubmit(
      post({ ...good, 'cf-turnstile-response': 'bogus' }, { headers: { accept: 'text/html' } }),
      { store: fakeStore() },
      { turnstile: { secret: 'x' }, redirects: { ...REDIRECTS, invalid: (f) => `/?invalid=${f[0]}#contact` } },
    ),
  );
  assert.equal(res.headers.get('location'), '/?invalid=challenge#contact');
});
