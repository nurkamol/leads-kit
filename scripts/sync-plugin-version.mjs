#!/usr/bin/env node
/**
 * Keep the plugin and marketplace manifests on the package's version.
 *
 * Run by npm's `version` lifecycle, which fires AFTER package.json is bumped
 * and BEFORE the release commit is made — so staging the files here puts them
 * in that same commit. There is no step to remember.
 *
 * It exists because remembering did not work. The manifests were set by hand
 * one release, `npm version patch` moved the package the next, and the repo
 * ended up shipping a plugin claiming 0.7.2 beside a package on 0.7.3 — in the
 * very release that was about preventing drift. A version number that lies is
 * worse than no version number, because it is the thing someone checks to
 * decide whether to update.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const files = ['plugin/.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'];

for (const file of files) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  if (doc.plugins) for (const p of doc.plugins) p.version = version;
  else doc.version = version;
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
}

execFileSync('git', ['add', ...files]);
console.log(`plugin manifests → ${version}`);
