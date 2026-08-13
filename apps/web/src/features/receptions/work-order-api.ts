'use server';

import { readOperation, type ReadState } from '@/lib/api/read-operation';
import type { ConvertedWorkOrder } from './work-order-contract';

/**
 * The one work-order read the conversion result display consumes (P1-28,
 * Wave F; `FE-022`). The contract, the boundary reasoning and the permission
 * constant live in `work-order-contract.ts` beside this file.
 *
 * Called only after a conversion has answered with a `workOrderId` — first run
 * or replay — so there is no path here that guesses an identifier. A caller
 * without `wo.work_order.read` receives `denied`, which the screen states as
 * "the work order exists; your access does not include reading it", never as a
 * failed conversion.
 */
export async function readConvertedWorkOrder(
  workOrderId: string
): Promise<ReadState<ConvertedWorkOrder>> {
  return readOperation<ConvertedWorkOrder>(
    `/api/v1/work-orders/${encodeURIComponent(workOrderId)}`
  );
}
