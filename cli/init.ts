/**
 * `npx leads-kit init` — scaffold the routes into an existing project.
 *
 * -- WHY THIS IS SAFE TO DO NOW, AND WAS NOT BEFORE -------------------------
 * A generator that guesses wrong writes broken code confidently, which is
 * worse than writing nothing. Until 0.8.0 the biggest thing to guess was the
 * PAGE: its markup, its styles, its fit with the host's design system. No
 * generator could do that well, which is why the plugin existed and an agent
 * did the adapting.
 *
 * The page is bundled now. What is left is boilerplate — a context module and
 * a dozen one-line routes — and boilerplate is exactly what a generator should
 * write. That is the whole reason this command can exist.
 *
 * -- THE RULES IT WORKS UNDER ----------------------------------------------
 * 1. It NEVER overwrites. A file that exists is reported and skipped, and the
 *    command still exits 0 — re-running after adding one route must not look
 *    like a failure.
 * 2. It refuses rather than guesses. No framework detected, no output.
 * 3. It touches no configuration. wrangler bindings, Access, secrets and
 *    astro.config are printed as things for you to do, because each is a
 *    decision or a live-account operation, and a tool that edits your
 *    deployment config while you are reading its output is one you cannot
 *    trust the next time.
 * 4. --dry-run prints the plan and writes nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';

export type Framework = 'astro' | 'next';

export interface InitPlan {
  framework: Framework;
  /** The KV binding found in wrangler config, if any. */
  binding: string | null;
  files: { path: string; body: string; exists: boolean }[];
}

/** Look for the marker files rather than reading package.json dependencies. */
export function detectFramework(cwd: string): Framework | null {
  const has = (name: string) =>
    ['.mjs', '.js', '.ts', '.mts', '.cjs'].some((ext) => existsSync(join(cwd, name + ext)));
  if (has('astro.config')) return 'astro';
  if (has('next.config')) return 'next';
  return null;
}

/**
 * The KV binding name, from wrangler config.
 *
 * Read rather than assumed: a project that already stores something in KV has
 * a binding with its own name, and scaffolding code that says `env.LEADS` into
 * a project whose binding is `ENQUIRIES` produces a runtime failure on a route
 * nobody has tested yet.
 */
export function detectBinding(cwd: string): string | null {
  for (const file of ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml']) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, 'utf8');
    const match =
      raw.match(/binding\s*[=:]\s*["']([A-Z0-9_]+)["']/) ??
      raw.match(/"binding"\s*:\s*"([A-Z0-9_]+)"/);
    if (match) return match[1];
  }
  return null;
}

const contextModule = (binding: string) => `import { env } from 'cloudflare:workers';
import { kvStore, type LeadsContext } from '@nurkamol/leads-kit';

/**
 * The bindings, assembled per request.
 *
 * A FUNCTION, not a constant: \`env\` is a lazy proxy, so importing it is fine
 * but reading a property outside a request context throws. Every adapter takes
 * a factory for exactly this reason.
 *
 * Returning null when the store is missing is deliberate — pass this function
 * straight to any adapter and an unbound store becomes a 503 saying so, rather
 * than a stack trace about \`undefined\` on someone's first deployment.
 */
export function leadsContext(): LeadsContext | null {
  const store = (env as Record<string, unknown>).${binding};
  if (!store) return null;

  const value = (name: string) => {
    const v = (env as Record<string, unknown>)[name];
    return typeof v === 'string' && v.length > 0 ? v : '';
  };

  return {
    store: kvStore(store as never),
    token: value('LEADS_EXPORT_TOKEN'),
    access: { teamDomain: value('ACCESS_TEAM_DOMAIN'), aud: value('ACCESS_AUD') },
    /*
     * Needed by any write that REWRITES a record — a status change, most
     * obviously. KV cannot update a value while keeping its remaining expiry,
     * so without this, marking a lead "replied" on day 364 grants it another
     * full year and quietly outlives whatever your privacy notice promises.
     *
     * Keep this number and that page in step.
     */
    retentionSeconds: 365 * 24 * 60 * 60,
  };
}
`;

/**
 * Build a route file.
 *
 * `path` is passed so the relative import is computed FROM THE PATH. The first
 * version worked it out from whether the body contained the string "leads/",
 * which is not a fact about where the file lives — and produced exactly the
 * mixed result you would expect: delete.ts and status.ts were right because
 * their redirect strings happened to contain it, and the other four were
 * wrong. A real `astro check` caught it; nothing else would have.
 */
const astroRoute = (path: string, imports: string, body: string, note = '') => {
  /* Directories between src/ and the file: src/pages/api/x.ts is 2,
     src/pages/api/leads/x.ts is 3. */
  const depth = path.split('/').slice(1, -1).length;
  return `import type { APIRoute } from 'astro';
import { ${imports} } from '@nurkamol/leads-kit/astro';
import { leadsContext } from '${'../'.repeat(depth)}lib/leads-context';

/* Required. The default is a build-time render, and a prerendered endpoint is
   a file on your CDN containing every enquiry you have ever received. */
export const prerender = false;
${note}
${body}
`;
};

function astroFiles(): { path: string; body: string }[] {
  const page = `---
import { astroLeadsPage } from '@nurkamol/leads-kit/astro';
import { leadsContext } from '../lib/leads-context';

export const prerender = false;

/*
 * Called inline rather than assigned. An Astro page returns a Response from
 * its frontmatter -- "export default" is not how a page works here, and a
 * const assigned then used one line later still reads as unused to the
 * type checker.
 */
return astroLeadsPage(leadsContext, {
  siteName: 'Your Site',
  backHref: '/',
  /*
   * If you have a design-token file, inline it here so the page uses YOUR
   * palette rather than the package's defaults:
   *
   *   import tokens from '../styles/tokens.css?raw';
   *   css: tokens,
   *
   * ?raw is not optional. A plain CSS import does nothing on this page: Astro
   * injects stylesheets while rendering a TEMPLATE, and this page renders none
   * — it returns a Response. Without ?raw the page falls back to the package's
   * own colours and looks completely fine while not being your site.
   */
})({ request: Astro.request, locals: Astro.locals as never });
---
`;

  const guard = `
/* A GET that deletes is a GET a prefetcher, a link scanner or the browser's
   own speculation rules will eventually fire with nobody having clicked. */
export const GET: APIRoute = () => new Response('Method not allowed\\n', { status: 405 });
`;

  return [
    { path: 'src/pages/leads.astro', body: page },
    {
      path: 'src/pages/api/contact.ts',
      body: astroRoute(
        'src/pages/api/contact.ts',
        'astroSubmit',
        `export const POST: APIRoute = astroSubmit(leadsContext, {
  schema: {
    name: { required: true, minLength: 2, maxLength: 100 },
    email: { required: true, type: 'email' },
    phone: { type: 'phone' },
    message: { maxLength: 4000 },
  },
  /* Name it something a form-filler WANTS to complete, and hide it with CSS —
     never type="hidden", which the autofillers this catches simply skip. */
  honeypotField: 'company',
  rateLimit: { limit: 5, windowSeconds: 600 },
  retentionSeconds: 365 * 24 * 60 * 60,
  notify: async (lead) => {
    /* Your provider. See "Notifiers" in the README for ready-made builders —
       Resend, Brevo, Postmark, Slack, a webhook — all dependency-free. */
    void lead;
  },
  redirects: {
    success: '/?sent=1#contact',
    /* A function, so the anchor can follow the field list. A plain string ends
       at /?invalid=name,email, which on a single-page site lands the visitor
       at the top with the form below the fold — a rejected submission that
       looks like a page which merely scrolled. */
    invalid: (fields) => \`/?invalid=\${encodeURIComponent(fields.join(','))}#contact\`,
    /* NEVER the success URL. That one is usually your conversion, and sending
       caught spam there lets any bot running JavaScript inflate it. */
    honeypot: '/#contact',
  },
});`,
      ),
    },
    {
      path: 'src/pages/api/leads.csv.ts',
      body: astroRoute(
        'src/pages/api/leads.csv.ts',
        'astroExport', `export const GET: APIRoute = astroExport(leadsContext, { format: 'csv' });`),
    },
    {
      path: 'src/pages/api/leads.json.ts',
      body: astroRoute(
        'src/pages/api/leads.json.ts',
        'astroExport', `export const GET: APIRoute = astroExport(leadsContext, { format: 'json' });`),
    },
    {
      path: 'src/pages/api/leads.xlsx.ts',
      body: astroRoute(
        'src/pages/api/leads.xlsx.ts',
        'astroExport', `export const GET: APIRoute = astroExport(leadsContext, { format: 'xlsx' });`),
    },
    {
      path: 'src/pages/api/leads/contacts.csv.ts',
      body: astroRoute(
        'src/pages/api/leads/contacts.csv.ts',
        'astroContacts',
        `/* ?format=mailchimp | klaviyo, or omit for a neutral CRM shape.
   READ the consent note in the README before sending to anything built from
   this: a contact form is not marketing consent. */
export const GET: APIRoute = astroContacts(leadsContext);`,
      ),
    },
    {
      path: 'src/pages/api/leads/delete.ts',
      body: astroRoute(
        'src/pages/api/leads/delete.ts',
        'astroDelete', `${guard}
export const POST: APIRoute = astroDelete(leadsContext, '/leads/?deleted=1');`),
    },
    {
      path: 'src/pages/api/leads/status.ts',
      body: astroRoute(
        'src/pages/api/leads/status.ts',
        'astroStatus', `${guard}
export const POST: APIRoute = astroStatus(leadsContext, '/leads/?updated=1');`),
    },
    {
      path: 'src/pages/api/leads/subject.ts',
      body: astroRoute(
        'src/pages/api/leads/subject.ts',
        'astroSubjectAccess',
        `/* Everything held about one person — GDPR Art. 15. You have one month. */
export const GET: APIRoute = astroSubjectAccess(leadsContext);`,
      ),
    },
    {
      path: 'src/pages/api/leads/erase.ts',
      body: astroRoute(
        'src/pages/api/leads/erase.ts',
        'astroErasure', `${guard}
/* Art. 17. Requires \`confirm\` to equal \`email\`: unlike deleting one enquiry,
   this takes an unbounded number of records with it. */
export const POST: APIRoute = astroErasure(leadsContext);`),
    },
    {
      path: 'src/pages/api/leads/audit.ts',
      body: astroRoute(
        'src/pages/api/leads/audit.ts',
        'astroAudit', `export const GET: APIRoute = astroAudit(leadsContext);`),
    },
  ];
}

function nextFiles(): { path: string; body: string }[] {
  const head = `import { leadsContext } from '@/lib/leads-context';

/* Or Next may cache it, and a cached enquiry list is a public one. */
export const dynamic = 'force-dynamic';
`;
  return [
    {
      path: 'app/leads/route.ts',
      body: `import { nextLeadsPage } from '@nurkamol/leads-kit/next';
${head}
export const GET = nextLeadsPage(leadsContext, { siteName: 'Your Site', backHref: '/' });
`,
    },
    {
      path: 'app/api/leads/[format]/route.ts',
      body: `import { nextExport } from '@nurkamol/leads-kit/next';
${head}
export const GET = nextExport(leadsContext);
`,
    },
    {
      path: 'app/api/leads/delete/route.ts',
      body: `import { checkOrigin, nextDelete } from '@nurkamol/leads-kit/next';
${head}
/**
 * Next has NO CSRF default.
 *
 * Astro ships security.checkOrigin; Next does not, so without this a hostile
 * page can POST here carrying the visitor's own session cookie. Access
 * authenticates the person; this decides which SITE asked.
 */
export async function POST(request: Request) {
  const blocked = checkOrigin(request, process.env.SITE_ORIGIN ?? 'https://example.com');
  if (blocked) return blocked;
  return nextDelete(leadsContext, '/leads?deleted=1')(request);
}

export const GET = () => new Response('Method not allowed\\n', { status: 405 });
`,
    },
    {
      path: 'app/api/leads/status/route.ts',
      body: `import { checkOrigin, nextStatus } from '@nurkamol/leads-kit/next';
${head}
export async function POST(request: Request) {
  const blocked = checkOrigin(request, process.env.SITE_ORIGIN ?? 'https://example.com');
  if (blocked) return blocked;
  return nextStatus(leadsContext, '/leads?updated=1')(request);
}

export const GET = () => new Response('Method not allowed\\n', { status: 405 });
`,
    },
    {
      path: 'app/api/contact/route.ts',
      body: `import { nextSubmit } from '@nurkamol/leads-kit/next';
${head}
export const POST = nextSubmit(leadsContext, {
  schema: {
    name: { required: true, minLength: 2, maxLength: 100 },
    email: { required: true, type: 'email' },
    phone: { type: 'phone' },
    message: { maxLength: 4000 },
  },
  honeypotField: 'company',
  rateLimit: { limit: 5, windowSeconds: 600 },
  retentionSeconds: 365 * 24 * 60 * 60,
  /*
   * Pass an address your PLATFORM vouches for. On Vercel that is
   * x-forwarded-for's first entry, because the platform overwrites it. Behind
   * an arbitrary proxy that same header is whatever the client typed — and a
   * rate limit keyed on an attacker-controlled value hands every request a
   * fresh bucket while still looking present in the code.
   */
  notify: async (lead) => { void lead; },
});
`,
    },
  ];
}

export function plan(cwd: string): InitPlan | null {
  const framework = detectFramework(cwd);
  if (!framework) return null;

  const binding = detectBinding(cwd);
  const contextPath = framework === 'astro' ? 'src/lib/leads-context.ts' : 'lib/leads-context.ts';

  const files = [
    { path: contextPath, body: contextModule(binding ?? 'LEADS') },
    ...(framework === 'astro' ? astroFiles() : nextFiles()),
  ];

  return {
    framework,
    binding,
    files: files.map((f) => ({ ...f, exists: existsSync(join(cwd, f.path)) })),
  };
}

export function runInit(cwd: string, options: { dryRun?: boolean } = {}): number {
  const p = plan(cwd);

  if (!p) {
    console.error(
      `\n${YELLOW}No astro.config or next.config here.${RESET}\n\n` +
        `  leads-kit init adds routes to an EXISTING project and refuses to guess\n` +
        `  which kind it is. Run it from your project root, or follow\n` +
        `  docs/getting-started.md if you are on something else — the package is\n` +
        `  framework-free and a bare Worker takes about ten lines.\n`,
    );
    return 1;
  }

  console.log(`\n${BOLD}── leads-kit init ${'─'.repeat(42)}${RESET}`);
  console.log(`  framework   ${p.framework}`);
  console.log(
    `  KV binding  ${p.binding ?? `${YELLOW}none found${RESET} ${DIM}— scaffolding with LEADS${RESET}`}`,
  );
  console.log('');

  let written = 0;
  let skipped = 0;

  for (const file of p.files) {
    if (file.exists) {
      /* Never overwrite. Someone re-running this after adding one route must
         not lose the twelve they had already customised. */
      console.log(`  ${DIM}·${RESET} ${file.path.padEnd(44)} ${DIM}exists, left alone${RESET}`);
      skipped++;
      continue;
    }
    if (!options.dryRun) {
      mkdirSync(dirname(join(cwd, file.path)), { recursive: true });
      writeFileSync(join(cwd, file.path), file.body);
    }
    console.log(`  ${GREEN}+${RESET} ${file.path}`);
    written++;
  }

  console.log(
    options.dryRun
      ? `\n${YELLOW}Dry run — nothing written.${RESET} ${written} file(s) would be created, ${skipped} left alone.\n`
      : `\n${GREEN}${written} file(s) written${RESET}${skipped ? `, ${skipped} left alone` : ''}.\n`,
  );

  /* Everything below is a decision or a live-account operation. A tool that
     edited your deployment config while you were reading its output is one you
     could not trust the next time it ran. */
  console.log(`${BOLD}What this did NOT do, because it is yours to decide:${RESET}\n`);
  const steps = [
    p.binding
      ? `Your KV binding is ${p.binding} and the context module uses it.`
      : `Create a KV namespace and bind it:  npx wrangler kv namespace create LEADS`,
    `Set the export token:  npx wrangler secret put LEADS_EXPORT_TOKEN   ${DIM}(openssl rand -hex 32)${RESET}`,
    `Put /leads behind Cloudflare Access, then add ACCESS_TEAM_DOMAIN and ACCESS_AUD to vars.`,
    p.framework === 'astro'
      ? `Pin security.checkOrigin in astro.config — it is the only thing stopping a hostile page POSTing to your delete route with the visitor's cookie.`
      : `Set SITE_ORIGIN. Next has no CSRF default; the delete and status routes check Origin against it.`,
    `Exclude /leads from your sitemap. A page of personal data should not be advertised.`,
    `Write the form itself. This package accepts submissions; the form is public and belongs in your layout.`,
  ];
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

  console.log(
    `\n${DIM}Then check it against the deployed site:\n` +
      `  npx leads-kit doctor --url https://yoursite.com${RESET}\n`,
  );
  return 0;
}
