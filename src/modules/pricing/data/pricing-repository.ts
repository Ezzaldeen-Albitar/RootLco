/**
 * Pricing SQL (Phase 1-20, P1-20-BE-004…006).
 *
 * Owns the pricing half of `svc` — price lists, versions, rules, assignments,
 * discount rules, approval policies — plus the `org.tax_*` reads, which no other
 * module touches.
 *
 * ## Why price resolution is a function call, not a query here
 *
 * `svc.resolve_price` already encodes the precedence: specificity score
 * `branch*4 + company*2 + customer_class*1` DESC, then `priority` DESC, then `id`
 * as a total-order tiebreak. Re-implementing that ordering in TypeScript would
 * create a second definition that can disagree with the one the database uses,
 * and the disagreement would show up as a wrong price rather than as an error.
 * So this repository calls the function and never reproduces its logic.
 *
 * The function returns **zero or one** row. Zero means "no price is configured
 * for this combination", which is a commercial answer the caller must handle —
 * not an exception, and never a silent zero.
 *
 * ## Ambiguity
 *
 * `svc.resolve_price` cannot return two rows, so it cannot express ambiguity.
 * `countCandidatePrices` exists to detect the case the function silently breaks
 * with `id`: two rules of equal specificity AND equal priority. The application
 * turns that into a deterministic configuration conflict rather than shipping a
 * price that depends on a UUID.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

/** One row of `svc.resolve_price`. All amounts are STRINGS — `numeric(18,4)`. */
export interface ResolvedPriceRow {
  readonly priceRuleId: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly taxClassId: string | null;
}

export interface PriceListRow {
  readonly id: string;
  readonly priceListCode: string;
  readonly name: string;
  readonly currencyCode: string;
  readonly description: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

export interface PriceListVersionRow {
  readonly id: string;
  readonly priceListId: string;
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly notes: string | null;
  readonly recordVersion: number;
}

export interface DiscountRuleRow {
  readonly id: string;
  readonly discountCode: string;
  readonly name: string;
  readonly discountType: string;
  /** `numeric(18,4)` STRING. A percentage in 0..100, or an amount in `currencyCode`. */
  readonly value: string;
  readonly currencyCode: string | null;
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly customerClass: string | null;
  readonly serviceId: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

export interface ApprovalPolicyRow {
  readonly id: string;
  readonly companyId: string | null;
  readonly policyType: string;
  readonly thresholdKind: string;
  /** `numeric(18,4)` STRING. */
  readonly thresholdValue: string;
  readonly currencyCode: string | null;
  readonly requiredPermissionCode: string;
  readonly makerApproverDistinct: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
}

/** An effective tax rate. `rate` is a FRACTION in [0,1] — `numeric(9,6)` STRING. */
export interface TaxRateRow {
  readonly taxClassId: string;
  readonly taxClassCode: string;
  readonly rate: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export class PricingRepository extends Repository {
  protected readonly module = 'pricing';

  /**
   * The server's business date, as `YYYY-MM-DD`.
   *
   * Read from the database rather than the Node clock, so the date used to resolve
   * a price is the same clock `svc.resolve_price` and every effective-range
   * predicate uses. A caller-supplied date is honoured only where the contract
   * says so; it is never inferred from the process.
   */
  public async businessDate(db: DbHandle): Promise<string> {
    const row = await this.runOne<{ business_date: string }>(
      db,
      `SELECT current_date::text AS business_date`
    );
    if (row === null) throw new Error('pricing: could not read the server business date');
    return row.business_date;
  }

  /**
   * Resolves the single winning price, or `null` when none is configured.
   *
   * `p_as_of` is a `date`, so the caller must pass a server-derived business date
   * — never a client-supplied timestamp, which would let a caller pick a price
   * from a period they are not trading in.
   */
  public async resolvePrice(
    db: DbHandle,
    input: {
      serviceId: string;
      companyId: string;
      branchId: string;
      customerClass: string | null;
      asOf: string;
    }
  ): Promise<ResolvedPriceRow | null> {
    const row = await this.runOne<{
      price_rule_id: string;
      amount: string;
      currency_code: string;
      tax_class_id: string | null;
    }>(
      db,
      `SELECT price_rule_id, amount, currency_code, tax_class_id
         FROM svc.resolve_price($1, $2, $3, $4, $5::date)`,
      [input.serviceId, input.companyId, input.branchId, input.customerClass, input.asOf]
    );
    return row
      ? {
          priceRuleId: row.price_rule_id,
          amount: row.amount,
          currencyCode: row.currency_code,
          taxClassId: row.tax_class_id,
        }
      : null;
  }

  /**
   * How many price rules tie for the winning specificity AND priority.
   *
   * Mirrors `svc.resolve_price`'s filter and its specificity expression exactly,
   * then counts the rules sharing the top `(specificity, priority)` pair. A count
   * above one means the configuration is ambiguous and the function's `id`
   * tiebreak is the only thing choosing — which is deterministic but arbitrary,
   * and therefore a configuration error worth surfacing.
   */
  public async countTiedPriceRules(
    db: DbHandle,
    input: {
      serviceId: string;
      companyId: string;
      branchId: string;
      customerClass: string | null;
      asOf: string;
    }
  ): Promise<number> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ tied: string }>(
      db,
      `WITH winning_list AS (
         SELECT a.price_list_id
           FROM svc.price_list_assignments a
          WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL
            AND a.effective_from <= $6::date
            AND (a.effective_to IS NULL OR a.effective_to > $6::date)
            AND (a.company_id IS NULL OR a.company_id = $3)
            AND (a.branch_id IS NULL OR a.branch_id = $4)
            AND (a.customer_class IS NULL OR a.customer_class = $5)
          ORDER BY (CASE WHEN a.branch_id IS NOT NULL THEN 4 ELSE 0 END
                  + CASE WHEN a.company_id IS NOT NULL THEN 2 ELSE 0 END
                  + CASE WHEN a.customer_class IS NOT NULL THEN 1 ELSE 0 END) DESC,
                   a.priority DESC, a.id
          LIMIT 1),
       winning_version AS (
         SELECT plv.id
           FROM svc.price_list_versions plv
           JOIN winning_list wl ON wl.price_list_id = plv.price_list_id
          WHERE plv.tenant_id = $1 AND plv.status = 'published' AND plv.deleted_at IS NULL
            AND plv.effective_from <= $6::date
            AND (plv.effective_to IS NULL OR plv.effective_to > $6::date)
          ORDER BY plv.effective_from DESC
          LIMIT 1),
       candidates AS (
         SELECT r.id,
                (CASE WHEN r.branch_id IS NOT NULL THEN 4 ELSE 0 END
               + CASE WHEN r.company_id IS NOT NULL THEN 2 ELSE 0 END
               + CASE WHEN r.customer_class IS NOT NULL THEN 1 ELSE 0 END) AS specificity,
                r.priority
           FROM svc.price_rules r
           JOIN winning_version wv ON wv.id = r.price_list_version_id
          WHERE r.tenant_id = $1 AND r.service_id = $2
            AND r.status = 'active' AND r.deleted_at IS NULL
            AND (r.company_id IS NULL OR r.company_id = $3)
            AND (r.branch_id IS NULL OR r.branch_id = $4)
            AND (r.customer_class IS NULL OR r.customer_class = $5))
       SELECT count(*)::text AS tied
         FROM candidates c
        WHERE (c.specificity, c.priority) =
              (SELECT c2.specificity, c2.priority FROM candidates c2
                ORDER BY c2.specificity DESC, c2.priority DESC LIMIT 1)`,
      [
        context.principal.tenantId,
        input.serviceId,
        input.companyId,
        input.branchId,
        input.customerClass,
        input.asOf,
      ]
    );
    return row ? Number.parseInt(row.tied, 10) : 0;
  }

  /**
   * The effective tax rate for a class on a date, or `null` when none applies.
   *
   * `null` is NOT zero. A service whose price rule names a tax class that has no
   * effective rate is a configuration error; treating it as untaxed would
   * under-charge silently, so the application refuses the line instead.
   */
  public async findTaxRate(
    db: DbHandle,
    companyId: string,
    taxClassId: string,
    asOf: string
  ): Promise<TaxRateRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      tax_class_id: string;
      tax_class_code: string;
      rate: string;
      effective_from: string;
      effective_to: string | null;
    }>(
      db,
      `SELECT tr.tax_class_id, tc.tax_class_code, tr.rate, tr.effective_from, tr.effective_to
         FROM org.tax_rates tr
         JOIN org.tax_classes tc
           ON tc.tenant_id = tr.tenant_id AND tc.id = tr.tax_class_id
        WHERE tr.tenant_id = $1 AND tr.company_id = $2 AND tr.tax_class_id = $3
          AND tr.status = 'active' AND tr.deleted_at IS NULL
          AND tc.status = 'active' AND tc.deleted_at IS NULL
          AND tr.effective_from <= $4::date
          AND (tr.effective_to IS NULL OR tr.effective_to > $4::date)
        ORDER BY tr.effective_from DESC
        LIMIT 1`,
      [context.principal.tenantId, companyId, taxClassId, asOf]
    );
    return row
      ? {
          taxClassId: row.tax_class_id,
          taxClassCode: row.tax_class_code,
          rate: row.rate,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
        }
      : null;
  }

  /**
   * The active approval policy for a company and policy type.
   *
   * `uq_pricing_approval_policies_scope` is `NULLS NOT DISTINCT` on
   * `(tenant, company, policy_type)` where active, so there is at most one
   * company-specific row and at most one tenant-wide row (`company_id IS NULL`).
   * The company-specific row wins — the same platform/tenant override shape the
   * rest of the catalog uses.
   */
  public async findApprovalPolicy(
    db: DbHandle,
    companyId: string,
    policyType: string,
    asOf: string
  ): Promise<ApprovalPolicyRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string | null;
      policy_type: string;
      threshold_kind: string;
      threshold_value: string;
      currency_code: string | null;
      required_permission_code: string;
      maker_approver_distinct: boolean;
      effective_from: string;
      effective_to: string | null;
      status: string;
    }>(
      db,
      `SELECT id, company_id, policy_type, threshold_kind, threshold_value, currency_code,
              required_permission_code, maker_approver_distinct, effective_from, effective_to, status
         FROM svc.pricing_approval_policies
        WHERE tenant_id = $1 AND policy_type = $2
          AND status = 'active' AND deleted_at IS NULL
          AND (company_id IS NULL OR company_id = $3)
          AND effective_from <= $4::date
          AND (effective_to IS NULL OR effective_to > $4::date)
        ORDER BY (company_id IS NOT NULL) DESC, id
        LIMIT 1`,
      [context.principal.tenantId, policyType, companyId, asOf]
    );
    return row
      ? {
          id: row.id,
          companyId: row.company_id,
          policyType: row.policy_type,
          thresholdKind: row.threshold_kind,
          thresholdValue: row.threshold_value,
          currencyCode: row.currency_code,
          requiredPermissionCode: row.required_permission_code,
          makerApproverDistinct: row.maker_approver_distinct,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          status: row.status,
        }
      : null;
  }

  /** Reads a price list by id, or null outside the caller's tenant. */
  public async findPriceList(db: DbHandle, priceListId: string): Promise<PriceListRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      price_list_code: string;
      name: string;
      currency_code: string;
      description: string | null;
      status: string;
      record_version: number;
    }>(
      db,
      `SELECT id, price_list_code, name, currency_code, description, status, record_version
         FROM svc.price_lists
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, priceListId]
    );
    return row
      ? {
          id: row.id,
          priceListCode: row.price_list_code,
          name: row.name,
          currencyCode: row.currency_code,
          description: row.description,
          status: row.status,
          recordVersion: row.record_version,
        }
      : null;
  }

  /** The discount rule identified by code, if it is live on `asOf`. */
  public async findDiscountRule(
    db: DbHandle,
    discountCode: string,
    asOf: string
  ): Promise<DiscountRuleRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      discount_code: string;
      name: string;
      discount_type: string;
      value: string;
      currency_code: string | null;
      company_id: string | null;
      branch_id: string | null;
      customer_class: string | null;
      service_id: string | null;
      effective_from: string;
      effective_to: string | null;
      status: string;
      record_version: number;
    }>(
      db,
      `SELECT id, discount_code, name, discount_type, value, currency_code, company_id,
              branch_id, customer_class, service_id, effective_from, effective_to, status,
              record_version
         FROM svc.discount_rules
        WHERE tenant_id = $1 AND discount_code = $2 AND deleted_at IS NULL
          AND status = 'active'
          AND effective_from <= $3::date
          AND (effective_to IS NULL OR effective_to > $3::date)`,
      [context.principal.tenantId, discountCode, asOf]
    );
    return row
      ? {
          id: row.id,
          discountCode: row.discount_code,
          name: row.name,
          discountType: row.discount_type,
          value: row.value,
          currencyCode: row.currency_code,
          companyId: row.company_id,
          branchId: row.branch_id,
          customerClass: row.customer_class,
          serviceId: row.service_id,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          status: row.status,
          recordVersion: row.record_version,
        }
      : null;
  }

  /**
   * Lists price lists for the caller's tenant, newest code first.
   *
   * `svc.price_lists` has no `company_id` or `branch_id` — a list is tenant-wide
   * reference data and it is `svc.price_list_assignments` that binds it to a
   * company, branch or customer class. So this read is tenant-scoped, and the
   * permission (`svc.price.read`) is what makes it privileged rather than a scope
   * target.
   */
  public async listPriceLists(db: DbHandle, limit: number): Promise<readonly PriceListRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      price_list_code: string;
      name: string;
      currency_code: string;
      description: string | null;
      status: string;
      record_version: number;
    }>(
      db,
      `SELECT id, price_list_code, name, currency_code, description, status, record_version
         FROM svc.price_lists
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY price_list_code, id
        LIMIT $2`,
      [context.principal.tenantId, limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      priceListCode: row.price_list_code,
      name: row.name,
      currencyCode: row.currency_code,
      description: row.description,
      status: row.status,
      recordVersion: row.record_version,
    }));
  }

  /**
   * Creates a price list.
   *
   * `currency_code` is immutable from this moment — `tg_price_lists_immutable`
   * freezes it — so the currency chosen here denominates every amount ever
   * attached to this list. There is no conversion path afterwards.
   */
  public async insertPriceList(
    db: DbHandle,
    input: {
      priceListCode: string;
      name: string;
      currencyCode: string;
      description: string | null;
    }
  ): Promise<PriceListRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      price_list_code: string;
      name: string;
      currency_code: string;
      description: string | null;
      status: string;
      record_version: number;
    }>(
      db,
      `INSERT INTO svc.price_lists
         (tenant_id, price_list_code, name, currency_code, description, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'active',$6)
       RETURNING id, price_list_code, name, currency_code, description, status, record_version`,
      [
        context.principal.tenantId,
        input.priceListCode,
        input.name,
        input.currencyCode,
        input.description,
        context.principal.userId,
      ]
    );
    if (row === null) throw new Error('pricing: price-list insert returned no row');
    return {
      id: row.id,
      priceListCode: row.price_list_code,
      name: row.name,
      currencyCode: row.currency_code,
      description: row.description,
      status: row.status,
      recordVersion: row.record_version,
    };
  }

  /** Locks a price list, so a version or publication cannot race another. */
  public async lockPriceList(db: DbHandle, priceListId: string): Promise<PriceListRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      price_list_code: string;
      name: string;
      currency_code: string;
      description: string | null;
      status: string;
      record_version: number;
    }>(
      db,
      `SELECT id, price_list_code, name, currency_code, description, status, record_version
         FROM svc.price_lists
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, priceListId]
    );
    return row
      ? {
          id: row.id,
          priceListCode: row.price_list_code,
          name: row.name,
          currencyCode: row.currency_code,
          description: row.description,
          status: row.status,
          recordVersion: row.record_version,
        }
      : null;
  }

  /**
   * Creates the next draft version of a price list.
   *
   * `version_no` is `MAX + 1` in the same statement, under the parent's lock;
   * `uq_price_list_versions_no` is the backstop if two callers somehow read the
   * same maximum. `effective_from` is provisional — `svc.publish_price_list_version`
   * overwrites it at publication, which is what makes forward-only succession the
   * database's decision rather than the caller's.
   */
  public async insertPriceListVersion(
    db: DbHandle,
    input: { priceListId: string; effectiveFrom: string; notes: string | null }
  ): Promise<PriceListVersionRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      price_list_id: string;
      version_no: number;
      effective_from: string;
      effective_to: string | null;
      status: string;
      notes: string | null;
      record_version: number;
    }>(
      db,
      `INSERT INTO svc.price_list_versions
         (tenant_id, price_list_id, version_no, effective_from, status, notes, created_by)
       SELECT $1, $2, COALESCE(MAX(v.version_no), 0) + 1, $3::date, 'draft', $4, $5
         FROM svc.price_list_versions v
        WHERE v.tenant_id = $1 AND v.price_list_id = $2
       RETURNING id, price_list_id, version_no, effective_from::text AS effective_from,
                 effective_to::text AS effective_to, status, notes, record_version`,
      [
        context.principal.tenantId,
        input.priceListId,
        input.effectiveFrom,
        input.notes,
        context.principal.userId,
      ]
    );
    if (row === null) throw new Error('pricing: version insert returned no row');
    return {
      id: row.id,
      priceListId: row.price_list_id,
      versionNo: row.version_no,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      status: row.status,
      notes: row.notes,
      recordVersion: row.record_version,
    };
  }

  public async findPriceListVersion(
    db: DbHandle,
    versionId: string
  ): Promise<PriceListVersionRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      price_list_id: string;
      version_no: number;
      effective_from: string;
      effective_to: string | null;
      status: string;
      notes: string | null;
      record_version: number;
    }>(
      db,
      `SELECT id, price_list_id, version_no, effective_from::text AS effective_from,
              effective_to::text AS effective_to, status, notes, record_version
         FROM svc.price_list_versions
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, versionId]
    );
    return row
      ? {
          id: row.id,
          priceListId: row.price_list_id,
          versionNo: row.version_no,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          status: row.status,
          notes: row.notes,
          recordVersion: row.record_version,
        }
      : null;
  }

  /**
   * Records one price rule on a DRAFT version.
   *
   * `amount` is bound and cast to `numeric(18,4)` — the column's own precision and
   * scale — so the stored figure is exactly what the caller sent, never a value
   * that passed through a JavaScript double.
   *
   * `svc.guard_price_rule_parent_frozen` refuses this on a published or archived
   * parent, which is what makes a published version's prices immutable.
   */
  public async insertPriceRule(
    db: DbHandle,
    input: {
      priceListVersionId: string;
      serviceId: string;
      companyId: string | null;
      branchId: string | null;
      customerClass: string | null;
      amount: string;
      taxClassId: string | null;
      priority: number;
    }
  ): Promise<{ id: string; amount: string; recordVersion: number }> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string; amount: string; record_version: number }>(
      db,
      `INSERT INTO svc.price_rules
         (tenant_id, price_list_version_id, service_id, company_id, branch_id, customer_class,
          amount, tax_class_id, priority, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::numeric(18,4),$8,$9,'active',$10)
       RETURNING id, amount::text AS amount, record_version`,
      [
        context.principal.tenantId,
        input.priceListVersionId,
        input.serviceId,
        input.companyId,
        input.branchId,
        input.customerClass,
        input.amount,
        input.taxClassId,
        input.priority,
        context.principal.userId,
      ]
    );
    if (row === null) throw new Error('pricing: price-rule insert returned no row');
    return { id: row.id, amount: row.amount, recordVersion: row.record_version };
  }

  /** How many active rules a version carries — publication refuses an empty one. */
  public async countPriceRules(db: DbHandle, versionId: string): Promise<number> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ rules: string }>(
      db,
      `SELECT count(*)::text AS rules FROM svc.price_rules
        WHERE tenant_id = $1 AND price_list_version_id = $2
          AND status = 'active' AND deleted_at IS NULL`,
      [context.principal.tenantId, versionId]
    );
    return row ? Number.parseInt(row.rules, 10) : 0;
  }

  /**
   * Publishes a version through `svc.publish_price_list_version`.
   *
   * The function locks the price list, refuses a non-draft version, refuses an
   * `effective_from` at or before the currently open published version's, closes
   * that version's `effective_to` at the new date, and publishes. Forward-only
   * succession and the gist EXCLUDE backstop are therefore the database's, and
   * this method does not restate either.
   */
  public async publishPriceListVersion(
    db: DbHandle,
    input: { priceListId: string; versionId: string; effectiveFrom: string }
  ): Promise<void> {
    await this.run(db, `SELECT svc.publish_price_list_version($1, $2, $3::date)`, [
      input.priceListId,
      input.versionId,
      input.effectiveFrom,
    ]);
  }

  // The caller's approval CEILING is deliberately not read here.
  //
  // `iam.approval_limits` and `iam.role_grants` are owned by `@/modules/iam`
  // (ADR-001 rule 3), and a second reader would be a second definition of which
  // grant confers which ceiling. `DiscountAuthorizationService` asks the iam
  // module through its public surface instead — the same shape `technician` and
  // `diagnostics` use for `workOrders.jobScope`.
}
