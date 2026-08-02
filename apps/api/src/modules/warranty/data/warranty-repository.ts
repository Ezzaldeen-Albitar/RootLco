/**
 * `wty` SQL (Phase 1-22 — warranty generation).
 *
 * The only place warranty SQL is written. Four conventions hold without exception:
 *
 *  - **Every query carries an explicit `tenant_id` predicate** even though RLS
 *    already narrows, and an explicit `company_id`/`branch_id` predicate wherever
 *    the caller already holds an authorized scope. RLS is the guarantee; the
 *    predicate is the intent, and it keeps the plan on the tenant-leading
 *    composite indexes (`ix_warranty_records_delivery`, `ix_warranty_coverage_policy`).
 *    The two exceptions are the identity reads — by record id and by idempotency
 *    key — which cannot carry a scope predicate because their whole purpose is to
 *    *produce* the scope the service then authorizes against. Each says so at its
 *    own docstring, and the reason is not stylistic (see `findWarrantyRecordByIdempotencyKey`).
 *  - **`date` columns are read as `::text`.** `pg` decodes OID 1082 into a JS
 *    `Date` at local midnight, which shifts a warranty's start or expiry by a day
 *    for any process not running in the database's time zone. `start_date` and
 *    `expiry_date` are contractual terms of a warranty; a one-day drift in them is
 *    a wrong document, not a rounding detail.
 *  - **Odometer readings are read as `::text`.** `wty.warranty_records.odometer_at_issue`
 *    is `integer`, but the value it is bound to — `veh.odometer_readings.value` — is
 *    `numeric` and is read as a string everywhere in this codebase. Keeping the same
 *    wire shape means nobody has to convert between the two, and no float ever
 *    exists on the path between the reading and the warranty.
 *  - **The record and its status-history row are written only by
 *    `wty.issue_warranty`.** This repository never assembles a warranty record from
 *    parts, because the primitive is the only thing that binds `start_date` and
 *    `odometer_at_issue` to the delivery (M-wty-2) and it is the only thing that
 *    writes the genesis history row in the same statement.
 *
 * `wty` contains **no monetary column of any kind** — 80 columns, all classified
 * `internal`, none `restricted`. So there is no money on any path in this file and
 * no `numeric` amount to protect: the only exactness rules that apply here are the
 * two above.
 *
 * There is no claim SQL, no claim table and no `'claimed_against'` write anywhere
 * in this file. `P1-22-L-01`.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

/**
 * The most covered items one warranty record may carry, in BOTH directions.
 *
 * Used as the generation cap and as the read cap, deliberately the same constant:
 * a read bound that is looser than the write bound is a silent truncation waiting
 * for a busy work order, and a warranty document that omits covered work
 * misrepresents the coverage it grants. Because generation refuses beyond this
 * number rather than dropping the surplus, a truncated read is impossible by
 * construction rather than merely unlikely.
 *
 * 500 eligible lines on a single work order is not a repair; it is a data problem
 * an operator needs to see.
 */
export const MAX_COVERED_ITEMS = 500;

/**
 * The most warranty records one delivery's duplicate pre-check will consider.
 *
 * A delivery hands over one vehicle once, so the only reason it can carry more than
 * one warranty is more than one policy — a company with 200 active warranty policies
 * is not a configuration this bound is failing to serve. Its own constant rather
 * than a reuse of `MAX_COVERED_ITEMS`, because the two bound unrelated things and a
 * shared number invites one to be tuned for the other's sake.
 *
 * A truncated read here degrades safely: `ex_warranty_records_no_overlap` is the
 * enforcement point, so a duplicate missed by the pre-check surfaces as `23P01` and
 * a caller-safe conflict rather than as a second live warranty.
 */
export const MAX_WARRANTIES_PER_DELIVERY = 200;

export interface WarrantyPolicyRow {
  readonly id: string;
  readonly companyId: string;
  /** `ck_warranty_policies_code`: `^[a-z][a-z0-9_]{1,62}$`. */
  readonly policyCode: string;
  readonly name: string;
  /** `active` or `archived` — and `wty.issue_warranty` does not look at it. */
  readonly status: string;
  readonly recordVersion: number;
}

/**
 * One effective-dated coverage row: the entire source of a warranty's terms.
 *
 * `odometerLimit` here is **RELATIVE** — an allowance the primitive adds to the
 * odometer at issue. The identically-named column on `wty.warranty_records` is
 * **ABSOLUTE**. Confusing the two produces a warranty whose limit is either the
 * allowance alone or double-counted, and neither CHECK constraint would catch it
 * (`ck_warranty_records_odometer` only requires `limit >= at_issue`).
 */
export interface WarrantyCoverageRow {
  readonly id: string;
  readonly companyId: string;
  readonly policyId: string;
  /** `all`, `service` or `part` — the whole of the eligibility rule. */
  readonly coveredScope: string;
  /** `integer`, CHECK > 0. A count of months, not a measurement. */
  readonly durationMonths: number;
  /** RELATIVE allowance, or null for an unlimited-distance coverage. */
  readonly odometerLimit: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

export interface WarrantyRecordRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly workOrderId: string;
  readonly deliveryRecordId: string;
  readonly policyId: string;
  readonly coverageId: string;
  readonly startDate: string;
  readonly expiryDate: string;
  readonly odometerAtIssue: string;
  /** ABSOLUTE ceiling — `odometer_at_issue + coverage allowance`, or null. */
  readonly odometerLimit: string | null;
  readonly status: string;
  readonly idempotencyKey: string | null;
  readonly recordVersion: number;
}

export interface WarrantyRecordItemRow {
  readonly id: string;
  readonly warrantyRecordId: string;
  readonly itemKind: string;
  /** `wo.jobs.id`. No FK exists, so nothing validates it. */
  readonly sourceJobId: string | null;
  /** `wo.required_parts.id` — the delivered part LINE, not the catalog item. */
  readonly sourcePartId: string | null;
  readonly description: string;
  readonly recordVersion: number;
}

/** A record and every covered item on it, read together. */
export interface WarrantyRecordWithItems {
  readonly record: WarrantyRecordRow;
  readonly items: readonly WarrantyRecordItemRow[];
}

/**
 * The coverage effective on a delivery date, plus the date itself.
 *
 * `effectiveOn` is returned because the error the service raises when no coverage
 * exists has to name the date that was searched, and that date must be the one
 * PostgreSQL derived — never one Node computed. See `findCoverageEffectiveOn`.
 */
export interface CoverageResolution {
  /** `delivered_at::date`, as `YYYY-MM-DD`, computed by the database. */
  readonly effectiveOn: string;
  readonly coverage: WarrantyCoverageRow | null;
}

const POLICY_COLUMNS = `id, company_id, policy_code, name, status, record_version`;

interface PolicySql {
  id: string;
  company_id: string;
  policy_code: string;
  name: string;
  status: string;
  record_version: number;
}

const toPolicy = (r: PolicySql): WarrantyPolicyRow => ({
  id: r.id,
  companyId: r.company_id,
  policyCode: r.policy_code,
  name: r.name,
  status: r.status,
  recordVersion: r.record_version,
});

const COVERAGE_COLUMNS = `id, company_id, policy_id, covered_scope, duration_months,
  odometer_limit::text AS odometer_limit, effective_from::text AS effective_from,
  effective_to::text AS effective_to, status, record_version`;

interface CoverageSql {
  id: string;
  company_id: string;
  policy_id: string;
  covered_scope: string;
  duration_months: number;
  odometer_limit: string | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  record_version: number;
}

/**
 * The LEFT JOIN shape of `findCoverageEffectiveOn`.
 *
 * Every coverage column is nullable here and only here, because the join must
 * return the resolved date even when no coverage matched. `id` is the discriminant:
 * `wty.warranty_coverage.id` is NOT NULL, so a null `id` can only mean "no row on
 * the right-hand side" and never "a coverage row with no id".
 */
interface CoverageResolutionSql {
  effective_on: string;
  id: string | null;
  company_id: string | null;
  policy_id: string | null;
  covered_scope: string | null;
  duration_months: number | null;
  odometer_limit: string | null;
  effective_from: string | null;
  effective_to: string | null;
  status: string | null;
  record_version: number | null;
}

const toCoverage = (r: CoverageSql): WarrantyCoverageRow => ({
  id: r.id,
  companyId: r.company_id,
  policyId: r.policy_id,
  coveredScope: r.covered_scope,
  durationMonths: r.duration_months,
  odometerLimit: r.odometer_limit,
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
  status: r.status,
  recordVersion: r.record_version,
});

const RECORD_COLUMNS = `id, company_id, branch_id, vehicle_id, work_order_id,
  delivery_record_id, policy_id, coverage_id, start_date::text AS start_date,
  expiry_date::text AS expiry_date, odometer_at_issue::text AS odometer_at_issue,
  odometer_limit::text AS odometer_limit, status, idempotency_key, record_version`;

interface RecordSql {
  id: string;
  company_id: string;
  branch_id: string;
  vehicle_id: string;
  work_order_id: string;
  delivery_record_id: string;
  policy_id: string;
  coverage_id: string;
  start_date: string;
  expiry_date: string;
  odometer_at_issue: string;
  odometer_limit: string | null;
  status: string;
  idempotency_key: string | null;
  record_version: number;
}

const toRecord = (r: RecordSql): WarrantyRecordRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  vehicleId: r.vehicle_id,
  workOrderId: r.work_order_id,
  deliveryRecordId: r.delivery_record_id,
  policyId: r.policy_id,
  coverageId: r.coverage_id,
  startDate: r.start_date,
  expiryDate: r.expiry_date,
  odometerAtIssue: r.odometer_at_issue,
  odometerLimit: r.odometer_limit,
  status: r.status,
  idempotencyKey: r.idempotency_key,
  recordVersion: r.record_version,
});

const ITEM_COLUMNS = `id, warranty_record_id, item_kind, source_job_id, source_part_id,
  description, record_version`;

interface ItemSql {
  id: string;
  warranty_record_id: string;
  item_kind: string;
  source_job_id: string | null;
  source_part_id: string | null;
  description: string;
  record_version: number;
}

const toItem = (r: ItemSql): WarrantyRecordItemRow => ({
  id: r.id,
  warrantyRecordId: r.warranty_record_id,
  itemKind: r.item_kind,
  sourceJobId: r.source_job_id,
  sourcePartId: r.source_part_id,
  description: r.description,
  recordVersion: r.record_version,
});

export class WarrantyRepository extends Repository {
  protected readonly module = 'warranty';

  // -------------------------------------------------------------------------
  // Policies.
  // -------------------------------------------------------------------------

  /**
   * One policy by id, **whatever its status**.
   *
   * The status filter is deliberately absent. `assertPolicyActive` is the only
   * thing in the platform that refuses an archived policy — `wty.issue_warranty`
   * checks the coverage's status and not the policy's — and filtering here would
   * make that domain rule unreachable: an archived policy would surface as a 404
   * rather than as the refusal it is, and a caller would have no way to tell "no
   * such policy" from "that policy was retired".
   *
   * `deleted_at` is not filtered either, for the same class of reason: a
   * soft-deleted policy still explains a warranty record that already cites it.
   * `findPolicyByCode` and `listActivePolicies` DO filter it, because they resolve
   * a policy a new warranty is about to be issued under.
   */
  public async findPolicy(
    db: DbHandle,
    companyId: string,
    policyId: string
  ): Promise<WarrantyPolicyRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<PolicySql>(
      db,
      `SELECT ${POLICY_COLUMNS}
         FROM wty.warranty_policies
        WHERE tenant_id = $1 AND company_id = $2 AND id = $3`,
      [context.principal.tenantId, companyId, policyId]
    );
    return row ? toPolicy(row) : null;
  }

  /**
   * One live policy by its code, within a company.
   *
   * `deleted_at IS NULL` mirrors `uq_warranty_policies_code`, which is a PARTIAL
   * unique index: without the predicate a soft-deleted policy sharing a code with
   * a live one would make this lookup non-deterministic.
   */
  public async findPolicyByCode(
    db: DbHandle,
    companyId: string,
    policyCode: string
  ): Promise<WarrantyPolicyRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<PolicySql>(
      db,
      `SELECT ${POLICY_COLUMNS}
         FROM wty.warranty_policies
        WHERE tenant_id = $1 AND company_id = $2 AND policy_code = $3
          AND deleted_at IS NULL`,
      [context.principal.tenantId, companyId, policyCode]
    );
    return row ? toPolicy(row) : null;
  }

  /**
   * Live active policies for a company, bounded and deterministically ordered.
   *
   * Exists so the service can answer "does this company have exactly one policy?"
   * without guessing. The caller passes a small limit — it needs to distinguish
   * none from one from more-than-one, and nothing else — so this is a
   * disambiguation read, not a listing endpoint. Ordered by `policy_code` with `id`
   * as the tie-breaker, a total order backed by `uq_warranty_policies_code`.
   */
  public async listActivePolicies(
    db: DbHandle,
    companyId: string,
    limit: number
  ): Promise<readonly WarrantyPolicyRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<PolicySql>(
      db,
      `SELECT ${POLICY_COLUMNS}
         FROM wty.warranty_policies
        WHERE tenant_id = $1 AND company_id = $2
          AND status = 'active' AND deleted_at IS NULL
        ORDER BY policy_code, id
        LIMIT $3`,
      [context.principal.tenantId, companyId, limit]
    );
    return result.rows.map(toPolicy);
  }

  // -------------------------------------------------------------------------
  // Coverage.
  // -------------------------------------------------------------------------

  /**
   * The coverage `wty.issue_warranty` will select, resolved before it is called.
   *
   * The predicate and the ordering are transcribed from the primitive verbatim —
   * `status = 'active' AND deleted_at IS NULL AND effective_from <= start AND
   * (effective_to IS NULL OR effective_to > start) ORDER BY effective_from DESC
   * LIMIT 1` — because the point of this query is to produce a *good error* for the
   * case the primitive would answer with a bare `check_violation`, and an
   * approximation of its selection would produce a good error for a different
   * question.
   *
   * Two details are load-bearing:
   *
   *  - **The date is computed by PostgreSQL, not by Node.** `($4::timestamptz)::date`
   *    mirrors the primitive's `v_del.delivered_at::date` exactly, so both resolve
   *    the same calendar day under the same session `TimeZone`. Deriving the date in
   *    TypeScript would put the pre-check and the primitive on different clocks, and
   *    the disagreement would appear only for deliveries near midnight — the hardest
   *    possible failure to reproduce.
   *  - **The LEFT JOIN always returns exactly one row.** The date has to come back
   *    even when no coverage matches, because that is precisely the case whose error
   *    message must name it.
   *
   * `covered_scope` is deliberately NOT filtered, because the primitive does not
   * filter it either: the coverage with the latest `effective_from` wins whatever
   * its scope, and the scope then decides which lines become covered items. Note
   * that `ex_warranty_coverage_no_overlap` is per `covered_scope`, so two active
   * coverages CAN share an `effective_from` across scopes — and then `ORDER BY
   * effective_from DESC LIMIT 1` is arbitrary in this query and equally arbitrary
   * inside the primitive. That is why the service reads the coverage back off the
   * record it actually created instead of trusting the row returned here.
   */
  public async findCoverageEffectiveOn(
    db: DbHandle,
    companyId: string,
    policyId: string,
    deliveredAt: string | Date
  ): Promise<CoverageResolution> {
    const context = this.assertContext(db);
    const row = await this.runOne<CoverageResolutionSql>(
      db,
      `SELECT e.on_date::text AS effective_on,
              c.id, c.company_id, c.policy_id, c.covered_scope, c.duration_months,
              c.odometer_limit::text AS odometer_limit,
              c.effective_from::text AS effective_from,
              c.effective_to::text AS effective_to,
              c.status, c.record_version
         FROM (SELECT ($4::timestamptz)::date AS on_date) AS e
         LEFT JOIN wty.warranty_coverage c
                ON c.tenant_id = $1
               AND c.company_id = $2
               AND c.policy_id = $3
               AND c.status = 'active'
               AND c.deleted_at IS NULL
               AND c.effective_from <= e.on_date
               AND (c.effective_to IS NULL OR c.effective_to > e.on_date)
        ORDER BY c.effective_from DESC
        LIMIT 1`,
      [context.principal.tenantId, companyId, policyId, deliveredAt]
    );
    if (row === null) {
      // Unreachable: the derived single-row table guarantees a row. Kept because
      // returning a fabricated date here would be worse than failing loudly.
      throw new Error('warranty: coverage resolution returned no row');
    }
    // Destructured and checked field by field rather than cast. Every column tested
    // here is NOT NULL in `wty.warranty_coverage`, so the only way any of them can
    // arrive null is a join miss — and `odometer_limit`/`effective_to` are excluded
    // because they are genuinely nullable and must not be read as absence.
    const { effective_on: effectiveOn } = row;
    if (
      row.id === null ||
      row.company_id === null ||
      row.policy_id === null ||
      row.covered_scope === null ||
      row.duration_months === null ||
      row.effective_from === null ||
      row.status === null ||
      row.record_version === null
    ) {
      return { effectiveOn, coverage: null };
    }
    return {
      effectiveOn,
      coverage: toCoverage({
        id: row.id,
        company_id: row.company_id,
        policy_id: row.policy_id,
        covered_scope: row.covered_scope,
        duration_months: row.duration_months,
        odometer_limit: row.odometer_limit,
        effective_from: row.effective_from,
        effective_to: row.effective_to,
        status: row.status,
        record_version: row.record_version,
      }),
    };
  }

  /**
   * One coverage row by id — the terms a warranty record actually cites.
   *
   * Read after issue rather than reused from `findCoverageEffectiveOn`, so the
   * covered scope that decides item eligibility is the scope of the row the
   * database chose, not the row this application predicted it would choose. See
   * the note on tied `effective_from` values above.
   */
  public async findCoverage(
    db: DbHandle,
    companyId: string,
    coverageId: string
  ): Promise<WarrantyCoverageRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<CoverageSql>(
      db,
      `SELECT ${COVERAGE_COLUMNS}
         FROM wty.warranty_coverage
        WHERE tenant_id = $1 AND company_id = $2 AND id = $3`,
      [context.principal.tenantId, companyId, coverageId]
    );
    return row ? toCoverage(row) : null;
  }

  // -------------------------------------------------------------------------
  // Warranty records.
  // -------------------------------------------------------------------------

  /**
   * One warranty record and its covered items.
   *
   * An identity read: `tenant_id` and `id` only, because the row's own
   * `company_id`/`branch_id` are what the service passes to `authorizeScope`, and a
   * scope predicate here would have to come from the caller — which is the input a
   * scoped authorization exists to stop trusting. RLS still narrows to the caller's
   * granted companies and branches, so an out-of-scope id returns null and is
   * indistinguishable from an absent one.
   *
   * The items are a second statement rather than a join: a join would repeat every
   * record column once per item, and the child query can then carry the full
   * `tenant_id`/`company_id`/`branch_id` predicate taken from the parent row —
   * scope values this repository read, not values a caller supplied.
   */
  public async findWarrantyRecord(
    db: DbHandle,
    warrantyRecordId: string
  ): Promise<WarrantyRecordWithItems | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<RecordSql>(
      db,
      `SELECT ${RECORD_COLUMNS}
         FROM wty.warranty_records
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, warrantyRecordId]
    );
    if (row === null) return null;
    const record = toRecord(row);

    const items = await this.run<ItemSql>(
      db,
      `SELECT ${ITEM_COLUMNS}
         FROM wty.warranty_record_items
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND warranty_record_id = $4 AND deleted_at IS NULL
        ORDER BY item_kind, created_at, id
        LIMIT $5`,
      [
        context.principal.tenantId,
        record.companyId,
        record.branchId,
        record.id,
        // Same constant that caps generation, so this LIMIT can never truncate.
        MAX_COVERED_ITEMS,
      ]
    );
    return { record, items: items.rows.map(toItem) };
  }

  /**
   * The record a given idempotency key already produced, tenant-wide.
   *
   * **Not narrowed by company or branch, and that is deliberate.**
   * `uq_warranty_records_idempotency` is `(tenant_id, idempotency_key)` with no
   * scope column, so the key namespace is the tenant. Adding a branch predicate
   * would make a key already used in another branch look absent, and the caller
   * would then be told a fresh warranty had been issued when in fact the primitive
   * had returned — or the index had refused — a record in a branch the caller
   * cannot see.
   *
   * RLS still hides such a record from this query, so the honest outcome for a
   * cross-scope key collision is not a lie but a refusal: this returns null, the
   * primitive's own RLS-narrowed lookup also finds nothing, its INSERT hits the
   * partial unique index — which RLS does not narrow — and the `23505` surfaces as
   * `ERR-INT-001`. The service must therefore treat a unique violation from the
   * primitive as a real answer and never as an internal fault.
   */
  public async findWarrantyRecordByIdempotencyKey(
    db: DbHandle,
    idempotencyKey: string
  ): Promise<WarrantyRecordRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<RecordSql>(
      db,
      `SELECT ${RECORD_COLUMNS}
         FROM wty.warranty_records
        WHERE tenant_id = $1 AND idempotency_key = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, idempotencyKey]
    );
    return row ? toRecord(row) : null;
  }

  /**
   * Every warranty already issued against one delivery, newest first.
   *
   * A bounded fan-out of a single parent row rather than a collection: a delivery
   * hands over one vehicle once, and the only reason there can be more than one
   * warranty is more than one policy. Ordered `(start_date DESC, id DESC)` for a
   * total order, and capped at `MAX_WARRANTIES_PER_DELIVERY`, so the query is
   * bounded and deterministic without a cursor contract that would outlive its
   * usefulness.
   */
  public async listWarrantiesForDelivery(
    db: DbHandle,
    companyId: string,
    branchId: string,
    deliveryRecordId: string
  ): Promise<readonly WarrantyRecordRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<RecordSql>(
      db,
      `SELECT ${RECORD_COLUMNS}
         FROM wty.warranty_records
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND delivery_record_id = $4 AND deleted_at IS NULL
        ORDER BY start_date DESC, id DESC
        LIMIT $5`,
      [
        context.principal.tenantId,
        companyId,
        branchId,
        deliveryRecordId,
        MAX_WARRANTIES_PER_DELIVERY,
      ]
    );
    return result.rows.map(toRecord);
  }

  /**
   * Issues a warranty through `wty.issue_warranty` — the only write path.
   *
   * The primitive is not a convenience wrapper around an INSERT this repository
   * could do itself. It is the only thing that binds the terms to the delivery:
   * `start_date` is `delivered_at::date`, `odometer_at_issue` comes from
   * `veh.odometer_readings` at the delivery's `final_odometer_reading_id` — a table
   * this module may not read — and the ABSOLUTE `odometer_limit` is derived by
   * adding the coverage's RELATIVE allowance. It also writes the
   * `wty.warranty_status_history` genesis row in the same statement, which a
   * two-step application write could lose.
   *
   * It is idempotent on `(tenant_id, idempotency_key)` and returns the existing id.
   * The service still resolves a replay *before* calling, because from the outside
   * a returned existing id is indistinguishable from a fresh one — and audit and
   * event emission must happen once, not once per retry.
   *
   * Every parameter is cast explicitly. The function is not overloaded, so
   * inference would work today; the casts make the call independent of that.
   */
  public async issueWarranty(
    db: DbHandle,
    deliveryId: string,
    policyId: string,
    correlationId: string | null,
    idempotencyKey: string | null
  ): Promise<{ readonly id: string }> {
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT wty.issue_warranty($1::uuid, $2::uuid, $3::uuid, $4::text) AS id`,
      [deliveryId, policyId, correlationId, idempotencyKey]
    );
    if (!row?.id) throw new Error('warranty: wty.issue_warranty returned no record id');
    return { id: row.id };
  }

  /**
   * Records one covered job or part on an issued warranty.
   *
   * `wty.warranty_record_items` has no protected function and no covering CHECK
   * beyond `ck_warranty_record_items_kind`, so a raw INSERT is the only path and
   * **the application is the only defence** on three points: that `item_kind`
   * matches the coverage's `covered_scope` (`coversItemKind` — nothing in the
   * schema relates an item to the coverage at all), that the scope columns match
   * the parent record, and that `description` is a real description of delivered
   * work rather than a placeholder. The composite FK
   * `fk_warranty_record_items_record` does enforce that the parent exists in the
   * SAME tenant/company/branch, which is why those three values are taken from the
   * record this module just read and never from a caller.
   *
   * `source_job_id` and `source_part_id` have NO foreign key — the comment on the
   * migration says so — so nothing validates them and they are recorded exactly as
   * the work-order module reported them.
   */
  public async insertWarrantyRecordItem(
    db: DbHandle,
    input: {
      readonly warrantyRecordId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly itemKind: string;
      readonly sourceJobId: string | null;
      readonly sourcePartId: string | null;
      readonly description: string;
    }
  ): Promise<WarrantyRecordItemRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<ItemSql>(
      db,
      `INSERT INTO wty.warranty_record_items
         (tenant_id, company_id, branch_id, warranty_record_id, item_kind,
          source_job_id, source_part_id, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${ITEM_COLUMNS}`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.warrantyRecordId,
        input.itemKind,
        input.sourceJobId,
        input.sourcePartId,
        input.description,
        context.principal.userId,
      ]
    );
    if (row === null) throw new Error('warranty: warranty item insert returned no row');
    return toItem(row);
  }
}
