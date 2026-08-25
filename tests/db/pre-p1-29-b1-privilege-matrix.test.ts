/**
 * PRE-P1-29 Wave B, slice B1 — the required-privilege matrix, in both directions.
 *
 * ## Why a third file
 *
 * `pre-p1-29-b1-platform-privilege-closure.test.ts` proves the sanctioned paths
 * EXECUTE, and `pre-p1-29-b1-privilege-mutations.test.ts` proves a representative
 * sample of the privileges they rest on are load-bearing. Neither answers the
 * closure question: is the set of privileges app_platform holds exactly the set
 * the sanctioned paths need?
 *
 * That question has two halves and they fail differently:
 *
 *   MISSING (required, not held) — the under-grant direction. Every one of the
 *     five B1-UG defects lived here, and all five were invisible to review
 *     because a missing privilege reads as a working design right up until
 *     something runs.
 *
 *   ORPHAN (held, not required) — the over-grant direction. A privilege nothing
 *     claims is reach the control plane has and cannot justify. It is also how
 *     this file stays honest over time: adding a grant to the migration without
 *     attributing it to a path fails here, so the matrix cannot silently rot
 *     into a subset of reality.
 *
 * ## What "required" means
 *
 * Authored from the FINAL migration SQL, path by path, and deliberately NOT
 * generated from the database — a matrix derived from what is granted would
 * agree with itself no matter what was granted, which is the exact failure mode
 * a matrix exists to prevent.
 *
 * The dependency classes below are the ones the sanctioned paths actually use.
 * Two are empty, and both are recorded rather than omitted: app_platform holds
 * no SEQUENCE privilege (every key in this surface is gen_random_uuid(), and
 * shared.number_sequences is an ordinary table, not a PostgreSQL sequence), and
 * it holds no DELETE anywhere.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool, roleSurfaceFingerprint } from './helpers';
// The standing CI gate itself, imported rather than described, so this file
// tests the thing that runs in CI and not a restatement of it.
import { ACTIONS, buildMatrix, CRITICAL_SCHEMAS, RUNTIME_ROLES } from '../../scripts/ci/rls-matrix.mjs';

let admin: Pool;
/** The platform surface as this file found it — see roleSurfaceFingerprint. */
let surfaceBaseline: string;

/** One privilege fact, and the path that justifies it. */
type Fact = { path: string; why: string };
const REQUIRED = new Map<string, Fact>();
const add = (key: string, path: string, why: string): void => {
  if (REQUIRED.has(key)) throw new Error(`the matrix claims ${key} twice`);
  REQUIRED.set(key, { path, why });
};

/*
 * TWO CLASSES ARE DELIBERATELY ABSENT FROM THIS TABLE, and both were in it.
 *
 * The narrowing readers iam.allowed_company_ids() and iam.allowed_branch_ids().
 * They were listed as "B1-UG-002 — called by shared narrowing helpers". Nothing
 * calls them on any sanctioned path: no policy granted to app_platform mentions
 * them, and no function app_platform may execute does either. The grant was
 * over-grant, the mutation that defended it revoked the grant and then called
 * the helper directly, and both are now withdrawn.
 *
 * Trigger functions. Eight EXECUTE grants were justified by "a role cannot fire
 * a trigger it may not execute". PostgreSQL checks that at CREATE TRIGGER, not
 * at fire time — and this database proves it: org.stamp_tenant_status_history
 * and shared.guard_number_sequence_regression fire on app_platform's own writes
 * with no EXECUTE held. Functions called from inside a trigger BODY are checked
 * at runtime, which is why org.tenant_has_recoverable_owner and
 * iam.grant_delegation_within_authority remain.
 *
 * A THIRD class is invisible to this matrix by construction and is named rather
 * than left out: privileges reaching app_platform through PUBLIC. Both sides of
 * this comparison read ACL entries whose grantee is literally app_platform, so a
 * PUBLIC grant appears in neither REQUIRED nor ACTUAL and the two would agree
 * while both were wrong. The sanctioned paths do depend on some — gen_random_uuid()
 * behind every id default, and USAGE on pg_catalog — and they are asserted
 * separately at the end of this file instead.
 */

// ---------------------------------------------------------------------------
// PATH 0 — context and authority resolution.
add('schema:iam:USAGE', 'PATH 0', 'reach the resolver and every iam relation below');
add('schema:org:USAGE', 'PATH 0', 'reach the organisation surface');
add('schema:shared:USAGE', 'PATH 0', 'reach the replay and sequence tables');
add('exec:iam.current_user_id()', 'PATH 0', 'the acting principal, read by every policy');
add('exec:iam.current_tenant_id()', 'PATH 0', 'the tenant term of every write policy');
add('exec:iam.has_platform_authority(text)', 'PATH 0', 'the resolver itself');
add('exec:iam.holds_any_platform_authority()', 'PATH 0', 'the audit and replay authority conjunct');
add('table:iam.platform_grants:SELECT', 'PATH 0', 'the relation the resolver reads');
add('policy:iam.platform_grants:sel_platform_grants_self', 'PATH 0', 'own authority rows only');
add('column:iam.user_accounts.id:SELECT', 'PATH 0', 'the resolver joins the acting account');
add('column:iam.user_accounts.status:SELECT', 'PATH 0', 'a disabled operator resolves false');
add('column:iam.user_accounts.deleted_at:SELECT', 'PATH 0', 'a deleted operator resolves false');
add(
  'column:iam.user_accounts.tenant_id:SELECT',
  'PATH 0',
  'B1-UG-004 — the readiness join needs it, and three of the four columns were already granted'
);
add('policy:iam.user_accounts:sel_user_accounts_platform_self', 'PATH 0', 'the operator own-row read');

// ---------------------------------------------------------------------------
// PATH 1 — organisation read.
add('table:org.tenants:SELECT', 'PATH 1', 'the tenant read, and the lifecycle FOR UPDATE lock');
add('policy:org.tenants:sel_tenants_platform', 'PATH 1', 'authority-gated tenant visibility');
add('table:org.legal_companies:SELECT', 'PATH 1', 'read-back of the provisioned company');
add('policy:org.legal_companies:sel_legal_companies_platform', 'PATH 1', 'the same, row level');
add('table:org.branches:SELECT', 'PATH 1', 'read-back of the provisioned branch');
add('policy:org.branches:sel_branches_platform', 'PATH 1', 'the same, row level');
add('table:org.tenant_subscriptions:SELECT', 'PATH 1', 'read-back of the subscription');
add('policy:org.tenant_subscriptions:sel_tenant_subscriptions_platform', 'PATH 1', 'the same');
add('table:org.subscription_plans:SELECT', 'PATH 1', 'the plan a provisioning call names');
add('policy:org.subscription_plans:sel_subscription_plans_platform', 'PATH 1', 'the same');

// ---------------------------------------------------------------------------
// PATH 2 — provisioning through org.provision_organization.
add('exec:org.provision_organization(jsonb,text)', 'PATH 2', 'the entry function');
add('table:org.tenants:INSERT', 'PATH 2', 'the tenant root');
add('policy:org.tenants:ins_tenants_platform_provisioning', 'PATH 2', 'provisioning state only');
add('table:org.tenant_status_history:INSERT', 'PATH 2', 'the opening history row');
add(
  'policy:org.tenant_status_history:ins_tenant_status_history_platform_provisioning',
  'PATH 2',
  'the provisioning half — the lifecycle half is a separate policy on purpose'
);
add('table:org.tenant_subscriptions:INSERT', 'PATH 2', 'the subscription');
add('policy:org.tenant_subscriptions:ins_tenant_subscriptions_platform', 'PATH 2', 'the same');
add('table:org.legal_companies:INSERT', 'PATH 2', 'the legal company');
add('policy:org.legal_companies:ins_legal_companies_platform', 'PATH 2', 'the same');
add('table:org.branches:INSERT', 'PATH 2', 'the first branch');
add('policy:org.branches:ins_branches_platform', 'PATH 2', 'the same');
add('table:org.company_settings:INSERT', 'PATH 2', 'company settings');
add('policy:org.company_settings:ins_company_settings_platform', 'PATH 2', 'the same');
add('table:org.branch_settings:INSERT', 'PATH 2', 'branch settings');
add('policy:org.branch_settings:ins_branch_settings_platform', 'PATH 2', 'the same');
add('table:org.tenant_feature_overrides:INSERT', 'PATH 2', 'feature overrides');
add('policy:org.tenant_feature_overrides:ins_tenant_feature_overrides_platform', 'PATH 2', 'same');
add('table:shared.number_sequences:INSERT', 'PATH 2', 'the tenant numbering rows');
add('policy:shared.number_sequences:ins_number_sequences_platform', 'PATH 2', 'the same');
add('table:shared.idempotency_keys:INSERT', 'PATH 2', 'the replay record');
add('policy:shared.idempotency_keys:ins_idempotency_keys_platform', 'PATH 2', 'authority-gated');
add('table:shared.idempotency_keys:SELECT', 'PATH 2', 'the replay read that makes a retry idempotent');
add('policy:shared.idempotency_keys:sel_idempotency_keys_platform', 'PATH 2', 'authority-gated');

// ---------------------------------------------------------------------------
// PATH 3 — tenant lifecycle.
add('exec:org.change_tenant_status(uuid,text,text,uuid,uuid)', 'PATH 3', 'the entry function');
add(
  'exec:org.tenant_has_recoverable_owner(uuid)',
  'PATH 3',
  'B1-UG-003 — the guard calls it as the WRITING role, so the caller never names it'
);
add('column:org.tenants.status:UPDATE', 'PATH 3', 'the only UPDATE app_platform holds anywhere');
add('policy:org.tenants:upd_tenants_platform_lifecycle', 'PATH 3', 'USING and WITH CHECK both');
add(
  'policy:org.tenant_status_history:ins_tenant_status_history_platform_lifecycle',
  'PATH 3',
  'the lifecycle history row — tenant, destination coherence and chain continuity'
);

// ---------------------------------------------------------------------------
// PATH 4 — the audit chain.
add(
  'exec:iam.audit_append(uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,text,jsonb)',
  'PATH 4',
  'the entry point — kept, because the actor is bound by the row policy and not by revoking this'
);
add('exec:iam.audit_mask(text,text)', 'PATH 4', 'called by the writer');
add('exec:iam.audit_canonical(uuid)', 'PATH 4', 'called by the writer');
add('exec:iam.audit_hash(bytea,text)', 'PATH 4', 'called by the writer');
add('table:iam.audit_records:INSERT', 'PATH 4', 'the event');
add('table:iam.audit_records:SELECT', 'PATH 4', 'the writer reads back the row it is chaining');
add('policy:iam.audit_records:ins_audit_records_platform', 'PATH 4', 'tenant AND authority AND actor');
add('policy:iam.audit_records:sel_audit_records_platform_unlinked', 'PATH 4', 'pre-commit read only');
add('table:iam.audit_record_details:INSERT', 'PATH 4', 'the changed fields');
add('table:iam.audit_record_details:SELECT', 'PATH 4', 'read back while chaining');
add('policy:iam.audit_record_details:ins_audit_record_details_platform', 'PATH 4', 'the same');
add('policy:iam.audit_record_details:sel_audit_record_details_platform_unlinked', 'PATH 4', 'same');
add('table:iam.audit_integrity_links:INSERT', 'PATH 4', 'the hash chain link');
add('table:iam.audit_integrity_links:SELECT', 'PATH 4', 'the previous link, to hash onto');
add('policy:iam.audit_integrity_links:ins_audit_integrity_links_platform', 'PATH 4', 'the same');
add('policy:iam.audit_integrity_links:sel_audit_integrity_links_platform_chain', 'PATH 4', 'same');

// ---------------------------------------------------------------------------
// PATH 5 — initial Owner bootstrap, inside the provisioning window.
add('exec:iam.grant_delegation_within_authority(uuid)', 'PATH 5', 'called by the trigger below');
add('table:iam.user_accounts:INSERT', 'PATH 5', 'the Owner account');
add('policy:iam.user_accounts:ins_user_accounts_platform_bootstrap', 'PATH 5', 'window-scoped');
add(
  'policy:iam.user_accounts:sel_user_accounts_platform_bootstrap',
  'PATH 5',
  'B1-UG-001 — RETURNING is evaluated against the SELECT policy'
);
add(
  'table:iam.user_status_history:INSERT',
  'PATH 5',
  'design 6.3 has the bootstrap record the Owner account status; NOT written by any trigger — an earlier note here said it was, and no trigger on iam.user_accounts touches this table'
);
add('table:iam.user_status_history:SELECT', 'PATH 5', 'the read-back of that write');
add('policy:iam.user_status_history:ins_user_status_history_platform_bootstrap', 'PATH 5', 'same');
add('policy:iam.user_status_history:sel_user_status_history_platform_bootstrap', 'PATH 5', 'same');
add('table:iam.roles:INSERT', 'PATH 5', 'the Owner role');
add('table:iam.roles:SELECT', 'PATH 5', 'the read-back of its id');
add('policy:iam.roles:ins_roles_platform_bootstrap', 'PATH 5', 'window-scoped');
add('policy:iam.roles:sel_roles_platform_bootstrap', 'PATH 5', 'the RETURNING half');
add('table:iam.role_permissions:INSERT', 'PATH 5', 'the role mapping');
add('table:iam.role_permissions:SELECT', 'PATH 5', 'the read-back');
add(
  'policy:iam.role_permissions:ins_role_permissions_platform_bootstrap',
  'PATH 5',
  'tenant codes only — a platform code cannot be mapped into a tenant role'
);
add('policy:iam.role_permissions:sel_role_permissions_platform_bootstrap', 'PATH 5', 'read-back');
add('table:iam.role_grants:INSERT', 'PATH 5', 'the Owner grant');
// COLUMN-SCOPED, not table-level. Four readers touch iam.role_grants as
// app_platform — the readiness predicate, tg_role_grants_require_scope, the
// delegation backstop and the bootstrap read-back — and between them they use
// eight of its seventeen columns. The nine withheld are grant administration
// metadata, which is exactly the part that records WHO did what inside a tenant.
for (const col of [
  'id',
  'tenant_id',
  'user_id',
  'role_id',
  'scope_mode',
  'status',
  'valid_from',
  'valid_to',
]) {
  add(
    `column:iam.role_grants.${col}:SELECT`,
    'PATH 5',
    'the minimum column set the four sanctioned readers of this table need'
  );
}
add('policy:iam.role_grants:ins_role_grants_platform_bootstrap', 'PATH 5', 'window-scoped');
add('policy:iam.role_grants:sel_role_grants_platform_bootstrap', 'PATH 5', 'window-scoped read');
add('table:iam.grant_scopes:INSERT', 'PATH 5', 'scope rows for a scoped grant');
add('table:iam.grant_scopes:SELECT', 'PATH 5', 'read by the same deferred trigger');
add('policy:iam.grant_scopes:ins_grant_scopes_platform_bootstrap', 'PATH 5', 'window-scoped');
add('policy:iam.grant_scopes:sel_grant_scopes_platform_bootstrap', 'PATH 5', 'window-scoped read');
add('table:iam.permissions:SELECT', 'PATH 5', 'resolving a permission code to its id');
add('policy:iam.permissions:sel_permissions_platform', 'PATH 5', 'the catalogue is not secret');

// ---------------------------------------------------------------------------
// PATH 6 — readiness and reactivation, outside the bootstrap window.
add(
  'policy:iam.role_grants:sel_role_grants_platform_lifecycle',
  'PATH 6',
  'B1-UG-005 — the window-scoped read hides the grant once the tenant is suspended'
);
add(
  'policy:iam.user_accounts:sel_user_accounts_platform_lifecycle',
  'PATH 6',
  'B1-UG-005, narrowed to accounts holding an active grant so it cannot cover PATH 5'
);
add(
  'policy:iam.role_permissions:sel_role_permissions_platform_lifecycle',
  'PATH 6',
  'the mapping readiness reads to decide whether a grant confers anything'
);

beforeAll(async () => {
  admin = adminPool();
  surfaceBaseline = await roleSurfaceFingerprint(admin, 'app_platform');
});
afterAll(async () => {
  // This file grants, revokes and ALTERs a role. Whatever it did, the surface it
  // leaves behind must be the one it found — predicates, grants, memberships and
  // role attributes alike. A mutation suite that returns green having weakened
  // the database is a failed run, and that has happened in this slice.
  expect(
    await roleSurfaceFingerprint(admin, 'app_platform'),
    'this suite must leave the platform surface exactly as it found it'
  ).toBe(surfaceBaseline);
  await admin.end();
});

/** Everything app_platform actually holds, as comparable keys. */
async function actual(): Promise<Set<string>> {
  const held = new Set<string>();
  const push = (k: string): void => {
    held.add(k);
  };

  const schemas = await admin.query<{ n: string; p: string }>(
    `SELECT n.nspname AS n, a.privilege_type AS p
       FROM pg_namespace n, aclexplode(n.nspacl) a, pg_roles r
      WHERE r.oid = a.grantee AND r.rolname = 'app_platform'`
  );
  for (const r of schemas.rows) push(`schema:${r.n}:${r.p}`);

  // regprocedure, not pg_get_function_identity_arguments: the latter includes
  // PARAMETER NAMES, so the matrix would have to be rewritten every time an
  // argument is renamed — a change that cannot affect who may call anything.
  const fns = await admin.query<{ sig: string }>(
    `SELECT p.oid::regprocedure::text AS sig
       FROM pg_proc p
      WHERE EXISTS (SELECT 1 FROM aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
                     WHERE r.rolname = 'app_platform' AND a.privilege_type = 'EXECUTE')`
  );
  for (const r of fns.rows) push(`exec:${r.sig}`);

  const tables = await admin.query<{ rel: string; p: string; kind: string }>(
    `SELECT c.relnamespace::regnamespace || '.' || c.relname AS rel,
            a.privilege_type AS p, c.relkind::text AS kind
       FROM pg_class c, aclexplode(c.relacl) a, pg_roles r
      WHERE r.oid = a.grantee AND r.rolname = 'app_platform' AND c.relkind IN ('r','S')`
  );
  for (const r of tables.rows) push(`${r.kind === 'S' ? 'sequence' : 'table'}:${r.rel}:${r.p}`);

  const cols = await admin.query<{ rel: string; col: string; p: string }>(
    `SELECT c.relnamespace::regnamespace || '.' || c.relname AS rel, att.attname AS col,
            a.privilege_type AS p
       FROM pg_class c JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0,
            aclexplode(att.attacl) a, pg_roles r
      WHERE r.oid = a.grantee AND r.rolname = 'app_platform'`
  );
  for (const r of cols.rows) push(`column:${r.rel}.${r.col}:${r.p}`);

  const pols = await admin.query<{ rel: string; name: string }>(
    `SELECT schemaname || '.' || tablename AS rel, policyname AS name
       FROM pg_policies WHERE 'app_platform' = ANY (roles)`
  );
  for (const r of pols.rows) push(`policy:${r.rel}:${r.name}`);

  return held;
}

// ---------------------------------------------------------------------------
describe('the required-privilege matrix closes in both directions', () => {
  it('MISSING = 0 — every privilege a sanctioned path needs is held', async () => {
    const held = await actual();
    const missing = [...REQUIRED.entries()]
      .filter(([key]) => !held.has(key))
      .map(([key, fact]) => `${fact.path}  ${key}  (${fact.why})`);
    expect(missing, `${missing.length} required privileges are not granted`).toEqual([]);
  });

  it('ORPHAN = 0 — every privilege held is claimed by a sanctioned path', async () => {
    // The over-grant direction, and the reason this file does not rot: a grant
    // added to the migration without a line above fails here.
    const held = await actual();
    const orphans = [...held].filter((key) => !REQUIRED.has(key)).sort();
    expect(orphans, `${orphans.length} privileges are held but attributed to no path`).toEqual([]);
  });

  it('holds no privilege class the design excluded', async () => {
    const held = await actual();
    // Recorded rather than omitted: two categories the matrix deliberately
    // leaves empty, so a later addition is visible as a change and not as a gap.
    expect([...held].filter((k) => k.startsWith('sequence:'))).toEqual([]);
    expect([...held].filter((k) => k.endsWith(':DELETE'))).toEqual([]);
    expect([...held].filter((k) => k.endsWith(':TRUNCATE'))).toEqual([]);
    expect([...held].filter((k) => k.endsWith(':REFERENCES'))).toEqual([]);
    expect([...held].filter((k) => k.endsWith(':TRIGGER'))).toEqual([]);
    // The single UPDATE is column-scoped; no table-level UPDATE exists anywhere.
    expect([...held].filter((k) => k.startsWith('table:') && k.endsWith(':UPDATE'))).toEqual([]);
  });

  it('names the PUBLIC-derived dependencies the matrix cannot see', async () => {
    /*
     * The blind spot both directions of this matrix share, written down so it is
     * a known boundary rather than a gap. These are reachable because PUBLIC
     * holds them, so revoking PUBLIC would break the sanctioned paths without
     * MISSING or ORPHAN moving at all.
     */
    const viaPublic = [
      'pg_catalog.gen_random_uuid()',
      'pg_catalog.hashtext(text)',
      'pg_catalog.pg_advisory_xact_lock(bigint)',
    ];
    for (const fn of viaPublic) {
      const r = await admin.query<{ ok: boolean }>(
        `SELECT has_function_privilege('app_platform', $1, 'EXECUTE') AS ok`,
        [fn]
      );
      expect(r.rows[0]!.ok, fn + ' is a real dependency of the sanctioned paths').toBe(true);
      // And it is NOT a direct grant — which is exactly why the matrix misses it.
      const direct = await admin.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_proc p, aclexplode(p.proacl) a, pg_roles r
          WHERE p.oid = $1::regprocedure AND r.oid = a.grantee
            AND r.rolname = 'app_platform' AND a.privilege_type = 'EXECUTE'`,
        [fn]
      );
      expect(direct.rows[0]!.n).toBe('0');
    }
  });

  it('reports the matrix size, so a silent shrink is visible', async () => {
    const held = await actual();
    // Not a magic number to keep in step by hand: the two are asserted equal to
    // each other by the two cases above, and this pins the shared value so a
    // matrix that shrank on both sides at once would still be caught.
    // 106 before the delta refuter: ten privileges removed as over-grant (two
    // narrowing readers, eight trigger functions) and two policies added for the
    // readiness predicate's new reads.
    // 98 before the final narrowing pass: iam.role_grants SELECT became eight
    // column entries instead of one table entry, and the history chain-coherence
    // term brought a read grant and its policy with it.
    // 107 before the final refuter: sel_roles_platform_lifecycle went away with
    // the iam.roles join it existed to serve — removing that join is what keeps
    // the predicate faithful to iam.has_permission, and a policy nothing reads
    // is reach nobody can justify.
    // 106 before the final refuter: the history chain-coherence term was
    // withdrawn — it could wedge a tenant permanently to block a redundant row —
    // and its read grant and policy went with it.
    expect(REQUIRED.size).toBe(104);
    expect(held.size).toBe(104);
  });
});

// ---------------------------------------------------------------------------
describe('the standing over-grant gate can actually see app_platform', () => {
  /*
   * scripts/ci/rls-matrix.mjs is named by the privilege-graph migration as the
   * control for the over-grant direction. Naming it is not enough, and this
   * slice has now found that claim false twice:
   *
   *   1. RUNTIME_ROLES did not list app_platform, so the matrix never iterated
   *      the role. Fixed by adding it — and that fix looked sufficient.
   *   2. It was not. The policy lookup keyed on TABLE and COMMAND only, never on
   *      the role, so a cell counted as covered by any policy for that action on
   *      that table no matter whose it was. Granting app_platform SELECT on
   *      crm.business_partners — a table it has no policy on, in a schema it has
   *      no USAGE on — produced 'granted-with-policy' and the gate exited 0.
   *
   * The second defect was invisible to the first fix and to reading the code;
   * it appeared when the mutation below was run for the first time. So the
   * mutation is the test, permanently.
   */
  const TARGET = 'crm.business_partners';
  const COLUMN = 'id';

  async function matrix() {
    const client = await admin.connect();
    try {
      return await buildMatrix(client, CRITICAL_SCHEMAS);
    } finally {
      client.release();
    }
  }

  it('lists the platform role among the roles it iterates', async () => {
    expect(RUNTIME_ROLES.map((r: { role: string }) => r.role)).toContain('app_platform');
    const m = await matrix();
    const cells = m.cells.filter((c: { role: string }) => c.role === 'app_platform');
    // One cell per action on every critical-schema table, so the role is not
    // merely listed but actually measured. Derived from ACTIONS rather than
    // written as a literal: the gate grew from four privileges to all eight when
    // TRUNCATE turned out to be unasked, and a hard-coded 4 would have had to be
    // noticed rather than following along.
    expect(cells.length).toBe(m.tableCount * ACTIONS.length);
  });

  it('MUTATION: a forbidden business grant turns the gate RED, and restoring it turns it GREEN', async () => {
    // Step 1 — the precondition. A mutation that adds something already present
    // proves nothing.
    const before = await admin.query<{ ok: boolean }>(
      `SELECT has_table_privilege('app_platform', $1, 'SELECT') AS ok`,
      [TARGET]
    );
    expect(before.rows[0]!.ok, TARGET + ' must not already be granted').toBe(false);
    expect((await matrix()).failures).toEqual([]);

    // Step 2 — grant it, and require the gate to fail for the right reason.
    await admin.query(`GRANT SELECT ON ${TARGET} TO app_platform`);
    try {
      const mutated = await matrix();
      expect(mutated.ok).toBe(false);
      const named = mutated.failures.filter(
        (f: string) => f.includes('app_platform') && f.includes(TARGET)
      );
      expect(named.length, 'the failure must name the role AND the table').toBe(1);
    } finally {
      // Step 3 — restore, whatever happened, and re-prove green.
      await admin.query(`REVOKE SELECT ON ${TARGET} FROM app_platform`);
    }

    const after = await admin.query<{ ok: boolean }>(
      `SELECT has_table_privilege('app_platform', $1, 'SELECT') AS ok`,
      [TARGET]
    );
    expect(after.rows[0]!.ok).toBe(false);
    expect((await matrix()).failures).toEqual([]);
  });

  it('MUTATION: a COLUMN-level forbidden grant turns the gate RED', async () => {
    /*
     * The second blind spot in the same gate, and the more dangerous of the two.
     * has_table_privilege answers FALSE for a column-level grant, so before this
     * was fixed the matrix reported every column-scoped privilege in the
     * database as denied-by-grant — thirty of them, including app_platform's own
     * UPDATE (status) ON org.tenants and its four-column read of
     * iam.user_accounts. GRANT SELECT (col) ON a business table was therefore a
     * complete bypass of the over-grant control.
     *
     * Worth having as a separate case from the table-level one: a fix for the
     * table form does nothing for this, and the table-level mutation passes
     * either way.
     */
    // The relation AND the column must be real. A GRANT naming either wrongly
    // raises rather than granting, the gate stays green, and the mutation would
    // report a pass having changed nothing — the B1-VAC-001 class, which this
    // slice has already been bitten by once on a misspelt table name.
    const real = await admin.query<{ rel: boolean; col: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS rel,
              EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = split_part($1,'.',1)
                         AND table_name = split_part($1,'.',2)
                         AND column_name = $2) AS col`,
      [TARGET, COLUMN]
    );
    expect(real.rows[0]!.rel, TARGET + ' must exist').toBe(true);
    expect(real.rows[0]!.col, TARGET + '.' + COLUMN + ' must exist').toBe(true);

    const before = await admin.query<{ ok: boolean }>(
      `SELECT has_any_column_privilege('app_platform', $1, 'SELECT') AS ok`,
      [TARGET]
    );
    expect(before.rows[0]!.ok).toBe(false);
    expect((await matrix()).failures).toEqual([]);

    await admin.query(`GRANT SELECT (${COLUMN}) ON ${TARGET} TO app_platform`);
    try {
      const mutated = await matrix();
      expect(mutated.ok, 'a single-column grant must be visible to the gate').toBe(false);
      expect(
        mutated.failures.filter(
          (f: string) => f.includes('app_platform') && f.includes(TARGET)
        ).length
      ).toBe(1);
    } finally {
      await admin.query(`REVOKE SELECT (${COLUMN}) ON ${TARGET} FROM app_platform`);
    }

    const after = await admin.query<{ ok: boolean }>(
      `SELECT has_any_column_privilege('app_platform', $1, 'SELECT') AS ok`,
      [TARGET]
    );
    expect(after.rows[0]!.ok).toBe(false);
    expect((await matrix()).failures).toEqual([]);
  });

  it('MUTATION: granting the platform role a MEMBERSHIP turns the gate RED', async () => {
    /*
     * The hole underneath all the others, and the one the earlier fixes made
     * worse rather than better. has_table_privilege resolves privileges reached
     * through membership, so a role granted app_runtime reads as "granted" on
     * every business table — and the policy-applicability test, which resolves
     * membership with pg_has_role for exactly the right reason, then reports
     * each of those cells as covered by app_runtime's own policy. Every cell
     * lands on a passing verdict.
     *
     * Per-cell checking cannot see it, because per-cell is where it hides.
     */
    const before = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'app_platform'`
    );
    expect(before.rows[0]!.n, 'app_platform must start a member of nothing').toBe('0');
    expect((await matrix()).failures).toEqual([]);

    await admin.query(`GRANT app_runtime TO app_platform`);
    try {
      const mutated = await matrix();
      expect(mutated.ok, 'inheriting app_runtime must fail the gate').toBe(false);
      expect(
        mutated.failures.some(
          (f: string) => f.includes('app_platform') && f.includes('app_runtime')
        )
      ).toBe(true);
    } finally {
      await admin.query(`REVOKE app_runtime FROM app_platform`);
    }

    const after = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'app_platform'`
    );
    expect(after.rows[0]!.n).toBe('0');
    expect((await matrix()).failures).toEqual([]);
  });

  it('MUTATION: a VIEW over a business table turns the gate RED', async () => {
    /*
     * The strongest omission the gate had, and the one that would have been
     * permanent. Every RootLco table is owned by postgres, which is BYPASSRLS,
     * and a view that is not security_invoker executes with its OWNER's rights —
     * so a single granted view over a business table is a complete, standing RLS
     * bypass. The matrix enumerated relkind 'r' and 'p' only, so it could not
     * have reported one at any level, on any schema, ever.
     *
     * The source relation is asserted to exist first. A view over a misspelt
     * table fails to create, the gate stays green, and the mutation would report
     * a pass having changed nothing — the B1-VAC-001 class again.
     */
    const real = await admin.query<{ ok: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS ok`,
      [TARGET]
    );
    expect(real.rows[0]!.ok, TARGET + ' must exist').toBe(true);
    expect((await matrix()).failures).toEqual([]);

    await admin.query(`CREATE VIEW crm.b1_bypass_probe AS SELECT * FROM ${TARGET}`);
    try {
      // The view exists but nothing is granted on it yet, so the gate is still
      // green — which is correct, and is what makes the next step meaningful.
      expect((await matrix()).failures).toEqual([]);

      await admin.query(`GRANT SELECT ON crm.b1_bypass_probe TO app_platform`);
      const mutated = await matrix();
      expect(mutated.ok, 'a granted view over a business table must fail the gate').toBe(false);
      expect(
        mutated.failures.some((f: string) => f.includes('b1_bypass_probe')),
        'and the failure must name the view'
      ).toBe(true);
    } finally {
      await admin.query(`DROP VIEW IF EXISTS crm.b1_bypass_probe`);
    }

    const gone = await admin.query<{ ok: boolean }>(
      `SELECT to_regclass('crm.b1_bypass_probe') IS NULL AS ok`
    );
    expect(gone.rows[0]!.ok).toBe(true);
    expect((await matrix()).failures).toEqual([]);
  });

  it('the surface fingerprint can tell the difference, so the fidelity check is not vacuous', async () => {
    /*
     * The guard on the guard. roleSurfaceFingerprint is what this file and the
     * mutation file compare against at the end of their runs; if it were blind
     * to a change, both checks would pass forever and mean nothing — which is
     * precisely the failure the fingerprint exists to prevent, one level up.
     *
     * Each probe below is a DIFFERENT kind of change, because a fingerprint that
     * noticed only grants would still have missed the policy-predicate reversion
     * that motivated it.
     */
    const before = await roleSurfaceFingerprint(admin, 'app_platform');

    // a table grant
    await admin.query(`GRANT SELECT ON ${TARGET} TO app_platform`);
    const withGrant = await roleSurfaceFingerprint(admin, 'app_platform');
    await admin.query(`REVOKE SELECT ON ${TARGET} FROM app_platform`);
    expect(withGrant, 'a table grant must move the fingerprint').not.toBe(before);

    // a role attribute
    await admin.query(`ALTER ROLE app_platform BYPASSRLS`);
    const withAttr = await roleSurfaceFingerprint(admin, 'app_platform');
    await admin.query(`ALTER ROLE app_platform NOBYPASSRLS`);
    expect(withAttr, 'a role attribute must move the fingerprint').not.toBe(before);

    // a policy PREDICATE, holding the name constant — the case that started this
    const original = await admin.query<{ qual: string }>(
      `SELECT qual FROM pg_policies
        WHERE schemaname = 'iam' AND tablename = 'role_grants'
          AND policyname = 'sel_role_grants_platform_lifecycle'`
    );
    expect(original.rows[0]!.qual).toContain('current_tenant_id');
    await admin.query(`DROP POLICY sel_role_grants_platform_lifecycle ON iam.role_grants`);
    await admin.query(
      `CREATE POLICY sel_role_grants_platform_lifecycle ON iam.role_grants
         FOR SELECT TO app_platform
         USING (iam.has_platform_authority('platform.organization.lifecycle'))`
    );
    const withWeakerPolicy = await roleSurfaceFingerprint(admin, 'app_platform');
    await admin.query(`DROP POLICY sel_role_grants_platform_lifecycle ON iam.role_grants`);
    await admin.query(
      `CREATE POLICY sel_role_grants_platform_lifecycle ON iam.role_grants
         FOR SELECT TO app_platform
         USING (${original.rows[0]!.qual})`
    );
    expect(
      withWeakerPolicy,
      'the same policy NAME carrying a weaker predicate must move the fingerprint'
    ).not.toBe(before);

    // and everything is back
    expect(await roleSurfaceFingerprint(admin, 'app_platform')).toBe(before);
  });

  it('MUTATION: BYPASSRLS on the platform role turns the gate RED', async () => {
    // The other half of what the migration claims this gate covers. NOBYPASSRLS
    // is asserted as an attribute elsewhere; this proves CI would catch it
    // changing, which is a different question.
    await admin.query(`ALTER ROLE app_platform BYPASSRLS`);
    try {
      const mutated = await matrix();
      expect(mutated.ok).toBe(false);
      expect(
        mutated.failures.some(
          (f: string) => f.includes('app_platform') && f.includes('BYPASSRLS')
        )
      ).toBe(true);
    } finally {
      await admin.query(`ALTER ROLE app_platform NOBYPASSRLS`);
    }
    const restored = await admin.query<{ b: boolean }>(
      `SELECT rolbypassrls AS b FROM pg_roles WHERE rolname = 'app_platform'`
    );
    expect(restored.rows[0]!.b).toBe(false);
    expect((await matrix()).failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('the platform permission codes are used, and only used here', () => {
  /*
   * A permission code that no policy consults is a promise the database does not
   * keep. It reads as authority in the catalogue, an API layer can require it,
   * and nothing enforces it — which is worse than not having the code at all,
   * because the enforcement gap is invisible from the place people look.
   *
   * Checked against pg_policies rather than the migration text, so a code
   * referenced only in a comment does not count as used.
   */
  it('has exactly three platform codes, all critical or medium, in their own domain', async () => {
    const r = await admin.query<{ permission_code: string; domain: string; risk_level: string }>(
      `SELECT permission_code, domain, risk_level FROM iam.permissions
        WHERE permission_code LIKE 'platform.%' ORDER BY 1`
    );
    expect(r.rows.map((x) => x.permission_code)).toEqual([
      'platform.organization.lifecycle',
      'platform.organization.provision',
      'platform.organization.read',
    ]);
    for (const row of r.rows) expect(row.domain).toBe('platform');
    // Provisioning and lifecycle create and destroy tenants; read does not.
    expect(r.rows.map((x) => x.risk_level)).toEqual(['critical', 'critical', 'medium']);

    // The whole catalogue, so a code added elsewhere with a platform-shaped name
    // cannot slip past the list above.
    const totals = await admin.query<{ n: string; d: string }>(
      `SELECT count(*)::text AS n, count(DISTINCT domain)::text AS d FROM iam.permissions`
    );
    expect(totals.rows[0]!.n).toBe('115');
    expect(totals.rows[0]!.d).toBe('18');
  });

  it('every platform code is consulted by at least one live policy', async () => {
    const codes = await admin.query<{ permission_code: string }>(
      `SELECT permission_code FROM iam.permissions WHERE permission_code LIKE 'platform.%'`
    );
    const unused: string[] = [];
    for (const { permission_code } of codes.rows) {
      const uses = await admin.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_policies
          WHERE (coalesce(qual,'') || ' ' || coalesce(with_check,'')) LIKE '%' || $1 || '%'`,
        [permission_code]
      );
      if (uses.rows[0]!.n === '0') unused.push(permission_code);
    }
    expect(unused, 'a permission code no policy consults is unenforced authority').toEqual([]);
  });

  it('no platform code is reachable through the ordinary tenant permission path', async () => {
    // iam.has_permission resolves through iam.role_permissions, which the
    // bootstrap policy refuses a platform code on. Here the catalogue side is
    // checked: no tenant role anywhere maps one, at rest.
    const mapped = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM iam.role_permissions rp
         JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE p.permission_code LIKE 'platform.%'`
    );
    expect(mapped.rows[0]!.n).toBe('0');

    // And the resolver the control plane uses reads a different relation
    // entirely, so the two authority systems cannot be confused for each other.
    const src = await admin.query<{ def: string }>(
      `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'iam' AND p.proname = 'has_platform_authority'`
    );
    expect(src.rows[0]!.def).toContain('platform_grants');
    expect(src.rows[0]!.def).not.toContain('role_permissions');
  });
});
