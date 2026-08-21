'use server';

import { authorizedClient } from '@/lib/api/server-client';
import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import {
  STATUS_BY_KIND,
  branchTargetQuery,
  query,
  readOperation,
  type BranchTarget,
  type CursorPage,
  type ReadState,
} from '@/lib/api/read-operation';

/**
 * The cross-domain reads the check-in wizard consumes (P1-28, Wave D;
 * `FE-007`/`FE-008`).
 *
 * | operation                        | path                              | permission           |
 * | -------------------------------- | --------------------------------- | -------------------- |
 * | `crm.customer-read`              | `/customers/{customerId}`         | `crm.customer.read`  |
 * | `veh.vehicle-read`               | `/vehicles/{vehicleId}`           | `veh.vehicle.read`   |
 * | `veh.vehicle-relationship-list`  | `/vehicles/{vehicleId}/relationships` | `veh.vehicle.read` |
 * | `rec.receiving-employee-list`    | `/reception-catalogue/receiving-employees` | `rec.reception.manage` |
 * | `apt.appointment-list`           | `/appointments`                   | `apt.appointment.read` |
 *
 * Thin copies of adapters that live in `features/crm` and `features/vehicles`,
 * NOT imports of them: a feature may never import another feature, and `lib/`
 * is for modules both trees genuinely co-own — the `catalogue-api.ts` reasoning
 * beside this file. Each function sends exactly what the published `.strict()`
 * query names and interprets nothing. The row types name only the fields this
 * feature renders; every one is a subset of the published response.
 *
 * ## G-EMP is CLOSED — and this file is where the stand-in was
 *
 * `rec.reception_visits.receiving_employee_id` carried no foreign key and no
 * employee master existed, so the picker below offered PLATFORM USERS through
 * `iam.user-list` and the read-back resolved a name through `iam.user-detail`.
 * Both are gone. `DBCR-P1-18-002` (the Owner's FE-007 decision) gave the column
 * a same-tenant foreign key to `iam.user_accounts`, an insert-time eligibility
 * guard, and an immutable display-name snapshot, and published
 * `rec.receiving-employee-list` as the picker the reception desk actually needs.
 *
 * Three things change here, and each of them is a NARROWING:
 *
 *   - The candidate read is `rec.receiving-employee-list`, behind
 *     `rec.reception.manage` — the code that opens a check-in. It answers the
 *     ACTIVE accounts whose live role grants cover the branch being received
 *     into. `iam.user-list` answered every account in the tenant, at tenant
 *     scope, behind a code every signed-in operator holds; so a receptionist who
 *     could see the whole staff directory now sees the people eligible for one
 *     branch.
 *   - The read-back is not a read at all. `rec.reception-detail` carries
 *     `receivingEmployeeDisplayName`, written at insert and immutable after, so
 *     the wizard header and the customer's acknowledgement sheet name the
 *     custodian without asking the user directory anything. A rename or a
 *     disabled account cannot rewrite a handover that already happened.
 *   - The picker does NOT widen for an actor holding
 *     `rec.reception.receiving_employee.assign_any`. Naming somebody outside the
 *     branch is an explicit administrative act taken against the user directory;
 *     a picker that silently grew under a permission the operator cannot see
 *     would be the same disclosure this change removed, reintroduced quietly.
 *
 * The authority is still not this screen. `rec.stamp_receiving_employee_identity()`
 * decides inside the insert, against the ACTOR's authority in the visit's own
 * scope, so a caller that never loads this picker is subject to the same rule.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

/** The customer identity the confirmation step presents. Subset of `crm.customer-read`. */
export interface CheckInCustomerSummary {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly displayName: string;
  readonly partyType: string;
  readonly lifecycleStatus: string;
}

export async function readCustomerSummary(
  customerId: string
): Promise<ReadState<CheckInCustomerSummary>> {
  return readOperation<CheckInCustomerSummary>(
    `/api/v1/customers/${encodeURIComponent(customerId)}`
  );
}

/**
 * The vehicle identity the confirmation step presents. Subset of
 * `veh.vehicle-read` — which returns a MERGED vehicle rather than 404ing it
 * (existing but frozen), so `mergedIntoId` is here and the step renders it
 * honestly instead of treating the visit's vehicle as missing.
 */
export interface CheckInVehicleSummary {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly vin: string | null;
  readonly makeName: string | null;
  readonly modelName: string | null;
  readonly modelYear: number | null;
  readonly color: string | null;
  readonly lifecycleStatus: string;
  readonly workshopStatus: string;
  readonly mergedIntoId: string | null;
}

export async function readVehicleSummary(
  vehicleId: string
): Promise<ReadState<CheckInVehicleSummary>> {
  return readOperation<CheckInVehicleSummary>(`/api/v1/vehicles/${encodeURIComponent(vehicleId)}`);
}

/** One vehicle relationship row, with the party identity resolved. */
export interface CheckInVehicleRelationship {
  readonly id: string;
  readonly partnerId: string;
  readonly partnerName: string | null;
  readonly partnerNumber: string | null;
  readonly partnerType: string | null;
  readonly relationshipRole: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly active: boolean;
}

export async function listVehicleRelationshipEntries(
  vehicleId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<CheckInVehicleRelationship>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/relationships` +
    query({ cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<CheckInVehicleRelationship>>(path, { retries: 0 });
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
 * The one account field the read-back surfaces render. Subset of
 * `iam.user-detail`.
 *
 * `displayName` and nothing else, deliberately: a read-back needs the name of
 * the person who acted, and an email address or an account status beside an
 * inspection would be a disclosure nobody asked for.
 */
export interface UserIdentity {
  readonly id: string;
  readonly displayName: string;
}

/**
 * The name behind an ACTOR identifier (`iam.user-detail`).
 *
 * Not the receiving employee — that name is a snapshot on the visit itself since
 * `DBCR-P1-18-002`, and resolving it here would answer with the account's name
 * today rather than the name recorded when custody was accepted. This read
 * serves the identifiers that genuinely have no snapshot: who recorded an
 * inspection, who bound evidence, who signed.
 *
 * The `not-found` outcome is not a fault. An audit identifier records who acted;
 * it is not a live foreign key, so an identifier naming no current account is a
 * state the platform permits. It reaches the caller as `not-found` and the
 * surfaces say so in words — showing the raw identifier instead would present a
 * dangling value as if it were a person.
 */
export async function readUserIdentity(userId: string): Promise<ReadState<UserIdentity>> {
  return readOperation<UserIdentity>(`/api/v1/iam/users/${encodeURIComponent(userId)}`);
}

/**
 * One eligible custodian.
 *
 * TWO fields, where the directory row had four. `email` and `status` are gone
 * because neither is answerable from this operation and neither was ever the
 * question: `status` is `active` for every row by construction — an inactive
 * account is not offered — and an email address is a contact detail a
 * receptionist choosing a custodian has no use for.
 */
export interface ReceivingEmployeeCandidate {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Candidates for the receiving-employee picker (`rec.receiving-employee-list`).
 *
 * BRANCH-TARGETED, not searched. The operation takes `companyId` and `branchId`
 * and no search term, and that is the shape rather than an omission: the answer
 * is "who may accept custody in the branch you are receiving into", which is a
 * short list the operator scans, not a directory they query. The search box the
 * old picker needed existed because `iam.user-list` answered the whole tenant.
 *
 * `retries: 0` — `low-risk-metadata`, and the picker offers Retry.
 */
export async function listReceivingEmployeeCandidates(
  target: BranchTarget,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<ReceivingEmployeeCandidate>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/reception-catalogue/receiving-employees' +
    branchTargetQuery(target, { cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<ReceivingEmployeeCandidate>>(path, { retries: 0 });
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

/** One appointment the check-in screen can consume. Subset of the calendar row. */
export interface CheckInAppointmentCandidate {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly vehicleId: string;
  readonly vehicleDisplayNumber: string | null;
  readonly requesterPartnerId: string;
  readonly requesterDisplayName: string | null;
  readonly appointmentTypeName: string | null;
  readonly confirmedFrom: string | null;
  readonly confirmedTo: string | null;
}

/**
 * The branch's CONFIRMED appointments (`apt.appointment-list`), for the
 * appointment-origin picker.
 *
 * Filtered to `confirmed` because only a confirmed appointment checks in —
 * anything else is 409 `ERR-TRN-001` — so the picker offers only what can
 * succeed. The mandatory `companyId`/`branchId` pair travels through
 * `branchTargetQuery`, the one door `lib/api` opens for a branch resource
 * selector; the SAME pair is then the create's scope, which is exactly the
 * coherence the backend demands of an appointment origin (422
 * `incoherent_reference` otherwise).
 */
export async function listConfirmedAppointments(
  target: BranchTarget,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<CheckInAppointmentCandidate>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/appointments' +
    branchTargetQuery(target, { status: 'confirmed', cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<CheckInAppointmentCandidate>>(path, { retries: 0 });
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
