/**
 * P1-32-PRE-OD-FD8 — ADR-023 D8 (no self-exemption from discount approval) and D3
 * (the requester withdraws their own pending discount request), held by the
 * database: migration 20261007090000_quo_discount_self_exemption_and_withdrawal.sql,
 * and its fix round 1, 20261007100000_quo_discount_limit_window_and_amount_provenance.sql
 * (a limit window the requester moved, and who set a price's amount), and fix round 2,
 * 20261007110000_quo_discount_limit_window_history.sql (who ever moved a limit window is
 * kept in window_changed_by, for the requester and for the approver), and fix round 3,
 * 20261007120000_quo_discount_self_set_price_without_discount.sql (a price the
 * requester set needs another person even when the quotation carries no discount), and
 * fix round 4, 20261007130000_quo_price_list_assignment_provenance.sql (who made or
 * changed the price-list assignment that selected a line's list, and any assignment
 * the requester changed, count as the requester's own price).
 *
 * Every case runs in a rolled-back transaction as `app_runtime`, switching the
 * signed-in person with `app.user_id` exactly as the application does. USER_A is the
 * quotation writer (the requester); OTHER_ACTOR is a separate administrator; the two
 * fixture approvers hold `svc.price.manage` through a role.
 */
import type { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  setContext,
  TENANT_A,
  TENANT_B,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
  USER_B,
} from './helpers';
import {
  seedItem,
  seedService,
  seedQuotation,
  draftRevision,
  addServiceItem,
  OTHER_ACTOR,
} from './p1-10-helpers';
import { ctxA, makeWorkOrder, seedP111Base } from './p1-11-helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();

/** Holds svc.price.manage; a 1000 USD limit an administrator (OTHER_ACTOR) set. */
const APPROVER = 'd8d30000-0000-4000-8000-000000000001';
/** Holds svc.price.manage; the only limit on file is a 1000 USD one the REQUESTER set. */
const APPROVER_REQUESTER_SET = 'd8d30000-0000-4000-8000-000000000002';
/** A third person who publishes price lists in these cases (no account is needed). */
const PUBLISHER = 'd8d30000-0000-4000-8000-0000000000f1';
const ROLE_PRICE_MANAGER = 'd8d30000-0000-4000-8000-0000000000a1';
/** A requester who also holds iam.approval.manage, so they can move a limit's dates. */
const LIMIT_REQUESTER = 'd8d30000-0000-4000-8000-000000000003';
/** Holds svc.price.manage; its only discount limit (OTHER_ACTOR's, 1000 USD) has expired. */
const APPROVER_REOPEN = 'd8d30000-0000-4000-8000-000000000004';
/**
 * Holds svc.price.manage through ROLE_WIDE, whose role limit is 1000 USD; its own user
 * limit is 10 USD. Both were set by OTHER_ACTOR. The user limit wins while in force.
 */
const APPROVER_ENDED = 'd8d30000-0000-4000-8000-000000000005';
const ROLE_LIMIT_ADMIN = 'd8d30000-0000-4000-8000-0000000000a2';
const ROLE_WIDE = 'd8d30000-0000-4000-8000-0000000000a3';
/**
 * Fix round 2. Holds svc.price.manage and iam.approval.manage; its only discount limit
 * (OTHER_ACTOR's, 1000 USD, on the person) has expired.
 */
const APPROVER_SELF_USER = 'd8d30000-0000-4000-8000-000000000006';
/**
 * Fix round 2. Holds svc.price.manage through ROLE_SELF_WIDE, whose 1000 USD limit
 * OTHER_ACTOR set and which is in force for 30 more days, and iam.approval.manage.
 */
const APPROVER_SELF_ROLE = 'd8d30000-0000-4000-8000-000000000007';
const ROLE_SELF_WIDE = 'd8d30000-0000-4000-8000-0000000000a4';
/** Fix round 2. A colleague who may administer limits and decides nothing here. */
const LIMIT_COLLEAGUE = 'd8d30000-0000-4000-8000-000000000008';

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
  for (const [id, n] of [
    [APPROVER, '01'],
    [APPROVER_REQUESTER_SET, '02'],
    [LIMIT_REQUESTER, '03'],
    [APPROVER_REOPEN, '04'],
    [APPROVER_ENDED, '05'],
    [APPROVER_SELF_USER, '06'],
    [APPROVER_SELF_ROLE, '07'],
    [LIMIT_COLLEAGUE, '08'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1::uuid, $2::uuid, 'test_harness', $3, $4, $5, 'active', $6::uuid)
       ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, `fx_db_fd8_${n}`, `db-fd8-${n}@example.test`, `Fixture FD8 ${n}`, USER_A]
    );
  }
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1::uuid, $2::uuid, 'fx_db_fd8_price_manager', 'DB fixture FD8 price manager', $3::uuid)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_PRICE_MANAGER, TENANT_A, USER_A]
  );
  for (const [role, code, name] of [
    [ROLE_LIMIT_ADMIN, 'fx_db_fd8_limit_admin', 'DB fixture FD8 limit administrator'],
    [ROLE_WIDE, 'fx_db_fd8_wide', 'DB fixture FD8 wide approver'],
    [ROLE_SELF_WIDE, 'fx_db_fd8_self_wide', 'DB fixture FD8 self-moving approver'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid)
       ON CONFLICT (id) DO NOTHING`,
      [role, TENANT_A, code, name, USER_A]
    );
  }
  for (const [role, code] of [
    [ROLE_PRICE_MANAGER, 'svc.price.manage'],
    [ROLE_WIDE, 'svc.price.manage'],
    [ROLE_LIMIT_ADMIN, 'iam.approval.manage'],
    [ROLE_SELF_WIDE, 'svc.price.manage'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
         FROM iam.permissions p WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [TENANT_A, role, USER_A, code]
    );
  }
  for (const [id, role] of [
    [APPROVER, ROLE_PRICE_MANAGER],
    [APPROVER_REQUESTER_SET, ROLE_PRICE_MANAGER],
    [APPROVER_REOPEN, ROLE_PRICE_MANAGER],
    [APPROVER_ENDED, ROLE_WIDE],
    [LIMIT_REQUESTER, ROLE_LIMIT_ADMIN],
    [APPROVER_REOPEN, ROLE_LIMIT_ADMIN],
    [APPROVER_SELF_USER, ROLE_PRICE_MANAGER],
    [APPROVER_SELF_USER, ROLE_LIMIT_ADMIN],
    [APPROVER_SELF_ROLE, ROLE_SELF_WIDE],
    [APPROVER_SELF_ROLE, ROLE_LIMIT_ADMIN],
    [LIMIT_COLLEAGUE, ROLE_LIMIT_ADMIN],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       SELECT $1::uuid, $2::uuid, $3::uuid, 'unrestricted', $4::uuid, $4::uuid
        WHERE NOT EXISTS (
          SELECT 1 FROM iam.role_grants
           WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND role_id = $3::uuid
             AND status = 'active')`,
      [TENANT_A, id, role, USER_A]
    );
  }
  for (const [id, setBy] of [
    [APPROVER, OTHER_ACTOR],
    [APPROVER_REQUESTER_SET, USER_A],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.approval_limits
         (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
       SELECT $1::uuid, $2::uuid, $3::uuid, 'discount', 1000, 'USD', current_date - 1, $4::uuid
        WHERE NOT EXISTS (
          SELECT 1 FROM iam.approval_limits
           WHERE tenant_id = $1::uuid AND user_id = $3::uuid AND limit_type = 'discount')`,
      [TENANT_A, COMPANY_A1, id, setBy]
    );
  }
  // APPROVER_REOPEN: an administrator's limit that ended yesterday.
  await admin.query(
    `INSERT INTO iam.approval_limits
       (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, effective_to, created_by)
     SELECT $1::uuid, $2::uuid, $3::uuid, 'discount', 1000, 'USD', current_date - 30, current_date - 1, $4::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.approval_limits
         WHERE tenant_id = $1::uuid AND user_id = $3::uuid AND limit_type = 'discount')`,
    [TENANT_A, COMPANY_A1, APPROVER_REOPEN, OTHER_ACTOR]
  );
  // APPROVER_ENDED: a small user limit in force, and a larger limit on its role.
  await admin.query(
    `INSERT INTO iam.approval_limits
       (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
     SELECT $1::uuid, $2::uuid, $3::uuid, 'discount', 10, 'USD', current_date - 30, $4::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.approval_limits
         WHERE tenant_id = $1::uuid AND user_id = $3::uuid AND limit_type = 'discount')`,
    [TENANT_A, COMPANY_A1, APPROVER_ENDED, OTHER_ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.approval_limits
       (tenant_id, company_id, role_id, limit_type, amount, currency_code, effective_from, created_by)
     SELECT $1::uuid, $2::uuid, $3::uuid, 'discount', 1000, 'USD', current_date - 30, $4::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.approval_limits
         WHERE tenant_id = $1::uuid AND role_id = $3::uuid AND limit_type = 'discount')`,
    [TENANT_A, COMPANY_A1, ROLE_WIDE, OTHER_ACTOR]
  );
  // APPROVER_SELF_USER: an administrator's limit on the person that ended yesterday.
  await admin.query(
    `INSERT INTO iam.approval_limits
       (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, effective_to, created_by)
     SELECT $1::uuid, $2::uuid, $3::uuid, 'discount', 1000, 'USD', current_date - 30, current_date - 1, $4::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.approval_limits
         WHERE tenant_id = $1::uuid AND user_id = $3::uuid AND limit_type = 'discount')`,
    [TENANT_A, COMPANY_A1, APPROVER_SELF_USER, OTHER_ACTOR]
  );
  // APPROVER_SELF_ROLE: an administrator's limit on its role, in force for 30 more days.
  await admin.query(
    `INSERT INTO iam.approval_limits
       (tenant_id, company_id, role_id, limit_type, amount, currency_code, effective_from, effective_to, created_by)
     SELECT $1::uuid, $2::uuid, $3::uuid, 'discount', 1000, 'USD', current_date - 30, current_date + 30, $4::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.approval_limits
         WHERE tenant_id = $1::uuid AND role_id = $3::uuid AND limit_type = 'discount')`,
    [TENANT_A, COMPANY_A1, ROLE_SELF_WIDE, OTHER_ACTOR]
  );
}, 180_000);

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

const one = async <T>(c: Q, sql: string, params: unknown[] = []): Promise<T> =>
  (await c.query(sql, params)).rows[0] as T;

/** Runs `write` signed in as `actor`, then as USER_A again. */
async function as<T>(c: Q, actor: string, write: () => Promise<T>): Promise<T> {
  await c.query(`SELECT set_config('app.user_id', $1, true)`, [actor]);
  try {
    return await write();
  } finally {
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [USER_A]);
  }
}

/** A refusal whose SQLSTATE AND message name the rule — a code alone is not proof. */
async function expectRefusal(
  c: Q,
  rule: RegExp,
  sql: string,
  params: unknown[] = [],
  code = '23514'
): Promise<void> {
  await c.query('SAVEPOINT sp_fd8');
  let err: { code?: string; message?: string } | undefined;
  try {
    await c.query(sql, params);
  } catch (e) {
    err = e as { code?: string; message?: string };
  }
  await c.query('ROLLBACK TO SAVEPOINT sp_fd8');
  expect(err, `expected ${String(rule)} but the statement succeeded`).toBeDefined();
  expect(err?.code).toBe(code);
  expect(err?.message ?? '').toMatch(rule);
}

/**
 * The next discount threshold version of COMPANY_A1, recorded by whoever is signed in.
 * `created_by` names somebody else on purpose: the provenance is the session's.
 */
async function recordThreshold(c: Q, value: string): Promise<string> {
  return (
    await one<{ id: string }>(
      c,
      `INSERT INTO svc.pricing_approval_policies
         (tenant_id, company_id, policy_type, threshold_kind, threshold_value, currency_code,
          required_permission_code, version_no, effective_from, status, created_by, set_by)
       SELECT $1, $2, 'discount', 'amount', $3::numeric, 'USD', 'svc.price.manage',
              COALESCE(max(p.version_no), 0) + 1, current_date, 'active', $4, $4
         FROM svc.pricing_approval_policies p
        WHERE p.tenant_id = $1 AND p.company_id = $2 AND p.policy_type = 'discount'
       RETURNING id`,
      [TENANT_A, COMPANY_A1, value, PUBLISHER]
    )
  ).id;
}

/** A draft price list version with one rule for `service`, written by whoever is signed in. */
async function draftPrice(
  c: Q,
  service: string,
  tag: string
): Promise<{ priceList: string; version: string; rule: string }> {
  const priceList = (
    await one<{ id: string }>(
      c,
      `INSERT INTO svc.price_lists (tenant_id, price_list_code, name, currency_code, created_by)
       VALUES ($1,$2,$3,'USD',$4) RETURNING id`,
      [TENANT_A, `PL_${tag}`, `Price list ${tag}`, USER_A]
    )
  ).id;
  const version = (
    await one<{ id: string }>(
      c,
      `INSERT INTO svc.price_list_versions (tenant_id, price_list_id, version_no, effective_from, status, created_by, published_by)
       VALUES ($1,$2,1,DATE '2026-01-01','draft',$3,$3) RETURNING id`,
      [TENANT_A, priceList, USER_A]
    )
  ).id;
  const rule = (
    await one<{ id: string }>(
      c,
      `INSERT INTO svc.price_rules (tenant_id, price_list_version_id, service_id, amount, priority, created_by, price_changed_by)
       VALUES ($1,$2,$3,100,0,$4,$4) RETURNING id`,
      [TENANT_A, version, service, PUBLISHER]
    )
  ).id;
  return { priceList, version, rule };
}

/** Publishes a draft version, signed in as `actor`. */
async function publish(c: Q, actor: string, priceList: string, version: string): Promise<void> {
  await as(c, actor, () =>
    c.query(`SELECT svc.publish_price_list_version($1,$2,DATE '2026-01-01')`, [priceList, version])
  );
}

/** A discounted service line priced from `rule`; the writer's provenance claim is ignored. */
async function addRuleLine(
  c: Q,
  revision: string,
  service: string,
  rule: string,
  discount: number
): Promise<string> {
  return (
    await one<{ id: string }>(
      c,
      `INSERT INTO quo.quotation_items
         (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind, service_id,
          price_rule_ref, currency_code, captured_unit_price, captured_quantity, captured_discount,
          captured_tax_rate, captured_tax_amount, captured_line_total, created_by,
          price_changed_by, price_published_by)
       VALUES ($1,$2,$3,$4,1,'service',$5,$6,'USD',100,1,$7,0,0,100 - $7::numeric,$8,$9,$9)
       RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, revision, service, rule, discount, USER_A, PUBLISHER]
    )
  ).id;
}

/** A revision written by `writer` (the requester of any request it records). */
async function revisionBy(
  c: Q,
  quotation: string,
  number: number,
  writer: string
): Promise<string> {
  return (
    await one<{ id: string }>(
      c,
      `INSERT INTO quo.quotation_revisions
         (tenant_id, company_id, branch_id, quotation_id, revision_number, currency_code, created_by)
       VALUES ($1,$2,$3,$4,$5,'USD',$6) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, number, writer]
    )
  ).id;
}

/**
 * A pending request for `revision`, carrying the quotation's pinned policy, asked by
 * USER_A. The writer claims no D8 reason; the database computes it.
 */
async function requestFor(
  c: Q,
  quotation: string,
  revision: string,
  discount: string,
  requester: string = USER_A
): Promise<string> {
  return (
    await one<{ id: string }>(
      c,
      `INSERT INTO quo.discount_approvals
         (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, currency_code,
          discount_total, discount_base, elevated_line_count, policy_id, policy_version_no,
          threshold_kind, threshold_value, threshold_currency_code, required_permission_code,
          requested_by, created_by, requester_set_policy, requester_set_price)
       SELECT $1,$2,$3,$4,$5,'USD',$6,100,0,p.id,p.version_no,p.threshold_kind,
              p.threshold_value,p.currency_code,
              COALESCE(p.required_permission_code, 'svc.price.manage'),$7,$7,false,false
         FROM (SELECT 1) one
         LEFT JOIN quo.quotation_discount_policy($1, $4) p ON true
       RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, revision, discount, requester]
    )
  ).id;
}

const approveSql = `UPDATE quo.discount_approvals
    SET status = 'approved', decided_by = $2, decided_at = now(),
        approved_discount_total = discount_total, approved_currency_code = currency_code
  WHERE id = $1`;
const rejectSql = `UPDATE quo.discount_approvals
    SET status = 'rejected', decided_by = $2, decided_at = now(), decision_reason = 'Too generous'
  WHERE id = $1`;
const withdrawSql = `UPDATE quo.discount_approvals SET status = 'withdrawn' WHERE id = $1`;

const basisOf = (c: Q, revision: string, person: string) =>
  one<{ own_policy: boolean; own_price: boolean }>(
    c,
    `SELECT own_policy, own_price FROM quo.revision_self_change_basis($1, $2)`,
    [revision, person]
  );
const needsApproval = async (c: Q, revision: string): Promise<boolean> =>
  (
    await one<{ needs: boolean }>(c, `SELECT quo.revision_discount_needs_approval($1) AS needs`, [
      revision,
    ])
  ).needs;

describe('quo discount self-exemption and withdrawal — the schema', () => {
  it('adds the provenance and withdrawal columns, nullable where they record an act', async () => {
    const columns = await admin.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT table_schema, table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE (table_schema, table_name, column_name) IN (
          ('svc','pricing_approval_policies','set_by'), ('svc','pricing_approval_policies','set_at'),
          ('svc','price_rules','price_changed_by'), ('svc','price_rules','price_changed_at'),
          ('svc','price_list_versions','published_by'), ('svc','price_list_versions','published_at'),
          ('inv','item_sale_prices','price_changed_by'), ('inv','item_sale_prices','price_changed_at'),
          ('quo','quotation_items','price_changed_by'), ('quo','quotation_items','price_changed_at'),
          ('quo','quotation_items','price_published_by'), ('quo','quotation_items','price_published_at'),
          ('quo','discount_approvals','requester_set_policy'),
          ('quo','discount_approvals','requester_set_price'),
          ('quo','discount_approvals','approver_limit_id'),
          ('quo','discount_approvals','withdrawn_by'), ('quo','discount_approvals','withdrawn_at'))
        ORDER BY table_schema, table_name, column_name`
    );
    expect(columns.rows).toEqual(
      [
        ['inv', 'item_sale_prices', 'price_changed_at', 'timestamp with time zone', 'YES'],
        ['inv', 'item_sale_prices', 'price_changed_by', 'uuid', 'YES'],
        ['quo', 'discount_approvals', 'approver_limit_id', 'uuid', 'YES'],
        ['quo', 'discount_approvals', 'requester_set_policy', 'boolean', 'NO'],
        ['quo', 'discount_approvals', 'requester_set_price', 'boolean', 'NO'],
        ['quo', 'discount_approvals', 'withdrawn_at', 'timestamp with time zone', 'YES'],
        ['quo', 'discount_approvals', 'withdrawn_by', 'uuid', 'YES'],
        ['quo', 'quotation_items', 'price_changed_at', 'timestamp with time zone', 'YES'],
        ['quo', 'quotation_items', 'price_changed_by', 'uuid', 'YES'],
        ['quo', 'quotation_items', 'price_published_at', 'timestamp with time zone', 'YES'],
        ['quo', 'quotation_items', 'price_published_by', 'uuid', 'YES'],
        ['svc', 'price_list_versions', 'published_at', 'timestamp with time zone', 'YES'],
        ['svc', 'price_list_versions', 'published_by', 'uuid', 'YES'],
        ['svc', 'price_rules', 'price_changed_at', 'timestamp with time zone', 'YES'],
        ['svc', 'price_rules', 'price_changed_by', 'uuid', 'YES'],
        ['svc', 'pricing_approval_policies', 'set_at', 'timestamp with time zone', 'YES'],
        ['svc', 'pricing_approval_policies', 'set_by', 'uuid', 'YES'],
      ].map(([table_schema, table_name, column_name, data_type, is_nullable]) => ({
        table_schema,
        table_name,
        column_name,
        data_type,
        is_nullable,
      }))
    );
  });

  it('adds who set a price amount, on the source and on the line snapshot (fix round 1)', async () => {
    const columns = await admin.query<{ name: string; data_type: string; is_nullable: string }>(
      `SELECT table_schema || '.' || table_name || '.' || column_name AS name, data_type, is_nullable
         FROM information_schema.columns
        WHERE (table_schema, table_name, column_name) IN (
          ('svc','price_rules','amount_set_by'), ('svc','price_rules','amount_set_at'),
          ('inv','item_sale_prices','amount_set_by'), ('inv','item_sale_prices','amount_set_at'),
          ('quo','quotation_items','price_amount_set_by'),
          ('quo','quotation_items','price_amount_set_at'))`
    );
    const byName = Object.fromEntries(
      columns.rows.map((row) => [row.name, `${row.data_type}|${row.is_nullable}`])
    );
    expect(byName).toEqual({
      'inv.item_sale_prices.amount_set_at': 'timestamp with time zone|YES',
      'inv.item_sale_prices.amount_set_by': 'uuid|YES',
      'quo.quotation_items.price_amount_set_at': 'timestamp with time zone|YES',
      'quo.quotation_items.price_amount_set_by': 'uuid|YES',
      'svc.price_rules.amount_set_at': 'timestamp with time zone|YES',
      'svc.price_rules.amount_set_by': 'uuid|YES',
    });
  });

  it('adds the limit window history, never null, empty by default (fix round 2)', async () => {
    expect(
      await one(
        admin,
        `SELECT data_type, udt_name, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'iam' AND table_name = 'approval_limits'
            AND column_name = 'window_changed_by'`
      )
    ).toEqual({
      data_type: 'ARRAY',
      udt_name: '_uuid',
      is_nullable: 'NO',
      column_default: 'ARRAY[]::uuid[]',
    });
    expect(
      await one(
        admin,
        `SELECT p.prosecdef AS secdef, t.tgname AS trigger
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           JOIN pg_trigger t ON t.tgfoid = p.oid
          WHERE n.nspname = 'iam' AND p.proname = 'record_approval_limit_window_change'`
      )
    ).toEqual({ secdef: false, trigger: 'tg_approval_limits_window_history' });
  });

  it('runs every new function as the caller, and lets only app_runtime read the D8 basis', async () => {
    const functions = await admin.query<{ name: string; secdef: boolean }>(
      `SELECT n.nspname || '.' || p.proname AS name, p.prosecdef AS secdef
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE (n.nspname, p.proname) IN (
          ('svc','stamp_pricing_approval_policy_provenance'), ('svc','stamp_price_rule_provenance'),
          ('svc','stamp_price_list_version_publication'), ('inv','stamp_item_sale_price_provenance'),
          ('quo','snapshot_quotation_item_price_provenance'), ('quo','revision_self_change_basis'))
        ORDER BY 1`
    );
    expect(functions.rows).toEqual(
      [
        'inv.stamp_item_sale_price_provenance',
        'quo.revision_self_change_basis',
        'quo.snapshot_quotation_item_price_provenance',
        'svc.stamp_price_list_version_publication',
        'svc.stamp_price_rule_provenance',
        'svc.stamp_pricing_approval_policy_provenance',
      ].map((name) => ({ name, secdef: false }))
    );
    const grants = await admin.query<{ runtime: boolean; readonly: boolean; public: boolean }>(
      `SELECT has_function_privilege('app_runtime', 'quo.revision_self_change_basis(uuid, uuid)', 'EXECUTE') AS runtime,
              has_function_privilege('app_readonly', 'quo.revision_self_change_basis(uuid, uuid)', 'EXECUTE') AS readonly,
              EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = 'quo.revision_self_change_basis(uuid, uuid)'::regprocedure
                         AND aclcontains(p.proacl, makeaclitem(0, p.proowner, 'EXECUTE', false))) AS public`
    );
    expect(grants.rows[0]).toEqual({ runtime: true, readonly: false, public: false });
  });
});

describe('quo discount self-exemption — provenance is stored, from the session', () => {
  it('stamps who recorded a threshold version, never the writer’s claim, and never moves it', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const policy = await as(c, OTHER_ACTOR, () => recordThreshold(c, '50'));
      const row = await one<{ set_by: string; set_at: Date | null }>(
        c,
        `SELECT set_by, set_at FROM svc.pricing_approval_policies WHERE id = $1`,
        [policy]
      );
      expect(row.set_by).toBe(OTHER_ACTOR);
      expect(row.set_at).not.toBeNull();
      await c.query(`UPDATE svc.pricing_approval_policies SET set_by = $2 WHERE id = $1`, [
        policy,
        USER_A,
      ]);
      expect(
        (
          await one<{ set_by: string }>(
            c,
            `SELECT set_by FROM svc.pricing_approval_policies WHERE id = $1`,
            [policy]
          )
        ).set_by
      ).toBe(OTHER_ACTOR);
    });
  });

  it('stamps who last changed a price rule and who published its version', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'fd8_rule');
      const { priceList, version, rule } = await draftPrice(c, service, 'fd8_rule');
      const ruleRow = () =>
        one<{ price_changed_by: string }>(
          c,
          `SELECT price_changed_by FROM svc.price_rules WHERE id = $1`,
          [rule]
        );
      // Written while USER_A was signed in: the claim of PUBLISHER is ignored.
      expect((await ruleRow()).price_changed_by).toBe(USER_A);
      await as(c, OTHER_ACTOR, () =>
        c.query(`UPDATE svc.price_rules SET amount = 120 WHERE id = $1`, [rule])
      );
      expect((await ruleRow()).price_changed_by).toBe(OTHER_ACTOR);
      // A write that changes no price leaves it where it was.
      await c.query(`UPDATE svc.price_rules SET amount = amount WHERE id = $1`, [rule]);
      expect((await ruleRow()).price_changed_by).toBe(OTHER_ACTOR);
      // A draft names no publisher, whatever the writer said.
      const draft = await one<{ published_by: string | null }>(
        c,
        `SELECT published_by FROM svc.price_list_versions WHERE id = $1`,
        [version]
      );
      expect(draft.published_by).toBeNull();
      await publish(c, PUBLISHER, priceList, version);
      const published = await one<{ published_by: string; published_at: Date | null }>(
        c,
        `SELECT published_by, published_at FROM svc.price_list_versions WHERE id = $1`,
        [version]
      );
      expect(published.published_by).toBe(PUBLISHER);
      expect(published.published_at).not.toBeNull();
    });
  });

  it('snapshots on the line the provenance of the price it was priced from', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'fd8_snap');
      const { service } = await seedService(c, 'fd8_snap');
      const { priceList, version, rule } = await draftPrice(c, service, 'fd8_snap');
      await publish(c, PUBLISHER, priceList, version);
      const quotation = await seedQuotation(c, wo, 'fd8_snap');
      const revision = await draftRevision(c, quotation, 1);
      const line = await addRuleLine(c, revision, service, rule, 0);
      const snapshot = await one<{ price_changed_by: string; price_published_by: string }>(
        c,
        `SELECT price_changed_by, price_published_by FROM quo.quotation_items WHERE id = $1`,
        [line]
      );
      // The rule was written by USER_A and published by PUBLISHER; the writer claimed
      // PUBLISHER for both and is not believed.
      expect(snapshot).toEqual({ price_changed_by: USER_A, price_published_by: PUBLISHER });
    });
  });

  it('stamps who last changed an item selling price, and a later change does not move a line', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'fd8_part');
      const quotation = await seedQuotation(c, wo, 'fd8_part');
      const revision = await draftRevision(c, quotation, 1);
      const { item } = await seedItem(c, 'fd8_part');
      const setPrice = (price: string) =>
        one<{ id: string }>(
          c,
          `SELECT inv.set_item_sale_price($1,$2,$3,'USD',$4::numeric,NULL) AS id`,
          [item, COMPANY_A1, BRANCH_A1, price]
        ).then((row) => row.id);
      const priceRef = await as(c, OTHER_ACTOR, () => setPrice('12.3400'));
      const priceRow = () =>
        one<{ price_changed_by: string }>(
          c,
          `SELECT price_changed_by FROM inv.item_sale_prices WHERE id = $1`,
          [priceRef]
        );
      expect((await priceRow()).price_changed_by).toBe(OTHER_ACTOR);
      // Setting the same price again changes nothing, so it is still OTHER_ACTOR's.
      await setPrice('12.3400');
      expect((await priceRow()).price_changed_by).toBe(OTHER_ACTOR);
      const line = (
        await one<{ id: string }>(
          c,
          `INSERT INTO quo.quotation_items
             (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind, item_ref,
              item_sale_price_ref, quoted_item_sku, quoted_item_name, quoted_unit_code, quoted_unit_name,
              currency_code, captured_unit_price, captured_quantity, captured_discount, captured_tax_rate,
              captured_tax_amount, captured_line_total, created_by, price_changed_by)
           VALUES ($1,$2,$3,$4,1,'part',$5,$6,'SKU_fd8_part','Item fd8_part','u_fd8_part','Unit fd8_part',
                   'USD',12.34,1,0,0,0,12.34,$7,$7)
           RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, revision, item, priceRef, USER_A]
        )
      ).id;
      const snapshotOf = () =>
        one<{ price_changed_by: string; price_published_by: string | null }>(
          c,
          `SELECT price_changed_by, price_published_by FROM quo.quotation_items WHERE id = $1`,
          [line]
        );
      expect(await snapshotOf()).toEqual({
        price_changed_by: OTHER_ACTOR,
        price_published_by: null,
      });
      // USER_A changes the price afterwards: the row says so, the line keeps its snapshot.
      await setPrice('15.0000');
      expect((await priceRow()).price_changed_by).toBe(USER_A);
      expect(await snapshotOf()).toEqual({
        price_changed_by: OTHER_ACTOR,
        price_published_by: null,
      });
    });
  });
});

describe('quo discount self-exemption — the D8 rule', () => {
  it('needs another person for any discount on a quotation held to the requester’s own threshold', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'fd8_own_policy');
      const { service } = await seedService(c, 'fd8_own_policy');
      // USER_A records a generous threshold and then quotes under it themselves.
      await recordThreshold(c, '50');
      const quotation = await seedQuotation(c, wo, 'fd8_own_policy');
      const revision = await draftRevision(c, quotation, 1);
      await addServiceItem(c, revision, service, 1, 100, 1, 10);
      expect(await basisOf(c, revision, USER_A)).toEqual({ own_policy: true, own_price: false });
      expect(await needsApproval(c, revision)).toBe(true);
      await expectRefusal(c, /discount_approval_required/, `SELECT quo.issue_revision($1)`, [
        revision,
      ]);

      // The request records why, whatever the writer claimed.
      const approval = await requestFor(c, quotation, revision, '10');
      expect(
        await one(
          c,
          `SELECT requester_set_policy, requester_set_price FROM quo.discount_approvals WHERE id = $1`,
          [approval]
        )
      ).toEqual({ requester_set_policy: true, requester_set_price: false });
      // The reasons are frozen with the rest of the snapshot: the guard refuses the
      // write, and the immutable-columns trigger names both reasons as its backstop.
      await expectRefusal(
        c,
        /changes only by being approved, rejected, withdrawn or superseded/,
        `UPDATE quo.discount_approvals SET requester_set_policy = false WHERE id = $1`,
        [approval]
      );
      const frozen = await one<{ definition: string }>(
        c,
        `SELECT pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t
          WHERE t.tgrelid = 'quo.discount_approvals'::regclass
            AND t.tgname = 'tg_discount_approvals_immutable'`
      );
      expect(frozen.definition).toMatch(/'requester_set_policy', 'requester_set_price'/);

      // No sole-administrator exception: the requester never decides it.
      await expectRefusal(c, /discount_approver_must_differ/, approveSql, [approval, USER_A]);
      // Another authorised person does, and then the revision issues.
      await setContext(c, { tenantId: TENANT_A, userId: APPROVER });
      await c.query(approveSql, [approval, APPROVER]);
      await setContext(c, ctxA);
      await c.query(`SELECT quo.issue_revision($1)`, [revision]);
      expect(
        (
          await one<{ status: string }>(
            c,
            `SELECT status FROM quo.quotation_revisions WHERE id = $1`,
            [revision]
          )
        ).status
      ).toBe('issued');
    });
  });

  it('lets another person’s revision, and a revision with no discount, follow the threshold as set', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'fd8_other_writer');
      const { service } = await seedService(c, 'fd8_other_writer');
      await recordThreshold(c, '50');
      // Written by OTHER_ACTOR: USER_A's threshold binds them like any company rule.
      const quotation = await seedQuotation(c, wo, 'fd8_other_writer');
      const revision = await revisionBy(c, quotation, 1, OTHER_ACTOR);
      await addServiceItem(c, revision, service, 1, 100, 1, 10);
      expect(await basisOf(c, revision, OTHER_ACTOR)).toEqual({
        own_policy: false,
        own_price: false,
      });
      expect(await needsApproval(c, revision)).toBe(false);
      await c.query(`SELECT quo.issue_revision($1)`, [revision]);

      // USER_A's own revision with no discount gives nothing away and needs nothing.
      const { wo: wo2 } = await makeWorkOrder(c, 'fd8_no_discount');
      const second = await seedQuotation(c, wo2, 'fd8_no_discount');
      const plain = await draftRevision(c, second, 1);
      await addServiceItem(c, plain, service, 1, 100, 1, 0);
      expect(await basisOf(c, plain, USER_A)).toEqual({ own_policy: true, own_price: false });
      expect(await needsApproval(c, plain)).toBe(false);
      await c.query(`SELECT quo.issue_revision($1)`, [plain]);
    });
  });

  it('needs another person when the requester changed or published a price a line was priced at', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'fd8_own_price');
      // The threshold is an administrator's: only the price is in question here.
      await as(c, OTHER_ACTOR, () => recordThreshold(c, '50'));

      // 1. USER_A wrote the rule; PUBLISHER published it.
      const own = await draftPrice(c, service, 'fd8p1');
      await publish(c, PUBLISHER, own.priceList, own.version);
      const { wo } = await makeWorkOrder(c, 'fd8p1');
      const q1 = await seedQuotation(c, wo, 'fd8p1');
      const r1 = await draftRevision(c, q1, 1);
      await addRuleLine(c, r1, service, own.rule, 10);
      expect(await basisOf(c, r1, USER_A)).toEqual({ own_policy: false, own_price: true });
      expect(await needsApproval(c, r1)).toBe(true);
      const approval = await requestFor(c, q1, r1, '10');
      expect(
        await one(
          c,
          `SELECT requester_set_policy, requester_set_price FROM quo.discount_approvals WHERE id = $1`,
          [approval]
        )
      ).toEqual({ requester_set_policy: false, requester_set_price: true });

      // 2. OTHER_ACTOR wrote the rule; USER_A published it: still USER_A's change.
      const published = await as(c, OTHER_ACTOR, () => draftPrice(c, service, 'fd8p2'));
      await publish(c, USER_A, published.priceList, published.version);
      const { wo: wo2 } = await makeWorkOrder(c, 'fd8p2');
      const q2 = await seedQuotation(c, wo2, 'fd8p2');
      const r2 = await draftRevision(c, q2, 1);
      await addRuleLine(c, r2, service, published.rule, 10);
      expect(await basisOf(c, r2, USER_A)).toEqual({ own_policy: false, own_price: true });
      await expectRefusal(c, /discount_approval_required/, `SELECT quo.issue_revision($1)`, [r2]);

      // 3. Written and published by others: the threshold as set decides.
      const theirs = await as(c, OTHER_ACTOR, () => draftPrice(c, service, 'fd8p3'));
      await publish(c, PUBLISHER, theirs.priceList, theirs.version);
      const { wo: wo3 } = await makeWorkOrder(c, 'fd8p3');
      const q3 = await seedQuotation(c, wo3, 'fd8p3');
      const r3 = await draftRevision(c, q3, 1);
      await addRuleLine(c, r3, service, theirs.rule, 10);
      expect(await basisOf(c, r3, USER_A)).toEqual({ own_policy: false, own_price: false });
      expect(await needsApproval(c, r3)).toBe(false);
      await c.query(`SELECT quo.issue_revision($1)`, [r3]);
    });
  });

  it('never counts an approval limit the requester set, and records the limit an approval relied on', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'fd8_limit');
      const { service } = await seedService(c, 'fd8_limit');
      const quotation = await seedQuotation(c, wo, 'fd8_limit');
      const revision = await draftRevision(c, quotation, 1);
      await addServiceItem(c, revision, service, 1, 100, 1, 10);
      const approval = await requestFor(c, quotation, revision, '10');

      // APPROVER_REQUESTER_SET's only limit was set by USER_A, the requester.
      await setContext(c, { tenantId: TENANT_A, userId: APPROVER_REQUESTER_SET });
      await expectRefusal(c, /discount_no_approval_limit/, approveSql, [
        approval,
        APPROVER_REQUESTER_SET,
      ]);
      // APPROVER's limit was set by an administrator: it counts, and is named.
      await setContext(c, { tenantId: TENANT_A, userId: APPROVER });
      await c.query(approveSql, [approval, APPROVER]);
      await setContext(c, ctxA);
      const decided = await one<{ approver_limit_id: string; set_by: string }>(
        c,
        `SELECT a.approver_limit_id, l.created_by AS set_by
           FROM quo.discount_approvals a JOIN iam.approval_limits l ON l.id = a.approver_limit_id
          WHERE a.id = $1`,
        [approval]
      );
      expect(decided.set_by).toBe(OTHER_ACTOR);
    });
  });
});

describe('quo discount self-exemption — who set a price amount (fix round 1)', () => {
  it('keeps the requester as the price-rule amount setter through a colleague’s later edit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'fd8_amount_rule');
      // The threshold is an administrator's: only the price is in question here.
      await as(c, OTHER_ACTOR, () => recordThreshold(c, '50'));
      // USER_A sets the amount; OTHER_ACTOR then changes only its priority; a third
      // person publishes it.
      const own = await draftPrice(c, service, 'fd8_amount_rule');
      await as(c, OTHER_ACTOR, () =>
        c.query(`UPDATE svc.price_rules SET priority = 5 WHERE id = $1`, [own.rule])
      );
      await publish(c, PUBLISHER, own.priceList, own.version);
      expect(
        await one(c, `SELECT price_changed_by, amount_set_by FROM svc.price_rules WHERE id = $1`, [
          own.rule,
        ])
      ).toEqual({ price_changed_by: OTHER_ACTOR, amount_set_by: USER_A });

      const { wo } = await makeWorkOrder(c, 'fd8_amount_rule');
      const quotation = await seedQuotation(c, wo, 'fd8_amount_rule');
      const revision = await draftRevision(c, quotation, 1);
      const line = await addRuleLine(c, revision, service, own.rule, 10);
      expect(
        await one(
          c,
          `SELECT price_changed_by, price_amount_set_by FROM quo.quotation_items WHERE id = $1`,
          [line]
        )
      ).toEqual({ price_changed_by: OTHER_ACTOR, price_amount_set_by: USER_A });
      // 10 is under the administrator's 50, and still needs somebody else.
      expect(await basisOf(c, revision, USER_A)).toEqual({ own_policy: false, own_price: true });
      expect(await needsApproval(c, revision)).toBe(true);
      await expectRefusal(c, /discount_approval_required/, `SELECT quo.issue_revision($1)`, [
        revision,
      ]);
      const approval = await requestFor(c, quotation, revision, '10');
      expect(
        await one(c, `SELECT requester_set_price FROM quo.discount_approvals WHERE id = $1`, [
          approval,
        ])
      ).toEqual({ requester_set_price: true });
    });
  });

  it('keeps the requester as the selling-price amount setter through a colleague’s status edit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await as(c, OTHER_ACTOR, () => recordThreshold(c, '50'));
      const { item } = await seedItem(c, 'fd8_amount_part');
      // USER_A sets the price; OTHER_ACTOR deactivates and re-activates it at the
      // same amount, so OTHER_ACTOR is the last to change the row.
      const priceRef = (
        await one<{ id: string }>(
          c,
          `SELECT inv.set_item_sale_price($1,$2,$3,'USD',12.34::numeric,NULL) AS id`,
          [item, COMPANY_A1, BRANCH_A1]
        )
      ).id;
      await as(c, OTHER_ACTOR, async () => {
        await c.query(`UPDATE inv.item_sale_prices SET status = 'inactive' WHERE id = $1`, [
          priceRef,
        ]);
        await c.query(`SELECT inv.set_item_sale_price($1,$2,$3,'USD',12.34::numeric,NULL)`, [
          item,
          COMPANY_A1,
          BRANCH_A1,
        ]);
      });
      expect(
        await one(
          c,
          `SELECT price_changed_by, amount_set_by FROM inv.item_sale_prices WHERE id = $1`,
          [priceRef]
        )
      ).toEqual({ price_changed_by: OTHER_ACTOR, amount_set_by: USER_A });

      const { wo } = await makeWorkOrder(c, 'fd8_amount_part');
      const quotation = await seedQuotation(c, wo, 'fd8_amount_part');
      const revision = await draftRevision(c, quotation, 1);
      const line = (
        await one<{ id: string }>(
          c,
          `INSERT INTO quo.quotation_items
             (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind, item_ref,
              item_sale_price_ref, quoted_item_sku, quoted_item_name, quoted_unit_code, quoted_unit_name,
              currency_code, captured_unit_price, captured_quantity, captured_discount, captured_tax_rate,
              captured_tax_amount, captured_line_total, created_by, price_amount_set_by)
           VALUES ($1,$2,$3,$4,1,'part',$5,$6,'SKU_fd8_amount_part','Item fd8_amount_part',
                   'u_fd8_amount_part','Unit fd8_amount_part','USD',12.34,1,1,0,0,11.34,$7,$8)
           RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, revision, item, priceRef, USER_A, OTHER_ACTOR]
        )
      ).id;
      // The writer's claim is ignored: the line names who set the amount.
      expect(
        await one(
          c,
          `SELECT price_changed_by, price_amount_set_by FROM quo.quotation_items WHERE id = $1`,
          [line]
        )
      ).toEqual({ price_changed_by: OTHER_ACTOR, price_amount_set_by: USER_A });
      expect(await basisOf(c, revision, USER_A)).toEqual({ own_policy: false, own_price: true });
      expect(await needsApproval(c, revision)).toBe(true);
      await expectRefusal(c, /discount_approval_required/, `SELECT quo.issue_revision($1)`, [
        revision,
      ]);
    });
  });
});

describe('quo discount self-exemption — a limit window the requester moved (fix round 1)', () => {
  /** A discounted draft written and asked for by LIMIT_REQUESTER. */
  async function requestByLimitRequester(c: Q, tag: string, discount: number): Promise<string> {
    const { wo } = await makeWorkOrder(c, tag);
    const { service } = await seedService(c, tag);
    const quotation = await seedQuotation(c, wo, tag);
    return as(c, LIMIT_REQUESTER, async () => {
      const revision = await revisionBy(c, quotation, 1, LIMIT_REQUESTER);
      await addServiceItem(c, revision, service, 1, 100, 1, discount);
      return requestFor(c, quotation, revision, String(discount), LIMIT_REQUESTER);
    });
  }
  const userLimitOf = async (c: Q, userId: string): Promise<string> =>
    (
      await one<{ id: string }>(
        c,
        `SELECT id FROM iam.approval_limits
          WHERE tenant_id = $1 AND limit_type = 'discount' AND user_id = $2`,
        [TENANT_A, userId]
      )
    ).id;
  const signedInAs = async <T>(c: Q, person: string, act: () => Promise<T>): Promise<T> => {
    await setContext(c, { tenantId: TENANT_A, userId: person });
    try {
      return await act();
    } finally {
      await setContext(c, ctxA);
    }
  };

  it('refuses an approver whose expired limit the requester reopened', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const approval = await requestByLimitRequester(c, 'fd8_reopen', 10);
      await signedInAs(c, APPROVER_REOPEN, () =>
        expectRefusal(c, /has no discount approval limit that counts/, approveSql, [
          approval,
          APPROVER_REOPEN,
        ])
      );
      const limit = await userLimitOf(c, APPROVER_REOPEN);
      // The requester, who may administer limits, reopens the administrator's limit.
      await as(c, LIMIT_REQUESTER, () =>
        c.query(`UPDATE iam.approval_limits SET effective_to = current_date + 365 WHERE id = $1`, [
          limit,
        ])
      );
      expect(
        await one(c, `SELECT created_by, updated_by FROM iam.approval_limits WHERE id = $1`, [
          limit,
        ])
      ).toEqual({ created_by: OTHER_ACTOR, updated_by: LIMIT_REQUESTER });
      await signedInAs(c, APPROVER_REOPEN, () =>
        expectRefusal(c, /discount_no_approval_limit: .*dates the requester changed/, approveSql, [
          approval,
          APPROVER_REOPEN,
        ])
      );
      expect(
        await one(c, `SELECT status FROM quo.discount_approvals WHERE id = $1`, [approval])
      ).toEqual({ status: 'pending' });
    });
  });

  it('refuses an approver whose smaller own limit the requester ended so a role limit applies', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const approval = await requestByLimitRequester(c, 'fd8_ended', 50);
      // The user limit of 10 decides while it is in force.
      await signedInAs(c, APPROVER_ENDED, () =>
        expectRefusal(c, /discount_over_approval_limit/, approveSql, [approval, APPROVER_ENDED])
      );
      const own = await userLimitOf(c, APPROVER_ENDED);
      await as(c, LIMIT_REQUESTER, () =>
        c.query(`UPDATE iam.approval_limits SET effective_to = current_date WHERE id = $1`, [own])
      );
      // The role's 1000 would now apply; it does not count for the requester's request.
      await signedInAs(c, APPROVER_ENDED, () =>
        expectRefusal(c, /discount_no_approval_limit: .*dates the requester changed/, approveSql, [
          approval,
          APPROVER_ENDED,
        ])
      );

      // Somebody else's request is unaffected: the role limit counts for it.
      const { wo } = await makeWorkOrder(c, 'fd8_ended_other');
      const { service } = await seedService(c, 'fd8_ended_other');
      const quotation = await seedQuotation(c, wo, 'fd8_ended_other');
      const revision = await draftRevision(c, quotation, 1);
      await addServiceItem(c, revision, service, 1, 100, 1, 50);
      const others = await requestFor(c, quotation, revision, '50');
      await signedInAs(c, APPROVER_ENDED, () => c.query(approveSql, [others, APPROVER_ENDED]));
      expect(
        await one(
          c,
          `SELECT a.status, l.role_id FROM quo.discount_approvals a
             JOIN iam.approval_limits l ON l.id = a.approver_limit_id WHERE a.id = $1`,
          [others]
        )
      ).toEqual({ status: 'approved', role_id: ROLE_WIDE });
    });
  });
});

describe('quo discount self-exemption — who ever moved a limit window (fix round 2)', () => {
  const userLimitOf = async (c: Q, userId: string): Promise<string> =>
    (
      await one<{ id: string }>(
        c,
        `SELECT id FROM iam.approval_limits
          WHERE tenant_id = $1 AND limit_type = 'discount' AND user_id = $2`,
        [TENANT_A, userId]
      )
    ).id;
  const roleLimitOf = async (c: Q, roleId: string): Promise<string> =>
    (
      await one<{ id: string }>(
        c,
        `SELECT id FROM iam.approval_limits
          WHERE tenant_id = $1 AND limit_type = 'discount' AND role_id = $2`,
        [TENANT_A, roleId]
      )
    ).id;
  const historyOf = (c: Q, limit: string) =>
    one<{ updated_by: string | null; window_changed_by: string[] }>(
      c,
      `SELECT updated_by, window_changed_by FROM iam.approval_limits WHERE id = $1`,
      [limit]
    );
  const moveWindow = (c: Q, actor: string, limit: string, days: number) =>
    as(c, actor, () =>
      c.query(
        `UPDATE iam.approval_limits SET effective_to = current_date + $2::int WHERE id = $1`,
        [limit, days]
      )
    );
  /** A discounted draft written and asked for by USER_A, who moves no limit here. */
  async function requestByUserA(c: Q, tag: string, discount: number): Promise<string> {
    const { wo } = await makeWorkOrder(c, tag);
    const { service } = await seedService(c, tag);
    const quotation = await seedQuotation(c, wo, tag);
    const revision = await draftRevision(c, quotation, 1);
    await addServiceItem(c, revision, service, 1, 100, 1, discount);
    return requestFor(c, quotation, revision, String(discount));
  }
  /** A discounted draft written and asked for by LIMIT_REQUESTER. */
  async function requestByLimitRequester(c: Q, tag: string, discount: number): Promise<string> {
    const { wo } = await makeWorkOrder(c, tag);
    const { service } = await seedService(c, tag);
    const quotation = await seedQuotation(c, wo, tag);
    return as(c, LIMIT_REQUESTER, async () => {
      const revision = await revisionBy(c, quotation, 1, LIMIT_REQUESTER);
      await addServiceItem(c, revision, service, 1, 100, 1, discount);
      return requestFor(c, quotation, revision, String(discount), LIMIT_REQUESTER);
    });
  }
  const approveAs = (c: Q, approver: string, approval: string) =>
    as(c, approver, () => c.query(approveSql, [approval, approver]));
  const refuseAs = (c: Q, approver: string, approval: string, rule: RegExp) =>
    as(c, approver, () => expectRefusal(c, rule, approveSql, [approval, approver]));
  const statusOf = async (c: Q, approval: string): Promise<string> =>
    (
      await one<{ status: string }>(c, `SELECT status FROM quo.discount_approvals WHERE id = $1`, [
        approval,
      ])
    ).status;

  it('refuses an approver who reopened their own expired limit, for anybody’s request', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const approval = await requestByUserA(c, 'fd8r2_sro', 10);
      await refuseAs(c, APPROVER_SELF_USER, approval, /has no discount approval limit that counts/);
      const limit = await userLimitOf(c, APPROVER_SELF_USER);
      // The approver, who may administer limits, reopens the administrator's limit.
      await moveWindow(c, APPROVER_SELF_USER, limit, 365);
      expect(await historyOf(c, limit)).toEqual({
        updated_by: APPROVER_SELF_USER,
        window_changed_by: [APPROVER_SELF_USER],
      });
      await refuseAs(
        c,
        APPROVER_SELF_USER,
        approval,
        /discount_no_approval_limit: .*changed the dates of one of their own/
      );
      expect(await statusOf(c, approval)).toBe('pending');
    });
  });

  it('refuses an approver who extended the limit on a role they hold; saving the same date is no change', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const limit = await roleLimitOf(c, ROLE_SELF_WIDE);
      // Saving the end date it already has records nothing, and the limit still counts.
      await as(c, APPROVER_SELF_ROLE, () =>
        c.query(`UPDATE iam.approval_limits SET effective_to = effective_to WHERE id = $1`, [limit])
      );
      expect(await historyOf(c, limit)).toEqual({
        updated_by: APPROVER_SELF_ROLE,
        window_changed_by: [],
      });
      const first = await requestByUserA(c, 'fd8r2_sra', 10);
      await approveAs(c, APPROVER_SELF_ROLE, first);
      expect(await statusOf(c, first)).toBe('approved');

      // Extending it is moving one's own window: none of the approver's limits counts.
      await moveWindow(c, APPROVER_SELF_ROLE, limit, 365);
      expect((await historyOf(c, limit)).window_changed_by).toEqual([APPROVER_SELF_ROLE]);
      const second = await requestByUserA(c, 'fd8r2_srb', 10);
      await refuseAs(
        c,
        APPROVER_SELF_ROLE,
        second,
        /discount_no_approval_limit: .*changed the dates of one of their own/
      );
      expect(await statusOf(c, second)).toBe('pending');
    });
  });

  it('keeps the requester’s window change through a later save by the approver and by a colleague', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const approval = await requestByLimitRequester(c, 'fd8r2_ls', 10);
      const limit = await userLimitOf(c, APPROVER_REOPEN);
      await moveWindow(c, LIMIT_REQUESTER, limit, 365);
      await refuseAs(c, APPROVER_REOPEN, approval, /dates the requester changed/);

      // The approver saves the same end date again: they become the last writer, but
      // the end date did not move, so nothing is recorded and nothing is removed.
      await moveWindow(c, APPROVER_REOPEN, limit, 365);
      expect(await historyOf(c, limit)).toEqual({
        updated_by: APPROVER_REOPEN,
        window_changed_by: [LIMIT_REQUESTER],
      });
      await refuseAs(c, APPROVER_REOPEN, approval, /dates the requester changed/);

      // A colleague moves it again: they are added, and the requester stays.
      await moveWindow(c, LIMIT_COLLEAGUE, limit, 366);
      expect(await historyOf(c, limit)).toEqual({
        updated_by: LIMIT_COLLEAGUE,
        window_changed_by: [LIMIT_REQUESTER, LIMIT_COLLEAGUE],
      });
      await refuseAs(c, APPROVER_REOPEN, approval, /dates the requester changed/);
      expect(await statusOf(c, approval)).toBe('pending');

      // Another person's request is decided against the limit as it stands.
      const others = await requestByUserA(c, 'fd8r2_lso', 10);
      await approveAs(c, APPROVER_REOPEN, others);
      expect(await statusOf(c, others)).toBe('approved');
    });
  });

  it('takes the window history from the database, never from the writer', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const inserted = await as(c, LIMIT_REQUESTER, () =>
        one<{ window_changed_by: string[] }>(
          c,
          `INSERT INTO iam.approval_limits
             (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from,
              created_by, window_changed_by)
           VALUES ($1,$2,$3,'fd8r2_history',5,'USD',current_date,$4,$5::uuid[])
           RETURNING window_changed_by`,
          [TENANT_A, COMPANY_A1, APPROVER, LIMIT_REQUESTER, [OTHER_ACTOR]]
        )
      );
      expect(inserted).toEqual({ window_changed_by: [] });
      const limit = await userLimitOf(c, APPROVER_SELF_USER);
      await as(c, LIMIT_REQUESTER, () =>
        expectRefusal(
          c,
          /permission denied/,
          `UPDATE iam.approval_limits SET window_changed_by = ARRAY[]::uuid[] WHERE id = $1`,
          [limit],
          '42501'
        )
      );
    });
  });
});

describe('quo discount self-exemption — a self-set price with no discount (fix round 3)', () => {
  /** A part line priced from the item selling price `priceRef`, at `unit`, discounted by `discount`. */
  const addPartLine = async (
    c: Q,
    revision: string,
    tag: string,
    item: string,
    priceRef: string,
    unit: string,
    discount: string
  ): Promise<void> => {
    await c.query(
      `INSERT INTO quo.quotation_items
         (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind, item_ref,
          item_sale_price_ref, quoted_item_sku, quoted_item_name, quoted_unit_code, quoted_unit_name,
          currency_code, captured_unit_price, captured_quantity, captured_discount, captured_tax_rate,
          captured_tax_amount, captured_line_total, created_by)
       VALUES ($1,$2,$3,$4,1,'part',$5,$6,$7,$8,$9,$10,'USD',$11::numeric,1,$12::numeric,0,0,
               $11::numeric - $12::numeric,$13)`,
      [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        revision,
        item,
        priceRef,
        `SKU_${tag}`,
        `Item ${tag}`,
        `u_${tag}`,
        `Unit ${tag}`,
        unit,
        discount,
        USER_A,
      ]
    );
  };
  const statusOf = async (c: Q, revision: string): Promise<string> =>
    (
      await one<{ status: string }>(c, `SELECT status FROM quo.quotation_revisions WHERE id = $1`, [
        revision,
      ])
    ).status;

  it('needs another person when the requester lowered an item selling price and quotes at no discount', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // An administrator's threshold of 50 and an administrator's price of 100.
      await as(c, OTHER_ACTOR, () => recordThreshold(c, '50'));
      const { item } = await seedItem(c, 'fd8r3_part');
      const setPrice = (price: string) =>
        one<{ id: string }>(
          c,
          `SELECT inv.set_item_sale_price($1,$2,$3,'USD',$4::numeric,NULL) AS id`,
          [item, COMPANY_A1, BRANCH_A1, price]
        ).then((row) => row.id);
      const priceRef = await as(c, OTHER_ACTOR, () => setPrice('100.0000'));

      // Control: 90 off the administrator's 100 needs somebody else.
      const { wo } = await makeWorkOrder(c, 'fd8r3_ctl');
      const control = await draftRevision(c, await seedQuotation(c, wo, 'fd8r3_ctl'), 1);
      await addPartLine(c, control, 'fd8r3_part', item, priceRef, '100', '90');
      expect(await needsApproval(c, control)).toBe(true);

      // USER_A lowers that same price to 10 and quotes at 10 with no discount: the
      // customer gets the same 90 off, and it still needs somebody else.
      await setPrice('10.0000');
      const { wo: wo2 } = await makeWorkOrder(c, 'fd8r3_own');
      const quotation = await seedQuotation(c, wo2, 'fd8r3_own');
      const revision = await draftRevision(c, quotation, 1);
      await addPartLine(c, revision, 'fd8r3_part', item, priceRef, '10', '0');
      expect(await basisOf(c, revision, USER_A)).toEqual({ own_policy: false, own_price: true });
      expect(await needsApproval(c, revision)).toBe(true);
      await expectRefusal(c, /discount_approval_required/, `SELECT quo.issue_revision($1)`, [
        revision,
      ]);

      // The request carries a discount of zero and says why.
      const approval = await requestFor(c, quotation, revision, '0');
      expect(
        await one(
          c,
          `SELECT discount_total::text AS total, requester_set_policy, requester_set_price
             FROM quo.discount_approvals WHERE id = $1`,
          [approval]
        )
      ).toEqual({ total: '0.0000', requester_set_policy: false, requester_set_price: true });
      await expectRefusal(c, /discount_approval_pending/, `SELECT quo.issue_revision($1)`, [
        revision,
      ]);
      // No sole-administrator exception: the requester never decides it.
      await expectRefusal(c, /discount_approver_must_differ/, approveSql, [approval, USER_A]);
      await setContext(c, { tenantId: TENANT_A, userId: APPROVER });
      await c.query(approveSql, [approval, APPROVER]);
      await setContext(c, ctxA);
      await c.query(`SELECT quo.issue_revision($1)`, [revision]);
      expect(await statusOf(c, revision)).toBe('issued');

      // Another person's quotation at the same price, with no discount, issues alone.
      const { wo: wo3 } = await makeWorkOrder(c, 'fd8r3_other');
      const theirs = await revisionBy(
        c,
        await seedQuotation(c, wo3, 'fd8r3_other'),
        1,
        OTHER_ACTOR
      );
      await addPartLine(c, theirs, 'fd8r3_part', item, priceRef, '10', '0');
      // OTHER_ACTOR recorded the threshold, which is not in question with no discount.
      expect(await basisOf(c, theirs, OTHER_ACTOR)).toEqual({
        own_policy: true,
        own_price: false,
      });
      expect(await needsApproval(c, theirs)).toBe(false);
      await c.query(`SELECT quo.issue_revision($1)`, [theirs]);
      expect(await statusOf(c, theirs)).toBe('issued');
    });
  });

  it('needs another person when the requester set and published a price-rule amount and quotes at no discount', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'fd8r3_rule');
      await as(c, OTHER_ACTOR, () => recordThreshold(c, '50'));
      const own = await draftPrice(c, service, 'fd8r3r1');
      await publish(c, USER_A, own.priceList, own.version);
      const { wo } = await makeWorkOrder(c, 'fd8r3r1');
      const quotation = await seedQuotation(c, wo, 'fd8r3r1');
      const revision = await draftRevision(c, quotation, 1);
      await addRuleLine(c, revision, service, own.rule, 0);
      expect(await basisOf(c, revision, USER_A)).toEqual({ own_policy: false, own_price: true });
      expect(await needsApproval(c, revision)).toBe(true);
      await expectRefusal(c, /discount_approval_required/, `SELECT quo.issue_revision($1)`, [
        revision,
      ]);
      const approval = await requestFor(c, quotation, revision, '0');
      await setContext(c, { tenantId: TENANT_A, userId: APPROVER });
      await c.query(approveSql, [approval, APPROVER]);
      await setContext(c, ctxA);
      await c.query(`SELECT quo.issue_revision($1)`, [revision]);
      expect(await statusOf(c, revision)).toBe('issued');

      // Another person's quotation priced from the same rule, with no discount, issues alone.
      const { wo: wo2 } = await makeWorkOrder(c, 'fd8r3r2');
      const theirs = await revisionBy(c, await seedQuotation(c, wo2, 'fd8r3r2'), 1, OTHER_ACTOR);
      await addRuleLine(c, theirs, service, own.rule, 0);
      expect(await needsApproval(c, theirs)).toBe(false);
      await c.query(`SELECT quo.issue_revision($1)`, [theirs]);
      expect(await statusOf(c, theirs)).toBe('issued');
    });
  });

  it('admits a request with no discount only for a price its requester set', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'fd8r3_none');
      const { service } = await seedService(c, 'fd8r3_none');
      await as(c, OTHER_ACTOR, () => recordThreshold(c, '50'));
      const quotation = await seedQuotation(c, wo, 'fd8r3_none');
      const revision = await draftRevision(c, quotation, 1);
      await addServiceItem(c, revision, service, 1, 100, 1, 0);
      expect(await basisOf(c, revision, USER_A)).toEqual({ own_policy: false, own_price: false });
      expect(await needsApproval(c, revision)).toBe(false);
      // The writer claims a self-set price; the guard computes none, so the CHECK refuses.
      await expectRefusal(
        c,
        /ck_discount_approvals_amounts/,
        `INSERT INTO quo.discount_approvals
           (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, currency_code,
            discount_total, discount_base, elevated_line_count, policy_id, policy_version_no,
            threshold_kind, threshold_value, threshold_currency_code, required_permission_code,
            requested_by, created_by, requester_set_policy, requester_set_price)
         SELECT $1,$2,$3,$4,$5,'USD',0,100,0,p.id,p.version_no,p.threshold_kind,
                p.threshold_value,p.currency_code,
                COALESCE(p.required_permission_code, 'svc.price.manage'),$6,$6,false,true
           FROM (SELECT 1) one
           LEFT JOIN quo.quotation_discount_policy($1, $4) p ON true`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, quotation, revision, USER_A]
      );
      await c.query(`SELECT quo.issue_revision($1)`, [revision]);
      expect(await statusOf(c, revision)).toBe('issued');
    });
  });
});

describe('quo discount self-exemption — a price-list assignment the requester made (fix round 4)', () => {
  /** A price list for `service` at `amount`, written and published by `actor`. */
  const publishedList = (
    c: Q,
    actor: string,
    service: string,
    tag: string,
    amount: string
  ): Promise<{ priceList: string; rule: string }> =>
    as(c, actor, async () => {
      const priceList = (
        await one<{ id: string }>(
          c,
          `INSERT INTO svc.price_lists (tenant_id, price_list_code, name, currency_code, created_by)
           VALUES ($1,$2,$3,'USD',$4) RETURNING id`,
          [TENANT_A, `PL_${tag}`, `Price list ${tag}`, actor]
        )
      ).id;
      const version = (
        await one<{ id: string }>(
          c,
          `INSERT INTO svc.price_list_versions (tenant_id, price_list_id, version_no, effective_from, status, created_by)
           VALUES ($1,$2,1,DATE '2026-01-01','draft',$3) RETURNING id`,
          [TENANT_A, priceList, actor]
        )
      ).id;
      const rule = (
        await one<{ id: string }>(
          c,
          `INSERT INTO svc.price_rules (tenant_id, price_list_version_id, service_id, amount, priority, created_by)
           VALUES ($1,$2,$3,$4::numeric,0,$5) RETURNING id`,
          [TENANT_A, version, service, amount, actor]
        )
      ).id;
      await c.query(`SELECT svc.publish_price_list_version($1,$2,DATE '2026-01-01')`, [
        priceList,
        version,
      ]);
      return { priceList, rule };
    });

  /**
   * Assigns `priceList` to COMPANY_A1 (and BRANCH_A1 when `branch`), signed in as
   * `actor`. The writer's provenance claim names somebody else and is ignored.
   */
  const assign = (
    c: Q,
    actor: string,
    priceList: string,
    branch: boolean,
    priority: number
  ): Promise<string> =>
    as(
      c,
      actor,
      async () =>
        (
          await one<{ id: string }>(
            c,
            `INSERT INTO svc.price_list_assignments
             (tenant_id, price_list_id, company_id, branch_id, priority, effective_from, created_by,
              assigned_by, assigned_at, assignment_changed_by)
           VALUES ($1,$2,$3,$4,$5,current_date,$6,$7,now() - interval '1 day',ARRAY[$7]::uuid[])
           RETURNING id`,
            [TENANT_A, priceList, COMPANY_A1, branch ? BRANCH_A1 : null, priority, actor, PUBLISHER]
          )
        ).id
    );

  /** The amount svc.resolve_price answers for `service` at BRANCH_A1 today. */
  const resolved = async (c: Q, service: string): Promise<string | undefined> =>
    (
      await c.query<{ amount: string }>(
        `SELECT amount::text AS amount FROM svc.resolve_price($1,$2,$3,NULL,current_date)`,
        [service, COMPANY_A1, BRANCH_A1]
      )
    ).rows[0]?.amount;

  /**
   * A service line priced from `rule` at `unit`, discounted by `discount`. The
   * writer's assignment snapshot names somebody else and is ignored.
   */
  const addPricedLine = async (
    c: Q,
    revision: string,
    service: string,
    rule: string,
    unit: string,
    discount: string
  ): Promise<string> =>
    (
      await one<{ id: string }>(
        c,
        `INSERT INTO quo.quotation_items
           (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind, service_id,
            price_rule_ref, currency_code, captured_unit_price, captured_quantity, captured_discount,
            captured_tax_rate, captured_tax_amount, captured_line_total, created_by,
            price_assignment_ref, price_assigned_by, price_assignment_changed_by)
         VALUES ($1,$2,$3,$4,1,'service',$5,$6,'USD',$7::numeric,1,$8::numeric,0,0,
                 $7::numeric - $8::numeric,$9,$6,$10,ARRAY[$10]::uuid[])
         RETURNING id`,
        [
          TENANT_A,
          COMPANY_A1,
          BRANCH_A1,
          revision,
          service,
          rule,
          unit,
          discount,
          USER_A,
          PUBLISHER,
        ]
      )
    ).id;

  const snapshotOf = (c: Q, line: string) =>
    one<{
      price_assignment_ref: string | null;
      price_assigned_by: string | null;
      price_assignment_changed_by: string[] | null;
    }>(
      c,
      `SELECT price_assignment_ref, price_assigned_by, price_assignment_changed_by
         FROM quo.quotation_items WHERE id = $1`,
      [line]
    );
  const statusOf = async (c: Q, revision: string): Promise<string> =>
    (
      await one<{ status: string }>(c, `SELECT status FROM quo.quotation_revisions WHERE id = $1`, [
        revision,
      ])
    ).status;

  it('adds who made and who changed an assignment, and the line snapshot of it', async () => {
    const columns = await admin.query<{ name: string; type: string }>(
      `SELECT table_schema || '.' || table_name || '.' || column_name AS name,
              data_type || '|' || udt_name || '|' || is_nullable || '|' || COALESCE(column_default, '') AS type
         FROM information_schema.columns
        WHERE (table_schema, table_name, column_name) IN (
          ('svc','price_list_assignments','assigned_by'),
          ('svc','price_list_assignments','assigned_at'),
          ('svc','price_list_assignments','assignment_changed_by'),
          ('quo','quotation_items','price_customer_class'),
          ('quo','quotation_items','price_assignment_ref'),
          ('quo','quotation_items','price_assigned_by'),
          ('quo','quotation_items','price_assigned_at'),
          ('quo','quotation_items','price_assignment_changed_by'))`
    );
    expect(Object.fromEntries(columns.rows.map((row) => [row.name, row.type]))).toEqual({
      'quo.quotation_items.price_assigned_at': 'timestamp with time zone|timestamptz|YES|',
      'quo.quotation_items.price_assigned_by': 'uuid|uuid|YES|',
      'quo.quotation_items.price_assignment_changed_by': 'ARRAY|_uuid|YES|',
      'quo.quotation_items.price_assignment_ref': 'uuid|uuid|YES|',
      'quo.quotation_items.price_customer_class': 'text|text|YES|',
      'svc.price_list_assignments.assigned_at': 'timestamp with time zone|timestamptz|YES|',
      'svc.price_list_assignments.assigned_by': 'uuid|uuid|YES|',
      'svc.price_list_assignments.assignment_changed_by': 'ARRAY|_uuid|NO|ARRAY[]::uuid[]',
    });
    expect(
      await one(
        admin,
        `SELECT p.prosecdef AS secdef, t.tgname AS trigger
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           JOIN pg_trigger t ON t.tgfoid = p.oid
          WHERE n.nspname = 'svc' AND p.proname = 'stamp_price_list_assignment_provenance'`
      )
    ).toEqual({ secdef: false, trigger: 'tg_price_list_assignments_provenance' });
  });

  it('stamps who made an assignment and who changed it from the session, never the writer', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'fd8r4_stamp');
      const list = await publishedList(c, OTHER_ACTOR, service, 'fd8r4_stamp', '100');
      const id = await assign(c, USER_A, list.priceList, true, 7101);
      const row = () =>
        one<{ assigned_by: string; changed: string[]; recent: boolean }>(
          c,
          `SELECT assigned_by, assignment_changed_by AS changed,
                  assigned_at > now() - interval '1 minute' AS recent
             FROM svc.price_list_assignments WHERE id = $1`,
          [id]
        );
      expect(await row()).toEqual({ assigned_by: USER_A, changed: [], recent: true });

      // A colleague's later change is appended and never replaces who made it.
      await as(c, OTHER_ACTOR, () =>
        c.query(`UPDATE svc.price_list_assignments SET priority = 7102 WHERE id = $1`, [id])
      );
      expect(await row()).toEqual({ assigned_by: USER_A, changed: [OTHER_ACTOR], recent: true });
      // A save that changes nothing it selects records nothing; a writer's value is ignored.
      await as(c, PUBLISHER, () =>
        c.query(
          `UPDATE svc.price_list_assignments
              SET priority = 7102, assigned_by = $2, assignment_changed_by = ARRAY[]::uuid[]
            WHERE id = $1`,
          [id, PUBLISHER]
        )
      );
      expect(await row()).toEqual({ assigned_by: USER_A, changed: [OTHER_ACTOR], recent: true });
      // Ending it is a change too.
      await c.query(`UPDATE svc.price_list_assignments SET status = 'inactive' WHERE id = $1`, [
        id,
      ]);
      expect(await row()).toEqual({
        assigned_by: USER_A,
        changed: [OTHER_ACTOR, USER_A],
        recent: true,
      });
    });
  });

  it('needs another person when the requester pointed their branch at a cheaper list and quotes at no discount', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'fd8r4_branch');
      // An administrator's threshold of 50; the administrator's list prices the service
      // at 100 company-wide, and the administrator also published a list at 10.
      await as(c, OTHER_ACTOR, () => recordThreshold(c, '50'));
      const dear = await publishedList(c, OTHER_ACTOR, service, 'fd8r4_dear', '100');
      const cheap = await publishedList(c, OTHER_ACTOR, service, 'fd8r4_cheap', '10');
      const company = await assign(c, OTHER_ACTOR, dear.priceList, false, 7201);
      expect(await resolved(c, service)).toBe('100.0000');

      // Control: 90 off the administrator's 100 needs somebody else.
      const { wo } = await makeWorkOrder(c, 'fd8r4_ctl');
      const control = await draftRevision(c, await seedQuotation(c, wo, 'fd8r4_ctl'), 1);
      const controlLine = await addPricedLine(c, control, service, dear.rule, '100', '90');
      expect(await snapshotOf(c, controlLine)).toEqual({
        price_assignment_ref: company,
        price_assigned_by: OTHER_ACTOR,
        price_assignment_changed_by: [],
      });
      expect(await needsApproval(c, control)).toBe(true);

      // USER_A points their own branch at the list priced at 10, more specifically, and
      // quotes at 10 with no discount: the customer gets the same 90 off.
      const own = await assign(c, USER_A, cheap.priceList, true, 7202);
      expect(await resolved(c, service)).toBe('10.0000');
      const { wo: wo2 } = await makeWorkOrder(c, 'fd8r4_own');
      const quotation = await seedQuotation(c, wo2, 'fd8r4_own');
      const revision = await draftRevision(c, quotation, 1);
      const line = await addPricedLine(c, revision, service, cheap.rule, '10', '0');
      // The amount and the publication are the administrator's; the assignment is not.
      expect(
        await one(
          c,
          `SELECT price_amount_set_by, price_changed_by, price_published_by
             FROM quo.quotation_items WHERE id = $1`,
          [line]
        )
      ).toEqual({
        price_amount_set_by: OTHER_ACTOR,
        price_changed_by: OTHER_ACTOR,
        price_published_by: OTHER_ACTOR,
      });
      expect(await snapshotOf(c, line)).toEqual({
        price_assignment_ref: own,
        price_assigned_by: USER_A,
        price_assignment_changed_by: [],
      });
      expect(await basisOf(c, revision, USER_A)).toEqual({ own_policy: false, own_price: true });
      expect(await needsApproval(c, revision)).toBe(true);
      await expectRefusal(c, /discount_approval_required/, `SELECT quo.issue_revision($1)`, [
        revision,
      ]);
      const approval = await requestFor(c, quotation, revision, '0');
      expect(
        await one(
          c,
          `SELECT discount_total::text AS total, requester_set_price
             FROM quo.discount_approvals WHERE id = $1`,
          [approval]
        )
      ).toEqual({ total: '0.0000', requester_set_price: true });
      // No sole-administrator exception: the requester never decides it.
      await expectRefusal(c, /discount_approver_must_differ/, approveSql, [approval, USER_A]);
      await setContext(c, { tenantId: TENANT_A, userId: APPROVER });
      await c.query(approveSql, [approval, APPROVER]);
      await setContext(c, ctxA);
      await c.query(`SELECT quo.issue_revision($1)`, [revision]);
      expect(await statusOf(c, revision)).toBe('issued');

      // Another person's quotation under the same assignment, with no discount, issues
      // alone: APPROVER made no assignment and set no price.
      const { wo: wo3 } = await makeWorkOrder(c, 'fd8r4_other');
      const theirs = await revisionBy(c, await seedQuotation(c, wo3, 'fd8r4_other'), 1, APPROVER);
      const theirLine = await addPricedLine(c, theirs, service, cheap.rule, '10', '0');
      expect((await snapshotOf(c, theirLine)).price_assigned_by).toBe(USER_A);
      expect(await basisOf(c, theirs, APPROVER)).toEqual({ own_policy: false, own_price: false });
      expect(await needsApproval(c, theirs)).toBe(false);
      await c.query(`SELECT quo.issue_revision($1)`, [theirs]);
      expect(await statusOf(c, theirs)).toBe('issued');
    });
  });

  it('needs another person when the requester out-prioritised an assignment, through a colleague’s later edit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'fd8r4_prio');
      await as(c, OTHER_ACTOR, () => recordThreshold(c, '50'));
      const dear = await publishedList(c, OTHER_ACTOR, service, 'fd8r4_pdear', '100');
      const cheap = await publishedList(c, OTHER_ACTOR, service, 'fd8r4_pcheap', '10');
      await assign(c, OTHER_ACTOR, dear.priceList, true, 7301);
      expect(await resolved(c, service)).toBe('100.0000');
      // Same specificity, higher priority; a colleague then moves its priority again.
      const own = await assign(c, USER_A, cheap.priceList, true, 7302);
      await as(c, PUBLISHER, () =>
        c.query(`UPDATE svc.price_list_assignments SET priority = 7303 WHERE id = $1`, [own])
      );
      expect(await resolved(c, service)).toBe('10.0000');
      const { wo } = await makeWorkOrder(c, 'fd8r4_prio');
      const revision = await draftRevision(c, await seedQuotation(c, wo, 'fd8r4_prio'), 1);
      const line = await addPricedLine(c, revision, service, cheap.rule, '10', '0');
      expect(await snapshotOf(c, line)).toEqual({
        price_assignment_ref: own,
        price_assigned_by: USER_A,
        price_assignment_changed_by: [PUBLISHER],
      });
      expect(await basisOf(c, revision, USER_A)).toEqual({ own_policy: false, own_price: true });
      expect(await needsApproval(c, revision)).toBe(true);
      await expectRefusal(c, /discount_approval_required/, `SELECT quo.issue_revision($1)`, [
        revision,
      ]);
    });
  });

  it('needs another person when the requester ended a competing assignment so a cheaper list applies', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'fd8r4_end');
      await as(c, OTHER_ACTOR, () => recordThreshold(c, '50'));
      const dear = await publishedList(c, OTHER_ACTOR, service, 'fd8r4_edear', '100');
      const cheap = await publishedList(c, OTHER_ACTOR, service, 'fd8r4_echeap', '10');
      // Both assignments are the administrator's; the branch one wins.
      const company = await assign(c, OTHER_ACTOR, cheap.priceList, false, 7401);
      const branch = await assign(c, OTHER_ACTOR, dear.priceList, true, 7402);
      expect(await resolved(c, service)).toBe('100.0000');
      // USER_A ends the branch assignment, so the company one applies.
      await c.query(`UPDATE svc.price_list_assignments SET status = 'inactive' WHERE id = $1`, [
        branch,
      ]);
      expect(await resolved(c, service)).toBe('10.0000');
      const { wo } = await makeWorkOrder(c, 'fd8r4_end');
      const revision = await draftRevision(c, await seedQuotation(c, wo, 'fd8r4_end'), 1);
      const line = await addPricedLine(c, revision, service, cheap.rule, '10', '0');
      // The assignment that priced the line is the administrator's, untouched ...
      expect(await snapshotOf(c, line)).toEqual({
        price_assignment_ref: company,
        price_assigned_by: OTHER_ACTOR,
        price_assignment_changed_by: [],
      });
      // ... but USER_A changed which list applies.
      expect(await basisOf(c, revision, USER_A)).toEqual({ own_policy: false, own_price: true });
      expect(await needsApproval(c, revision)).toBe(true);
      // Somebody who changed no assignment is not held to it.
      expect(await basisOf(c, revision, APPROVER)).toEqual({ own_policy: false, own_price: false });
    });
  });
});

describe('quo discount requests — the requester withdraws a pending request (D3)', () => {
  it('lets only the requester withdraw, stamps it, and makes the request terminal', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'fd8_withdraw');
      const { service } = await seedService(c, 'fd8_withdraw');
      const quotation = await seedQuotation(c, wo, 'fd8_withdraw');
      const revision = await draftRevision(c, quotation, 1);
      await addServiceItem(c, revision, service, 1, 100, 1, 10);
      const approval = await requestFor(c, quotation, revision, '10');
      const versionBefore = (
        await one<{ record_version: number }>(
          c,
          `SELECT record_version FROM quo.discount_approvals WHERE id = $1`,
          [approval]
        )
      ).record_version;

      // Somebody else — even one who may decide it — cannot withdraw it.
      await setContext(c, { tenantId: TENANT_A, userId: APPROVER });
      await expectRefusal(c, /discount_withdraw_not_requester/, withdrawSql, [approval]);
      await setContext(c, ctxA);

      // The requester can, and the database names them, whatever the writer says.
      await c.query(
        `UPDATE quo.discount_approvals SET status = 'withdrawn', withdrawn_by = $2 WHERE id = $1`,
        [approval, APPROVER]
      );
      const row = await one<{
        status: string;
        withdrawn_by: string;
        withdrawn_at: Date | null;
        decided_by: string | null;
        record_version: number;
      }>(
        c,
        `SELECT status, withdrawn_by, withdrawn_at, decided_by, record_version
           FROM quo.discount_approvals WHERE id = $1`,
        [approval]
      );
      expect(row.status).toBe('withdrawn');
      expect(row.withdrawn_by).toBe(USER_A);
      expect(row.withdrawn_at).not.toBeNull();
      expect(row.decided_by).toBeNull();
      expect(row.record_version).toBe(versionBefore + 1);

      // Terminal: never approved, rejected, withdrawn again or superseded.
      await setContext(c, { tenantId: TENANT_A, userId: APPROVER });
      await expectRefusal(c, /discount_approval_withdrawn/, approveSql, [approval, APPROVER]);
      await expectRefusal(c, /discount_approval_withdrawn/, rejectSql, [approval, APPROVER]);
      await setContext(c, ctxA);
      await expectRefusal(c, /discount_approval_withdrawn/, withdrawSql, [approval]);
      // Its revision cannot be issued, and keeps its lines.
      await expectRefusal(c, /discount_approval_withdrawn/, `SELECT quo.issue_revision($1)`, [
        revision,
      ]);
      await expectRefusal(
        c,
        /discount_request_freezes_items/,
        `UPDATE quo.quotation_items SET description = 'changed' WHERE quotation_revision_id = $1`,
        [revision]
      );

      // A withdrawn request is not open: a new revision asks again.
      const second = await draftRevision(c, quotation, 2);
      await addServiceItem(c, second, service, 1, 100, 1, 10);
      const again = await requestFor(c, quotation, second, '10');
      expect(
        (
          await one<{ status: string }>(
            c,
            `SELECT status FROM quo.discount_approvals WHERE id = $1`,
            [again]
          )
        ).status
      ).toBe('pending');
      await expectRefusal(
        c,
        /discount_approval_withdrawn/,
        `UPDATE quo.discount_approvals SET status = 'superseded', superseded_at = now(), superseded_by_revision_id = $2 WHERE id = $1`,
        [approval, second]
      );
    });
  });

  it('refuses to withdraw a request that was decided or replaced', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { service } = await seedService(c, 'fd8_decided');
      const scenes: string[] = [];
      for (const tag of ['fd8_approved', 'fd8_rejected']) {
        const { wo } = await makeWorkOrder(c, tag);
        const quotation = await seedQuotation(c, wo, tag);
        const revision = await draftRevision(c, quotation, 1);
        await addServiceItem(c, revision, service, 1, 100, 1, 10);
        scenes.push(await requestFor(c, quotation, revision, '10'));
      }
      const [approved, rejected] = scenes as [string, string];
      await setContext(c, { tenantId: TENANT_A, userId: APPROVER });
      await c.query(approveSql, [approved, APPROVER]);
      await c.query(rejectSql, [rejected, APPROVER]);
      await setContext(c, ctxA);
      await expectRefusal(c, /discount_approval_already_decided/, withdrawSql, [approved]);
      await expectRefusal(c, /discount_approval_already_decided/, withdrawSql, [rejected]);

      const { wo } = await makeWorkOrder(c, 'fd8_superseded');
      const quotation = await seedQuotation(c, wo, 'fd8_superseded');
      const first = await draftRevision(c, quotation, 1);
      await addServiceItem(c, first, service, 1, 100, 1, 10);
      const replaced = await requestFor(c, quotation, first, '10');
      const second = await draftRevision(c, quotation, 2);
      await c.query(
        `UPDATE quo.discount_approvals SET status = 'superseded', superseded_at = now(), superseded_by_revision_id = $2 WHERE id = $1`,
        [replaced, second]
      );
      await expectRefusal(c, /discount_approval_superseded/, withdrawSql, [replaced]);
    });
  });

  it('isolates tenants: another tenant can neither withdraw a request nor read its basis or provenance', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await makeWorkOrder(c, 'fd8_isolation');
      const { service } = await seedService(c, 'fd8_isolation');
      await recordThreshold(c, '50');
      const quotation = await seedQuotation(c, wo, 'fd8_isolation');
      const revision = await draftRevision(c, quotation, 1);
      await addServiceItem(c, revision, service, 1, 100, 1, 10);
      const approval = await requestFor(c, quotation, revision, '10');

      await setContext(c, { tenantId: TENANT_B, userId: USER_B });
      const moved = await c.query(withdrawSql, [approval]);
      expect(moved.rowCount).toBe(0);
      expect(await basisOf(c, revision, USER_A)).toEqual({ own_policy: false, own_price: false });
      const seen = await c.query(
        `SELECT set_by FROM svc.pricing_approval_policies WHERE tenant_id = $1`,
        [TENANT_A]
      );
      expect(seen.rowCount).toBe(0);
      await setContext(c, ctxA);
      expect(
        (
          await one<{ status: string }>(
            c,
            `SELECT status FROM quo.discount_approvals WHERE id = $1`,
            [approval]
          )
        ).status
      ).toBe('pending');
    });
  });
});
