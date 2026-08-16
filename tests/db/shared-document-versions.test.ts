/**
 * Phase 1-5 Increment B — shared.document_versions / shared.file_scan_results
 * (P1-05-DB-003, P1-05-DB-004).
 *
 * Append-only version metadata with a controlled one-way lifecycle: a version is
 * accepted only after a clean scan and with no infected scan; terminal states are
 * immutable; content columns are immutable; storage_key is inert metadata. Scan
 * history is append-only. Isolation runs as the non-owner runtime login.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  TENANT_A,
  TENANT_B,
  USER_A,
  withCommittedTx,
  withRolledBackTx,
} from './helpers';

const ACTOR = USER_A;
const SHA = "decode('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex')";

const CAT = 'd1000000-0000-4000-8000-000000000001';
const DOC = 'd1c00000-0000-4000-8000-00000000000a';
const VER = 'd1e00000-0000-4000-8000-00000000000a';

let admin: Pool;
let runtime: Pool;

/** Insert a fresh pending version for DOC, returning its id (rolled-back-tx safe). */
const insertVersion = (
  c: { query: Pool['query'] },
  n: number,
  tenant = TENANT_A,
  documentId = DOC
) =>
  c.query(
    `INSERT INTO shared.document_versions
       (tenant_id, document_id, version_number, storage_key, content_type, size_bytes, sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,$4,'application/pdf',1024,${SHA},$5,$5) RETURNING id`,
    [tenant, documentId, n, `tenant/${n}/doc/object_${n}`, ACTOR]
  );

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  await withCommittedTx(admin, {}, async (c) => {
    await c.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types,
          max_size_bytes, default_classification, default_retention_class, created_by)
       VALUES ($1,'platform',NULL,'fx_docs_versions','Versions fixture',
               ARRAY['application/pdf'],10485760,'internal','operational',$2)`,
      [CAT, ACTOR]
    );
    await c.query(
      `INSERT INTO shared.documents (id, tenant_id, category_id, title, classification, retention_class, created_by)
       VALUES ($1,$2,$3,'Versioned doc','internal','operational',$4)`,
      [DOC, TENANT_A, CAT, ACTOR]
    );
    await c.query(
      `INSERT INTO shared.document_versions
         (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes, sha256, uploaded_by, created_by)
       VALUES ($1,$2,$3,1,'tenant/1/doc/object_1','application/pdf',2048,${SHA},$4,$4)`,
      [VER, TENANT_A, DOC, ACTOR]
    );
  });
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('shared.document_versions — append-only, gated lifecycle', () => {
  it('a new version is pending with no terminal timestamps', async () => {
    const { rows } = await admin.query(
      `SELECT status, accepted_at, quarantined_at, rejected_at FROM shared.document_versions WHERE id=$1`,
      [VER]
    );
    expect(rows[0]).toEqual({
      status: 'pending',
      accepted_at: null,
      quarantined_at: null,
      rejected_at: null,
    });
  });

  it('version_number is unique per document', async () => {
    await withRolledBackTx(admin, {}, (c) => expectSqlState(insertVersion(c, 1), '23505'));
  });

  it('rejects a bad sha length, content_type, storage_key, and non-positive size', async () => {
    const bad = (sql: string, params: unknown[]) =>
      withRolledBackTx(admin, {}, (c) => expectSqlState(c.query(sql, params), '23514'));
    const base = `INSERT INTO shared.document_versions
       (tenant_id, document_id, version_number, storage_key, content_type, size_bytes, sha256, uploaded_by, created_by)`;
    await bad(
      `${base} VALUES ($1,$2,9,'tenant/9/x','application/pdf',10,decode('00','hex'),$3,$3)`,
      [TENANT_A, DOC, ACTOR]
    ); // sha not 32 bytes
    await bad(`${base} VALUES ($1,$2,9,'tenant/9/x','PDF',10,${SHA},$3,$3)`, [
      TENANT_A,
      DOC,
      ACTOR,
    ]); // bad mime
    await bad(`${base} VALUES ($1,$2,9,'has space','application/pdf',10,${SHA},$3,$3)`, [
      TENANT_A,
      DOC,
      ACTOR,
    ]); // bad storage_key
    await bad(`${base} VALUES ($1,$2,9,'tenant/9/ok','application/pdf',0,${SHA},$3,$3)`, [
      TENANT_A,
      DOC,
      ACTOR,
    ]); // zero size
  });

  it('rejects a version whose (tenant, document) crosses tenants (composite FK)', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(insertVersion(c, 9, TENANT_B, DOC), '23503')
    );
  });

  it('cannot go straight from pending to accepted, however clean the scan', async () => {
    // P1-OD-025. The clean verdict is present, so the ONLY thing refusing the
    // update is the requirement to pass through scanning first.
    await withRolledBackTx(admin, {}, async (c) => {
      const v = await insertVersion(c, 19);
      const id = v.rows[0].id;
      await c.query(
        `INSERT INTO shared.file_scan_results (tenant_id, version_id, scan_status, scanner_code, created_by)
         VALUES ($1,$2,'clean','clamav',$3)`,
        [TENANT_A, id, ACTOR]
      );
      await expectSqlState(
        c.query(`UPDATE shared.document_versions SET status='accepted' WHERE id=$1`, [id]),
        '23514'
      );
    });
  });

  it('cannot be accepted without a clean scan', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const v = await insertVersion(c, 20);
      await c.query(`UPDATE shared.document_versions SET status='scanning' WHERE id=$1`, [
        v.rows[0].id,
      ]);
      await expectSqlState(
        c.query(`UPDATE shared.document_versions SET status='accepted' WHERE id=$1`, [
          v.rows[0].id,
        ]),
        '23514'
      );
    });
  });

  it('cannot be accepted on an error verdict alone — a scan that failed is not a clean scan', async () => {
    // The rule the decision states as "scanner failure must not auto-accept".
    await withRolledBackTx(admin, {}, async (c) => {
      const v = await insertVersion(c, 25);
      const id = v.rows[0].id;
      await c.query(
        `INSERT INTO shared.file_scan_results (tenant_id, version_id, scan_status, scanner_code, created_by)
         VALUES ($1,$2,'error','clamav',$3)`,
        [TENANT_A, id, ACTOR]
      );
      await c.query(`UPDATE shared.document_versions SET status='scanning' WHERE id=$1`, [id]);
      await expectSqlState(
        c.query(`UPDATE shared.document_versions SET status='accepted' WHERE id=$1`, [id]),
        '23514'
      );
    });
  });

  it('cannot be accepted while an infected scan exists', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const v = await insertVersion(c, 21);
      const id = v.rows[0].id;
      await c.query(
        `INSERT INTO shared.file_scan_results (tenant_id, version_id, scan_status, scanner_code, created_by)
         VALUES ($1,$2,'clean','clamav',$3)`,
        [TENANT_A, id, ACTOR]
      );
      await c.query(
        `INSERT INTO shared.file_scan_results (tenant_id, version_id, scan_status, scanner_code, threat_name, created_by)
         VALUES ($1,$2,'infected','clamav','EICAR-Test',$3)`,
        [TENANT_A, id, ACTOR]
      );
      await c.query(`UPDATE shared.document_versions SET status='scanning' WHERE id=$1`, [id]);
      await expectSqlState(
        c.query(`UPDATE shared.document_versions SET status='accepted' WHERE id=$1`, [id]),
        '23514'
      );
    });
  });

  it('is accepted (with accepted_at and scanning_at stamped) once a clean scan exists', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const v = await insertVersion(c, 22);
      const id = v.rows[0].id;
      await c.query(
        `INSERT INTO shared.file_scan_results (tenant_id, version_id, scan_status, scanner_code, created_by)
         VALUES ($1,$2,'clean','clamav',$3)`,
        [TENANT_A, id, ACTOR]
      );
      const scanning = await c.query(
        `UPDATE shared.document_versions SET status='scanning' WHERE id=$1 RETURNING scanning_at`,
        [id]
      );
      expect(scanning.rows[0].scanning_at).not.toBeNull();
      const r = await c.query(
        `UPDATE shared.document_versions SET status='accepted' WHERE id=$1 RETURNING status, accepted_at, scanning_at`,
        [id]
      );
      expect(r.rows[0].status).toBe('accepted');
      expect(r.rows[0].accepted_at).not.toBeNull();
      expect(r.rows[0].scanning_at).not.toBeNull();
    });
  });

  it('a scanning version cannot fall back to pending', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const v = await insertVersion(c, 26);
      const id = v.rows[0].id;
      await c.query(`UPDATE shared.document_versions SET status='scanning' WHERE id=$1`, [id]);
      await expectSqlState(
        c.query(`UPDATE shared.document_versions SET status='pending' WHERE id=$1`, [id]),
        '23514'
      );
    });
  });

  it('an accepted version is terminal and immutable', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const v = await insertVersion(c, 23);
      const id = v.rows[0].id;
      await c.query(
        `INSERT INTO shared.file_scan_results (tenant_id, version_id, scan_status, scanner_code, created_by)
         VALUES ($1,$2,'clean','clamav',$3)`,
        [TENANT_A, id, ACTOR]
      );
      await c.query(`UPDATE shared.document_versions SET status='scanning' WHERE id=$1`, [id]);
      await c.query(`UPDATE shared.document_versions SET status='accepted' WHERE id=$1`, [id]);
      await expectSqlState(
        c.query(`UPDATE shared.document_versions SET status='rejected' WHERE id=$1`, [id]),
        '23514'
      );
    });
  });

  it('a quarantined and a rejected version are terminal too — neither can become accepted', async () => {
    // "A rejected or quarantined version can never satisfy evidence" is only
    // true if neither can leave its state. Both directions, not just accepted.
    //
    // ONE failing probe per transaction: a statement that raises aborts the
    // transaction, so a second probe would report 25P02 and the assertion would
    // be about the runner rather than about the guard.
    let n = 27;
    for (const terminal of ['quarantined', 'rejected'] as const) {
      for (const target of ['accepted', 'scanning', 'pending'] as const) {
        n += 1;
        await withRolledBackTx(admin, {}, async (c) => {
          const v = await insertVersion(c, n);
          const id = v.rows[0].id;
          await c.query(
            `INSERT INTO shared.file_scan_results (tenant_id, version_id, scan_status, scanner_code, created_by)
             VALUES ($1,$2,'clean','clamav',$3)`,
            [TENANT_A, id, ACTOR]
          );
          await c.query(`UPDATE shared.document_versions SET status=$2 WHERE id=$1`, [
            id,
            terminal,
          ]);
          await expectSqlState(
            c.query(`UPDATE shared.document_versions SET status=$2 WHERE id=$1`, [id, target]),
            '23514'
          );
        });
      }
    }
  });

  it('a pending version may still be rejected directly — the shipped runtime transition', async () => {
    // Regression lock. `shared.attachment-version-reject` updates a pending row
    // straight to `rejected`; a guard that demanded scanning first would answer
    // every request to that operation with an error.
    await withRolledBackTx(admin, {}, async (c) => {
      const v = await insertVersion(c, 40);
      const r = await c.query(
        `UPDATE shared.document_versions SET status='rejected' WHERE id=$1 RETURNING rejected_at`,
        [v.rows[0].id]
      );
      expect(r.rows[0].rejected_at).not.toBeNull();
    });
  });

  it('can be quarantined from pending (sets quarantined_at)', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const v = await insertVersion(c, 24);
      const r = await c.query(
        `UPDATE shared.document_versions SET status='quarantined' WHERE id=$1 RETURNING quarantined_at`,
        [v.rows[0].id]
      );
      expect(r.rows[0].quarantined_at).not.toBeNull();
    });
  });

  it('content columns are immutable (storage_key)', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `UPDATE shared.document_versions SET storage_key='tenant/1/doc/other' WHERE id=$1`,
          [VER]
        ),
        '23514'
      )
    );
  });

  it('a runtime session reads only its own tenant versions and cannot write', async () => {
    const a = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.document_versions WHERE id=$1`, [VER])
    );
    expect(a.rows).toHaveLength(1);
    const b = await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.document_versions WHERE id=$1`, [VER])
    );
    expect(b.rows).toHaveLength(0);
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(insertVersion(c, 30), '42501')
    );
  });
});

describe('shared.file_scan_results — append-only verdict history', () => {
  it('rejects a scan whose (tenant, version) crosses tenants (composite FK)', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.file_scan_results (tenant_id, version_id, scan_status, scanner_code, created_by)
           VALUES ($1,$2,'clean','clamav',$3)`,
          [TENANT_B, VER, ACTOR]
        ),
        '23503'
      )
    );
  });

  it('allows a threat_name only for an infected verdict', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.file_scan_results (tenant_id, version_id, scan_status, scanner_code, threat_name, created_by)
           VALUES ($1,$2,'clean','clamav','ghost',$3)`,
          [TENANT_A, VER, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('records a scan history and a runtime session cannot write scans', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const r = await c.query(
        `INSERT INTO shared.file_scan_results (tenant_id, version_id, scan_status, scanner_code, created_by)
         VALUES ($1,$2,'pending','clamav',$3) RETURNING id`,
        [TENANT_A, VER, ACTOR]
      );
      expect(r.rows).toHaveLength(1);
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.file_scan_results (tenant_id, version_id, scan_status, scanner_code, created_by)
           VALUES ($1,$2,'clean','clamav',$3)`,
          [TENANT_A, VER, ACTOR]
        ),
        '42501'
      )
    );
  });
});
