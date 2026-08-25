/**
 * Inspection-template authoring — application service (PRE-P1-29-BR-04).
 *
 * ## What this closes
 *
 * `dia.inspection_templates`, `dia.template_versions` and `dia.template_items`
 * held ZERO rows and had no write path anywhere in `apps/api`, so
 * `POST /jobs/{jobId}/inspections` — which takes a `templateVersionId` — could
 * never be called with a value that existed. Diagnostics was not thin; it was
 * unreachable, and closure blocker `B4` had a subject that could not be brought
 * into being. This service is that write path.
 *
 * ## Two lifecycles, never conflated
 *
 * `inspection_templates.status` is `active`/`inactive` — whether the library
 * offers this template at all. `template_versions.status` is
 * `draft`/`published`/`retired` — where one revision sits in its publication
 * graph. They are orthogonal, they mean different things, and the API exposes
 * both rather than collapsing them into one flag (`C-05`).
 *
 * ## Where the authority lives
 *
 * The database owns every rule that a second code path could otherwise bypass:
 *
 *   - the publication graph `draft → published → retired`, and the `published_at`
 *     stamp — `dia.guard_template_version_publish()`;
 *   - the immutability of a published version's item SET — `dia.guard_template_item_frozen()`,
 *     which is `BEFORE INSERT OR UPDATE`, so an item cannot even be APPENDED to a
 *     published version (`C-06`);
 *   - the four vocabularies and both code formats — the CHECK constraints;
 *   - who may see a row at all — the nine RLS policies, pure
 *     `tenant_id = iam.current_tenant_id()`.
 *
 * This layer supplies values, orders statements inside the route's transaction,
 * turns each frozen SQLSTATE into a stable problem, and writes the audit record.
 * It restates the graph only where the caller would otherwise receive a SQLSTATE
 * instead of a named refusal — and where it does, the guard remains the
 * authority and runs anyway.
 *
 * ## The one rule that is genuinely this layer's
 *
 * **A version with zero items cannot be published.** There is no database
 * counterpart, and there is a reason to want one: a published empty version lets
 * a technician open an inspection that can never be meaningfully completed, and
 * `outstandingMandatory` would be vacuously satisfied — a report that claims to
 * have asked nothing and answered everything. Because it is service-only, it is
 * tested directly rather than through a guard.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import { pageRequest, type Page } from '@/server/db/pagination';
import { workOrderModule } from '@/modules/work-order';
import {
  TEMPLATE_ORDER,
  type PublishableVersionRow,
  type TemplateAuthoringRepository,
  type TemplateItemRow,
  type TemplateRow,
  type TemplateVersionRow,
} from '../data/template-authoring-repository';
import type { ResponseType, TemplateVersionStatus } from '../domain/diagnostics';

/** `ck_inspection_templates_status`. Orthogonal to the version graph. */
export const TEMPLATE_STATUSES = ['active', 'inactive'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/**
 * The only two moves a caller may ASK for.
 *
 * `draft` is absent deliberately: a version is born `draft` and the guard
 * refuses every move back to it, so offering it would be advertising a
 * transition that can only ever fail.
 */
export const TEMPLATE_VERSION_TARGET_STATUSES = ['published', 'retired'] as const;
export type TemplateVersionTargetStatus = (typeof TEMPLATE_VERSION_TARGET_STATUSES)[number];

export const MAX_TEMPLATE_NAME = 200;
export const MAX_ITEM_PROMPT = 1000;
export const MAX_ITEM_UNIT = 32;

export interface PageInput {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface TemplateCreateInput {
  readonly code: string;
  readonly name: string;
  readonly diagnosticTypeId: string;
}

export interface TemplateUpdateInput {
  readonly name?: string | undefined;
  readonly status?: TemplateStatus | undefined;
}

export interface TemplateVersionCreateInput {
  readonly copyFromVersionId?: string | undefined;
}

export interface TemplateItemCreateInput {
  readonly itemCode: string;
  readonly prompt: string;
  readonly responseType: ResponseType;
  readonly unit?: string | undefined;
  readonly isMandatory?: boolean | undefined;
  readonly validationRule?: unknown;
  readonly sequence?: number | undefined;
}

/** A template plus every version it owns. Versions are few, so they are not paged. */
export interface InspectionTemplateDetail {
  readonly template: TemplateRow;
  readonly versions: readonly TemplateVersionRow[];
}

export class TemplateAuthoringService extends ApplicationService {
  protected readonly module = 'diagnostics';

  constructor(private readonly templates: TemplateAuthoringRepository) {
    super();
  }

  // ---- Templates ----------------------------------------------------------

  /**
   * Creates a template. It has no version yet, and that is a legitimate state
   * the list must render — creating the container and authoring a revision of it
   * are two decisions, and forcing them together would mean every abandoned
   * draft left an empty version behind.
   */
  async createTemplate(db: DbHandle, input: TemplateCreateInput): Promise<TemplateRow> {
    await this.requireVisibleDiagnosticType(db, input.diagnosticTypeId);

    let created: TemplateRow;
    try {
      created = await this.templates.createTemplate(db, input);
    } catch (error) {
      throw this.mapTemplateFailure(error);
    }

    await appendAudit(db, {
      action: 'dia.inspection_template.created',
      entityType: 'dia.inspection_template',
      entityId: created.id,
      details: [
        { field: 'code', classification: 'public', value: created.code },
        { field: 'name', classification: 'public', value: created.name },
        {
          field: 'diagnostic_type_id',
          classification: 'internal',
          value: created.diagnosticTypeId,
        },
      ],
    });

    return created;
  }

  async listTemplates(
    db: DbHandle,
    filter: { readonly status?: TemplateStatus | undefined; readonly diagnosticTypeId?: string | undefined },
    page: PageInput
  ): Promise<Page<TemplateRow>> {
    return this.templates.pageTemplates(db, filter, pageRequest(TEMPLATE_ORDER, page));
  }

  /**
   * One template with its full version history.
   *
   * Each version carries `itemCount`, so a caller can tell an empty draft from an
   * authored one without a second read — which is exactly the distinction that
   * decides whether publishing will be refused.
   */
  async templateDetail(db: DbHandle, templateId: string): Promise<InspectionTemplateDetail> {
    const template = await this.requireTemplate(db, templateId);
    return { template, versions: await this.templates.versionsOf(db, templateId) };
  }

  /**
   * Renames a template or moves it between `active` and `inactive`.
   *
   * `code` is absent from the input by contract: a template code is an identifier
   * tenants build on, and changing it after versions exist would silently
   * re-label published history.
   */
  async updateTemplate(
    db: DbHandle,
    templateId: string,
    input: TemplateUpdateInput,
    expectedVersion: number
  ): Promise<InspectionTemplateDetail> {
    if (input.name === undefined && input.status === undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'An update must change at least one of name or status',
        safeDetails: { violations: [{ path: 'body', rule: 'empty_update' }] },
      });
    }
    const before = await this.requireTemplate(db, templateId);

    let changed: boolean;
    try {
      changed = await this.templates.updateTemplate(db, templateId, {
        name: input.name,
        status: input.status,
        expectedVersion,
      });
    } catch (error) {
      throw this.mapTemplateFailure(error);
    }
    if (!changed) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The inspection template changed while this request was in flight; re-read and retry',
      });
    }

    await appendAudit(db, {
      action: 'dia.inspection_template.updated',
      entityType: 'dia.inspection_template',
      entityId: templateId,
      details: [
        ...(input.name === undefined
          ? []
          : [
              {
                field: 'name',
                classification: 'public' as const,
                previousValue: before.name,
                value: input.name,
              },
            ]),
        ...(input.status === undefined
          ? []
          : [
              {
                field: 'status',
                classification: 'public' as const,
                previousValue: before.status,
                value: input.status,
              },
            ]),
      ],
    });

    return this.templateDetail(db, templateId);
  }

  // ---- Versions -----------------------------------------------------------

  /**
   * Creates the next version of a template, always `draft`.
   *
   * `version_number` is server-assigned as `max + 1`. `ck_template_versions_number`
   * guards the VALUE and says nothing about the sequence, so a client-chosen
   * number is a collision waiting to happen.
   *
   * `copyFromVersionId` exists because re-typing forty items to change one is the
   * failure mode that makes people avoid versioning altogether. The source must
   * belong to the SAME template — copying across templates would silently fork
   * one library's content into another.
   */
  async createVersion(
    db: DbHandle,
    templateId: string,
    input: TemplateVersionCreateInput
  ): Promise<TemplateVersionRow> {
    await this.requireTemplate(db, templateId);

    if (input.copyFromVersionId !== undefined) {
      const source = await this.templates.lockVersion(db, input.copyFromVersionId);
      if (source === null) {
        throw new AppFailure('ERR-RES-001', { message: 'The source version was not found' });
      }
      if (source.templateId !== templateId) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'copyFromVersionId must name a version of the same template',
          safeDetails: { violations: [{ path: 'body.copyFromVersionId', rule: 'foreign_template' }] },
        });
      }
    }

    let created: TemplateVersionRow;
    let copiedItems = 0;
    try {
      const versionNumber = await this.templates.nextVersionNumber(db, templateId);
      created = await this.templates.createVersion(db, { templateId, versionNumber });
      if (input.copyFromVersionId !== undefined) {
        copiedItems = await this.templates.copyItems(db, input.copyFromVersionId, created.id);
      }
    } catch (error) {
      throw this.mapTemplateFailure(error);
    }

    await appendAudit(db, {
      action: 'dia.template_version.created',
      entityType: 'dia.template_version',
      entityId: created.id,
      details: [
        { field: 'template_id', classification: 'internal', value: templateId },
        { field: 'version_number', classification: 'public', value: String(created.versionNumber) },
        {
          field: 'copied_from_version_id',
          classification: 'internal',
          value: input.copyFromVersionId ?? null,
        },
        { field: 'copied_item_count', classification: 'public', value: String(copiedItems) },
      ],
    });

    return { ...created, itemCount: copiedItems };
  }

  /**
   * Moves a version through its publication graph.
   *
   * The guard owns the graph and stamps `published_at`. The service refuses an
   * illegal move FIRST so the caller receives `ERR-TRN-001` rather than a raw
   * `23514` — but the guard still runs, so removing this check would change the
   * error shape and not the outcome. That is deliberate: a restated rule that
   * could disagree with the enforced one is worse than no restatement, so this
   * one is a message improvement over an authority that remains in the database.
   *
   * The empty-version refusal is the exception — it has no database counterpart
   * and this layer IS its authority.
   */
  async setVersionStatus(
    db: DbHandle,
    versionId: string,
    toStatus: TemplateVersionTargetStatus,
    expectedVersion: number
  ): Promise<TemplateVersionRow> {
    const version = await this.templates.lockVersion(db, versionId);
    if (version === null) {
      throw new AppFailure('ERR-RES-001', { message: 'Template version was not found' });
    }
    this.assertVersionMove(version.status as TemplateVersionStatus, toStatus);

    if (toStatus === 'published') {
      const items = await this.templates.countItems(db, versionId);
      if (items === 0) {
        throw new AppFailure('ERR-VAL-001', {
          message:
            'A template version with no items cannot be published: an inspection opened against it could never be meaningfully completed',
          safeDetails: { violations: [{ path: 'versionId', rule: 'no_items' }] },
        });
      }
    }

    let changed: boolean;
    try {
      changed = await this.templates.setVersionStatus(db, versionId, toStatus, expectedVersion);
    } catch (error) {
      throw this.mapVersionFailure(error);
    }
    if (!changed) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The template version changed while this request was in flight; re-read and retry',
      });
    }

    await appendAudit(db, {
      action: 'dia.template_version.status_changed',
      entityType: 'dia.template_version',
      entityId: versionId,
      details: [
        { field: 'template_id', classification: 'internal', value: version.templateId },
        {
          field: 'status',
          classification: 'public',
          previousValue: version.status,
          value: toStatus,
        },
      ],
    });

    const refreshed = await this.templates.lockVersion(db, versionId);
    if (refreshed === null) {
      throw new AppFailure('ERR-RES-001', { message: 'Template version was not found' });
    }
    return { ...refreshed, itemCount: await this.templates.countItems(db, versionId) };
  }

  // ---- Items --------------------------------------------------------------

  /**
   * Authors one item on a DRAFT version.
   *
   * Draft-only is not a policy this layer invented: `tg_template_items_frozen` is
   * `BEFORE INSERT OR UPDATE`, so a published version's item set is closed to
   * appends as well as edits. "Add one more check to the published inspection" is
   * therefore not a supported operation, and the supported shape is a new version.
   *
   * `unit` is required for a numeric item, mirroring `ck_template_items_unit` so
   * the caller gets a violation path instead of a `23514`.
   */
  async createItem(
    db: DbHandle,
    versionId: string,
    input: TemplateItemCreateInput
  ): Promise<TemplateItemRow> {
    const version = await this.templates.lockVersion(db, versionId);
    if (version === null) {
      throw new AppFailure('ERR-RES-001', { message: 'Template version was not found' });
    }
    if (version.status !== 'draft') {
      throw new AppFailure('ERR-TRN-001', {
        message: `A ${version.status} template version is frozen; create a new version to change what an inspection asks`,
      });
    }
    if (input.responseType === 'numeric' && (input.unit ?? '').trim().length === 0) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A numeric item requires a unit',
        safeDetails: { violations: [{ path: 'body.unit', rule: 'required_for_numeric' }] },
      });
    }

    let created: TemplateItemRow;
    try {
      const sequence = input.sequence ?? (await this.templates.nextItemSequence(db, versionId));
      created = await this.templates.insertItem(db, {
        versionId,
        itemCode: input.itemCode,
        prompt: input.prompt,
        responseType: input.responseType,
        unit: input.unit,
        isMandatory: input.isMandatory ?? true,
        validationRule: input.validationRule,
        sequence,
      });
    } catch (error) {
      throw this.mapItemFailure(error);
    }

    await appendAudit(db, {
      action: 'dia.template_item.created',
      entityType: 'dia.template_version',
      entityId: versionId,
      details: [
        { field: 'template_item_id', classification: 'internal', value: created.id },
        { field: 'item_code', classification: 'public', value: created.itemCode },
        { field: 'response_type', classification: 'public', value: created.responseType },
        { field: 'is_mandatory', classification: 'public', value: String(created.isMandatory) },
      ],
    });

    return created;
  }

  // ---- The technician's read ----------------------------------------------

  /**
   * The versions a technician may open an inspection against, for one job.
   *
   * Exactly the set `POST /jobs/{jobId}/inspections` accepts: `published`
   * versions of `active` templates. Without it a technician must be handed a
   * `templateVersionId` from somewhere, which is `INS-04` in a different costume.
   *
   * The job is resolved and authorized against ITS OWN branch first: this
   * operation is addressed by job id, so the route's `scope: 'branch'` check has
   * the job's branch to evaluate only after the job is read.
   */
  async publishableForJob(
    db: DbHandle,
    jobId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<readonly PublishableVersionRow[]> {
    const job = await workOrderModule().workOrders.jobScope(db, jobId);
    if (job === null) {
      throw new AppFailure('ERR-RES-001', { message: `Job ${jobId} is not visible` });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: job.companyId, branchId: job.branchId });
    }
    return this.templates.publishableVersions(db);
  }

  // ---- Shared helpers -----------------------------------------------------

  /**
   * A template the caller cannot see and one that does not exist are the same
   * 404, so the endpoint is not an existence oracle for another tenant's library.
   */
  private async requireTemplate(db: DbHandle, templateId: string): Promise<TemplateRow> {
    const template = await this.templates.readTemplate(db, templateId);
    if (template === null) {
      throw new AppFailure('ERR-RES-001', { message: 'Inspection template was not found' });
    }
    return template;
  }

  /**
   * The dual-scope check the single-column foreign key cannot make.
   *
   * `dia.diagnostic_types` carries `tenant_id IS NULL` for a platform row, so it
   * cannot participate in a composite key and the database cannot decide whether
   * this tenant may reference it. Reported as a 422 naming the field rather than
   * a 404, because the caller supplied a value the request cannot accept.
   */
  private async requireVisibleDiagnosticType(db: DbHandle, diagnosticTypeId: string): Promise<void> {
    if (await this.templates.diagnosticTypeVisible(db, diagnosticTypeId)) return;
    throw new AppFailure('ERR-VAL-001', {
      message:
        'diagnosticTypeId must name an active diagnostic type at platform scope or in the caller tenant',
      safeDetails: { violations: [{ path: 'body.diagnosticTypeId', rule: 'not_visible' }] },
    });
  }

  /**
   * The publication graph, restated for the message and enforced by the guard.
   *
   * `ERR-TRN-001` and not `ERR-CON-001`: the catalogue draws the distinction and
   * it matters here. A version conflict is fixed by re-reading and retrying; an
   * illegal move is not fixed by anything, and rendering the same banner for both
   * trains a user to reload and retry an action that can never succeed.
   */
  private assertVersionMove(from: TemplateVersionStatus, to: TemplateVersionTargetStatus): void {
    const legal = (from === 'draft' && to === 'published') || (from === 'published' && to === 'retired');
    if (legal) return;
    throw new AppFailure('ERR-TRN-001', {
      message: `A template version cannot move from ${from} to ${to}; the graph is draft → published → retired`,
    });
  }

  /** `dia.inspection_templates` failures. */
  private mapTemplateFailure(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
      return new AppFailure('ERR-IAM-001', {
        message: 'This inspection template is outside the scope your access grants',
      });
    }
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      // uq_inspection_templates_tenant_code.
      return new AppFailure('ERR-RES-002', {
        message: 'A template with that code already exists in this tenant',
      });
    }
    if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
      return new AppFailure('ERR-RES-001', {
        message: 'A referenced diagnostic type or template was not found',
      });
    }
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      // ck_inspection_templates_code_format, _status, _name_not_blank.
      return new AppFailure('ERR-VAL-001', {
        message:
          'The template was refused: a code must match ^[a-z][a-z0-9_]{1,62}$, a name may not be blank, and status must be active or inactive',
        safeDetails: { violations: [{ path: 'body', rule: 'invalid_value' }] },
      });
    }
    return error;
  }

  /** `dia.template_versions` failures — chiefly the publish guard. */
  private mapVersionFailure(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      // dia.guard_template_version_publish and ck_template_versions_status /
      // _number / _published_at all arrive as 23514 and none is distinguishable
      // from the SQLSTATE, so this names the graph rather than guessing.
      return new AppFailure('ERR-TRN-001', {
        message:
          'The template version lifecycle refused this move: the graph is draft → published → retired and nothing leaves retired',
      });
    }
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      return new AppFailure('ERR-RES-002', {
        message: 'That template version already exists',
      });
    }
    return this.mapTemplateFailure(error);
  }

  /** `dia.template_items` failures — chiefly the freeze guard. */
  private mapItemFailure(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      // dia.guard_template_item_frozen is the one that matters here, and it is
      // the AUTHORITY rather than a backstop: the service refuses a non-draft
      // parent first only so the caller sees a named refusal, and this branch is
      // what fires when the service check is removed.
      return new AppFailure('ERR-TRN-001', {
        message:
          'The template item was refused: a published or retired version is frozen, a numeric item needs a unit, an item code must match ^[a-z][a-z0-9_]{1,62}$ and a sequence must be positive',
      });
    }
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      // uq_template_items_version_code.
      return new AppFailure('ERR-RES-002', {
        message: 'An item with that code already exists on this version',
      });
    }
    return this.mapTemplateFailure(error);
  }
}
