'use server';

import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  branchTargetQuery,
  query,
  readOperation,
  type ItemsOnly,
  type ReadState,
} from '@/lib/api/read-operation';
import { fromFailure, success, type ActionState } from '@/lib/forms/action-result';
import type {
  PriceListAssignmentCreateBody,
  PriceListCreateBody,
  PriceListVersionCreateBody,
  PriceListVersionPublishBody,
  PriceRuleRecordBody,
} from '@/lib/contracts/pricing-contract';
import type { BranchOption } from '@/features/services/services-contract';
import {
  LIST_BOUND,
  type PriceListAssignment,
  type PriceListDetail,
  type PriceListRules,
  type PriceListSummary,
  type PriceListVersion,
  type PriceLookupCriteria,
  type PriceRuleEcho,
  type ResolvedPrice,
} from './pricing-contract';

/**
 * The pricing adapters (P1-30, `W2`, FE-002 and FE-006).
 *
 * Nothing here fetches directly: `authorizedClient()` is the only network owner
 * in this application. This file turns operations into view states and nothing
 * else — and, on this surface above all, it does no arithmetic: every amount,
 * price and rate is passed through as the string the server sent.
 *
 * ## Bounded, not paged
 *
 * `svc.price-list-list` takes `limit` (at most one hundred) and no cursor, and
 * answers `{ items }` with no `hasMore`. So the list adapter asks for the bound
 * and reports `hasMore: false` and no cursor — which is the truth of the
 * contract, not a claim that the workshop has no more lists. The screen says
 * the bound out loud.
 *
 * ## The resolve read's target
 *
 * `svc.price-resolve` is `scope: 'branch'` and its route demands `companyId`
 * and `branchId`: they are the read's TARGET, re-authorized server-side, and
 * travel through `branchTargetQuery` — `query()` refuses them by name so a
 * scope can never be smuggled in among ordinary filters.
 *
 * ## Where the concurrency token comes from
 *
 * `svc.price-list-version-create` and `svc.price-list-version-publish` are
 * `versionGuarded: true` on the PRICE LIST's `recordVersion` — the row the
 * backend locks first. Their own responses carry the VERSION's number, so
 * `ifMatch` on both adapters is the value from `svc.price-list-detail`, is
 * REQUIRED, and is never defaulted; the screen re-reads the detail afterwards.
 */

/** A write that creates something the screen must then hold on to. */
export type CreateOutcome<T> = {
  readonly state: ActionState;
  /** The created row on success, `null` on any other outcome. */
  readonly created: T | null;
};

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

const listPath = (priceListId: string, suffix = ''): string =>
  `/api/v1/price-lists/${encodeURIComponent(priceListId)}${suffix}`;

const versionPath = (priceListId: string, versionId: string, suffix = ''): string =>
  listPath(priceListId, `/versions/${encodeURIComponent(versionId)}${suffix}`);

/**
 * Every price list of the workshop (`svc.price-list-list`), up to the bound.
 *
 * Tenant-wide: `svc.price_lists` carries no company and no branch, so there is
 * no target to demand and the list reads on first paint.
 */
export async function listPriceLists(): Promise<ServerPage<PriceListSummary>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const result = await client.get<ItemsOnly<PriceListSummary>>(
    `/api/v1/price-lists${query({ limit: LIST_BOUND })}`
  );
  if (!result.ok) {
    return { ...EMPTY, status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
  }
  return {
    status: 'ok',
    rows: result.data.items,
    nextCursor: null,
    hasMore: false,
    correlationId: result.correlationId,
  };
}

/**
 * One price list with its versions (`svc.price-list-detail`).
 *
 * The response carries an ETag holding the LIST's `recordVersion`, and that is
 * the `If-Match` both guarded writes below need.
 */
export async function readPriceList(priceListId: string): Promise<ReadState<PriceListDetail>> {
  return readOperation<PriceListDetail>(listPath(priceListId));
}

/** The rules of one version (`svc.price-rule-list`), bounded at two hundred. */
export async function listPriceRules(
  priceListId: string,
  versionId: string
): Promise<ReadState<PriceListRules>> {
  return readOperation<PriceListRules>(versionPath(priceListId, versionId, '/rules'));
}

/**
 * The price that applies (`svc.price-resolve`) for one service at one branch
 * on one date. The answer is rendered as the server's figures; a refusal — no
 * price, a tax class with no rate — is rendered as a refusal, never as zero.
 */
export async function resolvePrice(
  criteria: PriceLookupCriteria
): Promise<ReadState<ResolvedPrice>> {
  const path =
    '/api/v1/prices' +
    branchTargetQuery(
      { companyId: criteria.companyId, branchId: criteria.branchId },
      { serviceId: criteria.serviceId, customerClass: criteria.customerClass, asOf: criteria.asOf }
    );
  return readOperation<ResolvedPrice>(path);
}

/**
 * The tenant's branches (`org.branch-list`), for the pickers. A different code
 * from the pricing reads, so its refusal is its own and the pickers degrade to
 * identifier fields rather than claim the workshop has no branches.
 */
export async function listBranches(): Promise<ReadState<ItemsOnly<BranchOption>>> {
  return readOperation<ItemsOnly<BranchOption>>('/api/v1/org/branches');
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

const expired = (attempt: number): ActionState => ({
  status: 'expired',
  messageKey: 'state.expired.title',
  attempt,
});

/** Create a price list (`svc.price-list-create`); the row returns with its `recordVersion`. */
export async function createPriceList(
  body: PriceListCreateBody,
  attempt = 1
): Promise<CreateOutcome<PriceListSummary>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<PriceListSummary>('POST', '/api/v1/price-lists', body);
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: { ...success('pricing.create.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * Create a DRAFT version (`svc.price-list-version-create`), `If-Match` REQUIRED
 * and guarding the PRICE LIST's `recordVersion` — from the detail read, never
 * from a prior version's answer.
 */
export async function createPriceListVersion(
  priceListId: string,
  body: PriceListVersionCreateBody,
  ifMatch: number,
  attempt = 1
): Promise<CreateOutcome<PriceListVersion>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<PriceListVersion>(
    'POST',
    listPath(priceListId, '/versions'),
    body,
    { ifMatch }
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: { ...success('pricing.version.created', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * Publish a draft (`svc.price-list-version-publish`), `If-Match` REQUIRED and
 * guarding the PRICE LIST's `recordVersion`. The backend demands
 * `svc.price.publish` held for the whole workshop and at least one rule on the
 * draft; both refusals render as refusals.
 */
export async function publishPriceListVersion(
  priceListId: string,
  versionId: string,
  body: PriceListVersionPublishBody,
  ifMatch: number,
  attempt = 1
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return expired(attempt);
  const result = await client.send<PriceListVersion>(
    'POST',
    versionPath(priceListId, versionId, '/publication'),
    body,
    { ifMatch }
  );
  if (!result.ok) return fromFailure(result, attempt);
  return { ...success('pricing.version.published', attempt), correlationId: result.correlationId };
}

/**
 * Record a rule on a draft (`svc.price-rule-record`). `amount` is the canonical
 * decimal string `MoneyField` produced; the company/branch pair, when given, is
 * the operation's scope target and is authorized server-side.
 */
export async function recordPriceRule(
  priceListId: string,
  versionId: string,
  body: PriceRuleRecordBody,
  attempt = 1
): Promise<CreateOutcome<PriceRuleEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<PriceRuleEcho>(
    'POST',
    versionPath(priceListId, versionId, '/rules'),
    body
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: { ...success('pricing.rule.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * Record where a price list applies (`svc.price-list-assignment-create`). There
 * is no read of assignments: the row that comes back is the only sight of it.
 */
export async function createPriceListAssignment(
  body: PriceListAssignmentCreateBody,
  attempt = 1
): Promise<CreateOutcome<PriceListAssignment>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<PriceListAssignment>(
    'POST',
    '/api/v1/price-list-assignments',
    body
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('pricing.assignment.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}
