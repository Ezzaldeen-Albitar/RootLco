import { readOperation } from '@/lib/api/read-operation';
import {
  WORKING_CONTEXT_PATH,
  isWorkingContextShape,
  snapshotOf,
  unavailableContext,
  type WorkingContextResponse,
  type WorkingContextSnapshot,
} from './working-context-contract';

/**
 * The working-context read, server-side.
 *
 * ## Why the loader and not the read is what the layout calls
 *
 * The layout has one job here: hand the provider a snapshot. Every way the read
 * can fail — no session, a refusal, an outage, a body that is not the published
 * shape — collapses to the same answer, `unavailable`, because the shell's
 * behaviour is identical in all of them: render, say so in the header, offer to
 * try again. Spreading that decision across the layout would put a five-branch
 * conditional in a Server Component whose only other statement is a redirect.
 *
 * ## It never throws
 *
 * A failure here must not take the workspace down with it. The operator whose
 * branch directory is briefly unreadable can still open a work order, read a
 * customer and sign out; what they cannot do is switch branch, and the header
 * says exactly that. An exception would instead have turned a directory outage
 * into an error page on every protected route.
 *
 * ## One read per request
 *
 * Called once, in the dashboard layout, and passed down. Next renders the
 * layout once per request, so this is one call per page load rather than one
 * per screen that wants a branch name — which is the shape the five duplicated
 * branch-list hooks across inventory and pricing each pay for separately.
 */
export async function readWorkingContext() {
  return readOperation<WorkingContextResponse>(WORKING_CONTEXT_PATH);
}

/**
 * The snapshot the shell renders from.
 *
 * `accountId` is the signed-in user, carried through so the remembered branch
 * choice is keyed to the person and not only to the workspace.
 */
export async function loadWorkingContext(accountId: string): Promise<WorkingContextSnapshot> {
  const state = await readWorkingContext();
  if (state.status !== 'ok') return unavailableContext(accountId);
  // Fails closed. A 200 carrying an error envelope is not a working context,
  // and treating it as one would publish an empty branch list as if the server
  // had said the operator has none.
  if (!isWorkingContextShape(state.data)) return unavailableContext(accountId);
  return snapshotOf(state.data, accountId);
}
