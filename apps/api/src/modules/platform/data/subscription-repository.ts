/**
 * Plan catalogue and subscription administration (P1-32-PRE-023).
 *
 * Runs on the PLATFORM connection as `app_platform`. Every statement here is
 * bounded by a policy predicated on `iam.has_platform_authority`, so a caller
 * without `platform.subscription.manage` reads nothing and writes nothing even
 * if a route were mis-declared — the authority is checked in the database, not
 * only in the pipeline.
 *
 * ## Money is never a JavaScript number here
 *
 * `list_price` and every amount derived from it stay decimal STRINGS from the
 * driver to the wire. `pg` returns `numeric` as text precisely so it can, and a
 * single `Number(...)` anywhere on this path would silently re-introduce
 * IEEE-754 into the one figure an operator will be asked to justify. Sums are
 * computed in SQL.
 *
 * ## Dates
 *
 * `org.tenant_subscriptions.effective_from` / `effective_to` are `timestamptz`
 * and predate this slice. The console works in whole DAYS — a subscription
 * period starts on a date and ends on a date — so the operations take
 * `YYYY-MM-DD` and the casts are explicit (`$n::date`). The event table stores
 * `date` for the same reason. Nothing here invents a time of day.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { toIsoString } from './platform-repository';

/** A plan version as the console publishes it. */
export interface SubscriptionPlanRow {
  readonly id: string;
  readonly planCode: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly description: string | null;
  readonly status: string;
  /** Decimal string, or null on a plan that has not been priced. */
  readonly listPrice: string | null;
  readonly currencyCode: string | null;
  readonly termMonths: number | null;
  readonly entitlementDocument: Record<string, unknown>;
  readonly capacityLimits: Record<string, unknown>;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordVersion: number;
}

/** One subscription assignment of one organisation. */
export interface TenantSubscriptionRow {
  readonly id: string;
  readonly planId: string;
  readonly planCode: string;
  readonly planName: string;
  readonly status: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordVersion: number;
}

/** One act performed on a subscription. */
export interface SubscriptionEventRow {
  readonly id: string;
  readonly subscriptionId: string;
  readonly eventKind: string;
  readonly fromPlanCode: string | null;
  readonly toPlanCode: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly reason: string;
  readonly occurredAt: string;
}

/**
 * The three capacity limits the console can measure.
 *
 * `capacity_limits` is an open jsonb document, but a limit on something nothing
 * counts would be a number with no effect, so the write surface names exactly
 * the three kinds usage is computed for. An absent key means "no limit".
 */
export interface CapacityLimitsInput {
  readonly companies?: number | undefined;
  readonly branches?: number | undefined;
  readonly users?: number | undefined;
}

/** What the plan write operations take. Every field is already validated. */
export interface PlanWriteInput {
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly listPrice?: string | null | undefined;
  readonly currencyCode?: string | null | undefined;
  readonly termMonths?: number | null | undefined;
  readonly capacityLimits?: CapacityLimitsInput | undefined;
  readonly entitlementDocument?: Readonly<Record<string, boolean>> | undefined;
  readonly status?: string | undefined;
  readonly effectiveFrom?: string | undefined;
  readonly effectiveTo?: string | null | undefined;
}

const PLAN_COLUMNS = `p.id, p.plan_code, p.name, p.display_name, p.description, p.status,
       p.list_price, p.currency_code, p.term_months,
       p.entitlement_document, p.capacity_limits,
       p.effective_from, p.effective_to, p.record_version`;

export class SubscriptionRepository extends Repository {
  protected readonly module = 'platform';

  /** The whole plan catalogue, code then effective date. */
  async listPlans(
    db: DbHandle,
    filters: { readonly status?: string | undefined; readonly planCode?: string | undefined }
  ): Promise<readonly SubscriptionPlanRow[]> {
    const result = await this.run<PlanDbRow>(
      db,
      `SELECT ${PLAN_COLUMNS}
         FROM org.subscription_plans p
        WHERE ($1::text IS NULL OR p.status = $1)
          AND ($2::text IS NULL OR p.plan_code = $2)
        ORDER BY p.plan_code ASC, p.effective_from DESC`,
      [filters.status ?? null, filters.planCode ?? null]
    );
    return result.rows.map(toPlanRow);
  }

  /**
   * The plan version in force for one organisation right now.
   *
   * Resolved by the same interval predicate the EXCLUDE constraint makes
   * unambiguous, so "the plan this organisation is on" has exactly one answer.
   * Null when no active assignment covers today, which is a real state: a tenant
   * whose subscription lapsed has no entitlement and no capacity limit, and
   * reporting the last expired plan instead would overstate what it is allowed.
   */
  async readActivePlanForTenant(
    db: DbHandle,
    tenantId: string
  ): Promise<SubscriptionPlanRow | null> {
    const row = await this.runOne<PlanDbRow>(
      db,
      `SELECT ${PLAN_COLUMNS}
         FROM org.tenant_subscriptions s
         JOIN org.subscription_plans p ON p.id = s.plan_id
        WHERE s.tenant_id = $1::uuid
          AND s.status = 'active'
          AND s.effective_from <= now()
          AND (s.effective_to IS NULL OR s.effective_to > now())
        ORDER BY s.effective_from DESC
        LIMIT 1`,
      [tenantId]
    );
    return row ? toPlanRow(row) : null;
  }

  /** One plan version by id, or null when it does not exist for this caller. */
  async readPlan(db: DbHandle, planId: string): Promise<SubscriptionPlanRow | null> {
    const row = await this.runOne<PlanDbRow>(
      db,
      `SELECT ${PLAN_COLUMNS} FROM org.subscription_plans p WHERE p.id = $1::uuid`,
      [planId]
    );
    return row ? toPlanRow(row) : null;
  }

  /**
   * The plan version in force for a code at an instant.
   *
   * Resolved by the same interval semantics the EXCLUDE constraint enforces, so
   * there is at most one answer by construction rather than by ORDER BY luck.
   */
  async readActivePlanByCode(
    db: DbHandle,
    planCode: string,
    at: string
  ): Promise<SubscriptionPlanRow | null> {
    const row = await this.runOne<PlanDbRow>(
      db,
      `SELECT ${PLAN_COLUMNS}
         FROM org.subscription_plans p
        WHERE p.plan_code = $1
          AND p.status = 'active'
          AND p.effective_from <= $2::date
          AND (p.effective_to IS NULL OR p.effective_to > $2::date)
        LIMIT 1`,
      [planCode, at]
    );
    return row ? toPlanRow(row) : null;
  }

  /**
   * Creates a plan version.
   *
   * `created_by` is `iam.current_user_id()` — server-derived, never a request
   * value. The entitlement and capacity documents are handed to the database as
   * jsonb and validated by `org.validate_plan_documents()`, which is the only
   * place that knows which feature flags exist; re-implementing that check here
   * would create a second answer that could drift.
   */
  async createPlan(
    db: DbHandle,
    input: {
      readonly planCode: string;
      readonly name: string;
      readonly displayName: string | null;
      readonly description: string | null;
      readonly listPrice: string | null;
      readonly currencyCode: string | null;
      readonly termMonths: number | null;
      readonly entitlementDocument: Readonly<Record<string, boolean>>;
      readonly capacityLimits: CapacityLimitsInput;
      readonly status: string;
      readonly effectiveFrom: string;
      readonly effectiveTo: string | null;
    }
  ): Promise<SubscriptionPlanRow> {
    const row = await this.runOne<PlanDbRow>(
      db,
      `INSERT INTO org.subscription_plans
         (plan_code, name, display_name, description, entitlement_document, capacity_limits,
          status, effective_from, effective_to, list_price, currency_code, term_months, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb,
               $7, $8::date, $9::date, $10::numeric, $11, $12, iam.current_user_id())
       RETURNING ${PLAN_COLUMNS.replace(/p\./g, '')}`,
      [
        input.planCode,
        input.name,
        input.displayName,
        input.description,
        JSON.stringify(input.entitlementDocument),
        JSON.stringify(input.capacityLimits),
        input.status,
        input.effectiveFrom,
        input.effectiveTo,
        input.listPrice,
        input.currencyCode,
        input.termMonths,
      ]
    );
    if (!row) throw new Error('subscription plan insert returned no row');
    return toPlanRow(row);
  }

  /**
   * Updates a plan version, one statement, every field optional.
   *
   * `COALESCE($n, column)` is deliberately NOT used for the nullable commercial
   * fields: it cannot express "set this back to null", so a mis-priced plan
   * could never be unpriced. Each optional field therefore carries a companion
   * boolean saying whether the caller mentioned it at all, which is the only
   * shape that distinguishes "absent" from "explicitly null".
   *
   * `plan_code` is absent from the statement AND from the column grant, so the
   * immutability of a plan code is enforced twice over.
   */
  async updatePlan(
    db: DbHandle,
    planId: string,
    expectedVersion: number,
    input: PlanWriteInput
  ): Promise<SubscriptionPlanRow | null> {
    const row = await this.runOne<PlanDbRow>(
      db,
      `UPDATE org.subscription_plans p
          SET display_name         = CASE WHEN $3  THEN $4          ELSE p.display_name END,
              description          = CASE WHEN $5  THEN $6          ELSE p.description END,
              list_price           = CASE WHEN $7  THEN $8::numeric ELSE p.list_price END,
              currency_code        = CASE WHEN $9  THEN $10         ELSE p.currency_code END,
              term_months          = CASE WHEN $11 THEN $12         ELSE p.term_months END,
              capacity_limits      = CASE WHEN $13 THEN $14::jsonb  ELSE p.capacity_limits END,
              entitlement_document = CASE WHEN $15 THEN $16::jsonb  ELSE p.entitlement_document END,
              status               = CASE WHEN $17 THEN $18         ELSE p.status END,
              effective_to         = CASE WHEN $19 THEN $20::date   ELSE p.effective_to END
        WHERE p.id = $1::uuid AND p.record_version = $2
        RETURNING ${PLAN_COLUMNS.replace(/p\./g, '')}`,
      [
        planId,
        expectedVersion,
        input.displayName !== undefined,
        input.displayName ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.listPrice !== undefined,
        input.listPrice ?? null,
        input.currencyCode !== undefined,
        input.currencyCode ?? null,
        input.termMonths !== undefined,
        input.termMonths ?? null,
        input.capacityLimits !== undefined,
        input.capacityLimits === undefined ? null : JSON.stringify(input.capacityLimits),
        input.entitlementDocument !== undefined,
        input.entitlementDocument === undefined ? null : JSON.stringify(input.entitlementDocument),
        input.status !== undefined,
        input.status ?? null,
        input.effectiveTo !== undefined,
        input.effectiveTo ?? null,
      ]
    );
    return row ? toPlanRow(row) : null;
  }

  /** Every subscription assignment of one organisation, newest period first. */
  async listSubscriptions(
    db: DbHandle,
    tenantId: string
  ): Promise<readonly TenantSubscriptionRow[]> {
    const result = await this.run<{
      id: string;
      plan_id: string;
      plan_code: string;
      plan_name: string;
      status: string;
      effective_from: string | Date;
      effective_to: string | Date | null;
      record_version: number;
    }>(
      db,
      `SELECT s.id, s.plan_id, p.plan_code, COALESCE(p.display_name, p.name) AS plan_name,
              s.status, s.effective_from, s.effective_to, s.record_version
         FROM org.tenant_subscriptions s
         JOIN org.subscription_plans p ON p.id = s.plan_id
        WHERE s.tenant_id = $1::uuid
        ORDER BY s.effective_from DESC, s.id DESC`,
      [tenantId]
    );
    return result.rows.map((r) => ({
      id: r.id,
      planId: r.plan_id,
      planCode: r.plan_code,
      planName: r.plan_name,
      status: r.status,
      effectiveFrom: toIsoString(r.effective_from),
      effectiveTo: r.effective_to === null ? null : toIsoString(r.effective_to),
      recordVersion: r.record_version,
    }));
  }

  /**
   * The assignment in force right now, locked for the duration of the
   * transaction.
   *
   * `FOR UPDATE` is taken on org.tenant_subscriptions rather than on org.tenants
   * deliberately. Locking the tenant row would evaluate `org.tenants`'s UPDATE
   * policy, `upd_tenants_platform_lifecycle`, which demands
   * `platform.organization.lifecycle` — an authority a subscription
   * administrator need not hold. The lock would then quietly match no rows and
   * serialise nothing, which is worse than no lock at all because it looks like
   * one. This row is the contended one anyway, and the first assignment for a
   * tenant has no row to lock: there the EXCLUDE constraint
   * `ex_tenant_subscriptions_no_active_overlap` is the authority, and the
   * service maps its SQLSTATE to a conflict.
   */
  async lockActiveSubscription(
    db: DbHandle,
    tenantId: string
  ): Promise<TenantSubscriptionRow | null> {
    const locked = await this.runOne<{ id: string }>(
      db,
      `SELECT s.id
         FROM org.tenant_subscriptions s
        WHERE s.tenant_id = $1::uuid
          AND s.status = 'active'
          AND s.effective_from <= now()
          AND (s.effective_to IS NULL OR s.effective_to > now())
        ORDER BY s.effective_from DESC
        FOR UPDATE`,
      [tenantId]
    );
    if (!locked) return null;
    const row = await this.runOne<{
      id: string;
      plan_id: string;
      plan_code: string;
      plan_name: string;
      status: string;
      effective_from: string | Date;
      effective_to: string | Date | null;
      record_version: number;
    }>(
      db,
      `SELECT s.id, s.plan_id, p.plan_code, COALESCE(p.display_name, p.name) AS plan_name,
              s.status, s.effective_from, s.effective_to, s.record_version
         FROM org.tenant_subscriptions s
         JOIN org.subscription_plans p ON p.id = s.plan_id
        WHERE s.id = $1::uuid`,
      [locked.id]
    );
    if (!row) return null;
    return {
      id: row.id,
      planId: row.plan_id,
      planCode: row.plan_code,
      planName: row.plan_name,
      status: row.status,
      effectiveFrom: toIsoString(row.effective_from),
      effectiveTo: row.effective_to === null ? null : toIsoString(row.effective_to),
      recordVersion: row.record_version,
    };
  }

  /**
   * The identifier and plan of the assignment in force right now, with no lock
   * and no plan join.
   *
   * For the lifecycle transition, whose authority is
   * `platform.organization.lifecycle`. That authority reads
   * org.tenant_subscriptions but not the plan catalogue and holds no UPDATE
   * policy here, so it can neither join plans nor take a row lock — and does not
   * need to: it appends an event beside the assignment, it does not change it.
   */
  async readLiveSubscriptionRef(
    db: DbHandle,
    tenantId: string
  ): Promise<{ readonly id: string; readonly planId: string } | null> {
    const row = await this.runOne<{ id: string; plan_id: string }>(
      db,
      `SELECT s.id, s.plan_id
         FROM org.tenant_subscriptions s
        WHERE s.tenant_id = $1::uuid
          AND s.status = 'active'
          AND s.effective_from <= now()
          AND (s.effective_to IS NULL OR s.effective_to > now())
        ORDER BY s.effective_from DESC
        LIMIT 1`,
      [tenantId]
    );
    return row ? { id: row.id, planId: row.plan_id } : null;
  }

  /** One assignment by id, scoped to its organisation. */
  async readSubscription(
    db: DbHandle,
    tenantId: string,
    subscriptionId: string
  ): Promise<TenantSubscriptionRow | null> {
    const row = await this.runOne<{
      id: string;
      plan_id: string;
      plan_code: string;
      plan_name: string;
      status: string;
      effective_from: string | Date;
      effective_to: string | Date | null;
      record_version: number;
    }>(
      db,
      `SELECT s.id, s.plan_id, p.plan_code, COALESCE(p.display_name, p.name) AS plan_name,
              s.status, s.effective_from, s.effective_to, s.record_version
         FROM org.tenant_subscriptions s
         JOIN org.subscription_plans p ON p.id = s.plan_id
        WHERE s.tenant_id = $1::uuid AND s.id = $2::uuid`,
      [tenantId, subscriptionId]
    );
    if (!row) return null;
    return {
      id: row.id,
      planId: row.plan_id,
      planCode: row.plan_code,
      planName: row.plan_name,
      status: row.status,
      effectiveFrom: toIsoString(row.effective_from),
      effectiveTo: row.effective_to === null ? null : toIsoString(row.effective_to),
      recordVersion: row.record_version,
    };
  }

  /**
   * Closes an assignment at a date without changing its status.
   *
   * The row stays `active` on purpose: it WAS the live assignment for the period
   * it covers, and rewriting history to say otherwise would make every past
   * period look cancelled. What ends is the interval, which is exactly what the
   * EXCLUDE constraint reads.
   */
  async endSubscriptionAt(
    db: DbHandle,
    subscriptionId: string,
    effectiveTo: string
  ): Promise<void> {
    await this.run(
      db,
      `UPDATE org.tenant_subscriptions
          SET effective_to = $2::date
        WHERE id = $1::uuid`,
      [subscriptionId, effectiveTo]
    );
  }

  /** Marks an assignment cancelled at a date. */
  async cancelSubscription(
    db: DbHandle,
    subscriptionId: string,
    effectiveTo: string
  ): Promise<number> {
    const result = await this.run(
      db,
      `UPDATE org.tenant_subscriptions
          SET status = 'cancelled', effective_to = $2::date
        WHERE id = $1::uuid AND status = 'active'`,
      [subscriptionId, effectiveTo]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Opens a new active assignment.
   *
   * `effective_to` is derived in SQL from the term (`+ make_interval`), never in
   * JavaScript: month arithmetic across a year boundary is the sort of thing a
   * date library gets right and hand-rolled code does not.
   */
  async insertSubscription(
    db: DbHandle,
    input: {
      readonly tenantId: string;
      readonly planId: string;
      readonly effectiveFrom: string;
      readonly termMonths: number;
    }
  ): Promise<{ readonly id: string; readonly effectiveTo: string }> {
    const row = await this.runOne<{ id: string; effective_to: string | Date }>(
      db,
      `INSERT INTO org.tenant_subscriptions
         (tenant_id, plan_id, status, effective_from, effective_to, assigned_by, created_by)
       VALUES ($1::uuid, $2::uuid, 'active', $3::date,
               ($3::date + make_interval(months => $4))::timestamptz,
               iam.current_user_id(), iam.current_user_id())
       RETURNING id, effective_to`,
      [input.tenantId, input.planId, input.effectiveFrom, input.termMonths]
    );
    if (!row) throw new Error('tenant subscription insert returned no row');
    return { id: row.id, effectiveTo: toIsoString(row.effective_to) };
  }

  /** Appends one act to the trail. The table has no UPDATE path at all. */
  async appendEvent(
    db: DbHandle,
    input: {
      readonly tenantId: string;
      readonly subscriptionId: string;
      readonly eventKind: string;
      readonly fromPlanId: string | null;
      readonly toPlanId: string | null;
      readonly effectiveFrom: string;
      readonly effectiveTo: string | null;
      readonly reason: string;
      readonly correlationId: string | null;
    }
  ): Promise<string> {
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO org.tenant_subscription_events
         (tenant_id, subscription_id, event_kind, from_plan_id, to_plan_id,
          effective_from, effective_to, reason, actor_id, correlation_id, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid,
               $6::date, $7::date, $8, iam.current_user_id(), $9::uuid, iam.current_user_id())
       RETURNING id`,
      [
        input.tenantId,
        input.subscriptionId,
        input.eventKind,
        input.fromPlanId,
        input.toPlanId,
        input.effectiveFrom,
        input.effectiveTo,
        input.reason,
        input.correlationId,
      ]
    );
    if (!row) throw new Error('tenant subscription event insert returned no row');
    return row.id;
  }

  /** The trail of one organisation, newest first. */
  async listEvents(
    db: DbHandle,
    tenantId: string,
    limit: number
  ): Promise<readonly SubscriptionEventRow[]> {
    const result = await this.run<{
      id: string;
      subscription_id: string;
      event_kind: string;
      from_plan_code: string | null;
      to_plan_code: string | null;
      effective_from: string | Date;
      effective_to: string | Date | null;
      reason: string;
      created_at: string | Date;
    }>(
      db,
      `SELECT e.id, e.subscription_id, e.event_kind,
              fp.plan_code AS from_plan_code, tp.plan_code AS to_plan_code,
              e.effective_from, e.effective_to, e.reason, e.created_at
         FROM org.tenant_subscription_events e
         LEFT JOIN org.subscription_plans fp ON fp.id = e.from_plan_id
         LEFT JOIN org.subscription_plans tp ON tp.id = e.to_plan_id
        WHERE e.tenant_id = $1::uuid
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT $2`,
      [tenantId, limit]
    );
    return result.rows.map((r) => ({
      id: r.id,
      subscriptionId: r.subscription_id,
      eventKind: r.event_kind,
      fromPlanCode: r.from_plan_code,
      toPlanCode: r.to_plan_code,
      effectiveFrom: toIsoString(r.effective_from),
      effectiveTo: r.effective_to === null ? null : toIsoString(r.effective_to),
      reason: r.reason,
      occurredAt: toIsoString(r.created_at),
    }));
  }
}

interface PlanDbRow {
  id: string;
  plan_code: string;
  name: string;
  display_name: string | null;
  description: string | null;
  status: string;
  list_price: string | null;
  currency_code: string | null;
  term_months: number | null;
  entitlement_document: Record<string, unknown>;
  capacity_limits: Record<string, unknown>;
  effective_from: string | Date;
  effective_to: string | Date | null;
  record_version: number;
}

function toPlanRow(r: PlanDbRow): SubscriptionPlanRow {
  return {
    id: r.id,
    planCode: r.plan_code,
    name: r.name,
    displayName: r.display_name,
    description: r.description,
    status: r.status,
    // Straight through as text. `pg` hands `numeric` back as a string and it
    // stays one: this figure is money.
    listPrice: r.list_price,
    currencyCode: r.currency_code,
    termMonths: r.term_months,
    entitlementDocument: r.entitlement_document ?? {},
    capacityLimits: r.capacity_limits ?? {},
    effectiveFrom: toIsoString(r.effective_from),
    effectiveTo: r.effective_to === null ? null : toIsoString(r.effective_to),
    recordVersion: r.record_version,
  };
}
