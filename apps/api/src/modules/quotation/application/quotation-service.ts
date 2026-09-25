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
import { pageRequest, type Page } from '@/server/db/pagination';
import { AppFailure } from '@/server/errors/app-failure';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { serviceCatalogModule } from '@/modules/service-catalog';
import {
  Decimal,
  MONEY,
  QUANTITY,
  parsePositive,
  pricingModule,
  DEFAULT_DISCOUNT_APPROVAL_PERMISSION,
  type DiscountThresholdSnapshot,
  type PinnedDiscountPolicy,
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
import { QUOTATION_LIST_ORDERING, REVISION_LIST_ORDERING } from '../data/quotation-repository';
import type {
  DiscountApprovalRow,
  ItemRow,
  NewItemInput,
  QuotationDiscountPolicyRow,
  QuotationRepository,
  QuotationRow,
  RevisionRow,
} from '../data/quotation-repository';
import { describeDiscountApproval, type DiscountApprovalView } from './discount-approval-service';

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
}

/**
 * What a revision's discounts need, measured against the policy version its
 * quotation is held to.
 *
 * Measured once the quotation exists, because the database pins that version when
 * the quotation is written; recorded after the revision exists, because the
 * approval request has to name the revision it is about.
 */
interface DiscountSummary {
  /** `numeric(18,4)` STRING: every line's discount, summed by PostgreSQL. */
  readonly total: string;
  /** `numeric(18,4)` STRING: every line's base before discount, summed by PostgreSQL. */
  readonly base: string;
  readonly currency: string;
  /** Whether a person other than the requester must approve before issue. */
  readonly requiresApproval: boolean;
  /** How many individual lines were at or over the threshold on their own. */
  readonly elevatedLines: number;
  /** The permission an approver must hold, when approval is required. */
  readonly permissionCode: string | null;
  /** The policy version measured against; `null` when none was configured. */
  readonly threshold: DiscountThresholdSnapshot | null;
}

/** One priced line's discount and the base it applies to, ready to be measured. */
interface LineDiscount {
  readonly lineNumber: number;
  /** `numeric(18,4)` decimal STRING. */
  readonly discount: string;
  /** `unit * quantity`, exact at scale 4, as a `numeric(18,4)` decimal STRING. */
  readonly base: string;
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
  /**
   * The discount approval this revision needs, or `null` when its discount needs
   * none (P1-32-PRE-OD-DISC-01). While it is `pending` or `rejected` the revision
   * cannot be issued.
   */
  readonly discountApproval: DiscountApprovalView | null;
}

/**
 * A revision HEADER, for the history list (P1-30 A2, S-08).
 *
 * `RevisionView` minus `lines`. The captured totals stay, and stay decimal
 * STRINGS: `captured_subtotal`…`captured_grand_total` are `numeric(18, 4)` and
 * `ck_quotation_revisions_totals` holds `grand = subtotal - discount + tax` in
 * the database. A history that rendered them as JSON numbers would let a client
 * re-derive that identity in IEEE-754 and disagree with the row it came from.
 * Nothing recomputes them here; they are carried through `::text` untouched.
 *
 * The lines are omitted, not hidden: they are on the drill-down,
 * `GET /quotation-revisions/{revisionId}`. A history of ten revisions each
 * carrying up to `MAX_ITEMS_PER_REVISION` priced lines is a response nobody
 * reads and a cost every reader pays.
 */
export interface RevisionHeaderView {
  readonly id: string;
  readonly quotationId: string;
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
  /**
   * True for the revision this quotation is currently offering.
   *
   * The parent's `current_revision_id` when it is set, and the HIGHEST revision
   * number when it is not. That second half is not a convenience: the column is
   * only written when a revision is ISSUED, so it is NULL for every quotation
   * still in draft - and `QuotationService.detail` already falls back the same
   * way, returning the latest revision as `currentRevision`. Reading only the
   * column would make the history claim no revision is current while the detail
   * endpoint names one, and two reads of the same document disagreeing about that
   * is worse than either answer alone.
   */
  readonly isCurrent: boolean;
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

/**
 * A quotation HEADER, for the list a work-order screen shows (P1-30 A2, S-07).
 *
 * `QuotationView` minus `currentRevision`. The list is deliberately not the
 * detail: rendering N quotations each with its revision and priced lines would
 * make one screen issue N+1 statements and would put every line of every
 * superseded document into a response nobody reads. `currentRevisionId` is
 * carried so the caller can follow the link to `GET /quotations/{id}`, which is
 * where the money lives.
 *
 * No amount appears here at all, so there is no decimal to preserve and no
 * partial total to mistake for a document total.
 */
export interface QuotationSummaryView {
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
}

const toSummary = (row: QuotationRow): QuotationSummaryView => ({
  id: row.id,
  quotationNumber: row.quotationNumber,
  workOrderId: row.workOrderId,
  companyId: row.companyId,
  branchId: row.branchId,
  currency: row.currencyCode,
  status: row.status,
  payerPartnerRef: row.payerPartnerRef,
  currentRevisionId: row.currentRevisionId,
  recordVersion: row.recordVersion,
});

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

const toRevisionHeader = (
  row: RevisionRow,
  currentRevisionId: string | null
): RevisionHeaderView => ({
  id: row.id,
  quotationId: row.quotationId,
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
  // Compared against the EFFECTIVE current revision the caller resolves once - the
  // parent's `current_revision_id`, or the latest revision when that is NULL.
  // Never derived from `status = 'issued'`, which would be a second and quietly
  // different truth: a quotation whose issued revision has since expired still
  // points at it, and `uq_quotation_revisions_one_issued` permits zero issued
  // revisions, not just one.
  isCurrent: currentRevisionId !== null && currentRevisionId === row.id,
});

const toRevisionView = (
  row: RevisionRow,
  lines: readonly ItemRow[],
  discountApproval: DiscountApprovalView | null
): RevisionView => ({
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
  discountApproval,
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

    // The database pinned the discount policy in force as it wrote the quotation
    // (`quo.pin_quotation_discount_policy`), and every revision of it — this first
    // one included — is measured against that version for the quotation's whole
    // life. A threshold change is prospective: this is where it takes effect.
    const pinned = await this.pinnedDiscountPolicy(db, quotation.id);
    const discount = await this.measureDiscount(db, {
      companyId: quotation.companyId,
      currency,
      lines: priced.discounts,
      asOf,
      pinned,
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

    const approval = await this.recordDiscountRequest(db, revision, discount, asOf, []);

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
        {
          field: 'discountPolicyVersion',
          classification: 'internal',
          value:
            pinned.threshold === null
              ? 'unconfigured'
              : `${pinned.threshold.policyId}:${pinned.threshold.versionNo}`,
        },
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

    return this.view(quotation, revision, items, approval);
  }

  /**
   * Creates a new draft revision, superseding nothing until it is issued.
   *
   * A commercial change never edits an issued revision — `quo.guard_quotation_item`
   * refuses item writes on a non-draft parent, which is what makes an issued
   * revision an immutable snapshot. So a revision is how a price change reaches a
   * customer, and the previous issued revision stays exactly as it was presented.
   *
   * ## Every revision is held to the quotation's pinned policy
   *
   * The new revision's discount is measured against the policy version the database
   * pinned when the QUOTATION was written, never against the company threshold of
   * the moment (P1-32-PRE-OD-DISC-07). Every open request is superseded by the new
   * revision — it can no longer be approved — and, when the discount needs approval
   * under the pinned version, a new pending request is recorded under it with the
   * signed-in person as its requester. So a requester who raises the threshold gains
   * nothing by revising, in one step or several: revising the discount away and back
   * again is measured against the same version each time, and the same discount still
   * waits for somebody else. A threshold change reaches new quotations only.
   */
  public async revise(
    db: DbHandle,
    quotationId: string,
    input: {
      readonly lines: readonly QuotationLineInput[];
      readonly customerClass?: string | undefined;
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
    // Under the quotation lock: the open requests this revision supersedes, and the
    // policy version the quotation is held to.
    const open = await this.repository.lockOpenDiscountApprovals(db, quotation.id);
    const pinned = await this.pinnedDiscountPolicy(db, quotation.id);
    const priced = await this.priceLines(db, {
      lines: input.lines,
      companyId: quotation.companyId,
      branchId: quotation.branchId,
      customerClass: input.customerClass ?? null,
      asOf,
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
    const discount = await this.measureDiscount(db, {
      companyId: quotation.companyId,
      currency: priced.currency,
      lines: priced.discounts,
      asOf,
      pinned,
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

    // The open requests are replaced by this revision first — the database refuses
    // a new request while one is open — and a new one is recorded under the pinned
    // version when the discount needs it.
    const superseded = await this.repository.supersedeDiscountApprovals(
      db,
      open.map((row) => row.id),
      revision.id
    );
    const approval = await this.recordDiscountRequest(db, revision, discount, asOf, superseded);

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
        ...(superseded.length === 0
          ? []
          : [
              {
                field: 'supersededDiscountApprovalIds',
                classification: 'internal' as const,
                value: superseded.join(','),
              },
              {
                field: 'discountPolicySnapshot',
                classification: 'internal' as const,
                value:
                  pinned.threshold === null ? 'unconfigured' : String(pinned.threshold.versionNo),
              },
            ]),
      ],
    });

    return toRevisionView(revision, items, approval);
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

    /**
     * A discount that needs approval is issued only once somebody other than the
     * requester has approved it, and only for the amount approved
     * (P1-32-PRE-OD-DISC-01, -04).
     *
     * Decided by the approval RECORD when there is one — never by re-measuring the
     * discount against the policy in force now: a later raise of the company
     * threshold must not let a pending discount through, and a later lowering must
     * not undo an approval. A revision with NO record is measured at the database
     * (`quo.revision_discount_needs_approval`) against the policy version its
     * quotation is held to (P1-32-PRE-OD-DISC-07).
     * `quo.guard_revision_discount_approval` refuses the same transition whatever
     * reaches the database, summing the lines itself; this names the reason for the
     * screen.
     */
    const approvalRow = await this.repository.findDiscountApprovalForRevision(db, revision.id);
    await this.assertDiscountIssuable(db, revision, approvalRow);

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

    return toRevisionView(
      issued,
      items,
      approvalRow === null
        ? null
        : await describeDiscountApproval(db, approvalRow, await this.repository.businessDate(db))
    );
  }

  /**
   * Refuses, by name, a revision whose discount is not approved for issue.
   *
   * `discount_approval_pending` / `_rejected` / `_superseded` — the recorded request
   * is not approved; `discount_approval_amount_mismatch` — the lines no longer carry
   * the discount that was approved; `discount_approval_required` — no request exists
   * and the discount needs one.
   */
  private async assertDiscountIssuable(
    db: DbHandle,
    revision: RevisionRow,
    approvalRow: DiscountApprovalRow | null
  ): Promise<void> {
    const refuseIssue = (rule: string, message: string): never => {
      throw new AppFailure('ERR-TRN-001', {
        message,
        // The whole request, not a control: the revision was chosen correctly, and
        // what stops it is the approval, which the screen states in its banner.
        safeDetails: { violations: [{ path: 'body', rule }] },
      });
    };
    if (approvalRow === null) {
      if (await this.repository.revisionDiscountNeedsApproval(db, revision.id)) {
        refuseIssue(
          'discount_approval_required',
          `Revision ${revision.revisionNumber} carries a discount that needs approval and none ` +
            'was requested. Revise the quotation to record a request for somebody else to approve.'
        );
      }
      return;
    }
    if (approvalRow.status === 'rejected') {
      refuseIssue(
        'discount_approval_rejected',
        `Revision ${revision.revisionNumber} carries a discount that was turned down`
      );
    }
    if (approvalRow.status === 'superseded') {
      refuseIssue(
        'discount_approval_superseded',
        `Revision ${revision.revisionNumber} carries a discount request a newer revision replaced`
      );
    }
    if (approvalRow.status !== 'approved') {
      refuseIssue(
        'discount_approval_pending',
        `Revision ${revision.revisionNumber} carries a discount still waiting for approval`
      );
    }
    const carried = await this.repository.revisionDiscountTotal(db, revision.id);
    if (
      carried === null ||
      approvalRow.approvedDiscountTotal === null ||
      approvalRow.approvedCurrencyCode !== carried.currency ||
      !Decimal.parse(carried.total, MONEY).equals(
        Decimal.parse(approvalRow.approvedDiscountTotal, MONEY)
      )
    ) {
      refuseIssue(
        'discount_approval_amount_mismatch',
        `Revision ${revision.revisionNumber} no longer carries the discount that was approved`
      );
    }
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

  /**
   * One work order's quotations, newest first (Phase 1-30 A2, seam S-07).
   *
   * ## Where the scope comes from
   *
   * From the WORK ORDER row, through `requireWorkOrder` — the same port
   * `create` uses, for the same reason. The route names no branch, so
   * `scope: 'branch'` would be inert on its own: `requiresScopedEvaluation`
   * returns false for an empty target whatever the declaration says, and the
   * check would fall through to the scope-blind `iam.has_permission`
   * (P1-18-A-01). RLS alone cannot contain that, because `app.branch_ids` is the
   * permission-blind union of every active grant.
   *
   * Deriving from the parent rather than from the quotations also settles what
   * an empty answer means. A work order in the caller's scope that has never
   * been quoted returns an empty page, which is the truth. A work order the
   * caller may not see is refused by `requireWorkOrder` with `ERR-RES-001`
   * BEFORE any quotation is read, so an empty page can never stand in for "you
   * are not allowed to know" — that would be an existence oracle.
   */
  public async listForWorkOrder(
    db: DbHandle,
    workOrderId: string,
    page: { cursor?: string | undefined; limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<QuotationSummaryView>> {
    const workOrder = await workOrderModule().workOrders.requireWorkOrder(
      db,
      workOrderId,
      authorizeScope
    );
    const request = pageRequest(QUOTATION_LIST_ORDERING, page);
    const result = await this.repository.listQuotationsForWorkOrder(db, workOrder.id, request);
    return { ...result, items: result.items.map(toSummary) };
  }

  /**
   * One quotation's revision history, newest first (Phase 1-30 A2, seam S-08).
   *
   * ## What was actually missing
   *
   * Not `listRevisions` — `detail` already calls it. What no caller could reach
   * is any revision OTHER than the current one: `detail` returns
   * `current_revision_id`'s lines and nothing else, so a superseded revision, a
   * rejected one and an expired one were all unreadable through the API even
   * though the rows are immutable and retained on purpose.
   *
   * ## Scope
   *
   * From the parent quotation's row, via `findQuotation` + `authorizeScope` —
   * the same derivation `detail` performs, for the same P1-18-A-01 reason. The
   * quotation is resolved FIRST, so a quotation the caller may not see is
   * `ERR-RES-001` before any revision is read; an empty page can therefore only
   * mean a visible quotation with no revisions.
   */
  public async listRevisionsFor(
    db: DbHandle,
    quotationId: string,
    page: { cursor?: string | undefined; limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<RevisionHeaderView>> {
    const quotation = await this.repository.findQuotation(db, quotationId);
    if (quotation === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Quotation ${quotationId} is not visible`,
      });
    }
    await authorizeScope({ companyId: quotation.companyId, branchId: quotation.branchId });

    // The EFFECTIVE current revision, resolved ONCE for the whole page.
    //
    // `current_revision_id` is written when a revision is issued, so it is NULL on
    // every draft quotation. `detail` already falls back to the latest revision in
    // that case; this read must fall back the same way or the two would disagree
    // about which revision a quotation is offering. The fallback reads the TOP row
    // of the same ordering this list uses, so the two cannot diverge - and it costs
    // one single-row indexed read, only on the NULL path.
    const currentRevisionId =
      quotation.currentRevisionId ??
      (await this.repository.listRevisionsPage(db, quotation.id, { limit: 1, cursor: null }))
        .items[0]?.id ??
      null;

    const request = pageRequest(REVISION_LIST_ORDERING, page);
    const result = await this.repository.listRevisionsPage(db, quotation.id, request);
    return {
      ...result,
      items: result.items.map((row) => toRevisionHeader(row, currentRevisionId)),
    };
  }

  /**
   * One revision with its priced lines, current or not (P1-30 A2, seam S-08).
   *
   * The drill-down the history list links to. `findRevision` and `listItems`
   * both already existed and are used unchanged; what is new is that a revision
   * which is NOT the quotation's current one can now be read at all.
   *
   * Scope comes from the revision row's own `company_id`/`branch_id`. Those are
   * immutable (`tg_quotation_revisions_immutable`) and the composite FK to
   * `quo.quotations` includes them, so the revision cannot carry a scope its
   * parent does not — authorizing the row is authorizing the document.
   */
  public async revisionDetail(
    db: DbHandle,
    revisionId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<RevisionView> {
    const revision = await this.repository.findRevision(db, revisionId);
    if (revision === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Quotation revision ${revisionId} is not visible`,
      });
    }
    await authorizeScope({ companyId: revision.companyId, branchId: revision.branchId });
    const items = await this.repository.listItems(db, revision.id);
    return toRevisionView(revision, items, await this.approvalOf(db, revision.id));
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
      if (latest === undefined) return this.view(quotation, null, [], null);
      const items = await this.repository.listItems(db, latest.id);
      return this.view(quotation, latest, items, await this.approvalOf(db, latest.id));
    }
    const revision = await this.repository.findRevision(db, quotation.currentRevisionId);
    const items = revision === null ? [] : await this.repository.listItems(db, revision.id);
    return this.view(
      quotation,
      revision,
      items,
      revision === null ? null : await this.approvalOf(db, revision.id)
    );
  }

  /** The discount approval recorded for one revision, rendered, or `null`. */
  private async approvalOf(db: DbHandle, revisionId: string): Promise<DiscountApprovalView | null> {
    const row = await this.repository.findDiscountApprovalForRevision(db, revisionId);
    return row === null
      ? null
      : describeDiscountApproval(db, row, await this.repository.businessDate(db));
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
   * Resolves a price, a tax rate and the discount position of every line.
   *
   * Returns repository-ready inputs — still no computed money, because the
   * arithmetic belongs to PostgreSQL. The single currency is established by the
   * first line and every subsequent line must match it; a mismatch is a hard
   * failure, never a conversion.
   *
   * Each line's discount and base are collected here and MEASURED afterwards
   * (`measureDiscount`), once the quotation — and so the policy version it is held
   * to — exists.
   */
  private async priceLines(
    db: DbHandle,
    context: {
      lines: readonly QuotationLineInput[];
      companyId: string;
      branchId: string;
      customerClass: string | null;
      asOf: string;
    }
  ): Promise<{
    currency: string;
    items: readonly NewItemInput[];
    discounts: readonly LineDiscount[];
  }> {
    const catalog = serviceCatalogModule().services;
    const pricing = pricingModule();
    const items: NewItemInput[] = [];
    const discounts: LineDiscount[] = [];
    let currency: string | null = null;
    let lineNumber = 0;

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
      discounts.push({ lineNumber, discount, base });

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
    return { currency, items, discounts };
  }

  /**
   * The policy version a quotation is held to, as the pricing module measures it:
   * `threshold: null` is "none was in force when it was written" — a threshold of
   * zero — and its approver needs the default permission.
   */
  private async pinnedDiscountPolicy(
    db: DbHandle,
    quotationId: string
  ): Promise<PinnedDiscountPolicy> {
    const row: QuotationDiscountPolicyRow | null = await this.repository.quotationDiscountPolicy(
      db,
      quotationId
    );
    if (row === null) {
      return { threshold: null, permissionCode: DEFAULT_DISCOUNT_APPROVAL_PERMISSION };
    }
    return {
      threshold: {
        policyId: row.policyId,
        versionNo: row.versionNo,
        kind: row.kind,
        value: row.value,
        currency: row.currency,
      },
      permissionCode: row.requiredPermissionCode,
    };
  }

  /**
   * Measures a revision's discounts against the version its quotation is held to.
   *
   * MEASURED, not authorized: whether the discount needs approval, and which policy
   * version said so. Approval is a separate act by a different person
   * (`DiscountApprovalService`), so nothing about the caller's own authority is
   * consulted. A malformed discount — negative, or larger than its line — is refused
   * here, whoever would approve it.
   */
  private async measureDiscount(
    db: DbHandle,
    context: {
      companyId: string;
      currency: string;
      lines: readonly LineDiscount[];
      asOf: string;
      pinned: PinnedDiscountPolicy;
    }
  ): Promise<DiscountSummary> {
    const pricing = pricingModule();
    // Document-level discount accounting. A per-line threshold check is defeated by
    // splitting one large discount across many lines, so the aggregate is measured
    // once at the end against the same version.
    let totalDiscount = '0.0000';
    // The document's pre-discount base, so the aggregate is measured against the
    // same ratio a single line of that size would be.
    let totalBase = '0.0000';
    let elevatedLines = 0;
    let appliedThreshold: DiscountThresholdSnapshot | null = null;
    let requiredPermission: string | null = null;

    for (const line of context.lines) {
      const assessment = await pricing.discounts.assess(
        db,
        {
          companyId: context.companyId,
          discountAmount: line.discount,
          currency: context.currency,
          lineBase: line.base,
          asOf: context.asOf,
        },
        context.pinned
      );
      totalDiscount = await this.addMoney(db, totalDiscount, line.discount);
      totalBase = await this.addMoney(db, totalBase, line.base);
      if (assessment.requiresApproval) {
        elevatedLines += 1;
        // Every line of one document is measured against the same pinned version, so
        // the last write is the version that applied — not a choice between several.
        appliedThreshold = assessment.threshold;
        requiredPermission = assessment.permissionCode;
      }
    }

    /**
     * The DOCUMENT-level measurement, through the SAME policy.
     *
     * A per-line measurement alone is defeated by splitting: `MAX_ITEMS_PER_REVISION`
     * is 200 and one service may occupy every line, so with a threshold of 50, two
     * hundred lines of 49.99 are each individually under it. The aggregate is
     * measured the way a single line of that size would be — the same `assess`, the
     * same policy, against the document's own discount and pre-discount base — so a
     * split discount needs approval exactly when the whole would.
     *
     * It runs only when something was actually discounted. A zero-discount quotation
     * needs no configuration and no approval.
     */
    let requiresApproval = elevatedLines > 0;
    if (!Decimal.parse(totalDiscount, MONEY).isZero) {
      const aggregate = await pricing.discounts.assess(
        db,
        {
          companyId: context.companyId,
          discountAmount: totalDiscount,
          currency: context.currency,
          lineBase: totalBase,
          asOf: context.asOf,
        },
        context.pinned
      );
      if (aggregate.requiresApproval) {
        requiresApproval = true;
        appliedThreshold = aggregate.threshold;
        requiredPermission = aggregate.permissionCode;
      }
    }

    return {
      total: totalDiscount,
      base: totalBase,
      currency: context.currency,
      requiresApproval,
      elevatedLines,
      permissionCode: requiredPermission,
      threshold: appliedThreshold,
    };
  }

  /**
   * Records that a revision's discount needs approval, and audits the request
   * (P1-32-PRE-OD-DISC-01).
   *
   * One request per revision: the approval is of the DOCUMENT's discount, because
   * the aggregate is what a split cannot hide. The requester is the signed-in person
   * — the repository takes it from the request context and row security refuses any
   * other — and the quotation's pinned policy version it was measured against is
   * copied onto the row; the database refuses any other snapshot, and any total the
   * lines do not carry.
   *
   * Nothing is written when no approval is needed: a discount under the threshold is
   * an ordinary edit anyone who may write the quotation may make.
   */
  private async recordDiscountRequest(
    db: DbHandle,
    revision: RevisionRow,
    summary: DiscountSummary,
    asOf: string,
    supersedes: readonly string[]
  ): Promise<DiscountApprovalView | null> {
    if (!summary.requiresApproval) return null;
    const approval = await this.repository.insertDiscountApproval(db, {
      companyId: revision.companyId,
      branchId: revision.branchId,
      quotationId: revision.quotationId,
      quotationRevisionId: revision.id,
      currencyCode: summary.currency,
      discountTotal: summary.total,
      discountBase: summary.base,
      elevatedLineCount: summary.elevatedLines,
      policyId: summary.threshold?.policyId ?? null,
      policyVersionNo: summary.threshold?.versionNo ?? null,
      thresholdKind: summary.threshold?.kind ?? null,
      thresholdValue: summary.threshold?.value ?? null,
      thresholdCurrencyCode: summary.threshold?.currency ?? null,
      requiredPermissionCode: summary.permissionCode ?? DEFAULT_DISCOUNT_APPROVAL_PERMISSION,
    });

    await appendAudit(db, {
      action: 'quo.discount_approval.requested',
      entityType: 'quo.discount_approval',
      entityId: approval.id,
      companyId: approval.companyId,
      branchId: approval.branchId,
      details: [
        { field: 'quotationRevisionId', classification: 'internal', value: revision.id },
        // The amount given away is what the business charges, so it carries the same
        // classification as every other price in the trail.
        { field: 'discountTotal', classification: 'restricted', value: approval.discountTotal },
        { field: 'currency', classification: 'public', value: approval.currencyCode },
        {
          field: 'elevatedLineCount',
          classification: 'public',
          value: String(approval.elevatedLineCount),
        },
        {
          field: 'requiredPermission',
          classification: 'internal',
          value: approval.requiredPermissionCode,
        },
        { field: 'requestedBy', classification: 'internal', value: approval.requestedBy },
        // A null policy is recorded as such rather than omitted: "no policy was
        // configured, so the threshold was zero" is the reason the discount needs
        // approval, and an absent field would read as "not applicable".
        {
          field: 'thresholdPolicyId',
          classification: 'internal',
          value: approval.policyId ?? 'unconfigured',
        },
        {
          field: 'thresholdVersionNo',
          classification: 'internal',
          value:
            approval.policyVersionNo === null ? 'unconfigured' : String(approval.policyVersionNo),
        },
        {
          field: 'thresholdKind',
          classification: 'internal',
          value: approval.thresholdKind ?? 'zero-by-default',
        },
        {
          field: 'thresholdValue',
          classification: 'internal',
          value: approval.thresholdValue ?? '0',
        },
        ...(supersedes.length === 0
          ? []
          : [
              {
                field: 'supersedesDiscountApprovalIds',
                classification: 'internal' as const,
                value: supersedes.join(','),
              },
            ]),
      ],
    });
    return describeDiscountApproval(db, approval, asOf);
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
    items: readonly ItemRow[],
    discountApproval: DiscountApprovalView | null
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
      currentRevision: revision === null ? null : toRevisionView(revision, items, discountApproval),
    };
  }
}

/** Re-exported so callers can reason about terminal revisions without the domain. */
export { isTerminalRevision, assertRevisionEditable };
