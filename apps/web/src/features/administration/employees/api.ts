'use server';

import {
  branchTargetQuery,
  readOperation,
  type CursorPage,
  type ReadState,
} from '@/lib/api/read-operation';
import type { BranchPair } from '../departments/types';
import type { EmployeePage, EmployeeView, LoginAccountOption } from './types';

/**
 * `GET /api/v1/org/employees?companyId&branchId` — `org.employee.read`.
 *
 * Keyset-paged. The unfiltered list includes retired employees on purpose: the
 * reinstate command would otherwise be unreachable from the register it acts on.
 * `limit` is the grid's page size, one of the product's sizes, all inside the
 * route's own bound of 100.
 */
export async function listEmployees(
  target: BranchPair,
  cursor: string | null,
  limit = 50
): Promise<ReadState<EmployeePage>> {
  return readOperation<EmployeePage>(
    `/api/v1/org/employees${branchTargetQuery(target, { limit, cursor })}`
  );
}

/**
 * `GET /api/v1/org/employees/{employeeId}` — `org.employee-detail`,
 * `org.employee.read`.
 *
 * One employee as stored now, for the register's detail view. The server
 * re-authorizes against the row's own branch, and absent, retired out of reach
 * and in another organisation are one answer (`not-found`).
 */
export async function readEmployee(employeeId: string): Promise<ReadState<EmployeeView>> {
  return readOperation<EmployeeView>(`/api/v1/org/employees/${encodeURIComponent(employeeId)}`);
}

/**
 * The login accounts an employee may be linked to — `GET /api/v1/iam/users`,
 * `iam.user.read`, active accounts only, first hundred.
 *
 * A convenience list for a picker. The link itself is checked by the backend,
 * and an organisation with more accounts than this still links by choosing
 * among the first hundred or by leaving the link empty.
 */
export async function listLoginAccounts(): Promise<readonly LoginAccountOption[]> {
  const read = await readOperation<CursorPage<LoginAccountOption>>(
    '/api/v1/iam/users?limit=100&status=active'
  );
  if (read.status !== 'ok') return [];
  return read.data.items.map((user) => ({
    id: user.id,
    displayName: user.displayName,
    email: user.email,
  }));
}
