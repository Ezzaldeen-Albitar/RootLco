/**
 * P1-19 closure-blocker reconciliation (P1-19-BE-001).
 *
 * `CLOSURE_BLOCKER_REGISTRY` mirrors `wo.guard_work_order_closure()`, and the
 * work-order domain file claims — in prose — that "a test reconciles these codes
 * against the live function body, so an edit to the trigger that this list does
 * not follow fails the build rather than silently making the endpoint lie."
 *
 * This is that test. Without it the claim was false: the only registry coverage
 * compared the registry to hardcoded literals, which is the registry agreeing with
 * itself. A B7 added to the guard, or a B3 deleted from it, would have left every
 * test green while `GET /closure-eligibility` reported a set of blockers that no
 * longer matched what actually refuses closure.
 *
 * It reads the deployed function body rather than the migration file, because the
 * deployed body is what runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { CLOSURE_BLOCKERS, CLOSURE_BLOCKER_REGISTRY } from '@/modules/work-order';
import { adminPool } from './helpers';

let admin: Pool;
let body: string;

beforeAll(async () => {
  admin = adminPool();
  const { rows } = await admin.query<{ def: string }>(
    `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'wo' AND p.proname = 'guard_work_order_closure'`
  );
  body = rows[0]?.def ?? '';
});
afterAll(async () => {
  await admin.end();
});

describe('P1-19 closure-blocker registry reconciles with the deployed guard', () => {
  it('finds the guard deployed', () => {
    expect(body.length).toBeGreaterThan(0);
  });

  it('raises exactly the blocker codes the registry declares, and no others', () => {
    // Every blocker in the guard announces itself as "closure blocked (Bn)". The
    // set of codes it can raise must equal the set the registry publishes.
    const raised = [...body.matchAll(/closure blocked \((B\d)\)/g)].map((m) => m[1]);
    const distinct = [...new Set(raised)].sort();
    expect(distinct).toEqual([...CLOSURE_BLOCKERS].sort());
    expect(distinct).toEqual(CLOSURE_BLOCKER_REGISTRY.map((b) => b.code).sort());
  });

  it('names this guard as the enforcer of every registry entry', () => {
    for (const blocker of CLOSURE_BLOCKER_REGISTRY) {
      expect(blocker.enforcedBy).toBe('wo.guard_work_order_closure');
    }
  });

  it('still gates the blockers behind terminal, and still exempts cancellation', () => {
    // Two preconditions the registry does NOT carry, pinned here so a reporter
    // built from the registry alone cannot silently start claiming blockers
    // against a transition the database would allow.
    //
    // The guard returns early when the target state is not terminal, and again
    // when it is a cancellation. So `→ cancelled` is never blocked by B1-B6, and
    // Wave 4's eligibility endpoint must not report blockers for it.
    expect(body).toMatch(/IF v_terminal IS NOT TRUE THEN\s+RETURN NEW;/);
    expect(body).toMatch(/IF v_cancel THEN\s+RETURN NEW;/);
  });

  it('raises check_violation for every blocker, which is what the mappers expect', () => {
    const raises = [...body.matchAll(/closure blocked \(B\d\)[\s\S]*?ERRCODE = '([a-z_]+)'/g)].map(
      (m) => m[1]
    );
    // SEVEN raises for SIX codes, and that is not a miscount: B5 is two separate
    // `IF EXISTS` blocks sharing one label — a failed record with no pass (B5a),
    // and a configured mandatory check with no pass (B5b). `QualityGateService`
    // reports those two halves separately for exactly this reason, so a caller
    // can tell "quality control failed" from "a mandatory check never ran".
    expect(raises.length).toBe(CLOSURE_BLOCKERS.length + 1);
    for (const code of raises) expect(code).toBe('check_violation');
  });

  it('splits B5 into its two halves and leaves every other blocker single', () => {
    const perCode = new Map<string, number>();
    for (const match of body.matchAll(/closure blocked \((B\d)\)/g)) {
      perCode.set(match[1]!, (perCode.get(match[1]!) ?? 0) + 1);
    }
    expect(perCode.get('B5')).toBe(2);
    for (const code of ['B1', 'B2', 'B3', 'B4', 'B6']) {
      expect(perCode.get(code), `${code} should raise from exactly one site`).toBe(1);
    }
  });

  it('contains no reservation or part-issue blocker', () => {
    // The phase brief asked for both. Neither exists, because stock reservation
    // and issue execution are Phase 1-21. `DEFERRED_CLOSURE_BLOCKERS` records
    // them as deferred; this asserts the guard really has not grown one behind
    // that record's back.
    expect(body).not.toMatch(/inv\./);
    expect(body).not.toMatch(/reservation/i);
    expect(body).not.toMatch(/part_issue|part issue/i);
  });
});
