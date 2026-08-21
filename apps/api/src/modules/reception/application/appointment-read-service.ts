/**
 * Appointment READ service (P1-27 remediation, executed by P1-18:
 * `P1-27-INT-019`).
 *
 * Two read use cases: the branch calendar list and the id-addressed detail.
 * The detail answers the uniform `ERR-RES-001` 404 for absent, deleted and
 * cross-tenant ids alike, then re-authorizes against the row's OWN company and
 * branch (P1-18-A-01) — the pre-handler check ran with no scope to name. The
 * list takes its scope from the validated query, which the route also passes
 * as the `authorizationTarget`.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { pageRequest, type Page } from '@/server/db/pagination';
import {
  APPOINTMENT_LIST_ORDERING,
  type AppointmentDetailRow,
  type AppointmentListEntry,
  type AppointmentReadRepository,
} from '../data/appointment-read-repository';

export class AppointmentReadService extends ApplicationService {
  protected readonly module = 'reception';

  constructor(private readonly reads: AppointmentReadRepository) {
    super();
  }

  /** The detail. The ETag the route emits is this row's `recordVersion`. */
  async readAppointment(
    db: DbHandle,
    appointmentId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<AppointmentDetailRow> {
    const detail = await this.reads.findAppointmentDetail(db, appointmentId);
    if (!detail) {
      throw new AppFailure('ERR-RES-001', { message: 'Appointment was not found' });
    }
    await authorizeScope({ companyId: detail.companyId, branchId: detail.branchId });
    return detail;
  }

  /** The branch calendar, soonest effective start first. */
  async listAppointments(
    db: DbHandle,
    query: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
      readonly vehicleId?: string | undefined;
      readonly from?: string | undefined;
      readonly to?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    }
  ): Promise<Page<AppointmentListEntry>> {
    return this.reads.listAppointments(
      db,
      {
        companyId: query.companyId,
        branchId: query.branchId,
        status: query.status,
        vehicleId: query.vehicleId,
        from: query.from,
        to: query.to,
      },
      pageRequest(APPOINTMENT_LIST_ORDERING, query)
    );
  }
}
