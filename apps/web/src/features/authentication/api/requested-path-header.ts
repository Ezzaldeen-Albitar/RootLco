/**
 * The request header `src/proxy.ts` writes with the path of the request being
 * served, so a protected layout — which Next does not hand a pathname — can name
 * the page it is refusing (P1-32-PRE-OD-AUTHB). The proxy overwrites any copy a
 * client sent, and the value is re-checked by `safeIntendedPath` wherever it is
 * read.
 *
 * A module of its own, importing nothing, so the proxy can name the header
 * without pulling the navigation model and the permission rules that
 * `intended-path.ts` needs into the proxy bundle.
 */
export const REQUESTED_PATH_HEADER = 'x-rootlco-requested-path';
