/**
 * P1-19 vocabulary and permission reconciliation (P1-19-BE-001).
 *
 * Two claims this wave makes in prose, made checkable here.
 *
 * 1. Every frozen vocabulary in the four modules says in its docblock that it was
 *    "read from `pg_constraint`". Nothing kept it there: the foundation suite
 *    compares each constant to a literal in its own file, which pins
 *    constant-vs-test drift and not constant-vs-schema drift. Four of these were
 *    wrong when written and would have reached PostgreSQL as `23514`; this is what
 *    stops a future edit putting them back.
 *
 * 2. The permission codes in this wave's four domains had no by-name coverage —
 *    only a catalog TOTAL,
 *    which is blind to a typo. Ship `wo.work_order.tranistion` and the count is
 *    still right, while every principal is denied once Wave 4 requires the correct
 *    spelling. P1-15 asserted its own two codes by name; this does the same, for
 *    every code the seed declares across the four domains.
 *
 *    The list those cases run over is READ FROM THE SEED rather than restated
 *    here. It was restated once, and adding a single code to the seed stale-dated
 *    it while every local gate stayed green — the defect
 *    `scripts/ci/check-p1-27-doc-counts.mjs` exists to end: a value written by
 *    hand that nothing recomputes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  ADDITIONAL_WORK_STATES,
  FULFILLMENT_STATES,
  PARTS_FORWARD_STATES,
  WORK_ORDER_KINDS,
} from '@/modules/work-order';
import { AVAILABILITY_KINDS, CERTIFICATION_STATUSES, LABOR_SOURCES } from '@/modules/technician';
import {
  DTC_STATUSES,
  FINDING_DISPOSITIONS,
  FINDING_SEVERITIES,
  RECOMMENDATION_PRIORITIES,
  REPORT_STATUSES,
  RESPONSE_TYPES,
  REVIEW_RESULTS,
  TEMPLATE_VERSION_STATUSES,
} from '@/modules/diagnostics';
import { QC_CHECK_RESULTS, QC_OVERALL_RESULTS } from '@/modules/quality';
import { adminPool, readSeededPermissionCatalog } from './helpers';

let admin: Pool;

beforeAll(async () => {
  admin = adminPool();
});
afterAll(async () => {
  await admin.end();
});

/**
 * Values a `col = ANY (ARRAY[...])` CHECK admits.
 *
 * Qualified by RELATION, not by constraint name alone. Constraint names are unique
 * only per table, and this test found that out the hard way: `ck_template_versions_status`
 * exists twice — on `shared.template_versions` (draft/approved/retired, P1-15) and on
 * `dia.template_versions` (draft/published/retired, P1-09). Looking up by name alone
 * returned the wrong one and reported a correct vocabulary as wrong.
 */
async function allowed(pool: Pool, relation: string, constraint: string): Promise<string[]> {
  const { rows } = await pool.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = $1 AND conrelid = $2::regclass`,
    [constraint, relation]
  );
  const def = rows[0]?.def ?? '';
  return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1] as string);
}

const VOCABULARIES: readonly (readonly [string, string, readonly string[]])[] = [
  ['wo.work_orders', 'ck_work_orders_kind', WORK_ORDER_KINDS],
  ['wo.work_orders', 'ck_work_orders_parts_forward_state', PARTS_FORWARD_STATES],
  ['wo.additional_work_requests', 'ck_additional_work_requests_state', ADDITIONAL_WORK_STATES],
  ['wo.additional_work_requests', 'ck_additional_work_requests_fulfillment', FULFILLMENT_STATES],
  ['tech.labor_sessions', 'ck_labor_sessions_source', LABOR_SOURCES],
  ['tech.technician_certifications', 'ck_technician_certifications_status', CERTIFICATION_STATUSES],
  ['tech.technician_availability', 'ck_technician_availability_kind', AVAILABILITY_KINDS],
  ['dia.diagnostic_reports', 'ck_diagnostic_reports_status', REPORT_STATUSES],
  ['dia.template_versions', 'ck_template_versions_status', TEMPLATE_VERSION_STATUSES],
  ['dia.template_items', 'ck_template_items_response_type', RESPONSE_TYPES],
  ['dia.findings', 'ck_findings_severity', FINDING_SEVERITIES],
  ['dia.findings', 'ck_findings_disposition', FINDING_DISPOSITIONS],
  ['dia.dtc_records', 'ck_dtc_records_status', DTC_STATUSES],
  ['dia.recommendations', 'ck_recommendations_priority', RECOMMENDATION_PRIORITIES],
  ['dia.diagnostic_reviews', 'ck_diagnostic_reviews_result', REVIEW_RESULTS],
  ['qms.quality_control_records', 'ck_quality_control_records_result', QC_OVERALL_RESULTS],
  ['qms.qc_check_results', 'ck_qc_check_results_result', QC_CHECK_RESULTS],
];

describe('P1-19 vocabularies reconcile with the live CHECK constraints', () => {
  it.each(VOCABULARIES)(
    '%s.%s admits exactly the declared vocabulary',
    async (relation, name, declared) => {
      const live = await allowed(admin, relation, name);
      expect(
        live.length,
        `${relation}.${name} was not found or is not an ANY(ARRAY) check`
      ).toBeGreaterThan(0);
      expect([...live].sort()).toEqual([...declared].sort());
    }
  );
});

/** The four domains this wave introduced. */
const P1_19_DOMAINS = ['wo', 'tech', 'dia', 'qms'] as const;

/**
 * Every code the seed declares in P1-19's four DOMAINS, read from the seed.
 *
 * ## Domain-scoped, not phase-scoped — and the difference is load-bearing
 *
 * P1-19 introduced these four domains, and for four phases it was also the only
 * contract that had seeded a code into them, so "the P1-19 codes" and "the codes
 * in the P1-19 domains" named the same set and nothing had to choose. They are
 * different sets now: PRE-P1-29-BR-03 seeded `tech.technician.manage` into
 * `tech`, because the technician roster shipped with reads only and eleven new
 * administration operations could not be gated by `tech.technician.read`.
 *
 * The QUERY below is domain-scoped, so this list must be too or the "and no
 * others" claim is simply false. What it must NOT do is let that scoping quietly
 * restate itself as provenance: nothing here says P1-19 seeded these codes, and
 * the cases below are titled for the domains rather than for the phase.
 * `scripts/p1-19-endpoint-inventory.mjs` refuses the same conflation from the
 * other side — it will not let a successor borrow a `P1-19-BE` task identifier
 * for work P1-19 did not do — and this file is the register a reader consults to
 * find out who seeded what.
 *
 * This was an exhaustive hand-written list of twenty-two `[code, domain, risk]`
 * triples, which is a second copy of `04_iam_permission_catalog.sql` that
 * nothing kept in step with the first. It is derived now, so a seed change moves
 * the expectation by construction rather than by somebody remembering.
 *
 * Deriving it does NOT make the cases below compare the database to itself: the
 * seed file declares, and the database is asked what it actually holds. A code
 * the seed declares that the database lacks, a code the database holds that the
 * seed does not declare, and a domain or risk level that differs between them
 * all still fail. `readSeededPermissionCatalog` records what derivation
 * deliberately gives up and which suites hold that direction instead.
 *
 * Sorted by codepoint, and the database side is sorted the same way at the point
 * of comparison, so neither assertion depends on the server's collation.
 */
const PERMISSIONS: readonly (readonly [string, string, string])[] = readSeededPermissionCatalog()
  .filter((permission) => (P1_19_DOMAINS as readonly string[]).includes(permission.domain))
  .map(
    (permission) =>
      [permission.permissionCode, permission.domain, permission.riskLevel] as [
        string,
        string,
        string,
      ]
  )
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

describe('the permission codes in P1-19’s four domains are seeded exactly once each', () => {
  it('derives a real slice of the catalogue, so the cases below are not vacuous', () => {
    // The floor guards the derivation itself. An EMPTY table would at least be
    // refused by the runner ("No test found in suite"), but a TRUNCATED parse
    // would not: it would quietly run fewer by-name cases below and stay green,
    // which is the failure mode a derived expectation has and a literal does
    // not. A FLOOR, not the count — pinning the exact number here would
    // reinstate the hand-maintained value this file just dropped.
    expect(PERMISSIONS.length).toBeGreaterThan(15);

    // A code repeated in the seed is swallowed by its own
    // `ON CONFLICT (permission_code) DO NOTHING`, so the database would hold one
    // row for two declarations and the count comparison below would be the only
    // thing that noticed. Name it here, where the failure says what is wrong.
    const codes = PERMISSIONS.map(([code]) => code);
    const duplicates = codes.filter((code, at) => codes.indexOf(code) !== at);
    expect(duplicates, 'the seed declares these codes more than once').toEqual([]);

    // Every parsed row is a real catalogue row and not a fragment of the seed's
    // own commentary, which quotes codes and risk levels in the same shape.
    for (const [code, domain, risk] of PERMISSIONS) {
      expect(code.startsWith(`${domain}.`), `${code} is not in domain ${domain}`).toBe(true);
      expect(['low', 'medium', 'high', 'critical']).toContain(risk);
    }
  });

  it.each(PERMISSIONS)(
    '%s exists once with the declared domain and risk',
    async (code, domain, risk) => {
      const { rows } = await admin.query<{ n: string; domain: string; risk_level: string }>(
        `SELECT count(*)::text AS n, min(domain) AS domain, min(risk_level) AS risk_level
           FROM iam.permissions WHERE permission_code = $1`,
        [code]
      );
      expect(Number(rows[0]?.n)).toBe(1);
      expect(rows[0]?.domain).toBe(domain);
      expect(rows[0]?.risk_level).toBe(risk);
    }
  );

  it('holds exactly the codes the seed declares, and no others, across those four domains', async () => {
    const { rows } = await admin.query<{ permission_code: string }>(
      `SELECT permission_code FROM iam.permissions WHERE domain = ANY($1::text[])`,
      [[...P1_19_DOMAINS]]
    );
    expect(rows.map((row) => row.permission_code).sort()).toEqual(
      PERMISSIONS.map(([code]) => code)
    );
  });

  it('separates recording quality control from finalizing it', async () => {
    // Finalizing as `passed` is the act that clears closure blocker B5 and releases
    // the vehicle. An earlier seed collapsed both into one
    // `qms.quality_control.perform`, which would have let a clerk authorized only to
    // record observations sign the vehicle out — the same separation this catalog
    // already makes for transition-vs-close and request-vs-approve.
    const { rows } = await admin.query<{ permission_code: string }>(
      `SELECT permission_code FROM iam.permissions
        WHERE permission_code IN ('qms.quality_control.record',
                                  'qms.quality_control.finalize',
                                  'qms.quality_control.perform')
        ORDER BY permission_code`
    );
    expect(rows.map((row) => row.permission_code)).toEqual([
      'qms.quality_control.finalize',
      'qms.quality_control.record',
    ]);
  });
});
