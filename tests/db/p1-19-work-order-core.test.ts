/**
 * P1-19 Wave 4 work-order core, against the real protected schema
 * (P1-19-BE-003…005).
 *
 * These assert the two facts the closure reporter depends on and that no
 * TypeScript test can establish on its own:
 *
 *  1. the structural blocker query really transcribes the guard's B1–B4
 *     predicates — same tables, same columns, same nullability handling — so a
 *     schema change breaks the test rather than silently making the endpoint lie;
 *  2. the guard's gating behaviour (terminal-only, cancellation-exempt) is what
 *     the service assumes.
 *
 * They are database tests rather than backend tests because what is under
 * examination is the agreement between a query and a deployed function, not a
 * request path. Wave 4's API tests arrive with the route handlers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool } from './helpers';

let admin: Pool;
let guard: string;

beforeAll(async () => {
  admin = adminPool();
  const { rows } = await admin.query<{ def: string }>(
    `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'wo' AND p.proname = 'guard_work_order_closure'`
  );
  guard = rows[0]?.def ?? '';
});
afterAll(async () => {
  await admin.end();
});

describe('P1-19 closure predicates match the deployed guard', () => {
  it('B1 examines wo.jobs against wo.job_states.is_terminal', () => {
    // The service reports B1 from a NOT EXISTS over job_states with is_terminal.
    // If the guard ever changed to a column on wo.jobs instead, the query would
    // keep answering the old question.
    expect(guard).toMatch(/FROM wo\.jobs/);
    expect(guard).toMatch(/wo\.job_states/);
    expect(guard).toMatch(/js\.is_terminal/);
  });

  it('B2 examines tech.labor_sessions for an open-ended session', () => {
    expect(guard).toMatch(/tech\.labor_sessions/);
    expect(guard).toMatch(/ls\.ended_at IS NULL/);
  });

  it('B3 examines only REQUIRED additional work, pending or approved-unfulfilled', () => {
    // `is_required` is what makes B3 narrow. A reporter that dropped it would
    // block closure on optional extras the workshop deliberately left unresolved.
    expect(guard).toMatch(/wo\.additional_work_requests/);
    expect(guard).toMatch(/r\.is_required/);
    expect(guard).toMatch(/'pending'/);
    expect(guard).toMatch(/'approved'/);
    expect(guard).toMatch(/'unfulfilled'/);
  });

  it('B4 examines requires_diagnostic jobs for a completed report', () => {
    expect(guard).toMatch(/j\.requires_diagnostic/);
    expect(guard).toMatch(/dia\.diagnostic_reports/);
    expect(guard).toMatch(/d\.status = 'completed'/);
  });

  it('evaluates nothing unless the TARGET state is terminal', () => {
    expect(guard).toMatch(/IF v_terminal IS NOT TRUE THEN\s+RETURN NEW;/);
  });

  it('exempts cancellation entirely', () => {
    // A reporter that ignored this would list blockers against a `→ cancelled`
    // transition the database would have allowed.
    expect(guard).toMatch(/IF v_cancel THEN\s+RETURN NEW;/);
  });
});

describe('P1-19 job creation preconditions live in the database', () => {
  it('guard_job_refs locks the parent and refuses a terminal or job-refusing state', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_functiondef(p.oid) AS def
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'wo' AND p.proname = 'guard_job_refs'`
    );
    const def = rows[0]?.def ?? '';
    expect(def.length).toBeGreaterThan(0);
    // The FOR UPDATE is what makes a job insert serialise against a concurrent
    // close rather than race it, so the service must not re-implement the check
    // outside a transaction and believe it has the same guarantee.
    expect(def).toMatch(/FROM wo\.work_orders[\s\S]*?FOR UPDATE/);
    expect(def).toMatch(/cannot add a job to a terminal work order/);
    expect(def).toMatch(/does not allow jobs/);
  });

  it('leaves the job state vocabulary entirely to wo.job_states', async () => {
    // `wo.jobs.state` carries only a FORMAT check — no value list. That is why the
    // service resolves the initial state from the catalog instead of defaulting to
    // a literal, and why a tenant may shadow the vocabulary.
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'wo.jobs'::regclass AND conname = 'ck_jobs_state_format'`
    );
    expect(rows[0]?.def).toMatch(/~ '\^\[a-z\]/);
    const { rows: anyList } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_constraint
        WHERE conrelid = 'wo.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%ANY (ARRAY%'`
    );
    expect(Number(anyList[0]?.n)).toBe(0);
  });

  it('ties a job to its work order by the composite scope key', async () => {
    // The FK is on (tenant, company, branch, work_order_id), not on the id alone,
    // so a job cannot be attached to a work order in another company or branch.
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'wo.jobs'::regclass AND conname = 'fk_jobs_work_order'`
    );
    expect(rows[0]?.def).toMatch(/FOREIGN KEY \(tenant_id, company_id, branch_id, work_order_id\)/);
  });
});
