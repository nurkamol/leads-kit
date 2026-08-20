import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
};

/**
 * The package's whole portability claim in one assertion.
 *
 * `@types/node` is a devDependency for the CLI's sake, which means TypeScript
 * will happily accept `import { readFileSync } from 'node:fs'` anywhere in
 * src/ — and nothing fails until the code is deployed to a Worker, where the
 * failure is a runtime crash on a route nobody tested. This is the check that
 * turns that into a red test.
 */
test('src/ imports nothing from node:', () => {
  const offenders = [];
  for (const file of walk('src')) {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of source.matchAll(/from\s+['"](node:[^'"]+)['"]/g)) {
      offenders.push(`${file} → ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, [], `src/ must run on Workers:\n  ${offenders.join('\n  ')}`);
});

test('src/ imports no framework', () => {
  const banned = /from\s+['"](astro|next|react|vue|svelte|@sveltejs|hono)[/'"]/;
  const offenders = walk('src').filter((f) => banned.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});
