/**
 * An in-memory LeadStore.
 *
 * Sorts keys on list(), because KV's lexicographic ordering is not incidental
 * to this package — the key format exists to make that ordering chronological,
 * and a fake that returned insertion order would let an ordering bug pass.
 */
export function fakeStore(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    async list(prefix, opts) {
      return [...data.keys()]
        .filter((k) => k.startsWith(prefix))
        .filter((k) => !opts?.startAfter || k >= opts.startAfter)
        .filter((k) => !opts?.endBefore || k < opts.endBefore)
        .sort();
    },
    async get(key) {
      const raw = data.get(key);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async put(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

export const lead = (over = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  receivedAt: '2026-01-01T00:00:00.000Z',
  name: 'Ann Jones',
  email: 'ann@example.com',
  phone: '',
  service: 'Website',
  budget: '',
  timeline: '',
  message: 'hello',
  page: '/',
  country: 'UZ',
  verification: 'passed',
  env: 'live',
  ...over,
});

export function seeded(...leads) {
  const seed = {};
  for (const l of leads) seed[`lead:${l.receivedAt}:${l.id}`] = JSON.stringify(l);
  return fakeStore(seed);
}

export const authed = (url, init = {}) =>
  new Request(url, { ...init, headers: { authorization: 'Bearer secret', ...(init.headers || {}) } });
