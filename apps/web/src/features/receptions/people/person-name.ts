import type { ReadState } from '@/lib/api/read-operation';
import type { UserIdentity } from '../support-api';

/**
 * What a read-back surface knows about the PERSON behind an account identifier
 * (`P1-28-FE-021`, and every `person` field in `EvidencePanels`).
 *
 * ## What this module is not, any more
 *
 * It was `check-in/receiving-employee.ts`, and it was named after its first
 * consumer rather than after what it does. The receiving employee no longer
 * needs it: `DBCR-P1-18-002` gave `rec.reception_visits` an immutable
 * `receiving_employee_display_name` snapshot, so the wizard header and the
 * customer's acknowledgement sheet read the name off the visit itself. Resolving
 * it through the user directory would now be worse than unnecessary — it would
 * answer with the account's name TODAY, and a rename would silently rewrite who
 * a customer was told received their vehicle.
 *
 * What genuinely still needs a directory read is the other population: the
 * ACTORS on a read-back — who recorded an inspection, who bound a piece of
 * evidence, who signed. Those are audit identifiers with no snapshot, and they
 * are what this module now serves.
 *
 * ## The defect the four outcomes exist to prevent
 *
 * Two surfaces rendered a bare identifier inside a `<code>` element, one of them
 * the sheet a customer signs and takes away. `canonical-plan.md` §7 disposes of
 * this with one sentence — **"The UI shows names, never UUIDs."** — and a DOM
 * case asserted the identifier was on screen, so the defect had a test holding
 * it in place.
 *
 * ## Four outcomes, because the platform genuinely has four
 *
 * `named` is the ordinary one. The other three are not error handling bolted on;
 * each is a different fact, and collapsing them would put a falsehood on screen:
 *
 *   - `denied` — the caller does not hold `iam.user.read`, decided BEFORE any
 *     request where the route can see it. Nothing is claimed about who acted,
 *     because nothing was learned.
 *   - `unresolved` — the read answered 404. An audit identifier is a record of
 *     who acted, not a live foreign key, so an identifier naming no current
 *     account is a state the platform permits, and it is said plainly. This is
 *     the one case where printing the identifier would be actively misleading: a
 *     dangling value rendered where a person's name goes reads as a person.
 *   - `unavailable` — the read did not answer. Distinct from `unresolved` on
 *     purpose: `F1` on the acknowledgement document was a failed read printed as
 *     an observed absence, and "this identifier names nobody" is an observation
 *     while "we could not ask" is not one.
 *
 * In none of them does the identifier reach the screen. It is not a name, and it
 * is not useful to a receptionist or a customer.
 */
export type PersonName =
  | { readonly status: 'named'; readonly displayName: string }
  | { readonly status: 'denied' }
  | { readonly status: 'unresolved' }
  | { readonly status: 'unavailable' };

/**
 * What each non-name outcome says, in both catalogues.
 *
 * `as const satisfies` rather than an annotation: the annotation would widen
 * every value to `string`, and `translate` takes `keyof Messages` precisely so a
 * mistyped key is a compile error rather than a key rendered on a screen. The
 * `satisfies` half keeps the other guarantee — a fourth outcome added to the
 * union above fails here until it has something to say.
 */
export const PERSON_NAME_NOTICE_KEYS = {
  denied: 'receptions.wizard.receivingEmployeeDenied',
  unresolved: 'receptions.wizard.receivingEmployeeUnresolved',
  unavailable: 'receptions.wizard.receivingEmployeeUnavailable',
} as const satisfies Readonly<Record<Exclude<PersonName['status'], 'named'>, string>>;

/**
 * The outcome of the directory read, as one of the four states above.
 *
 * `read` is `null` when the caller holds no directory permission and the route
 * therefore spent no request — the same posture every P1-28 route takes toward a
 * gate it can decide itself. A `denied` coming back from the BACKEND lands on
 * the same state deliberately: the operator's answer is identical, and naming
 * which tier refused tells a reader about the workshop's own permissions.
 *
 * An expired session is `unavailable` rather than `denied`. Nothing was learned
 * about the permission, and the surrounding page has its own answer for an
 * expired session; claiming a denial here would be inventing a cause.
 */
export function resolvePersonName(read: ReadState<UserIdentity> | null): PersonName {
  if (read === null) return { status: 'denied' };
  switch (read.status) {
    case 'ok':
      // A blank name is not a name. The account exists and has nothing to show
      // for it, which is the same thing to a reader as an identifier that
      // resolves to nobody — and better said than rendered as empty space.
      return read.data.displayName.trim() === ''
        ? { status: 'unresolved' }
        : { status: 'named', displayName: read.data.displayName };
    case 'denied':
      return { status: 'denied' };
    case 'not-found':
      return { status: 'unresolved' };
    default:
      return { status: 'unavailable' };
  }
}
