/**
 * The delivery checklist TEMPLATE surface (P1-31 prerequisite P-9, **PPD-12**).
 *
 * `sal.delivery_checklist_templates` and `sal.delivery_checklist_template_items`
 * landed in P1-11 with SELECT, INSERT and UPDATE grants and an INSERT and an UPDATE
 * policy, and until this slice **nothing in `apps/api/src` had ever written either
 * one**. The single method that touched them, `findTemplateItem`, is a per-item
 * existence probe for the write path. So on a tenant provisioned through the product
 * the checklist was empty and permanently so: the handover checklist could not be
 * configured, and `sal.delivery-checklist-result-list` published results for items no
 * caller could create or even enumerate.
 *
 * ## Why this is its own service and not a method on `DeliveryService`
 *
 * The module splits by direction — `reads` composes, `deliveries` commands — and this
 * is neither. It is CONFIGURATION: it is authored months before a handover, by a
 * different person, under a different authority, and it touches no delivery record,
 * no status machine and no custody fact. `serviceCatalogModule().catalogWrites` is
 * the precedent for a second write service inside one module. The SQL still lives in
 * the one repository file, because two files writing one table is how a tenant
 * predicate ends up on one query and not the other.
 *
 * ## The authority is COMPANY-WIDE, and that is measured rather than chosen
 *
 * Every write here calls `authorizeScope({ companyId })` against the row's own
 * company, so a caller must hold `sal.delivery.manage` for that company or through an
 * unrestricted grant. `iam.has_permission_in_scope(code, company, NULL, NULL)` is
 * satisfied only by `scope_mode = 'unrestricted'` or by a `company`-type grant scope
 * naming it — a BRANCH-scoped grant compares `s.branch_id = NULL` and does not apply.
 *
 * That is deliberate, and the reason is the gate: `sal.complete_delivery` scans
 * mandatory items **by company, across every template**, because `sal.delivery_records`
 * carries no template reference. So one mandatory item authored here blocks the
 * handover of every vehicle in every branch of that company until each delivery
 * records a result for it. A branch-scoped actor must not be able to do that, which is
 * `svc.service-category-create`'s reasoning applied one scope level down.
 *
 * ## The READS deliberately do not re-authorize against the company
 *
 * They declare `sal.delivery.view` and `scope: 'tenant'`, and they are narrowed by
 * `sel_delivery_checklist_templates_scope` — tenant plus `iam.allowed_company_ids()`,
 * which includes the company of a BRANCH-scoped grant because `ck_grant_scopes_shape`
 * requires every scope row to name its company. Requiring company-wide authority to
 * READ would deny the checklist to exactly the principal who performs the handover:
 * a delivery officer scoped to one branch. The read seam states the same rule for the
 * delivery record — "a read on this surface must be holdable by the principal that
 * acts on it".
 *
 * ## What is NOT offered, and why
 *
 * - **No hard delete, of a template or of an item.** Neither table carries a DELETE
 *   grant or a DELETE policy for any application role, and
 *   `fk_delivery_checklist_results_item` is `ON DELETE RESTRICT`. Item removal is a
 *   soft delete by UPDATE; a template is retired with `status = 'inactive'`.
 * - **No template soft delete.** Withdrawing a template would not withdraw its items
 *   from the completion gate — the primitive filters `ti.deleted_at`, not the parent —
 *   so a route that appeared to retire a checklist would leave it gating every
 *   handover in the company. Deactivation is offered because it is honest about what
 *   it does; see the finding recorded in `delivery-checklist-template-seam.md`.
 * - **No second name.** The table has one `name` column and no locale column, so a
 *   bilingual label cannot be stored. Adding one is a migration and not this slice.
 * - **No money.** Neither table has a `numeric` column; `sortOrder` is `integer`.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { pageRequest, type Page, type PageRequest } from '@/server/db/pagination';
import type { ChecklistTemplateStatus } from '../domain/delivery';
import {
  CHECKLIST_TEMPLATE_ORDER,
  type ChecklistTemplateItemRow,
  type ChecklistTemplateRow,
  type DeliveryRepository,
} from '../data/delivery-repository';

/** One checklist template header, as a caller sees it. */
export interface ChecklistTemplateView {
  readonly id: string;
  readonly companyId: string;
  readonly templateCode: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}

/**
 * One checklist template item.
 *
 * `itemCode` and `label` are spelled exactly as `sal.delivery-checklist-result-list`
 * spells them on a recorded result, so a screen that renders a template and a screen
 * that renders what was recorded against it handle one shape.
 */
export interface ChecklistTemplateItemView {
  readonly id: string;
  readonly templateId: string;
  readonly itemCode: string;
  readonly label: string;
  readonly isMandatory: boolean;
  readonly sortOrder: number;
  readonly recordVersion: number;
}

export interface ChecklistTemplateListView {
  readonly templates: Page<ChecklistTemplateView>;
}

/** A template WITH its live items, in checklist order. */
export interface ChecklistTemplateDetailView {
  readonly template: ChecklistTemplateView;
  readonly items: readonly ChecklistTemplateItemView[];
}

export interface CreateChecklistTemplateInput {
  readonly companyId: string;
  readonly templateCode: string;
  readonly name: string;
  readonly items: readonly {
    readonly itemCode: string;
    readonly label: string;
    readonly isMandatory?: boolean | undefined;
    readonly sortOrder?: number | undefined;
  }[];
}

export interface CreateChecklistTemplateItemInput {
  readonly itemCode: string;
  readonly label: string;
  readonly isMandatory?: boolean | undefined;
  readonly sortOrder?: number | undefined;
}

export interface UpdateChecklistTemplateItemInput {
  readonly label?: string | undefined;
  readonly isMandatory?: boolean | undefined;
  readonly sortOrder?: number | undefined;
}

const toTemplateView = (row: ChecklistTemplateRow): ChecklistTemplateView => ({
  id: row.id,
  companyId: row.companyId,
  templateCode: row.templateCode,
  name: row.name,
  status: row.status,
  recordVersion: row.recordVersion,
});

const toItemView = (row: ChecklistTemplateItemRow): ChecklistTemplateItemView => ({
  id: row.id,
  templateId: row.templateId,
  itemCode: row.itemCode,
  label: row.label,
  isMandatory: row.isMandatory,
  sortOrder: row.sortOrder,
  recordVersion: row.recordVersion,
});

export class ChecklistTemplateService {
  public constructor(private readonly repository: DeliveryRepository) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** `sal.delivery-checklist-template-list` — every template the caller can see. */
  public async listTemplates(
    db: DbHandle,
    page: { limit?: number | undefined; cursor?: string | undefined }
  ): Promise<ChecklistTemplateListView> {
    const request: PageRequest = pageRequest(CHECKLIST_TEMPLATE_ORDER, page);
    const rows = await this.repository.listTemplates(db, request);
    return { templates: { ...rows, items: rows.items.map(toTemplateView) } };
  }

  /**
   * `sal.delivery-checklist-template-read` — one template with its items.
   *
   * Absent and out-of-scope answer the same `ERR-RES-001`, decided by the row read
   * rather than by a scope decision, so the operation is not an existence oracle for
   * a template in a company the caller cannot see.
   */
  public async readTemplate(
    db: DbHandle,
    templateId: string
  ): Promise<ChecklistTemplateDetailView> {
    const template = await this.requireTemplate(db, templateId);
    const items = await this.repository.listTemplateItems(db, template.companyId, template.id);
    return { template: toTemplateView(template), items: items.map(toItemView) };
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /**
   * `sal.delivery-checklist-template-create` — the header and its items, atomically.
   *
   * Items travel in the same body because they travel in the same transaction: a
   * template with no items gates nothing and offers nothing, so publishing a
   * create-then-add-each sequence as the only way to author one would make a
   * half-created checklist the normal outcome of a dropped connection. Every method
   * here runs inside the route handler's transaction, so either the whole checklist
   * exists or none of it does.
   *
   * The caller may still omit `items` and add them one at a time afterwards.
   */
  public async createTemplate(
    db: DbHandle,
    input: CreateChecklistTemplateInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<ChecklistTemplateDetailView> {
    // The company is a CLAIM about where the row belongs, checked against the
    // caller's own grant scope before anything is written. There is no branch half:
    // the table has no branch column, and `requireScopedPermissions` accepts a
    // company-only target — the shape `iam.company-settings-write` already uses.
    await authorizeScope({ companyId: input.companyId });

    const duplicates = new Set<string>();
    for (const item of input.items) {
      if (duplicates.has(item.itemCode)) {
        // Refused here rather than left to `uq_delivery_checklist_template_items_code`,
        // because the constraint would abort the transaction and the caller would
        // learn only that "an item code is already used" — not that it sent the code
        // twice in its own body.
        throw new AppFailure('ERR-VAL-001', {
          message: `Checklist item code "${item.itemCode}" appears twice in this request`,
          safeDetails: { violations: [{ path: 'body.items', rule: 'duplicate_code' }] },
        });
      }
      duplicates.add(item.itemCode);
    }

    let template: ChecklistTemplateRow;
    try {
      template = await this.repository.insertTemplate(db, {
        companyId: input.companyId,
        templateCode: input.templateCode,
        name: input.name,
      });
    } catch (cause) {
      this.#refuseWriteFailure(cause, 'body.templateCode', input.templateCode);
    }

    const created: ChecklistTemplateItemRow[] = [];
    for (const [index, item] of input.items.entries()) {
      try {
        created.push(
          await this.repository.insertTemplateItem(db, {
            companyId: template.companyId,
            templateId: template.id,
            itemCode: item.itemCode,
            label: item.label,
            isMandatory: item.isMandatory ?? false,
            sortOrder: item.sortOrder ?? index,
          })
        );
      } catch (cause) {
        this.#refuseWriteFailure(cause, `body.items.${String(index)}.itemCode`, item.itemCode);
      }
    }

    await appendAudit(db, {
      action: 'sal.delivery_checklist_template.created',
      entityType: 'sal.delivery_checklist_template',
      entityId: template.id,
      companyId: template.companyId,
      requestRef: 'sal.delivery-checklist-template-create',
      details: [
        { field: 'templateCode', classification: 'internal', value: template.templateCode },
        { field: 'name', classification: 'internal', value: template.name },
        { field: 'status', classification: 'public', value: template.status },
        { field: 'itemCount', classification: 'public', value: String(created.length) },
        {
          field: 'mandatoryItemCount',
          classification: 'public',
          // Recorded because a mandatory item is the one thing authored here that
          // can block a handover, and the audit trail should say how many arrived.
          value: String(created.filter((item) => item.isMandatory).length),
        },
      ],
    });

    return {
      template: toTemplateView(template),
      items: created
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.itemCode.localeCompare(b.itemCode))
        .map(toItemView),
    };
  }

  /**
   * `sal.delivery-checklist-template-rename` — the label, and nothing else.
   *
   * `templateCode` is absent from the body. It is not frozen by a trigger —
   * `tg_delivery_checklist_templates_immutable` freezes the tenant, the company,
   * `created_at` and `created_by`, and the code is merely held by
   * `uq_delivery_checklist_templates_code` — so this is a decision of this surface
   * and is stated as one: a re-coded template is a different configuration wearing
   * the old one's identity, and an operator reading a historical audit record would
   * have no way to know the code moved. `status` is absent too, because retiring a
   * checklist is its own command.
   */
  public async renameTemplate(
    db: DbHandle,
    templateId: string,
    expectedVersion: number,
    name: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<ChecklistTemplateView> {
    const existing = await this.requireTemplateForWrite(db, templateId, authorizeScope);
    const updated = this.#assertVersionMatched(
      await this.repository.renameTemplate(
        db,
        existing.companyId,
        existing.id,
        expectedVersion,
        name
      )
    );

    await appendAudit(db, {
      action: 'sal.delivery_checklist_template.renamed',
      entityType: 'sal.delivery_checklist_template',
      entityId: updated.id,
      companyId: updated.companyId,
      requestRef: 'sal.delivery-checklist-template-rename',
      details: [
        {
          field: 'name',
          classification: 'internal',
          previousValue: existing.name,
          value: updated.name,
        },
      ],
    });

    return toTemplateView(updated);
  }

  /**
   * `sal.delivery-checklist-template-status-set` — retire or restore a template.
   *
   * Bidirectional through one command, on the `apt.catalogue-source-channel-status-set`
   * precedent: `uq_delivery_checklist_templates_code` names `deleted_at` and says
   * nothing about `status`, so an inactive template still holds its code and a
   * retire-only command would burn that code for the company permanently.
   *
   * **What deactivation does NOT do, stated here because it is surprising.**
   * `sal.complete_delivery` counts mandatory items by `(tenant, company)` filtered on
   * the ITEM's `deleted_at` and never joins the parent template, so the mandatory
   * items of an INACTIVE template still block every handover in the company. Making
   * status mean what a reader expects is a change to that protected function — a
   * migration — and is recorded as a finding rather than mirrored here, because a
   * mirror that "improved" on the primitive would report a delivery eligible that the
   * primitive then refuses. Withdraw the items to stop them gating.
   */
  public async setTemplateStatus(
    db: DbHandle,
    templateId: string,
    expectedVersion: number,
    status: ChecklistTemplateStatus,
    authorizeScope: ScopeAuthorizer
  ): Promise<ChecklistTemplateView> {
    const existing = await this.requireTemplateForWrite(db, templateId, authorizeScope);
    const updated = this.#assertVersionMatched(
      await this.repository.setTemplateStatus(
        db,
        existing.companyId,
        existing.id,
        expectedVersion,
        status
      )
    );

    await appendAudit(db, {
      action: 'sal.delivery_checklist_template.status_changed',
      entityType: 'sal.delivery_checklist_template',
      entityId: updated.id,
      companyId: updated.companyId,
      requestRef: 'sal.delivery-checklist-template-status-set',
      details: [
        {
          field: 'status',
          classification: 'public',
          previousValue: existing.status,
          value: updated.status,
        },
      ],
    });

    return toTemplateView(updated);
  }

  /** `sal.delivery-checklist-template-item-create` — one more item on a template. */
  public async createItem(
    db: DbHandle,
    templateId: string,
    input: CreateChecklistTemplateItemInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<ChecklistTemplateItemView> {
    const template = await this.requireTemplateForWrite(db, templateId, authorizeScope);

    let created: ChecklistTemplateItemRow;
    try {
      created = await this.repository.insertTemplateItem(db, {
        companyId: template.companyId,
        templateId: template.id,
        itemCode: input.itemCode,
        label: input.label,
        isMandatory: input.isMandatory ?? false,
        sortOrder: input.sortOrder ?? 0,
      });
    } catch (cause) {
      this.#refuseWriteFailure(cause, 'body.itemCode', input.itemCode);
    }

    await appendAudit(db, {
      action: 'sal.delivery_checklist_template.item_added',
      entityType: 'sal.delivery_checklist_template_item',
      entityId: created.id,
      companyId: template.companyId,
      requestRef: 'sal.delivery-checklist-template-item-create',
      details: [
        { field: 'templateId', classification: 'internal', value: template.id },
        { field: 'itemCode', classification: 'internal', value: created.itemCode },
        { field: 'label', classification: 'internal', value: created.label },
        { field: 'isMandatory', classification: 'public', value: String(created.isMandatory) },
      ],
    });

    return toItemView(created);
  }

  /**
   * `sal.delivery-checklist-template-item-update` — label, mandatory flag, order.
   *
   * **The `If-Match` version is the ITEM's own**, never the template's. The two rows
   * carry independent counters and the path names both, which is exactly the shape a
   * caller can get wrong silently; the route docblock says so as well.
   *
   * `itemCode` is not editable: `sal.delivery_checklist_results.template_item_id`
   * points at the row by id, so a re-coded item would silently re-label every outcome
   * ever recorded against it. Withdraw it and add the code you meant.
   */
  public async updateItem(
    db: DbHandle,
    templateId: string,
    itemId: string,
    expectedVersion: number,
    input: UpdateChecklistTemplateItemInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<ChecklistTemplateItemView> {
    const template = await this.requireTemplateForWrite(db, templateId, authorizeScope);
    const existing = await this.requireItem(db, template, itemId);

    const updated = this.#assertVersionMatched(
      await this.repository.updateTemplateItem(
        db,
        template.companyId,
        existing.id,
        expectedVersion,
        {
          label: input.label ?? null,
          isMandatory: input.isMandatory ?? null,
          sortOrder: input.sortOrder ?? null,
        }
      )
    );

    await appendAudit(db, {
      action: 'sal.delivery_checklist_template.item_updated',
      entityType: 'sal.delivery_checklist_template_item',
      entityId: updated.id,
      companyId: template.companyId,
      requestRef: 'sal.delivery-checklist-template-item-update',
      details: [
        { field: 'templateId', classification: 'internal', value: template.id },
        { field: 'itemCode', classification: 'internal', value: updated.itemCode },
        {
          field: 'label',
          classification: 'internal',
          previousValue: existing.label,
          value: updated.label,
        },
        {
          field: 'isMandatory',
          classification: 'public',
          previousValue: String(existing.isMandatory),
          value: String(updated.isMandatory),
        },
        {
          field: 'sortOrder',
          classification: 'public',
          previousValue: String(existing.sortOrder),
          value: String(updated.sortOrder),
        },
      ],
    });

    return toItemView(updated);
  }

  /**
   * `sal.delivery-checklist-template-item-remove` — withdraw one item.
   *
   * A soft delete performed by UPDATE, on the `tech.technician-skill-withdraw`
   * precedent, because the table carries no DELETE grant and no DELETE policy for any
   * application role and because `fk_delivery_checklist_results_item` is
   * `ON DELETE RESTRICT`. Every outcome ever recorded against the item stays readable:
   * the checklist-result list read deliberately carries no `ti.deleted_at` predicate.
   *
   * This is the only affordance that removes an item from the completion gate —
   * `sal.complete_delivery` filters `ti.deleted_at IS NULL` — so it is what an
   * operator uses when a mandatory item is blocking handovers it should not.
   *
   * Not version-guarded, following that same precedent: the withdrawal is idempotent
   * in effect, a second attempt finds the row already gone and answers the uniform
   * `ERR-RES-001`, and there is no field whose concurrent edit a version could protect.
   */
  public async removeItem(
    db: DbHandle,
    templateId: string,
    itemId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<ChecklistTemplateItemView> {
    const template = await this.requireTemplateForWrite(db, templateId, authorizeScope);
    const existing = await this.requireItem(db, template, itemId);

    const removed = await this.repository.softDeleteTemplateItem(
      db,
      template.companyId,
      existing.id
    );
    if (!removed) {
      // The row was read a statement ago, so zero rows here is a concurrent
      // withdrawal rather than an unknown item — reported as the conflict it is.
      throw new AppFailure('ERR-CON-001', {
        message: 'The checklist item was withdrawn while this request was in flight',
      });
    }

    await appendAudit(db, {
      action: 'sal.delivery_checklist_template.item_removed',
      entityType: 'sal.delivery_checklist_template_item',
      entityId: existing.id,
      companyId: template.companyId,
      requestRef: 'sal.delivery-checklist-template-item-remove',
      details: [
        { field: 'templateId', classification: 'internal', value: template.id },
        { field: 'itemCode', classification: 'internal', value: existing.itemCode },
        { field: 'isMandatory', classification: 'public', value: String(existing.isMandatory) },
      ],
    });

    // The row as it stood when it was withdrawn, so a caller sees what it removed
    // rather than an empty body. `recordVersion` is the pre-withdrawal value and is
    // published for the same reason: nothing further can be done with this row.
    return toItemView(existing);
  }

  // -------------------------------------------------------------------------
  // Shared resolution
  // -------------------------------------------------------------------------

  /** The template, or the uniform 404 that does not distinguish absent from invisible. */
  private async requireTemplate(db: DbHandle, templateId: string): Promise<ChecklistTemplateRow> {
    const row = await this.repository.findTemplate(db, templateId);
    if (row === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Checklist template ${templateId} is not visible in the caller's scope`,
      });
    }
    return row;
  }

  /**
   * The template, re-authorized against ITS OWN company.
   *
   * Not-found is decided FIRST and the scope decision second, so a caller that may
   * not see the row is told the same thing as a caller for whom it does not exist. A
   * 403 on an id the caller cannot see would confirm that the id names a real row
   * somewhere.
   */
  private async requireTemplateForWrite(
    db: DbHandle,
    templateId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<ChecklistTemplateRow> {
    const row = await this.requireTemplate(db, templateId);
    await authorizeScope({ companyId: row.companyId });
    return row;
  }

  /** One live item OF THIS TEMPLATE, or the uniform 404. */
  private async requireItem(
    db: DbHandle,
    template: ChecklistTemplateRow,
    itemId: string
  ): Promise<ChecklistTemplateItemRow> {
    const item = await this.repository.findTemplateItem(db, template.companyId, itemId);
    // `findTemplateItem` resolves within the COMPANY, so an item of a sibling
    // template in the same company would otherwise be editable through this
    // template's path. The parent check makes the path mean what it says.
    if (item === null || item.templateId !== template.id) {
      throw new AppFailure('ERR-RES-001', {
        message: `Checklist item ${itemId} is not an item of template ${template.id}`,
      });
    }
    return item;
  }

  /**
   * No row returned means the `record_version` predicate did not match.
   *
   * Every other reason for zero rows — absent, another tenant's, soft-deleted, a
   * company the caller may not write — has already been excluded, so this is the
   * concurrency loss and nothing else. The DATABASE's row is returned rather than
   * `expectedVersion + 1`, because that number is the caller's next `If-Match` and
   * inferring it would encode an assumption about `shared.touch_row_metadata` this
   * module does not own.
   */
  #assertVersionMatched<T>(updated: T | null): T {
    if (updated === null) {
      throw new AppFailure('ERR-CON-001', {
        message:
          'The checklist template changed while this request was in flight; re-read and retry',
      });
    }
    return updated;
  }

  /** Maps the two frozen constraints to stable problems; re-throws everything else. */
  #refuseWriteFailure(cause: unknown, path: string, code: string): never {
    if (isSqlState(cause, SQLSTATE.uniqueViolation)) {
      // `uq_delivery_checklist_templates_code` and
      // `uq_delivery_checklist_template_items_code` are both partial on
      // `deleted_at IS NULL`, so a withdrawn row does NOT hold its code and the
      // message does not tell the caller to restore anything.
      throw new AppFailure('ERR-CON-001', {
        message: `The code "${code}" is already used here`,
        safeDetails: { violations: [{ path, rule: 'duplicate_code' }] },
      });
    }
    if (isSqlState(cause, SQLSTATE.foreignKeyViolation)) {
      // `fk_delivery_checklist_templates_company` resolves `(tenant_id, company_id)`
      // with the tenant from the session context, so this is a company that is not
      // in the caller's tenant — including one that exists in another tenant.
      throw new AppFailure('ERR-VAL-001', {
        message: 'The named company does not exist in this tenant',
        safeDetails: { violations: [{ path: 'body.companyId', rule: 'unknown_company' }] },
      });
    }
    throw cause;
  }
}
