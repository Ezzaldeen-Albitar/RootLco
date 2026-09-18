/**
 * Platform statistics and the operator's own audit trail (P1-32-PRE-025/026).
 *
 * ## Every figure is computed by PostgreSQL
 *
 * Counts are `count(*)::int`; money is `sum(...)` in `numeric` handed back as a
 * decimal STRING. Nothing on this path is added up in JavaScript, and nothing is
 * rounded. A platform-wide revenue figure assembled by summing floats in a
 * request handler is exactly the kind of number that is wrong by a minor unit
 * and impossible to reconcile afterwards.
 *
 * ## The capacity vocabulary
 *
 * `org.subscription_plans.capacity_limits` is an open jsonb document whose
 * validator (`org.validate_plan_documents()`) admits ANY key with a
 * non-negative numeric value. Exactly three of them carry meaning —
 * `max_companies`, `max_branches`, `max_users` — because those are the three
 * the database's own capacity functions read and enforce. A plan carrying other
 * keys is not rejected; they are simply not reported, because reporting a limit
 * nothing measures would be a number with no meaning. The console publishes the
 * three under their short names and translates at the repository boundary, so
 * the column holds one spelling: the one the triggers read.
 *
 * ## The audit search is the OPERATOR's trail, not a tenant's
 *
 * `sel_audit_records_platform` is `tenant_id = iam.current_tenant_id()`, so this
 * read can only ever see records written in the operator's HOME tenant. A
 * platform operator cannot read a tenant's own audit trail through this
 * operation, and `targetTenantId` filters the operator's records BY the
 * organisation they were about — a detail field — rather than widening the
 * scope.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPageWithCursors,
  cursorTimestamp,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';
import { toIsoString } from './platform-repository';

/** Ordering contract for the operator's own audit trail. */
export const PLATFORM_AUDIT_ORDERING: OrderingContract = {
  key: 'iam.audit_records:occurred_at_desc',
  direction: 'desc',
};

/** The audit detail field every platform operation stamps with its subject. */
export const TARGET_TENANT_DETAIL_FIELD = 'target_tenant_id';

/** A count keyed by a discriminator. */
export interface CountByKey {
  readonly key: string;
  readonly count: number;
}

/** Subscription expiry buckets, all derived from one pass. */
export interface SubscriptionHorizon {
  readonly active: number;
  readonly expiringWithin30Days: number;
  readonly expiringWithin60Days: number;
  readonly expiringWithin90Days: number;
  readonly expired: number;
}

/** An organisation at or close to a plan limit. */
export interface CapacityAlertRow {
  readonly tenantId: string;
  readonly tenantCode: string;
  readonly displayName: string;
  /** `companies` | `branches` | `users`. */
  readonly kind: string;
  readonly used: number;
  readonly limit: number;
  /** `at-limit` when used has reached the limit, `near-limit` from 90%. */
  readonly severity: string;
}

/** Platform revenue in one currency. Every amount is a decimal string. */
export interface RevenueByCurrencyRow {
  readonly currencyCode: string;
  readonly contracted: string;
  readonly received: string;
  readonly outstanding: string;
  readonly projectedRenewalValue: string;
}

/** One audit record as the console publishes it. */
export interface PlatformAuditRow {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly actorId: string | null;
  readonly actorKind: string;
  readonly correlationId: string | null;
  readonly targetTenantId: string | null;
  readonly occurredAt: string;
}

export class InsightRepository extends Repository {
  protected readonly module = 'platform';

  /**
   * The database's `now()` for this transaction.
   *
   * Every aggregate below compares against `now()`, and inside one transaction
   * PostgreSQL returns the same value every time — so this IS the instant the
   * figures were read at, which a clock read in this process is not.
   */
  async readDatabaseNow(db: DbHandle): Promise<string> {
    const row = await this.runOne<{ as_of: string | Date }>(db, 'SELECT now() AS as_of');
    return row ? toIsoString(row.as_of) : new Date(0).toISOString();
  }

  /** Organisations grouped by lifecycle state. */
  async countTenantsByStatus(db: DbHandle): Promise<readonly CountByKey[]> {
    const result = await this.run<{ status: string; count: number }>(
      db,
      `SELECT t.status, count(*)::int AS count
         FROM org.tenants t
        GROUP BY t.status
        ORDER BY t.status ASC`
    );
    return result.rows.map((r) => ({ key: r.status, count: r.count }));
  }

  /** How much of the platform exists: active companies, branches and accounts. */
  async countPlatformEntities(db: DbHandle): Promise<{
    readonly activeCompanies: number;
    readonly activeBranches: number;
    readonly activeUserAccounts: number;
  }> {
    const row = await this.runOne<{
      companies: number;
      branches: number;
      users: number;
    }>(
      db,
      `SELECT
         (SELECT count(*)::int FROM org.legal_companies
           WHERE status = 'active' AND deleted_at IS NULL) AS companies,
         (SELECT count(*)::int FROM org.branches
           WHERE status = 'active' AND deleted_at IS NULL) AS branches,
         (SELECT count(*)::int FROM iam.user_accounts
           WHERE status = 'active' AND deleted_at IS NULL) AS users`
    );
    return {
      activeCompanies: row?.companies ?? 0,
      activeBranches: row?.branches ?? 0,
      activeUserAccounts: row?.users ?? 0,
    };
  }

  /**
   * Subscriptions by expiry horizon.
   *
   * The buckets are CUMULATIVE — a subscription ending in eleven days is inside
   * all three windows — because "expiring within 60 days" is the question an
   * operator asks, and a disjoint bucket would answer a different one. An
   * open-ended assignment (`effective_to IS NULL`) is active and expires in no
   * window, which is why every predicate names the column explicitly rather
   * than relying on a comparison with NULL.
   */
  async summariseSubscriptions(db: DbHandle): Promise<SubscriptionHorizon> {
    const row = await this.runOne<{
      active: number;
      within30: number;
      within60: number;
      within90: number;
      expired: number;
    }>(
      db,
      `SELECT
         count(*) FILTER (
           WHERE s.status = 'active'
             AND (s.effective_to IS NULL OR s.effective_to > now()))::int AS active,
         count(*) FILTER (
           WHERE s.status = 'active' AND s.effective_to IS NOT NULL
             AND s.effective_to > now()
             AND s.effective_to <= now() + interval '30 days')::int AS within30,
         count(*) FILTER (
           WHERE s.status = 'active' AND s.effective_to IS NOT NULL
             AND s.effective_to > now()
             AND s.effective_to <= now() + interval '60 days')::int AS within60,
         count(*) FILTER (
           WHERE s.status = 'active' AND s.effective_to IS NOT NULL
             AND s.effective_to > now()
             AND s.effective_to <= now() + interval '90 days')::int AS within90,
         count(*) FILTER (
           WHERE s.effective_to IS NOT NULL AND s.effective_to <= now())::int AS expired
       FROM org.tenant_subscriptions s`
    );
    return {
      active: row?.active ?? 0,
      expiringWithin30Days: row?.within30 ?? 0,
      expiringWithin60Days: row?.within60 ?? 0,
      expiringWithin90Days: row?.within90 ?? 0,
      expired: row?.expired ?? 0,
    };
  }

  /**
   * Organisations at or approaching a plan capacity limit.
   *
   * A limit of zero is skipped rather than reported as "always breached": a
   * plan that grants no branches at all is a configuration statement, not an
   * alert about every tenant holding it. Ratios are computed in `numeric`.
   *
   * Both halves come from `org.capacity_usage`, by name. They used to be
   * assembled here — three counts and a plan-document read — and the counts
   * disagreed with the ones that decide a refusal: a seat is held by an
   * `invited` account as well as an `active` one, so an organisation could be
   * refused its next user while this alert reported it comfortably inside its
   * allowance.
   */
  async listCapacityAlerts(db: DbHandle): Promise<readonly CapacityAlertRow[]> {
    const result = await this.run<{
      tenant_id: string;
      tenant_code: string;
      display_name: string;
      kind: string;
      used: number;
      limit_value: number;
      severity: string;
    }>(
      db,
      `WITH usage AS (
         SELECT t.id AS tenant_id, t.tenant_code, t.display_name,
                org.capacity_usage(t.id) AS allowance
           FROM org.tenants t
       )
       SELECT u.tenant_id, u.tenant_code, u.display_name,
              k.kind,
              (u.allowance -> k.kind ->> 'used')::int AS used,
              (u.allowance -> k.kind ->> 'limit')::int AS limit_value,
              CASE WHEN (u.allowance -> k.kind ->> 'used')::numeric
                     >= (u.allowance -> k.kind ->> 'limit')::numeric
                   THEN 'at-limit' ELSE 'near-limit' END AS severity
         FROM usage u
         CROSS JOIN LATERAL (VALUES ('companies'), ('branches'), ('users')) AS k(kind)
        WHERE (u.allowance -> k.kind ->> 'limit') IS NOT NULL
          AND (u.allowance -> k.kind ->> 'limit')::numeric > 0
          AND (u.allowance -> k.kind ->> 'used')::numeric
                >= 0.9 * (u.allowance -> k.kind ->> 'limit')::numeric
        ORDER BY u.tenant_code ASC, k.kind ASC`
    );
    return result.rows.map((r) => ({
      tenantId: r.tenant_id,
      tenantCode: r.tenant_code,
      displayName: r.display_name,
      kind: r.kind,
      used: r.used,
      limit: r.limit_value,
      severity: r.severity,
    }));
  }

  /**
   * Platform revenue per currency.
   *
   * Four figures, and the fourth is deliberately labelled as a projection
   * rather than as money owed:
   *
   *  - `contracted` — every charge recorded and not voided;
   *  - `received`   — every receipt recorded;
   *  - `outstanding`— the difference, floored at zero per the same rule the
   *    charge list applies;
   *  - `projectedRenewalValue` — the list price of the active subscriptions
   *    whose term ends inside the next twelve months. It is NOT a receivable:
   *    nobody has agreed to renew, no charge exists, and no organisation owes
   *    it. It is here because an operator planning a year needs it, and naming
   *    it plainly is what stops it being read as revenue.
   *
   * Currencies are UNIONed rather than joined, because a currency may appear in
   * charges, in receipts, in plan prices, or in any two of the three, and an
   * inner join would silently drop whichever side is empty.
   */
  async summariseRevenue(db: DbHandle): Promise<readonly RevenueByCurrencyRow[]> {
    const result = await this.run<{
      currency_code: string;
      contracted: string;
      received: string;
      outstanding: string;
      projected: string;
    }>(
      db,
      `WITH charged AS (
         SELECT c.currency_code, sum(c.amount) AS contracted
           FROM org.subscription_charges c
          WHERE c.status IN ('open', 'settled')
          GROUP BY c.currency_code
       ),
       paid AS (
         SELECT r.currency_code, sum(r.amount) AS received
           FROM org.subscription_receipts r
           JOIN org.subscription_charges c ON c.id = r.charge_id
          WHERE c.status IN ('open', 'settled')
          GROUP BY r.currency_code
       ),
       renewals AS (
         SELECT p.currency_code, sum(p.list_price) AS projected
           FROM org.tenant_subscriptions s
           JOIN org.subscription_plans p ON p.id = s.plan_id
          WHERE s.status = 'active'
            AND p.list_price IS NOT NULL
            AND s.effective_to IS NOT NULL
            AND s.effective_to > now()
            AND s.effective_to <= now() + interval '12 months'
          GROUP BY p.currency_code
       ),
       codes AS (
         SELECT currency_code FROM charged
         UNION SELECT currency_code FROM paid
         UNION SELECT currency_code FROM renewals
       )
       SELECT codes.currency_code,
              -- Every figure cast to numeric(18,4) before it becomes text, so a
              -- currency with no receipts reads '0.0000' rather than '0'.
              COALESCE(charged.contracted, 0)::numeric(18, 4)::text AS contracted,
              COALESCE(paid.received, 0)::numeric(18, 4)::text      AS received,
              greatest(COALESCE(charged.contracted, 0) - COALESCE(paid.received, 0), 0)
                ::numeric(18, 4)::text                              AS outstanding,
              COALESCE(renewals.projected, 0)::numeric(18, 4)::text AS projected
         FROM codes
         LEFT JOIN charged   ON charged.currency_code   = codes.currency_code
         LEFT JOIN paid      ON paid.currency_code      = codes.currency_code
         LEFT JOIN renewals  ON renewals.currency_code  = codes.currency_code
        ORDER BY codes.currency_code ASC`
    );
    return result.rows.map((r) => ({
      currencyCode: r.currency_code,
      contracted: r.contracted,
      received: r.received,
      outstanding: r.outstanding,
      projectedRenewalValue: r.projected,
    }));
  }

  /**
   * The operator's own audit trail, bounded and keyset-paginated.
   *
   * The window is mandatory and capped by the service, for the reason
   * `iam.audit-event-list` states: defaulting the range would make the most
   * expensive possible query the one a caller gets by supplying nothing.
   *
   * `targetTenantId` matches a DETAIL field rather than `iam.audit_records`
   * itself, because the record lives in the operator's home tenant and its
   * subject is the organisation it was about. The detail is written with
   * classification `internal`, which `iam.audit_mask` stores verbatim — a
   * `restricted` classification would store `***` and this filter would match
   * nothing while appearing to work.
   */
  async searchAuditRecords(
    db: DbHandle,
    filters: {
      readonly from: string;
      readonly to: string;
      readonly action?: string | undefined;
      readonly actorId?: string | undefined;
      readonly targetTenantId?: string | undefined;
    },
    page: PageRequest
  ): Promise<Page<PlatformAuditRow>> {
    const values: unknown[] = [
      filters.from,
      filters.to,
      filters.action ?? null,
      filters.actorId ?? null,
      filters.targetTenantId ?? null,
      // A bound parameter rather than an interpolated constant. It is
      // code-controlled either way, but no statement in this repository is
      // assembled from a value, and keeping that literally true is cheaper than
      // reasoning about which interpolations are safe.
      TARGET_TENANT_DETAIL_FIELD,
    ];
    const keyset = keysetFragment(
      page,
      { sort: 'a.occurred_at', id: 'a.id' },
      PLATFORM_AUDIT_ORDERING,
      7
    );
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      actor_id: string | null;
      actor_kind: string;
      correlation_id: string | null;
      target_tenant_id: string | null;
      occurred_at: string | Date;
      occurred_at_cursor: string;
    }>(
      db,
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.actor_id, a.actor_kind,
              a.correlation_id, a.occurred_at,
              ${cursorTimestamp('a.occurred_at')} AS occurred_at_cursor,
              (SELECT d.new_value_masked
                 FROM iam.audit_record_details d
                WHERE d.audit_record_id = a.id
                  AND d.field_name = $6
                LIMIT 1) AS target_tenant_id
         FROM iam.audit_records a
        WHERE a.occurred_at >= $1::timestamptz
          AND a.occurred_at <= $2::timestamptz
          AND ($3::text IS NULL OR a.action = $3)
          AND ($4::uuid IS NULL OR a.actor_id = $4::uuid)
          AND ($5::uuid IS NULL OR EXISTS (
                SELECT 1 FROM iam.audit_record_details d
                 WHERE d.audit_record_id = a.id
                   AND d.field_name = $6
                   AND d.new_value_masked = $5::uuid::text
          )) ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );

    return buildPageWithCursors(
      result.rows.map((r) => ({
        item: {
          id: r.id,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          actorId: r.actor_id,
          actorKind: r.actor_kind,
          correlationId: r.correlation_id,
          targetTenantId: r.target_tenant_id,
          occurredAt: toIsoString(r.occurred_at),
        },
        sortValue: r.occurred_at_cursor,
        id: r.id,
      })),
      page,
      PLATFORM_AUDIT_ORDERING
    );
  }
}
