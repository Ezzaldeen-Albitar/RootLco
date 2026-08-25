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
 * 2. The 22 new permission codes had no by-name coverage — only a catalog TOTAL,
 *    which is blind to a typo. Ship `wo.work_order.tranistion` and the count is
 *    still right, while every principal is denied once Wave 4 requires the correct
 *    spelling. P1-15 asserted its own two codes by name; this does the same.
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
import { adminPool } from './helpers';

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

/**
 * The codes P1-19 itself seeded across its four domains.
 *
 * Kept SEPARATE from the successor list below rather than merged into one array,
 * for the same reason `scripts/p1-19-endpoint-inventory.mjs` refuses to let a
 * later contract borrow a `P1-19-BE` task identifier: folding a successor’s code
 * in here would make this file say P1-19 seeded something it did not, and this
 * file is the register a reader consults to find out.
 */
const P1_19_PERMISSIONS: readonly (readonly [string, string, string])[] = [
  ['dia.diagnostic.complete', 'dia', 'medium'],
  ['dia.diagnostic.read', 'dia', 'low'],
  ['dia.diagnostic.record', 'dia', 'medium'],
  ['dia.diagnostic.review', 'dia', 'high'],
  ['qms.quality_control.finalize', 'qms', 'high'],
  ['qms.quality_control.read', 'qms', 'low'],
  ['qms.quality_control.record', 'qms', 'medium'],
  ['qms.rework.manage', 'qms', 'high'],
  ['qms.rework.sign_off', 'qms', 'high'],
  ['tech.assignment.manage', 'tech', 'medium'],
  ['tech.labor.correct', 'tech', 'high'],
  ['tech.labor.record', 'tech', 'low'],
  ['tech.technician.read', 'tech', 'low'],
  ['wo.additional_work.approve', 'wo', 'high'],
  ['wo.additional_work.request', 'wo', 'medium'],
  ['wo.job.manage', 'wo', 'medium'],
  ['wo.job.transition', 'wo', 'medium'],
  ['wo.work_order.close', 'wo', 'high'],
  ['wo.work_order.create', 'wo', 'high'],
  ['wo.work_order.line.manage', 'wo', 'medium'],
  ['wo.work_order.read', 'wo', 'low'],
  ['wo.work_order.transition', 'wo', 'medium'],
];

/**
 * Codes seeded into P1-19’s four domains by a LATER contract.
 *
 * `tech.technician.manage` is PRE-P1-29-BR-03’s: the technician roster shipped in
 * P1-19 with reads only, so there was no write path to gate and no reason for the
 * code to exist. Eleven operations now administer profiles, held skills, held
 * certifications and availability windows, and none of them could be gated by
 * `tech.technician.read` — reading a roster is not administering one.
 *
 * Naming it here is what keeps the assertion below EXHAUSTIVE. Without it the
 * “and no others” claim would simply be false, and the honest repair is to record
 * the owner rather than to widen the query or drop the claim.
 */
const SUCCESSOR_PERMISSIONS: readonly (readonly [string, string, string])[] = [
  ['tech.technician.manage', 'tech', 'medium'],
];

/**
 * Every code the four domains should hold, whoever seeded it, in the QUERY’s order.
 *
 * Sorted by code point rather than with `localeCompare`, because the comparison
 * below is against `ORDER BY permission_code` in PostgreSQL. `localeCompare`
 * applies locale collation, which weights `.` and `_` differently from a plain
 * byte order and could therefore disagree with the database on a pair these codes
 * do not currently contain but easily might. The hand-written list this replaces
 * was already in code-point order and matched the database, so this reproduces it
 * exactly rather than approximating it.
 */
const PERMISSIONS: readonly (readonly [string, string, string])[] = [
  ...P1_19_PERMISSIONS,
  ...SUCCESSOR_PERMISSIONS,
].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

describe('P1-19 permission codes are seeded exactly once each', () => {
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

  it('adds exactly these codes and no others across the four P1-19 domains', async () => {
    const { rows } = await admin.query<{ permission_code: string }>(
      `SELECT permission_code FROM iam.permissions
        WHERE domain IN ('wo','tech','dia','qms') ORDER BY permission_code`
    );
    expect(rows.map((row) => row.permission_code)).toEqual(PERMISSIONS.map(([code]) => code));
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
