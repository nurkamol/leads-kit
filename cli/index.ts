#!/usr/bin/env node
/**
 * npx leads-kit export --url https://example.com --token $LEADS_EXPORT_TOKEN
 *
 * Pulls every enquiry from a deployed export endpoint and writes the formats
 * you asked for. This is the ONLY file in the package allowed to import
 * `node:` anything — it is a CLI, it has a filesystem, and keeping the import
 * confined here is what lets everything else run on Workers.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { toCsv, toJson, toMarkdown, toXml } from '../src/format/records.js';
import { toKlaviyoCsv, toMailchimpCsv, toContactsCsv } from '../src/format/contacts.js';
import type { LeadRecord } from '../src/types.js';

const BUILDERS: Record<string, { build: (l: LeadRecord[]) => string; ext: string }> = {
  json: { build: toJson, ext: 'json' },
  csv: { build: toCsv, ext: 'csv' },
  xml: { build: toXml, ext: 'xml' },
  md: { build: toMarkdown, ext: 'md' },
  mailchimp: { build: toMailchimpCsv, ext: 'csv' },
  klaviyo: { build: toKlaviyoCsv, ext: 'csv' },
  contacts: { build: toContactsCsv, ext: 'csv' },
};

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

function die(message: string): never {
  console.error(`leads-kit: ${message}`);
  process.exit(1);
  /* `process.exit` is typed `never`, but only as a function-return; TS still
     wants the arrow body itself to be unreachable at the end. A declaration
     with an explicit `never` return satisfies it without a cast. */
  throw new Error(message);
}

if (argv[0] !== 'export' || argv.includes('--help')) {
  console.log(`leads-kit export — pull enquiries from a deployed site

  --url <origin>       site to read from, e.g. https://example.com
  --token <token>      bearer token; defaults to $LEADS_EXPORT_TOKEN
  --from <file.json>   convert a file you already have, instead of fetching
  --formats <list>     ${Object.keys(BUILDERS).join(',')}   (default: json,csv)
  --out <dir>          output directory (default: ./exports)

The output contains names, email addresses and message text. --out must be
gitignored; the command refuses to write anywhere inside a repo that is not.`);
  process.exit(argv.includes('--help') ? 0 : 1);
}

const outDir = resolve(flag('out') ?? 'exports');

/*
 * Refuse to write personal data somewhere it would be committed.
 *
 * The retention promise in a privacy notice covers the database; it says
 * nothing about a copy sitting in a public repository forever. This is the one
 * mistake here that cannot be undone by deleting the file afterwards, because
 * git keeps it.
 */
const findRepo = (dir: string): string | null => {
  let cur = dir;
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(cur, '.git'))) return cur;
    const parent = resolve(cur, '..');
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
};

const repo = findRepo(outDir);
if (repo) {
  const ignore = join(repo, '.gitignore');
  const rel = outDir.slice(repo.length + 1);
  const patterns = existsSync(ignore) ? readFileSync(ignore, 'utf8').split('\n') : [];
  const covered = patterns.some((line: string) => {
    const p = line.trim().replace(/^\/+|\/+$/g, '');
    return p && (rel === p || rel.startsWith(p + '/'));
  });
  if (!covered) {
    die(
      `refusing to write to "${outDir}" — it is inside the repo at ${repo} and is not\n` +
        `  gitignored. Add "${rel}/" to .gitignore, or pass --out somewhere outside the repo.\n` +
        `  These files contain names, email addresses and message text.`,
    );
  }
}

const formats = (flag('formats') ?? 'json,csv').split(',').map((f) => f.trim()).filter(Boolean);
for (const f of formats) if (!BUILDERS[f]) die(`unknown format "${f}"`);

let leads: LeadRecord[];
const from = flag('from');
if (from) {
  leads = JSON.parse(readFileSync(resolve(from), 'utf8'));
} else {
  const url = flag('url') ?? die('need --url or --from');
  const token = flag('token') ?? process.env.LEADS_EXPORT_TOKEN ?? die('need --token or $LEADS_EXPORT_TOKEN');
  const endpoint = new URL('/api/leads.json', url).toString();
  const res = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) die(`${endpoint} returned ${res.status} ${res.statusText}`);
  leads = (await res.json()) as LeadRecord[];
}

if (!Array.isArray(leads)) die('expected an array of leads');

mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
for (const f of formats) {
  const { build, ext } = BUILDERS[f];
  const name = `leads-${f}-${stamp}.${ext}`;
  writeFileSync(join(outDir, name), build(leads));
  console.log(`  ${name}`);
}
console.log(`\n${leads.length} enquir${leads.length === 1 ? 'y' : 'ies'} → ${outDir}`);
console.log('These files contain personal data. Delete them when you are done.');
