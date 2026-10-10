/**
 * User access types.
 *
 * Separate from `api.ts` and `actions.ts` because both are `'use server'`, and a
 * Server Action module may export only async functions.
 */

/** One place a grant applies. Several rows are several places; none is everywhere. */
export interface GrantScopeView {
  readonly id: string;
  readonly grantId: string;
  readonly scopeType: 'company' | 'branch' | 'department';
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly departmentId: string | null;
}

/** A scope as a grant write takes it. */
export interface ScopeRequest {
  readonly scopeType: 'company' | 'branch' | 'department';
  readonly companyId: string;
  readonly branchId?: string;
  readonly departmentId?: string;
}

/** How a role is being placed, in the words the screen explains it with. */
export type ScopeMode = 'organisation' | 'companies' | 'branches' | 'departments';

/** The plain-language sentence for a set of chosen places. */
export function scopeSummaryKey(mode: ScopeMode, count: number): string {
  if (mode === 'organisation') return 'users.access.scope.summaryOrganisation';
  if (count === 0) return 'users.access.scope.summaryNone';
  if (mode === 'companies') {
    return count === 1
      ? 'users.access.scope.summaryOneCompany'
      : 'users.access.scope.summaryCompanies';
  }
  if (mode === 'branches') {
    return count === 1
      ? 'users.access.scope.summaryOneBranch'
      : 'users.access.scope.summaryBranches';
  }
  return count === 1
    ? 'users.access.scope.summaryOneDepartment'
    : 'users.access.scope.summaryDepartments';
}
