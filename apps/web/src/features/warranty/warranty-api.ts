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
  WarrantyCoverageCreateBody,
  WarrantyCoverageTerms,
  WarrantyListRow,
  WarrantyPage,
  WarrantyPolicyCreateBody,
  WarrantyPolicyDetail,
  WarrantyPolicyListBody,
  WarrantyPolicyRenameBody,
  WarrantyPolicySummary,
  WarrantyRecord,
  WarrantyStatusSetBody,
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
 * ## The five plan-administration writes are guarded from the CALL SHAPE outwards
 *
 * Three of them are version-guarded, and the backend answers `ERR-CON-002` when
 * `If-Match` is missing. That refusal is unreachable from here by construction rather
 * than by care: each of those three adapters takes the version as a REQUIRED
 * argument, so a call that omits it does not compile. The version passed is always the
 * one the screen last read from the server, and every mutation re-reads, so the next
 * command decides against the state the operator is actually looking at.
 *
 * No adapter mints an idempotency key. The transport reads `idempotent` out of the
 * published contract, which is why the plan create, the coverage create and the plan
 * status command carry one while the coverage status command deliberately does not.
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
 * The path of one warranty plan.
 *
 * A function DECLARATION for the reason `warrantyPath` states: the P1-28 access gate
 * resolves helper-built paths by parsing exactly this shape, and a path it cannot
 * resolve is an operation it cannot see.
 */
function policyPath(policyId: string): string {
  return `/api/v1/warranty-policies/${encodeURIComponent(policyId)}`;
}

/** The path a window of cover terms is added under. */
function coverageWindowsPath(policyId: string): string {
  return `${policyPath(policyId)}/coverage-windows`;
}

/**
 * The path one window's state command is addressed to.
 *
 * It names BOTH rows, which is what makes the two record versions easy to confuse;
 * the adapter below takes the coverage row's own and nothing else.
 */
function coverageStatusPath(policyId: string, coverageId: string): string {
  return `${coverageWindowsPath(policyId)}/${encodeURIComponent(coverageId)}/status`;
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
 * One warranty plan with its windows of cover terms (`wty.warranty-policy-read`).
 *
 * Gated on `wty.warranty.read` rather than on the administration code, so a clerk who
 * issues warranties can see the terms they will be issued under. It is the read the
 * plan screen is drawn from AND the read every mutation on that screen re-runs, so
 * what an operator sees after a change is the server's own answer — including the new
 * `recordVersion`, which is the `If-Match` their next command needs.
 *
 * A `not-found` covers both "no such plan" and "a plan in a company you cannot
 * reach": the service decides absence BEFORE it decides scope, so a refusal never
 * confirms that an identifier names a real row somewhere.
 */
export async function readWarrantyPolicy(
  policyId: string
): Promise<ReadState<WarrantyPolicyDetail>> {
  return readOperation<WarrantyPolicyDetail>(policyPath(policyId));
}

/**
 * What one plan-administration write answers with.
 *
 * `policy` and `coverage` carry the row the server returned, so the screen can show
 * the result of the write rather than the request that produced it. `code` and `rule`
 * together are what tell the three meanings of `ERR-CON-001` apart — a stale version,
 * a window already covered, a plan reference already used — which the HTTP kind
 * collapses into one bare conflict.
 */
export interface PolicyWriteState extends ActionState {
  /** The plan the server returned, on a plan write that succeeded. */
  readonly policy?: WarrantyPolicySummary;
  /** The window the server returned, on a coverage write that succeeded. */
  readonly coverage?: WarrantyCoverageTerms;
  /** The catalogue code the problem document carried, when it carried one. */
  readonly code?: string;
  /** The first violation's rule, which is how one code's causes are told apart. */
  readonly rule?: string;
  /** The authority a refusal named, when it named one. */
  readonly requiredPermissions?: readonly string[];
}

/**
 * Create a plan for one company (`wty.warranty-policy-create`).
 *
 * `companyId` is required by the route and is a claim the service re-authorizes
 * against the caller's grants; it is not a scope this side asserts. No retry key is
 * attached here — the operation is registered idempotent and the transport mints one
 * for every send that needs it.
 *
 * Cover terms may travel in the same body, and when they do they land in the SAME
 * transaction as the plan header. The screen does not use that yet: it creates the
 * plan and then adds windows on the plan's own screen, where an overlap refusal names
 * the window it refused instead of failing the whole creation.
 */
export async function createWarrantyPolicy(
  body: WarrantyPolicyCreateBody,
  attempt = 1
): Promise<PolicyWriteState> {
  const client = await authorizedClient();
  if (!client) return EXPIRED_WRITE(attempt);

  const result = await client.send<WarrantyPolicySummary>(
    'POST',
    '/api/v1/warranty-policies',
    body
  );
  if (!result.ok) return refusal(fromFailure(result, attempt), result);
  return { ...success('warranty.policies.created', attempt), policy: result.data };
}

/**
 * Rename one plan (`wty.warranty-policy-rename`).
 *
 * `ifMatch` is REQUIRED, and that is the whole defence against `ERR-CON-002`: the
 * backend refuses a version-guarded write without the header, and an optional
 * argument here would make a call that omits it compile. It is the PLAN's version,
 * which is what this operation's own read publishes as its ETag.
 *
 * The plan reference is not renameable and no field for it is sent: the route refuses
 * it, because a re-coded plan is a different configuration wearing the old identity.
 */
export async function renameWarrantyPolicy(
  policyId: string,
  body: WarrantyPolicyRenameBody,
  ifMatch: number,
  attempt = 1
): Promise<PolicyWriteState> {
  const client = await authorizedClient();
  if (!client) return EXPIRED_WRITE(attempt);

  const result = await client.send<WarrantyPolicySummary>('PATCH', policyPath(policyId), body, {
    ifMatch,
  });
  if (!result.ok) return refusal(fromFailure(result, attempt), result);
  return { ...success('warranty.policies.renamed', attempt), policy: result.data };
}

/**
 * Retire or restore one plan (`wty.warranty-policy-status-set`).
 *
 * There is no delete and there cannot be: no application role holds a DELETE grant on
 * either warranty configuration table, and every warranty record cites its plan by
 * id. Retiring removes the plan from the set a generation resolves; restoring is
 * offered because a retired plan still holds its reference, so an archive-only
 * command would burn that reference for the company permanently.
 *
 * Version-guarded AND idempotent: the version makes the transition decide against the
 * state the operator actually read, and the transport's key makes a retried request
 * return the first answer instead of a version conflict indistinguishable from a real
 * one.
 */
export async function setWarrantyPolicyStatus(
  policyId: string,
  body: WarrantyStatusSetBody,
  ifMatch: number,
  attempt = 1
): Promise<PolicyWriteState> {
  const client = await authorizedClient();
  if (!client) return EXPIRED_WRITE(attempt);

  const result = await client.send<WarrantyPolicySummary>(
    'POST',
    `${policyPath(policyId)}/status`,
    body,
    { ifMatch }
  );
  if (!result.ok) return refusal(fromFailure(result, attempt), result);
  return { ...success('warranty.policies.statusChanged', attempt), policy: result.data };
}

/**
 * Add one window of cover terms to a plan (`wty.warranty-coverage-create`).
 *
 * Adding is the ONLY way to change a plan's terms. The database freezes the plan and
 * the start date of an existing window, and this surface refuses to move the end date
 * in place as well, because warranties issued under a window cite it for their whole
 * life and re-closing it would silently restate terms a customer is already bound to.
 * Retire the window and add the one you meant.
 *
 * `durationMonths` crosses the wire as a JSON number because a count of months is not
 * a measurement. `odometerAllowance` crosses as an exact decimal STRING and is never
 * parsed on this side; omitting it is what an unlimited distance means.
 */
export async function createCoverageWindow(
  policyId: string,
  body: WarrantyCoverageCreateBody,
  attempt = 1
): Promise<PolicyWriteState> {
  const client = await authorizedClient();
  if (!client) return EXPIRED_WRITE(attempt);

  const result = await client.send<WarrantyCoverageTerms>(
    'POST',
    coverageWindowsPath(policyId),
    body
  );
  if (!result.ok) return refusal(fromFailure(result, attempt), result);
  return { ...success('warranty.policies.coverageAdded', attempt), coverage: result.data };
}

/**
 * Retire or restore one window of cover terms (`wty.warranty-coverage-status-set`).
 *
 * This is the command that actually changes what the next vehicle is granted: the
 * issue primitive selects coverage on the WINDOW's state and never reads the plan's.
 * Warranties already issued under a retired window stay readable and intact.
 *
 * `ifMatch` is the COVERAGE row's own version, never the plan's. The two are separate
 * counters on separate rows and the path names both, which is exactly the shape a
 * caller gets wrong silently — so the argument is required and is taken from the row
 * the operator is acting on.
 *
 * A restore can be refused, and that refusal is not a fault: the overlap rule is
 * partial on active rows, so a retired window's dates may have been re-covered while
 * it was away. This operation is deliberately NOT idempotent for that reason, and the
 * transport attaches no key to it.
 */
export async function setCoverageWindowStatus(
  policyId: string,
  coverageId: string,
  body: WarrantyStatusSetBody,
  ifMatch: number,
  attempt = 1
): Promise<PolicyWriteState> {
  const client = await authorizedClient();
  if (!client) return EXPIRED_WRITE(attempt);

  const result = await client.send<WarrantyCoverageTerms>(
    'POST',
    coverageStatusPath(policyId, coverageId),
    body,
    { ifMatch }
  );
  if (!result.ok) return refusal(fromFailure(result, attempt), result);
  return { ...success('warranty.policies.coverageStatusChanged', attempt), coverage: result.data };
}

/** An ended session, reported without asking the transport for anything. */
const EXPIRED_WRITE = (attempt: number): PolicyWriteState => ({
  status: 'expired',
  messageKey: 'state.expired.title',
  attempt,
});

/**
 * Carries the catalogue code, the first violation's rule and any named authority.
 *
 * The RULE is what `withCode` below does not carry and this surface cannot do
 * without: `ERR-CON-001` means three different things here, and the problem
 * document's `violations` list is the only machine-readable statement of which. A
 * stale version carries no rule at all, so its absence is itself the signal.
 */
function refusal(state: ActionState, failure: ApiFailure): PolicyWriteState {
  const problem = failure.problem;
  const rule = problem?.violations?.[0]?.rule;
  return {
    ...state,
    ...(problem?.code === undefined ? {} : { code: problem.code }),
    ...(rule === undefined ? {} : { rule }),
    ...(problem?.requiredPermissions === undefined
      ? {}
      : { requiredPermissions: problem.requiredPermissions }),
  };
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
