import type { ReadState } from '@/lib/api/read-operation';
import type { ReceivingEmployeeIdentity } from '../support-api';

/**
 * What the two read-back surfaces know about the receiving employee
 * (`P1-28-FE-007`, `FE-021`).
 *
 * ## The defect this replaces
 *
 * Both surfaces rendered `detail.receivingEmployeeId` inside a `<code>` element:
 * the wizard header, and the acknowledgement sheet a customer signs and takes
 * away. `canonical-plan.md` §7 disposes of G-EMP with one sentence — **"The UI
 * shows names, never UUIDs."** — and a DOM case asserted the identifier was on
 * screen, so the defect had a test holding it in place.
 *
 * The name was resolvable the whole time. `iam.user-detail` is registered
 * (`GET /api/v1/iam/users/{userId}`, `iam.user.read`), and that is the SAME code
 * the check-in screen's employee picker already consumes and already discloses
 * beside the control — so resolving the name widens nobody's access and adds no
 * new disposition. `staff-directory.ts` already names `iam.user-detail` as one
 * of the three operations that code opens.
 *
 * ## Four outcomes, because the platform genuinely has four
 *
 * `named` is the ordinary one. The other three are not error handling bolted
 * on; each is a different fact, and collapsing them would put a falsehood on a
 * customer's copy:
 *
 *   - `denied` — the caller does not hold `iam.user.read`, decided BEFORE any
 *     request where the route can see it. Nothing is claimed about who received
 *     the vehicle, because nothing was learned.
 *   - `unresolved` — the read answered 404. `receiving_employee_id` has **no
 *     foreign key** (G-EMP), so an identifier naming no account is a state the
 *     database permits, and it is said plainly. This is the one case where
 *     printing the identifier would be actively misleading: a dangling value
 *     rendered where a person's name goes reads as a person.
 *   - `unavailable` — the read did not answer. Distinct from `unresolved` on
 *     purpose: `F1` on this very document was a failed read printed as an
 *     observed absence, and "this identifier names nobody" is an observation
 *     while "we could not ask" is not one.
 *
 * In none of them does the identifier reach the screen. It is not a name, it is
 * not useful to a receptionist or a customer, and the G-EMP note that already
 * sits under the field says what is recorded.
 */
export type ReceivingEmployee =
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
export const RECEIVING_EMPLOYEE_NOTICE_KEYS = {
  denied: 'receptions.wizard.receivingEmployeeDenied',
  unresolved: 'receptions.wizard.receivingEmployeeUnresolved',
  unavailable: 'receptions.wizard.receivingEmployeeUnavailable',
} as const satisfies Readonly<Record<Exclude<ReceivingEmployee['status'], 'named'>, string>>;

/**
 * The outcome of the directory read, as one of the four states above.
 *
 * `read` is `null` when the caller holds no directory permission and the route
 * therefore spent no request — the same posture every P1-28 route takes toward a
 * gate it can decide itself. A `denied` coming back from the BACKEND lands on
 * the same state deliberately: the operator's answer is identical, and naming
 * which tier refused tells a customer's copy about the workshop's own
 * permissions.
 *
 * An expired session is `unavailable` rather than `denied`. Nothing was learned
 * about the permission, and the surrounding page has its own answer for an
 * expired session; claiming a denial here would be inventing a cause.
 */
export function resolveReceivingEmployee(
  read: ReadState<ReceivingEmployeeIdentity> | null
): ReceivingEmployee {
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
