/**
 * Appointment/reception configuration-catalogue repository — reads and the
 * management writes (P1-27 remediation, executed by P1-18: `P1-27-INT-018`).
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
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPageWithCursors,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';
import { INTAKE_CATALOGUE_DESCRIPTORS } from '../domain/intake-catalogue';

/** One catalogue entry. The same four columns for all seven relations. */
export interface IntakeCatalogueEntry {
  readonly id: string;
  /** `platform` or `tenant`, so a screen can mark a tenant's own additions. */
  readonly scope: string;
  readonly code: string;
  readonly name: string;
}

/**
 * The administrative view of one entry, used by the management commands.
 *
 * Carries `status` and `recordVersion`, which the picker read deliberately does
 * not: the read serves forms that are about to reference a row and therefore
 * shows active rows only, while management must see a retired row in order to
 * restore it, and must publish the version its own guarded writes demand.
 */
export interface IntakeCatalogueRecord {
  readonly id: string;
  readonly scope: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}

/** What a tenant may create. `scope`, `tenant_id` and `created_by` are never caller-supplied. */
export interface IntakeCatalogueCreateInput {
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
 *
 * The relation strings are NOT repeated here — they are read from
 * `INTAKE_CATALOGUE_DESCRIPTORS`, which the management commands also read for
 * their audit vocabulary. Two hand-maintained copies of the same seven table
 * names is exactly the drift this module cannot afford: a mismatch would audit
 * one relation while writing another, and both halves would look correct in
 * isolation.
 */
const RELATIONS = {
  appointment_types: {
    relation: INTAKE_CATALOGUE_DESCRIPTORS.appointment_types.relation,
    ordering: APPOINTMENT_TYPE_ORDERING,
  },
  source_channels: {
    relation: INTAKE_CATALOGUE_DESCRIPTORS.source_channels.relation,
    ordering: SOURCE_CHANNEL_ORDERING,
  },
  cancellation_reasons: {
    relation: INTAKE_CATALOGUE_DESCRIPTORS.cancellation_reasons.relation,
    ordering: CANCELLATION_REASON_ORDERING,
  },
  visit_reasons: {
    relation: INTAKE_CATALOGUE_DESCRIPTORS.visit_reasons.relation,
    ordering: VISIT_REASON_ORDERING,
  },
  fuel_levels: {
    relation: INTAKE_CATALOGUE_DESCRIPTORS.fuel_levels.relation,
    ordering: FUEL_LEVEL_ORDERING,
  },
  warning_light_codes: {
    relation: INTAKE_CATALOGUE_DESCRIPTORS.warning_light_codes.relation,
    ordering: WARNING_LIGHT_CODE_ORDERING,
  },
  refusal_reasons: {
    relation: INTAKE_CATALOGUE_DESCRIPTORS.refusal_reasons.relation,
    ordering: REFUSAL_REASON_ORDERING,
  },
} as const satisfies Record<
  keyof typeof INTAKE_CATALOGUE_DESCRIPTORS,
  { relation: string; ordering: OrderingContract }
>;

export type IntakeCatalogue = keyof typeof RELATIONS;

/**
 * The seven keys as a runtime value, frozen.
 *
 * `IntakeCatalogue` is a compile-time union and TypeScript types are erased, so
 * a key that arrived from a request would type-check as whatever the caller
 * asserted. `assertCatalogue` below turns the union into a runtime allow-list,
 * which is what actually stands between a request and the relation name that is
 * interpolated into SQL.
 */
export const INTAKE_CATALOGUES = Object.freeze(Object.keys(RELATIONS) as IntakeCatalogue[]);

/**
 * Refuses anything that is not one of the seven keys, at runtime.
 *
 * The read path never needed this: it exposes one wrapper method per catalogue,
 * so no value flows from a caller into `RELATIONS[...]` at all. The management
 * commands take the key as an argument, so the guarantee has to be re-earned
 * here rather than inherited from the type.
 */
function assertCatalogue(catalogue: IntakeCatalogue): IntakeCatalogue {
  if (!Object.hasOwn(RELATIONS, catalogue)) {
    throw new AppFailure('ERR-SYS-001', {
      message: 'Unknown intake catalogue',
    });
  }
  return catalogue;
}

interface CatalogueRow {
  id: string;
  scope: string;
  code: string;
  name: string;
}

interface CatalogueRecordRow extends CatalogueRow {
  status: string;
  record_version: number;
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

  // -------------------------------------------------------------------------
  // Management writes (P1-27-INT-018 remediation, executed by P1-18).
  //
  // The database has permitted these since 20260721091000/095000 — every one of
  // the seven relations carries `GRANT SELECT, INSERT, UPDATE ... TO app_runtime`
  // and an `ins_<t>_tenant` / `upd_<t>_tenant` policy — and no operation ever
  // published them. That is what made the catalogues unpopulatable and the
  // screens above them unusable: `appointmentTypeId` is a REQUIRED uuid on
  // `apt.appointment-create`, the tables ship zero rows by the no-fake-data
  // policy, and nothing anywhere could add the first one.
  //
  // There is NO delete method, and there is no way to add one: `app_runtime`
  // holds no DELETE grant on any of the seven relations and no DELETE policy
  // exists, so a hard removal fails at the database whatever this file says.
  // Retirement is `status = 'inactive'`, which the picker read already filters
  // out while every foreign key that references the row stays satisfied.
  // -------------------------------------------------------------------------

  /**
   * Inserts a tenant row.
   *
   * `scope` is pinned to `'tenant'` and `tenant_id` comes from the resolved
   * principal, never the request — the `ins_<t>_tenant` policy's WITH CHECK
   * requires exactly that pair, so a platform row cannot be manufactured here
   * even if this statement tried.
   */
  async insert(
    db: DbHandle,
    catalogue: IntakeCatalogue,
    input: IntakeCatalogueCreateInput
  ): Promise<IntakeCatalogueRecord | null> {
    const { relation } = RELATIONS[assertCatalogue(catalogue)];
    const context = this.assertContext(db);
    const result = await this.run<CatalogueRecordRow>(
      db,
      `INSERT INTO ${relation} (scope, tenant_id, code, name, created_by)
            VALUES ('tenant', $1, $2, $3, $4)
         RETURNING id, scope, code, name, status, record_version`,
      [context.principal.tenantId, input.code, input.name, context.principal.userId]
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  /**
   * Reads one entry the caller can see, retired rows included.
   *
   * Deliberately not filtered to `scope = 'tenant'`: a platform row IS visible
   * to the caller, and the service has to tell "you may not edit the shared
   * default" apart from "no such row", which a scope-filtered probe could not.
   */
  async findVisible(
    db: DbHandle,
    catalogue: IntakeCatalogue,
    id: string
  ): Promise<IntakeCatalogueRecord | null> {
    const { relation } = RELATIONS[assertCatalogue(catalogue)];
    this.assertContext(db);
    const result = await this.run<CatalogueRecordRow>(
      db,
      `SELECT id, scope, code, name, status, record_version
         FROM ${relation}
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  /**
   * Renames a tenant row under its record version.
   *
   * `code` is absent on purpose and would fail anyway: `tg_<t>_immutable` freezes
   * `scope, tenant_id, code, created_at, created_by`. A code is what every
   * existing reference means, so renaming the label is an edit and changing the
   * code would be a different row wearing the old one's identity.
   */
  async rename(
    db: DbHandle,
    catalogue: IntakeCatalogue,
    id: string,
    expectedVersion: number,
    name: string
  ): Promise<IntakeCatalogueRecord | null> {
    const { relation } = RELATIONS[assertCatalogue(catalogue)];
    const context = this.assertContext(db);
    const result = await this.run<CatalogueRecordRow>(
      db,
      `UPDATE ${relation}
          SET name = $4
        WHERE id = $1 AND tenant_id = $2 AND record_version = $3
          AND scope = 'tenant' AND deleted_at IS NULL
    RETURNING id, scope, code, name, status, record_version`,
      [id, context.principal.tenantId, expectedVersion, name]
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  /** Retires (`inactive`) or restores (`active`) a tenant row under its version. */
  async setStatus(
    db: DbHandle,
    catalogue: IntakeCatalogue,
    id: string,
    expectedVersion: number,
    status: string
  ): Promise<IntakeCatalogueRecord | null> {
    const { relation } = RELATIONS[assertCatalogue(catalogue)];
    const context = this.assertContext(db);
    const result = await this.run<CatalogueRecordRow>(
      db,
      `UPDATE ${relation}
          SET status = $4
        WHERE id = $1 AND tenant_id = $2 AND record_version = $3
          AND scope = 'tenant' AND deleted_at IS NULL
    RETURNING id, scope, code, name, status, record_version`,
      [id, context.principal.tenantId, expectedVersion, status]
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }
}

function toRecord(row: CatalogueRecordRow): IntakeCatalogueRecord {
  return {
    id: row.id,
    scope: row.scope,
    code: row.code,
    name: row.name,
    status: row.status,
    recordVersion: row.record_version,
  };
}
