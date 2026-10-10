/**
 * The branch directory, as the handover surface consumes it (P1-31, FE-002).
 *
 * | operation         | method | path            | permissions (ALL required) |
 * | ----------------- | ------ | --------------- | -------------------------- |
 * | `org.branch-list` | GET    | `/org/branches` | `org.branch.read`          |
 *
 * Typed from the route that owns the shape —
 * `apps/api/src/app/api/v1/org/branches/route.ts` — and narrowed to the three
 * fields a picker needs, which is the same projection
 * `readiness-contract.ts` takes of the same operation one screen over.
 *
 * ## Why this exists at all
 *
 * The register read this surface issues makes a company and a branch mandatory,
 * and the create operation applies no branch rule — the Owner's clarification of
 * 2026-09-10 removed it from the database — so the form has to let a second
 * branch be named. It named one by REFERENCE until this change, which asked an
 * operator to type an identifier: the standing tenancy requirement is that no
 * company or branch identifier is ever typed, and a field that demands one makes
 * the cross-branch handover unreachable in practice rather than merely awkward.
 * The directory is published already, and every other picker in the product
 * reads it.
 *
 * ## The company is not a second read
 *
 * The operation is tenant-wide and every row carries its company, so the
 * branches of the work order's own company are the rows whose company matches
 * the one the work order is already on. No company directory is read, and no
 * company may be chosen: a handover belongs to its work order's organisation.
 *
 * ## Nothing here decides reach
 *
 * The list is an affordance. `sel_branches_scope` decides which branches a
 * caller may see, the register read authorizes the pair again before a row is
 * read, and the create operation resolves the chosen person once more. This tier
 * composes no rule of its own.
 */

/** The permission `org.branch-list` registers. */
export const BRANCH_DIRECTORY_PERMISSIONS = {
  /**
   * The directory read, and nothing more. It is not implied by either delivery
   * code and it is not the authority that administers a branch — a picker must
   * never require the power to change the thing it lists.
   */
  read: 'org.branch.read',
} as const;

/**
 * One branch of the directory, narrowed to what a picker names it by.
 *
 * The operation publishes more — a code, a city, a country, a timezone and a
 * state — and none of it is read here: a field this surface does not render is a
 * field it has no business typing.
 */
export interface DeliveryBranchOption {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
}
