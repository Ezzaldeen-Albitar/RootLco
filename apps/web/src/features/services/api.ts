'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  query,
  readOperation,
  type CursorPage,
  type ItemsOnly,
  type ReadState,
} from '@/lib/api/read-operation';
import { fromFailure, success, type ActionState } from '@/lib/forms/action-result';
import type {
  BranchAvailabilitySetBody,
  ServiceCategoryCreateBody,
  ServiceCreateBody,
  ServiceUpdateBody,
  ServiceVersionCreateBody,
  ServiceVersionPublishBody,
} from '@/lib/contracts/services-contract';
import type {
  BranchAvailability,
  BranchOption,
  ServiceCategory,
  ServiceDetail,
  ServiceListCriteria,
  ServiceSummary,
  ServiceVersion,
} from './services-contract';

/**
 * The service-catalogue adapters (P1-30, `W1`, FE-001).
 *
 * Nothing here fetches directly: `authorizedClient()` is the only network owner
 * in this application and it lives in `src/lib/api` because
 * `check-api-boundary.mjs` says so. This file turns operations into view states
 * and nothing else.
 *
 * ## Why the catalogue is not addressed to a branch
 *
 * `svc.service-list` is `scope: 'tenant'`: `svc.services` carries no company
 * and no branch, so there is no target to demand and the work-order board's
 * "no request before a branch is named" rule does not apply here. What the
 * route DOES accept is `availableAtBranchId` — a RESOURCE SELECTOR, "the
 * services available at that branch" — and the backend re-authorizes the named
 * branch before answering. It travels through `query()` like any other filter,
 * and `query()` still refuses the scope names themselves.
 *
 * ## A denial is not an empty catalogue
 *
 * `STATUS_BY_KIND` maps a 403 to `denied` and the table renders that as a
 * refusal. Collapsing it to zero rows would tell an operator "there are no
 * services" when the truth is "you may not see them".
 *
 * ## Where the concurrency token comes from
 *
 * `svc.service-update` and `svc.service-version-publish` are
 * `versionGuarded: true` and their handlers refuse without `If-Match`. The
 * version is the `recordVersion` the detail read is already showing — for
 * publication it is the SERVICE's version, because `svc.publish_service_version`
 * locks the service first — so `ifMatch` is REQUIRED on both adapters and is
 * never defaulted.
 */

/** A write that creates something the screen must then hold on to. */
export type CreateOutcome<T> = {
  readonly state: ActionState;
  /** The created row on success, `null` on any other outcome. */
  readonly created: T | null;
};

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

const servicePath = (serviceId: string, suffix = ''): string =>
  `/api/v1/services/${encodeURIComponent(serviceId)}${suffix}`;

/**
 * The catalogue (`svc.service-list`), one page at a time.
 *
 * The backend applies `lifecycleStatus` only when it is sent, so an unfiltered
 * page holds ARCHIVED services beside active ones. That is what the screen
 * wants: a retired service must still be findable and must render as retired.
 */
export async function listServices(
  criteria: ServiceListCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<ServiceSummary>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/services' +
    query({
      categoryId: criteria.categoryId,
      lifecycleStatus: criteria.lifecycleStatus,
      availableAtBranchId: criteria.availableAtBranchId,
      effectiveOn: criteria.effectiveOn,
      search: criteria.search,
      cursor,
      limit: request.pageSize,
    });
  const result = await client.get<CursorPage<ServiceSummary>>(path);
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
 * One service (`svc.service-detail`).
 *
 * The response carries an ETag holding `recordVersion`, and that version is the
 * `If-Match` every guarded write below needs — so this read is what makes a
 * stale write a genuine conflict rather than an accident.
 */
export async function readService(serviceId: string): Promise<ReadState<ServiceDetail>> {
  return readOperation<ServiceDetail>(servicePath(serviceId));
}

/**
 * The tenant taxonomy (`svc.service-category-list`), for the category picker
 * and for labelling `categoryId` on the catalogue.
 *
 * The operation is paginated and its page size is capped at 100 by the
 * pagination contract, so this asks for the maximum and the screen reads
 * `hasMore` rather than assuming the taxonomy fitted. A taxonomy of more than
 * a hundred categories is a screen-design question for the wave that meets
 * it, not something to paper over by silently dropping the rest.
 */
export async function listServiceCategories(): Promise<ReadState<CursorPage<ServiceCategory>>> {
  return readOperation<CursorPage<ServiceCategory>>(
    `/api/v1/service-categories${query({ limit: 100 })}`
  );
}

/**
 * The tenant's branches (`org.branch-list`), for the availability picker.
 *
 * A DIFFERENT permission from the catalogue's — `org.branch.read` — so this
 * read can be refused on its own, and the screen must be able to say so and
 * fall back to a plain identifier field rather than render an empty picker
 * that claims the tenant has no branches.
 */
export async function listBranches(): Promise<ReadState<ItemsOnly<BranchOption>>> {
  return readOperation<ItemsOnly<BranchOption>>('/api/v1/org/branches');
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Create a service (`svc.service-create`).
 *
 * Idempotent, so the transport attaches a key; the created row comes back with
 * its `recordVersion`, which the screen needs immediately if it goes on to edit
 * or publish. The backend requires `svc.service.manage` TENANT-WIDE for this
 * and answers 403 to a branch-scoped holder; that refusal renders as a refusal.
 */
export async function createService(
  body: ServiceCreateBody,
  attempt = 1
): Promise<CreateOutcome<ServiceDetail>> {
  const client = await authorizedClient();
  if (!client) {
    return {
      state: { status: 'expired', messageKey: 'state.expired.title', attempt },
      created: null,
    };
  }
  const result = await client.send<ServiceDetail>('POST', '/api/v1/services', body);
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: { ...success('services.create.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * Edit a service (`svc.service-update`), `If-Match` REQUIRED.
 *
 * `description` is three-way and is passed through UNCHANGED: omitted leaves it
 * alone, `null` clears it, a string sets it. `serviceCode` is not in the body
 * type at all — it is immutable and the route's `.strict()` schema would refuse
 * it rather than ignore it.
 */
export async function updateService(
  serviceId: string,
  body: ServiceUpdateBody,
  ifMatch: number,
  attempt = 1
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<ServiceDetail>('PATCH', servicePath(serviceId), body, {
    ifMatch,
  });
  if (!result.ok) return fromFailure(result, attempt);
  return { ...success('services.update.success', attempt), correlationId: result.correlationId };
}

/**
 * Set whether a service is offered at one branch
 * (`svc.branch-availability-set`).
 *
 * The company/branch pair in the body is the operation's scope TARGET; the
 * backend authorizes it against the caller's grants before writing, so a
 * branch the operator may not administer is refused there, not here.
 */
export async function setBranchAvailability(
  serviceId: string,
  body: BranchAvailabilitySetBody,
  attempt = 1
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<BranchAvailability>(
    'POST',
    servicePath(serviceId, '/branch-availability'),
    body
  );
  if (!result.ok) return fromFailure(result, attempt);
  return {
    ...success('services.availability.success', attempt),
    correlationId: result.correlationId,
  };
}

/**
 * Create a DRAFT version (`svc.service-version-create`).
 *
 * Not version-guarded, by A0 decision S-03: creating the next draft mutates
 * nothing that exists yet. The draft comes back with the only copy of its id
 * the API will ever publish — there is no version list — so the screen holds
 * it for publication.
 */
export async function createServiceVersion(
  serviceId: string,
  body: ServiceVersionCreateBody,
  attempt = 1
): Promise<CreateOutcome<ServiceVersion>> {
  const client = await authorizedClient();
  if (!client) {
    return {
      state: { status: 'expired', messageKey: 'state.expired.title', attempt },
      created: null,
    };
  }
  const result = await client.send<ServiceVersion>(
    'POST',
    servicePath(serviceId, '/versions'),
    body
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: { ...success('services.version.created', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * Publish a draft (`svc.service-version-publish`), `If-Match` REQUIRED and
 * guarding the SERVICE's `recordVersion` — the row `svc.publish_service_version`
 * locks first, and the row a concurrent editor moves.
 */
export async function publishServiceVersion(
  serviceId: string,
  versionId: string,
  body: ServiceVersionPublishBody,
  ifMatch: number,
  attempt = 1
): Promise<ActionState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<ServiceVersion>(
    'POST',
    servicePath(serviceId, `/versions/${encodeURIComponent(versionId)}/publication`),
    body,
    { ifMatch }
  );
  if (!result.ok) return fromFailure(result, attempt);
  return { ...success('services.version.published', attempt), correlationId: result.correlationId };
}

/**
 * Create a category (`svc.service-category-create`) — the head of the
 * commercial chain A1 opened: without a category no service can be created.
 * Tenant-wide, and the backend demands `svc.service.manage` held tenant-wide.
 */
export async function createServiceCategory(
  body: ServiceCategoryCreateBody,
  attempt = 1
): Promise<CreateOutcome<ServiceCategory>> {
  const client = await authorizedClient();
  if (!client) {
    return {
      state: { status: 'expired', messageKey: 'state.expired.title', attempt },
      created: null,
    };
  }
  const result = await client.send<ServiceCategory>('POST', '/api/v1/service-categories', body);
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('services.category.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}
