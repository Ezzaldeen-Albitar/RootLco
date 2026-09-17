/**
 * Control-plane repository (PRE-P1-29 Wave B; extended by P1-32-PRE-021/022).
 *
 * Every statement here runs on the PLATFORM connection, as `app_platform`, and
 * is bounded by that role's own privileges and policies — not by a tenant
 * predicate. That is the whole difference between this module and every other
 * one in the product: the reads deliberately cross the tenant boundary, and what
 * stops them going further is `iam.has_platform_authority` inside each policy.
 *
 * So there is no `tenant_id = iam.current_tenant_id()` predicate on the reads
 * below, and its absence is a decision rather than an omission. `org.tenants`
 * carries `sel_tenants_platform`, whose `USING` is a disjunction of the three
 * platform authorities with no row term, so a holder reads every tenant row and
 * a non-holder reads none. Adding a tenant predicate here would make the
 * control-plane read return the operator's own tenant only, which is exactly the
 * capability §12.2 says does not exist today.
 *
 * The two Wave-B writes are function calls, never direct DML.
 * `org.provision_organization` and `org.change_tenant_status` are both
 * `SECURITY INVOKER`, so they execute with `app_platform`'s privileges and RLS —
 * the function is the sanctioned path, not a privilege escalation around one.
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

/**
 * Ordering contract for the organisation list.
 *
 * `(created_at DESC, id DESC)` — the order the Wave-B read already published,
 * now keyset-paginated rather than clamped by a bare LIMIT. The key is stable
 * and versioned by name, so a cursor minted for it cannot be replayed against a
 * different ordering.
 */
export const ORGANIZATION_ORDERING: OrderingContract = {
  key: 'org.tenants:created_at_desc',
  direction: 'desc',
};

export interface OrganizationRow {
  readonly id: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly status: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly createdAt: string;
  /** Plan code in force right now, or null when no active assignment covers today. */
  readonly activePlanCode: string | null;
  /** When that assignment ends. Null means open-ended. */
  readonly activePlanEffectiveTo: string | null;
  readonly activeCompanyCount: number;
  readonly activeBranchCount: number;
  readonly activeUserCount: number;
}

/** Filters the organisation list accepts. Each is optional and they are ANDed. */
export interface OrganizationSearchFilters {
  readonly tenantId?: string | undefined;
  /** Case-insensitive CONTAINS over tenant_code and display_name. */
  readonly q?: string | undefined;
  readonly status?: string | undefined;
}

/** One legal company of an organisation, as the console detail publishes it. */
export interface OrganizationCompanyRow {
  readonly id: string;
  readonly code: string;
  readonly legalName: string;
  readonly status: string;
}

/** One branch of an organisation. */
export interface OrganizationBranchRow {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

/** A tenant lifecycle transition, from org.tenant_status_history. */
export interface TenantStatusHistoryRow {
  readonly fromState: string | null;
  readonly toState: string;
  readonly reason: string | null;
  readonly occurredAt: string;
}

/** What the caller's own platform session resolves to. */
export interface PlatformSessionRow {
  readonly userId: string;
  readonly homeTenantId: string;
  readonly platformPermissions: readonly string[];
}

/**
 * One capacity kind as `org.capacity_usage` publishes it.
 *
 * `limit` is `null` for unlimited and never absent — the published convention of
 * the function itself, which the tenant capacity read and this console share.
 */
export interface CapacityAllowanceRow {
  readonly used: number;
  readonly limit: number | null;
}

/** The three ceilings a subscription can place on an organisation. */
export interface CapacityUsageRow {
  readonly companies: CapacityAllowanceRow;
  readonly branches: CapacityAllowanceRow;
  readonly users: CapacityAllowanceRow;
}

/** The tenant root, as every single-organisation operation resolves it first. */
export interface TenantRootRow {
  readonly id: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly status: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly createdAt: string;
}

/**
 * The three roots `org.provision_organization` creates and names in its own
 * response document.
 *
 * A named type rather than an inline shape because it now crosses a module
 * boundary: the branch-scoped number sequences are keyed on the company and
 * branch, so `@/modules/shared-services` is handed this pair.
 */
export interface ProvisionedRoot {
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
}

export class PlatformRepository extends Repository {
  protected readonly module = 'platform';

  /**
   * The organisation list (§6.5), extended for the Platform Owner Console.
   *
   * `tenantId` is optional and stays: one registered operation serves both the
   * collection and a single named tenant, the shape `inv.stock-availability-read`
   * already uses. Omitting it lists; supplying it narrows to one row. Either way
   * the rows a caller can see are decided by `sel_tenants_platform`, not by this
   * predicate — an unauthorised caller gets an empty result rather than a
   * filtered one.
   *
   * Three things were added for the console, each a deliberate shape:
   *
   *  - `q` matches `tenant_code` or `display_name` case-insensitively. The
   *    comparison is COLUMN-SIDE (`lower(column) LIKE $n`) with the wildcards
   *    built by `escapeLikeFragment`, so the caller's text is a bound parameter
   *    and never part of the statement, and a search for `a_b` does not quietly
   *    match `axb`.
   *  - keyset pagination over `(created_at DESC, id DESC)`, replacing a bare
   *    LIMIT that could never reach a second page.
   *  - the facts a console list is useless without: the plan in force, when it
   *    ends, and how much of the organisation exists. The counts are correlated
   *    subqueries rather than joins, because a join would multiply the rows and
   *    then need a DISTINCT to undo itself.
   *
   * The user count reads `iam.user_accounts` across tenants. That is possible
   * only through `sel_user_accounts_platform_census`, whose grant is
   * column-scoped to (id, tenant_id, status, deleted_at) — so this query can
   * produce a NUMBER and could not produce a name or an address even if it
   * asked for one.
   */
  async listOrganizations(
    db: DbHandle,
    filters: OrganizationSearchFilters,
    page: PageRequest
  ): Promise<Page<OrganizationRow>> {
    const values: unknown[] = [
      filters.tenantId ?? null,
      filters.q === undefined ? null : `%${escapeLikeFragment(filters.q)}%`,
      filters.status ?? null,
    ];
    const keyset = keysetFragment(
      page,
      { sort: 't.created_at', id: 't.id' },
      ORGANIZATION_ORDERING,
      4
    );
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      tenant_code: string;
      display_name: string;
      status: string;
      default_locale: string;
      default_timezone: string;
      created_at: string | Date;
      created_at_cursor: string;
      active_plan_code: string | null;
      active_plan_effective_to: string | Date | null;
      active_company_count: number;
      active_branch_count: number;
      active_user_count: number;
    }>(
      db,
      `SELECT t.id,
              t.tenant_code,
              t.display_name,
              t.status,
              t.default_locale,
              t.default_timezone,
              t.created_at,
              ${cursorTimestamp('t.created_at')} AS created_at_cursor,
              live.plan_code    AS active_plan_code,
              live.effective_to AS active_plan_effective_to,
              (SELECT count(*)::int FROM org.legal_companies c
                WHERE c.tenant_id = t.id AND c.status = 'active' AND c.deleted_at IS NULL)
                AS active_company_count,
              (SELECT count(*)::int FROM org.branches b
                WHERE b.tenant_id = t.id AND b.status = 'active' AND b.deleted_at IS NULL)
                AS active_branch_count,
              (SELECT count(*)::int FROM iam.user_accounts u
                WHERE u.tenant_id = t.id AND u.status = 'active' AND u.deleted_at IS NULL)
                AS active_user_count
         FROM org.tenants t
         LEFT JOIN LATERAL (
              SELECT p.plan_code, s.effective_to
                FROM org.tenant_subscriptions s
                JOIN org.subscription_plans p ON p.id = s.plan_id
               WHERE s.tenant_id = t.id
                 AND s.status = 'active'
                 AND s.effective_from <= now()
                 AND (s.effective_to IS NULL OR s.effective_to > now())
               ORDER BY s.effective_from DESC
               LIMIT 1
         ) live ON TRUE
        WHERE ($1::uuid IS NULL OR t.id = $1::uuid)
          AND ($2::text IS NULL
               OR lower(t.tenant_code) LIKE $2 ESCAPE '!'
               OR lower(t.display_name) LIKE $2 ESCAPE '!')
          AND ($3::text IS NULL OR t.status = $3) ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      values
    );

    return buildPageWithCursors(
      result.rows.map((r) => ({
        item: {
          id: r.id,
          tenantCode: r.tenant_code,
          displayName: r.display_name,
          status: r.status,
          defaultLocale: r.default_locale,
          defaultTimezone: r.default_timezone,
          createdAt: toIsoString(r.created_at),
          activePlanCode: r.active_plan_code,
          activePlanEffectiveTo:
            r.active_plan_effective_to === null ? null : toIsoString(r.active_plan_effective_to),
          activeCompanyCount: r.active_company_count,
          activeBranchCount: r.active_branch_count,
          activeUserCount: r.active_user_count,
        },
        sortValue: r.created_at_cursor,
        id: r.id,
      })),
      page,
      ORGANIZATION_ORDERING
    );
  }

  /**
   * The tenant row itself, or null when it does not exist or the caller cannot
   * see it. Every operation that addresses ONE organisation resolves this first,
   * so an unknown tenant answers `404` rather than an empty document.
   */
  async readTenantRoot(db: DbHandle, tenantId: string): Promise<TenantRootRow | null> {
    const row = await this.runOne<{
      id: string;
      tenant_code: string;
      display_name: string;
      status: string;
      default_locale: string;
      default_timezone: string;
      created_at: string | Date;
    }>(
      db,
      `SELECT t.id, t.tenant_code, t.display_name, t.status,
              t.default_locale, t.default_timezone, t.created_at
         FROM org.tenants t
        WHERE t.id = $1::uuid`,
      [tenantId]
    );
    if (!row) return null;
    return {
      id: row.id,
      tenantCode: row.tenant_code,
      displayName: row.display_name,
      status: row.status,
      defaultLocale: row.default_locale,
      defaultTimezone: row.default_timezone,
      createdAt: toIsoString(row.created_at),
    };
  }

  /** The legal companies of one organisation, code order. */
  async listCompanies(db: DbHandle, tenantId: string): Promise<readonly OrganizationCompanyRow[]> {
    const result = await this.run<{
      id: string;
      company_code: string;
      legal_name: string;
      status: string;
    }>(
      db,
      `SELECT c.id, c.company_code, c.legal_name, c.status
         FROM org.legal_companies c
        WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL
        ORDER BY c.company_code ASC`,
      [tenantId]
    );
    return result.rows.map((r) => ({
      id: r.id,
      code: r.company_code,
      legalName: r.legal_name,
      status: r.status,
    }));
  }

  /** The branches of one organisation, company then code order. */
  async listBranches(db: DbHandle, tenantId: string): Promise<readonly OrganizationBranchRow[]> {
    const result = await this.run<{
      id: string;
      company_id: string;
      branch_code: string;
      name: string;
      status: string;
    }>(
      db,
      `SELECT b.id, b.company_id, b.branch_code, b.name, b.status
         FROM org.branches b
        WHERE b.tenant_id = $1::uuid AND b.deleted_at IS NULL
        ORDER BY b.company_id ASC, b.branch_code ASC`,
      [tenantId]
    );
    return result.rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      code: r.branch_code,
      name: r.name,
      status: r.status,
    }));
  }

  /**
   * How many accounts an organisation holds, by lifecycle state.
   *
   * A COUNT and nothing else, and that is a property of the PRIVILEGE rather
   * than of this statement: there is no spelling of this query that could
   * return an email, because `app_platform` holds no SELECT on that column.
   */
  async countUsersByStatus(
    db: DbHandle,
    tenantId: string
  ): Promise<readonly { readonly status: string; readonly count: number }[]> {
    const result = await this.run<{ status: string; count: number }>(
      db,
      `SELECT u.status, count(*)::int AS count
         FROM iam.user_accounts u
        WHERE u.tenant_id = $1::uuid AND u.deleted_at IS NULL
        GROUP BY u.status
        ORDER BY u.status ASC`,
      [tenantId]
    );
    return result.rows.map((r) => ({ status: r.status, count: r.count }));
  }

  /** The tenant lifecycle trail, newest first. */
  async listStatusHistory(
    db: DbHandle,
    tenantId: string,
    limit: number
  ): Promise<readonly TenantStatusHistoryRow[]> {
    const result = await this.run<{
      from_state: string | null;
      to_state: string;
      reason: string | null;
      occurred_at: string | Date;
    }>(
      db,
      `SELECT h.from_state, h.to_state, h.reason, h.occurred_at
         FROM org.tenant_status_history h
        WHERE h.tenant_id = $1::uuid
        ORDER BY h.occurred_at DESC, h.seq DESC
        LIMIT $2`,
      [tenantId, limit]
    );
    return result.rows.map((r) => ({
      fromState: r.from_state,
      toState: r.to_state,
      reason: r.reason,
      occurredAt: toIsoString(r.occurred_at),
    }));
  }

  /**
   * The caller's own platform session.
   *
   * Every value is server-derived. The identity comes from
   * `iam.current_user_id()` — the same function the authority predicate resolves
   * from — and never from the request; the grant list is read from
   * `iam.platform_grants` under `sel_platform_grants_own`, which admits the
   * operator's own rows and nobody else's. So this operation cannot be used to
   * enumerate another operator's authority.
   */
  async readSession(db: DbHandle): Promise<PlatformSessionRow | null> {
    const row = await this.runOne<{
      user_id: string | null;
      home_tenant_id: string | null;
      codes: string[] | null;
    }>(
      db,
      `SELECT iam.current_user_id()   AS user_id,
              iam.current_tenant_id() AS home_tenant_id,
              (SELECT array_agg(g.permission_code ORDER BY g.permission_code)
                 FROM (SELECT DISTINCT permission_code
                         FROM iam.platform_grants
                        WHERE account_id = iam.current_user_id()
                          AND revoked_at IS NULL) g) AS codes`
    );
    if (!row || row.user_id === null || row.home_tenant_id === null) return null;
    return {
      userId: row.user_id,
      homeTenantId: row.home_tenant_id,
      platformPermissions: row.codes ?? [],
    };
  }

  /**
   * The sanctioned provisioning path (§6.2). One call, one transaction: the
   * function already performs tenant, history, subscription, company, branch,
   * settings, overrides, sequences and replay protection and rolls all of it
   * back on any failure.
   *
   * `tenant.activate` is NEVER set. That branch calls `org.change_tenant_status`
   * inside the same transaction, which would move the tenant out of
   * `provisioning` BEFORE the First-Owner bootstrap runs — closing the bootstrap
   * window inside the transaction that depends on it. Activation is a separate
   * later act under `platform.organization.lifecycle`.
   */
  async provisionOrganization(
    db: DbHandle,
    spec: Readonly<Record<string, unknown>>,
    idempotencyKey: string
  ): Promise<ProvisionedRoot> {
    const row = await this.runOne<{
      result: { tenant_id: string; company_id: string; branch_id: string };
    }>(db, 'SELECT org.provision_organization($1::jsonb, $2) AS result', [
      JSON.stringify(spec),
      idempotencyKey,
    ]);
    if (!row) throw new Error('provision_organization returned no row');
    // The company and branch are read from the SAME response document the
    // function has always returned (`jsonb_build_object('tenant_id', …,
    // 'company_id', …, 'branch_id', …)`), not from a second query. They are
    // needed because the branch-scoped number sequences the P1-30 corrective
    // slice provisions are keyed on exactly this pair, and `app_platform` could
    // otherwise only rediscover them through org.legal_companies /
    // org.branches — a read it holds, but a second source for a fact the
    // provisioning call already handed back.
    return {
      tenantId: row.result.tenant_id,
      companyId: row.result.company_id,
      branchId: row.result.branch_id,
    };
  }

  /**
   * What one organisation may hold and what it is holding, from
   * `org.capacity_usage` — BY NAME.
   *
   * The console used to assemble this itself: three counts taken from the lists
   * it had already read, and a limit picked out of the plan document by a
   * TypeScript reader. That was a second definition of every number, and it
   * disagreed with the one that decides a refusal — the database counts a seat
   * as `invited` OR `active` while the console counted only `active`, so an
   * organisation could be refused its next user while the console showed a seat
   * free. There is one definition, it is in the database, and this is the read
   * of it.
   */
  async readCapacityUsage(db: DbHandle, tenantId: string): Promise<CapacityUsageRow> {
    const row = await this.runOne<{ usage: CapacityUsageRow }>(
      db,
      'SELECT org.capacity_usage($1) AS usage',
      [tenantId]
    );
    if (row === null) throw new Error('capacity usage returned no row');
    return row.usage;
  }

  /**
   * Whether the acting principal holds a platform authority — the same
   * predicate every control-plane policy evaluates, asked directly so a
   * refusal can come BEFORE a write rather than as a rolled-back one.
   */
  async holdsPlatformAuthority(db: DbHandle, code: string): Promise<boolean> {
    const row = await this.runOne<{ held: boolean }>(
      db,
      'SELECT iam.has_platform_authority($1) AS held',
      [code]
    );
    return (row as { held: boolean }).held === true;
  }

  /**
   * The lifecycle transition (§6.4).
   *
   * The graph is validated by M4's `BEFORE UPDATE` backstop and the history row
   * is written by M3's `AFTER UPDATE` emitter, so an illegal destination is
   * refused and a legal one is recorded whatever performs the write. The actor
   * is NOT passed from the request: `shared.stamp_status_history()` derives it
   * from `iam.current_user_id()`. A caller-supplied value must never become the
   * input to an authority predicate.
   */
  async changeStatus(
    db: DbHandle,
    params: {
      readonly tenantId: string;
      readonly toState: string;
      readonly reason: string;
      readonly correlationId?: string;
    }
  ): Promise<void> {
    await this.run(db, 'SELECT org.change_tenant_status($1::uuid, $2, $3, NULL, $4::uuid)', [
      params.tenantId,
      params.toState,
      params.reason,
      params.correlationId ?? null,
    ]);
  }
}

/**
 * Escapes the three characters `LIKE` treats specially, so a caller's search
 * fragment is matched literally.
 *
 * Without this, a fragment of `%` matches every organisation on the platform and
 * `_` matches any single character — the search box would silently be a wildcard
 * language nobody asked for. `!` is the escape character (declared by the
 * `ESCAPE` clause at the call site) rather than a backslash, because a backslash
 * has to survive both a JavaScript template literal and a SQL string literal and
 * is a well-known place to get the count wrong. The escape character itself is
 * escaped FIRST, or escaping the other two would double-escape their new
 * prefixes.
 */
export function escapeLikeFragment(fragment: string): string {
  return fragment.toLowerCase().replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_');
}

/**
 * Renders a timestamp the driver may hand back as a `Date` or as a string.
 *
 * `pg` decodes `timestamptz` into a `Date`; a `date` column and several
 * aggregates arrive as a string. Both reach the wire as text, and narrowing it
 * here means no service has to know which it was given.
 */
export function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
