import { kvStore, type LeadsContext } from '@nurkamol/leads-kit';
import { site } from '../data/site';
import { configValue, kv, secret } from './runtime';

/**
 * Assemble the leads-kit context from this project's bindings.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A CONSTANT ─────────────────────────────
 * `env` from `cloudflare:workers` is a lazy proxy: importing it at module
 * scope is fine, but READING a property outside a request context throws. So
 * every caller passes this function to the adapter rather than calling it —
 * leads-kit's adapters accept a factory precisely for this, and a constant
 * here would throw at the first request with a message about a proxy rather
 * than about configuration.
 *
 * Returns null when the KV namespace is not bound, so the route can answer
 * 503 rather than the package failing on a store that is not there. A missing
 * binding is a deployment problem and should read like one.
 */
export function leadsContext(): LeadsContext | null {
  const store = kv(site.leadsBinding);
  if (!store) return null;

  return {
    store: kvStore(store),
    token: secret('LEADS_EXPORT_TOKEN'),
    access: {
      teamDomain: configValue('ACCESS_TEAM_DOMAIN') ?? '',
      aud: configValue('ACCESS_AUD') ?? '',
    },
    /*
     * LOAD-BEARING, not decorative.
     *
     * Every write that REWRITES a record — a status change, most obviously —
     * needs this. KV cannot update a value while keeping its remaining expiry:
     * a put without a TTL removes the expiry entirely, and one with the full
     * retention period restarts it. Marking a lead "replied" on day 364 would
     * silently grant it another year, outliving the promise on /privacy with
     * nothing anywhere to report it.
     *
     * With this set, leads-kit computes what is LEFT from the original
     * receivedAt. Without it, the protection cannot engage.
     */
    retentionSeconds: site.leadRetentionDays * 24 * 60 * 60,

    /* Longer than the leads themselves, deliberately: "why is this gone" gets
       asked long after the record has expired. */
    auditTtl: 60 * 60 * 24 * 400,
  };
}

/** The 503 every leads route gives when the namespace is not bound. */
export const noStore = () => new Response('Lead storage is not bound.\n', { status: 503 });
