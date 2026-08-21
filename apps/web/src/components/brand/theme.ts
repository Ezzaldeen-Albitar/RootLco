import { brand } from '@/config/brand';

/**
 * The theme identifier written to `data-theme` on <html>.
 *
 * Routes need this to boot the token theme, but they must not import the brand
 * configuration to get it — that would put an identity import in the routing
 * layer and quietly break the "one consumer" rule the brand gate enforces.
 * Exposing it here keeps `@/config/brand` behind the brand layer.
 */
export const brandTheme: string = brand.primaryTheme;

/** True while the appearance is provisional rather than owner-approved. */
export const brandIsProvisional: boolean = brand.isProvisional;

/**
 * The product name, for places that need it as TEXT rather than as a mark.
 *
 * The document title is the case this exists for: it is metadata, not markup,
 * so `<BrandMark />` cannot supply it. Exposing it here keeps the routing layer
 * from importing `@/config/brand`, which the isolation gate forbids and which
 * would make the brand replaceable in one file plus one more.
 */
export const brandProductName: string = brand.systemName;

/**
 * The href for the browser tab icon.
 *
 * Exposed here for the same reason as `brandTheme`: the root layout must declare
 * an icon, but a `/brand/*.png` literal in `src/app/` is exactly what the
 * `logo-asset` rule forbids. Reading it through the brand layer keeps the asset
 * path inside the configuration, where a swap is one edit.
 *
 * Falls back to the SVG placeholder so the icon is always declared — an
 * undeclared icon makes real Chrome probe `/favicon.ico`, and the 404 fails the
 * clean-console browser gate.
 */
export const brandIconHref: string = brand.logoAsset ?? '/favicon.svg';
