/**
 * The catalogue discovery the acceptance reset is built from.
 *
 * `P1-26-F-056`: the reset used to carry a hand-written list of seventeen
 * tables, and the list was wrong — it named `iam.audit_events`, which does not
 * exist, so the step was skipped and a reset that reported success left the
 * whole audit trail behind. The database has 232 tenant-scoped tables; a
 * hand-maintained list against that is sampling, not verification.
 *
 * These cases pin the two properties the rewrite rests on: the delete order is
 * derived from real foreign keys, and a scan that has stopped seeing tables is
 * treated as broken rather than as a clean database.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_SCHEMAS,
  MINIMUM_PLAUSIBLE_SCOPED_TABLES,
  OWNED_SCHEMAS,
  STRUCTURAL_REFERENCE,
  childrenFirst,
} from '../../scripts/dev/owner-acceptance/discovery.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const noFakeDataTest = readFileSync(resolve(REPO_ROOT, 'tests/db/no-fake-data.test.ts'), 'utf8');

/**
 * The quoted entries of a delimited group in the test's source.
 *
 * The delimiter is passed explicitly rather than guessed. Guessing looked
 * tidier and was wrong: `new Set([` opens a parenthesis before its bracket, so
 * "whichever opens first" closed on the first `)` — which falls inside a
 * comment — and silently returned five of the eleven entries. A truncated list
 * that still compares as a list is exactly the kind of half-true this file
 * exists to prevent.
 */
function quotedEntries(source: string, after: string, open: '[' | '('): string[] {
  const close = open === '[' ? ']' : ')';
  const from = source.indexOf(after);
  if (from < 0) return [];
  const start = source.indexOf(open, from);
  const end = source.indexOf(close, start);
  if (start < 0 || end < 0) return [];
  return [...source.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

const order = (tables: string[], edges: { child: string; parent: string }[]) =>
  childrenFirst(tables, edges);

const before = (list: string[], a: string, b: string) => list.indexOf(a) < list.indexOf(b);

describe('childrenFirst', () => {
  it('puts a child before its parent', () => {
    const { ordered, cycle } = order(
      ['org.tenants', 'iam.user_accounts'],
      [{ child: 'iam.user_accounts', parent: 'org.tenants' }]
    );
    expect(cycle).toBeNull();
    expect(before(ordered, 'iam.user_accounts', 'org.tenants')).toBe(true);
  });

  it('orders the real acceptance chain the way the database demands', () => {
    // Exactly the edges measured on the live schema. Ninety-two of this
    // database's foreign keys are ON DELETE RESTRICT, so a wrong order is not a
    // slow reset — it is a refused one.
    const edges = [
      { child: 'iam.audit_integrity_links', parent: 'iam.audit_records' },
      { child: 'iam.audit_record_details', parent: 'iam.audit_records' },
      { child: 'iam.audit_records', parent: 'org.tenants' },
      { child: 'iam.grant_scopes', parent: 'iam.role_grants' },
      { child: 'iam.grant_scopes', parent: 'org.branches' },
      { child: 'iam.grant_scopes', parent: 'org.legal_companies' },
      { child: 'iam.login_audit', parent: 'iam.user_accounts' },
      { child: 'iam.role_grants', parent: 'iam.roles' },
      { child: 'iam.role_grants', parent: 'iam.user_accounts' },
      { child: 'iam.role_permissions', parent: 'iam.roles' },
      { child: 'iam.roles', parent: 'org.tenants' },
      { child: 'iam.user_accounts', parent: 'org.tenants' },
      { child: 'iam.user_sessions', parent: 'iam.user_accounts' },
      { child: 'org.branches', parent: 'org.legal_companies' },
      { child: 'org.company_settings', parent: 'org.legal_companies' },
      { child: 'org.legal_companies', parent: 'org.tenants' },
    ];
    const tables = [...new Set(edges.flatMap((e) => [e.child, e.parent]))];
    const { ordered, cycle } = order(tables, edges);

    expect(cycle).toBeNull();
    expect(ordered).toHaveLength(tables.length);
    for (const { child, parent } of edges) {
      expect(before(ordered, child, parent), `${child} must precede ${parent}`).toBe(true);
    }
  });

  it('is deterministic, so two resets produce the same log', () => {
    const edges = [
      { child: 'iam.roles', parent: 'org.tenants' },
      { child: 'iam.user_accounts', parent: 'org.tenants' },
    ];
    const a = order(['org.tenants', 'iam.roles', 'iam.user_accounts'], edges).ordered;
    const b = order(['iam.user_accounts', 'iam.roles', 'org.tenants'], edges).ordered;
    expect(a).toEqual(b);
  });

  it('ignores edges to tables that are not being emptied', () => {
    // Only populated tables are ordered. An edge to something with no acceptance
    // rows must not drag it into the delete set.
    const { ordered, cycle } = order(
      ['iam.roles'],
      [{ child: 'iam.roles', parent: 'org.tenants' }]
    );
    expect(cycle).toBeNull();
    expect(ordered).toEqual(['iam.roles']);
  });

  it('reports a cycle instead of guessing an order', () => {
    // Deleting round a cycle needs a deferred constraint or a deliberate
    // strategy. Picking an order silently would be the same class of mistake as
    // the hand-written list this replaced.
    const { ordered, cycle } = order(
      ['a.one', 'a.two'],
      [
        { child: 'a.one', parent: 'a.two' },
        { child: 'a.two', parent: 'a.one' },
      ]
    );
    expect(cycle).toEqual(['a.one', 'a.two']);
    expect(ordered).not.toHaveLength(2);
  });

  it('a self-reference does not deadlock the sort', () => {
    // `foreignKeyEdges` drops these, but the sort must not depend on that.
    const { ordered, cycle } = order(['a.one'], [{ child: 'a.one', parent: 'a.one' }]);
    expect(cycle).toEqual(['a.one']);
    expect(ordered).toEqual([]);
  });
});

describe('the scan-plausibility floor', () => {
  it('is high enough to catch a broken scan and low enough never to false-alarm', () => {
    // Measured at 232 tenant-scoped tables on the P1-26 schema. A scan that
    // matches almost nothing reports every counter as zero, which is exactly
    // what a clean database reports — the AR-45 shape, where a check that
    // enumerated nothing read as a check that found nothing.
    expect(MINIMUM_PLAUSIBLE_SCOPED_TABLES).toBeGreaterThan(50);
    expect(MINIMUM_PLAUSIBLE_SCOPED_TABLES).toBeLessThan(232);
  });

  it('names every schema the platform owns', () => {
    // A schema missing here is invisible to the reset: its tables are never
    // scanned, so its acceptance rows are never counted and never deleted.
    for (const schema of ['iam', 'org', 'shared', 'crm']) {
      expect(OWNED_SCHEMAS, `${schema} must be scanned`).toContain(schema);
    }
    // Supabase's own schemas are deliberately absent — the reset has no business
    // deleting from `auth`, `storage` or `realtime`.
    for (const foreign of ['auth', 'storage', 'realtime', 'vault', 'supabase_migrations']) {
      expect(OWNED_SCHEMAS, `${foreign} must NOT be scanned`).not.toContain(foreign);
    }
  });
});

describe('the clean-database sweep agrees with the Database tier', () => {
  // `verify-reset` claims the Database tier will see a clean database. That
  // claim is only worth anything if it applies the tier's own rule. Two copies
  // of a list that must agree, with nothing checking that they do, is how they
  // stop agreeing — and the failure would be a verifier that passes while the
  // tier it gates fails.
  it('uses the same structural-reference allow-list', () => {
    const fromTest = quotedEntries(noFakeDataTest, 'const STRUCTURAL_REFERENCE', '[');
    expect(
      fromTest.length,
      'the allow-list must be readable from the test source'
    ).toBeGreaterThanOrEqual(11);
    expect([...STRUCTURAL_REFERENCE].sort()).toEqual([...fromTest].sort());
  });

  it('sweeps the same schemas', () => {
    const fromTest = quotedEntries(noFakeDataTest, 'table_schema IN', '(');
    expect(
      fromTest.length,
      'the schema list must be readable from the test source'
    ).toBeGreaterThanOrEqual(17);
    expect([...BUSINESS_SCHEMAS].sort()).toEqual([...fromTest].sort());
  });
});
