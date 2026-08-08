/**
 * The CRM customer-creation contracts (`P1-27-FE-003`, `FE-004`, `FE-005`).
 *
 * Read out of `apps/api/src/app/api/v1/customers/{individuals,companies}/route.ts`
 * and `apps/api/src/modules/crm/domain/customer-creation.ts`.
 *
 * ## Two operations, one shape of decision
 *
 * | operation               | body                                                    |
 * | ----------------------- | ------------------------------------------------------- |
 * | `crm.individual-create` | `givenName`, `familyName` (≤100), `preferredLocale?`, `lifecycleStatus?` |
 * | `crm.company-create`    | `legalName` (≤200), `tradeName?`, `lifecycleStatus?`   |
 *
 * Both are `.strict()`, both require `crm.customer.create`, both are
 * **`idempotent: true`** — so both need an `Idempotency-Key`, which is why
 * `P1-27-INT-003` had to be fixed before this screen could exist.
 *
 * ## `lifecycleStatus` is narrower on create than on search
 *
 * Creation accepts **`prospect` or `active` only**. The search filter offers all
 * five, because a customer can *reach* `inactive`, `blocked` or `merged` — it
 * simply cannot be *born* there. A form offering the search vocabulary would
 * produce a 422 on three of its five options.
 *
 * ## The duplicate warning arrives AFTER creation, and that is the contract
 *
 * `P1-27-FE-003` is "CRM duplicate warning", and the obvious reading is a
 * pre-submit check. **There is no operation for that.** The only duplicate
 * detection available before a write is `crm.duplicate-scan`, which is a POST
 * that writes candidate rows and emits a `privileged` audit record — running it
 * on a keystroke, or even on blur, would fill the audit trail with scans nobody
 * asked for.
 *
 * What the contract does publish is `possibleDuplicates` on the **creation
 * response**: live customers already carrying the same normalised name. Its own
 * docblock is explicit that this is advisory and that "the customer *was*
 * created".
 *
 * So the warning this phase can honestly deliver has two halves, and both are
 * real:
 *
 *  1. **Before** — the search screen is the duplicate check. The create action
 *     is offered only after a search returned nothing, so an operator reaches
 *     the form having already looked.
 *  2. **After** — the creation result names the customers that share the name,
 *     with links, and says plainly that the record was created anyway.
 *
 * What must NOT happen is a form that appears to check for duplicates before
 * submitting and silently does not.
 */

/** `CREATABLE_LIFECYCLE_STATUSES` — narrower than the search vocabulary. */
export const CREATABLE_LIFECYCLE_STATUSES = ['prospect', 'active'] as const;
export type CreatableLifecycleStatus = (typeof CREATABLE_LIFECYCLE_STATUSES)[number];

export const MAX_PERSON_NAME = 100;
export const MAX_COMPANY_NAME = 200;

/** A live customer already carrying the proposed normalised name. */
export interface DuplicateNameMatch {
  readonly id: string;
  readonly displayName: string;
  readonly displayNumber: string | null;
}

/**
 * What both creations answer with.
 *
 * `displayNumber` is nullable and that is a supported state, not a failure: a
 * tenant without a provisioned customer-number sequence gets a customer with no
 * number yet. The screen must not present that as an error.
 */
export interface CreatedCustomer {
  readonly customerId: string;
  readonly displayNumber: string | null;
  readonly partyType: 'individual' | 'organization';
  readonly lifecycleStatus: string;
  readonly possibleDuplicates: readonly DuplicateNameMatch[];
}

/*
 * `validateIndividual`, `validateCompany` and their draft types are gone, for
 * the reason given at the foot of `governance-contract.ts` (`P1-27-FE-013`).
 *
 * Their docstring claimed they exist "so an operator learns which field is wrong
 * from the field, rather than from a banner that names none". Nothing called
 * them, so no operator ever got that — and the create form already gets exactly
 * what the docstring wanted, from the server: `createIndividualAction` returns
 * per-field catalogue keys through `fieldErrorsFrom`, and `CustomerCreateScreen`
 * renders each one beside its own field.
 *
 * They also disagreed with the server they mirrored. They emitted
 * `crm.customers.create.tooLong` where the action emits `field.tooLong`, so had
 * anything ever wired them up, the same overlong name would have produced two
 * different messages depending on which layer noticed first.
 */
