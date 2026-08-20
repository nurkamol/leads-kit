import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectBinding, detectFramework, plan, runInit } from '../dist/cli/init.js';

const project = (files = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'leadskit-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
};

/* ── DETECTION: refuse rather than guess ─────────────────────────────────── */

test('detects Astro and Next from their config files', () => {
  assert.equal(detectFramework(project({ 'astro.config.mjs': '' })), 'astro');
  assert.equal(detectFramework(project({ 'astro.config.ts': '' })), 'astro');
  assert.equal(detectFramework(project({ 'next.config.js': '' })), 'next');
});

test('an unrecognised project produces NOTHING', () => {
  // A generator that guesses wrong writes broken code confidently, which is
  // worse than writing none.
  const dir = project({ 'package.json': '{}' });
  assert.equal(detectFramework(dir), null);
  assert.equal(plan(dir), null);
  assert.equal(runInit(dir), 1, 'and it exits non-zero');
  assert.deepEqual(readdirSync(dir), ['package.json'], 'no files created');
});

test('reads the KV binding rather than assuming LEADS', () => {
  // A project already using KV has a binding with its own name. Scaffolding
  // env.LEADS into one whose binding is ENQUIRIES fails at runtime, on a route
  // nobody has tested yet.
  assert.equal(
    detectBinding(project({ 'wrangler.jsonc': '{ "kv_namespaces": [{ "binding": "ENQUIRIES", "id": "x" }] }' })),
    'ENQUIRIES',
  );
  assert.equal(
    detectBinding(project({ 'wrangler.toml': '[[kv_namespaces]]\nbinding = "MY_STORE"\nid = "x"\n' })),
    'MY_STORE',
  );
  assert.equal(detectBinding(project({})), null);
});

test('the detected binding reaches the generated code', () => {
  const dir = project({ 'astro.config.mjs': '', 'wrangler.jsonc': '{"kv_namespaces":[{"binding":"ENQUIRIES","id":"x"}]}' });
  runInit(dir);
  const ctx = readFileSync(join(dir, 'src/lib/leads-context.ts'), 'utf8');
  assert.ok(ctx.includes('.ENQUIRIES'), 'must use the project’s own binding name');
  assert.ok(!ctx.includes('.LEADS;'));
});

/* ── SAFETY ──────────────────────────────────────────────────────────────── */

test('never overwrites, and says so without failing', () => {
  // Re-running after adding one route must not lose the twelve you customised.
  const dir = project({ 'astro.config.mjs': '' });
  runInit(dir);
  const mine = '// mine, edited\n';
  writeFileSync(join(dir, 'src/pages/api/leads.csv.ts'), mine);

  assert.equal(runInit(dir), 0, 'a second run is not a failure');
  assert.equal(readFileSync(join(dir, 'src/pages/api/leads.csv.ts'), 'utf8'), mine);
});

test('--dry-run writes nothing at all', () => {
  const dir = project({ 'astro.config.mjs': '' });
  assert.equal(runInit(dir, { dryRun: true }), 0);
  assert.ok(!existsSync(join(dir, 'src/lib/leads-context.ts')));
  assert.ok(!existsSync(join(dir, 'src/pages/leads.astro')));
});

test('it touches no configuration', () => {
  // Every remaining step is a decision or a live-account operation. A tool that
  // edited your deployment config while you read its output is one you could
  // not trust the next time.
  const wrangler = '{"kv_namespaces":[{"binding":"LEADS","id":"x"}]}';
  const config = 'export default {};\n';
  const dir = project({ 'astro.config.mjs': config, 'wrangler.jsonc': wrangler, 'package.json': '{}' });
  runInit(dir);
  assert.equal(readFileSync(join(dir, 'astro.config.mjs'), 'utf8'), config);
  assert.equal(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8'), wrangler);
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), '{}');
});

/* ── WHAT IT WRITES ──────────────────────────────────────────────────────── */

test('every Astro route disables prerendering', () => {
  // The default is a build-time render, and a prerendered endpoint is a file
  // on a CDN containing every enquiry.
  const dir = project({ 'astro.config.mjs': '' });
  runInit(dir);
  const routes = plan(dir).files.filter((f) => f.path.endsWith('.ts') && f.path.includes('pages/'));
  assert.ok(routes.length >= 8);
  for (const r of routes) {
    assert.match(readFileSync(join(dir, r.path), 'utf8'), /export const prerender = false/, r.path);
  }
});

test('destructive routes refuse GET', () => {
  const dir = project({ 'astro.config.mjs': '' });
  runInit(dir);
  for (const p of ['delete', 'status', 'erase']) {
    const src = readFileSync(join(dir, `src/pages/api/leads/${p}.ts`), 'utf8');
    assert.match(src, /export const GET[\s\S]*405/, p);
    assert.match(src, /export const POST/, p);
  }
});

test('the honeypot redirect is never the success URL', () => {
  // Sending caught spam to the conversion URL lets any bot running JavaScript
  // inflate the only conversion the site owns.
  const dir = project({ 'astro.config.mjs': '' });
  runInit(dir);
  const src = readFileSync(join(dir, 'src/pages/api/contact.ts'), 'utf8');
  const success = src.match(/success: '([^']+)'/)[1];
  const honeypot = src.match(/honeypot: '([^']+)'/)[1];
  assert.notEqual(honeypot, success);
  assert.ok(!honeypot.includes('sent=1'));
});

test('Next routes carry an origin check, because Next has no CSRF default', () => {
  const dir = project({ 'next.config.js': '' });
  runInit(dir);
  for (const p of ['delete', 'status']) {
    assert.match(readFileSync(join(dir, `app/api/leads/${p}/route.ts`), 'utf8'), /checkOrigin/, p);
  }
  assert.match(readFileSync(join(dir, 'app/leads/route.ts'), 'utf8'), /force-dynamic/);
});

test('the context module returns null rather than asserting', () => {
  const dir = project({ 'astro.config.mjs': '' });
  runInit(dir);
  const ctx = readFileSync(join(dir, 'src/lib/leads-context.ts'), 'utf8');
  assert.match(ctx, /LeadsContext \| null/);
  assert.match(ctx, /retentionSeconds/, 'or a status change silently extends retention');
  assert.ok(!ctx.includes('!;'), 'no non-null assertions in generated code');
});

test('the relative import depth is right for EVERY route', () => {
  // The first version derived depth from whether the body contained the string
  // "leads/", which is not a fact about where the file lives. delete.ts and
  // status.ts were correct by accident — their redirect strings contain it —
  // and the other four were broken. Only a real `astro check` caught it.
  const dir = project({ 'astro.config.mjs': '' });
  runInit(dir);
  for (const f of plan(dir).files) {
    if (!f.path.startsWith('src/pages/api/')) continue;
    const src = readFileSync(join(dir, f.path), 'utf8');
    const rel = src.match(/from '(\.\.[^']*)lib\/leads-context'/)?.[1];
    assert.ok(rel, `${f.path} has no context import`);

    // Resolve it the way the bundler will, and check the file is there.
    const from = join(dir, f.path, '..');
    assert.ok(
      existsSync(join(from, rel, 'lib/leads-context.ts')),
      `${f.path} imports '${rel}lib/leads-context' — which does not resolve`,
    );
  }
});

test('the page has no unused binding and returns a Response', () => {
  const dir = project({ 'astro.config.mjs': '' });
  runInit(dir);
  const page = readFileSync(join(dir, 'src/pages/leads.astro'), 'utf8');
  assert.match(page, /return astroLeadsPage\(/, 'must return, not assign — a page is not a module default');

  // Match STATEMENTS, not prose. Substring checks kept failing on the
  // explanatory comments that say why these shapes are wrong — the same
  // mistake made four times across this suite. Look at lines of code.
  const code = page.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l));
  assert.ok(!code.some((l) => /^\s*export default\b/.test(l)), 'not how an Astro page returns a Response');
  assert.ok(!code.some((l) => /^\s*const handler\b/.test(l)), 'an assigned-then-used const reads as unused');
});
