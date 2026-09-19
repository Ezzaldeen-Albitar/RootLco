/**
 * The report CONFIGURATION surface (P1-31 prerequisite **P-11**, the writer half).
 *
 * ## What was measured
 *
 * `rpt.report_configurations` and `rpt.report_configuration_versions` landed in
 * P1-11 with `INSERT` and `UPDATE` grants and policies, and **no code anywhere in
 * `apps/api/src` had ever written either one.** P1-23 published two reads over
 * them — `rpt.report-catalogue` and `rpt.report-read` — and both filter on
 * `status = 'published'`, so the only rows they could ever return were rows
 * nothing could create. `rpt.report.configure` has been a seeded catalogue code
 * since P1-08, is named by `report-catalogue-repository.ts` as the authority for
 * "writes through `rpt.report.configure`", and was declared by NO operation: the
 * "declared but never wired" defect, with the read surface already shipped on top
 * of it.
 *
 * ## The ENGINE is deliberately not here, and that is the honest half of P-11
 *
 * `ReportCatalogueService` publishes `executable: false` as a literal, because the
 * frozen `rpt` schema binds no data source to a report code — no query, no table,
 * no module reference, no column that could hold one. Nothing in the approved
 * contracts says what `report_code = 'x'` should SELECT. Making a report runnable
 * therefore means CHOOSING the report definitions a workshop gets, which is an
 * Owner decision (**D-4**) and not an implementation detail. This slice publishes
 * the configuration seam and changes `executable` in no way at all: after it, a
 * tenant can author, version and publish a report DEFINITION, and still cannot run
 * one. That is a smaller claim than "reporting works", and it is the true one.
 *
 * ## Why this is its own service and not a method on `ReportCatalogueService`
 *
 * That service is the CATALOGUE: it answers a caller who may run a report with the
 * definitions in force, and every row it returns is `published`. This is
 * AUTHORING — it works on drafts, on archived rows and on versions that no
 * catalogue read will ever see, under a different permission, for a different
 * person. `serviceCatalogModule().catalogWrites` is the precedent for a second
 * write service inside one module. The SQL still lives beside the catalogue's in
 * `data/`, because two files writing one table is how a tenant predicate ends up
 * on one query and not the other.
 *
 * ## The authority is `rpt.report.configure`, TENANT-WIDE, on every operation
 *
 * Including the two READS, which is the substantive access decision of this
 * slice and is not the shape P-9 or P-10 used. There the read code and the write
 * code differ, because the rows a reader sees are the rows the writer publishes.
 * Here they are not: this surface exposes DRAFTS, ARCHIVED configurations and
 * every VERSION of each — none of which `rpt.report.read` may see. A
 * `rpt.report.read` holder sees published definitions through `rpt.report-catalogue`
 * and `rpt.report-read`, which is the whole of what that code was minted for.
 * Gating this list on the read code would publish the tenant's unfinished and
 * withdrawn decisions to everyone who may open a report.
 *
 * Both tables are TENANT-scoped: neither carries a company or a branch column, so
 * there is no scope target to authorize against and `authorizeScope` cannot be
 * used. `requiresScopedEvaluation` returns false on an empty target WHATEVER the
 * declared scope is (P1-18-A-01), so the pre-handler check degrades to the
 * scope-blind `iam.has_permission` — under which an actor holding
 * `rpt.report.configure` in ONE branch could publish a definition for the whole
 * tenant. Every route therefore re-asks `callerHoldsPermissionTenantWide`, the
 * control `svc.service-category-create` applies for the same reason.
 *
 * ## `parameter_schema` is bounded in SHAPE and undecided in VOCABULARY
 *
 * The frozen schema constrains its content in no way: no CHECK, no domain, no
 * trigger. This surface accepts a JSON OBJECT within stated bounds and validates
 * nothing about what the keys mean, because what a filter key means is part of
 * the report definition the Owner has not approved. Recording that as a deferral
 * is honest; inventing a filter vocabulary here would be inventing the report.
 *
 * ## No money
 *
 * `rpt` has no monetary column of any kind — no amount, no currency, no rate. A
 * report might one day PRESENT figures; nothing in this surface computes,
 * transports or stores one, so no exactness rule applies to anything here.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page, type PageRequest } from '@/server/db/pagination';
import type { ReportConfigurationStatus, ReportScopeLevel } from '../domain/report-configuration';
import {
  REPORT_CONFIGURATION_ORDER,
  type ReportConfigurationAdminRow,
  type ReportConfigurationRepository,
  type ReportConfigurationVersionRow,
} from '../data/report-configuration-repository';

/**
 * One configuration header, as an author sees it.
 *
 * A near-superset of `ReportDefinitionView`, which the catalogue publishes:
 * `reportCode`, `name`, `scopeLevel`, `exportPermissionCode` and `recordVersion`
 * are spelled identically, so the definition a caller authors and the definition
 * a caller reads are one shape. Three fields differ, each for a reason.
 *
 * `status` is here and absent there, because the catalogue's rows are all
 * `published` and saying so on every one would be noise. `ownerUserId` is here
 * and absent there, because it is who authored the definition and not part of
 * what the definition IS. The version block is absent here and present there:
 * the catalogue flattens the one published version onto the definition because a
 * caller running a report needs exactly that one, while an author needs the whole
 * history, which the detail read carries as its own list.
 *
 * `executable` is deliberately NOT on this view. It is the catalogue's statement
 * to a caller who might try to run a report, and this surface answers a caller
 * who is writing one; repeating the literal `false` here would suggest this slice
 * had an opinion about execution, and it does not.
 */
export interface ReportConfigurationSummaryView {
  readonly id: string;
  readonly reportCode: string;
  readonly name: string;
  readonly scopeLevel: string;
  /** The permission an EXPORT of this report would require — never the view one. */
  readonly exportPermissionCode: string;
  readonly ownerUserId: string;
  readonly status: string;
  readonly recordVersion: number;
}

/**
 * One version of a definition.
 *
 * `parameterSchema` is published exactly as the column holds it and is typed
 * `unknown`: this surface bounds its shape and knows nothing about its meaning,
 * and a narrower type here would be a claim about a vocabulary that has not been
 * decided. `ReportDefinitionView.parameterSchema` is `unknown` for the same
 * reason.
 *
 * `publishedAt` is an ISO-8601 instant or null. `recordVersion` is the `If-Match`
 * the publish command requires, and it is the VERSION's own counter — not the
 * configuration's, which the header carries.
 */
export interface ReportConfigurationVersionView {
  readonly id: string;
  readonly configurationId: string;
  readonly versionNumber: number;
  readonly parameterSchema: unknown;
  readonly status: string;
  readonly publishedAt: string | null;
  readonly recordVersion: number;
}

/** The paged administration list. Named because the wire-shape gate refuses an inline type. */
export interface ReportConfigurationListView {
  readonly configurations: Page<ReportConfigurationSummaryView>;
}

/** One configuration WITH its whole version history, ascending. */
export interface ReportConfigurationDetailView {
  readonly configuration: ReportConfigurationSummaryView;
  readonly versions: readonly ReportConfigurationVersionView[];
}

export interface CreateReportConfigurationInput {
  readonly reportCode: string;
  readonly name: string;
  readonly scopeLevel: ReportScopeLevel;
  readonly exportPermissionCode: string;
}

export interface UpdateReportConfigurationInput {
  readonly name?: string | undefined;
  readonly scopeLevel?: ReportScopeLevel | undefined;
}

const toConfigurationView = (row: ReportConfigurationAdminRow): ReportConfigurationSummaryView => ({
  id: row.id,
  reportCode: row.reportCode,
  name: row.name,
  scopeLevel: row.scopeLevel,
  exportPermissionCode: row.exportPermissionCode,
  ownerUserId: row.ownerUserId,
  status: row.status,
  recordVersion: row.recordVersion,
});

const toVersionView = (row: ReportConfigurationVersionRow): ReportConfigurationVersionView => ({
  id: row.id,
  configurationId: row.reportConfigurationId,
  versionNumber: row.versionNumber,
  parameterSchema: row.parameterSchema,
  status: row.status,
  publishedAt: row.publishedAt === null ? null : row.publishedAt.toISOString(),
  recordVersion: row.recordVersion,
});

export class ReportConfigurationService extends ApplicationService {
  protected readonly module = 'reporting';

  public constructor(private readonly repository: ReportConfigurationRepository) {
    super();
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * `rpt.report-configuration-list` — every configuration in the tenant.
   *
   * Paged for the reason the catalogue read states and this one inherits:
   * `rpt.report_configurations` is a table the TENANT writes, so an unbounded
   * SELECT is a response whose size the tenant chooses.
   */
  public async listConfigurations(
    db: DbHandle,
    filter: { readonly status?: ReportConfigurationStatus | undefined },
    page: { readonly limit?: number | undefined; readonly cursor?: string | undefined }
  ): Promise<ReportConfigurationListView> {
    const request: PageRequest = pageRequest(REPORT_CONFIGURATION_ORDER, page);
    const rows = await this.repository.listConfigurations(db, request, {
      ...(filter.status === undefined ? {} : { status: filter.status }),
    });
    return { configurations: { ...rows, items: rows.items.map(toConfigurationView) } };
  }

  /**
   * `rpt.report-configuration-read` — one configuration with its versions.
   *
   * Absent and out-of-scope answer the same `ERR-RES-001`, decided by the row read
   * rather than by an authorization decision, so this operation is not an
   * existence oracle for another tenant's report codes. The catalogue read makes
   * the same promise for the same reason and states it in its own words.
   */
  public async readConfiguration(
    db: DbHandle,
    configurationId: string
  ): Promise<ReportConfigurationDetailView> {
    const configuration = await this.#requireConfiguration(db, configurationId);
    const versions = await this.repository.listVersions(db, configuration.id);
    return {
      configuration: toConfigurationView(configuration),
      versions: versions.map(toVersionView),
    };
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /**
   * `rpt.report-configuration-create` — a new definition, as a draft.
   *
   * The version is NOT created with it, and that is the one place this slice
   * departs from the P-9 and P-10 create-the-whole-thing-in-one-transaction
   * shape. There the child rows are the terms the parent is useless without — a
   * warranty policy with no coverage cannot issue anything. Here the child is a
   * VERSION, and an unversioned draft configuration is not a broken state: it is
   * the normal first step, `rpt.report-catalogue` never shows it, and
   * `ReportDefinitionView` already publishes `versionNumber: null` with an empty
   * `parameterSchema` for exactly this case. Bundling a version into the create
   * would also mean choosing a `parameter_schema` on the caller's behalf, and the
   * vocabulary of that document is undecided.
   */
  public async createConfiguration(
    db: DbHandle,
    input: CreateReportConfigurationInput
  ): Promise<ReportConfigurationSummaryView> {
    let created: ReportConfigurationAdminRow;
    try {
      created = await this.repository.insertConfiguration(db, {
        reportCode: input.reportCode,
        name: input.name,
        scopeLevel: input.scopeLevel,
        exportPermissionCode: input.exportPermissionCode,
      });
    } catch (cause) {
      this.#refuseConfigurationWrite(cause, input.reportCode);
    }

    await appendAudit(db, {
      action: 'rpt.report_configuration.created',
      entityType: 'rpt.report_configuration',
      entityId: created.id,
      requestRef: 'rpt.report-configuration-create',
      details: [
        { field: 'reportCode', classification: 'internal', value: created.reportCode },
        { field: 'name', classification: 'internal', value: created.name },
        { field: 'scopeLevel', classification: 'public', value: created.scopeLevel },
        // Recorded because it is an AUTHORIZATION fact: it names the permission a
        // future export of this report will require, and a definition created
        // against a weaker code than the data it will carry is the kind of change
        // a reviewer must be able to find later.
        {
          field: 'exportPermissionCode',
          classification: 'internal',
          value: created.exportPermissionCode,
        },
        { field: 'status', classification: 'public', value: created.status },
      ],
    });

    return toConfigurationView(created);
  }

  /**
   * `rpt.report-configuration-update` — the name and the scope level.
   *
   * `reportCode` is absent from the body and cannot be changed at all:
   * `tg_report_configurations_immutable` freezes it, so this is the database's
   * rule and not this surface's preference. `status` is absent because moving a
   * definition into or out of the catalogue is its own command — the authority to
   * fix a typo is not the authority to publish a report to the tenant.
   * `exportPermissionCode` is absent for a sharper reason: it decides who may
   * export the report's contents, so changing it is a privilege change wearing
   * the clothes of an edit. Re-pointing it needs its own decision and its own
   * operation, and neither is in this prerequisite.
   *
   * A field the caller omitted is written back as it was read, so a one-field
   * patch cannot silently blank the other.
   */
  public async updateConfiguration(
    db: DbHandle,
    configurationId: string,
    expectedVersion: number,
    input: UpdateReportConfigurationInput
  ): Promise<ReportConfigurationSummaryView> {
    const existing = await this.#requireConfiguration(db, configurationId);
    const updated = this.#assertVersionMatched(
      await this.repository.updateConfiguration(db, existing.id, expectedVersion, {
        name: input.name ?? existing.name,
        scopeLevel: input.scopeLevel ?? existing.scopeLevel,
      })
    );

    await appendAudit(db, {
      action: 'rpt.report_configuration.updated',
      entityType: 'rpt.report_configuration',
      entityId: updated.id,
      requestRef: 'rpt.report-configuration-update',
      details: [
        {
          field: 'name',
          classification: 'internal',
          previousValue: existing.name,
          value: updated.name,
        },
        {
          field: 'scopeLevel',
          classification: 'public',
          previousValue: existing.scopeLevel,
          value: updated.scopeLevel,
        },
      ],
    });

    return toConfigurationView(updated);
  }

  /**
   * `rpt.report-configuration-status-set` — publish, withdraw or re-draft.
   *
   * All three transitions of `ck_report_configurations_status` through one
   * command, in every direction the CHECK allows, and this surface adds no rule
   * of its own on top of it. In particular it does NOT require a published
   * version before a configuration may be `published`: nothing in the schema says
   * so, and `ReportDefinitionView` already answers `versionNumber: null` with an
   * empty `parameterSchema` for a published configuration that has no published
   * version — a state the frozen contract anticipated. Inventing the requirement
   * would be inventing a business rule the approved contracts do not carry.
   *
   * Bidirectional for the `apt.catalogue-source-channel-status-set` reason:
   * `uq_report_configurations_code` names `deleted_at` and says nothing about
   * `status`, so an archived configuration still holds its report code and an
   * archive-only command would burn that code for the tenant permanently.
   *
   * It touches the header only. The versions are not cascaded — see the
   * repository, which states why an un-archive could not undo one.
   */
  public async setConfigurationStatus(
    db: DbHandle,
    configurationId: string,
    expectedVersion: number,
    status: ReportConfigurationStatus
  ): Promise<ReportConfigurationSummaryView> {
    const existing = await this.#requireConfiguration(db, configurationId);
    const updated = this.#assertVersionMatched(
      await this.repository.setConfigurationStatus(db, existing.id, expectedVersion, status)
    );

    await appendAudit(db, {
      action: 'rpt.report_configuration.status_changed',
      entityType: 'rpt.report_configuration',
      entityId: updated.id,
      requestRef: 'rpt.report-configuration-status-set',
      details: [
        {
          field: 'status',
          classification: 'public',
          previousValue: existing.status,
          value: updated.status,
        },
        // The code is on the record because `status` is what decides whether this
        // definition is visible through `rpt.report-catalogue` at all, and the
        // code is how a reader of the audit trail knows which definition moved.
        { field: 'reportCode', classification: 'internal', value: updated.reportCode },
      ],
    });

    return toConfigurationView(updated);
  }

  /**
   * `rpt.report-configuration-version-create` — the next draft version.
   *
   * NOT version-guarded, on the `svc.service-version-create` and
   * `dia.template-version-create` precedent: creating a draft does not mutate the
   * configuration, and there is no prior version of the thing being created to
   * guard, so an `If-Match` would be a token about a row the request does not
   * change. Concurrency protection stays where it earns its keep — on the
   * publication below, which decides which definition is in force. The write
   * still takes `FOR UPDATE` on the configuration, because `version_number` is
   * unique per configuration and two concurrent creates must not compute the same
   * next number; that is a lock for the correctness of the insert, not an
   * optimistic guard against a lost update.
   *
   * `parameterSchema` is serialized here, once, and handed to SQL as text. The
   * bytes matter beyond the usual reason: `rpt.guard_report_version_freeze`
   * compares `NEW.parameter_schema <> OLD.parameter_schema` on every later update
   * of a published row.
   */
  public async createVersion(
    db: DbHandle,
    configurationId: string,
    parameterSchema: Record<string, unknown>
  ): Promise<ReportConfigurationVersionView> {
    const configuration = await this.#requireConfiguration(db, configurationId);
    const created = await this.repository.insertNextVersion(
      db,
      configuration.id,
      JSON.stringify(parameterSchema)
    );

    await appendAudit(db, {
      action: 'rpt.report_configuration.version_created',
      entityType: 'rpt.report_configuration_version',
      entityId: created.id,
      requestRef: 'rpt.report-configuration-version-create',
      details: [
        { field: 'configurationId', classification: 'internal', value: configuration.id },
        { field: 'reportCode', classification: 'internal', value: configuration.reportCode },
        {
          field: 'versionNumber',
          classification: 'public',
          value: String(created.versionNumber),
        },
        // The COUNT of declared filter keys, not the document. The record says how
        // large the allowlist is without copying a tenant-authored structure whose
        // vocabulary nothing has approved into the audit trail.
        {
          field: 'parameterKeyCount',
          classification: 'public',
          value: String(Object.keys(parameterSchema).length),
        },
      ],
    });

    return toVersionView(created);
  }

  /**
   * `rpt.report-configuration-version-publish` — fix one version as the definition.
   *
   * Version-guarded on the VERSION's own `record_version`, which the detail read
   * and the create response both publish. It is not the configuration's counter,
   * and the suite exercises that trap directly.
   *
   * Two refusals come from the database rather than from a rule written here, and
   * both are mapped rather than left as a bare SQLSTATE:
   *
   *  - `uq_report_configuration_versions_published` admits at most ONE published
   *    version per configuration, so publishing a second while one is live is a
   *    `23505`. The remedy is not expressible through this surface today — there
   *    is no unpublish, because the frozen schema makes a published version
   *    immutable — so the message says what the state IS rather than inventing an
   *    instruction the caller cannot follow.
   *  - `rpt.guard_report_version_freeze` refuses ANY update of a published
   *    version, which is what a repeat publication is. It arrives as a `23514`
   *    from a `RAISE`, so it carries no constraint name, and it is reported as the
   *    conflict it is. This is the immutability of a published definition being
   *    enforced by the database and reported to the caller — not accepted
   *    silently and not re-implemented in application code.
   */
  public async publishVersion(
    db: DbHandle,
    configurationId: string,
    versionId: string,
    expectedVersion: number
  ): Promise<ReportConfigurationVersionView> {
    const configuration = await this.#requireConfiguration(db, configurationId);
    const existing = await this.repository.findVersion(db, configuration.id, versionId);
    if (existing === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Version ${versionId} is not a version of report configuration ${configuration.id}`,
      });
    }

    let published: ReportConfigurationVersionRow | null;
    try {
      published = await this.repository.publishVersion(
        db,
        configuration.id,
        existing.id,
        expectedVersion
      );
    } catch (cause) {
      this.#refusePublication(cause);
    }
    const result = this.#assertVersionMatched(published);

    await appendAudit(db, {
      action: 'rpt.report_configuration.version_published',
      entityType: 'rpt.report_configuration_version',
      entityId: result.id,
      requestRef: 'rpt.report-configuration-version-publish',
      details: [
        { field: 'configurationId', classification: 'internal', value: configuration.id },
        { field: 'reportCode', classification: 'internal', value: configuration.reportCode },
        {
          field: 'versionNumber',
          classification: 'public',
          value: String(result.versionNumber),
        },
        {
          field: 'status',
          classification: 'public',
          previousValue: existing.status,
          value: result.status,
        },
      ],
    });

    return toVersionView(result);
  }

  // -------------------------------------------------------------------------
  // Shared resolution
  // -------------------------------------------------------------------------

  /** The configuration, or the uniform 404 that does not distinguish absent from invisible. */
  async #requireConfiguration(
    db: DbHandle,
    configurationId: string
  ): Promise<ReportConfigurationAdminRow> {
    const row = await this.repository.findConfiguration(db, configurationId);
    if (row === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Report configuration ${configurationId} is not visible in the caller's tenant`,
      });
    }
    return row;
  }

  /**
   * No row returned means the `record_version` predicate did not match.
   *
   * Every other reason for zero rows — absent, another tenant's, soft-deleted —
   * has already been excluded by the read above, so this is the concurrency loss
   * and nothing else. The DATABASE's row is returned rather than
   * `expectedVersion + 1`, because that number is the caller's next `If-Match`
   * and inferring it would encode an assumption about
   * `shared.touch_row_metadata` this module does not own.
   */
  #assertVersionMatched<T>(updated: T | null): T {
    if (updated === null) {
      throw new AppFailure('ERR-CON-001', {
        message:
          'The report configuration changed while this request was in flight; re-read and retry',
      });
    }
    return updated;
  }

  /** The two constraint failures a create can cause; everything else is re-thrown. */
  #refuseConfigurationWrite(cause: unknown, reportCode: string): never {
    if (isSqlState(cause, SQLSTATE.uniqueViolation)) {
      // `uq_report_configurations_code` is PARTIAL on `deleted_at IS NULL`, and
      // this surface never soft-deletes, so a colliding row is always one the
      // caller can see, rename around, or restore with the status command.
      throw new AppFailure('ERR-CON-001', {
        message: `The report code "${reportCode}" is already used in this tenant`,
        safeDetails: { violations: [{ path: 'body.reportCode', rule: 'duplicate_code' }] },
      });
    }
    if (isSqlState(cause, SQLSTATE.foreignKeyViolation)) {
      // `fk_report_configurations_permission` resolves `export_permission_code`
      // against `iam.permissions`, which is the PLATFORM catalogue and not a
      // tenant table — so this means the code does not exist at all, and naming
      // the field is the whole of what the caller needs.
      throw new AppFailure('ERR-VAL-001', {
        message: 'The named export permission code is not in the permission catalogue',
        safeDetails: {
          violations: [{ path: 'body.exportPermissionCode', rule: 'unknown_permission_code' }],
        },
      });
    }
    throw cause;
  }

  /** The two database refusals a publication can cause; everything else is re-thrown. */
  #refusePublication(cause: unknown): never {
    if (isSqlState(cause, SQLSTATE.uniqueViolation)) {
      throw new AppFailure('ERR-CON-001', {
        message:
          'Another version of this report configuration is already published. ' +
          'A configuration has at most one published version, and a published version cannot be withdrawn.',
        safeDetails: {
          violations: [{ path: 'path.versionId', rule: 'version_already_published' }],
        },
      });
    }
    if (isSqlState(cause, SQLSTATE.checkViolation)) {
      // `rpt.guard_report_version_freeze`, raised with `ERRCODE = 'check_violation'`
      // and therefore carrying no constraint name. The only update this surface
      // can send to an already-published version is a repeat publication, so that
      // is what this reports.
      throw new AppFailure('ERR-CON-001', {
        message: 'This version is already published, and a published version is immutable',
        safeDetails: { violations: [{ path: 'path.versionId', rule: 'version_immutable' }] },
      });
    }
    throw cause;
  }
}
