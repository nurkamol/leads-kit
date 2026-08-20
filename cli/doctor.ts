/**
 * Probe a deployed site and report what is misconfigured.
 *
 * ── WHY THIS IS THE MOST USEFUL COMMAND IN THE PACKAGE ────────────────────
 * Every serious risk here is a configuration mistake, not a code bug. The code
 * is tested; the wiring is not, because the wiring lives in someone else's
 * repo. A route missing `prerender = false` publishes every enquiry as a file
 * on a CDN. `checkOrigin` switched off leaves the delete endpoint reachable
 * from a hostile page with the visitor's own cookie. `/leads` left in the
 * sitemap invites a crawler to a page of personal data.
 *
 * None of those fail loudly. All of them look completely normal until someone
 * goes looking, which is what this is for.
 *
 * It only reads. Nothing here writes, deletes or submits anything: a diagnostic
 * that changes state is one people stop running.
 */
import { unwrapLeads } from './unwrap.js';

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

export type Level = 'pass' | 'warn' | 'fail' | 'skip';
export interface Check {
  name: string;
  level: Level;
  detail: string;
  /** What to do about it. Only meaningful for warn/fail. */
  fix?: string;
}

const get = async (url: string, init: RequestInit = {}) => {
  try {
    return await fetch(url, { redirect: 'manual', ...init });
  } catch (error) {
    return { status: 0, headers: new Headers(), text: async () => String(error), ok: false } as unknown as Response;
  }
};

/** A JWT that is structurally perfect and correctly addressed, but unsigned. */
function algNoneToken(aud: string): string {
  const b = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b({ alg: 'none', kid: 'k' })}.${b({
    aud,
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: 'doctor@leads-kit.test',
    sub: 'doctor',
  })}.`;
}

export interface DoctorOptions {
  origin: string;
  token?: string;
  /** Path prefix for the API routes. */
  base?: string;
  /** The page path, for the sitemap check. */
  page?: string;
}

export async function runChecks(options: DoctorOptions): Promise<Check[]> {
  const origin = options.origin.replace(/\/$/, '');
  const base = options.base ?? '/api/leads';
  const page = options.page ?? '/leads';
  const out: Check[] = [];
  const add = (c: Check) => out.push(c);

  /* ── 1. The export routes must refuse an anonymous caller ─────────────── */
  for (const path of [`${base}.csv`, `${base}.json`, `${base}/contacts.csv`]) {
    const res = await get(`${origin}${path}`);
    if (res.status === 0) {
      add({ name: `${path} reachable`, level: 'skip', detail: 'no response' });
    } else if (res.status === 200) {
      add({
        name: `${path} refuses anonymous`,
        level: 'fail',
        detail: `returned 200 with no credentials — this is serving enquiries publicly`,
        fix: 'Check the route passes a context with `token` and/or `access` set, and that guard() is called before reading.',
      });
    } else if ([401, 403, 404].includes(res.status)) {
      add({ name: `${path} refuses anonymous`, level: 'pass', detail: String(res.status) });
    } else {
      add({ name: `${path} refuses anonymous`, level: 'warn', detail: `unexpected ${res.status}` });
    }
  }

  /* ── 2. Prerendered endpoints — the quiet catastrophe ─────────────────── */
  const csv = await get(`${origin}${base}.csv`);
  const cc = csv.headers.get('cache-control') ?? '';
  const age = csv.headers.get('age');
  if (csv.status === 200 && !/no-store/.test(cc)) {
    add({
      name: 'export responses are not cacheable',
      level: 'fail',
      detail: `cache-control: ${cc || '(none)'}`,
      fix: 'Personal data must never enter a shared cache. handleExport sets no-store; a prerendered route bypasses it entirely.',
    });
  } else if (age !== null && csv.status === 200) {
    add({
      name: 'export is not being served from cache',
      level: 'fail',
      detail: `an Age header (${age}) means a cache answered — the route is prerendered or a rule is caching it`,
      fix: 'Set `export const prerender = false` on the route, and check no Cloudflare cache rule matches it.',
    });
  } else {
    add({ name: 'export is not cached', level: 'pass', detail: cc || 'not applicable' });
  }

  /* ── 3. Destructive routes must refuse GET ────────────────────────────── */
  for (const path of [`${base}/delete`, `${base}/erase`, `${base}/status`]) {
    for (const url of [`${origin}${path}`, `${origin}${path}/`]) {
      const res = await get(url);
      if (res.status === 405 || res.status === 401 || res.status === 404 || res.status === 0) continue;
      if (res.status === 200) {
        add({
          name: `${path} refuses GET`,
          level: 'fail',
          detail: 'answered 200 to a GET — a prefetcher or link scanner will fire this unprompted',
          fix: 'Destructive routes must be POST-only. Export a GET that returns 405.',
        });
      }
    }
  }
  if (!out.some((c) => c.name.includes('refuses GET'))) {
    add({ name: 'destructive routes refuse GET', level: 'pass', detail: '405 / 401' });
  }

  /* ── 4. CSRF: a cross-site POST must not reach the handler ────────────── */
  const csrf = await get(`${origin}${base}/delete/`, {
    method: 'POST',
    headers: { origin: 'https://leads-kit-doctor.invalid', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'id=00000000-0000-4000-8000-000000000000',
  });
  if (csrf.status === 403 || csrf.status === 401 || csrf.status === 404) {
    add({ name: 'cross-site POST is refused', level: 'pass', detail: String(csrf.status) });
  } else {
    add({
      name: 'cross-site POST is refused',
      level: 'fail',
      detail: `returned ${csrf.status} to a POST claiming a foreign Origin`,
      fix: 'The session is a cookie and rides along on a cross-site POST. Astro: pin security.checkOrigin. Next: use checkOrigin() from @nurkamol/leads-kit/next in middleware.',
    });
  }

  /* ── 5. A forged Access assertion must not be an identity ─────────────── */
  const forged = [
    ['bare header', { 'cf-access-jwt-assertion': 'forged.token.here' }],
    ['alg:none', { 'cf-access-jwt-assertion': algNoneToken('doctor') }],
    ['forged cookie', { cookie: `CF_Authorization=${algNoneToken('doctor')}` }],
  ] as const;
  let forgedOk = true;
  for (const [label, headers] of forged) {
    const res = await get(`${origin}${base}.csv`, { headers });
    if (res.status === 200) {
      forgedOk = false;
      add({
        name: `forged Access (${label}) is refused`,
        level: 'fail',
        detail: 'returned 200 — the route is trusting the header instead of verifying the signature',
        fix: 'Presence of Cf-Access-Jwt-Assertion is not a check. Use verifyAccess, which validates the signature, audience and expiry.',
      });
    }
  }
  if (forgedOk) add({ name: 'forged Access assertions are refused', level: 'pass', detail: '3/3 refused' });

  /* ── 6. The page should not be advertised ─────────────────────────────── */
  for (const sm of ['/sitemap-index.xml', '/sitemap.xml', '/sitemap-0.xml']) {
    const res = await get(`${origin}${sm}`);
    if (res.status !== 200) continue;
    const body = await res.text();
    if (body.includes(`${page}`)) {
      add({
        name: `${page} is not in ${sm}`,
        level: 'fail',
        detail: 'the admin page is listed in the sitemap',
        fix: 'Exclude it. A page of personal data should not be advertised, and a permanently-404 URL in a sitemap is also a Search Console error.',
      });
    }
  }
  if (!out.some((c) => c.name.includes('is not in /sitemap'))) {
    add({ name: 'the admin page is not in the sitemap', level: 'pass', detail: 'not listed' });
  }

  const robots = await get(`${origin}/robots.txt`);
  if (robots.status === 200 && (await robots.text()).includes(page)) {
    add({
      name: 'the admin page is not named in robots.txt',
      level: 'warn',
      detail: `robots.txt names ${page}`,
      fix: 'Disallow is a published list of what you would rather people did not look at. Leave it out; Access already refuses.',
    });
  }

  /* ── 7. Authenticated checks, if a token was given ────────────────────── */
  if (!options.token) {
    add({ name: 'retention (TTL) on stored records', level: 'skip', detail: 'needs --token' });
    return out;
  }

  const auth = { authorization: `Bearer ${options.token}` };
  const listed = await get(`${origin}${base}.json`, { headers: auth });
  if (listed.status !== 200) {
    add({ name: 'token is accepted', level: 'fail', detail: `${base}.json returned ${listed.status}`, fix: 'Check LEADS_EXPORT_TOKEN matches the worker secret.' });
    return out;
  }
  add({ name: 'token is accepted', level: 'pass', detail: '200' });

  let leads: Record<string, unknown>[] = [];
  try {
    leads = unwrapLeads(await listed.json(), `${base}.json`) as Record<string, unknown>[];
  } catch (error) {
    add({ name: 'export shape', level: 'warn', detail: String(error).slice(0, 120) });
    return out;
  }

  add({ name: 'records readable', level: 'pass', detail: `${leads.length} record(s)` });

  const noStatus = leads.filter((l) => !l.status).length;
  if (leads.length && noStatus === leads.length) {
    add({
      name: 'lead status in use',
      level: 'warn',
      detail: 'no record carries a status',
      fix: 'Statuses turn the list into an inbox. Without them the only way to clear a lead is to delete it.',
    });
  }

  const withPii = leads.filter((l) => typeof l.ip === 'string' && l.ip).length;
  if (withPii) {
    add({
      name: 'IP addresses are stored',
      level: 'warn',
      detail: `${withPii} record(s) carry an IP`,
      fix: 'An IP is personal data under GDPR. Keep it only if you use it, and say so in the privacy notice.',
    });
  }

  return out;
}

export function report(checks: Check[]): number {
  const icon: Record<Level, string> = {
    pass: `${GREEN}✓${RESET}`,
    warn: `${YELLOW}▲${RESET}`,
    fail: `${RED}✗${RESET}`,
    skip: `${DIM}·${RESET}`,
  };
  console.log(`\n${BOLD}── leads-kit doctor ${'─'.repeat(40)}${RESET}`);
  for (const c of checks) {
    console.log(`  ${icon[c.level]} ${c.name.padEnd(46)} ${DIM}${c.detail}${RESET}`);
    if (c.fix) console.log(`      ${DIM}→ ${c.fix}${RESET}`);
  }

  const fails = checks.filter((c) => c.level === 'fail').length;
  const warns = checks.filter((c) => c.level === 'warn').length;
  console.log(
    fails
      ? `\n${RED}${fails} failure(s)${RESET}${warns ? `, ${warns} warning(s)` : ''}\n`
      : warns
        ? `\n${YELLOW}No failures, ${warns} warning(s).${RESET}\n`
        : `\n${GREEN}All checks passed.${RESET}\n`,
  );
  console.log(
    `${DIM}What this cannot see: whether Access actually covers the page (it sits in\n` +
      `front, so a probe from here lands on its login screen), whether the KV TTL was\n` +
      `set at write time, or whether the notifier reaches a real inbox.${RESET}\n`,
  );
  /* Non-zero on failures so this is usable in CI. Warnings do not fail. */
  return fails ? 1 : 0;
}
