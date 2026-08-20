import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runChecks } from '../dist/cli/doctor.js';

/**
 * Spin up a deliberately misconfigured site.
 *
 * A checker that only ever passes is worthless, and the only way to know it
 * would catch a real problem is to give it one. `handler` decides what each
 * path does; everything unmatched is a 404.
 */
async function withSite(handler, fn) {
  const server = createServer((req, res) => {
    const out = handler(req) ?? { status: 404, body: '', headers: {} };
    res.writeHead(out.status, { 'content-type': 'text/plain', ...(out.headers ?? {}) });
    res.end(out.body ?? '');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(origin); } finally { server.close(); }
}

const failures = (checks) => checks.filter((c) => c.level === 'fail').map((c) => c.name);
const levelOf = (checks, needle) => checks.find((c) => c.name.includes(needle))?.level;

test('catches an export route serving enquiries to anyone', async () => {
  const checks = await withSite(
    (req) => (req.url.startsWith('/api/leads') ? { status: 200, body: '[]' } : null),
    (origin) => runChecks({ origin }),
  );
  assert.ok(failures(checks).some((n) => n.includes('refuses anonymous')),
    'a 200 with no credentials is the worst outcome and must fail');
});

test('catches an export that a cache answered', async () => {
  const checks = await withSite(
    (req) => req.url === '/api/leads.csv'
      ? { status: 200, body: 'x', headers: { 'cache-control': 'public, max-age=3600', age: '412' } }
      : null,
    (origin) => runChecks({ origin }),
  );
  assert.ok(failures(checks).some((n) => n.includes('cacheable') || n.includes('cache')),
    'a prerendered export sitting in a CDN is the quiet catastrophe');
});

test('catches a destructive route that answers GET', async () => {
  const checks = await withSite(
    (req) => (req.url.startsWith('/api/leads/delete') && req.method === 'GET'
      ? { status: 200, body: 'deleted' } : null),
    (origin) => runChecks({ origin }),
  );
  assert.equal(levelOf(checks, 'refuses GET'), 'fail');
});

test('catches a cross-site POST reaching the handler', async () => {
  const checks = await withSite(
    (req) => (req.url.startsWith('/api/leads/delete') && req.method === 'POST'
      ? { status: 200, body: '{"ok":true}' } : null),
    (origin) => runChecks({ origin }),
  );
  assert.equal(levelOf(checks, 'cross-site POST'), 'fail');
});

test('catches a route that trusts the Access header instead of verifying it', async () => {
  // The single most common way this feature is built wrong.
  const checks = await withSite(
    (req) => {
      if (!req.url.startsWith('/api/leads.csv')) return null;
      const trusted = req.headers['cf-access-jwt-assertion'] || req.headers.cookie;
      return trusted ? { status: 200, body: 'name,email\n' } : { status: 401, body: '' };
    },
    (origin) => runChecks({ origin }),
  );
  const forged = checks.filter((c) => c.name.includes('forged Access'));
  assert.ok(forged.length >= 1);
  assert.ok(forged.every((c) => c.level === 'fail'), 'a header is not a check');
});

test('catches the admin page listed in the sitemap', async () => {
  const checks = await withSite(
    (req) => req.url === '/sitemap-index.xml'
      ? { status: 200, body: '<urlset><url><loc>https://x.test/leads/</loc></url></urlset>' }
      : null,
    (origin) => runChecks({ origin }),
  );
  assert.equal(levelOf(checks, 'sitemap'), 'fail');
});

test('warns when robots.txt names the admin page', async () => {
  const checks = await withSite(
    (req) => req.url === '/robots.txt' ? { status: 200, body: 'User-agent: *\nDisallow: /leads\n' } : null,
    (origin) => runChecks({ origin }),
  );
  assert.equal(levelOf(checks, 'robots.txt'), 'warn',
    'a Disallow list is a published list of what you would rather people did not look at');
});

test('a correctly configured site produces no failures', async () => {
  const checks = await withSite(
    (req) => {
      if (req.url.startsWith('/api/leads') && req.url.includes('delete')) {
        return { status: req.method === 'GET' ? 405 : 403, body: '' };
      }
      if (req.url.startsWith('/api/leads')) {
        return { status: 401, body: '', headers: { 'cache-control': 'no-store' } };
      }
      if (req.url === '/sitemap-index.xml') return { status: 200, body: '<urlset></urlset>' };
      if (req.url === '/robots.txt') return { status: 200, body: 'User-agent: *\nAllow: /\n' };
      return null;
    },
    (origin) => runChecks({ origin }),
  );
  assert.deepEqual(failures(checks), [], JSON.stringify(checks.filter((c) => c.level === 'fail'), null, 1));
});

test('every failure carries a fix, not just a verdict', async () => {
  const checks = await withSite(
    (req) => (req.url.startsWith('/api/leads') ? { status: 200, body: '[]' } : null),
    (origin) => runChecks({ origin }),
  );
  for (const c of checks.filter((x) => x.level === 'fail' || x.level === 'warn')) {
    assert.ok(c.fix && c.fix.length > 20, `${c.name} has no actionable fix`);
  }
});

test('doctor never writes: no POST that could delete anything succeeds by design', async () => {
  const seen = [];
  await withSite(
    (req) => { seen.push(`${req.method} ${req.url.split('?')[0]}`); return { status: 401, body: '' }; },
    (origin) => runChecks({ origin, token: 'x' }),
  );
  const posts = seen.filter((s) => s.startsWith('POST'));
  // The one POST is the CSRF probe, and it deliberately carries a foreign
  // Origin and an all-zero id so that reaching a real handler cannot match a
  // record. A diagnostic that changes state is one people stop running.
  assert.ok(posts.every((p) => p.includes('/delete')), `unexpected writes: ${posts}`);
  assert.equal(posts.length, 1);
});
