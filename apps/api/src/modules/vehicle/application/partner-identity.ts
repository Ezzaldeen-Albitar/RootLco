/**
 * Naming the parties a vehicle page shows (`P1-27-INT-025`).
 *
 * Two vehicle reads publish a `partner_id` and nothing else — the relationships
 * list and the ownership history — and both were rendering that uuid under a
 * column headed with a person's name. A uuid is not a label, and the two screens
 * had independently arrived at the same apologetic comment explaining why they
 * showed one anyway.
 *
 * ## Why the name is resolved here and not in the repository
 *
 * The name lives in `crm.business_partners`. **No `veh` repository touches a CRM
 * table**, and adding the first cross-schema join inside a bug fix would set a
 * precedent that outlives the fix. So the vehicle module composes the CRM
 * module's PUBLIC surface instead — the same shape as the reception module
 * composing shared-services for its numbering. Modules talk through their
 * published services; schemas stay owned. `crm` imports nothing from `vehicle`,
 * so there is no cycle.
 *
 * ## One extra statement per page, not one per row
 *
 * The whole page's ids go in one call. Resolving them singly would be an N+1
 * against a bucket sized for one read per page.
 *
 * ## The naming is in the TYPE, not merely in the code
 *
 * `Named<T>` makes the three fields **required** rather than optional. An
 * optional `partnerName?` would let the repository's own un-named row satisfy
 * the published type, so a future read that forgot to resolve would compile
 * cleanly and ship the uuid again — which is exactly how this defect reached an
 * Owner acceptance in the first place. With `Named<T>` the resolution is the
 * only way to produce the return type.
 *
 * ## An unresolved partner is a sentence, not a failure
 *
 * A row may reference a partner this caller cannot see — soft-deleted, merged
 * away, or outside their scope. That id is simply absent from the map and the
 * three fields come back `null`, which the screen renders as words. The
 * alternatives — failing the whole list, or falling back to the uuid — either
 * hide six good rows because of one, or reintroduce the defect.
 */
import { crmModule } from '@/modules/crm';
import type { DbHandle } from '@/server/db/transaction';
import type { Page } from '@/server/db/pagination';

/** A row that carries a CRM partner reference. */
export interface PartnerReferencing {
  readonly partnerId: string;
}

/**
 * `T` with its party named. All three fields are required and nullable: the
 * caller always learns whether the party was resolvable, and never has to
 * distinguish "absent key" from "not visible to you".
 */
export type Named<T> = T & {
  readonly partnerName: string | null;
  readonly partnerNumber: string | null;
  readonly partnerType: string | null;
};

/** Names every party on one page, in a single additional statement. */
export async function namePartners<T extends PartnerReferencing>(
  db: DbHandle,
  page: Page<T>
): Promise<Page<Named<T>>> {
  const identities = await crmModule().customerRead.resolveDisplayIdentities(
    db,
    page.items.map((item) => item.partnerId)
  );

  return {
    ...page,
    items: page.items.map((item) => {
      const identity = identities.get(item.partnerId);
      return {
        ...item,
        partnerName: identity?.displayName ?? null,
        partnerNumber: identity?.displayNumber ?? null,
        partnerType: identity?.partyType ?? null,
      };
    }),
  };
}
