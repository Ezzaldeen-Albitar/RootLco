/**
 * `quo` SQL (Phase 1-20, P1-20-BE-007…013).
 *
 * ## Where the money is calculated
 *
 * In `insertItem`, in SQL, in `numeric` — never in TypeScript. The two computed
 * columns are written as the *same expressions* the CHECK constraints validate:
 *
 * ```
 * captured_tax_amount = round(((unit * qty) - discount) * rate, 4)
 * captured_line_total = round(((unit * qty) - discount) + tax_amount, 4)
 * ```
 *
 * That is deliberate and is the core control of P1-20-BE-014. If the application
 * computed these and sent them as literals, a TypeScript rounding difference
 * would be caught by `ck_quotation_items_tax_amount` as an opaque constraint
 * violation. By computing them in the statement, PostgreSQL is both the engine
 * and the validator, and the two cannot disagree.
 *
 * The document totals are not written here at all: `quo.issue_revision` computes
 * them by SUM over the live items when the revision is issued.
 *
 * ## Lock order
 *
 * **Parent before children, always** — the same rule `work-order` follows. Every
 * command path locks `quo.quotations` first, then the revision, then items. Both
 * `quo.issue_revision` and `quo.record_item_decision` also take
 * `SELECT … FOR UPDATE` on the parent quotation internally, so a caller that
 * locked in the other order would deadlock against them.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface QuotationRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly quotationNumber: string;
  readonly currencyCode: string;
  readonly payerPartnerRef: string | null;
  readonly currentRevisionId: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

export interface RevisionRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly quotationId: string;
  readonly revisionNumber: number;
  readonly status: string;
  readonly currencyCode: string;
  readonly issuedAt: Date | null;
  readonly expiresAt: Date | null;
  /** All four are `numeric(18,4)` decimal STRINGS. */
  readonly capturedSubtotal: string;
  readonly capturedDiscountTotal: string;
  readonly capturedTaxTotal: string;
  readonly capturedGrandTotal: string;
  readonly recordVersion: number;
}

export interface ItemRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly quotationRevisionId: string;
  readonly lineNumber: number;
  readonly itemKind: string;
  readonly serviceId: string | null;
  readonly itemRef: string | null;
  readonly sourceServiceLineRef: string | null;
  readonly sourceRequiredPartRef: string | null;
  readonly priceRuleRef: string | null;
  readonly description: string | null;
  readonly currencyCode: string;
  /** Money and quantity columns are decimal STRINGS. */
  readonly capturedUnitPrice: string;
  readonly capturedQuantity: string;
  readonly capturedDiscount: string;
  readonly capturedTaxRate: string;
  readonly capturedTaxAmount: string;
  readonly capturedLineTotal: string;
  readonly recordVersion: number;
}

export interface DecisionRow {
  readonly id: string;
  readonly quotationRevisionId: string;
  readonly quotationItemId: string;
  readonly decision: string;
  readonly decidedBy: string;
  readonly decisionChannel: string;
  readonly decidedAt: Date;
  readonly evidenceRef: string | null;
}

export interface EvidenceRow {
  readonly id: string;
  readonly approvalDecisionId: string;
  readonly evidenceKind: string;
  readonly documentVersionId: string | null;
  readonly referenceNote: string | null;
}

/** Counts used to fold per-item decisions into a quotation-level outcome. */
export interface DecisionTally {
  readonly itemCount: number;
  readonly approvedCount: number;
  readonly rejectedCount: number;
}

export interface NewItemInput {
  readonly lineNumber: number;
  readonly itemKind: string;
  readonly serviceId: string | null;
  readonly itemRef: string | null;
  readonly sourceServiceLineRef: string | null;
  readonly sourceRequiredPartRef: string | null;
  readonly priceRuleRef: string | null;
  readonly description: string | null;
  readonly currencyCode: string;
  /** All decimal STRINGS, bound as parameters and cast to `numeric` in SQL. */
  readonly unitPrice: string;
  readonly quantity: string;
  readonly discount: string;
  readonly taxRate: string;
}

const QUOTATION_COLUMNS = `id, company_id, branch_id, work_order_id, quotation_number,
       currency_code, payer_partner_ref, current_revision_id, status, record_version`;

const REVISION_COLUMNS = `id, company_id, branch_id, quotation_id, revision_number, status,
       currency_code, issued_at, expires_at,
       captured_subtotal::text AS captured_subtotal,
       captured_discount_total::text AS captured_discount_total,
       captured_tax_total::text AS captured_tax_total,
       captured_grand_total::text AS captured_grand_total,
       record_version`;

const ITEM_COLUMNS = `id, company_id, branch_id, quotation_revision_id, line_number, item_kind,
       service_id, item_ref, source_service_line_ref, source_required_part_ref, price_rule_ref,
       description, currency_code,
       captured_unit_price::text AS captured_unit_price,
       captured_quantity::text AS captured_quantity,
       captured_discount::text AS captured_discount,
       captured_tax_rate::text AS captured_tax_rate,
       captured_tax_amount::text AS captured_tax_amount,
       captured_line_total::text AS captured_line_total,
       record_version`;

interface QuotationSql {
  id: string;
  company_id: string;
  branch_id: string;
  work_order_id: string;
  quotation_number: string;
  currency_code: string;
  payer_partner_ref: string | null;
  current_revision_id: string | null;
  status: string;
  record_version: number;
}

interface RevisionSql {
  id: string;
  company_id: string;
  branch_id: string;
  quotation_id: string;
  revision_number: number;
  status: string;
  currency_code: string;
  issued_at: Date | null;
  expires_at: Date | null;
  captured_subtotal: string;
  captured_discount_total: string;
  captured_tax_total: string;
  captured_grand_total: string;
  record_version: number;
}

interface ItemSql {
  id: string;
  company_id: string;
  branch_id: string;
  quotation_revision_id: string;
  line_number: number;
  item_kind: string;
  service_id: string | null;
  item_ref: string | null;
  source_service_line_ref: string | null;
  source_required_part_ref: string | null;
  price_rule_ref: string | null;
  description: string | null;
  currency_code: string;
  captured_unit_price: string;
  captured_quantity: string;
  captured_discount: string;
  captured_tax_rate: string;
  captured_tax_amount: string;
  captured_line_total: string;
  record_version: number;
}

const toQuotation = (row: QuotationSql): QuotationRow => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  workOrderId: row.work_order_id,
  quotationNumber: row.quotation_number,
  currencyCode: row.currency_code,
  payerPartnerRef: row.payer_partner_ref,
  currentRevisionId: row.current_revision_id,
  status: row.status,
  recordVersion: row.record_version,
});

const toRevision = (row: RevisionSql): RevisionRow => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  quotationId: row.quotation_id,
  revisionNumber: row.revision_number,
  status: row.status,
  currencyCode: row.currency_code,
  issuedAt: row.issued_at,
  expiresAt: row.expires_at,
  capturedSubtotal: row.captured_subtotal,
  capturedDiscountTotal: row.captured_discount_total,
  capturedTaxTotal: row.captured_tax_total,
  capturedGrandTotal: row.captured_grand_total,
  recordVersion: row.record_version,
});

const toItem = (row: ItemSql): ItemRow => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  quotationRevisionId: row.quotation_revision_id,
  lineNumber: row.line_number,
  itemKind: row.item_kind,
  serviceId: row.service_id,
  itemRef: row.item_ref,
  sourceServiceLineRef: row.source_service_line_ref,
  sourceRequiredPartRef: row.source_required_part_ref,
  priceRuleRef: row.price_rule_ref,
  description: row.description,
  currencyCode: row.currency_code,
  capturedUnitPrice: row.captured_unit_price,
  capturedQuantity: row.captured_quantity,
  capturedDiscount: row.captured_discount,
  capturedTaxRate: row.captured_tax_rate,
  capturedTaxAmount: row.captured_tax_amount,
  capturedLineTotal: row.captured_line_total,
  recordVersion: row.record_version,
});

export class QuotationRepository extends Repository {
  protected readonly module = 'quotation';

  // ---- Reads ---------------------------------------------------------------

  /**
   * The server's business date, as `YYYY-MM-DD`.
   *
   * Read from the database rather than from the Node process clock so that the
   * date used to resolve a price is the same clock `svc.resolve_price`,
   * `now()`-based expiry and the effective-range predicates all use. A caller
   * cannot supply it: an attacker-chosen `asOf` would select a price from a
   * period the tenant is not trading in.
   */
  public async businessDate(db: DbHandle): Promise<string> {
    const row = await this.runOne<{ business_date: string }>(
      db,
      `SELECT current_date::text AS business_date`
    );
    if (row === null) {
      throw new Error('quotation: could not read the server business date');
    }
    return row.business_date;
  }

  public async findQuotation(db: DbHandle, quotationId: string): Promise<QuotationRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<QuotationSql>(
      db,
      `SELECT ${QUOTATION_COLUMNS} FROM quo.quotations
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, quotationId]
    );
    return row ? toQuotation(row) : null;
  }

  /**
   * Locks the parent quotation. **Every command path calls this first.**
   *
   * `quo.issue_revision` and `quo.record_item_decision` both take the same lock
   * internally, so acquiring it here first keeps one consistent order and cannot
   * deadlock against them.
   */
  public async lockQuotation(db: DbHandle, quotationId: string): Promise<QuotationRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<QuotationSql>(
      db,
      `SELECT ${QUOTATION_COLUMNS} FROM quo.quotations
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, quotationId]
    );
    return row ? toQuotation(row) : null;
  }

  public async findRevision(db: DbHandle, revisionId: string): Promise<RevisionRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<RevisionSql>(
      db,
      `SELECT ${REVISION_COLUMNS} FROM quo.quotation_revisions
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, revisionId]
    );
    return row ? toRevision(row) : null;
  }

  /** Locks a revision. Callers must already hold the parent quotation's lock. */
  public async lockRevision(db: DbHandle, revisionId: string): Promise<RevisionRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<RevisionSql>(
      db,
      `SELECT ${REVISION_COLUMNS} FROM quo.quotation_revisions
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, revisionId]
    );
    return row ? toRevision(row) : null;
  }

  public async listRevisions(db: DbHandle, quotationId: string): Promise<readonly RevisionRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<RevisionSql>(
      db,
      `SELECT ${REVISION_COLUMNS} FROM quo.quotation_revisions
        WHERE tenant_id = $1 AND quotation_id = $2 AND deleted_at IS NULL
        ORDER BY revision_number DESC`,
      [context.principal.tenantId, quotationId]
    );
    return result.rows.map(toRevision);
  }

  public async listItems(db: DbHandle, revisionId: string): Promise<readonly ItemRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<ItemSql>(
      db,
      `SELECT ${ITEM_COLUMNS} FROM quo.quotation_items
        WHERE tenant_id = $1 AND quotation_revision_id = $2 AND deleted_at IS NULL
        ORDER BY line_number`,
      [context.principal.tenantId, revisionId]
    );
    return result.rows.map(toItem);
  }

  public async findItem(db: DbHandle, itemId: string): Promise<ItemRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ItemSql>(
      db,
      `SELECT ${ITEM_COLUMNS} FROM quo.quotation_items
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, itemId]
    );
    return row ? toItem(row) : null;
  }

  /**
   * Counts items and their decisions for one revision, in one statement.
   *
   * One statement rather than three so the three numbers describe the same
   * instant — separate queries could straddle a concurrent decision and produce
   * a tally that never actually existed.
   */
  public async tallyDecisions(db: DbHandle, revisionId: string): Promise<DecisionTally> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      item_count: string;
      approved_count: string;
      rejected_count: string;
    }>(
      db,
      `SELECT count(i.id)::text AS item_count,
              count(d.id) FILTER (WHERE d.decision = 'approved')::text AS approved_count,
              count(d.id) FILTER (WHERE d.decision = 'rejected')::text AS rejected_count
         FROM quo.quotation_items i
         LEFT JOIN quo.approval_decisions d
           ON d.tenant_id = i.tenant_id AND d.quotation_item_id = i.id
        WHERE i.tenant_id = $1 AND i.quotation_revision_id = $2 AND i.deleted_at IS NULL`,
      [context.principal.tenantId, revisionId]
    );
    return {
      itemCount: row ? Number.parseInt(row.item_count, 10) : 0,
      approvedCount: row ? Number.parseInt(row.approved_count, 10) : 0,
      rejectedCount: row ? Number.parseInt(row.rejected_count, 10) : 0,
    };
  }

  // ---- Writes --------------------------------------------------------------

  /**
   * Creates a quotation in `draft`.
   *
   * `work_order_id` is NOT NULL in the schema, and `company_id`/`branch_id` are
   * taken from the work order by the caller rather than from the request — a
   * client-supplied branch would be an authorization bypass.
   */
  public async insertQuotation(
    db: DbHandle,
    input: {
      companyId: string;
      branchId: string;
      workOrderId: string;
      quotationNumber: string;
      currencyCode: string;
      payerPartnerRef: string | null;
    }
  ): Promise<QuotationRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<QuotationSql>(
      db,
      `INSERT INTO quo.quotations
         (tenant_id, company_id, branch_id, work_order_id, quotation_number, currency_code,
          payer_partner_ref, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8)
       RETURNING ${QUOTATION_COLUMNS}`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.workOrderId,
        input.quotationNumber,
        input.currencyCode,
        input.payerPartnerRef,
        context.principal.userId,
      ]
    );
    if (row === null) {
      throw new Error('quotation: insert returned no row');
    }
    return toQuotation(row);
  }

  /**
   * Creates the next revision for a quotation, in `draft`.
   *
   * The revision number is `MAX + 1` computed in the same statement, under the
   * parent's lock. `uq_quotation_revisions_number` is the backstop: two
   * concurrent callers that somehow both read the same maximum collide on the
   * unique index rather than both succeeding.
   *
   * The currency is copied from the parent quotation, not accepted from the
   * caller — `quo.guard_quotation_item` then forces every item to match it, so a
   * mixed-currency revision is structurally impossible.
   */
  public async insertRevision(
    db: DbHandle,
    quotation: { id: string; companyId: string; branchId: string; currencyCode: string }
  ): Promise<RevisionRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<RevisionSql>(
      db,
      `INSERT INTO quo.quotation_revisions
         (tenant_id, company_id, branch_id, quotation_id, revision_number, status,
          currency_code, created_by)
       SELECT $1, $2, $3, $4,
              COALESCE(MAX(r.revision_number), 0) + 1,
              'draft', $5, $6
         FROM quo.quotation_revisions r
        WHERE r.tenant_id = $1 AND r.quotation_id = $4
       RETURNING ${REVISION_COLUMNS}`,
      [
        context.principal.tenantId,
        quotation.companyId,
        quotation.branchId,
        quotation.id,
        quotation.currencyCode,
        context.principal.userId,
      ]
    );
    if (row === null) {
      throw new Error('quotation: revision insert returned no row');
    }
    return toRevision(row);
  }

  /**
   * Inserts one line, with **PostgreSQL computing the money**.
   *
   * `captured_tax_amount` and `captured_line_total` are written as the exact
   * expressions `ck_quotation_items_tax_amount` and `ck_quotation_items_line_total`
   * validate. No amount is computed in TypeScript, so the engine and the
   * validator are the same thing and cannot disagree.
   *
   * Each parameter is cast to its **column's** precision and scale, not to bare
   * `numeric`. The CHECK constraints re-evaluate against the values as STORED, so
   * an input carrying more decimal places than its column would be rounded on
   * storage while the computed tax used the unrounded figure — and the row would
   * be rejected by its own constraint with an opaque message. `Decimal` already
   * refuses over-scale input at the boundary; this makes the guarantee
   * structural rather than dependent on that check staying in place.
   *
   * The tax base `(unit * qty) - discount` is deliberately NOT rounded before
   * use, because the constraint does not round it either.
   */
  public async insertItem(
    db: DbHandle,
    revision: { id: string; companyId: string; branchId: string },
    item: NewItemInput
  ): Promise<ItemRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<ItemSql>(
      db,
      `INSERT INTO quo.quotation_items
         (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind,
          service_id, item_ref, source_service_line_ref, source_required_part_ref,
          price_rule_ref, description, currency_code,
          captured_unit_price, captured_quantity, captured_discount, captured_tax_rate,
          captured_tax_amount, captured_line_total, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14::numeric(18,4), $15::numeric(12,3), $16::numeric(18,4), $17::numeric(9,6),
               round((($14::numeric(18,4) * $15::numeric(12,3)) - $16::numeric(18,4))
                     * $17::numeric(9,6), 4),
               round((($14::numeric(18,4) * $15::numeric(12,3)) - $16::numeric(18,4))
                     + round((($14::numeric(18,4) * $15::numeric(12,3)) - $16::numeric(18,4))
                             * $17::numeric(9,6), 4), 4),
               $18)
       RETURNING ${ITEM_COLUMNS}`,
      [
        context.principal.tenantId,
        revision.companyId,
        revision.branchId,
        revision.id,
        item.lineNumber,
        item.itemKind,
        item.serviceId,
        item.itemRef,
        item.sourceServiceLineRef,
        item.sourceRequiredPartRef,
        item.priceRuleRef,
        item.description,
        item.currencyCode,
        item.unitPrice,
        item.quantity,
        item.discount,
        item.taxRate,
        context.principal.userId,
      ]
    );
    if (row === null) {
      throw new Error('quotation: item insert returned no row');
    }
    return toItem(row);
  }

  /**
   * Issues a revision through `quo.issue_revision`.
   *
   * The function does the whole job atomically: it verifies `draft`, refuses zero
   * items, recomputes all four totals by SUM, supersedes the previous issued
   * revision, repoints `current_revision_id`, and moves the quotation to
   * `active`. Reimplementing any of that here would be a second definition.
   */
  public async issueRevision(
    db: DbHandle,
    revisionId: string,
    expiresAt: Date | null
  ): Promise<void> {
    await this.run(db, `SELECT quo.issue_revision($1, $2)`, [revisionId, expiresAt]);
  }

  /**
   * Records one item decision through `quo.record_item_decision`.
   *
   * The function enforces that the item's revision is both the quotation's
   * `current_revision_id` and `issued`. It does **not** check expiry or
   * duplicates — the application does, before calling.
   */
  public async recordItemDecision(
    db: DbHandle,
    input: {
      itemId: string;
      decision: string;
      channel: string;
      evidenceRef: string | null;
    }
  ): Promise<string> {
    const row = await this.runOne<{ record_item_decision: string }>(
      db,
      `SELECT quo.record_item_decision($1, $2, $3, $4) AS record_item_decision`,
      [input.itemId, input.decision, input.channel, input.evidenceRef]
    );
    if (row === null) {
      throw new Error('quotation: record_item_decision returned no id');
    }
    return row.record_item_decision;
  }

  /** Appends immutable evidence to a decision. The table is INSERT/SELECT only. */
  public async insertEvidence(
    db: DbHandle,
    input: {
      companyId: string;
      branchId: string;
      approvalDecisionId: string;
      evidenceKind: string;
      documentVersionId: string | null;
      referenceNote: string | null;
    }
  ): Promise<EvidenceRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      approval_decision_id: string;
      evidence_kind: string;
      document_version_id: string | null;
      reference_note: string | null;
    }>(
      db,
      `INSERT INTO quo.approval_evidence
         (tenant_id, company_id, branch_id, approval_decision_id, evidence_kind,
          document_version_id, reference_note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, approval_decision_id, evidence_kind, document_version_id, reference_note`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.approvalDecisionId,
        input.evidenceKind,
        input.documentVersionId,
        input.referenceNote,
        context.principal.userId,
      ]
    );
    if (row === null) {
      throw new Error('quotation: evidence insert returned no row');
    }
    return {
      id: row.id,
      approvalDecisionId: row.approval_decision_id,
      evidenceKind: row.evidence_kind,
      documentVersionId: row.document_version_id,
      referenceNote: row.reference_note,
    };
  }

  /** Any existing decision for an item, used to refuse a conflicting second one. */
  public async findDecisionForItem(db: DbHandle, itemId: string): Promise<DecisionRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      quotation_revision_id: string;
      quotation_item_id: string;
      decision: string;
      decided_by: string;
      decision_channel: string;
      decided_at: Date;
      evidence_ref: string | null;
    }>(
      db,
      `SELECT id, quotation_revision_id, quotation_item_id, decision, decided_by,
              decision_channel, decided_at, evidence_ref
         FROM quo.approval_decisions
        WHERE tenant_id = $1 AND quotation_item_id = $2`,
      [context.principal.tenantId, itemId]
    );
    return row
      ? {
          id: row.id,
          quotationRevisionId: row.quotation_revision_id,
          quotationItemId: row.quotation_item_id,
          decision: row.decision,
          decidedBy: row.decided_by,
          decisionChannel: row.decision_channel,
          decidedAt: row.decided_at,
          evidenceRef: row.evidence_ref,
        }
      : null;
  }

  /**
   * Moves a quotation's status under an optimistic-concurrency predicate.
   *
   * Returns the new `record_version`, or `null` when the predicate did not match
   * — which means someone else changed the row and the caller must not proceed.
   * `quo.emit_quotation_status_history` writes the ledger row from a trigger, so
   * there is no separate history insert to forget.
   */
  public async updateQuotationStatus(
    db: DbHandle,
    quotationId: string,
    toStatus: string,
    expectedVersion: number
  ): Promise<number | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ record_version: number }>(
      db,
      `UPDATE quo.quotations
          SET status = $3
        WHERE tenant_id = $1 AND id = $2 AND record_version = $4 AND deleted_at IS NULL
       RETURNING record_version`,
      [context.principal.tenantId, quotationId, toStatus, expectedVersion]
    );
    return row?.record_version ?? null;
  }

  /**
   * Moves a revision's status.
   *
   * `quo.guard_quotation_revision_freeze` constrains the legal edges; this method
   * does not re-encode them, it just performs the write the service already
   * decided was legal.
   */
  public async updateRevisionStatus(
    db: DbHandle,
    revisionId: string,
    toStatus: string
  ): Promise<number | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ record_version: number }>(
      db,
      `UPDATE quo.quotation_revisions
          SET status = $3
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING record_version`,
      [context.principal.tenantId, revisionId, toStatus]
    );
    return row?.record_version ?? null;
  }

  /**
   * Issued revisions whose `expires_at` has passed, for the expiry sweep.
   *
   * Bounded, and ordered by `expires_at` so the oldest lapse first. Uses the
   * database's `now()` rather than an application clock: the sweep and the
   * per-request expiry check must agree on what "now" is.
   */
  public async listLapsedRevisions(db: DbHandle, limit: number): Promise<readonly RevisionRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<RevisionSql>(
      db,
      `SELECT ${REVISION_COLUMNS} FROM quo.quotation_revisions
        WHERE tenant_id = $1 AND status = 'issued' AND deleted_at IS NULL
          AND expires_at IS NOT NULL AND expires_at <= now()
        ORDER BY expires_at, id
        LIMIT $2`,
      [context.principal.tenantId, limit]
    );
    return result.rows.map(toRevision);
  }
}
