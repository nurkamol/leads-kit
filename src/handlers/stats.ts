import type { LeadRecord } from '../types.js';

export interface LeadStats {
  total: number;
  week: number;
  month: number;
  /** Enquiries whose bot challenge did not definitively pass. */
  unverified: number;
}

/**
 * Counts, from records already in memory.
 *
 * Takes a `now` rather than reading the clock so the numbers are testable and
 * so a caller rendering a page can use the same instant for every figure —
 * computing "last 7 days" twice either side of midnight is how two lines of a
 * summary come to disagree.
 */
export function summarise(leads: LeadRecord[], now = Date.now()): LeadStats {
  const day = 24 * 60 * 60 * 1000;
  const since = (n: number) =>
    leads.filter((l) => new Date(String(l.receivedAt)).getTime() >= now - n * day).length;
  return {
    total: leads.length,
    week: since(7),
    month: since(30),
    unverified: leads.filter((l) => l.verification !== undefined && l.verification !== 'passed')
      .length,
  };
}
