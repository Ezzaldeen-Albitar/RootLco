/**
 * Application identity constants.
 *
 * The software product name is NOT decided. RootLco is the company, vendor and
 * platform owner -- it is deliberately not used as the product name. See ADR-011.
 */

/** Controlled placeholder. Do not replace until the owners approve a product name. */
export const PRODUCT_NAME_PLACEHOLDER = '[PRODUCT NAME — Pending Final Approval]';

/** Temporary descriptive title approved for interim use. */
export const DESCRIPTIVE_TITLE = 'Commercial Multi-Tenant Automotive CRM and ERP Platform';

/** Vendor / platform owner. Never the product name. */
export const VENDOR_NAME = 'RootLco — Root Link Company';

/** Service identifier reported by /api/health. Safe to expose. */
export const APP_NAME = 'rootlco-platform';

/** Build identity. Injected at image build time; falls back to a safe literal. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0';
export const COMMIT_SHA = process.env.NEXT_PUBLIC_COMMIT_SHA ?? 'unknown';
