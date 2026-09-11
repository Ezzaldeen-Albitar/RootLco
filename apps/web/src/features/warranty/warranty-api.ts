'use server';

import { authorizedClient } from '@/lib/api/server-client';
import type { ApiFailure } from '@/lib/api/client';
import {
  STATUS_BY_KIND,
  branchTargetQuery,
  query,
  readOperation,
  type BranchTarget,
  type ItemsOnly,
  type ReadFailureStatus,
  type ReadState,
} from '@/lib/api/read-operation';
import { fromFailure, success, type ActionState } from '@/lib/forms/action-result';
import type { BranchOption } from '@/features/services/services-contract';
import { PAGE_SIZE } from './warranty-contract';
import type {
  WarrantyConfigurationStatus,
  WarrantyListRow,
  WarrantyPage,
  WarrantyPolicyListBody,
  WarrantyRecord,
} from './warranty-contract';

/**
 * The warranty adapters (P1-31, FE-008 warranty record, FE-009 as far as the
 * backend publishes a history).
 *
 * Nothing here fetches. `authorizedClient()` is the only network owner in this
 * application; these functions turn an approved operation into a view state, so a
 * refusal reaches a screen as a refusal and never as an empty list — which an
 * operator reads as "there is nothing here" when the truth is "you may not see it".
 *
 * ## The list's branch pair is a TARGET, not a scope assertion
 *
 * `wty.warranty-list` makes `companyId` and `branchId` required and authorizes
 * exactly that pair before any row is read. They travel through
 * `branchTargetQuery`, which is the only door `lib/api` opens for a resource pair;
 * `query()` refuses both names outright, because "I am in branch Y" is a claim about
 * the caller that the server resolves from the session and never accepts from here.
 *
 * ## The cursor is the server's, and so is the end of the set
 *
 * `cursor` is passed back exactly as it arrived and never parsed; `hasMore` and
 * `nextCursor` are the server's own end-of-set signals. No total is requested and
 * none is invented, because the read publishes none.
 *
 * ## The generation does not attach its own idempotency key
 *
 * `wty.warranty-generate` is registered `idempotent: true`, and the transport reads
 * that fact out of the published contract and mints a key for every `send` that
 * needs one. One `send` is one logical attempt; a key written here would either
 * duplicate that or — worse — be reused across two genuine attempts and turn the
 * second into a replay of the first.
 *
 * ## The policy list is a read, and it is the picker's whole source
 *
 * `wty.warranty-policy-list` answers `wty.warranty.read` — the same code both warranty
 * reads answer — so a clerk who may issue a warranty can see the plans they may issue
 * under. It is the reason the generation's `policyId` is choosable at all: before it,
 * an identifier could only be typed from somewhere outside the product.
 *
 * ## No history reader exists, and nothing here pretends otherwise
 *
 * `wty.warranty_status_history` — the name `20260724095000_wty_warranty.sql` gives the
 * table — is written by the database and read by no operation in `apps/api/src`
 * (**CC-10**, which records it under a longer name no migration ever used). There is
 * therefore no history adapter in this file. FE-009 is served by the vehicle-filtered
 * list — the warranties issued for one vehicle, newest first — and the per-record
 * transition ledger waits on the backend prerequisite named in
 * `warranty-record-screens.md` as **P-18**.
 */

/** What a warranty list read answers with, refusals included. */
export interface WarrantyListState {
  readonly status: 'ok' | ReadFailureStatus;
  readonly rows: readonly WarrantyListRow[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly correlationId: string | null;
}

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

/**
 * The path of one warranty record.
 *
 * A function DECLARATION rather than an arrow constant, and that is not a style
 * choice. The P1-28 access gate resolves helper-built paths by parsing exactly this
 * shape, and these screens are inside its scope: a path it cannot resolve is an
 * operation it cannot see, and every permission the screen consults for that
 * operation is then reported as surplus privilege.
 */
function warrantyPath(warrantyId: string): string {
  return `/api/v1/warranties/${encodeURIComponent(warrantyId)}`;
}

/**
 * The path a warranty is generated under.
 *
 * A subresource of the delivery, because a warranty record cannot exist without a
 * delivered handover — the same reason the route is shaped that way rather than as a
 * top-level create.
 */
function deliveryWarrantiesPath(deliveryId: string): string {
  return `/api/v1/deliveries/${encodeURIComponent(deliveryId)}/warranties`;
}

/**
 * One branch's warranty records, newest first (`wty.warranty-list`).
 *
 * `vehicleId` is the only filter the route accepts, and it is the one FE-009 uses to
 * show a vehicle's warranties in order. An absent filter is omitted rather than sent
 * empty: the route is `.strict()` and treats what it does not recognise as an error,
 * so a parameter is either meant or not sent.
 */
export async function listWarranties(
  target: BranchTarget,
  vehicleId: string | null,
  cursor: string | null
): Promise<WarrantyListState> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const result = await client.get<WarrantyPage<WarrantyListRow>>(
    '/api/v1/warranties' + branchTargetQuery(target, { vehicleId, cursor, limit: PAGE_SIZE })
  );
  if (!result.ok) {
    return { ...EMPTY, status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
  }
  return {
    status: 'ok',
    rows: result.data.items,
    nextCursor: result.data.nextCursor,
    hasMore: result.data.hasMore,
    correlationId: result.correlationId,
  };
}

/**
 * The branches this caller may name as a target (`org.branch-list`).
 *
 * Declared here rather than imported from another feature: four features already
 * carry their own one-line adapter for this directory read, and reaching into one of
 * them would say that warranty depends on payments, which it does not. The read is
 * gated on `org.branch.read`, which a warranty reader does not necessarily hold, so
 * the screen asks only when the page resolved that code and falls back to the
 * identifier fields rather than to a picker with nothing in it.
 */
export async function listBranches(): Promise<ReadState<ItemsOnly<BranchOption>>> {
  return readOperation<ItemsOnly<BranchOption>>('/api/v1/org/branches');
}

/**
 * One warranty record with its coverage terms and covered items
 * (`wty.warranty-detail`).
 *
 * A `not-found` means the record could not be resolved — a warranty in a branch the
 * caller cannot see, or an identifier that names nothing. The backend deliberately
 * does not confirm that a record it will not show you exists.
 */
export async function readWarranty(warrantyId: string): Promise<ReadState<WarrantyRecord>> {
  return readOperation<WarrantyRecord>(warrantyPath(warrantyId));
}

/**
 * The warranty policies the caller may issue under (`wty.warranty-policy-list`).
 *
 * The read the issue surface's picker is built on, and the operation's own docblock
 * names that picker as the reason it exists. Gated on `wty.warranty.read` rather than
 * on the administration code, so a clerk who issues warranties can see the plans.
 *
 * `status` is the route's one filter and is sent when the caller means it — the panel
 * asks for the ISSUABLE state, because a plan that is not active is refused by the
 * generation. An omitted status lists every plan, which is what a configuration
 * screen would want and is therefore not narrowed away here.
 *
 * No company filter is sent, because the route offers none: the read is tenant-scoped
 * and answers for every company the caller's grants reach. Narrowing to one company is
 * the caller's job, and the rows carry `companyId` so it can be done exactly.
 */
export async function listWarrantyPolicies(
  input: {
    readonly status?: WarrantyConfigurationStatus | undefined;
    readonly cursor?: string | null | undefined;
    readonly limit?: number | undefined;
  } = {}
): Promise<ReadState<WarrantyPolicyListBody>> {
  return readOperation<WarrantyPolicyListBody>(
    '/api/v1/warranty-policies' +
      query({
        status: input.status ?? null,
        cursor: input.cursor ?? null,
        limit: input.limit ?? PAGE_SIZE,
      })
  );
}

/**
 * A write outcome, plus the record it created and the catalogue code the refusal
 * carried.
 *
 * The code travels because the generation distinguishes causes that change what an
 * operator should do next — an unconfigured policy, a vehicle already covered, a
 * handover that is not complete — and the HTTP kind alone collapses them into a bare
 * conflict or a bare validation failure. Only codes the screen branches on are read.
 */
export interface WarrantyWriteState extends ActionState {
  /** The record on success, absent on every other outcome. */
  readonly created?: WarrantyRecord;
  /** The catalogue code the problem document carried, when it carried one. */
  readonly code?: string;
  /** The authority a refusal named, when it named one. */
  readonly requiredPermissions?: readonly string[];
}

/**
 * Generate a warranty from a committed handover (`wty.warranty-generate`).
 *
 * The caller may name a policy and nothing else. Duration, odometer limit, covered
 * scope and the effective window all come from the coverage row effective at the
 * handover date; a missing coverage row is a controlled configuration error and is
 * never a defaulted twelve months, so nothing here supplies a term of any kind.
 *
 * `policyId` is omitted when the operator did not choose one, which is what makes the
 * company's single active policy resolve. It is omitted rather than sent empty: the
 * route's body schema is `.strict()` and an empty string is not a missing value.
 */
export async function generateWarranty(
  deliveryId: string,
  input: { readonly policyId?: string | undefined } = {},
  attempt = 1
): Promise<WarrantyWriteState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const body = input.policyId === undefined ? {} : { policyId: input.policyId };
  const result = await client.send<WarrantyRecord>(
    'POST',
    deliveryWarrantiesPath(deliveryId),
    body
  );
  if (!result.ok) return withCode(fromFailure(result, attempt), result);
  return { ...success('warranty.generate.done', attempt), created: result.data };
}

/**
 * Carries the catalogue code and any named authority onto the action state.
 *
 * Separate from `fromFailure` because that helper is shared by every form in the
 * product and its contract is deliberately narrow: translation keys and a correlation
 * reference. A catalogue code is neither — it is a machine value this feature
 * branches on — so it is added here rather than widened into the shape every other
 * screen renders.
 */
function withCode(state: ActionState, failure: ApiFailure): WarrantyWriteState {
  const problem = failure.problem;
  return {
    ...state,
    ...(problem?.code === undefined ? {} : { code: problem.code }),
    ...(problem?.requiredPermissions === undefined
      ? {}
      : { requiredPermissions: problem.requiredPermissions }),
  };
}
