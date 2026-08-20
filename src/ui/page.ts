import { isLeadStatus, LEAD_STATUSES, type LeadRecord, type LeadStatus } from '../types.js';
import { statusOf } from '../handlers/status.js';
import { summarise } from '../handlers/stats.js';
import { LEADS_CSS } from './css.js';
import { attr, esc, safeUrl, scriptJson } from './escape.js';

/**
 * The leads page, rendered by the package.
 *
 * -- WHY THIS IS BUNDLED WHEN NOTHING ELSE VISUAL IS -----------------------
 * The page used to be a template you copied and adapted, and that copy went
 * stale: within six releases the shipped template still imported a module the
 * reference project had deleted, and its own docs described an API two major
 * features out of date. A copy is a fork, and a fork rots quietly.
 *
 * As a handler it cannot. A fix to the markup — an accessibility fix, most
 * importantly — arrives everywhere via `npm update` instead of sitting in one
 * repo while forty others keep the bug.
 *
 * The objection to bundling a UI is that it couples every install to one
 * design. That objection is answered by the palette rather than waved away:
 * every colour reads the HOST's token first (`var(--ink, #f0e3de)`), so the
 * page looks native where a design system exists and finished where none does.
 *
 * And it applies here specifically because /leads is INTERNAL. Only the owner
 * sees it, so "works the moment it is installed" is worth more than "matches
 * the brand exactly". On a public page that trade runs the other way, which is
 * why nothing else in this package renders anything.
 *
 * If you want the markup: `ejectLeadsPage()` returns the HTML as a string, and
 * the plugin still ships the Astro component. Nothing here is a one-way door.
 */

export interface LeadsPageOptions {
  /** Shown in the <title> and nowhere else. */
  siteName?: string;
  /** `lang` on <html>. */
  locale?: string;
  /** Who is signed in, shown under the heading. */
  identity?: string;
  /** Where "Back to site" goes. Omit to hide it. */
  backHref?: string;
  /** Where "Sign out" goes. Defaults to Cloudflare Access's logout. */
  logoutHref?: string | null;
  /** Prefix for the API routes this page posts to. */
  basePath?: string;
  /** Which record fields to list, in order. */
  fields?: readonly { key: string; label: string }[];
  /** Extra CSS, appended after the bundled sheet so it wins. */
  css?: string;
  /** A CSP nonce, applied to the inline <style> and <script>. */
  nonce?: string;
  /** Current filter, usually from `?status=`. */
  filter?: string;
  /** Banner flags, usually from `?deleted=1` / `?updated=1`. */
  notice?: 'deleted' | 'updated' | null;
}

const DEFAULT_FIELDS = [
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'service', label: 'Service' },
  { key: 'budget', label: 'Budget' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'page', label: 'Page' },
  { key: 'country', label: 'Country' },
] as const;

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  replied: 'Replied',
  archived: 'Archived',
  spam: 'Spam',
};

const fmtDate = (iso: unknown) => {
  const d = new Date(String(iso));
  return Number.isNaN(d.getTime()) ? String(iso ?? '') : d.toISOString().slice(0, 16).replace('T', ' ');
};

/**
 * The client-side enhancement, as a string.
 *
 * Everything it does is an ENHANCEMENT. Filtering is a query parameter, the
 * status controls are forms and the delete is a form, so the page is fully
 * usable with this script blocked or broken. Nothing here reveals content that
 * CSS has hidden — that pattern turns a failed bundle into a blank page.
 */
const SCRIPT = `
(() => {
  const q = document.getElementById('q');
  const count = document.getElementById('count');
  const leads = [...document.querySelectorAll('.lead')];
  if (!q || !count) return;
  const original = count.textContent;

  q.addEventListener('input', () => {
    const term = q.value.trim().toLowerCase();
    if (!term) {
      for (const el of leads) el.hidden = false;
      count.textContent = original;
      return;
    }
    let shown = 0;
    for (const el of leads) {
      const hit = (el.dataset.hay || '').includes(term);
      el.hidden = !hit;
      if (hit) shown++;
    }
    count.textContent = shown + ' of ' + leads.length + ' enquir' + (leads.length === 1 ? 'y' : 'ies');
  });

  document.querySelector('[data-print]')?.addEventListener('click', () => window.print());

  const menu = document.querySelector('.menu');
  if (menu) {
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) menu.removeAttribute('open');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.hasAttribute('open')) {
        menu.removeAttribute('open');
        menu.querySelector('summary')?.focus();
      }
    });
  }

  for (const form of document.querySelectorAll('[data-delete]')) {
    form.addEventListener('submit', (e) => {
      const who = form.closest('.lead')?.querySelector('.name')?.textContent?.trim() || 'this enquiry';
      if (!confirm('Delete the enquiry from ' + who + '?\\n\\nThis cannot be undone.')) e.preventDefault();
    });
  }
})();
`;

/** The page as an HTML string. Every interpolation is escaped — see escape.ts. */
export function renderLeadsPage(leads: LeadRecord[], options: LeadsPageOptions = {}): string {
  const base = options.basePath ?? '/api/leads';
  const fields = options.fields ?? DEFAULT_FIELDS;
  const nonce = options.nonce ? ` nonce=${attr(options.nonce)}` : '';

  /* Newest first — the opposite of the export, because someone opening this is
     looking for what just arrived, not reading a ledger from the beginning. */
  const rows = [...leads].reverse();
  const stats = summarise(leads, Date.now());

  const filter = isLeadStatus(options.filter) ? options.filter : '';
  const visible = filter ? rows.filter((l) => statusOf(l) === filter) : rows;
  /* Archived and spam are out of the default view: they have been dealt with,
     and a list that never shrinks is one nobody reads. One click away, and the
     counts are always on screen. */
  const inbox = filter ? visible : visible.filter((l) => !['archived', 'spam'].includes(statusOf(l)));
  const inboxTotal = rows.filter((l) => !['archived', 'spam'].includes(statusOf(l))).length;

  const chip = (href: string, label: string, n: number, current: boolean) =>
    `<a class="chip" href=${attr(href)}${current ? ' aria-current="page"' : ''}>${esc(label)} <span>${n}</span></a>`;

  const card = (l: LeadRecord) => {
    const st = statusOf(l);
    const hay = [l.name, l.email, l.service, l.message, l.budget, l.timeline]
      .map((v) => String(v ?? ''))
      .join(' ')
      .toLowerCase();
    const spam = typeof l.spamScore === 'number' && l.spamScore >= 3;

    return `<article class="lead" data-hay=${attr(hay)}>
  <div class="top">
    <span class="name">${esc(l.name || '(no name)')}</span>
    <span class="tag tag--status" data-s=${attr(st)}>${esc(STATUS_LABEL[st])}</span>
    <span class="tag" data-v=${attr(l.verification ?? 'unknown')}>${esc(l.verification ?? 'unknown')}</span>
    ${spam ? `<span class="tag tag--spam" title=${attr(l.spamSignals ?? '')}>spam score ${esc(l.spamScore)}</span>` : ''}
    <span class="when">${esc(fmtDate(l.receivedAt))}</span>
  </div>
  <dl>${fields
    .map(({ key, label }) => {
      const value = String(l[key] ?? '');
      if (!value && key !== 'email') return '';
      const shown =
        key === 'email'
          ? `<a href=${attr(safeUrl(`mailto:${value}?subject=${encodeURIComponent('Re: your enquiry')}`))}>${esc(value || '—')}</a>`
          : esc(value);
      return `<dt>${esc(label)}</dt><dd>${shown}</dd>`;
    })
    .join('')}</dl>
  <div class="msg">${esc(l.message || '(no message)')}</div>
  <div class="statuses">${LEAD_STATUSES.filter((s) => s !== st)
    .map(
      (s) => `<form method="post" action=${attr(`${base}/status/`)}>
      <input type="hidden" name="id" value=${attr(l.id)}>
      <input type="hidden" name="status" value=${attr(s)}>
      <button class="btn btn--chip" type="submit">${esc(
        s === 'replied' ? 'Mark replied' : s === 'new' ? 'Back to new' : `Mark ${s}`,
      )}</button></form>`,
    )
    .join('')}</div>
  <form class="danger" method="post" action=${attr(`${base}/delete/`)} data-delete>
    <input type="hidden" name="id" value=${attr(l.id)}>
    <button class="btn btn--danger" type="submit">Delete</button>
    <span class="danger__hint">Permanent. Recorded in the audit log.</span>
  </form>
</article>`;
  };

  const notice =
    options.notice === 'deleted'
      ? '<p class="notice" role="status">Enquiry deleted. The action is recorded in the audit log.</p>'
      : options.notice === 'updated'
        ? '<p class="notice" role="status">Status updated.</p>'
        : '';

  const logout = options.logoutHref === null ? '' : (options.logoutHref ?? '/cdn-cgi/access/logout');

  return `<!doctype html>
<html lang=${attr(options.locale ?? 'en')} data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Enquiries${options.siteName ? ` — ${esc(options.siteName)}` : ''}</title>
<style${nonce}>${LEADS_CSS}${options.css ?? ''}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>Enquiries</h1>
      ${options.identity ? `<div class="who">${esc(options.identity)}</div>` : ''}
    </div>
    <div class="session">
      ${options.backHref ? `<a class="btn" href=${attr(safeUrl(options.backHref))}>&larr; Back to site</a>` : ''}
      ${logout ? `<a class="btn" href=${attr(safeUrl(logout))}>Sign out</a>` : ''}
    </div>
  </header>

  <div class="tools">
    <input type="search" id="q" placeholder="Filter by name, email, service or message&hellip;" aria-label="Filter enquiries" autocomplete="off">
    <a class="btn" href=${attr(`${base}.csv`)} download>Download CSV</a>
    <a class="btn" href=${attr(`${base}.json`)} download>Download JSON</a>
    <a class="btn" href=${attr(`${base}.xlsx`)} download>Excel</a>
    <button class="btn" type="button" data-print>Save as PDF</button>
    <details class="menu">
      <summary class="btn">Contact list &#9662;</summary>
      <div class="menu__panel">
        <a class="menu__item" href=${attr(`${base}/contacts.csv?format=mailchimp`)} download>Mailchimp CSV</a>
        <a class="menu__item" href=${attr(`${base}/contacts.csv?format=klaviyo`)} download>Klaviyo CSV</a>
        <a class="menu__item" href=${attr(`${base}/contacts.csv`)} download>Generic CRM CSV</a>
        <p class="menu__warn">One row per address, newest enquiry. <strong>No marketing consent</strong> &mdash; import as non-subscribed and do not send campaigns to these people.</p>
      </div>
    </details>
  </div>

  <p class="print-note">${inbox.length} enquir${inbox.length === 1 ? 'y' : 'ies'} &middot; printed ${esc(
    new Date().toISOString().slice(0, 10),
  )} &middot; contains personal data &mdash; handle and destroy accordingly</p>

  ${notice}

  <nav class="filters" aria-label="Filter by status">
    ${chip('?', 'Inbox', inboxTotal, filter === '')}
    ${LEAD_STATUSES.map((s) => chip(`?status=${s}`, STATUS_LABEL[s], stats.byStatus[s], filter === s)).join('\n    ')}
  </nav>

  <p class="stats">
    <span><strong>${stats.unanswered}</strong> unanswered</span>
    <span><strong>${stats.total}</strong> total</span>
    <span><strong>${stats.week}</strong> in the last 7 days</span>
    ${stats.unverified > 0 ? `<span class="stats__warn"><strong>${stats.unverified}</strong> not verified</span>` : ''}
  </p>

  <p class="count" id="count" role="status">${inbox.length} enquir${inbox.length === 1 ? 'y' : 'ies'}${
    filter ? ` &middot; ${esc(STATUS_LABEL[filter as LeadStatus])}` : rows.length !== inbox.length ? ' in the inbox' : ''
  }</p>

  ${rows.length === 0 ? '<p class="empty">Nothing yet. Submissions will appear here as they arrive.</p>' : ''}
  ${
    rows.length > 0 && inbox.length === 0
      ? `<p class="empty">Nothing here. ${filter ? '<a href="?">Back to the inbox</a>' : 'Everything has been dealt with.'}</p>`
      : ''
  }

  ${inbox.map(card).join('\n  ')}
</div>
<script${nonce}>${SCRIPT}</script>
</body>
</html>`;
}

/** The rendered HTML, for anyone who wants to own the markup from here on. */
export const ejectLeadsPage = renderLeadsPage;

/** Kept exported so a caller embedding the page elsewhere can reuse the data. */
export { scriptJson };
