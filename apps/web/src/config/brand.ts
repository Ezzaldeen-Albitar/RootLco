/**
 * Centralised brand configuration.
 *
 * The product name is the Owner-approved working name "CRM" (OIR-01) and the
 * palette is derived from the approved anchors (OIR-06, resolved). The name is
 * TEMPORARILY approved and expected to change, which is exactly why it lives
 * here: replacing it is this one field, not a search across the tree. This
 * module is
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
 *
 * ## The product mark and the company mark are two different things
 *
 * The Owner supplied two assets in the P1-26 acceptance remediation:
 *
 *   - an abstract interlaced monogram (302x378), which carries no name and is
 *     therefore usable as the PRODUCT symbol; and
 *   - a wordmark (465x262) which reads **"rootlco"** — the COMPANY name.
 *
 * They are wired to different slots deliberately. ADR-011 and the
 * `company-as-product` rule in `scripts/check-brand-isolation.mjs` both say the
 * same thing: RootLco is the company and must never be rendered AS the product
 * name. A company wordmark shown in the product's own name slot would break
 * that silently, because the gate matches a string and an image carries none.
 *
 * So the product identity is `symbol + systemName`, and the company wordmark is
 * an attribution rendered by `CompanyMark` where a company mark belongs. If the
 * Owner later supplies a true product wordmark, it becomes `logoAsset` and this
 * file is still the only code that changes.
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
  /**
   * Intrinsic pixel size of `logoAsset`. Supplied so the element can reserve its
   * box before the bytes arrive — an image without a declared aspect ratio
   * reflows the header it sits in.
   */
  readonly logoAssetSize?: { readonly width: number; readonly height: number };
  /**
   * The legal company. Rendered as an attribution, never as the product name.
   * This module is the ONLY place the string may appear — see the
   * `company-as-product` rule.
   */
  readonly companyName?: string;
  /** Path under `public/` for the company wordmark, or null when none exists. */
  readonly companyWordmarkAsset?: string | null;
  /** Intrinsic pixel size of `companyWordmarkAsset`. */
  readonly companyWordmarkSize?: { readonly width: number; readonly height: number };
  /** Theme identifier written to `data-theme`; selects a token theme layer. */
  readonly primaryTheme: string;
  /** True while the identity above is provisional rather than owner-approved. */
  readonly isProvisional: boolean;
}

export const brand: BrandConfig = {
  systemName: 'CRM',
  systemShortName: 'CRM',
  logoMode: 'asset',
  logoAsset: '/brand/crm-symbol.png',
  logoAssetSize: { width: 302, height: 378 },
  companyName: 'RootLco',
  companyWordmarkAsset: '/brand/rootlco-wordmark.png',
  companyWordmarkSize: { width: 465, height: 262 },
  primaryTheme: 'approved',
  isProvisional: false,
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

/**
 * The intrinsic size of the product asset, or null when the mark is text.
 *
 * Separate from `resolveBrandMark` on purpose: `BrandMarkModel` is asserted
 * shape-for-shape by `tests/brand-replacement.test.ts`, and widening a
 * discriminated union to carry layout data would couple the identity decision
 * to the rendering decision. This answers a different question.
 */
export function resolveBrandMarkSize(
  config: BrandConfig = brand
): { readonly width: number; readonly height: number } | null {
  if (config.logoMode !== 'asset' || !config.logoAsset) return null;
  return config.logoAssetSize ?? null;
}

/** The company attribution. `null` when no company wordmark is configured. */
export type CompanyMarkModel = {
  readonly src: string;
  readonly alt: string;
  readonly width: number | null;
  readonly height: number | null;
};

/**
 * Resolves the COMPANY mark, which is not the product mark.
 *
 * Returns null rather than falling back to text: an absent company attribution
 * is simply absent, whereas an absent product mark must still name the product.
 * The two have different failure modes and therefore different resolvers.
 */
export function resolveCompanyMark(config: BrandConfig = brand): CompanyMarkModel | null {
  if (!config.companyWordmarkAsset || !config.companyName) return null;
  return {
    src: config.companyWordmarkAsset,
    alt: config.companyName,
    width: config.companyWordmarkSize?.width ?? null,
    height: config.companyWordmarkSize?.height ?? null,
  };
}
