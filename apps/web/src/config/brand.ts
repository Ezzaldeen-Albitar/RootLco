/**
 * Centralised brand configuration.
 *
 * The final product name, logo and colour palette are PENDING OWNER INPUT
 * (OIR-01/ASM-01 for the name, OIR-06 for the visual identity). This module is
 * the single place the frontend learns any of them.
 *
 * The rule this file exists to enforce: **no component may import a logo asset
 * or a product name string directly.** Components consume `brand` or the
 * `<BrandMark />` adapter. `scripts/check-brand-isolation.mjs` fails the build
 * if a component references a logo path or writes the product name literally.
 *
 * When the owner supplies the final identity, the complete change set is:
 *   1. this file,
 *   2. `src/styles/tokens/_colors.scss`,
 *   3. `src/styles/themes/_provisional.scss` (renamed to the approved theme),
 *   4. the approved logo assets under `public/brand/`.
 * No button, table, dialog, form, sidebar or page is edited. That claim is
 * proven by `tests/brand-replacement.test.ts`, which performs the swap against
 * the real token pipeline and asserts no component file participates.
 */

/** How the brand mark is rendered while no approved logo asset exists. */
export type LogoMode = 'wordmark' | 'asset';

export interface BrandConfig {
  /**
   * The product name placeholder. RootLco is the COMPANY, not the product, and
   * must never be rendered as the product name — ADR-011 keeps the product name
   * pending final approval.
   */
  readonly systemName: string;
  /** Short form used where horizontal space is constrained (collapsed sidebar). */
  readonly systemShortName: string;
  /** `wordmark` renders text; `asset` renders `logoAsset`. */
  readonly logoMode: LogoMode;
  /** Path under `public/`. Only consulted when `logoMode === 'asset'`. */
  readonly logoAsset: string | null;
  /** Theme identifier written to `data-theme`; selects a token theme layer. */
  readonly primaryTheme: string;
  /** True while the identity above is provisional rather than owner-approved. */
  readonly isProvisional: boolean;
}

export const brand: BrandConfig = {
  systemName: '[SYSTEM NAME]',
  systemShortName: '[SN]',
  logoMode: 'wordmark',
  logoAsset: null,
  primaryTheme: 'provisional',
  isProvisional: true,
};

/**
 * Resolves what the brand mark should render.
 *
 * Returning a discriminated union rather than a component keeps this testable
 * without a DOM and keeps the decision in one place: a caller cannot
 * accidentally render an asset while `logoMode` says wordmark.
 */
export type BrandMarkModel =
  | { readonly kind: 'wordmark'; readonly text: string; readonly shortText: string }
  | { readonly kind: 'asset'; readonly src: string; readonly alt: string };

export function resolveBrandMark(config: BrandConfig = brand): BrandMarkModel {
  if (config.logoMode === 'asset' && config.logoAsset) {
    return { kind: 'asset', src: config.logoAsset, alt: config.systemName };
  }
  // Falls back to the wordmark when the mode says `asset` but no asset is
  // configured. A missing logo must degrade to readable text, never to a broken
  // image in an operational tool.
  return {
    kind: 'wordmark',
    text: config.systemName,
    shortText: config.systemShortName,
  };
}
