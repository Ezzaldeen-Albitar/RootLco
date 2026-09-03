/**
 * Price-list lifecycle (Phase 1-20, P1-20-BE-004).
 *
 * Create a list → add a draft version → put rules on it → publish. Four steps,
 * and the protected schema decides almost all of the rules:
 *
 *  - `tg_price_lists_immutable` freezes `currency_code`, so the currency chosen at
 *    creation denominates every amount ever attached to the list.
 *  - `svc.guard_price_rule_parent_frozen` refuses a rule write once the parent
 *    version is published, which is what makes published prices immutable.
 *  - `svc.publish_price_list_version` enforces forward-only succession: it closes
 *    the currently open published version at the new `effective_from` and refuses
 *    a date at or before that version's own start.
 *  - `ex_price_list_versions_no_published_overlap` is the gist backstop.
 *
 * So this service's job is the part the database cannot do: authorization, the
 * "a version with no rules must not be published" precondition, optimistic
 * concurrency on the list, the audit record, and the outbox event.
 *
 * ## Why publication is a separate permission
 *
 * `svc.price.manage` creates lists, versions and rules — all of which are drafts
 * nobody is charged against. `svc.price.publish` is the act that makes a set of
 * amounts the prices the tenant actually charges, and it is irreversible: a
 * published version may only be archived. Two codes, because the authority to
 * draft a price is not the authority to make it real.
 */
import type { DbHandle } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { SQLSTATE, isSqlState } from '@/server/db/repository';
import { publishEvent } from '@/server/events/publisher';
import { Decimal, MONEY } from '../domain/decimal';
import { assertCurrencyCode } from '../domain/money';
import { PricingRuleError } from '../domain/pricing';
import type {
  PriceListAssignmentRow,
  PriceListRow,
  PriceListVersionRow,
  PricingRepository,
} from '../data/pricing-repository';

export interface PriceListView {
  readonly id: string;
  readonly priceListCode: string;
  readonly name: string;
  readonly currency: string;
  readonly description: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

export interface PriceListVersionView {
  readonly id: string;
  readonly priceListId: string;
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly notes: string | null;
  readonly recordVersion: number;
}

export interface PriceRuleView {
  readonly id: string;
  /** A `numeric(18,4)` decimal STRING with the list's currency. Never a float. */
  readonly amount: string;
  readonly currency: string;
  readonly recordVersion: number;
}

export interface CreatePriceListInput {
  readonly priceListCode: string;
  readonly name: string;
  readonly currency: string;
  readonly description?: string | undefined;
}

export interface RecordPriceRuleInput {
  readonly serviceId: string;
  /** `numeric(18,4)` decimal STRING, non-negative. */
  readonly amount: string;
  readonly companyId?: string | undefined;
  readonly branchId?: string | undefined;
  readonly customerClass?: string | undefined;
  readonly taxClassId?: string | undefined;
  readonly priority?: number | undefined;
}

const toListView = (row: PriceListRow): PriceListView => ({
  id: row.id,
  priceListCode: row.priceListCode,
  name: row.name,
  currency: row.currencyCode,
  description: row.description,
  status: row.status,
  recordVersion: row.recordVersion,
});

const toVersionView = (row: PriceListVersionRow): PriceListVersionView => ({
  id: row.id,
  priceListId: row.priceListId,
  versionNo: row.versionNo,
  effectiveFrom: row.effectiveFrom,
  effectiveTo: row.effectiveTo,
  status: row.status,
  notes: row.notes,
  recordVersion: row.recordVersion,
});

/**
 * An assignment as the API renders it.
 *
 * No money. `svc.price_list_assignments` has no `numeric` column - it names a
 * book and a context, and the amounts live in that book's rules. `priority` is
 * `integer` and stays a JSON number.
 */
export interface PriceListAssignmentView {
  readonly id: string;
  readonly priceListId: string;
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly customerClass: string | null;
  readonly priority: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

export interface AssignPriceListInput {
  readonly priceListId: string;
  readonly companyId?: string | undefined;
  readonly branchId?: string | undefined;
  readonly customerClass?: string | undefined;
  readonly priority?: number | undefined;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | undefined;
}

export class PriceListService {
  public constructor(private readonly repository: PricingRepository) {}

  /** Tenant-wide price lists, bounded. */
  public async list(db: DbHandle, limit: number): Promise<readonly PriceListView[]> {
    const rows = await this.repository.listPriceLists(db, limit);
    return rows.map(toListView);
  }

  /**
   * Creates a price list.
   *
   * The currency is checked twice, for two different reasons. The ISO 4217 SHAPE is
   * checked here so a malformed code is a field-level 422. Whether that code is one
   * the platform actually supports is `shared.currencies`' decision —
   * `fk_price_lists_currency` references it — and that is deliberately NOT
   * duplicated as a list in this module: a second list would drift, and the
   * platform's supported set is reference data an operator maintains, not a
   * constant we ship. An unsupported code therefore arrives as a foreign-key
   * violation, which is mapped to a validation failure naming the field rather
   * than surfacing as a 500.
   *
   * No currency is defaulted or hard-coded anywhere on this path.
   */
  public async create(db: DbHandle, input: CreatePriceListInput): Promise<PriceListView> {
    const currency = assertCurrencyCode(input.currency);
    const created = await this.insertMappingConflicts(db, {
      priceListCode: input.priceListCode,
      name: input.name,
      currencyCode: currency,
      description: input.description ?? null,
    });

    await appendAudit(db, {
      action: 'svc.price_list.created',
      entityType: 'svc.price_list',
      entityId: created.id,
      details: [
        { field: 'priceListCode', classification: 'internal', value: created.priceListCode },
        // The currency is immutable from now on, so it is the fact worth recording.
        { field: 'currency', classification: 'public', value: created.currencyCode },
      ],
    });
    return toListView(created);
  }

  /**
   * Creates the next draft version.
   *
   * Takes the price list's lock first so two concurrent callers cannot compute the
   * same `MAX(version_no) + 1`; `uq_price_list_versions_no` is the backstop if the
   * lock is ever bypassed.
   */
  public async createVersion(
    db: DbHandle,
    priceListId: string,
    input: { effectiveFrom: string; notes?: string | undefined; expectedVersion: number }
  ): Promise<PriceListVersionView> {
    const list = await this.requireLockedList(db, priceListId, input.expectedVersion);
    const version = await this.repository.insertPriceListVersion(db, {
      priceListId: list.id,
      effectiveFrom: input.effectiveFrom,
      notes: input.notes ?? null,
    });

    await appendAudit(db, {
      action: 'svc.price_list_version.created',
      entityType: 'svc.price_list_version',
      entityId: version.id,
      details: [
        { field: 'priceListId', classification: 'internal', value: list.id },
        { field: 'versionNo', classification: 'public', value: String(version.versionNo) },
      ],
    });
    return toVersionView(version);
  }

  /**
   * Records one price rule on a draft version.
   *
   * The amount is parsed through the exact `Decimal` before it reaches SQL, so an
   * over-scale or non-decimal input is a field-level 422 rather than a driver
   * error, and a negative amount is refused here as well as by
   * `ck_price_rules_amount`.
   *
   * `ck_price_rules_tax_needs_company` forbids a tax class on a rule that is not
   * company-scoped, mirrored here so the caller learns which field is wrong.
   */
  public async recordRule(
    db: DbHandle,
    priceListId: string,
    versionId: string,
    input: RecordPriceRuleInput
  ): Promise<PriceRuleView> {
    const list = await this.repository.lockPriceList(db, priceListId);
    if (list === null) {
      throw new AppFailure('ERR-RES-001', { message: `Price list ${priceListId} is not visible` });
    }
    const version = await this.requireDraftVersion(db, list.id, versionId);

    const amount = Decimal.parse(input.amount, MONEY);
    if (amount.isNegative) {
      throw new AppFailure('ERR-VAL-001', { message: 'A price amount may not be negative' });
    }
    if (input.taxClassId !== undefined && input.companyId === undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A tax class may only be set on a company-scoped price rule',
        safeDetails: { violations: [{ path: 'body.taxClassId', rule: 'tax_needs_company' }] },
      });
    }
    /**
     * A branch selector must name a branch of the company it is paired with.
     *
     * `svc.price_rules` has NO foreign key on `company_id` or `branch_id` — only on
     * `service_id`, `tenant_id` and `price_list_version_id` — so nothing else stops an
     * incoherent or non-existent pair being stored. That matters twice over: the
     * scope authorization on the route is disjunctive across grant rows, and an
     * unverified branch would also file this rule's audit record under a scope the
     * caller may not hold.
     */
    if (input.branchId !== undefined) {
      if (input.companyId === undefined) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'A branch-scoped price rule must also name its company',
          safeDetails: { violations: [{ path: 'body.branchId', rule: 'branch_needs_company' }] },
        });
      }
      const coherent = await this.repository.branchBelongsToCompany(
        db,
        input.companyId,
        input.branchId
      );
      if (!coherent) {
        throw new AppFailure('ERR-VAL-001', {
          message: `Branch ${input.branchId} does not belong to company ${input.companyId}`,
          safeDetails: { violations: [{ path: 'body.branchId', rule: 'branch_company_mismatch' }] },
        });
      }
    }

    let rule: { id: string; amount: string; recordVersion: number };
    try {
      rule = await this.repository.insertPriceRule(db, {
        priceListVersionId: version.id,
        serviceId: input.serviceId,
        companyId: input.companyId ?? null,
        branchId: input.branchId ?? null,
        customerClass: input.customerClass ?? null,
        amount: amount.toString(),
        taxClassId: input.taxClassId ?? null,
        priority: input.priority ?? 0,
      });
    } catch (cause) {
      if (isSqlState(cause, SQLSTATE.uniqueViolation)) {
        // `uq_price_rules_signature` refused a second rule with the same
        // `(service, company, branch, customer_class, priority)` on this version.
        // That is the index that makes resolution deterministic — two such rules
        // would tie on both specificity and priority, leaving `svc.resolve_price`'s
        // `id` ordering to pick a customer's price. Surfaced as a conflict the
        // caller can fix by choosing a different priority.
        throw new AppFailure('ERR-CON-001', {
          message:
            'A price rule with the same scope and priority already exists on this version; ' +
            'give it a different priority so resolution stays deterministic',
          safeDetails: { violations: [{ path: 'body.priority', rule: 'duplicate_signature' }] },
        });
      }
      throw cause;
    }

    await appendAudit(db, {
      action: 'svc.price_rule.recorded',
      entityType: 'svc.price_rules',
      entityId: rule.id,
      // The amount IS the point of the record and is classified `restricted`: a
      // price list is what the business charges every customer segment.
      ...(input.companyId === undefined ? {} : { companyId: input.companyId }),
      ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
      details: [
        { field: 'priceListVersionId', classification: 'internal', value: version.id },
        { field: 'serviceId', classification: 'internal', value: input.serviceId },
        { field: 'amount', classification: 'restricted', value: rule.amount },
        { field: 'currency', classification: 'public', value: list.currencyCode },
      ],
    });

    return {
      id: rule.id,
      amount: rule.amount,
      currency: list.currencyCode,
      recordVersion: rule.recordVersion,
    };
  }

  /**
   * Publishes a draft version, making its amounts the prices the tenant charges.
   *
   * The one precondition the database does not enforce: a version with no active
   * rules must not be published. `svc.publish_price_list_version` would accept it,
   * and the result would be a published version that resolves no price for
   * anything — every quotation line against it would then fail with "no price is
   * configured", far from here and for a reason that looks like a data problem.
   */
  public async publishVersion(
    db: DbHandle,
    priceListId: string,
    versionId: string,
    input: { effectiveFrom: string; expectedVersion: number }
  ): Promise<PriceListVersionView> {
    const list = await this.requireLockedList(db, priceListId, input.expectedVersion);
    const version = await this.requireDraftVersion(db, list.id, versionId);

    const rules = await this.repository.countPriceRules(db, version.id);
    if (rules === 0) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A price-list version with no rules cannot be published',
      });
    }

    await this.repository.publishPriceListVersion(db, {
      priceListId: list.id,
      versionId: version.id,
      effectiveFrom: input.effectiveFrom,
    });

    // Re-read, so the response and the event carry what the function decided —
    // including the `effective_from` it wrote, which may differ from the
    // provisional date the draft was created with.
    const published = await this.repository.findPriceListVersion(db, version.id);
    if (published === null || published.status !== 'published') {
      throw new AppFailure('ERR-SYS-001', { message: `Version ${version.id} was not published` });
    }

    await appendAudit(db, {
      action: 'svc.price_list_version.published',
      entityType: 'svc.price_list_version',
      entityId: published.id,
      details: [
        { field: 'priceListId', classification: 'internal', value: list.id },
        { field: 'versionNo', classification: 'public', value: String(published.versionNo) },
        { field: 'effectiveFrom', classification: 'public', value: published.effectiveFrom },
        { field: 'ruleCount', classification: 'public', value: String(rules) },
      ],
    });

    await publishEvent(db, {
      eventType: 'price-list.published',
      aggregateId: published.id,
      aggregateVersion: published.recordVersion,
      // The producer's leading segment must equal the catalog owner of the event
      // (), which publishEvent enforces. It is the MODULE name, not the
      // schema name -  here was rejected at runtime.
      producer: 'pricing.price-list-service',
      // No amounts. A consumer that may see prices reads them under its own
      // authorization; an event is a notification, not a bypass of the read model.
      payload: {
        priceListId: list.id,
        priceListCode: list.priceListCode,
        versionId: published.id,
        versionNo: published.versionNo,
        currency: list.currencyCode,
        effectiveFrom: published.effectiveFrom,
      },
      // A version reaches `published` at most once — the freeze guard allows only
      // `published → archived` afterwards — so the key needs no version and a
      // retry collides rather than publishing twice.
      eventKey: `price-list.published:${published.id}`,
    });

    return toVersionView(published);
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Inserts a price list, mapping the two constraint violations a caller can cause
   * onto catalog errors instead of letting them become 500s.
   *
   * `uq_price_lists_code` — a duplicate code is a conflict the caller can resolve by
   * choosing another, so it is `ERR-CON-001`, not a server fault.
   * `fk_price_lists_currency` — an unsupported currency is bad input naming a
   * specific field, so it is `ERR-VAL-001`.
   *
   * Both were genuinely reaching the client as `ERR-SYS-001` before this mapping,
   * which told a caller nothing actionable and marked the failure as monitored.
   */
  /**
   * Assigns a price list to a scope context.
   *
   * `svc.resolve_price` requires an ACTIVE assignment row covering the context
   * before it will return anything, and nothing in the product could write one -
   * so every price resolution on every API-created tenant answered "no price
   * configured" (A0 F-02, seam S-04).
   *
   * ## Why the conflict message names the CONTEXT and not the price list
   *
   * `uq_price_list_assignments_signature` is
   * `(tenant_id, company_id, branch_id, customer_class, priority) NULLS NOT DISTINCT`
   * where the row is active - and `price_list_id` is deliberately NOT in it.
   * That is what the table comment means by "exactly one price list" per
   * context: two books cannot both claim the same context at the same priority,
   * because `svc.resolve_price` would then have to arbitrate between them.
   *
   * The consequence is that a create can be refused by a row belonging to a
   * DIFFERENT price list - one the caller may not even be looking at. It is why
   * the route is the top-level `/price-list-assignments` rather than nested
   * under a price list: the invariant is not scoped to one.
   *
   * What the CALLER actually receives is the violation, not this message:
   * `problemFor` builds the response from the error catalogue plus `safeDetails`,
   * and an `AppFailure` message never crosses the wire. So the caller-visible
   * signal is `{path: 'body.priority', rule: 'context_already_assigned'}` - which
   * says the context is taken rather than that this price list is - and the
   * response deliberately names no price-list id at all. The message below is
   * server-side only, for the log.
   */
  public async assign(
    db: DbHandle,
    input: AssignPriceListInput
  ): Promise<PriceListAssignmentView> {
    // Lock the list rather than merely read it: an assignment naming a list that
    // is being deactivated in a concurrent transaction must not slip in behind
    // the status check.
    const list = await this.repository.lockPriceList(db, input.priceListId);
    if (list === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Price list ${input.priceListId} is not visible`,
      });
    }
    if (list.status !== 'active') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Price list ${list.priceListCode} is ${list.status} and cannot be assigned`,
      });
    }

    // A branch that does not belong to the named company would otherwise be
    // authorized against whichever half happens to match - `iam.has_permission_in_scope`
    // is disjunctive across scope rows. The same check `recordRule` makes.
    if (input.companyId !== undefined && input.branchId !== undefined) {
      const coherent = await this.repository.branchBelongsToCompany(
        db,
        input.companyId,
        input.branchId
      );
      if (!coherent) {
        throw new AppFailure('ERR-VAL-001', {
          message: `Branch ${input.branchId} does not belong to company ${input.companyId}`,
          safeDetails: {
            violations: [{ path: 'body.branchId', rule: 'branch_company_mismatch' }],
          },
        });
      }
    }

    const priority = input.priority ?? 0;
    let created: PriceListAssignmentRow;
    try {
      created = await this.repository.insertPriceListAssignment(db, {
        priceListId: input.priceListId,
        companyId: input.companyId ?? null,
        branchId: input.branchId ?? null,
        customerClass: input.customerClass ?? null,
        priority,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      });
    } catch (cause) {
      if (isSqlState(cause, SQLSTATE.uniqueViolation)) {
        const context = [
          input.companyId === undefined ? 'any company' : `company ${input.companyId}`,
          input.branchId === undefined ? 'any branch' : `branch ${input.branchId}`,
          input.customerClass === undefined
            ? 'any customer class'
            : `customer class ${input.customerClass}`,
        ].join(', ');
        throw new AppFailure('ERR-CON-001', {
          message:
            `An active price-list assignment already covers ${context} at priority ` +
            `${priority}. The uniqueness is on the CONTEXT, not on the price list, so the ` +
            'existing assignment may name a different price list. Use another priority, or ' +
            'deactivate the existing assignment.',
          safeDetails: {
            violations: [{ path: 'body.priority', rule: 'context_already_assigned' }],
          },
        });
      }
      if (isSqlState(cause, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: `Price list ${input.priceListId} is not visible`,
          safeDetails: { violations: [{ path: 'body.priceListId', rule: 'unknown_price_list' }] },
        });
      }
      throw cause;
    }

    await appendAudit(db, {
      action: 'svc.price_list_assignment.created',
      entityType: 'svc.price_list_assignment',
      entityId: created.id,
      details: [
        { field: 'priceListId', classification: 'internal', value: created.priceListId },
        { field: 'companyId', classification: 'internal', value: created.companyId ?? 'any' },
        { field: 'branchId', classification: 'internal', value: created.branchId ?? 'any' },
        {
          field: 'customerClass',
          classification: 'internal',
          value: created.customerClass ?? 'any',
        },
        { field: 'priority', classification: 'public', value: String(created.priority) },
        { field: 'effectiveFrom', classification: 'internal', value: created.effectiveFrom },
      ],
    });

    return created;
  }

  private async insertMappingConflicts(
    db: DbHandle,
    input: {
      priceListCode: string;
      name: string;
      currencyCode: string;
      description: string | null;
    }
  ): Promise<PriceListRow> {
    try {
      return await this.repository.insertPriceList(db, input);
    } catch (cause) {
      if (isSqlState(cause, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-CON-001', {
          message: `A price list with code "${input.priceListCode}" already exists`,
          safeDetails: { violations: [{ path: 'body.priceListCode', rule: 'duplicate_code' }] },
        });
      }
      if (isSqlState(cause, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-VAL-001', {
          message: `Currency "${input.currencyCode}" is not a currency this platform supports`,
          safeDetails: { violations: [{ path: 'body.currency', rule: 'unsupported_currency' }] },
        });
      }
      throw cause;
    }
  }

  private async requireLockedList(
    db: DbHandle,
    priceListId: string,
    expectedVersion: number
  ): Promise<PriceListRow> {
    const list = await this.repository.lockPriceList(db, priceListId);
    if (list === null) {
      throw new AppFailure('ERR-RES-001', { message: `Price list ${priceListId} is not visible` });
    }
    if (list.recordVersion !== expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Price list ${priceListId} was modified by another request`,
      });
    }
    if (list.status !== 'active') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Price list ${priceListId} is ${list.status} and accepts no changes`,
      });
    }
    return list;
  }

  /**
   * The version, proven to belong to this list AND to still be a draft.
   *
   * Both halves matter: a version id from another price list would otherwise be
   * published under this list's lock, and a non-draft version is frozen by
   * `svc.guard_price_list_version_freeze`.
   */
  private async requireDraftVersion(
    db: DbHandle,
    priceListId: string,
    versionId: string
  ): Promise<PriceListVersionRow> {
    const version = await this.repository.findPriceListVersion(db, versionId);
    if (version === null || version.priceListId !== priceListId) {
      throw new AppFailure('ERR-RES-001', {
        message: `Version ${versionId} does not belong to price list ${priceListId}`,
      });
    }
    if (version.status !== 'draft') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Version ${version.versionNo} is ${version.status}; only a draft may be changed`,
      });
    }
    return version;
  }
}

/** Re-exported so a caller can surface a domain rule failure as a 422. */
export { PricingRuleError };
