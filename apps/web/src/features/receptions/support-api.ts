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
 * | `iam.user-list`                  | `/iam/users`                      | `iam.user.read`      |
 * | `apt.appointment-list`           | `/appointments`                   | `apt.appointment.read` |
 *
 * Thin copies of adapters that live in `features/crm` and `features/vehicles`,
 * NOT imports of them: a feature may never import another feature, and `lib/`
 * is for modules both trees genuinely co-own — the `catalogue-api.ts` reasoning
 * beside this file. Each function sends exactly what the published `.strict()`
 * query names and interprets nothing. The row types name only the fields this
 * feature renders; every one is a subset of the published response.
 *
 * ## G-EMP — the receiving employee has NO referent (named open decision)
 *
 * `rec.reception_visits.receiving_employee_id` has no foreign key and no
 * employee master exists anywhere in the platform — the P1-27 archaeology
 * recorded this as the named open decision G-EMP. The picker below offers
 * PLATFORM USERS (`iam.user-list`) as candidates because a user id is the only
 * identity the platform can resolve to a name, and the operator receiving a
 * vehicle is a signed-in user. That is a stand-in, not an employee register:
 * the stored value is a bare identifier the detail read cannot label
 * (`ReceptionDetail.receivingEmployeeId` is documented bare for the same
 * reason), and this module does NOT invent an employee master to hide that.
 * The check-in screen states the disposition beside the control.
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

/** One receiving-employee candidate — a platform user (see G-EMP above). */
export interface ReceivingEmployeeCandidate {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: string;
}

/**
 * Candidates for the receiving-employee picker (`iam.user-list`).
 *
 * `search` is sent as an encoded parameter of a POST-backed Server Action and
 * never reaches the address bar. The read searches on intent — the picker's
 * Search button — never on a keystroke.
 */
export async function listReceivingEmployeeCandidates(
  search: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<ReceivingEmployeeCandidate>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/iam/users' +
    query({
      cursor,
      limit: request.pageSize,
      search: search.trim() || undefined,
    });

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
