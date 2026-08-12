/**
 * Appointment/reception configuration-catalogue READ service (P1-27
 * remediation, executed by P1-18: `P1-27-INT-018`).
 *
 * Thin by design: a catalogue read has no lifecycle, no scope beyond the RLS
 * union, and no decision to make — it validates the page input against the
 * list's own ordering contract and delegates. Empty pages are the no-fake-data
 * policy working, not a fault.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type OrderingContract, type Page } from '@/server/db/pagination';
import {
  APPOINTMENT_TYPE_ORDERING,
  CANCELLATION_REASON_ORDERING,
  FUEL_LEVEL_ORDERING,
  REFUSAL_REASON_ORDERING,
  SOURCE_CHANNEL_ORDERING,
  VISIT_REASON_ORDERING,
  WARNING_LIGHT_CODE_ORDERING,
  type IntakeCatalogueEntry,
  type IntakeCatalogueRepository,
} from '../data/intake-catalogue-repository';

export interface PageInput {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export class IntakeCatalogueService extends ApplicationService {
  protected readonly module = 'reception';

  constructor(private readonly catalogues: IntakeCatalogueRepository) {
    super();
  }

  #page(input: PageInput, ordering: OrderingContract) {
    return pageRequest(ordering, input);
  }

  async listAppointmentTypes(db: DbHandle, input: PageInput): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listAppointmentTypes(db, this.#page(input, APPOINTMENT_TYPE_ORDERING));
  }

  async listSourceChannels(db: DbHandle, input: PageInput): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listSourceChannels(db, this.#page(input, SOURCE_CHANNEL_ORDERING));
  }

  async listCancellationReasons(
    db: DbHandle,
    input: PageInput
  ): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listCancellationReasons(
      db,
      this.#page(input, CANCELLATION_REASON_ORDERING)
    );
  }

  async listVisitReasons(db: DbHandle, input: PageInput): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listVisitReasons(db, this.#page(input, VISIT_REASON_ORDERING));
  }

  async listFuelLevels(db: DbHandle, input: PageInput): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listFuelLevels(db, this.#page(input, FUEL_LEVEL_ORDERING));
  }

  async listWarningLightCodes(db: DbHandle, input: PageInput): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listWarningLightCodes(
      db,
      this.#page(input, WARNING_LIGHT_CODE_ORDERING)
    );
  }

  async listRefusalReasons(db: DbHandle, input: PageInput): Promise<Page<IntakeCatalogueEntry>> {
    return this.catalogues.listRefusalReasons(db, this.#page(input, REFUSAL_REASON_ORDERING));
  }
}
