/**
 * CRM customer creation — domain contract (Phase 1-16, FR-CRM-001, FR-CRM-002).
 *
 * Pure: no database, no framework, no I/O. It owns the two rules that must hold
 * no matter which edge calls them.
 *
 * ## 1. The party type is structural, not a field the caller decorates
 *
 * `crm.business_partners` carries a `party_type` discriminator, and the profile
 * children FK `(tenant_id, partner_id, party_type)` — so an individual profile
 * can attach only to an `individual` partner and a company profile only to an
 * `organization`. The route decides the type from the *path* it serves
 * (`/customers/individuals` vs `/customers/companies`); it is never read from
 * the body. That removes the whole class of "create an individual carrying a
 * company profile" confusions before validation is even reached.
 *
 * ## 2. `display_name` is derived, never supplied
 *
 * The database enforces `btrim(display_name) <> ''`, and search matches on
 * `crm.normalize_name(display_name)`. If a caller could post `displayName`
 * independently of the profile names, the searchable identity and the legal
 * identity would drift apart silently. So the name is *computed* here from the
 * profile fields — one derivation, used by both the partner row and the search
 * projection.
 */

/** Lifecycle statuses a **new** customer may be created in. */
export const CREATABLE_LIFECYCLE_STATUSES = ['prospect', 'active'] as const;
export type CreatableLifecycleStatus = (typeof CREATABLE_LIFECYCLE_STATUSES)[number];

/** Bounds mirror the column comments and keep a single oversized field cheap. */
export const MAX_PERSON_NAME = 100;
export const MAX_COMPANY_NAME = 200;

export interface IndividualCreationInput {
  readonly givenName: string;
  readonly familyName: string;
  readonly preferredLocale?: string | null | undefined;
  readonly lifecycleStatus?: CreatableLifecycleStatus | undefined;
}

export interface CompanyCreationInput {
  readonly legalName: string;
  readonly tradeName?: string | null | undefined;
  readonly lifecycleStatus?: CreatableLifecycleStatus | undefined;
}

/** A validated creation request, in the shape the repository writes. */
export interface CustomerCreationPlan {
  readonly partyType: 'individual' | 'organization';
  readonly displayName: string;
  readonly lifecycleStatus: CreatableLifecycleStatus;
}

/**
 * Raised for a domain rule the edge schema cannot express.
 *
 * Carries a `path` so the application layer can map it to the platform's
 * validation problem document without inventing wording per call site.
 */
export class CustomerCreationError extends Error {
  constructor(
    readonly path: string,
    readonly rule: string,
    message: string
  ) {
    super(message);
    this.name = 'CustomerCreationError';
  }
}

/**
 * Collapses runs of whitespace and trims.
 *
 * `z.string().min(1)` accepts `"   "`, which would reach
 * `ck_business_partners_display_name_not_blank` as a constraint violation — a
 * 500-shaped failure for what is plainly bad input. Collapsing here turns it
 * into an explained 422 instead.
 */
export function collapseName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function requireNonBlank(value: string, path: string): string {
  const collapsed = collapseName(value);
  if (collapsed === '') {
    throw new CustomerCreationError(path, 'blank', 'Value must contain a non-whitespace character');
  }
  return collapsed;
}

/** Individual identity: `given family`, each collapsed, joined by one space. */
export function toIndividualPlan(input: IndividualCreationInput): {
  readonly plan: CustomerCreationPlan;
  readonly givenName: string;
  readonly familyName: string;
} {
  const givenName = requireNonBlank(input.givenName, 'body.givenName');
  const familyName = requireNonBlank(input.familyName, 'body.familyName');
  return {
    plan: {
      partyType: 'individual',
      displayName: `${givenName} ${familyName}`,
      lifecycleStatus: input.lifecycleStatus ?? 'prospect',
    },
    givenName,
    familyName,
  };
}

/**
 * Company identity: the **legal** name.
 *
 * The trade name is an alias and is stored, but it is deliberately not the
 * display identity: two companies may trade under the same brand while being
 * distinct legal entities, and the searchable identity has to be the one that
 * distinguishes them.
 */
export function toCompanyPlan(input: CompanyCreationInput): {
  readonly plan: CustomerCreationPlan;
  readonly legalName: string;
  readonly tradeName: string | null;
} {
  const legalName = requireNonBlank(input.legalName, 'body.legalName');
  const tradeName =
    input.tradeName === undefined || input.tradeName === null
      ? null
      : requireNonBlank(input.tradeName, 'body.tradeName');
  return {
    plan: {
      partyType: 'organization',
      displayName: legalName,
      lifecycleStatus: input.lifecycleStatus ?? 'prospect',
    },
    legalName,
    tradeName,
  };
}
