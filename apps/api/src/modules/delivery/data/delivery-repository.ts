/**
 * `sal` delivery SQL (Phase 1-22, delivery module).
 *
 * The only place delivery SQL is written. Four conventions hold without exception:
 *
 *  - **Every query carries an explicit `tenant_id` predicate** even though RLS
 *    already narrows, and every query that has the row's scope in hand carries
 *    `company_id` AND `branch_id` too. RLS is the guarantee; the predicates are the
 *    intent, and they keep the plan on the tenant/company/branch-leading composite
 *    indexes this schema actually has (`ix_delivery_records_work_order`,
 *    `ix_delivery_checklist_results_delivery`, `ix_delivery_signatures_delivery`).
 *    The two exceptions are marked at their call sites and each has a reason: an
 *    anchor lookup by `id` cannot predicate on a scope it has not read yet, and the
 *    idempotency index is `(tenant_id, idempotency_key)` — tenant-wide by
 *    construction, so narrowing it further would miss the row that owns the key and
 *    turn a replay into a `23505`.
 *  - **Every value is a bound parameter.** Nothing is interpolated anywhere in this
 *    file, not even a column name: there is no dynamic SQL here at all.
 *  - **The gate mirrors are transcribed, not paraphrased.** `sal.complete_delivery`
 *    decides three things under its own row lock, and this repository reports the
 *    same three facts for `readEligibility`. Where the function's predicate differs
 *    from what a reader would assume — the mandatory-checklist scan is COMPANY-wide
 *    and not template-scoped, and the receiver probe has no `deleted_at` filter
 *    while the results probe does — the mirror follows the function and the comment
 *    says so. A mirror that "improved" on the primitive would report a delivery as
 *    eligible that the primitive then refuses, or the reverse.
 *  - **`numeric` crosses this boundary as a STRING.** The one numeric value here is
 *    `sal.complete_delivery`'s `p_final_odometer_value`, bound as text and cast
 *    `$2::numeric` in SQL. Nothing in this module converts an odometer value or any
 *    amount to `number`.
 *
 * ## Pagination arrived with the P1-31 read seam, and only where a set is unbounded
 *
 * Until P1-31 this file carried no `OrderingContract` at all, because the module
 * registered six operations and not one of them was a list. That paragraph is now
 * superseded rather than deleted, because the reasoning it gave still governs which
 * of the new reads is paged: an ordering contract exists to make a cursor
 * verifiable, so one is declared exactly where a caller can issue a cursor.
 *
 * Three sets are now readable and each is treated by its own bound:
 *
 *  - `sal.delivery_signatures` has **no** unique constraint on
 *    `(delivery_record_id, signer_role)` — the table's own comment says corrections
 *    are made by appending — so one delivery may carry any number of rows. It is
 *    keyset-paged under `SIGNATURE_ORDER`, never selected whole.
 *  - `sal.delivery_status_history` is append-only and grows by one row per
 *    transition, with no ceiling in the DDL. Keyset-paged under
 *    `STATUS_HISTORY_ORDER`.
 *  - `sal.delivery_checklist_results` is bounded per delivery by
 *    `uq_delivery_checklist_results_item` — at most one row per template item — but
 *    the template itself is unbounded, so the set is bounded only by a number this
 *    module does not control. Keyset-paged under `CHECKLIST_RESULT_ORDER` for that
 *    reason, not for symmetry.
 *
 * Every cursor sort value is minted by `cursorTimestamp()` in SQL at MICROSECOND
 * precision. A JS `Date` truncates to milliseconds and silently SKIPS rows sharing
 * the boundary row's millisecond (`P1-27-INT-006`) — and these three tables are
 * exactly where that bites, because a delivery's rows are frequently written inside
 * one transaction and therefore share `transaction_timestamp()` to the microsecond.
 *
 * The `LIMIT`-bounded mandatory-gap sample below is unchanged and is still NOT a
 * page: it answers a refusal message, issues no cursor, and its bound is a constant.
 */
import { Repository } from '@/server/db/repository';
import {
  buildPageWithCursors,
  cursorTimestamp,
  keysetFragment,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';
import type { DbHandle } from '@/server/db/transaction';

/**
 * The company/branch pair every non-anchor query predicates on.
 *
 * Passed as a value rather than re-derived per method so a caller cannot supply one
 * scope to the authorization check and a different one to the query — the service
 * reads it once off the locked delivery row and hands the same object to both.
 */
export interface DeliveryScope {
  readonly companyId: string;
  readonly branchId: string;
}

/** `RAISE … USING ERRCODE = 'no_data_found'` — `sal.complete_delivery` saw no row. */
export const SQLSTATE_NO_DATA_FOUND = 'P0002';

// ---------------------------------------------------------------------------
// Row types. Every field is readonly, timestamps are `Date | null`, and
// `recordVersion` is the optimistic-concurrency counter `shared.touch_row_metadata`
// advances by exactly one per UPDATE.
// ---------------------------------------------------------------------------

export interface DeliveryRecordRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  /** Copied from the work order by the service; `sal.guard_delivery_coherence` refuses any other value. */
  readonly receptionVisitId: string;
  /** Same provenance and the same guard. */
  readonly vehicleId: string;
  /**
   * `delivering_employee_id` — an `org.employees` id, bound by
   * `fk_delivery_records_delivering_employee` on `(tenant_id, id)` since P1-31
   * prerequisite P-17. Before that it carried no foreign key at all. The key
   * names the tenant and nothing narrower: the employee home branch does not
   * restrict which branch may name them.
   */
  readonly deliveringEmployeeId: string;
  /**
   * The employee's display name as it stood when the handover was recorded.
   *
   * Server-stamped by `sal.stamp_delivering_employee_identity` and frozen by
   * `tg_delivery_records_immutable`, so a later rename or retirement cannot
   * rewrite what a customer already signed.
   *
   * `null` only on a pre-P-17 delivery whose delivering employee id resolved to
   * nobody; those rows are listed in `sal.delivery_legacy_identity_review`. The
   * column is nullable so that history could be preserved untouched instead of
   * being completed with a person nobody confirmed.
   */
  readonly deliveringEmployeeDisplayName: string | null;
  readonly status: string;
  readonly deliveredAt: Date | null;
  /** `veh.odometer_readings.id`, written only by `sal.complete_delivery`. */
  readonly finalOdometerReadingId: string | null;
  readonly idempotencyKey: string | null;
  readonly recordVersion: number;
}

/**
 * One checklist template item.
 *
 * COMPANY-scoped: `sal.delivery_checklist_template_items` has a `company_id` and no
 * `branch_id`, and its RLS policy has no branch clause. So a template item is shared
 * by every branch of a company, which is exactly why `sal.complete_delivery` scans
 * mandatory items by company rather than by the delivery's branch.
 */
export interface ChecklistTemplateItemRow {
  readonly id: string;
  readonly companyId: string;
  readonly templateId: string;
  readonly itemCode: string;
  readonly label: string;
  readonly isMandatory: boolean;
  readonly sortOrder: number;
  readonly recordVersion: number;
}

/**
 * One checklist template header (P1-31 prerequisite P-9, **PPD-12**).
 *
 * COMPANY-scoped like its items and for the same reason: the table has a
 * `company_id`, no `branch_id`, and an RLS policy with no branch clause. So one
 * template is shared by every branch of a company, which is why the write surface
 * over it requires authority for the COMPANY rather than for a branch.
 *
 * `status` is `active` or `inactive` (`ck_delivery_checklist_templates_status`) and
 * `templateCode` matches `^[a-z][a-z0-9_]{1,62}$`. Neither the code nor the company
 * can be edited afterwards — `tg_delivery_checklist_templates_immutable` freezes
 * `tenant_id`, `company_id`, `created_at` and `created_by`, and the code is held by
 * `uq_delivery_checklist_templates_code` while the row is not soft-deleted.
 */
export interface ChecklistTemplateRow {
  readonly id: string;
  readonly companyId: string;
  readonly templateCode: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}

export interface ChecklistResultRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly deliveryRecordId: string;
  readonly templateItemId: string;
  readonly outcome: string;
  readonly waiverReason: string | null;
  readonly recordedBy: string;
  readonly recordVersion: number;
}

/**
 * The verified receiver for a delivery.
 *
 * `identityEvidenceDocumentVersionId` is a REFERENCE and nothing else. No identity
 * document content is read, stored, logged, or returned anywhere in this module —
 * the whole row is gated by `sal.delivery.view` in the RLS policy precisely because
 * the reference is enough to reach identity evidence.
 */
export interface AuthorizedReceiverRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly deliveryRecordId: string;
  readonly receiverPartnerId: string;
  readonly identityEvidenceDocumentVersionId: string | null;
  readonly verifiedBy: string;
  readonly verifiedAt: Date;
  readonly recordVersion: number;
}

/**
 * One signature row.
 *
 * `signatureDocumentVersionId` is a reference to a `shared.document_versions` row.
 * **Raw signature bytes never appear here, or anywhere in this module.** There is
 * also no retrieval method here, and that is a scope boundary rather than an
 * impossibility: fetching belongs to the shared attachment path, whose
 * `requestDownload` refuses a version with `ERR-DOC-001` while it is not `accepted` —
 * a state check. P1-22 recorded the rest as "no application path can produce
 * acceptance" (`P1-22-L-04`); `20260815090000_shared_reception_evidence_foundation.sql`
 * adds `GRANT INSERT ON shared.file_scan_results` and `GRANT UPDATE(status) ON
 * shared.document_versions`, so that is no longer the rule. The reference is returned;
 * fetching it is not offered by this repository. Corrected by P1-31 prerequisite P-14.
 *
 * The table is append-only by grant (SELECT + INSERT, no UPDATE, no DELETE), which
 * is why there is no `recordVersion` and no `deleted_at` on it.
 */
export interface DeliverySignatureRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly deliveryRecordId: string;
  readonly signerRole: string;
  readonly signatureDocumentVersionId: string;
  readonly signedAt: Date;
}

/**
 * A recorded checklist result WITH the template item's code and label.
 *
 * A widening of `ChecklistResultRow`, not a parallel shape: it extends it and its
 * mapper is `toChecklistResult` plus the two joined columns.
 *
 * The two extra fields are here because the checklist TEMPLATE has no HTTP surface
 * at all (**PPD-12** / prerequisite P-9), so a caller cannot resolve a
 * `template_item_id` to anything a person can read. The write path already returns
 * `itemCode` on a recorded result, so publishing it on the read is contract PARITY
 * rather than a new field.
 */
export interface ChecklistResultDetailRow extends ChecklistResultRow {
  readonly itemCode: string;
  readonly label: string;
}

/**
 * One row of the append-only delivery status ledger.
 *
 * `sal.delivery_status_history` is written on every transition and, until P1-31,
 * was read by nothing anywhere in `apps/api/src` (**P1-27-INT-089**). This is the
 * only row shape in this file that is NEW rather than published, because there was
 * no existing read to publish.
 *
 * `actorId` and `occurredAt` are both server-stamped by
 * `shared.stamp_status_history` and the table holds SELECT and INSERT grants only,
 * so a row here is the record of a transition rather than a reconstruction of one.
 * `actor_id` is NOT NULL in the DDL and is typed accordingly.
 */
export interface DeliveryStatusHistoryRow {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reason: string | null;
  readonly actorId: string;
  readonly occurredAt: Date;
}

/** A mandatory item with no satisfying result — one entry of the `checklist_incomplete` reason. */
export interface ChecklistGapRow {
  readonly templateItemId: string;
  readonly templateId: string;
  readonly itemCode: string;
  readonly label: string;
}

/** Mandatory-checklist shortfall, as `sal.complete_delivery` itself would count it. */
export interface ChecklistGapReport {
  /** The primitive's own `v_missing`. Zero is the only value that passes its gate. */
  readonly missingCount: number;
  /** A bounded sample, so a refusal can name items without an unbounded read. */
  readonly sample: readonly ChecklistGapRow[];
}

/** How many gap rows a report carries. Bounded so a huge template cannot become a huge response. */
const GAP_SAMPLE_LIMIT = 20;

// ---------------------------------------------------------------------------
// Ordering contracts (P1-31 read seam).
//
// Each key names the table and the direction, so a cursor minted for one list can
// never be spent on another: `decodeCursor` compares the key against the contract
// and refuses a mismatch with ERR-PAG-001.
//
// All three are newest-first. That is the operator's reading order for an
// append-only ledger, and it puts the row a screen needs — the latest signature,
// the current status — on the first page rather than behind a cursor walk.
// ---------------------------------------------------------------------------

/** A delivery's checklist results, newest first. */
export const CHECKLIST_RESULT_ORDER = Object.freeze({
  key: 'sal.delivery_checklist_results:created_at_desc',
  direction: 'desc' as const,
});

/** A delivery's signatures, newest first. */
export const SIGNATURE_ORDER = Object.freeze({
  key: 'sal.delivery_signatures:signed_at_desc',
  direction: 'desc' as const,
});

/** A delivery's status ledger, newest transition first. */
export const STATUS_HISTORY_ORDER = Object.freeze({
  key: 'sal.delivery_status_history:occurred_at_desc',
  direction: 'desc' as const,
});

/**
 * The company's checklist templates, newest first (P1-31 prerequisite P-9).
 *
 * Paged for the reason the three ledgers above are: the set has no ceiling in the
 * DDL, and it is the operator who decides how many templates a company keeps. The
 * ITEMS of one template are deliberately NOT paged — see `listTemplateItems`.
 */
export const CHECKLIST_TEMPLATE_ORDER = Object.freeze({
  key: 'sal.delivery_checklist_templates:created_at_desc',
  direction: 'desc' as const,
});

/**
 * A branch's delivery records, newest first (P1-31 prerequisite P-2b).
 *
 * `created_at` and not `delivered_at`: the column is NOT NULL on every row, where
 * `delivered_at` is NULL until the handover completes, and a sort key that is null
 * for most of the set cannot order it. `sal.delivery_records` carries no scheduled
 * date of any kind, so `created_at` is the only total temporal order the table has.
 *
 * The cursor is minted by `cursorTimestamp()` at MICROSECOND precision, because
 * `created_at` defaults to `now()` and two deliveries opened in one transaction
 * share it exactly (`P1-27-INT-006`).
 */
export const DELIVERY_RECORD_ORDER = Object.freeze({
  key: 'sal.delivery_records:created_at_desc',
  direction: 'desc' as const,
});

// ---------------------------------------------------------------------------
// SQL shapes and mappers. snake_case in, camelCase out, one mapper per shape.
// ---------------------------------------------------------------------------

const DELIVERY_COLUMNS = `id, company_id, branch_id, work_order_id, reception_visit_id,
  vehicle_id, delivering_employee_id, delivering_employee_display_name, status,
  delivered_at, final_odometer_reading_id, idempotency_key, record_version`;

interface DeliveryRecordSql {
  id: string;
  company_id: string;
  branch_id: string;
  work_order_id: string;
  reception_visit_id: string;
  vehicle_id: string;
  delivering_employee_id: string;
  delivering_employee_display_name: string | null;
  status: string;
  delivered_at: Date | null;
  final_odometer_reading_id: string | null;
  idempotency_key: string | null;
  record_version: number;
}

const toDeliveryRecord = (r: DeliveryRecordSql): DeliveryRecordRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  workOrderId: r.work_order_id,
  receptionVisitId: r.reception_visit_id,
  vehicleId: r.vehicle_id,
  deliveringEmployeeId: r.delivering_employee_id,
  deliveringEmployeeDisplayName: r.delivering_employee_display_name,
  status: r.status,
  deliveredAt: r.delivered_at,
  finalOdometerReadingId: r.final_odometer_reading_id,
  idempotencyKey: r.idempotency_key,
  recordVersion: r.record_version,
});

interface ChecklistTemplateItemSql {
  id: string;
  company_id: string;
  template_id: string;
  item_code: string;
  label: string;
  is_mandatory: boolean;
  sort_order: number;
  record_version: number;
}

interface ChecklistTemplateSql {
  id: string;
  company_id: string;
  template_code: string;
  name: string;
  status: string;
  record_version: number;
}

const toChecklistTemplate = (r: ChecklistTemplateSql): ChecklistTemplateRow => ({
  id: r.id,
  companyId: r.company_id,
  templateCode: r.template_code,
  name: r.name,
  status: r.status,
  recordVersion: r.record_version,
});

const toChecklistTemplateItem = (r: ChecklistTemplateItemSql): ChecklistTemplateItemRow => ({
  id: r.id,
  companyId: r.company_id,
  templateId: r.template_id,
  itemCode: r.item_code,
  label: r.label,
  isMandatory: r.is_mandatory,
  sortOrder: r.sort_order,
  recordVersion: r.record_version,
});

interface ChecklistResultSql {
  id: string;
  company_id: string;
  branch_id: string;
  delivery_record_id: string;
  template_item_id: string;
  outcome: string;
  waiver_reason: string | null;
  recorded_by: string;
  record_version: number;
}

const toChecklistResult = (r: ChecklistResultSql): ChecklistResultRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  deliveryRecordId: r.delivery_record_id,
  templateItemId: r.template_item_id,
  outcome: r.outcome,
  waiverReason: r.waiver_reason,
  recordedBy: r.recorded_by,
  recordVersion: r.record_version,
});

interface AuthorizedReceiverSql {
  id: string;
  company_id: string;
  branch_id: string;
  delivery_record_id: string;
  receiver_partner_id: string;
  identity_evidence_document_version_id: string | null;
  verified_by: string;
  verified_at: Date;
  record_version: number;
}

const toAuthorizedReceiver = (r: AuthorizedReceiverSql): AuthorizedReceiverRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  deliveryRecordId: r.delivery_record_id,
  receiverPartnerId: r.receiver_partner_id,
  identityEvidenceDocumentVersionId: r.identity_evidence_document_version_id,
  verifiedBy: r.verified_by,
  verifiedAt: r.verified_at,
  recordVersion: r.record_version,
});

interface DeliverySignatureSql {
  id: string;
  company_id: string;
  branch_id: string;
  delivery_record_id: string;
  signer_role: string;
  signature_document_version_id: string;
  signed_at: Date;
}

const toDeliverySignature = (r: DeliverySignatureSql): DeliverySignatureRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  deliveryRecordId: r.delivery_record_id,
  signerRole: r.signer_role,
  signatureDocumentVersionId: r.signature_document_version_id,
  signedAt: r.signed_at,
});

interface ChecklistGapSql {
  template_item_id: string;
  template_id: string;
  item_code: string;
  label: string;
}

const toChecklistGap = (r: ChecklistGapSql): ChecklistGapRow => ({
  templateItemId: r.template_item_id,
  templateId: r.template_id,
  itemCode: r.item_code,
  label: r.label,
});

interface DeliveryStatusHistorySql {
  id: string;
  delivery_record_id: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  actor_id: string;
  occurred_at: Date;
}

const toDeliveryStatusHistory = (r: DeliveryStatusHistorySql): DeliveryStatusHistoryRow => ({
  id: r.id,
  deliveryRecordId: r.delivery_record_id,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  reason: r.reason,
  actorId: r.actor_id,
  occurredAt: r.occurred_at,
});

export class DeliveryRepository extends Repository {
  protected readonly module = 'delivery';

  // -------------------------------------------------------------------------
  // Delivery records
  // -------------------------------------------------------------------------

  /**
   * The delivery, or null for absent-or-out-of-scope alike.
   *
   * Predicated on `tenant_id` and `id` only, because a lookup addressed solely by id
   * has no company or branch to narrow by yet — the row is where they come from. RLS
   * (`sel_delivery_records_scope`) still narrows to the caller's granted companies
   * and branches, and the caller re-authorizes against the row's own pair the moment
   * it is read (`authorizeScope`), which is the check that `iam.has_permission` alone
   * cannot make: `app.branch_ids` is the permission-blind union of every active
   * grant, so RLS visibility is not authority (P1-18-A-01).
   */
  public async findDelivery(db: DbHandle, deliveryId: string): Promise<DeliveryRecordRow | null> {
    return this.readDelivery(db, deliveryId, false);
  }

  /**
   * The delivery, taken `FOR UPDATE`.
   *
   * `sal.complete_delivery` takes the same row lock in tenant scope as its first
   * statement, so locking here first is the same lock in the same order and cannot
   * deadlock against it. Locking BEFORE eligibility is recomposed is the whole point:
   * an unlocked recomposition could be invalidated by a concurrent credit note or a
   * concurrent part issue between the read and the call, and this operation hands
   * over a vehicle — there is no compensating action afterwards.
   */
  public async lockDelivery(db: DbHandle, deliveryId: string): Promise<DeliveryRecordRow | null> {
    return this.readDelivery(db, deliveryId, true);
  }

  private async readDelivery(
    db: DbHandle,
    deliveryId: string,
    lock: boolean
  ): Promise<DeliveryRecordRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<DeliveryRecordSql>(
      db,
      `SELECT ${DELIVERY_COLUMNS}
         FROM sal.delivery_records
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        ${lock ? 'FOR UPDATE' : ''}`,
      [context.principal.tenantId, deliveryId]
    );
    return row ? toDeliveryRecord(row) : null;
  }

  /**
   * The one live delivery for a work order, if there is one.
   *
   * Mirrors `uq_delivery_records_work_order_active` exactly — `status <> 'exception'
   * AND deleted_at IS NULL` — because that partial unique index is what makes "one
   * live delivery per work order" true, and a probe with different predicates would
   * either miss the row that is about to cause a `23505` or claim a collision where
   * the index permits the insert.
   */
  public async findLiveDeliveryForWorkOrder(
    db: DbHandle,
    scope: DeliveryScope,
    workOrderId: string
  ): Promise<DeliveryRecordRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<DeliveryRecordSql>(
      db,
      `SELECT ${DELIVERY_COLUMNS}
         FROM sal.delivery_records
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND work_order_id = $4
          AND status <> 'exception' AND deleted_at IS NULL`,
      [context.principal.tenantId, scope.companyId, scope.branchId, workOrderId]
    );
    return row ? toDeliveryRecord(row) : null;
  }

  /**
   * A branch's delivery records, newest first (P1-31 prerequisite P-2b).
   *
   * ## Scope
   *
   * `company_id` and `branch_id` are bound predicates and the service has already
   * authorized the pair. `sel_delivery_records_scope` narrows on the
   * permission-blind union of the caller's allowed companies and branches, so
   * without the explicit pair a caller holding `sal.delivery.view` in one branch
   * would read every branch it holds any grant in (P1-18-A-01). RLS remains the
   * guarantee; the predicate is the intent.
   *
   * ## Three optional filters and no more
   *
   * `status`, `work_order_id` and `vehicle_id`, each expressed as
   * `($n IS NULL OR col = $n)` so one statement serves every combination. All three
   * are columns of this table — `status` is bounded by `ck_delivery_records_status`
   * and validated against the same vocabulary at the boundary, and the other two are
   * NOT NULL references — so no filter needs a new column and none is invented
   * beyond what the record names.
   *
   * ## Ordering, and the index that was NOT added
   *
   * `DELIVERY_RECORD_ORDER` — `(created_at DESC, id DESC)`, with the `id` tie-break
   * making the order total. The branch predicate is served by the table's
   * tenant/company/branch-leading indexes and no index leads on
   * `(tenant, company, branch, created_at)`, so the ordering is a sort over the
   * already-narrowed set. `wty.warranty-list` declined a migration on exactly this
   * reasoning and this list follows it: a branch's deliveries are bounded by its
   * work orders, and a schema change would be a cost this read has not demonstrated.
   *
   * `deleted_at IS NULL` is filtered, as it is in `findDelivery`: a list feeds no
   * primitive, so publishing rows the tenant has deleted would be the dishonest
   * option.
   */
  public async listDeliveries(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
      readonly workOrderId?: string | undefined;
      readonly vehicleId?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<DeliveryRecordRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.status ?? null,
      filter.workOrderId ?? null,
      filter.vehicleId ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'created_at', id: 'id' },
      DELIVERY_RECORD_ORDER,
      values.length + 1
    );
    const result = await this.run<DeliveryRecordSql & { sort_value: string }>(
      db,
      `SELECT ${DELIVERY_COLUMNS},
              ${cursorTimestamp('created_at')} AS sort_value
         FROM sal.delivery_records
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND deleted_at IS NULL
          AND ($4::text IS NULL OR status = $4)
          AND ($5::uuid IS NULL OR work_order_id = $5)
          AND ($6::uuid IS NULL OR vehicle_id = $6)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        // `created_at` is not published on the row, so the cursor value cannot be
        // re-derived from the response — which is what `buildPageWithCursors` is for.
        item: toDeliveryRecord(row),
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      DELIVERY_RECORD_ORDER
    );
  }

  /**
   * The delivery a previous request created under this idempotency key.
   *
   * Deliberately **tenant-scoped with no company or branch predicate**, which is the
   * one place in this file that departs from the scope-predicate rule.
   * `uq_delivery_records_idempotency` is `(tenant_id, idempotency_key)` — the key is
   * unique across the whole tenant, not per branch — so adding a branch predicate
   * would hide a row that already owns the key and the follow-up INSERT would abort
   * the transaction with `23505` instead of replaying. RLS still narrows, and the
   * service compares the replayed row's scope against the request before returning
   * it, so an out-of-scope key cannot be mistaken for a successful replay.
   */
  public async findDeliveryByIdempotencyKey(
    db: DbHandle,
    idempotencyKey: string
  ): Promise<DeliveryRecordRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<DeliveryRecordSql>(
      db,
      `SELECT ${DELIVERY_COLUMNS}
         FROM sal.delivery_records
        WHERE tenant_id = $1 AND idempotency_key = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, idempotencyKey]
    );
    return row ? toDeliveryRecord(row) : null;
  }

  /**
   * Inserts a delivery record and returns its id.
   *
   * `receptionVisitId` and `vehicleId` are parameters rather than derived here
   * because this module may not read `wo.work_orders` — the service obtains them from
   * the work-order module's public port. That is not merely a boundary formality:
   * `sal.guard_delivery_coherence` (M-dlv-1) re-reads the work order on INSERT and
   * raises `check_violation` unless both match, so a value taken from client input
   * would be refused by the database anyway, one layer further away from the caller
   * and with a message this platform never echoes.
   *
   * `status` is left to the column default (`'ready'`) and `delivered_at` /
   * `final_odometer_reading_id` are left NULL, because
   * `ck_delivery_records_delivered_shape` makes `delivered` a biconditional with both
   * of them and only `sal.complete_delivery` may satisfy it.
   */
  public async insertDelivery(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly workOrderId: string;
      readonly receptionVisitId: string;
      readonly vehicleId: string;
      readonly deliveringEmployeeId: string;
      readonly idempotencyKey: string | null;
    }
  ): Promise<string> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO sal.delivery_records
         (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id,
          delivering_employee_id, idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.workOrderId,
        input.receptionVisitId,
        input.vehicleId,
        input.deliveringEmployeeId,
        input.idempotencyKey,
        context.principal.userId,
      ]
    );
    if (!row) {
      throw new Error('delivery: INSERT INTO sal.delivery_records returned no id');
    }
    return row.id;
  }

  /**
   * Moves a delivery from one status to another, and returns whether it moved.
   *
   * `status = $5` in the WHERE clause is a compare-and-set, not decoration: the two
   * intermediate advances (`ready → receiver_verified`, `receiver_verified → signed`)
   * are not version-guarded operations, so this predicate is the only thing that
   * stops two concurrent requests from both believing they performed the advance and
   * both writing a history row for it. A return of `0` means somebody else moved the
   * row first, which the service reports rather than retries.
   *
   * `delivered` is deliberately not reachable through this method:
   * `ck_delivery_records_delivered_shape` requires `delivered_at` and
   * `final_odometer_reading_id` in the same statement, and the only code allowed to
   * write those is `sal.complete_delivery`.
   */
  public async advanceStatus(
    db: DbHandle,
    scope: DeliveryScope,
    deliveryId: string,
    fromStatus: string,
    toStatus: string
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE sal.delivery_records
          SET status = $6
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND id = $4
          AND status = $5 AND deleted_at IS NULL`,
      [
        context.principal.tenantId,
        scope.companyId,
        scope.branchId,
        deliveryId,
        fromStatus,
        toStatus,
      ]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /**
   * Appends one row to the append-only status ledger.
   *
   * `actor_id` and `occurred_at` are **omitted from the column list on purpose**.
   * `shared.stamp_status_history` is a BEFORE INSERT trigger that sets both from the
   * session context and raises `check_violation` when there is no actor, so leaving
   * them out means this application has no expression through which it could claim a
   * different actor or backdate a handover — and if the trigger were ever dropped,
   * `actor_id NOT NULL` fails loudly rather than recording an unattributed row.
   *
   * `sal.delivery_records` has **no** AFTER UPDATE history trigger (unlike
   * `wo.work_orders`), so every intermediate advance must append its own row here.
   * The `delivered` row is the exception: `sal.complete_delivery` writes that one
   * itself, and writing a second here would double-count the transition.
   */
  public async appendStatusHistory(
    db: DbHandle,
    scope: DeliveryScope,
    input: {
      readonly deliveryRecordId: string;
      readonly fromStatus: string | null;
      readonly toStatus: string;
      readonly reason: string | null;
    }
  ): Promise<string> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO sal.delivery_status_history
         (tenant_id, company_id, branch_id, delivery_record_id, from_status, to_status,
          reason, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        context.principal.tenantId,
        scope.companyId,
        scope.branchId,
        input.deliveryRecordId,
        input.fromStatus,
        input.toStatus,
        input.reason,
        context.correlationId,
      ]
    );
    if (!row) {
      throw new Error('delivery: INSERT INTO sal.delivery_status_history returned no id');
    }
    return row.id;
  }

  /**
   * The delivery's status ledger, newest transition first (P1-31 P-5,
   * **P1-27-INT-089**).
   *
   * ## This one had nothing to publish
   *
   * `appendStatusHistory` above is the only method that has ever touched
   * `sal.delivery_status_history`: the table is written on every transition and,
   * before this, was read by nothing anywhere in `apps/api/src`. So unlike the other
   * P1-31 reads there was no existing query to put a route in front of, and this
   * query and `toDeliveryStatusHistory` are both new. That is recorded rather than
   * glossed.
   *
   * ## The ledger is the record, not a reconstruction
   *
   * The table holds SELECT and INSERT grants only — no UPDATE, no DELETE, for any
   * application role — and `shared.stamp_status_history` sets `actor_id` and
   * `occurred_at` from the session context. So a row cannot be back-dated or
   * re-attributed after the fact.
   *
   * ## The origin row is here, unlike the work-order ledger
   *
   * `wo.job_status_history` and `wo.work_order_status_history` are written by AFTER
   * UPDATE triggers, so their oldest row is the first TRANSITION and their readers
   * must publish a separate `origin` block for the initial state. This table has no
   * trigger: `sal.delivery_records` has no AFTER UPDATE history emitter and every
   * advance appends its own row, `from_status` included. The oldest row is
   * therefore already the origin and no `origin` block is synthesised.
   *
   * `ix_delivery_status_history_delivery` is
   * `(tenant_id, company_id, branch_id, delivery_record_id, occurred_at DESC, seq DESC)`,
   * which the predicate and the ordering below lead on exactly.
   *
   * The keyset tie-breaks on `id` rather than the `seq` identity column, because
   * `keysetFragment` compares `(sort, id)` and `Cursor.i` is validated as an
   * identifier. `seq` orders identically within one `occurred_at`, so the only cost
   * is that two rows sharing a microsecond are ordered by uuid instead of by
   * insertion — and `cursorTimestamp` keeps that pair on the same page rather than
   * skipping one.
   */
  public async listStatusHistory(
    db: DbHandle,
    scope: DeliveryScope,
    deliveryRecordId: string,
    request: PageRequest
  ): Promise<Page<DeliveryStatusHistoryRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      scope.companyId,
      scope.branchId,
      deliveryRecordId,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'occurred_at', id: 'id' },
      STATUS_HISTORY_ORDER,
      values.length + 1
    );
    const result = await this.run<DeliveryStatusHistorySql & { sort_value: string }>(
      db,
      `SELECT id, delivery_record_id, from_status, to_status, reason, actor_id, occurred_at,
              ${cursorTimestamp('occurred_at')} AS sort_value
         FROM sal.delivery_status_history
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND delivery_record_id = $4
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: toDeliveryStatusHistory(row),
        // `occurred_at` defaults to `now()`, so the receiver-verify and
        // signature-attach transitions of one request share it to the microsecond
        // (`P1-27-INT-006`).
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      STATUS_HISTORY_ORDER
    );
  }

  // -------------------------------------------------------------------------
  // Authorized receiver
  // -------------------------------------------------------------------------

  /**
   * The delivery's receiver, or null.
   *
   * **No `deleted_at` predicate, and that is transcribed rather than forgotten.**
   * `sal.complete_delivery`'s receiver gate reads
   * `WHERE tenant_id = … AND company_id = … AND branch_id = … AND delivery_record_id = …`
   * with no soft-delete filter, and `uq_authorized_receivers_delivery` is a
   * non-partial UNIQUE, so there is at most one row per delivery whatever its
   * `deleted_at`. Adding the filter here would make `receiverVerified` report false
   * for a delivery the primitive would happily complete — an eligibility answer that
   * disagrees with the gate it exists to predict.
   */
  public async findReceiver(
    db: DbHandle,
    scope: DeliveryScope,
    deliveryRecordId: string
  ): Promise<AuthorizedReceiverRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<AuthorizedReceiverSql>(
      db,
      `SELECT id, company_id, branch_id, delivery_record_id, receiver_partner_id,
              identity_evidence_document_version_id, verified_by, verified_at, record_version
         FROM sal.authorized_receivers
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND delivery_record_id = $4`,
      [context.principal.tenantId, scope.companyId, scope.branchId, deliveryRecordId]
    );
    return row ? toAuthorizedReceiver(row) : null;
  }

  /**
   * Records the verified receiver and returns its id.
   *
   * `verified_at` is left to the column default (`now()`) rather than accepted from a
   * caller, because `sal.guard_authorized_receiver` (M-dlv-2) evaluates the party
   * role's validity window **against that exact value**: a caller who could choose
   * `verified_at` could choose a moment at which an expired authorisation was still
   * valid, which is the whole point of the guard being time-aware.
   *
   * `identity_evidence_document_version_id` is stored as a reference only. Nothing in
   * this module reads the document's content, and the row is gated whole by
   * `sal.delivery.view` in the RLS policy.
   */
  public async insertReceiver(
    db: DbHandle,
    scope: DeliveryScope,
    input: {
      readonly deliveryRecordId: string;
      readonly receiverPartnerId: string;
      readonly identityEvidenceDocumentVersionId: string | null;
    }
  ): Promise<string> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO sal.authorized_receivers
         (tenant_id, company_id, branch_id, delivery_record_id, receiver_partner_id,
          identity_evidence_document_version_id, verified_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING id`,
      [
        context.principal.tenantId,
        scope.companyId,
        scope.branchId,
        input.deliveryRecordId,
        input.receiverPartnerId,
        input.identityEvidenceDocumentVersionId,
        context.principal.userId,
      ]
    );
    if (!row) {
      throw new Error('delivery: INSERT INTO sal.authorized_receivers returned no id');
    }
    return row.id;
  }

  // -------------------------------------------------------------------------
  // Checklist templates (P1-31 prerequisite P-9, PPD-12)
  //
  // Both tables held SELECT, INSERT and UPDATE grants and an INSERT and an UPDATE
  // policy from the day they landed in P1-11, and no code anywhere in `apps/api`
  // had ever written either one: the only method that touched them was
  // `findTemplateItem`, a per-item existence probe for the write path. So the
  // statements below use grants that already exist, and this slice adds no
  // migration.
  //
  // NEITHER TABLE HAS A DELETE GRANT OR A DELETE POLICY, for either application
  // role. Removal is therefore a soft delete performed by UPDATE — the shape
  // `tech.technician_skills` already uses — and a hard delete is refused by the
  // database however it is asked for.
  // -------------------------------------------------------------------------

  /**
   * The checklist templates visible to the caller, newest first.
   *
   * Predicated on `tenant_id` only, with no company term, and that is deliberate:
   * a caller may configure more than one company, the path names none, and
   * `sel_delivery_checklist_templates_scope` narrows to
   * `iam.allowed_company_ids()` — so the set is exactly the templates of the
   * companies the caller's grants reach. Every row carries its own `companyId`, so
   * a reader can tell which company a template belongs to rather than inferring it.
   *
   * Soft-deleted rows are excluded. Inactive ones are NOT: a configuration list
   * that hid retired templates would make the restore command unreachable, which
   * is the trap `apt.catalogue-source-channel-status-set` records for its own
   * catalogue.
   */
  public async listTemplates(
    db: DbHandle,
    request: PageRequest
  ): Promise<Page<ChecklistTemplateRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId];
    const keyset = keysetFragment(
      request,
      { sort: 't.created_at', id: 't.id' },
      CHECKLIST_TEMPLATE_ORDER,
      values.length + 1
    );
    const result = await this.run<ChecklistTemplateSql & { sort_value: string }>(
      db,
      `SELECT t.id, t.company_id, t.template_code, t.name, t.status, t.record_version,
              ${cursorTimestamp('t.created_at')} AS sort_value
         FROM sal.delivery_checklist_templates t
        WHERE t.tenant_id = $1 AND t.deleted_at IS NULL
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        // `created_at` is not published on the row, so the cursor value cannot be
        // re-derived from the response — which is what `buildPageWithCursors` is for.
        item: toChecklistTemplate(row),
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      CHECKLIST_TEMPLATE_ORDER
    );
  }

  /**
   * One template, or null for absent-and-out-of-scope alike.
   *
   * Predicated on `tenant_id` and `id` only, for the reason `findDelivery` states:
   * a lookup addressed solely by id has no company to narrow by yet — the row is
   * where the company comes from, and every command over it re-authorizes against
   * that company the moment it is read.
   */
  public async findTemplate(
    db: DbHandle,
    templateId: string
  ): Promise<ChecklistTemplateRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ChecklistTemplateSql>(
      db,
      `SELECT id, company_id, template_code, name, status, record_version
         FROM sal.delivery_checklist_templates
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, templateId]
    );
    return row ? toChecklistTemplate(row) : null;
  }

  /**
   * Every live item of one template, in checklist order.
   *
   * **Deliberately unpaged**, on the `dia.template-version-item-list` precedent:
   * the order IS the checklist, so a page boundary would cut a checklist in half.
   * The set is bounded by authoring rather than by a constraint, and the ordering
   * is `(sort_order, item_code)` — `sort_order` alone is not unique, so the code
   * breaks the tie and the answer is stable between two reads.
   */
  public async listTemplateItems(
    db: DbHandle,
    companyId: string,
    templateId: string
  ): Promise<readonly ChecklistTemplateItemRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<ChecklistTemplateItemSql>(
      db,
      `SELECT id, company_id, template_id, item_code, label, is_mandatory, sort_order,
              record_version
         FROM sal.delivery_checklist_template_items
        WHERE tenant_id = $1 AND company_id = $2 AND template_id = $3 AND deleted_at IS NULL
        ORDER BY sort_order, item_code`,
      [context.principal.tenantId, companyId, templateId]
    );
    return result.rows.map(toChecklistTemplateItem);
  }

  /**
   * Creates a template header. The caller supplies the company; nothing defaults it.
   *
   * `status` is not accepted: the column defaults to `active` and a template born
   * `inactive` is one whose items gate nothing while it cannot be offered either.
   * A duplicate `template_code` raises `23505` on
   * `uq_delivery_checklist_templates_code`, and a company outside the caller's own
   * tenant raises `23503` on `fk_delivery_checklist_templates_company`, whose
   * tenant half comes from the session context rather than from the request — so
   * the tenant boundary here is the foreign key, not a predicate this file writes.
   */
  public async insertTemplate(
    db: DbHandle,
    input: { readonly companyId: string; readonly templateCode: string; readonly name: string }
  ): Promise<ChecklistTemplateRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<ChecklistTemplateSql>(
      db,
      `INSERT INTO sal.delivery_checklist_templates
         (tenant_id, company_id, template_code, name, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, company_id, template_code, name, status, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.templateCode,
        input.name,
        context.principal.userId,
      ]
    );
    if (!row) {
      throw new Error('delivery: INSERT INTO sal.delivery_checklist_templates returned no row');
    }
    return toChecklistTemplate(row);
  }

  /** Creates one item on a template. `23505` is a duplicate `item_code` in it. */
  public async insertTemplateItem(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly templateId: string;
      readonly itemCode: string;
      readonly label: string;
      readonly isMandatory: boolean;
      readonly sortOrder: number;
    }
  ): Promise<ChecklistTemplateItemRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<ChecklistTemplateItemSql>(
      db,
      `INSERT INTO sal.delivery_checklist_template_items
         (tenant_id, company_id, template_id, item_code, label, is_mandatory, sort_order,
          created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, company_id, template_id, item_code, label, is_mandatory, sort_order,
                 record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.templateId,
        input.itemCode,
        input.label,
        input.isMandatory,
        input.sortOrder,
        context.principal.userId,
      ]
    );
    if (!row) {
      throw new Error(
        'delivery: INSERT INTO sal.delivery_checklist_template_items returned no row'
      );
    }
    return toChecklistTemplateItem(row);
  }

  /**
   * Renames a template under its expected version, or returns null.
   *
   * Null means the `record_version` predicate did not match. Every other reason for
   * zero rows — absent, another tenant's, soft-deleted — is excluded by the service
   * reading the row first, so the caller may report the concurrency loss and
   * nothing else. `record_version` is not computed as `expectedVersion + 1`: the
   * row the trigger produced is returned, so the next `If-Match` is the database's
   * answer rather than this module's assumption.
   */
  public async renameTemplate(
    db: DbHandle,
    companyId: string,
    templateId: string,
    expectedVersion: number,
    name: string
  ): Promise<ChecklistTemplateRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ChecklistTemplateSql>(
      db,
      `UPDATE sal.delivery_checklist_templates
          SET name = $5
        WHERE tenant_id = $1 AND company_id = $2 AND id = $3 AND deleted_at IS NULL
          AND record_version = $4
       RETURNING id, company_id, template_code, name, status, record_version`,
      [context.principal.tenantId, companyId, templateId, expectedVersion, name]
    );
    return row ? toChecklistTemplate(row) : null;
  }

  /** Activates or deactivates a template under its expected version, or returns null. */
  public async setTemplateStatus(
    db: DbHandle,
    companyId: string,
    templateId: string,
    expectedVersion: number,
    status: string
  ): Promise<ChecklistTemplateRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ChecklistTemplateSql>(
      db,
      `UPDATE sal.delivery_checklist_templates
          SET status = $5
        WHERE tenant_id = $1 AND company_id = $2 AND id = $3 AND deleted_at IS NULL
          AND record_version = $4
       RETURNING id, company_id, template_code, name, status, record_version`,
      [context.principal.tenantId, companyId, templateId, expectedVersion, status]
    );
    return row ? toChecklistTemplate(row) : null;
  }

  /**
   * Edits one item under its expected version, or returns null.
   *
   * The version compared is the ITEM's own `record_version`, never the template's.
   * A `null` in a patch field means "not supplied" and is applied by `COALESCE`, so
   * a request carrying only `label` cannot silently reset `is_mandatory` to its
   * default. `item_code` and `template_id` are absent from the statement:
   * `tg_delivery_checklist_template_items_immutable` freezes the template binding,
   * and a re-coded item would be a different item wearing the old one's identity —
   * every recorded result points at the row by id.
   */
  public async updateTemplateItem(
    db: DbHandle,
    companyId: string,
    itemId: string,
    expectedVersion: number,
    patch: {
      readonly label: string | null;
      readonly isMandatory: boolean | null;
      readonly sortOrder: number | null;
    }
  ): Promise<ChecklistTemplateItemRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ChecklistTemplateItemSql>(
      db,
      `UPDATE sal.delivery_checklist_template_items
          SET label = COALESCE($5, label),
              is_mandatory = COALESCE($6, is_mandatory),
              sort_order = COALESCE($7, sort_order)
        WHERE tenant_id = $1 AND company_id = $2 AND id = $3 AND deleted_at IS NULL
          AND record_version = $4
       RETURNING id, company_id, template_id, item_code, label, is_mandatory, sort_order,
                 record_version`,
      [
        context.principal.tenantId,
        companyId,
        itemId,
        expectedVersion,
        patch.label,
        patch.isMandatory,
        patch.sortOrder,
      ]
    );
    return row ? toChecklistTemplateItem(row) : null;
  }

  /**
   * Withdraws one item. Soft delete: recorded results stay readable.
   *
   * An UPDATE and not a DELETE, because there is no DELETE grant and no DELETE
   * policy on this table for any application role — and because
   * `fk_delivery_checklist_results_item` is `ON DELETE RESTRICT`, so a hard removal
   * would be refused by any item a handover has ever recorded an outcome for. The
   * checklist-result list read deliberately carries no `ti.deleted_at` predicate,
   * so a result recorded against a withdrawn item is still readable afterwards.
   *
   * `uq_delivery_checklist_template_items_code` is partial on `deleted_at IS NULL`,
   * so the code returns to the template and may be added again.
   */
  public async softDeleteTemplateItem(
    db: DbHandle,
    companyId: string,
    itemId: string
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE sal.delivery_checklist_template_items
          SET deleted_at = now(), deleted_by = $4
        WHERE tenant_id = $1 AND company_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [context.principal.tenantId, companyId, itemId, context.principal.userId]
    );
    return (result.rowCount ?? 0) === 1;
  }

  // -------------------------------------------------------------------------
  // Checklist
  // -------------------------------------------------------------------------

  /**
   * One template item, looked up in the COMPANY that owns it.
   *
   * There is no branch predicate because the table has no branch column — the RLS
   * policy has no branch clause either. The company predicate is the substantive
   * check the service needs: `fk_delivery_checklist_results_item` is
   * `(tenant_id, company_id, template_item_id)`, so recording a result against an
   * item belonging to a different company is refused as `23503` rather than
   * mis-scoped, and this read turns that into a caller-safe refusal first.
   */
  public async findTemplateItem(
    db: DbHandle,
    companyId: string,
    templateItemId: string
  ): Promise<ChecklistTemplateItemRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ChecklistTemplateItemSql>(
      db,
      `SELECT id, company_id, template_id, item_code, label, is_mandatory, sort_order,
              record_version
         FROM sal.delivery_checklist_template_items
        WHERE tenant_id = $1 AND company_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [context.principal.tenantId, companyId, templateItemId]
    );
    return row ? toChecklistTemplateItem(row) : null;
  }

  /**
   * The existing result for one item on one delivery, or null.
   *
   * **No `deleted_at` predicate**, and unlike `findReceiver` the reason is the
   * constraint rather than the gate: `uq_delivery_checklist_results_item` is
   * non-partial, so a soft-deleted result still occupies the slot and a second INSERT
   * still raises `23505`. The service needs to see that row to answer "was this
   * already recorded" honestly; hiding it would turn a knowable duplicate into an
   * aborted transaction. The mandatory-gate mirror below DOES filter `deleted_at`,
   * because `sal.complete_delivery` does.
   */
  public async findChecklistResult(
    db: DbHandle,
    scope: DeliveryScope,
    deliveryRecordId: string,
    templateItemId: string
  ): Promise<ChecklistResultRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ChecklistResultSql>(
      db,
      `SELECT id, company_id, branch_id, delivery_record_id, template_item_id, outcome,
              waiver_reason, recorded_by, record_version
         FROM sal.delivery_checklist_results
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND delivery_record_id = $4 AND template_item_id = $5`,
      [
        context.principal.tenantId,
        scope.companyId,
        scope.branchId,
        deliveryRecordId,
        templateItemId,
      ]
    );
    return row ? toChecklistResult(row) : null;
  }

  /**
   * Every checklist result recorded against one delivery, newest first (P1-31 P-4).
   *
   * ## Why this is a new query rather than a published one
   *
   * `findChecklistResult` above is addressed by `(delivery, templateItemId)` and
   * answers "was this ONE item already recorded" for the write path. Publishing it
   * as it stands would hand a screen a read it cannot address: the checklist
   * TEMPLATE has no HTTP surface at all (**PPD-12** / prerequisite P-9), so no
   * caller can discover a `template_item_id` to put in the path. The set read is
   * therefore the smallest read that makes recorded results reachable, and it
   * reuses `toChecklistResult` — one wire contract for this row, not two.
   *
   * ## The predicates
   *
   * `company_id` AND `branch_id` are bound because the caller has already read the
   * delivery row they came from. `ix_delivery_checklist_results_delivery` is
   * `(tenant_id, company_id, branch_id, delivery_record_id)` and leads on exactly
   * those four.
   *
   * **`deleted_at IS NULL` IS filtered here**, unlike `findChecklistResult`. The two
   * reads answer different questions and the difference is deliberate: the write
   * path must see a soft-deleted row because `uq_delivery_checklist_results_item` is
   * non-partial and that row still occupies the slot, whereas this read answers
   * "what has been recorded", and a withdrawn result is not a recorded one. The
   * mandatory-gap mirror filters it for the same reason `sal.complete_delivery`
   * does.
   */
  public async listChecklistResults(
    db: DbHandle,
    scope: DeliveryScope,
    deliveryRecordId: string,
    request: PageRequest
  ): Promise<Page<ChecklistResultDetailRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      scope.companyId,
      scope.branchId,
      deliveryRecordId,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'r.created_at', id: 'r.id' },
      CHECKLIST_RESULT_ORDER,
      values.length + 1
    );
    // An INNER join, and it is TOTAL: `fk_delivery_checklist_results_item` is
    // `(tenant_id, company_id, template_item_id) ON DELETE RESTRICT`, so the item
    // row cannot be missing. It deliberately carries NO `ti.deleted_at` predicate —
    // the gap mirror filters that because `sal.complete_delivery` does, but a result
    // recorded against an item that was later soft-deleted is still a recorded fact
    // and dropping it here would hide it.
    const result = await this.run<
      ChecklistResultSql & { item_code: string; label: string; sort_value: string }
    >(
      db,
      `SELECT r.id, r.company_id, r.branch_id, r.delivery_record_id, r.template_item_id,
              r.outcome, r.waiver_reason, r.recorded_by, r.record_version,
              ti.item_code, ti.label,
              ${cursorTimestamp('r.created_at')} AS sort_value
         FROM sal.delivery_checklist_results r
         JOIN sal.delivery_checklist_template_items ti
           ON ti.tenant_id = r.tenant_id AND ti.company_id = r.company_id
          AND ti.id = r.template_item_id
        WHERE r.tenant_id = $1 AND r.company_id = $2 AND r.branch_id = $3
          AND r.delivery_record_id = $4 AND r.deleted_at IS NULL
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: { ...toChecklistResult(row), itemCode: row.item_code, label: row.label },
        // `created_at` is not published on the row, so the cursor value cannot be
        // re-derived from the response — which is precisely what
        // `buildPageWithCursors` exists for.
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      CHECKLIST_RESULT_ORDER
    );
  }

  /**
   * Records one checklist result and returns its id.
   *
   * `recorded_by` and `created_by` are both the session actor. They are separate
   * columns in the DDL and are set to the same value here because this module offers
   * no path on which a result is entered on someone else's behalf; inventing an
   * `onBehalfOf` parameter would create an attribution a caller could choose.
   *
   * The `(outcome = 'waived') = (waiver_reason IS NOT NULL)` biconditional is
   * `ck_delivery_checklist_results_waiver` and is asserted by
   * `assertChecklistResultShape` before this call, so a violation here would be a
   * `23514` the caller could not act on.
   */
  public async insertChecklistResult(
    db: DbHandle,
    scope: DeliveryScope,
    input: {
      readonly deliveryRecordId: string;
      readonly templateItemId: string;
      readonly outcome: string;
      readonly waiverReason: string | null;
    }
  ): Promise<string> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO sal.delivery_checklist_results
         (tenant_id, company_id, branch_id, delivery_record_id, template_item_id, outcome,
          waiver_reason, recorded_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING id`,
      [
        context.principal.tenantId,
        scope.companyId,
        scope.branchId,
        input.deliveryRecordId,
        input.templateItemId,
        input.outcome,
        input.waiverReason,
        context.principal.userId,
      ]
    );
    if (!row) {
      throw new Error('delivery: INSERT INTO sal.delivery_checklist_results returned no id');
    }
    return row.id;
  }

  /**
   * The mandatory-checklist shortfall, transcribed from `sal.complete_delivery`.
   *
   * Three details of the primitive's predicate are counter-intuitive and are reproduced
   * rather than corrected:
   *
   *  1. **The item scan is COMPANY-scoped, not template-scoped.** The function counts
   *     every `is_mandatory` item in the delivery's company, across *all* templates,
   *     and never resolves which template applies to this delivery — because
   *     `sal.delivery_records` carries no `template_id`. So configuring a second
   *     template with a mandatory item blocks every delivery in that company until
   *     each one records a result for it. That is the deployed behaviour; a
   *     template-scoped mirror would report eligible and then be refused at the call.
   *  2. **Items filter `deleted_at IS NULL` and so do results.** A soft-deleted item
   *     stops being mandatory; a soft-deleted result stops satisfying its item.
   *  3. **Only an ACTIVE, non-deleted TEMPLATE is in force.** The join onto
   *     `sal.delivery_checklist_templates` is new in P1-31 P-9b (migration
   *     20260909090000, closing CC-14) and lands in the same commit as the
   *     primitive's. Before it, deactivating or soft-deleting a template withdrew
   *     nothing from the gate and the operator's only remedy was withdrawing each
   *     item. The join is on `(tenant_id, company_id, id)` — the scoped unique key
   *     `uq_delivery_checklist_templates_scope_id` — so it cannot cross a tenant or a
   *     company, and it is INNER because the item's foreign key makes the template
   *     reference mandatory.
   *
   * The company-wide scan therefore stays exactly as wide as it was; what narrowed is
   * which templates count as in force. The standing rule is unchanged and is the reason
   * this file moves in lockstep with the migration rather than ahead of it: the mirror
   * must never be BETTER than the primitive, or the eligibility read reports a delivery
   * eligible that `sal.complete_delivery` then refuses with 23514.
   *
   * The count is the gate. The sample is `LIMIT`-bounded so a company with a large
   * mandatory template cannot turn a refusal message into an unbounded response.
   */
  public async mandatoryChecklistGaps(
    db: DbHandle,
    scope: DeliveryScope,
    deliveryRecordId: string
  ): Promise<ChecklistGapReport> {
    const context = this.assertContext(db);
    const values = [context.principal.tenantId, scope.companyId, scope.branchId, deliveryRecordId];
    const source = `sal.delivery_checklist_template_items ti
              JOIN sal.delivery_checklist_templates t
                ON t.tenant_id = ti.tenant_id AND t.company_id = ti.company_id
               AND t.id = ti.template_id`;
    const predicate = `ti.tenant_id = $1 AND ti.company_id = $2 AND ti.is_mandatory
          AND ti.deleted_at IS NULL
          AND t.status = 'active' AND t.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM sal.delivery_checklist_results r
             WHERE r.tenant_id = $1 AND r.company_id = $2 AND r.branch_id = $3
               AND r.delivery_record_id = $4 AND r.template_item_id = ti.id
               AND r.outcome IN ('passed', 'waived') AND r.deleted_at IS NULL)`;

    const counted = await this.runOne<{ missing: number }>(
      db,
      `SELECT count(*)::int AS missing
         FROM ${source}
        WHERE ${predicate}`,
      values
    );
    const missingCount = counted?.missing ?? 0;
    if (missingCount === 0) return { missingCount: 0, sample: [] };

    const sample = await this.run<ChecklistGapSql>(
      db,
      `SELECT ti.id AS template_item_id, ti.template_id, ti.item_code, ti.label
         FROM ${source}
        WHERE ${predicate}
        ORDER BY ti.template_id, ti.sort_order, ti.item_code
        LIMIT $5`,
      [...values, GAP_SAMPLE_LIMIT]
    );
    return { missingCount, sample: sample.rows.map(toChecklistGap) };
  }

  // -------------------------------------------------------------------------
  // Signatures
  // -------------------------------------------------------------------------

  /**
   * Whether any signature exists for this delivery.
   *
   * An EXISTS probe rather than a list, for two reasons. The fact the gate needs is
   * presence: `sal.complete_delivery` asks `IF NOT EXISTS (SELECT 1 …)` and nothing
   * more. And `sal.delivery_signatures` has no unique constraint on
   * `(delivery_record_id, signer_role)` — corrections are made by appending — so the
   * set is unbounded and listing it to count it would be an unbounded read to answer
   * a boolean.
   */
  public async hasSignature(
    db: DbHandle,
    scope: DeliveryScope,
    deliveryRecordId: string
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ present: boolean }>(
      db,
      `SELECT EXISTS (
                SELECT 1
                  FROM sal.delivery_signatures
                 WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
                   AND delivery_record_id = $4
              ) AS present`,
      [context.principal.tenantId, scope.companyId, scope.branchId, deliveryRecordId]
    );
    return row?.present === true;
  }

  /**
   * The signature already bound for this exact `(delivery, role, document version)`
   * triple, or null.
   *
   * This is a **replay probe, not a uniqueness check**: the schema permits many
   * signatures per delivery and even many per role, because the table's own comment
   * says corrections are made by appending a new row. So a second signature for the
   * same role with a DIFFERENT document is a legitimate correction, while the same
   * role with the SAME document is a retried request — and only the identical triple
   * may be answered idempotently.
   */
  public async findSignature(
    db: DbHandle,
    scope: DeliveryScope,
    input: {
      readonly deliveryRecordId: string;
      readonly signerRole: string;
      readonly signatureDocumentVersionId: string;
    }
  ): Promise<DeliverySignatureRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<DeliverySignatureSql>(
      db,
      `SELECT id, company_id, branch_id, delivery_record_id, signer_role,
              signature_document_version_id, signed_at
         FROM sal.delivery_signatures
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND delivery_record_id = $4 AND signer_role = $5
          AND signature_document_version_id = $6
        ORDER BY signed_at DESC
        LIMIT 1`,
      [
        context.principal.tenantId,
        scope.companyId,
        scope.branchId,
        input.deliveryRecordId,
        input.signerRole,
        input.signatureDocumentVersionId,
      ]
    );
    return row ? toDeliverySignature(row) : null;
  }

  /**
   * Every signature bound to one delivery, newest first (P1-31 P-4).
   *
   * ## Why this is a new query rather than a published one
   *
   * `findSignature` above is a REPLAY PROBE addressed by the exact
   * `(delivery, signerRole, signatureDocumentVersionId)` triple, so a caller must
   * already hold the document-version id to use it — which is the unrecoverable
   * identifier problem restated, not a read of the signatures. `hasSignature` is a
   * boolean. Neither answers "which signatures does this delivery carry", which is
   * what **P-4** requires and what the delivery document (FE-007) is composed from.
   * This reuses `toDeliverySignature`: no second mapper, no second wire contract.
   *
   * ## Paged, because the set has no ceiling
   *
   * There is no unique constraint on `(delivery_record_id, signer_role)` — the
   * table's comment records that corrections are made by appending — so a delivery
   * may carry any number of rows and an unbounded SELECT is not available. Keyset,
   * so the page boundary is stable while rows are appended underneath it.
   *
   * **No `deleted_at` predicate, and none is possible**: the table has SELECT and
   * INSERT grants only and carries no `deleted_at` column at all. A signature can
   * never be edited or withdrawn, which is the property that makes the document
   * reference worth binding.
   *
   * The row carries `signatureDocumentVersionId` and **never bytes**. Fetching that
   * document is not offered here and is not offered anywhere in this module.
   */
  public async listSignatures(
    db: DbHandle,
    scope: DeliveryScope,
    deliveryRecordId: string,
    request: PageRequest
  ): Promise<Page<DeliverySignatureRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      scope.companyId,
      scope.branchId,
      deliveryRecordId,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'signed_at', id: 'id' },
      SIGNATURE_ORDER,
      values.length + 1
    );
    const result = await this.run<DeliverySignatureSql & { sort_value: string }>(
      db,
      `SELECT id, company_id, branch_id, delivery_record_id, signer_role,
              signature_document_version_id, signed_at,
              ${cursorTimestamp('signed_at')} AS sort_value
         FROM sal.delivery_signatures
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND delivery_record_id = $4
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: toDeliverySignature(row),
        // NOT `row.signed_at.toISOString()`: `signed_at` defaults to `now()`, so
        // several signatures attached in one transaction share the value to the
        // microsecond and a millisecond-truncated cursor would skip them
        // (`P1-27-INT-006`).
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      SIGNATURE_ORDER
    );
  }

  /**
   * Appends one signature and returns the stored row.
   *
   * `signed_at` is the column default. The row binds a `shared.document_versions`
   * reference and carries no bytes; `sal.delivery_signatures` has INSERT and SELECT
   * grants only, so a signature can never be edited or withdrawn — which is the
   * property that makes the reference worth binding at all.
   */
  public async insertSignature(
    db: DbHandle,
    scope: DeliveryScope,
    input: {
      readonly deliveryRecordId: string;
      readonly signerRole: string;
      readonly signatureDocumentVersionId: string;
    }
  ): Promise<DeliverySignatureRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<DeliverySignatureSql>(
      db,
      `INSERT INTO sal.delivery_signatures
         (tenant_id, company_id, branch_id, delivery_record_id, signer_role,
          signature_document_version_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, company_id, branch_id, delivery_record_id, signer_role,
                 signature_document_version_id, signed_at`,
      [
        context.principal.tenantId,
        scope.companyId,
        scope.branchId,
        input.deliveryRecordId,
        input.signerRole,
        input.signatureDocumentVersionId,
        context.principal.userId,
      ]
    );
    if (!row) {
      throw new Error('delivery: INSERT INTO sal.delivery_signatures returned no row');
    }
    return toDeliverySignature(row);
  }

  // -------------------------------------------------------------------------
  // The protected completion primitive
  // -------------------------------------------------------------------------

  /**
   * Calls `sal.complete_delivery` and returns the final `veh.odometer_readings` id.
   *
   * Everything the handover atomically requires happens inside that function, under
   * the delivery row's own lock: the three gates (a verified receiver, no unsatisfied
   * mandatory checklist item, at least one signature), the odometer INSERT, the flip
   * to `delivered`, the `rec.custody_history` release row, and the `delivered` status
   * history row. It is idempotent — a delivery already `delivered` returns its
   * existing `final_odometer_reading_id` and writes nothing.
   *
   * **It checks no work-order state, no quality-control outcome, and no financial
   * balance.** The financial blocker in particular has no database enforcement of any
   * kind: if the composition in `DeliveryReadService` were deleted, this function
   * would hand over a vehicle against an unpaid issued invoice without complaint.
   * That gate is the application's alone, and the service calls it before it calls
   * this.
   *
   * `p_final_odometer_value` is `numeric`, so the value is bound as a STRING and cast
   * `$2::numeric` in SQL. It is never converted to a JavaScript number anywhere on
   * the path: `numeric` holds values IEEE-754 cannot represent, and a rounded
   * odometer reading is a wrong fact about a vehicle that a warranty term may later
   * be measured against.
   */
  public async completeDelivery(
    db: DbHandle,
    input: {
      readonly deliveryId: string;
      /** A decimal STRING. Never a `number`. */
      readonly finalOdometerValue: string;
      readonly odometerUnit: string;
    }
  ): Promise<string> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ odometer_reading_id: string }>(
      db,
      `SELECT sal.complete_delivery($1, $2::numeric, $3, $4) AS odometer_reading_id`,
      [input.deliveryId, input.finalOdometerValue, input.odometerUnit, context.correlationId]
    );
    const id = row?.odometer_reading_id;
    if (!id) {
      throw new Error('delivery: sal.complete_delivery returned no odometer reading id');
    }
    return id;
  }
}
