/**
 * Department types.
 *
 * Separate from `api.ts` and `actions.ts` because both are `'use server'`, and a
 * Server Action module may export only async functions.
 */

/** A department as `org.department-list` and its writes publish it. */
export interface DepartmentView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly departmentCode: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}

/** The branch a list or a creation is addressed to. Both halves, always. */
export interface BranchPair {
  readonly companyId: string;
  readonly branchId: string;
}
