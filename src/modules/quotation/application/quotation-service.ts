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
import { pricingModule, type PermissionProbe } from '@/modules/pricing';
import { sharedServicesModule } from '@/modules/shared-services';
import { workOrderModule } from '@/modules/work-order';
import {
  MAX_ITEMS_PER_REVISION,
  QuotationRuleError,
  assertRevisionEditable,
  hasExpired,
  isTerminalRevision,
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
   * Expires issued revisions whose `expires_at` has passed.
   *
   * Bounded and idempotent. The lapse test is the database's `now()`, so the
   * sweep and the per-request expiry check cannot disagree. A revision that a
   * concurrent decision has already moved out of `issued` is skipped rather than
   * forced — `quo.guard_quotation_revision_freeze` treats
   * `superseded`/`rejected`/`expired` as terminal, so forcing would be an error,
   * and the decision that got there first is the truth.
   */
  public async expireLapsed(db: DbHandle, limit: number): Promise<readonly string[]> {
    const lapsed = await this.repository.listLapsedRevisions(db, limit);
    const expired: string[] = [];

    for (const candidate of lapsed) {
      // Take the parent lock first, then re-read the revision under it: between
      // the sweep query and here, a decision may have superseded or rejected it.
      const quotation = await this.repository.lockQuotation(db, candidate.quotationId);
      if (quotation === null) continue;
      const current = await this.repository.lockRevision(db, candidate.id);
      if (current === null || current.status !== 'issued') continue;
      if (!hasExpired(current.expiresAt, new Date())) continue;

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
  ): Promise<{ currency: string; items: readonly NewItemInput[] }> {
    const catalog = serviceCatalogModule().services;
    const pricing = pricingModule();
    const items: NewItemInput[] = [];
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
      // The base a percentage discount applies to. Computed by the database so the
      // authorization check and the stored line agree exactly.
      const base = await this.lineBase(db, price.unitPrice, line.quantity);
      await pricing.discounts.authorize(
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
    return { currency, items };
  }

  /**
   * `round(unit * qty, 4)` computed by PostgreSQL.
   *
   * Needed by the discount ceiling check *before* the row exists. It is computed
   * in SQL, at the column's own precision and scale, so the number the
   * authorization compares is byte-identical to the base the stored line will
   * use — a TypeScript multiplication here could authorize a discount the CHECK
   * constraint then rejects, or worse, accept one it should not.
   */
  private async lineBase(db: DbHandle, unitPrice: string, quantity: string): Promise<string> {
    const row = await db.query<{ base: string }>(
      `SELECT round($1::numeric(18,4) * $2::numeric(12,3), 4)::text AS base`,
      [unitPrice, quantity]
    );
    const base = row.rows[0]?.base;
    if (base === undefined) {
      throw new AppFailure('ERR-SYS-001', { message: 'Could not compute the line base' });
    }
    return base;
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
