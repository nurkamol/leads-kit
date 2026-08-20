/**
 * The shapes everything else agrees on.
 *
 * Nothing in this package imports a framework or a Node built-in. That is not
 * tidiness — it is the whole portability story: Request, Response, crypto and
 * TextEncoder exist on Workers, Deno, Bun, Node 18+, Vercel Edge and Netlify
 * Edge alike, so a handler written against them runs on all of them and every
 * framework above them mounts it in about eight lines.
 *
 * The moment one `node:` import lands here, that stops being true everywhere
 * at once and nothing fails until deploy.
 */

/** One enquiry. Extra fields survive: the formatters read what they are given. */
export interface LeadRecord {
  id: string;
  receivedAt: string;
  name: string;
  email: string;
  phone?: string;
  service?: string;
  budget?: string;
  timeline?: string;
  message?: string;
  page?: string;
  country?: string;
  /** How the bot challenge went, if there is one. See the note in README. */
  verification?: string;
  env?: string;
  [key: string]: unknown;
}

/**
 * Storage, reduced to the four things this package actually does.
 *
 * Workers KV is what `kvStore()` implements, but nothing here knows that.
 * Upstash, Vercel KV, Deno KV or a Postgres table behind twenty lines of glue
 * all satisfy this, which is the point — the alternative is a package that
 * only works on one host and says so nowhere.
 */
export interface LeadStore {
  list(prefix: string): Promise<string[]>;
  get(key: string): Promise<LeadRecord | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** What a handler needs to do its job. Assembled by the adapter. */
export interface LeadsContext {
  store: LeadStore;
  /** Bearer token for CLI/API access. Omit to disable token auth entirely. */
  token?: string;
  /** Cloudflare Access. Omit both to disable Access auth entirely. */
  access?: { teamDomain: string; aud: string };
  /** KV key prefix. Must not collide with the audit prefix below. */
  prefix?: string;
  auditPrefix?: string;
  /** Seconds to keep an audit record. Default 400 days. */
  auditTtl?: number;
}

export const DEFAULT_PREFIX = 'lead:';
export const DEFAULT_AUDIT_PREFIX = 'audit:';
export const DEFAULT_AUDIT_TTL = 60 * 60 * 24 * 400;
