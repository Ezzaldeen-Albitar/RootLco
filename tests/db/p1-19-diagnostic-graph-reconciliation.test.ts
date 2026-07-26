/**
 * P1-19 diagnostic-report graph reconciliation (P1-19-BE-011).
 *
 * `REPORT_TRANSITIONS` in the `diagnostics` domain layer MIRRORS
 * `dia.guard_diagnostic_report_transition`, and the domain file claims — in prose —
 * that "a reconciliation test pins this object against the DEPLOYED function body, so
 * an edit to the trigger that this does not follow fails the build rather than
 * silently making the API lie."
 *
 * This is that test.
 *
 * ## Why mirroring is legitimate HERE and not in `work-order`
 *
 * The work-order and job graphs live in `wo.work_order_transitions` and
 * `wo.job_transitions`: tenant-overridable catalog TABLES. A TypeScript copy of those
 * would refuse a tenant's own edge and drift the moment one was added, which is why
 * that module reads them and keeps no copy.
 *
 * This graph is a fixed PL/pgSQL `IF` chain with no catalog table and no override — it
 * is code, and code can be mirrored. But a mirror is only as good as the thing that
 * keeps it honest, and without this test the distinction would be a story rather than a
 * property: an edge added to the guard, or one removed from it, would leave every test
 * green while `GET /inspections/{id}` advertised moves that are guaranteed to fail.
 *
 * It reads the DEPLOYED function body rather than the migration file, because the
 * deployed body is what runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { REPORT_STATUSES, REPORT_TRANSITIONS } from '@/modules/diagnostics';
import { adminPool } from './helpers';

let admin: Pool;
let transitionBody: string;
let refsBody: string;

beforeAll(async () => {
  admin = adminPool();
  const load = async (name: string): Promise<string> => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_functiondef(p.oid) AS def
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'dia' AND p.proname = $1`,
      [name]
    );
    return rows[0]?.def ?? '';
  };
  transitionBody = await load('guard_diagnostic_report_transition');
  refsBody = await load('guard_diagnostic_report_refs');
});
afterAll(async () => {
  await admin.end();
});

describe('the mirrored report graph reconciles with the deployed guard', () => {
  it('finds the guard deployed at all', () => {
    expect(transitionBody).not.toBe('');
    expect(refsBody).not.toBe('');
  });

  it('mirrors exactly the edges the guard permits', () => {
    // The guard's condition, verbatim from the migration:
    //   (OLD.status = 'draft'       AND NEW.status IN ('in_progress', 'cancelled'))
    //   OR (OLD.status = 'in_progress' AND NEW.status IN ('completed', 'cancelled'))
    // Asserted against the deployed text rather than re-parsed, because a parser for
    // PL/pgSQL would be a second thing to keep correct.
    expect(transitionBody).toMatch(
      /OLD\.status\s*=\s*'draft'\s*AND\s*NEW\.status\s*IN\s*\('in_progress',\s*'cancelled'\)/
    );
    expect(transitionBody).toMatch(
      /OLD\.status\s*=\s*'in_progress'\s*AND\s*NEW\.status\s*IN\s*\('completed',\s*'cancelled'\)/
    );

    expect([...(REPORT_TRANSITIONS['draft'] ?? [])].sort()).toEqual(['cancelled', 'in_progress']);
    expect([...(REPORT_TRANSITIONS['in_progress'] ?? [])].sort()).toEqual([
      'cancelled',
      'completed',
    ]);
  });

  it('keeps both terminal statuses terminal', () => {
    // The guard names `draft` and `in_progress` as the only legal SOURCES, so anything
    // else has no outbound edge. A mirror that gave `completed` an edge would advertise
    // a reopening the guard refuses — and BR-WO-002's no-reopen rule is the same
    // principle one level up.
    expect(REPORT_TRANSITIONS['completed']).toEqual([]);
    expect(REPORT_TRANSITIONS['cancelled']).toEqual([]);
    expect(transitionBody).not.toMatch(/OLD\.status\s*=\s*'completed'/);
    expect(transitionBody).not.toMatch(/OLD\.status\s*=\s*'cancelled'/);
  });

  it('covers every status the CHECK vocabulary allows, and no other', () => {
    // A status in the vocabulary but absent from the mirror would read as "no edges"
    // and silently refuse a move the guard permits; one in the mirror but not in the
    // vocabulary could never be reached at all.
    expect(Object.keys(REPORT_TRANSITIONS).sort()).toEqual([...REPORT_STATUSES].sort());
    for (const targets of Object.values(REPORT_TRANSITIONS)) {
      for (const target of targets) expect(REPORT_STATUSES).toContain(target);
    }
  });

  it('confirms the completion gate is the guard’s, not the application’s', () => {
    // The service pre-reports outstanding mandatory items so a caller learns all of
    // them at once. That is a REPORTER: the deployed guard re-counts them inside the
    // same statement as the write, and this pins that it still does.
    expect(transitionBody).toMatch(/NEW\.status\s*=\s*'completed'/);
    expect(transitionBody).toMatch(/dia\.template_items/);
    expect(transitionBody).toMatch(/is_mandatory/);
    expect(transitionBody).toMatch(/dia\.report_item_results/);
    // Answered means a value OR a documented not-applicable reason.
    expect(transitionBody).toMatch(
      /result_value IS NOT NULL OR r\.not_applicable_reason IS NOT NULL/
    );
    // Against the report's PINNED version, never the template's current one.
    expect(transitionBody).toMatch(/ti\.template_version_id\s*=\s*NEW\.template_version_id/);
  });

  it('confirms creation still requires a published version and a job on the work order', () => {
    // The two preconditions the create service pre-checks in order to distinguish
    // them; the guard raises one `check_violation` for both.
    expect(refsBody).toMatch(/wo\.jobs/);
    expect(refsBody).toMatch(/does not belong to work order/);
    expect(refsBody).toMatch(/'published'/);
  });
});
