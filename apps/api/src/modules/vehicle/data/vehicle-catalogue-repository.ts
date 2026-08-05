/**
 * Vehicle reference-catalogue READ repository (P1-17 remediation,
 * `P1-27-INT-007`).
 *
 * `veh.makes`, `veh.models`, `veh.trims`, `veh.body_types` and
 * `veh.powertrain_types` had **no read operation of any kind**. Twenty-two
 * vehicle operations existed and not one of them listed a catalogue.
 *
 * The consequences were concrete and both land on the vehicle screens:
 *
 * - `POST /vehicles` accepts `makeId`, `modelId`, `trimId`, `bodyTypeId` and
 *   `powertrainTypeId` — five uuids — and nothing published the options. An
 *   operator could not choose a make, so a vehicle could only ever be created
 *   with those five fields left null.
 * - `VehicleSearchHit` projects `makeId` and `modelId` and no names, so a search
 *   result shows a uuid where "Toyota Camry" belongs. The DETAIL read already
 *   resolves both names; only the search projection does not.
 *
 * ## Scope is the whole point of these tables, and RLS already expresses it
 *
 * Every row is `scope = 'platform'` or `scope = 'tenant'`, and
 * `ck_*_scope_tenant` ties `tenant_id` to that choice: platform rows carry NULL,
 * tenant rows carry an id. A tenant sees **the platform catalogue plus its own
 * additions**, and that union is stated once, in the policy:
 *
 *     USING (scope = 'platform' OR tenant_id = iam.current_tenant_id())
 *
 * So these queries do **not** filter by tenant, and deliberately do not call
 * `assertContext`. Re-implementing the union in SQL would put a second copy of
 * the rule in the codebase, and a `tenant_id = $1` predicate here would be
 * strictly wrong — it would hide every platform row from every tenant.
 *
 * ## Soft deletes are excluded, and the unique indexes say why
 *
 * `uq_makes_platform_code` is partial on `deleted_at IS NULL`, so a retired code
 * can be reissued. A list that ignored `deleted_at` would show the retired "TOY"
 * and the current "TOY" as two makes with one name.
 *
 * ## Sorted by name, and the cursor is built from the same pair
 *
 * A picker ordered by `created_at` is ordered by nothing a human can see. These
 * order by `(name, id)` ascending and mint the cursor from `name` — the column
 * the `ORDER BY` actually names. That also sidesteps `P1-27-INT-006` entirely:
 * there is no `timestamptz` in the sort key, so there is no microsecond to lose.
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

/** One catalogue entry. The same five columns for all five relations. */
export interface CatalogueEntry {
  readonly id: string;
  /** `platform` or `tenant`, so a screen can mark a tenant's own additions. */
  readonly scope: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

export interface ModelEntry extends CatalogueEntry {
  readonly makeId: string;
}

export interface TrimEntry extends CatalogueEntry {
  readonly modelId: string;
}

export const MAKE_ORDERING: OrderingContract = {
  key: 'veh.makes:name_asc',
  direction: 'asc',
};
export const MODEL_ORDERING: OrderingContract = {
  key: 'veh.models:name_asc',
  direction: 'asc',
};
export const TRIM_ORDERING: OrderingContract = {
  key: 'veh.trims:name_asc',
  direction: 'asc',
};
export const BODY_TYPE_ORDERING: OrderingContract = {
  key: 'veh.body_types:name_asc',
  direction: 'asc',
};
export const POWERTRAIN_TYPE_ORDERING: OrderingContract = {
  key: 'veh.powertrain_types:name_asc',
  direction: 'asc',
};

interface CatalogueRow {
  id: string;
  scope: string;
  code: string;
  name: string;
  status: string;
}

/**
 * The three relations with no parent, as a frozen map.
 *
 * The relation name is interpolated into SQL, so it must be impossible for one
 * to arrive from a request. Callers name a KEY of this object; there is no
 * public method that takes a table name.
 */
const SIMPLE_RELATIONS = {
  makes: MAKE_ORDERING,
  body_types: BODY_TYPE_ORDERING,
  powertrain_types: POWERTRAIN_TYPE_ORDERING,
} as const;

type SimpleRelation = keyof typeof SIMPLE_RELATIONS;

export class VehicleCatalogueRepository extends Repository {
  protected readonly module = 'vehicle';

  async #listSimple(
    db: DbHandle,
    relation: SimpleRelation,
    page: PageRequest
  ): Promise<Page<CatalogueEntry>> {
    const ordering = SIMPLE_RELATIONS[relation];
    const values: unknown[] = [];
    const keyset = keysetFragment(page, { sort: 'name', id: 'id' }, ordering, 1);
    values.push(...keyset.values);

    const result = await this.run<CatalogueRow>(
      db,
      `SELECT id, scope, code, name, status
         FROM veh.${relation}
        WHERE deleted_at IS NULL ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );

    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          id: row.id,
          scope: row.scope,
          code: row.code,
          name: row.name,
          status: row.status,
        },
        // The cursor value is `name` — the column the ORDER BY names. A cursor
        // minted from a different column than the sort silently skips rows.
        sortValue: row.name,
        id: row.id,
      })),
      page,
      ordering
    );
  }

  async listMakes(db: DbHandle, page: PageRequest): Promise<Page<CatalogueEntry>> {
    return this.#listSimple(db, 'makes', page);
  }

  async listBodyTypes(db: DbHandle, page: PageRequest): Promise<Page<CatalogueEntry>> {
    return this.#listSimple(db, 'body_types', page);
  }

  async listPowertrainTypes(db: DbHandle, page: PageRequest): Promise<Page<CatalogueEntry>> {
    return this.#listSimple(db, 'powertrain_types', page);
  }

  /**
   * The models of one make.
   *
   * `makeId` is a **parameter**, never interpolated, and it is deliberately not
   * validated against `veh.makes` first: an unknown make and an invisible one
   * both yield an empty page, which is the same answer a real make with no
   * models gives. Distinguishing them would make this an existence oracle for
   * another tenant's catalogue additions.
   */
  async listModels(db: DbHandle, makeId: string, page: PageRequest): Promise<Page<ModelEntry>> {
    const values: unknown[] = [makeId];
    const keyset = keysetFragment(page, { sort: 'name', id: 'id' }, MODEL_ORDERING, 2);
    values.push(...keyset.values);

    const result = await this.run<CatalogueRow & { make_id: string }>(
      db,
      `SELECT id, scope, code, name, status, make_id
         FROM veh.models
        WHERE deleted_at IS NULL AND make_id = $1 ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );

    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          id: row.id,
          scope: row.scope,
          code: row.code,
          name: row.name,
          status: row.status,
          makeId: row.make_id,
        },
        sortValue: row.name,
        id: row.id,
      })),
      page,
      MODEL_ORDERING
    );
  }

  /** The trims of one model. Same reasoning as `listModels`. */
  async listTrims(db: DbHandle, modelId: string, page: PageRequest): Promise<Page<TrimEntry>> {
    const values: unknown[] = [modelId];
    const keyset = keysetFragment(page, { sort: 'name', id: 'id' }, TRIM_ORDERING, 2);
    values.push(...keyset.values);

    const result = await this.run<CatalogueRow & { model_id: string }>(
      db,
      `SELECT id, scope, code, name, status, model_id
         FROM veh.trims
        WHERE deleted_at IS NULL AND model_id = $1 ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );

    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          id: row.id,
          scope: row.scope,
          code: row.code,
          name: row.name,
          status: row.status,
          modelId: row.model_id,
        },
        sortValue: row.name,
        id: row.id,
      })),
      page,
      TRIM_ORDERING
    );
  }
}
