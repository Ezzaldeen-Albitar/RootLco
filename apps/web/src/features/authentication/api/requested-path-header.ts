/**
 * The request header `src/proxy.ts` writes with the path of the request being
 * served, so a protected layout — which Next does not hand a pathname — can name
 * the page it is refusing (P1-32-PRE-OD-AUTHB).
 *
 * ## It is untrusted input wherever it is read
 *
 * The proxy replaces any copy a client sent — on the requests the proxy RUNS
 * on. Its matcher leaves some out: a router prefetch (`next-router-prefetch`, or
 * `purpose: prefetch`) never reaches it, so on those a header the client sent
 * arrives at the render exactly as it was sent. The header is therefore never
 * authoritative on its own. Every reader must pass it through
 * `safeIntendedPath`, and there is one reader, `requestedPath()`, which does. A
 * value that passes names a page of this application and nothing else, which
 * is also all a hand-typed `?intended=` can do; a cross-site request cannot
 * carry the header at all.
 *
 * A module of its own, importing nothing, so the proxy can name the header
 * without pulling the navigation model and the permission rules that
 * `intended-path.ts` needs into the proxy bundle.
 */
export const REQUESTED_PATH_HEADER = 'x-rootlco-requested-path';
