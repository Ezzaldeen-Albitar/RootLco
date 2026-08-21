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
 * ## There is no pagination in this file, and that is deliberate
 *
 * The delivery module registers six operations and not one of them is a list
 * (`docs/phase-1/phase-1-22/operation-inventory.md` §delivery). So no
 * `OrderingContract` is declared: an ordering contract exists to make a cursor
 * verifiable, and a cursor nothing issues is a contract nothing can honour. Where a
 * set could grow without bound — `sal.delivery_signatures` has no unique constraint
 * on `(delivery_record_id, signer_role)`, so one delivery may carry any number of
 * rows — the read is an EXISTS probe or a `LIMIT`-bounded sample, never an unbounded
 * SELECT.
 */
import { Repository } from '@/server/db/repository';
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
  /** `delivering_employee_id` — NOT NULL with **no** foreign key in the DDL. */
  readonly deliveringEmployeeId: string;
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
 * also no retrieval method: `shared.guard_document_version_transition` requires a
 * clean scan record to reach `accepted`, no scanner is provisioned, and
 * `DOWNLOADABLE_STATES` is `['accepted']` — so a download path would be a contract
 * that always fails (`P1-22-L-04`). The reference is returned; fetching it is not
 * offered.
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
// SQL shapes and mappers. snake_case in, camelCase out, one mapper per shape.
// ---------------------------------------------------------------------------

const DELIVERY_COLUMNS = `id, company_id, branch_id, work_order_id, reception_visit_id,
  vehicle_id, delivering_employee_id, status, delivered_at, final_odometer_reading_id,
  idempotency_key, record_version`;

interface DeliveryRecordSql {
  id: string;
  company_id: string;
  branch_id: string;
  work_order_id: string;
  reception_visit_id: string;
  vehicle_id: string;
  delivering_employee_id: string;
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
   * Two details of the primitive's predicate are counter-intuitive and are reproduced
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
    const predicate = `ti.tenant_id = $1 AND ti.company_id = $2 AND ti.is_mandatory
          AND ti.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM sal.delivery_checklist_results r
             WHERE r.tenant_id = $1 AND r.company_id = $2 AND r.branch_id = $3
               AND r.delivery_record_id = $4 AND r.template_item_id = ti.id
               AND r.outcome IN ('passed', 'waived') AND r.deleted_at IS NULL)`;

    const counted = await this.runOne<{ missing: number }>(
      db,
      `SELECT count(*)::int AS missing
         FROM sal.delivery_checklist_template_items ti
        WHERE ${predicate}`,
      values
    );
    const missingCount = counted?.missing ?? 0;
    if (missingCount === 0) return { missingCount: 0, sample: [] };

    const sample = await this.run<ChecklistGapSql>(
      db,
      `SELECT ti.id AS template_item_id, ti.template_id, ti.item_code, ti.label
         FROM sal.delivery_checklist_template_items ti
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
