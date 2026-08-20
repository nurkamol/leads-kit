import type { LeadsContext } from '../types.js';
import {
  handleAudit,
  handleContacts,
  handleDelete,
  handleErasure,
  handleExport,
  handleSubjectAccess,
  handleSubmit,
  handleStatus,
  handleLeadsPage,
  type ExportOptions,
  type SubmitOptions,
  type LeadsPageHandlerOptions,
} from '../index.js';

/**
 * Next.js App Router route handlers.
 *
 * These receive a `Request` directly, so the adapter is the identity function
 * with a nicer name. It exists so that a Next project imports something that
 * says "next" and gets the notes below with it.
 *
 * Two things Next does NOT do for you that Astro does:
 *
 *   · No CSRF default. Astro ships `security.checkOrigin`; Next has no
 *     equivalent, so the delete route is reachable cross-site with the
 *     visitor's cookie unless you check `Origin` yourself in middleware.
 *     There is a sample in the plugin templates. Do not skip it.
 *   · No automatic dynamic rendering for these. Set
 *     `export const dynamic = 'force-dynamic'` on the route, or Next may cache
 *     the response — a cached enquiry export is a public one.
 *
 * Use the Node runtime, not Edge, if your store needs a Node driver. The
 * handlers themselves are web-standard and run on either.
 */
/**
 * A context, or something that produces one from the request.
 *
 * Next reads its env from `process.env`, which IS available at module scope,
 * so the plain-object form is usually fine here — unlike Astro on Cloudflare.
 * The factory is accepted anyway, for parity and for stores that need
 * per-request state.
 */
export type ContextSource = LeadsContext | ((request: Request) => LeadsContext);

const resolve = (source: ContextSource, request: Request): LeadsContext =>
  typeof source === 'function' ? source(request) : source;

export const nextExport = (source: ContextSource, options?: ExportOptions) => (request: Request) =>
  handleExport(request, resolve(source, request), options);

export const nextContacts = (source: ContextSource) => (request: Request) =>
  handleContacts(request, resolve(source, request));

export const nextDelete = (source: ContextSource, redirectTo?: string) => (request: Request) =>
  handleDelete(request, resolve(source, request), { redirectTo });

/**
 * The origin check Next does not give you.
 *
 * Returns a 403 Response when a state-changing request came from somewhere
 * else, or null when it is fine to proceed. A request with NO Origin and no
 * Referer is refused rather than allowed: same-origin form posts from a
 * browser always carry one, so the empty case is a non-browser client, and
 * those should be using the bearer token — which is not cookie-borne and so
 * is not subject to this attack in the first place.
 */
export function checkOrigin(request: Request, allowedOrigin: string): Response | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  if (request.headers.get('authorization')) return null;

  const origin =
    request.headers.get('origin') ??
    (request.headers.get('referer') ? new URL(request.headers.get('referer')!).origin : null);

  if (origin === allowedOrigin) return null;
  return new Response('Cross-site POST form submissions are forbidden\n', { status: 403 });
}

export const nextSubjectAccess = (source: ContextSource) => (request: Request) =>
  handleSubjectAccess(request, resolve(source, request));

export const nextErasure = (source: ContextSource) => (request: Request) =>
  handleErasure(request, resolve(source, request));

export const nextAudit = (source: ContextSource) => (request: Request) =>
  handleAudit(request, resolve(source, request));

/**
 * The submit route.
 *
 * Next has no `clientAddress`; on Vercel the trustworthy value is
 * `x-forwarded-for`'s FIRST entry, which the platform overwrites — but only
 * because the platform sits in front. Pass it explicitly via options rather
 * than having this guess, because on a self-hosted deployment behind an
 * arbitrary proxy that same header is whatever the client typed.
 */
export const nextSubmit = (source: ContextSource, options?: SubmitOptions) => (request: Request) =>
  handleSubmit(request, resolve(source, request), options);

export const nextStatus = (source: ContextSource, redirectTo?: string) => (request: Request) =>
  handleStatus(request, resolve(source, request), { redirectTo });

/** The bundled leads page. Set `export const dynamic = 'force-dynamic'`. */
export const nextLeadsPage =
  (source: ContextSource, options?: LeadsPageHandlerOptions) => (request: Request) =>
    handleLeadsPage(request, resolve(source, request), options);
