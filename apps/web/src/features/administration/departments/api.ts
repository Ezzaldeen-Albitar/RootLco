'use server';

import {
  branchTargetQuery,
  readOperation,
  type ItemsOnly,
  type ReadState,
} from '@/lib/api/read-operation';
import type { BranchPair, DepartmentView } from './types';

/**
 * `GET /api/v1/org/departments?companyId&branchId` — `org.department.read`.
 *
 * Both halves of the branch are required by the route: a department list with
 * no branch would be an organisation-wide read behind a branch-scoped
 * permission. `branchTargetQuery` refuses a blank half rather than sending it.
 */
export async function listDepartments(
  target: BranchPair
): Promise<ReadState<readonly DepartmentView[]>> {
  const read = await readOperation<ItemsOnly<DepartmentView>>(
    `/api/v1/org/departments${branchTargetQuery(target)}`
  );
  if (read.status !== 'ok') return read;
  return { status: 'ok', data: read.data.items, correlationId: read.correlationId };
}

/**
 * The names of the departments a set of grant places names, keyed by id.
 *
 * One list read per distinct branch, made only for department places. The pair
 * each read names is the pair the grant place itself carries, which the server
 * re-authorizes; a branch the session may not read simply contributes no names,
 * and the screen then says the department is not visible rather than guessing.
 */
export async function readDepartmentNames(
  places: readonly {
    readonly scopeType: string;
    readonly companyId: string | null;
    readonly branchId: string | null;
  }[]
): Promise<Readonly<Record<string, string>>> {
  const targets = new Map<string, BranchPair>();
  for (const place of places) {
    if (place.scopeType !== 'department' || !place.companyId || !place.branchId) continue;
    targets.set(place.branchId, { companyId: place.companyId, branchId: place.branchId });
  }
  const names: Record<string, string> = {};
  for (const target of targets.values()) {
    const read = await listDepartments(target);
    if (read.status !== 'ok') continue;
    for (const department of read.data) names[department.id] = department.name;
  }
  return names;
}
