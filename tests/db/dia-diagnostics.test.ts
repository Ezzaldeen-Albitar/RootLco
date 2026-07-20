/**
 * Phase 1-9 — Diagnostics: template-version immutability (F3), report pins a
 * published version, mandatory-item completion gate, DTC validation, evidence
 * binding an exact document version (append-only), and review attribution.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  withCommittedTx,
  expectSqlState,
  TENANT_A,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
} from './helpers';
import { ctxA, seedP109Base, makeAuthorizedVisit, newWorkOrder, moveWO } from './p1-09-helpers';

type Q = { query: Client['query'] };
let admin: Pool;
let runtime: Pool;
const scope = [TENANT_A, COMPANY_A1, BRANCH_A1];
const DOC_VER = 'd9a00000-0000-4000-8000-0000000000e1';

async function draftTemplate(
  c: Q,
  mandatory = true
): Promise<{ type: string; ver: string; item: string }> {
  const type = (
    await c.query(
      `INSERT INTO dia.diagnostic_types (scope, tenant_id, code, name, created_by)
       VALUES ('tenant',$1,'fx_dt','Type',$2) RETURNING id`,
      [TENANT_A, USER_A]
    )
  ).rows[0].id;
  const tpl = (
    await c.query(
      `INSERT INTO dia.inspection_templates (tenant_id, code, name, diagnostic_type_id, created_by)
       VALUES ($1,'fx_tpl','Tpl',$2,$3) RETURNING id`,
      [TENANT_A, type, USER_A]
    )
  ).rows[0].id;
  const ver = (
    await c.query(
      `INSERT INTO dia.template_versions (tenant_id, template_id, version_number, created_by)
       VALUES ($1,$2,1,$3) RETURNING id`,
      [TENANT_A, tpl, USER_A]
    )
  ).rows[0].id;
  const item = (
    await c.query(
      `INSERT INTO dia.template_items (tenant_id, template_version_id, item_code, prompt, response_type, is_mandatory, created_by)
       VALUES ($1,$2,'brake_pad','Brake pad mm','text',$3,$4) RETURNING id`,
      [TENANT_A, ver, mandatory, USER_A]
    )
  ).rows[0].id;
  return { type, ver, item };
}

async function reportFor(
  c: Q
): Promise<{ report: string; job: string; type: string; ver: string; item: string }> {
  const visit = await makeAuthorizedVisit(c);
  const wo = await newWorkOrder(c, visit);
  await moveWO(c, wo, 'open');
  await moveWO(c, wo, 'in_progress');
  const job = (
    await c.query(
      `INSERT INTO wo.jobs (tenant_id, company_id, branch_id, work_order_id, title, created_by)
       VALUES ($1,$2,$3,$4,'Diag',$5) RETURNING id`,
      [...scope, wo, USER_A]
    )
  ).rows[0].id;
  const { type, ver, item } = await draftTemplate(c);
  await c.query(`UPDATE dia.template_versions SET status='published' WHERE id=$1`, [ver]);
  const report = (
    await c.query(
      `INSERT INTO dia.diagnostic_reports (tenant_id, company_id, branch_id, work_order_id, job_id, template_version_id, diagnostic_type_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [...scope, wo, job, ver, type, USER_A]
    )
  ).rows[0].id;
  return { report, job, type, ver, item };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seedP109Base(admin);
  runtime = runtimePool();
  // A committed document version for evidence-binding tests.
  await withCommittedTx(admin, ctxA, async (c) => {
    const cat = (
      await c.query(
        `INSERT INTO shared.document_categories
           (scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes, default_classification, default_retention_class, created_by)
         VALUES ('platform',NULL,'fx_dia_ev','Dia evidence',ARRAY['application/pdf'],10485760,'internal','operational',$1) RETURNING id`,
        [USER_A]
      )
    ).rows[0].id;
    const doc = (
      await c.query(
        `INSERT INTO shared.documents (tenant_id, category_id, title, classification, retention_class, created_by)
         VALUES ($1,$2,'Dia doc','internal','operational',$3) RETURNING id`,
        [TENANT_A, cat, USER_A]
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO shared.document_versions
         (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes, sha256, uploaded_by, created_by)
       VALUES ($1,$2,$3,1,'t/1/dia/a','application/pdf',1024,decode('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef','hex'),$4,$4)`,
      [DOC_VER, TENANT_A, doc, USER_A]
    );
  });
});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('dia — template version immutability (F3)', () => {
  it('freezes template items once the version is published', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { ver } = await draftTemplate(c);
      await c.query(`UPDATE dia.template_versions SET status='published' WHERE id=$1`, [ver]);
      await expectSqlState(
        c.query(
          `INSERT INTO dia.template_items (tenant_id, template_version_id, item_code, prompt, response_type, created_by)
           VALUES ($1,$2,'late_item','Late','text',$3)`,
          [TENANT_A, ver, USER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects an invalid version status transition (published -> draft)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { ver } = await draftTemplate(c);
      await c.query(`UPDATE dia.template_versions SET status='published' WHERE id=$1`, [ver]);
      await expectSqlState(
        c.query(`UPDATE dia.template_versions SET status='draft' WHERE id=$1`, [ver]),
        '23514'
      );
    });
  });
});

describe('dia — reports', () => {
  it('a report must pin a PUBLISHED template version', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      await moveWO(c, wo, 'open');
      await moveWO(c, wo, 'in_progress');
      const job = (
        await c.query(
          `INSERT INTO wo.jobs (tenant_id, company_id, branch_id, work_order_id, title, created_by)
           VALUES ($1,$2,$3,$4,'D',$5) RETURNING id`,
          [...scope, wo, USER_A]
        )
      ).rows[0].id;
      const { type, ver } = await draftTemplate(c); // still draft
      await expectSqlState(
        c.query(
          `INSERT INTO dia.diagnostic_reports (tenant_id, company_id, branch_id, work_order_id, job_id, template_version_id, diagnostic_type_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [...scope, wo, job, ver, type, USER_A]
        ),
        '23514'
      );
    });
  });

  it('cannot complete a report while a mandatory item is unanswered; answering it unblocks', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { report, item } = await reportFor(c);
      await c.query(`UPDATE dia.diagnostic_reports SET status='in_progress' WHERE id=$1`, [report]);
      await c.query('SAVEPOINT sp');
      await expectSqlState(
        c.query(`UPDATE dia.diagnostic_reports SET status='completed' WHERE id=$1`, [report]),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT sp');
      await c.query(
        `INSERT INTO dia.report_item_results (tenant_id, company_id, branch_id, diagnostic_report_id, template_item_id, result_value, created_by)
         VALUES ($1,$2,$3,$4,$5,'7mm',$6)`,
        [...scope, report, item, USER_A]
      );
      await c.query(`UPDATE dia.diagnostic_reports SET status='completed' WHERE id=$1`, [report]);
      const { rows } = await c.query(`SELECT status FROM dia.diagnostic_reports WHERE id=$1`, [
        report,
      ]);
      expect(rows[0].status).toBe('completed');
    });
  });

  it('validates DTC code format', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { report } = await reportFor(c);
      await c.query('SAVEPOINT sd');
      await expectSqlState(
        c.query(
          `INSERT INTO dia.dtc_records (tenant_id, company_id, branch_id, diagnostic_report_id, code, created_by)
           VALUES ($1,$2,$3,$4,'notacode',$5)`,
          [...scope, report, USER_A]
        ),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT sd');
      await c.query(
        `INSERT INTO dia.dtc_records (tenant_id, company_id, branch_id, diagnostic_report_id, code, created_by)
         VALUES ($1,$2,$3,$4,'P0300',$5)`,
        [...scope, report, USER_A]
      );
    });
  });

  it('binds evidence to an exact document version and forbids mutation (append-only)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { report } = await reportFor(c);
      await c.query(
        `INSERT INTO dia.diagnostic_evidence (tenant_id, company_id, branch_id, diagnostic_report_id, document_version_id, evidence_type, created_by)
         VALUES ($1,$2,$3,$4,$5,'photo',$6)`,
        [...scope, report, DOC_VER, USER_A]
      );
      await expectSqlState(
        c.query(
          `UPDATE dia.diagnostic_evidence SET evidence_type='x' WHERE diagnostic_report_id=$1`,
          [report]
        ),
        '42501'
      );
    });
  });

  it('server-stamps the reviewer on a diagnostic review', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { report } = await reportFor(c);
      await c.query(
        `INSERT INTO dia.diagnostic_reviews (tenant_id, company_id, branch_id, diagnostic_report_id, review_result)
         VALUES ($1,$2,$3,$4,'approved')`,
        [...scope, report]
      );
      const { rows } = await c.query(
        `SELECT reviewer_id FROM dia.diagnostic_reviews WHERE diagnostic_report_id=$1`,
        [report]
      );
      expect(rows[0].reviewer_id).toBe(USER_A); // stamped from session, not supplied
    });
  });
});
