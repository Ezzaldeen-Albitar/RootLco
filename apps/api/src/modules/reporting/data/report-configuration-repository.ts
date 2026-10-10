/**
 * Report CONFIGURATION SQL — the administration side of `rpt` (P1-31 P-11).
 *
 * `rpt.report_configurations` and `rpt.report_configuration_versions` landed in
 * P1-11 carrying `SELECT`, `INSERT` and `UPDATE` grants for `app_runtime` and an
 * `INSERT` and an `UPDATE` policy each, and until this slice **no code anywhere in
 * `apps/api/src` had ever written either one.** The only reader is
 * `ReportCatalogueRepository` beside this file, which sees `published`
 * configurations and their newest published version and nothing else — so the
 * live tables held zero rows for every tenant, `rpt.report-catalogue` answered an
 * empty page to everyone, and `rpt.report.configure`, a seeded catalogue code
 * since P1-08, was declared by no operation and named by no policy predicate.
 *
 * Four conventions hold in every statement below.
 *
 *  - **Every query carries an explicit `tenant_id` predicate** even though
 *    `sel_report_configurations_scope` already narrows to
 *    `iam.current_tenant_id()`. RLS is the guarantee; the predicate is the
 *    intent, and it keeps the plan on the tenant-leading unique indexes.
 *  - **Both tables are TENANT-scoped and neither has a company or a branch
 *    column.** There is therefore no company predicate to write and no scope
 *    target to authorize against; the authority is checked tenant-wide by the
 *    route, which is a decision stated at each `defineOperation`.
 *  - **`parameter_schema` is bound as TEXT and cast in SQL** with `$n::jsonb`.
 *    Handing `pg` an object would let the driver choose a serialization for a
 *    column whose exact bytes the freeze trigger compares on every later update.
 *  - **Nothing here soft-deletes and nothing here deletes.** Neither table
 *    carries a `DELETE` grant or a `DELETE` policy for any application role, so a
 *    hard removal is refused by the database however it is asked for.
 *    Retirement is `status = 'archived'`, which is the column the configuration
 *    already carries for it.
 *
 * There is no monetary column in `rpt` at all — no amount, no currency, no rate —
 * so no exactness rule applies to anything this file reads or writes.
 */
import { Repository } from '@/server/db/repository';
import {
  buildPageWithCursors,
  cursorTimestamp,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';
import type { DbHandle } from '@/server/db/transaction';

/**
 * The tenant's report configurations, newest first (P1-31 P-11).
 *
 * `created_at` and not `report_code`, and the difference from `REPORT_ORDERING`
 * beside it is deliberate rather than an oversight. That contract orders the
 * PUBLISHED catalogue by code because a catalogue is a lookup and a code is the
 * only order a caller can predict; this one is an authoring list a person
 * scrolls, where the row written last is the row being looked for.
 *
 * The key is qualified separately for the same reason: a cursor minted for the
 * catalogue must not be replayable against this list, which shows drafts and
 * archived rows the catalogue deliberately hides.
 *
 * The sort column is a `timestamptz` and the cursor value is minted by
 * `cursorTimestamp()` in SQL at MICROSECOND precision. A JS `Date` truncates to
 * milliseconds and then silently SKIPS every row sharing the boundary row's
 * millisecond (`P1-27-INT-006`) — which bites here, because a tenant's initial
 * report set is frequently authored in one sitting.
 */
export const REPORT_CONFIGURATION_ORDER: OrderingContract = Object.freeze({
  key: 'rpt.report_configurations:created_at_desc',
  direction: 'desc',
});

/** One configuration header, as this module reads it. */
export interface ReportConfigurationAdminRow {
  readonly id: string;
  /** `ck_report_configurations_code`: `^[a-z][a-z0-9_]{1,62}$`, frozen once written. */
  readonly reportCode: string;
  readonly name: string;
  /** `branch`, `company` or `tenant`. */
  readonly scopeLevel: string;
  /** FK to `iam.permissions`. The permission an EXPORT would require, never the view one. */
  readonly exportPermissionCode: string;
  readonly ownerUserId: string;
  /** `draft`, `published` or `archived`. */
  readonly status: string;
  readonly recordVersion: number;
}

/** One version of a configuration. A published one is immutable. */
export interface ReportConfigurationVersionRow {
  readonly id: string;
  readonly reportConfigurationId: string;
  /** `ck_report_configuration_versions_number`: at least 1, unique per configuration. */
  readonly versionNumber: number;
  /** The filter allowlist. Its VOCABULARY is Owner-defined and undecided (D-4). */
  readonly parameterSchema: unknown;
  /** `draft` or `published`. There is no archived version. */
  readonly status: string;
  readonly publishedAt: Date | null;
  readonly recordVersion: number;
}

interface ConfigurationSql {
  readonly id: string;
  readonly report_code: string;
  readonly name: string;
  readonly scope_level: string;
  readonly export_permission_code: string;
  readonly owner_user_id: string;
  readonly status: string;
  readonly record_version: number;
}

interface VersionSql {
  readonly id: string;
  readonly report_configuration_id: string;
  readonly version_number: number;
  readonly parameter_schema: unknown;
  readonly status: string;
  readonly published_at: Date | null;
  readonly record_version: number;
}

const CONFIGURATION_COLUMNS = `
  id, report_code, name, scope_level, export_permission_code,
  owner_user_id, status, record_version
`;

const VERSION_COLUMNS = `
  id, report_configuration_id, version_number, parameter_schema,
  status, published_at, record_version
`;

const toConfiguration = (row: ConfigurationSql): ReportConfigurationAdminRow => ({
  id: row.id,
  reportCode: row.report_code,
  name: row.name,
  scopeLevel: row.scope_level,
  exportPermissionCode: row.export_permission_code,
  ownerUserId: row.owner_user_id,
  status: row.status,
  recordVersion: row.record_version,
});

const toVersion = (row: VersionSql): ReportConfigurationVersionRow => ({
  id: row.id,
  reportConfigurationId: row.report_configuration_id,
  versionNumber: row.version_number,
  parameterSchema: row.parameter_schema,
  status: row.status,
  publishedAt: row.published_at,
  recordVersion: row.record_version,
});

export class ReportConfigurationRepository extends Repository {
  protected readonly module = 'reporting';

  /**
   * The tenant's configurations, newest first, ACROSS ALL STATUSES.
   *
   * Deliberately not `status = 'published'`, which is the whole difference
   * between this read and the catalogue: a configuration is authored as a
   * `draft` and published later, so an administration list that showed only
   * published rows would hide every row the caller is here to work on, and would
   * make the restore of an archived one unreachable — the trap
   * `apt.catalogue-source-channel-status-set` records for its own catalogue.
   *
   * Soft-deleted rows ARE excluded. Nothing in this surface sets `deleted_at`,
   * so the predicate defends against a row some later slice retires that way
   * rather than against one this code can produce.
   */
  public async listConfigurations(
    db: DbHandle,
    request: PageRequest,
    filter: { readonly status?: string | undefined } = {}
  ): Promise<Page<ReportConfigurationAdminRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId];
    let statusPredicate = '';
    if (filter.status !== undefined) {
      values.push(filter.status);
      statusPredicate = `AND c.status = $${String(values.length)}`;
    }
    const keyset = keysetFragment(
      request,
      { sort: 'c.created_at', id: 'c.id' },
      REPORT_CONFIGURATION_ORDER,
      values.length + 1
    );
    const result = await this.run<ConfigurationSql & { sort_value: string }>(
      db,
      `SELECT c.id, c.report_code, c.name, c.scope_level, c.export_permission_code,
              c.owner_user_id, c.status, c.record_version,
              ${cursorTimestamp('c.created_at')} AS sort_value
         FROM rpt.report_configurations c
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
          ${statusPredicate}
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        // `created_at` is NOT published on the item, so the cursor value cannot be
        // re-derived from the response — which is what `buildPageWithCursors` is for.
        item: toConfiguration(row),
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      REPORT_CONFIGURATION_ORDER
    );
  }

  /**
   * One live configuration by id alone, or null for absent-and-invisible alike.
   *
   * No status predicate: this is the administration read, and a draft or an
   * archived configuration is exactly what it exists to resolve.
   * `findPublishedByCode` in the catalogue repository keeps its `published`
   * predicate for the opposite reason — it answers a caller who may run the
   * report, not one who authors it.
   */
  public async findConfiguration(
    db: DbHandle,
    configurationId: string
  ): Promise<ReportConfigurationAdminRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ConfigurationSql>(
      db,
      `SELECT ${CONFIGURATION_COLUMNS}
         FROM rpt.report_configurations
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, configurationId]
    );
    return row ? toConfiguration(row) : null;
  }

  /**
   * Every live version of one configuration, ascending by version number.
   *
   * **Deliberately unpaged**, on the `dia.template-version-item-list` precedent:
   * the set is bounded by authoring rather than by growth — a version exists
   * because a person wrote one — and the history of a definition is read as one
   * thing. `uq_report_configuration_versions_number` makes `version_number`
   * unique per configuration, so it is a total order on its own and no tie-break
   * is needed or offered.
   *
   * ASCENDING, unlike the configuration list: a version history is read forwards,
   * and `PUBLISHED_VERSION` in the catalogue repository orders DESCENDING because
   * it is picking one row rather than presenting a sequence.
   */
  public async listVersions(
    db: DbHandle,
    configurationId: string
  ): Promise<readonly ReportConfigurationVersionRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<VersionSql>(
      db,
      `SELECT ${VERSION_COLUMNS}
         FROM rpt.report_configuration_versions
        WHERE tenant_id = $1 AND report_configuration_id = $2 AND deleted_at IS NULL
        ORDER BY version_number ASC`,
      [context.principal.tenantId, configurationId]
    );
    return result.rows.map(toVersion);
  }

  /** One live version OF ONE CONFIGURATION, or null. */
  public async findVersion(
    db: DbHandle,
    configurationId: string,
    versionId: string
  ): Promise<ReportConfigurationVersionRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<VersionSql>(
      db,
      `SELECT ${VERSION_COLUMNS}
         FROM rpt.report_configuration_versions
        WHERE tenant_id = $1 AND report_configuration_id = $2 AND id = $3
          AND deleted_at IS NULL`,
      [context.principal.tenantId, configurationId, versionId]
    );
    return row ? toVersion(row) : null;
  }

  /**
   * Creates a configuration header. It is born a `draft`; nothing else is.
   *
   * `status` is not accepted, because the column defaults to `draft` and a
   * configuration published in the same act that created it would appear in
   * `rpt.report-catalogue` before anyone had read it back. `owner_user_id` is the
   * SESSION's user and never a request field: the column is a claim about who
   * authored the row, and a caller that could set it could author on someone
   * else's behalf.
   *
   * Two failures a caller can cause: `23505` on `uq_report_configurations_code`,
   * and `23503` on `fk_report_configurations_permission` when
   * `export_permission_code` names a code the catalogue does not carry.
   */
  public async insertConfiguration(
    db: DbHandle,
    input: {
      readonly reportCode: string;
      readonly name: string;
      readonly scopeLevel: string;
      readonly exportPermissionCode: string;
    }
  ): Promise<ReportConfigurationAdminRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<ConfigurationSql>(
      db,
      `INSERT INTO rpt.report_configurations
         (tenant_id, report_code, name, scope_level, export_permission_code,
          owner_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING ${CONFIGURATION_COLUMNS}`,
      [
        context.principal.tenantId,
        input.reportCode,
        input.name,
        input.scopeLevel,
        input.exportPermissionCode,
        context.principal.userId,
      ]
    );
    if (!row) {
      throw new Error('reporting: INSERT INTO rpt.report_configurations returned no row');
    }
    return toConfiguration(row);
  }

  /**
   * Updates the name and the scope level under an expected version, or null.
   *
   * Null means the `record_version` predicate did not match. Every other reason
   * for zero rows — absent, another tenant's, soft-deleted — is excluded by the
   * service reading the row first, so the caller may report the concurrency loss
   * and nothing else. The row `shared.touch_row_metadata` produced is returned
   * rather than `expectedVersion + 1`: the next `If-Match` is the database's
   * answer, not this module's assumption about a trigger it does not own.
   *
   * Both columns are always written, with the service supplying the current value
   * for the one the caller omitted. A conditional `SET` list would be a second
   * shape of this statement for no capability.
   */
  public async updateConfiguration(
    db: DbHandle,
    configurationId: string,
    expectedVersion: number,
    input: { readonly name: string; readonly scopeLevel: string }
  ): Promise<ReportConfigurationAdminRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ConfigurationSql>(
      db,
      `UPDATE rpt.report_configurations
          SET name = $4, scope_level = $5
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
          AND record_version = $3
       RETURNING ${CONFIGURATION_COLUMNS}`,
      [context.principal.tenantId, configurationId, expectedVersion, input.name, input.scopeLevel]
    );
    return row ? toConfiguration(row) : null;
  }

  /**
   * Moves a configuration's status under an expected version, or null.
   *
   * It touches the header and nothing else. The VERSIONS are deliberately not
   * cascaded: `PUBLISHED_VERSION` in the catalogue repository selects a version on
   * the VERSION's own status and never reads the header's, so cascading would
   * change what the catalogue resolves for reasons the operator did not choose,
   * and un-archiving could not tell which versions the cascade had moved from
   * which an operator had. Archiving the header is what withdraws the definition
   * from `rpt.report-catalogue`, and that is the whole of its effect.
   */
  public async setConfigurationStatus(
    db: DbHandle,
    configurationId: string,
    expectedVersion: number,
    status: string
  ): Promise<ReportConfigurationAdminRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ConfigurationSql>(
      db,
      `UPDATE rpt.report_configurations
          SET status = $4
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
          AND record_version = $3
       RETURNING ${CONFIGURATION_COLUMNS}`,
      [context.principal.tenantId, configurationId, expectedVersion, status]
    );
    return row ? toConfiguration(row) : null;
  }

  /**
   * Creates the NEXT draft version of a configuration.
   *
   * The number is computed inside the statement as
   * `coalesce(max(version_number), 0) + 1` over a `FOR UPDATE`-locked parent, so
   * two concurrent creates cannot compute the same value and race
   * `uq_report_configuration_versions_number`. The lock is taken on the
   * CONFIGURATION rather than on the version set, because that is the row both
   * writers are guaranteed to contend on and it is the row every other command
   * here reads first.
   *
   * `status` is not accepted: the column defaults to `draft`, and a version born
   * `published` would enter `uq_report_configuration_versions_published` and the
   * catalogue in the same act that created it, with nobody having read it back.
   * Publication is its own command and its own authority-bearing decision.
   *
   * The `max()` scan carries NO `deleted_at` predicate, unlike every other read
   * in this file. `uq_report_configuration_versions_number` is a table constraint
   * and not a partial index, so a soft-deleted row still holds its number and
   * skipping it would compute a value the constraint then refuses.
   */
  public async insertNextVersion(
    db: DbHandle,
    configurationId: string,
    parameterSchemaJson: string
  ): Promise<ReportConfigurationVersionRow> {
    const context = this.assertContext(db);
    // The parent lock. Taken as its own statement rather than folded into the
    // INSERT: a lock acquired in a scalar subquery of the same statement that
    // reads `max(version_number)` is not ordered against the read in any way the
    // planner guarantees.
    await this.run(
      db,
      `SELECT id FROM rpt.report_configurations
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, configurationId]
    );
    const row = await this.runOne<VersionSql>(
      db,
      `INSERT INTO rpt.report_configuration_versions
         (tenant_id, report_configuration_id, version_number, parameter_schema, created_by)
       SELECT $1::uuid, $2::uuid,
              coalesce(max(v.version_number), 0) + 1,
              $3::jsonb,
              $4::uuid
         FROM rpt.report_configuration_versions v
        WHERE v.tenant_id = $1 AND v.report_configuration_id = $2
       RETURNING ${VERSION_COLUMNS}`,
      [context.principal.tenantId, configurationId, parameterSchemaJson, context.principal.userId]
    );
    if (!row) {
      throw new Error('reporting: INSERT INTO rpt.report_configuration_versions returned no row');
    }
    return toVersion(row);
  }

  /**
   * Publishes one version under its expected version counter, or returns null.
   *
   * **`published_at` is written explicitly, and that is the load-bearing detail
   * of this statement.** `rpt.guard_report_version_freeze` stamps `published_at`
   * itself when a row moves to `published` with the column still NULL, so setting
   * it here changes nothing on a first publication. What it buys is the SECOND
   * one: on a row that is already `published`, the guard's first branch compares
   * `NEW.published_at IS DISTINCT FROM OLD.published_at` and this statement's
   * `now()` is a different instant, so the database RAISES rather than accepting a
   * silent no-op that would advance `record_version` and leave the caller
   * believing it had republished something. Letting the trigger do the stamping
   * would make a repeat publication invisible.
   *
   * Null means the `record_version` predicate did not match; the service excludes
   * every other reason for zero rows before calling. Two failures a caller can
   * cause reach it as exceptions instead: `23505` on
   * `uq_report_configuration_versions_published`, because a configuration may
   * have at most one published version, and `23514` from the freeze guard.
   */
  public async publishVersion(
    db: DbHandle,
    configurationId: string,
    versionId: string,
    expectedVersion: number
  ): Promise<ReportConfigurationVersionRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<VersionSql>(
      db,
      `UPDATE rpt.report_configuration_versions
          SET status = 'published', published_at = now()
        WHERE tenant_id = $1 AND report_configuration_id = $2 AND id = $3
          AND deleted_at IS NULL AND record_version = $4
       RETURNING ${VERSION_COLUMNS}`,
      [context.principal.tenantId, configurationId, versionId, expectedVersion]
    );
    return row ? toVersion(row) : null;
  }
}
