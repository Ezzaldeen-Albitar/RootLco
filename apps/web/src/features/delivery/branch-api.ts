'use server';

import { readOperation, type ItemsOnly, type ReadState } from '@/lib/api/read-operation';
import type { DeliveryBranchOption } from './branch-contract';

/**
 * The branch directory read the handover surface issues (P1-31, FE-002).
 *
 * Nothing here fetches. `readOperation` calls `authorizedClient()`, the only
 * network owner in this application, and turns a transport outcome into a view
 * state — so a refusal reaches the picker as a refusal and never as an empty
 * directory, which an operator reads as "there is only one branch".
 *
 * ## A separate module from `employee-api.ts`, deliberately
 *
 * That file mirrors the employee register on the register's own permission. This
 * is the organisation's branch directory on a third one, and the only thing the
 * two have in common is the form that reads both. Keeping them apart is what
 * lets each be refused on its own and reported on its own.
 *
 * ## The read is tenant-wide, and the screen narrows it by COMPANY
 *
 * `org.branch-list` publishes the branches the acting user may reach across the
 * tenant, each with the company it belongs to. The form offers only the ones
 * whose company is the work order's, because a handover belongs to its work
 * order's organisation. That narrowing is a display decision, not a rule: the
 * register read and the create operation both re-authorize whatever is chosen.
 *
 * ## Nothing here decides who may hand a vehicle over
 *
 * This publishes where people may be listed from. Who may be named on a handover
 * is decided by the create operation and by the database, and this tier mirrors
 * no part of that rule.
 */
export async function listBranches(): Promise<ReadState<ItemsOnly<DeliveryBranchOption>>> {
  return readOperation<ItemsOnly<DeliveryBranchOption>>('/api/v1/org/branches');
}
