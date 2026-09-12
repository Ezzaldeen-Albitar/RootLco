'use server';

import { branchTargetQuery, readOperation, type ReadState } from '@/lib/api/read-operation';
import { employeePageSize, type EmployeePage, type EmployeeSummary } from './employee-contract';

/**
 * The two employee reads the handover surface issues (P1-31, FE-002).
 *
 * Nothing here fetches. `readOperation` calls `authorizedClient()`, the only
 * network owner in this application, and turns a transport outcome into a view
 * state — so a refusal reaches the picker as a refusal and never as an empty
 * list, which an operator reads as "there is nobody here" when the truth is
 * "you may not see them".
 *
 * ## A separate module from `api.ts`, deliberately
 *
 * `api.ts` holds the delivery operations. These two are the ORGANISATION's, on
 * their own permission and their own lifetime, and the only thing they have in
 * common with a handover is the screen that starts one. Keeping them apart is
 * what lets the register be consumed without the delivery adapters growing a
 * second subject.
 *
 * ## The branch pair is a TARGET, not a scope assertion
 *
 * `org.employee-list` makes both halves mandatory and authorizes exactly that
 * pair before a row is read, so they travel through `branchTargetQuery` rather
 * than among the ordinary filters: that helper is the only door `lib/api` opens
 * for a resource pair, and `query()` refuses both names outright.
 *
 * ## The page ceiling is applied BEFORE the request
 *
 * The route refuses a page above its own bound instead of clamping it, so a
 * caller that asks for more is answered with an error rather than a short page.
 * `employeePageSize` caps the number here, which is the difference between a
 * limit this side knew about and an error the operator is blamed for.
 *
 * ## The cursor is the server's, and so is the end of the set
 *
 * `cursor` is passed back exactly as it arrived and never parsed; `hasMore` and
 * `nextCursor` are the server's own end-of-set signals. No total is requested
 * and none is invented, because the read publishes none.
 *
 * ## Neither read decides anything
 *
 * These publish who the organisation has on its register. Whether one of them
 * may be named on a handover is decided by the create operation and by the
 * database, and this tier mirrors no part of that rule.
 */

/**
 * One branch's employee register (`org.employee-list`).
 *
 * `status` is sent when the caller means it and omitted otherwise: the route's
 * query schema is `.strict()`, so a parameter is either meant or not sent, and
 * an omitted status lists retired employees too — which is what an
 * administration screen would want and is therefore not narrowed away here.
 */
export async function listEmployees(input: {
  readonly companyId: string;
  readonly branchId: string;
  readonly status?: string | undefined;
  readonly cursor?: string | null | undefined;
  readonly limit?: number | undefined;
}): Promise<ReadState<EmployeePage>> {
  return readOperation<EmployeePage>(
    '/api/v1/org/employees' +
      branchTargetQuery(
        { companyId: input.companyId, branchId: input.branchId },
        {
          status: input.status ?? null,
          cursor: input.cursor ?? null,
          limit: employeePageSize(input.limit ?? 0),
        }
      )
  );
}

/**
 * One employee of the register (`org.employee-detail`).
 *
 * A `not-found` covers absent, soft-deleted, out of reach and another
 * organisation's alike: the backend answers all four the same way on purpose,
 * because distinguishing them would turn this read into a way to enumerate
 * another organisation's people.
 *
 * **It has no production consumer at this head**, and that is said here rather
 * than left to be inferred from its test count. It is published because the
 * register's detail read is the pair of the list this feature does consume, and
 * because the surface that will consume it — resolving the person named on a
 * handover recorded before the register existed, which carries a reference and
 * no stored name — is named as a follow-up in
 * `docs/phase-1/phase-1-31/delivery-start-selector.md` rather than improvised
 * into this slice. The same statement is kept beside `fieldErrorsOf` in
 * `lib/api/client.ts`, for the same reason.
 */
export async function readEmployee(employeeId: string): Promise<ReadState<EmployeeSummary>> {
  return readOperation<EmployeeSummary>(`/api/v1/org/employees/${encodeURIComponent(employeeId)}`);
}
