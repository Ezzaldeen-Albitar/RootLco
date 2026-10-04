/**
 * Employee types.
 *
 * Separate from `api.ts` and `actions.ts` because both are `'use server'`, and a
 * Server Action module may export only async functions.
 */

/** An employee as `org.employee-list` publishes it. */
export interface EmployeeView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly displayName: string;
  /** Null when this person has no login account — the reason the register exists. */
  readonly userAccountId: string | null;
  readonly employmentRef: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

/** One page of the register. */
export interface EmployeePage {
  readonly items: readonly EmployeeView[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** A login account an employee may be linked to. */
export interface LoginAccountOption {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}
