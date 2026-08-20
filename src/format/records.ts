import type { LeadRecord } from '../types.js';
import { csvFile, csvRow } from './csv.js';

/** Column order for the tabular formats, and field order in the XML. */
export const DEFAULT_COLUMNS = [
  'receivedAt', 'name', 'email', 'phone', 'service', 'budget',
  'timeline', 'message', 'page', 'country', 'verification', 'env', 'id',
] as const;

export function toCsv(leads: LeadRecord[], columns: readonly string[] = DEFAULT_COLUMNS): string {
  return csvFile([
    columns.join(','),
    ...leads.map((l) => csvRow(columns.map((c) => l[c]))),
  ]);
}

export const toJson = (leads: LeadRecord[]): string => JSON.stringify(leads, null, 2);

/**
 * Escape for XML text content.
 *
 * `&` FIRST. Any other order double-escapes the ampersands the later
 * replacements just introduced, and `&amp;lt;` renders as literal `&lt;` —
 * which looks like an encoding bug in whatever opens the file rather than a
 * bug here.
 */
const xmlEscape = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    /* Control characters are not merely ugly here: XML 1.0 has no way to
       represent most of them at all, so one in a pasted message makes the
       whole document unparseable. */
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

export function toXml(leads: LeadRecord[], columns: readonly string[] = DEFAULT_COLUMNS): string {
  const rows = leads.map((l) => {
    const fields = columns.map((c) => `    <${c}>${xmlEscape(l[c])}</${c}>`).join('\n');
    return `  <lead>\n${fields}\n  </lead>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<leads count="${leads.length}">\n${rows.join('\n')}\n</leads>\n`;
}

/** Escape the characters that would otherwise become markdown formatting. */
const mdCell = (value: unknown): string =>
  String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function toMarkdown(leads: LeadRecord[], columns: readonly string[] = DEFAULT_COLUMNS): string {
  const head = `| ${columns.join(' | ')} |`;
  const rule = `| ${columns.map(() => '---').join(' | ')} |`;
  const rows = leads.map((l) => `| ${columns.map((c) => mdCell(l[c])).join(' | ')} |`);
  return [head, rule, ...rows].join('\n') + '\n';
}
