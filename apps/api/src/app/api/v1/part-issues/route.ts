/**
 * GET /api/v1/part-issues — a branch's issued parts, by name (Owner directive,
 * P1-32-PRE-OD-UX).
 *
 * ## The screen this exists for
 *
 * A customer brings a part back. The clerk is holding the PART — it has a name
 * printed on it and a code on its packaging — and has no work order in hand,
 * because the job is the thing they are trying to recover. Until now the only
 * read over `inv.part_issues` was keyed on a work order
 * (`inv.work-order-part-issue-list`), so the customer-returns screen could offer
 * nothing to pick from and asked for a typed reference instead. This read is the
 * picker: search by what is in front of you, choose the line, and the remainder
 * that may still come back is on the row.
 *
 * `inv.work-order-part-issue-list` is untouched. It answers a different question
 * from a parent the caller has already opened, and its shipped refusal shape is
 * not this change's to reshape.
 *
 * ## Why a top-level collection is legitimate here, and was not before
 *
 * That read's own docblock records the reason a `GET /stock-issues?workOrderId=…`
 * was refused: `requiresScopedEvaluation` returns false on an EMPTY target
 * whatever the declared scope, so a collection narrowed only by a query parameter
 * would carry `scope: 'branch'` and still be evaluated scope-blind (P1-18-A-01),
 * leaving `app.branch_ids` — the permission-blind union of every active grant —
 * as the only narrowing.
 *
 * Nothing about that argument has been relaxed; what changed is that the query
 * now carries a target. `companyId` is REQUIRED, and a named `branchId` makes the
 * pair the `authorizationTarget` through `scopeTargetOption`, so the check runs
 * against the branch actually read. An OMITTED `branchId` — which the Owner
 * directive makes legitimate on the boards this mirrors — is not a gap either:
 * `branchNarrowing: 'authorized-union'` binds the `authorizedBranches` seam,
 * which evaluates THIS operation's declared codes once per candidate branch of
 * the named company and refuses a caller holding none. The page is then the union
 * of the branches that passed, never the union of every grant.
 *
 * ## The box
 *
 * `q` reaches the item's name, the item's code, the work order's display number,
 * the plate the vehicle has carried and its VIN — all folded by the same rules
 * the stored columns were folded by, never re-derived in SQL. It does NOT reach a
 * customer's name or the tail of their phone number: this page carries no
 * customer data at all, so a customer arm would turn a stock read into a way of
 * probing the partner register while answering nothing the caller can see.
 *
 * ## The window
 *
 * `issuedFrom` and `issuedTo` are instants with an explicit offset, compared as
 * instants. An inverted pair is refused with a CATALOGUED rule token rather than
 * answered with an empty page: a window that matches nothing by construction
 * would read as "this branch issued nothing", which is a different sentence from
 * "the dates are the wrong way round". The token is what the browser turns into a
 * sentence in the operator's own language; a `superRefine` could only carry
 * `custom`, which the problem document does not publish.
 *
 * ## Quantities
 *
 * `quantity`, `returnedQuantity` and `returnableQuantity` are `numeric(12, 3)`
 * decimal STRINGS. The remainder is subtracted by PostgreSQL over
 * `inv.returned_quantity` — the same function the return ceiling is enforced with
 * — and all three operands travel, so the arithmetic is checkable. It is
 * ADVISORY: no lock is taken by a read, and the binding ceiling is re-checked
 * under the source row lock when the return is received.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { AppFailure } from '@/server/errors/app-failure';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { MAX_SEARCH_FRAGMENT, MIN_SEARCH_FRAGMENT } from '@/shared/text/search-terms';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    /**
     * OPTIONAL, and the omission is answered by the authorized union rather than
     * by every branch RLS admits. See the docblock above; the seam refuses a
     * caller that holds this operation's codes in no branch of the company.
     */
    branchId: schemas.uuid.optional(),
    workOrderId: schemas.uuid.optional(),
    itemId: schemas.uuid.optional(),
    /** Inclusive bounds on the instant the part left the store. */
    issuedFrom: z.string().datetime({ offset: true }).optional(),
    issuedTo: z.string().datetime({ offset: true }).optional(),
    /**
     * One free-text box: part of the item's name, part of its code, part of the
     * work-order number, part of any plate the vehicle has carried, or part of
     * its VIN.
     */
    q: z.string().min(MIN_SEARCH_FRAGMENT).max(MAX_SEARCH_FRAGMENT).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

/**
 * The one cross-field refusal this query carries, as a CATALOGUED rule token.
 *
 * Asserted here rather than in a `superRefine`, and the difference is what the
 * caller receives: `toViolations` publishes `issue.code` as the rule and every
 * refinement issue carries `custom`, so a refinement could only state its reason
 * in an English message the problem document never publishes.
 */
function assertWindowCoherent(query: z.infer<typeof ListQuery>): void {
  if (query.issuedFrom === undefined || query.issuedTo === undefined) return;
  // Compared as INSTANTS: both values carry an explicit offset, and a lexical
  // comparison of offset-bearing ISO strings is wrong in both directions.
  if (Date.parse(query.issuedTo) >= Date.parse(query.issuedFrom)) return;
  throw new AppFailure('ERR-VAL-001', {
    // Not published: `problemFor` renders the catalogue title and the violations,
    // never this string. It exists for the log line.
    message: 'The issued-parts query asks for a window that runs backwards',
    safeDetails: {
      violations: [{ path: 'query.issuedTo', rule: 'issued_window_inverted' }],
    },
  });
}

export const PART_ISSUE_LIST_OPERATION = defineOperation({
  id: 'inv.part-issue-list',
  module: 'inventory',
  method: 'GET',
  path: '/part-issues',
  summary: "List a branch's issued parts by item, job or window, newest first.",
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  branchNarrowing: 'authorized-union',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    PART_ISSUE_LIST_OPERATION,
    request,
    async ({ db, authorizeScope, authorizedBranches }) => {
      // Parsed INSIDE the handler so a malformed query renders the shared problem
      // document rather than escaping as an unhandled 500.
      const query = parseOrFail(ListQuery, raw, 'query');
      assertWindowCoherent(query);
      // A named branch was already decided by the `scopeTargetOption` target
      // below and is decided again by the service; an omitted one is resolved
      // here, inside the transaction, against the caller's own grants.
      const branchIds =
        query.branchId === undefined ? await authorizedBranches(query.companyId) : [query.branchId];
      return {
        body: await inventoryModule().reads.listIssuedParts(
          db,
          {
            companyId: query.companyId,
            ...(query.branchId === undefined ? {} : { branchId: query.branchId }),
            branchIds,
            ...(query.workOrderId === undefined ? {} : { workOrderId: query.workOrderId }),
            ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
            ...(query.issuedFrom === undefined ? {} : { issuedFrom: query.issuedFrom }),
            ...(query.issuedTo === undefined ? {} : { issuedTo: query.issuedTo }),
            ...(query.q === undefined ? {} : { q: query.q }),
          },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    // The target comes from the RAW query, before validation: `handleOperation`
    // needs it to choose the scoped permission evaluation, and a pair that is not
    // two uuids yields no target — which can only ever make the check stricter,
    // never wider (P1-18-A-01).
    scopeTargetOption(raw)
  );
}
