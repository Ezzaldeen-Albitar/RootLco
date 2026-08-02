/**
 * Whether the internal component gallery is reachable.
 *
 * The gallery renders every shared component with fixed fixtures. It contains no
 * customer data and no privileged capability, but it is an internal tool and a
 * production deployment should not serve it by default: it is a map of the
 * product's surface, and there is no reason to hand one out.
 *
 * `ROOTLCO_ENABLE_GALLERY=true` opts a deployed environment back in — useful
 * for a staging environment a designer reviews.
 *
 * The route calls `notFound()` rather than returning 403. A 403 confirms the
 * route exists; a 404 says nothing at all, and no legitimate visitor needs to
 * know the difference.
 */
export interface GalleryEnv {
  readonly NODE_ENV?: string | undefined;
  readonly ROOTLCO_ENABLE_GALLERY?: string | undefined;
}

export function galleryEnabled(env: GalleryEnv = process.env): boolean {
  if (env.ROOTLCO_ENABLE_GALLERY === 'true') return true;
  return env.NODE_ENV !== 'production';
}
