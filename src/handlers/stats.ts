import { isLeadStatus, type LeadRecord, type LeadStatus } from '../types.js';

export interface LeadStats {
  total: number;
  week: number;
  month: number;
  /**
   * Enquiries that SHOULD have passed a bot challenge and did not.
   *
   * Counts `unverified` and `unavailable`. Deliberately excludes
   * `not-configured`, which means this deployment has no Turnstile at all —
   * on such a site every lead carries it, so counting them makes the figure
   * permanently equal to the total. A number that never differs from the
   * total tells you nothing and trains whoever reads the page to ignore it,
   * which is worse than not showing it.
   */
  unverified: number;
  /**
   * Still needing an answer — `new`, plus anything with no status at all.
   *
   * This is the figure worth putting at the top of a page. "12 total" is
   * trivia; "3 unanswered" is the reason to look.
   */
  unanswered: number;
  byStatus: Record<LeadStatus, number>;
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
  const byStatus: Record<LeadStatus, number> = { new: 0, replied: 0, archived: 0, spam: 0 };
  for (const lead of leads) byStatus[isLeadStatus(lead.status) ? lead.status : 'new']++;

  return {
    total: leads.length,
    week: since(7),
    month: since(30),
    unverified: leads.filter(
      (l) => l.verification === 'unverified' || l.verification === 'unavailable',
    ).length,
    unanswered: byStatus.new,
    byStatus,
  };
}
