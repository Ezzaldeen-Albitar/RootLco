/**
 * Naming the person a history row records (`P1-27-INT-026`, `VHM-13`).
 *
 * `veh.vehicle_attribute_history` stores an `actor_id` and no name, so the
 * vehicle history screen printed a uuid in a column headed "who". A uuid is not
 * a person.
 *
 * ## Why the name is resolved here and not in the repository
 *
 * The name lives in `iam.user_accounts`. No `veh` repository touches an IAM
 * table, and adding the first such join inside a bug fix would set a precedent
 * that outlives the fix. So the vehicle module composes the IAM module's PUBLIC
 * surface — the same shape as its CRM partner-identity composition.
 *
 * ## `iamDirectory()`, deliberately, and NOT `iamModule()`
 *
 * `iamModule()`'s composition root calls `installIamRuntime()`, which builds the
 * Supabase adapter and reads `clientEnv()`. Composing it here would make the
 * vehicle history read depend on `NEXT_PUBLIC_SUPABASE_URL` and
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and answer `ERR-SYS-001` wherever they are
 * unset — the first draft of this file did exactly that and turned two green
 * backend tests into 500s. `iamDirectory()` constructs no provider and installs
 * no authenticator.
 *
 * ## It narrows, and never widens
 *
 * `iam.user-detail` is guarded by `iam.user.read`; `veh.vehicle-history` is
 * guarded by `veh.vehicle.read`. `resolveDisplayIdentities` checks the IAM
 * capability itself and hands back an empty map to a caller without it —
 * otherwise opening a vehicle would publish a tenant-wide staff directory. Such
 * a caller now sees "User unavailable" where they used to see a uuid, which is
 * strictly less information.
 *
 * ## A user id is NOT an employee id
 *
 * `iam.user_employee_links` is a separate, temporally-valid table. Resolving
 * through it would answer "which employee record is current" rather than "who
 * did this", and would go wrong for exactly the historical rows a ledger exists
 * to preserve. The audit actor is the user account.
 *
 * ## The naming is in the TYPE
 *
 * `WithActor<T>` makes `actorName` required and nullable. An optional field
 * would let an un-named row satisfy the published type, so a read that forgot to
 * resolve would compile cleanly and ship the uuid — which is how the equivalent
 * CRM defect reached an Owner acceptance.
 */
import { iamDirectory } from '@/modules/iam';
import type { DbHandle } from '@/server/db/transaction';
import type { Page } from '@/server/db/pagination';

/** A row that records who did something. */
export interface ActorReferencing {
  readonly actorId: string;
}

/** `T` with its actor named. `null` means "not resolvable by this caller". */
export type WithActor<T> = T & { readonly actorName: string | null };

/** Names every actor on one page, in a single additional statement. */
export async function nameActors<T extends ActorReferencing>(
  db: DbHandle,
  page: Page<T>
): Promise<Page<WithActor<T>>> {
  const identities = await iamDirectory().directory.resolveDisplayIdentities(
    db,
    page.items.map((item) => item.actorId)
  );

  return {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      actorName: identities.get(item.actorId)?.displayName ?? null,
    })),
  };
}
