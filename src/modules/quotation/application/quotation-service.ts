/**
 * Quotation lifecycle (Phase 1-20, P1-20-BE-007, BE-010, BE-011).
 *
 * Create → revise → issue → expire. Four commands, one invariant running through
 * all of them: **the server computes every amount, and the customer-facing
 * revision is immutable once issued.**
 *
 * ## What the client may say, and what it may not
 *
 * A caller supplies *what* to quote — a work order, a service, a quantity, an
 * optional discount. It never supplies a unit price, a tax rate, a tax amount, a
 * line total, or a document total. Those are resolved from the protected price
 * list and computed by PostgreSQL. The Zod schemas are `.strict()`, so a request
 * carrying `unitPrice` or `lineTotal` is **rejected** rather than ignored —
 * silently dropping such a field would leave a caller believing it had set a
 * price, which is a worse failure than a 422.
 *
 * ## Why `asOf` comes from the database
 *
 * The business date is read with `current_date` inside the same transaction, so
 * price resolution, effective-range predicates and `now()`-based expiry all agree
 * on one clock. A client-supplied date would let a caller pick a price from a
 * period the tenant is not trading in.
 *
 * ## Lock order
 *
 * `quo.quotations` first, then the revision, then items — on every path. Both
 * `quo.issue_revision` and `quo.record_item_decision` take the parent lock
 * internally, so any other order would deadlock against them.
 */
import type { DbHandle } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermission, type ScopeAuthorizer } from '@/server/auth/authorization';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { serviceCatalogModule } from '@/modules/service-catalog';
import {
  Money,
  QUANTITY,
  parsePositive,
  pricingModule,
  type DiscountAuthorization,
  type PermissionProbe,
} from '@/modules/pricing';
import { sharedServicesModule } from '@/modules/shared-services';
import { workOrderModule } from '@/modules/work-order';
import {
  MAX_ITEMS_PER_REVISION,
  QuotationRuleError,
  assertRevisionEditable,
  hasExpired,
  isTerminalRevision,
  rollUpDecisions,
} from '../domain/quotation';
import type {
  ItemRow,
  NewItemInput,
  QuotationRepository,
  QuotationRow,
  RevisionRow,
} from '../data/quotation-repository';

/** One line a caller asked for. Carries no computed money — by design. */
export interface QuotationLineInput {
  readonly serviceId: string;
  /** `numeric(12,3)` decimal STRING, strictly positive. */
  readonly quantity: string;
  /** `numeric(18,4)` decimal STRING. Optional; defaults to zero. */
  readonly discount?: string | undefined;
  readonly description?: string | undefined;
  /** Provenance when the line came from a work-order service line. */
  readonly sourceServiceLineRef?: string | undefined;
}

export interface CreateQuotationInput {
  readonly workOrderId: string;
  readonly payerPartnerRef?: string | undefined;
  /** `svc.price_rules.customer_class`; `null` matches wildcard rules only. */
  readonly customerClass?: string | undefined;
  readonly lines: readonly QuotationLineInput[];
  /** Who requested a discount, when that differs from the caller. */
  readonly discountRequestedBy?: string | undefined;
}

/**
 * What a revision's discounts needed, for the audit record.
 *
 * Collected while pricing the lines because that is the only place the policy and
 * the ceiling are read; recorded after the revision exists, because an audit record
 * has to name the row it is about.
 */
interface DiscountSummary {
  /** `numeric(18,4)` STRING: every line's discount, summed by PostgreSQL. */
  readonly total: string;
  readonly currency: string;
  /** How many lines needed the elevated permission. Zero means nothing to audit. */
  readonly elevatedLines: number;
  readonly permissionCode: string | null;
  readonly ceiling: { amount: string; currency: string } | null;
  readonly threshold: DiscountAuthorization['threshold'];
}

export interface IssueQuotationInput {
  readonly revisionId: string;
  /** When the issued revision lapses. `null` means it never expires. */
  readonly expiresAt?: Date | undefined;
  readonly expectedVersion: number;
}

export interface MoneyLine {
  readonly id: string;
  readonly lineNumber: number;
  readonly itemKind: string;
  readonly serviceId: string | null;
  readonly description: string | null;
  readonly currency: string;
  readonly unitPrice: string;
  readonly quantity: string;
  readonly discount: string;
  readonly taxRate: string;
  readonly taxAmount: string;
  readonly lineTotal: string;
  readonly priceRuleRef: string | null;
}

export interface RevisionView {
  readonly id: string;
  readonly revisionNumber: number;
  readonly status: string;
  readonly currency: string;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly grandTotal: string;
  readonly recordVersion: number;
  readonly lines: readonly MoneyLine[];
}

export interface QuotationView {
  readonly id: string;
  readonly quotationNumber: string;
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly currency: string;
  readonly status: string;
  readonly payerPartnerRef: string | null;
  readonly currentRevisionId: string | null;
  readonly recordVersion: number;
  readonly currentRevision: RevisionView | null;
}

const toLine = (row: ItemRow): MoneyLine => ({
  id: row.id,
  lineNumber: row.lineNumber,
  itemKind: row.itemKind,
  serviceId: row.serviceId,
  description: row.description,
  currency: row.currencyCode,
  unitPrice: row.capturedUnitPrice,
  quantity: row.capturedQuantity,
  discount: row.capturedDiscount,
  taxRate: row.capturedTaxRate,
  taxAmount: row.capturedTaxAmount,
  lineTotal: row.capturedLineTotal,
  priceRuleRef: row.priceRuleRef,
});

const toRevisionView = (row: RevisionRow, lines: readonly ItemRow[]): RevisionView => ({
  id: row.id,
  revisionNumber: row.revisionNumber,
  status: row.status,
  currency: row.currencyCode,
  issuedAt: row.issuedAt === null ? null : row.issuedAt.toISOString(),
  expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
  subtotal: row.capturedSubtotal,
  discountTotal: row.capturedDiscountTotal,
  taxTotal: row.capturedTaxTotal,
  grandTotal: row.capturedGrandTotal,
  recordVersion: row.recordVersion,
  lines: lines.map(toLine),
});

export class QuotationService {
  public constructor(private readonly repository: QuotationRepository) {}

  /**
   * Creates a quotation with its first draft revision and priced lines.
   *
   * The work order is the authority for scope: `requireWorkOrder` performs the
   * deferred scoped authorization against the ROW's own company and branch, so a
   * caller cannot quote into a branch their grants do not cover. Nothing here
   * reads a company or branch from the request.
   */
  public async create(
    db: DbHandle,
    input: CreateQuotationInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<QuotationView> {
    if (input.lines.length === 0) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A quotation must have at least one line',
      });
    }
    if (input.lines.length > MAX_ITEMS_PER_REVISION) {
      throw new AppFailure('ERR-VAL-001', {
        message: `A revision may hold at most ${MAX_ITEMS_PER_REVISION} lines`,
      });
    }

    const workOrder = await workOrderModule().workOrders.requireWorkOrder(
      db,
      input.workOrderId,
      authorizeScope
    );
    await this.assertWorkOrderAcceptsQuoting(db, workOrder.state, workOrder.id);

    const asOf = await this.repository.businessDate(db);

    // The currency comes from the price list the FIRST line resolves to, not from
    // the request. `quo.quotations.currency_code` is immutable and
    // `quo.guard_quotation_item` forces every item to match the revision, so the
    // whole document is single-currency by construction. A later line that
    // resolves to a different list currency is a hard failure, never a conversion.
    const priced = await this.priceLines(db, {
      lines: input.lines,
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      customerClass: input.customerClass ?? null,
      asOf,
      requestedBy: input.discountRequestedBy ?? null,
      hasPermission: this.permissionProbe(db, workOrder.companyId, workOrder.branchId),
    });
    const currency = priced.currency;

    const allocated = await sharedServicesModule().numbers.allocate(db, {
      sequenceCode: 'quotation',
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
    });

    const quotation = await this.repository.insertQuotation(db, {
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      workOrderId: workOrder.id,
      quotationNumber: allocated.displayNumber,
      currencyCode: currency,
      payerPartnerRef: input.payerPartnerRef ?? null,
    });

    const revision = await this.repository.insertRevision(db, {
      id: quotation.id,
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      currencyCode: quotation.currencyCode,
    });

    const items: ItemRow[] = [];
    for (const item of priced.items) {
      items.push(await this.repository.insertItem(db, revision, item));
    }

    await this.auditDiscountAuthorization(db, revision, priced.discount);

    await appendAudit(db, {
      action: 'quo.quotation.created',
      entityType: 'quo.quotation',
      entityId: quotation.id,
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      details: [
        { field: 'quotationNumber', classification: 'internal', value: quotation.quotationNumber },
        { field: 'workOrderId', classification: 'internal', value: workOrder.id },
        { field: 'currency', classification: 'public', value: currency },
        { field: 'lineCount', classification: 'public', value: String(items.length) },
      ],
    });

    await publishEvent(db, {
      eventType: 'quotation.created',
      aggregateId: quotation.id,
      aggregateVersion: quotation.recordVersion,
      producer: 'quotation.quotation-service',
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      // No amounts: a draft quotation's totals are not yet authoritative (they are
      // computed at issue), and a consumer that may see money reads it under its
      // own authorization.
      payload: {
        quotationId: quotation.id,
        quotationNumber: quotation.quotationNumber,
        workOrderId: workOrder.id,
        currency,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
      },
      eventKey: `quotation.created:${quotation.id}`,
    });

    return this.view(quotation, revision, items);
  }

  /**
   * Creates a new draft revision, superseding nothing until it is issued.
   *
   * A commercial change never edits an issued revision — `quo.guard_quotation_item`
   * refuses item writes on a non-draft parent, which is what makes an issued
   * revision an immutable snapshot. So a revision is how a price change reaches a
   * customer, and the previous issued revision stays exactly as it was presented.
   */
  public async revise(
    db: DbHandle,
    quotationId: string,
    input: {
      readonly lines: readonly QuotationLineInput[];
      readonly customerClass?: string | undefined;
      readonly discountRequestedBy?: string | undefined;
      readonly expectedVersion: number;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<RevisionView> {
    if (input.lines.length === 0) {
      throw new AppFailure('ERR-VAL-001', { message: 'A revision must have at least one line' });
    }
    if (input.lines.length > MAX_ITEMS_PER_REVISION) {
      throw new AppFailure('ERR-VAL-001', {
        message: `A revision may hold at most ${MAX_ITEMS_PER_REVISION} lines`,
      });
    }

    const quotation = await this.lockAndAuthorize(db, quotationId, authorizeScope);
    if (quotation.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Quotation ${quotationId} was modified by another request`,
      });
    }
    this.assertQuotationOpen(quotation);

    const asOf = await this.repository.businessDate(db);
    const priced = await this.priceLines(db, {
      lines: input.lines,
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      customerClass: input.customerClass ?? null,
      asOf,
      requestedBy: input.discountRequestedBy ?? null,
      hasPermission: this.permissionProbe(db, quotation.companyId, quotation.branchId),
    });

    // The new revision inherits the quotation's immutable currency. A revision
    // whose lines resolve to a different currency cannot be attached to this
    // quotation at all, so it fails rather than silently repricing.
    if (priced.currency !== quotation.currencyCode) {
      throw new AppFailure('ERR-VAL-001', {
        message:
          `This quotation is denominated in ${quotation.currencyCode} but the resolved price ` +
          `list is in ${priced.currency}. Currency conversion is not performed.`,
      });
    }

    const revision = await this.repository.insertRevision(db, {
      id: quotation.id,
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      currencyCode: quotation.currencyCode,
    });

    const items: ItemRow[] = [];
    for (const item of priced.items) {
      items.push(await this.repository.insertItem(db, revision, item));
    }

    await this.auditDiscountAuthorization(db, revision, priced.discount);

    await appendAudit(db, {
      action: 'quo.quotation_revision.created',
      entityType: 'quo.quotation_revision',
      entityId: revision.id,
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      details: [
        { field: 'quotationId', classification: 'internal', value: quotation.id },
        {
          field: 'revisionNumber',
          classification: 'public',
          value: String(revision.revisionNumber),
        },
        { field: 'lineCount', classification: 'public', value: String(items.length) },
      ],
    });

    return toRevisionView(revision, items);
  }

  /**
   * Issues a draft revision to the customer.
   *
   * `quo.issue_revision` does the whole state change atomically — verifies
   * `draft`, refuses zero items, recomputes all four totals by SUM, supersedes
   * the prior issued revision, repoints `current_revision_id` and moves the
   * quotation to `active`. This method's job is everything the function does not
   * do: authorization, expiry sanity, the audit record, the outbox event, and the
   * delivery intent.
   *
   * The delivery intent goes through the shared notification service, which
   * writes to the outbox — no irreversible send happens inside this transaction.
   * A rolled-back issue therefore cannot leave a customer holding a quotation the
   * database never issued.
   */
  public async issue(
    db: DbHandle,
    quotationId: string,
    input: IssueQuotationInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<RevisionView> {
    const quotation = await this.lockAndAuthorize(db, quotationId, authorizeScope);
    if (quotation.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Quotation ${quotationId} was modified by another request`,
      });
    }
    this.assertQuotationOpen(quotation);

    const revision = await this.repository.lockRevision(db, input.revisionId);
    if (revision === null || revision.quotationId !== quotation.id) {
      throw new AppFailure('ERR-RES-001', {
        message: `Revision ${input.revisionId} does not belong to quotation ${quotationId}`,
      });
    }
    if (revision.status !== 'draft') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Revision ${revision.revisionNumber} is ${revision.status}; only a draft may be issued`,
      });
    }

    const items = await this.repository.listItems(db, revision.id);
    if (items.length === 0) {
      // `quo.issue_revision` also refuses this; refused here so the caller gets a
      // field-level message instead of a raised exception from plpgsql.
      throw new AppFailure('ERR-VAL-001', {
        message: 'A revision with no lines cannot be issued',
      });
    }

    const expiresAt = input.expiresAt ?? null;
    if (expiresAt !== null && hasExpired(expiresAt, new Date())) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A quotation cannot be issued with an expiry that has already passed',
      });
    }

    await this.repository.issueRevision(db, revision.id, expiresAt);

    // Re-read so the totals in the response and the event are the ones the
    // database computed, not ones this service assembled.
    const issued = await this.repository.findRevision(db, revision.id);
    if (issued === null || issued.status !== 'issued') {
      throw new AppFailure('ERR-SYS-001', {
        message: `Revision ${revision.id} was not issued`,
      });
    }

    await appendAudit(db, {
      action: 'quo.quotation_revision.issued',
      entityType: 'quo.quotation_revision',
      entityId: issued.id,
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      details: [
        { field: 'quotationId', classification: 'internal', value: quotation.id },
        { field: 'revisionNumber', classification: 'public', value: String(issued.revisionNumber) },
        { field: 'grandTotal', classification: 'restricted', value: issued.capturedGrandTotal },
        { field: 'currency', classification: 'public', value: issued.currencyCode },
        ...(expiresAt === null
          ? []
          : [
              {
                field: 'expiresAt',
                classification: 'public' as const,
                value: expiresAt.toISOString(),
              },
            ]),
      ],
    });

    await publishEvent(db, {
      eventType: 'quotation.revision-issued',
      aggregateId: issued.id,
      aggregateVersion: issued.recordVersion,
      producer: 'quotation.quotation-service',
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      payload: {
        quotationId: quotation.id,
        quotationNumber: quotation.quotationNumber,
        revisionId: issued.id,
        revisionNumber: issued.revisionNumber,
        currency: issued.currencyCode,
        grandTotal: issued.capturedGrandTotal,
        expiresAt: issued.expiresAt === null ? null : issued.expiresAt.toISOString(),
      },
      // Keyed on the revision, not the quotation: a revision can be issued at most
      // once (the guard makes `issued` reachable only from `draft`), so a retry of
      // the same issue collides here instead of publishing twice.
      eventKey: `quotation.revision-issued:${issued.id}`,
    });

    return toRevisionView(issued, items);
  }

  /**
   * Expires issued revisions whose `expires_at` has passed (P1-20-BE-010,
   * P1-20-DO-002).
   *
   * Bounded and idempotent. The lapse test is the database's `now()` on both
   * sides — the candidate query's SQL predicate and the re-check under the lock
   * read the same transaction-scoped clock, so they cannot disagree and a
   * container whose clock has drifted ahead of the database's cannot expire a
   * revision the database does not consider lapsed.
   *
   * Two states are skipped rather than forced, and each is a distinct hazard:
   *
   *  - A revision a concurrent decision has moved out of `issued`.
   *    `quo.guard_quotation_revision_freeze` treats `superseded`/`rejected`/
   *    `expired` as terminal, so forcing would raise, and the decision that got
   *    there first is the truth.
   *  - A quotation that is no longer `active`. A revision stays `issued` after
   *    every line is APPROVED — only a rejection moves it — so revision status
   *    alone does not distinguish "awaiting a decision" from "already accepted",
   *    and expiring the latter would revoke a customer's approval in a background
   *    sweep. The candidate query already excludes it; this is the re-check under
   *    the lock, for a decision that landed in between.
   */
  public async expireLapsed(db: DbHandle, limit: number): Promise<readonly string[]> {
    const lapsed = await this.repository.listLapsedRevisions(db, limit);
    if (lapsed.length === 0) return [];
    // ONE clock for the whole sweep, and the same one the candidate query used:
    // `now()` is the transaction's start time, so this is not a second reading.
    const asOf = await this.repository.serverNow(db);
    const expired: string[] = [];

    for (const candidate of lapsed) {
      // Take the parent lock first, then re-read the revision under it: between
      // the sweep query and here, a decision may have superseded or rejected it.
      const quotation = await this.repository.lockQuotation(db, candidate.quotationId);
      if (quotation === null || quotation.status !== 'active') continue;
      const current = await this.repository.lockRevision(db, candidate.id);
      if (current === null || current.status !== 'issued') continue;
      if (!hasExpired(current.expiresAt, asOf)) continue;

      await this.repository.updateRevisionStatus(db, current.id, 'expired');
      const next = await this.repository.updateQuotationStatus(
        db,
        quotation.id,
        'expired',
        quotation.recordVersion
      );
      if (next === null) continue;

      await appendAudit(db, {
        action: 'quo.quotation.expired',
        entityType: 'quo.quotation',
        entityId: quotation.id,
        companyId: quotation.companyId,
        branchId: quotation.branchId,
        details: [
          { field: 'revisionId', classification: 'internal', value: current.id },
          { field: 'status', classification: 'public', previousValue: 'active', value: 'expired' },
        ],
      });

      await publishEvent(db, {
        eventType: 'quotation.expired',
        aggregateId: quotation.id,
        aggregateVersion: next,
        producer: 'quotation.quotation-service',
        companyId: quotation.companyId,
        branchId: quotation.branchId,
        payload: {
          quotationId: quotation.id,
          revisionId: current.id,
          revisionNumber: current.revisionNumber,
        },
        // Expiry is terminal for this revision, so the key needs no version and a
        // duplicate sweep collides rather than publishing twice.
        eventKey: `quotation.expired:${current.id}`,
      });
      expired.push(current.id);
    }
    return expired;
  }

  /** One quotation with its current revision, or `ERR-RES-001`. */
  public async detail(
    db: DbHandle,
    quotationId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<QuotationView> {
    const quotation = await this.repository.findQuotation(db, quotationId);
    if (quotation === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Quotation ${quotationId} is not visible`,
      });
    }
    // Deferred scoped authorization against the ROW's own scope — the route names
    // no branch, so `scope: 'branch'` would otherwise be inert (P1-18-A-01).
    await authorizeScope({ companyId: quotation.companyId, branchId: quotation.branchId });

    if (quotation.currentRevisionId === null) {
      const revisions = await this.repository.listRevisions(db, quotation.id);
      const latest = revisions[0];
      if (latest === undefined) return this.view(quotation, null, []);
      const items = await this.repository.listItems(db, latest.id);
      return this.view(quotation, latest, items);
    }
    const revision = await this.repository.findRevision(db, quotation.currentRevisionId);
    const items = revision === null ? [] : await this.repository.listItems(db, revision.id);
    return this.view(quotation, revision, items);
  }

  /**
   * The commercial standing of one revision, for another module to gate on
   * (P1-20-BE-013).
   *
   * Exists so `@/modules/work-order` can decide whether a quotation revision
   * justifies releasing additional work WITHOUT reading any `quo` table — the
   * P1-19 integration point is `wo.customer_approvals.quotation_revision_ref`, and
   * that column belongs to work-order while every fact about the revision belongs
   * here.
   *
   * `outcome` is DERIVED from the item decisions on every call, exactly as the
   * quotation's own status is. There is no second stored approval truth: this
   * method reads the same `quo.approval_decisions` rows and folds them with
   * `rollUpDecisions`, so a consumer cannot be told "approved" by one path and
   * "rejected" by another.
   *
   * It returns the revision's own scope and its quotation's `work_order_id` so the
   * caller can prove the link is to the right order in the right branch, rather
   * than trusting an id a client supplied.
   *
   * `null` when the revision is not visible to the caller — RLS decides that, so a
   * cross-tenant revision simply is not found.
   */
  public async commercialApproval(
    db: DbHandle,
    revisionId: string,
    options: { readonly lock?: boolean } = {}
  ): Promise<{
    readonly revisionId: string;
    readonly quotationId: string;
    readonly workOrderId: string;
    readonly companyId: string;
    readonly branchId: string;
    readonly currency: string;
    readonly grandTotal: string;
    readonly revisionStatus: string;
    readonly isCurrentRevision: boolean;
    readonly hasExpired: boolean;
    /** `accepted`, `rejected`, or `null` while lines remain undecided. */
    readonly outcome: 'accepted' | 'rejected' | null;
  } | null> {
    /**
     * Locking, when the caller is about to WRITE something that depends on the
     * answer.
     *
     * Without a lock this is a plain read, and the standing it reports can change
     * before the caller acts on it: between "accepted, current, issued" and the
     * INSERT of `wo.customer_approvals.quotation_revision_ref`, a concurrent
     * `quo.issue_revision` can supersede this revision or a rejection can move it
     * to terminal. The reference column is frozen by
     * `tg_customer_approvals_immutable`, so a link taken on a stale answer can
     * never be corrected — which is precisely why the read has to be able to hold
     * still.
     *
     * The lock order is the module's documented one — quotation, then revision —
     * because `quo.issue_revision` and `quo.record_item_decision` both take the
     * parent lock internally, and taking the revision first would deadlock against
     * them.
     */
    const revision =
      options.lock === true
        ? await this.lockParentThenRevision(db, revisionId)
        : await this.repository.findRevision(db, revisionId);
    if (revision === null) return null;
    const quotation = await this.repository.findQuotation(db, revision.quotationId);
    if (quotation === null) return null;

    const tally = await this.repository.tallyDecisions(db, revision.id);
    return {
      revisionId: revision.id,
      quotationId: quotation.id,
      workOrderId: quotation.workOrderId,
      companyId: revision.companyId,
      branchId: revision.branchId,
      currency: revision.currencyCode,
      grandTotal: revision.capturedGrandTotal,
      revisionStatus: revision.status,
      isCurrentRevision: quotation.currentRevisionId === revision.id,
      // The DATABASE clock, like every other expiry decision in this module.
      hasExpired: hasExpired(revision.expiresAt, await this.repository.serverNow(db)),
      outcome: rollUpDecisions(tally),
    };
  }

  /**
   * Locks the parent quotation, then the revision, and returns the locked revision.
   *
   * The revision is read once to learn its parent, then re-read under the parent's
   * lock: the first read is not evidence of anything, it only tells us which
   * quotation to lock. `null` from either read means not visible.
   */
  private async lockParentThenRevision(
    db: DbHandle,
    revisionId: string
  ): Promise<RevisionRow | null> {
    const probe = await this.repository.findRevision(db, revisionId);
    if (probe === null) return null;
    const parent = await this.repository.lockQuotation(db, probe.quotationId);
    if (parent === null) return null;
    return this.repository.lockRevision(db, revisionId);
  }

  // ---- internals -----------------------------------------------------------

  /**
   * A permission probe bound to one company and branch.
   *
   * `svc.pricing_approval_policies.required_permission_code` is a value an operator
   * configured, so it appears in no `defineOperation` declaration and the operation
   * registry cannot evaluate it. The probe asks the iam module — which owns
   * authorization — through its public surface, and always names a concrete
   * company and branch, so the answer consults grant scope rather than falling back
   * to a scope-blind check.
   */
  private permissionProbe(db: DbHandle, companyId: string, branchId: string): PermissionProbe {
    return (permissionCode: string) =>
      callerHoldsPermission(db, permissionCode, { companyId, branchId });
  }

  /** Locks the quotation and authorizes against its OWN company and branch. */
  private async lockAndAuthorize(
    db: DbHandle,
    quotationId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<QuotationRow> {
    const quotation = await this.repository.lockQuotation(db, quotationId);
    if (quotation === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Quotation ${quotationId} is not visible`,
      });
    }
    await authorizeScope({ companyId: quotation.companyId, branchId: quotation.branchId });
    return quotation;
  }

  /**
   * Refuses a quotation that has reached a terminal commercial state.
   *
   * `accepted`, `rejected`, `expired` and `cancelled` all mean the commercial
   * conversation is over; re-issuing or re-revising would change what a customer
   * already decided about.
   */
  private assertQuotationOpen(quotation: QuotationRow): void {
    if (quotation.status !== 'draft' && quotation.status !== 'active') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Quotation ${quotation.id} is ${quotation.status} and accepts no further changes`,
      });
    }
  }

  /**
   * Refuses quoting against a terminal work order.
   *
   * The state graph is a tenant-overridable catalog table, not a constant, so
   * terminality is resolved through `workOrderCatalog` rather than compared to a
   * hard-coded list.
   */
  private async assertWorkOrderAcceptsQuoting(
    db: DbHandle,
    state: string,
    workOrderId: string
  ): Promise<void> {
    const states = await workOrderModule().workOrderCatalog.workOrderStates(db);
    const definition = states.find((candidate) => candidate.code === state);
    if (definition === undefined || definition.isTerminal) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Work order ${workOrderId} is ${state} and cannot be quoted`,
      });
    }
  }

  /**
   * Resolves a price, a tax rate and an authorized discount for every line.
   *
   * Returns repository-ready inputs — still no computed money, because the
   * arithmetic belongs to PostgreSQL. The single currency is established by the
   * first line and every subsequent line must match it; a mismatch is a hard
   * failure, never a conversion.
   */
  private async priceLines(
    db: DbHandle,
    context: {
      lines: readonly QuotationLineInput[];
      companyId: string;
      branchId: string;
      customerClass: string | null;
      asOf: string;
      requestedBy: string | null;
      hasPermission: PermissionProbe;
    }
  ): Promise<{
    currency: string;
    items: readonly NewItemInput[];
    discount: DiscountSummary;
  }> {
    const catalog = serviceCatalogModule().services;
    const pricing = pricingModule();
    const items: NewItemInput[] = [];
    let currency: string | null = null;
    let lineNumber = 0;
    // Document-level discount accounting. A per-line ceiling check is defeated by
    // splitting one large discount across many lines, so the aggregate is checked
    // once at the end against the same ceiling.
    let totalDiscount = '0.0000';
    let elevatedLines = 0;
    let appliedCeiling: { amount: string; currency: string } | null = null;
    let appliedThreshold: DiscountAuthorization['threshold'] = null;
    let elevatedPermission: string | null = null;

    for (const line of context.lines) {
      lineNumber += 1;

      const sellable = await catalog.isSellableAt(
        db,
        context.companyId,
        context.branchId,
        line.serviceId,
        context.asOf
      );
      if (!sellable) {
        throw new AppFailure('ERR-VAL-001', {
          message:
            `Line ${lineNumber}: service ${line.serviceId} is not available at this branch on ` +
            `${context.asOf}`,
        });
      }

      // The quantity is the one client-supplied multiplicand of an authoritative
      // amount, so it goes through the exact type rather than a regex alone. The
      // route pattern admits `0` and an unbounded integer part, both of which would
      // otherwise reach `numeric(12,3)` and surface as a constraint violation
      // (`ck_quotation_items_quantity`) or a driver overflow — a 500 — instead of a
      // field-level refusal.
      try {
        parsePositive(line.quantity, QUANTITY);
      } catch (cause) {
        throw new AppFailure('ERR-VAL-001', {
          message: `Line ${lineNumber}: ${cause instanceof Error ? cause.message : 'invalid quantity'}`,
          safeDetails: {
            violations: [{ path: `body.lines[${lineNumber - 1}].quantity`, rule: 'quantity' }],
          },
        });
      }

      const price = await pricing.prices.resolve(db, {
        serviceId: line.serviceId,
        companyId: context.companyId,
        branchId: context.branchId,
        customerClass: context.customerClass,
        asOf: context.asOf,
      });

      if (currency === null) {
        currency = price.currency;
      } else if (price.currency !== currency) {
        throw new AppFailure('ERR-VAL-001', {
          message:
            `Line ${lineNumber} resolves to a price list in ${price.currency}, but this quotation ` +
            `is in ${currency}. A quotation cannot mix currencies and no conversion is performed.`,
        });
      }

      const discount = line.discount ?? '0';
      // The base a percentage discount applies to. Computed by the database, and
      // refused unless it is exact at scale 4 — see `lineBase`.
      const base = await this.lineBase(db, lineNumber, price.unitPrice, line.quantity);
      const authorization = await pricing.discounts.authorize(
        db,
        {
          companyId: context.companyId,
          branchId: context.branchId,
          discountAmount: discount,
          currency: price.currency,
          lineBase: base,
          asOf: context.asOf,
          requestedBy: context.requestedBy,
          actorId: db.context.principal.userId,
        },
        context.hasPermission
      );
      // Accumulate for the DOCUMENT-level ceiling check below. A per-line check
      // alone is defeated by splitting: 200 lines each just under the ceiling
      // authorize 200× the amount the actor is limited to.
      totalDiscount = await this.addMoney(db, totalDiscount, discount);
      if (authorization.requiredElevatedPermission) {
        elevatedLines += 1;
        // The policy and permission that governed the elevated lines. Every line of
        // one document resolves the same company policy, so the last write is the
        // policy that applied — not an arbitrary choice between different ones.
        appliedThreshold = authorization.threshold;
        elevatedPermission = authorization.permissionCode;
      }
      if (authorization.ceiling !== null) appliedCeiling = authorization.ceiling;

      items.push({
        lineNumber,
        itemKind: 'service',
        serviceId: line.serviceId,
        itemRef: null,
        sourceServiceLineRef: line.sourceServiceLineRef ?? null,
        sourceRequiredPartRef: null,
        priceRuleRef: price.priceRuleId,
        description: line.description ?? null,
        currencyCode: price.currency,
        unitPrice: price.unitPrice,
        quantity: line.quantity,
        discount,
        taxRate: price.taxRate,
      });
    }

    if (currency === null) {
      throw new QuotationRuleError('No line resolved a currency');
    }

    /**
     * The DOCUMENT-level ceiling check.
     *
     * `iam.approval_limits.amount` is a ceiling on what the actor may approve, and
     * checking it per line does not enforce it: `MAX_ITEMS_PER_REVISION` is 200 and
     * `uq_quotation_items_line` keys only on `line_number`, so the same service may
     * occupy every line. An actor limited to 100 could authorize 200 lines of 100
     * and give away 20 000.
     *
     * The per-line check stays — it mirrors `ck_quotation_items_discount`, which is
     * genuinely per row — and this adds the aggregate the ceiling actually means.
     * It only runs when at least one line needed elevated authority, so an
     * all-under-threshold quotation is unaffected.
     */
    if (elevatedLines > 0 && appliedCeiling !== null) {
      const total = Money.of(totalDiscount, currency);
      const allowed = Money.of(appliedCeiling.amount, appliedCeiling.currency);
      if (total.greaterThan(allowed, 'discount approval limit (document total)')) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            `The quotation's total discount of ${totalDiscount} ${currency} exceeds your ` +
            `approval limit of ${appliedCeiling.amount} ${appliedCeiling.currency}, even though ` +
            'no single line does',
        });
      }
    }

    return {
      currency,
      items,
      discount: {
        total: totalDiscount,
        currency,
        elevatedLines,
        permissionCode: elevatedPermission,
        ceiling: appliedCeiling,
        threshold: appliedThreshold,
      },
    };
  }

  /**
   * Records `svc.discount.authorized` when a revision's lines needed elevated
   * authority (P1-20-BE-006, P1-20-SEC-004).
   *
   * Emitted once per revision rather than once per line: the ceiling is a limit on
   * the actor, the document-level check is what enforces it, and 200 records saying
   * the same thing about the same actor would bury the fact rather than record it.
   *
   * Nothing is written when no line needed elevated authority. A discount under the
   * configured threshold is an ordinary edit any actor who may write the quotation
   * may make, and auditing it as an *authorization* would misstate what happened.
   */
  private async auditDiscountAuthorization(
    db: DbHandle,
    revision: RevisionRow,
    summary: DiscountSummary
  ): Promise<void> {
    if (summary.elevatedLines === 0) return;
    await appendAudit(db, {
      action: 'svc.discount.authorized',
      entityType: 'quo.quotation_revision',
      entityId: revision.id,
      companyId: revision.companyId,
      branchId: revision.branchId,
      details: [
        // The amount given away is what the business charges, so it carries the same
        // classification as every other price in the trail.
        { field: 'discountTotal', classification: 'restricted', value: summary.total },
        { field: 'currency', classification: 'public', value: summary.currency },
        {
          field: 'elevatedLineCount',
          classification: 'public',
          value: String(summary.elevatedLines),
        },
        {
          field: 'requiredPermission',
          classification: 'internal',
          value: summary.permissionCode ?? 'none',
        },
        // A null policy is recorded as such rather than omitted: "no policy was
        // configured, so the threshold was zero" is the reason the discount needed
        // authorizing, and an absent field would read as "not applicable".
        {
          field: 'thresholdPolicyId',
          classification: 'internal',
          value: summary.threshold?.policyId ?? 'unconfigured',
        },
        {
          field: 'thresholdKind',
          classification: 'internal',
          value: summary.threshold?.kind ?? 'zero-by-default',
        },
        {
          field: 'thresholdValue',
          classification: 'internal',
          value: summary.threshold?.value ?? '0',
        },
        {
          field: 'ceilingAmount',
          classification: 'restricted',
          value: summary.ceiling?.amount ?? 'none',
        },
        {
          field: 'ceilingCurrency',
          classification: 'public',
          value: summary.ceiling?.currency ?? 'none',
        },
      ],
    });
  }

  /**
   * `a + b` at money scale, computed by PostgreSQL.
   *
   * `Decimal` deliberately exposes no `add` — the whole point of it — so the running
   * discount total is summed in SQL, exactly like every other authoritative amount
   * in this phase.
   */
  private async addMoney(db: DbHandle, a: string, b: string): Promise<string> {
    const row = await db.query<{ sum: string }>(
      `SELECT ($1::numeric(18,4) + $2::numeric(18,4))::text AS sum`,
      [a, b]
    );
    const sum = row.rows[0]?.sum;
    if (sum === undefined) {
      throw new AppFailure('ERR-SYS-001', { message: 'Could not total the line discounts' });
    }
    return sum;
  }

  /**
   * `unit * qty` computed by PostgreSQL, and refused unless it is EXACT at scale 4.
   *
   * The exactness check is the load-bearing part, and it closes a defect that made
   * some perfectly legal quotations permanently unissuable.
   *
   * `captured_unit_price` is `numeric(18,4)` and `captured_quantity` is
   * `numeric(12,3)`, so the raw product has scale **7**. Two constraints then
   * disagree about what to do with those extra digits:
   *
   *  - `ck_quotation_items_line_total` rounds per line, so each stored line holds
   *    `round(baseᵢ, 4)`;
   *  - `quo.issue_revision` assigns `SUM(captured_unit_price * captured_quantity)`
   *    into a `numeric(18,4)` variable, i.e. `round(Σ baseᵢ, 4)`, and
   *    `ck_quotation_revisions_totals` compares that against `SUM(line_total)`.
   *
   * `Σ round(baseᵢ, 4) = round(Σ baseᵢ, 4)` is **not** an identity. Two lines of
   * `1.0001 × 1.500` give `1.5001500` each: the per-line sum is `3.0004` and the
   * rounded sum is `3.0003`, so the revision CHECK fails inside
   * `quo.issue_revision` — a `23514` surfacing as `ERR-SYS-001`, HTTP 500, with the
   * draft left unissuable and the caller told nothing useful.
   *
   * Both constraints are frozen, so the application must keep the disagreement from
   * arising: if every line's product is exact at scale 4 then `round(baseᵢ,4) = baseᵢ`
   * and the two expressions coincide by construction. A quantity whose product does
   * not fit is refused here, naming the field, instead of failing far away at issue.
   *
   * Returning the EXACT product also fixes the discount ceiling:
   * `ck_quotation_items_discount` compares against the **unrounded** product, so a
   * rounded-up base could authorize a discount the CHECK then rejects.
   */
  private async lineBase(
    db: DbHandle,
    lineNumber: number,
    unitPrice: string,
    quantity: string
  ): Promise<string> {
    const row = await db.query<{ raw: string; base: string; exact: boolean }>(
      /**
       * Three values, and each one is needed.
       *
       * `raw` is the unrounded product at its natural scale 7 — for the error message
       * only, because that is the number the caller has to understand.
       *
       * `base` is the same product at MONEY's scale 4. It is only ever RETURNED when
       * `exact` is true, and `exact` says the two are equal, so nothing is lost by the
       * cast. It has to be the scale-4 form: `Decimal.parse(_, MONEY)` refuses a
       * 7-decimal string, and returning `raw` made every quotation whose product had
       * trailing zeros — `100.0000 × 2.000 = 200.0000000`, the ordinary case — fail with
       * `DecimalError` and an HTTP 500 inside the discount check.
       */
      `SELECT ($1::numeric(18,4) * $2::numeric(12,3))::text AS raw,
              round($1::numeric(18,4) * $2::numeric(12,3), 4)::text AS base,
              ($1::numeric(18,4) * $2::numeric(12,3))
                = round($1::numeric(18,4) * $2::numeric(12,3), 4) AS exact`,
      [unitPrice, quantity]
    );
    const result = row.rows[0];
    if (result === undefined) {
      throw new AppFailure('ERR-SYS-001', { message: 'Could not compute the line base' });
    }
    if (!result.exact) {
      throw new AppFailure('ERR-VAL-001', {
        message:
          `Line ${lineNumber}: quantity ${quantity} against unit price ${unitPrice} produces ` +
          `${result.raw}, which does not fit the four decimal places the line total holds. ` +
          'Choose a quantity whose product is exact to four decimal places.',
        safeDetails: {
          violations: [
            { path: `body.lines[${lineNumber - 1}].quantity`, rule: 'inexact_line_base' },
          ],
        },
      });
    }
    return result.base;
  }

  private view(
    quotation: QuotationRow,
    revision: RevisionRow | null,
    items: readonly ItemRow[]
  ): QuotationView {
    return {
      id: quotation.id,
      quotationNumber: quotation.quotationNumber,
      workOrderId: quotation.workOrderId,
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      currency: quotation.currencyCode,
      status: quotation.status,
      payerPartnerRef: quotation.payerPartnerRef,
      currentRevisionId: quotation.currentRevisionId,
      recordVersion: quotation.recordVersion,
      currentRevision: revision === null ? null : toRevisionView(revision, items),
    };
  }
}

/** Re-exported so callers can reason about terminal revisions without the domain. */
export { isTerminalRevision, assertRevisionEditable };
