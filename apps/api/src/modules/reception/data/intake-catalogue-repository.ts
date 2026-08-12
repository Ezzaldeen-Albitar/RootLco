/**
 * Appointment/reception configuration-catalogue READ repository (P1-27
 * remediation, executed by P1-18: `P1-27-INT-018`).
 *
 * Seven dual-scope catalogues the intake writes reference by uuid — three `apt`
 * (appointment types, source channels, cancellation reasons) and four `rec`
 * (visit reasons, fuel levels, warning-light codes, refusal reasons) — had no
 * read of any kind, so no picker could populate itself: a cancellation could
 * not name its mandatory reason and a check-in could not offer a fuel level.
 *
 * ## Scope is RLS's, not this repository's
 *
 * Every row is `scope = 'platform'` (tenant_id NULL) or `scope = 'tenant'`, and
 * the SELECT policy states the union once:
 * `USING (scope = 'platform' OR tenant_id = iam.current_tenant_id())`. These
 * queries therefore carry NO tenant predicate — one here would hide every
 * platform row from every tenant (the `vehicle-catalogue` precedent).
 *
 * ## Active rows only
 *
 * Each table carries `status IN ('active','inactive')` and a partial-unique
 * soft delete. These reads serve PICKERS for writes that are about to reference
 * a row, so a retired or soft-deleted code must not be offered: the filter is
 * `status = 'active' AND deleted_at IS NULL`. (The vehicle catalogue projects
 * `status` instead; the difference is deliberate and recorded — these lists
 * exist to feed mandatory references, not to administrate the catalogue.)
 *
 * ## Empty is the honest answer
 *
 * Zero rows ship, by the no-fake-data policy. An empty page is the catalogue
 * working as designed; population is a provisioning decision recorded
 * elsewhere, never a seed in this repository.
 *
 * Sorted by `(name, id)` ascending with the cursor minted from `name` — the
 * column the ORDER BY names — so there is no timestamp in the sort key and
 * `P1-27-INT-006` cannot apply.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPageWithCursors,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';

/** One catalogue entry. The same four columns for all seven relations. */
export interface IntakeCatalogueEntry {
  readonly id: string;
  /** `platform` or `tenant`, so a screen can mark a tenant's own additions. */
  readonly scope: string;
  readonly code: string;
  readonly name: string;
}

export const APPOINTMENT_TYPE_ORDERING: OrderingContract = {
  key: 'apt.appointment_types:name_asc',
  direction: 'asc',
};
export const SOURCE_CHANNEL_ORDERING: OrderingContract = {
  key: 'apt.source_channels:name_asc',
  direction: 'asc',
};
export const CANCELLATION_REASON_ORDERING: OrderingContract = {
  key: 'apt.cancellation_reasons:name_asc',
  direction: 'asc',
};
export const VISIT_REASON_ORDERING: OrderingContract = {
  key: 'rec.visit_reasons:name_asc',
  direction: 'asc',
};
export const FUEL_LEVEL_ORDERING: OrderingContract = {
  key: 'rec.fuel_levels:name_asc',
  direction: 'asc',
};
export const WARNING_LIGHT_CODE_ORDERING: OrderingContract = {
  key: 'rec.warning_light_codes:name_asc',
  direction: 'asc',
};
export const REFUSAL_REASON_ORDERING: OrderingContract = {
  key: 'rec.refusal_reasons:name_asc',
  direction: 'asc',
};

/**
 * The seven relations, as a frozen map. The qualified relation name is
 * interpolated into SQL, so it must be impossible for one to arrive from a
 * request: callers name a KEY of this object, and no public method takes a
 * table name.
 */
const RELATIONS = {
  appointment_types: { relation: 'apt.appointment_types', ordering: APPOINTMENT_TYPE_ORDERING },
  source_channels: { relation: 'apt.source_channels', ordering: SOURCE_CHANNEL_ORDERING },
  cancellation_reasons: {
    relation: 'apt.cancellation_reasons',
    ordering: CANCELLATION_REASON_ORDERING,
  },
  visit_reasons: { relation: 'rec.visit_reasons', ordering: VISIT_REASON_ORDERING },
  fuel_levels: { relation: 'rec.fuel_levels', ordering: FUEL_LEVEL_ORDERING },
  warning_light_codes: {
    relation: 'rec.warning_light_codes',
    ordering: WARNING_LIGHT_CODE_ORDERING,
  },
  refusal_reasons: { relation: 'rec.refusal_reasons', ordering: REFUSAL_REASON_ORDERING },
} as const;

type IntakeCatalogue = keyof typeof RELATIONS;

interface CatalogueRow {
  id: string;
  scope: string;
  code: string;
  name: string;
}

export class IntakeCatalogueRepository extends Repository {
  protected readonly module = 'reception';

  async #list(
    db: DbHandle,
    catalogue: IntakeCatalogue,
    page: PageRequest
  ): Promise<Page<IntakeCatalogueEntry>> {
    const { relation, ordering } = RELATIONS[catalogue];
    const values: unknown[] = [];
    const keyset = keysetFragment(page, { sort: 'name', id: 'id' }, ordering, 1);
    values.push(...keyset.values);

    const result = await this.run<CatalogueRow>(
      db,
      `SELECT id, scope, code, name
         FROM ${relation}
        WHERE deleted_at IS NULL AND status = 'active' ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );

    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: { id: row.id, scope: row.scope, code: row.code, name: row.name },
        // The cursor value is `name` — the column the ORDER BY names. A cursor
        // minted from a different column than the sort silently skips rows.
        sortValue: row.name,
        id: row.id,
      })),
      page,
      ordering
    );
  }

  async listAppointmentTypes(db: DbHandle, page: PageRequest): Promise<Page<IntakeCatalogueEntry>> {
    return this.#list(db, 'appointment_types', page);
  }

  async listSourceChannels(db: DbHandle, page: PageRequest): Promise<Page<IntakeCatalogueEntry>> {
    return this.#list(db, 'source_channels', page);
  }

  async listCancellationReasons(
    db: DbHandle,
    page: PageRequest
  ): Promise<Page<IntakeCatalogueEntry>> {
    return this.#list(db, 'cancellation_reasons', page);
  }

  async listVisitReasons(db: DbHandle, page: PageRequest): Promise<Page<IntakeCatalogueEntry>> {
    return this.#list(db, 'visit_reasons', page);
  }

  async listFuelLevels(db: DbHandle, page: PageRequest): Promise<Page<IntakeCatalogueEntry>> {
    return this.#list(db, 'fuel_levels', page);
  }

  async listWarningLightCodes(
    db: DbHandle,
    page: PageRequest
  ): Promise<Page<IntakeCatalogueEntry>> {
    return this.#list(db, 'warning_light_codes', page);
  }

  async listRefusalReasons(db: DbHandle, page: PageRequest): Promise<Page<IntakeCatalogueEntry>> {
    return this.#list(db, 'refusal_reasons', page);
  }
}
