/**
 * Phase 1-5 Increment F — shared.outbound_messages / shared.delivery_attempts
 * (P1-05-DB-009/010, P1-05-SEC-004, P1-05-QA-003).
 *
 * Covers recipient privacy/integrity, tenant/company/branch structure,
 * approved template-version scope, deduplication, the exact initial-state and
 * transition graph, retry semantics, append-only attempt evidence, FORCE RLS,
 * and SELECT-only runtime grants.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  BRANCH_A1,
  cleanFixtures,
  COMPANY_A1,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
  withCommittedTx,
  withRolledBackTx,
} from './helpers';

// Deterministic Increment-F fixtures use fresh f5/f51/f52/f53 prefixes.
const TEMPLATE_PLATFORM = 'f5000000-0000-4000-8000-000000000001';
const VERSION_APPROVED = 'f5100000-0000-4000-8000-000000000001';
const VERSION_DRAFT = 'f5100000-0000-4000-8000-000000000002';
const VERSION_RETIRED = 'f5100000-0000-4000-8000-000000000003';
const MESSAGE_A = 'f5200000-0000-4000-8000-0000000000a1';
const MESSAGE_B = 'f5200000-0000-4000-8000-0000000000b1';
const ATTEMPT_A = 'f5300000-0000-4000-8000-0000000000a1';

const BODY = 'Ephemeral outbound fixture body';

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  await withCommittedTx(admin, {}, async (c) => {
    await c.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES
         ($1,$2,'fixture','f5-user-a','f5-user-a@example.invalid','F5 User A','active',$1),
         ($3,$4,'fixture','f5-user-b','f5-user-b@example.invalid','F5 User B','active',$1)
       ON CONFLICT (id) DO NOTHING`,
      [USER_A, TENANT_A, USER_B, TENANT_B]
    );

    // Increment F deliberately creates one ephemeral platform template and an
    // approved version: the production migration/seeds create no business data.
    await c.query(
      `INSERT INTO shared.message_templates
         (id, scope, template_code, name, channel, purpose, locale_code, created_by)
       VALUES ($1,'platform','fx_outbound_f','Outbound F fixture','email','transactional','en',$2)`,
      [TEMPLATE_PLATFORM, USER_A]
    );
    await c.query(
      `INSERT INTO shared.template_versions
         (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
       VALUES
         ($1,NULL,$4,1,'Fixture subject',$5,
          extensions.digest('Fixture subject|' || $5,'sha256'),$6),
         ($2,NULL,$4,2,NULL,'Draft body',extensions.digest('Draft body','sha256'),$6),
         ($3,NULL,$4,3,NULL,'Retired body',extensions.digest('Retired body','sha256'),$6)`,
      [VERSION_APPROVED, VERSION_DRAFT, VERSION_RETIRED, TEMPLATE_PLATFORM, BODY, USER_A]
    );
    await c.query(
      `UPDATE shared.template_versions
          SET status='approved', approved_by=$1
        WHERE id=$2`,
      [USER_A, VERSION_APPROVED]
    );
    await c.query(
      `UPDATE shared.template_versions
          SET status='approved', approved_by=$1
        WHERE id=$2`,
      [USER_A, VERSION_RETIRED]
    );
    await c.query(`UPDATE shared.template_versions SET status='retired' WHERE id=$1`, [
      VERSION_RETIRED,
    ]);

    await c.query(
      `INSERT INTO shared.outbound_messages
         (id, tenant_id, template_version_id, channel, purpose, recipient_user_id,
          body_sha256, dedupe_key, created_by)
       VALUES
         ($1,$2,$3,'email','transactional',$4,extensions.digest($5,'sha256'),
          'fx-f-message-a',$4),
         ($6,$7,$3,'email','transactional',$8,extensions.digest($5,'sha256'),
          'fx-f-message-b',$8)`,
      [MESSAGE_A, TENANT_A, VERSION_APPROVED, USER_A, BODY, MESSAGE_B, TENANT_B, USER_B]
    );
    await c.query(
      `INSERT INTO shared.delivery_attempts
         (id, tenant_id, message_id, attempt_number, provider_code, status,
          response_code, completed_at, created_by)
       VALUES ($1,$2,$3,1,'fixture_provider','accepted','202',now(),$4)`,
      [ATTEMPT_A, TENANT_A, MESSAGE_A, USER_A]
    );
  });
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('shared.outbound_messages — envelope and structural integrity', () => {
  it('stores only the approved channels and purposes', async () => {
    const { rows } = await admin.query(
      `SELECT channel, purpose FROM shared.outbound_messages WHERE id=$1`,
      [MESSAGE_A]
    );
    expect(rows[0]).toEqual({ channel: 'email', purpose: 'transactional' });

    for (const channel of ['sms', 'push']) {
      await withRolledBackTx(admin, {}, (c) =>
        expectSqlState(
          c.query(
            `INSERT INTO shared.outbound_messages
               (tenant_id, channel, purpose, recipient_user_id, body_sha256,
                dedupe_key, created_by)
             VALUES ($1,$2,'system',$3,extensions.digest($4,'sha256'),$2,$3)`,
            [TENANT_A, channel, USER_A, BODY]
          ),
          '23514'
        )
      );
    }

    await withRolledBackTx(admin, {}, async (c) => {
      for (const purpose of ['transactional', 'marketing', 'system']) {
        await c.query(
          `INSERT INTO shared.outbound_messages
             (tenant_id, channel, purpose, recipient_user_id, body_sha256,
              dedupe_key, created_by)
           VALUES ($1,'in_app',$2,$3,extensions.digest($4,'sha256'),$2,$3)`,
          [TENANT_A, purpose, USER_A, BODY]
        );
      }
      await expectSqlState(
        c.query(
          `INSERT INTO shared.outbound_messages
             (tenant_id, channel, purpose, recipient_user_id, body_sha256,
              dedupe_key, created_by)
           VALUES ($1,'email','other',$2,extensions.digest($3,'sha256'),'bad-purpose',$2)`,
          [TENANT_A, USER_A, BODY]
        ),
        '23514'
      );
    });
  });

  it('requires a recipient and accepts either a 32-byte digest or tenant user', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.outbound_messages
             (tenant_id, channel, purpose, body_sha256, dedupe_key, created_by)
           VALUES ($1,'email','system',extensions.digest($2,'sha256'),'no-recipient',$3)`,
          [TENANT_A, BODY, USER_A]
        ),
        '23514'
      )
    );
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.outbound_messages
             (tenant_id, channel, purpose, recipient_digest, body_sha256,
              dedupe_key, created_by)
           VALUES ($1,'email','system',decode('00','hex'),
                   extensions.digest($2,'sha256'),'short-digest',$3)`,
          [TENANT_A, BODY, USER_A]
        ),
        '23514'
      )
    );
    await withRolledBackTx(admin, {}, async (c) => {
      const digest = await c.query(
        `INSERT INTO shared.outbound_messages
           (tenant_id, channel, purpose, recipient_digest, body_sha256,
            dedupe_key, created_by)
         VALUES ($1,'email','system',extensions.digest('external@example.invalid','sha256'),
                  extensions.digest($2,'sha256'),'digest-only',$3)
         RETURNING octet_length(recipient_digest) AS bytes, recipient_user_id`,
        [TENANT_A, BODY, USER_A]
      );
      expect(digest.rows[0]).toEqual({ bytes: 32, recipient_user_id: null });
    });
  });

  it('rejects cross-tenant recipient attribution', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.outbound_messages
             (tenant_id, channel, purpose, recipient_user_id, body_sha256,
              dedupe_key, created_by)
           VALUES ($1,'in_app','system',$2,extensions.digest($3,'sha256'),
                   'cross-user',$4)`,
          [TENANT_A, USER_B, BODY, USER_A]
        ),
        '23503'
      )
    );
  });

  it('enforces branch-requires-company and the tenant+company+branch FK', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(
        `INSERT INTO shared.outbound_messages
           (tenant_id, company_id, branch_id, channel, purpose, recipient_user_id,
            body_sha256, dedupe_key, created_by)
         VALUES ($1,$2,$3,'email','system',$4,extensions.digest($5,'sha256'),
                  'branch-valid',$4)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A, BODY]
      );
      await expectSqlState(
        c.query(
          `INSERT INTO shared.outbound_messages
             (tenant_id, branch_id, channel, purpose, recipient_user_id,
              body_sha256, dedupe_key, created_by)
           VALUES ($1,$2,'email','system',$3,extensions.digest($4,'sha256'),
                    'branch-no-company',$3)`,
          [TENANT_A, BRANCH_A1, USER_A, BODY]
        ),
        '23514'
      );
    });
  });

  it('enforces tenant-scoped dedupe keys and 32-byte body hashes', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const insert = (tenant: string, user: string) =>
        c.query(
          `INSERT INTO shared.outbound_messages
             (tenant_id, channel, purpose, recipient_user_id, body_sha256,
              dedupe_key, created_by)
           VALUES ($1,'email','system',$2,extensions.digest($3,'sha256'),
                    'same-dedupe',$2)`,
          [tenant, user, BODY]
        );
      await insert(TENANT_A, USER_A);
      await insert(TENANT_B, USER_B);
      await expectSqlState(insert(TENANT_A, USER_A), '23505');
    });
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.outbound_messages
             (tenant_id, channel, purpose, recipient_user_id, body_sha256,
              dedupe_key, created_by)
           VALUES ($1,'email','system',$2,decode('00','hex'),'bad-hash',$2)`,
          [TENANT_A, USER_A]
        ),
        '23514'
      )
    );
  });
});

describe('shared.outbound_messages — approved template and lifecycle guards', () => {
  it('accepts the approved platform template version', async () => {
    const { rows } = await admin.query(
      `SELECT template_version_id, status, retry_count, queued_at, failed_at
       FROM shared.outbound_messages WHERE id=$1`,
      [MESSAGE_A]
    );
    expect(rows[0]).toEqual({
      template_version_id: VERSION_APPROVED,
      status: 'pending',
      retry_count: 0,
      queued_at: null,
      failed_at: null,
    });
  });

  it('rejects draft and retired template versions', async () => {
    for (const [version, key] of [
      [VERSION_DRAFT, 'draft-template'],
      [VERSION_RETIRED, 'retired-template'],
    ]) {
      await withRolledBackTx(admin, {}, (c) =>
        expectSqlState(
          c.query(
            `INSERT INTO shared.outbound_messages
                 (tenant_id, template_version_id, channel, purpose, recipient_user_id,
                  body_sha256, dedupe_key, created_by)
               VALUES ($1,$2,'email','system',$3,extensions.digest($4,'sha256'),$5,$3)`,
            [TENANT_A, version, USER_A, BODY, key]
          ),
          '23514'
        )
      );
    }
  });

  it('rejects a tenant template version from another tenant', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const templateA = 'f5010000-0000-4000-8000-000000000001';
      const versionA = 'f5120000-0000-4000-8000-000000000001';
      await c.query(
        `INSERT INTO shared.message_templates
           (id, scope, tenant_id, template_code, name, channel, purpose, locale_code, created_by)
         VALUES ($1,'tenant',$2,'outbound_scope_f','Scope F','email','system','en',$3)`,
        [templateA, TENANT_A, USER_A]
      );
      await c.query(
        `INSERT INTO shared.template_versions
           (id, tenant_id, template_id, version_number, body, content_hash, created_by)
         VALUES ($1,$2,$3,1,'Scoped body',extensions.digest('Scoped body','sha256'),$4)`,
        [versionA, TENANT_A, templateA, USER_A]
      );
      await c.query(
        `UPDATE shared.template_versions SET status='approved', approved_by=$1 WHERE id=$2`,
        [USER_A, versionA]
      );
      await expectSqlState(
        c.query(
          `INSERT INTO shared.outbound_messages
             (tenant_id, template_version_id, channel, purpose, recipient_user_id,
              body_sha256, dedupe_key, created_by)
           VALUES ($1,$2,'email','system',$3,extensions.digest($4,'sha256'),
                    'foreign-template',$3)`,
          [TENANT_B, versionA, USER_B, BODY]
        ),
        '23514'
      );
    });
  });

  it('rejects direct INSERT as sent or delivered', async () => {
    for (const status of ['sent', 'delivered']) {
      await withRolledBackTx(admin, {}, (c) =>
        expectSqlState(
          c.query(
            `INSERT INTO shared.outbound_messages
               (tenant_id, channel, purpose, recipient_user_id, body_sha256,
                dedupe_key, status, sent_at, delivered_at, created_by)
             VALUES ($1,'email','system',$2,extensions.digest($3,'sha256'),$4,$5,
                      now(),CASE WHEN $5='delivered' THEN now() ELSE NULL END,$2)`,
            [TENANT_A, USER_A, BODY, `insert-${status}`, status]
          ),
          '23514'
        )
      );
    }
  });

  it('server-stamps pending→queued→sending→sent→delivered', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const inserted = await c.query(
        `INSERT INTO shared.outbound_messages
           (tenant_id, channel, purpose, recipient_user_id, body_sha256,
            dedupe_key, created_by)
         VALUES ($1,'email','transactional',$2,extensions.digest($3,'sha256'),
                  'happy-path',$2) RETURNING id`,
        [TENANT_A, USER_A, BODY]
      );
      const id = inserted.rows[0].id;
      for (const status of ['queued', 'sending', 'sent', 'delivered']) {
        await c.query(`UPDATE shared.outbound_messages SET status=$1 WHERE id=$2`, [status, id]);
      }
      const { rows } = await c.query(
        `SELECT status, queued_at IS NOT NULL AS queued, sending_at IS NOT NULL AS sending,
                sent_at IS NOT NULL AS sent, delivered_at IS NOT NULL AS delivered
         FROM shared.outbound_messages WHERE id=$1`,
        [id]
      );
      expect(rows[0]).toEqual({
        status: 'delivered',
        queued: true,
        sending: true,
        sent: true,
        delivered: true,
      });
      await expectSqlState(
        c.query(`UPDATE shared.outbound_messages SET status='queued' WHERE id=$1`, [id]),
        '23514'
      );
    });
  });

  it('failed→queued increments retry_count and clears failure state', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const inserted = await c.query(
        `INSERT INTO shared.outbound_messages
           (tenant_id, channel, purpose, recipient_user_id, body_sha256,
            dedupe_key, created_by)
         VALUES ($1,'email','transactional',$2,extensions.digest($3,'sha256'),
                  'retry-path',$2) RETURNING id`,
        [TENANT_A, USER_A, BODY]
      );
      const id = inserted.rows[0].id;
      await c.query(`UPDATE shared.outbound_messages SET status='queued' WHERE id=$1`, [id]);
      await c.query(`UPDATE shared.outbound_messages SET status='sending' WHERE id=$1`, [id]);
      await c.query(
        `UPDATE shared.outbound_messages
            SET status='failed', failure_class='transient_provider'
          WHERE id=$1`,
        [id]
      );
      const { rows } = await c.query(
        `UPDATE shared.outbound_messages SET status='queued' WHERE id=$1
         RETURNING status, retry_count, failure_class, failed_at, queued_at IS NOT NULL AS queued`,
        [id]
      );
      expect(rows[0]).toEqual({
        status: 'queued',
        retry_count: 1,
        failure_class: null,
        failed_at: null,
        queued: true,
      });
      await expectSqlState(
        c.query(`UPDATE shared.outbound_messages SET status='sent' WHERE id=$1`, [id]),
        '23514'
      );
    });
  });

  it('rejects forged lifecycle timestamps on UPDATE', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `UPDATE shared.outbound_messages
              SET status='queued', delivered_at=now()
            WHERE id=$1`,
          [MESSAGE_A]
        ),
        '23514'
      )
    );
  });
});

describe('shared.delivery_attempts — append-only evidence and tenant isolation', () => {
  it('requires unique positive attempt numbers per message', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.delivery_attempts
             (tenant_id, message_id, attempt_number, provider_code, status,
              completed_at, created_by)
           VALUES ($1,$2,1,'fixture_provider','accepted',now(),$3)`,
          [TENANT_A, MESSAGE_A, USER_A]
        ),
        '23505'
      )
    );
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.delivery_attempts
             (tenant_id, message_id, attempt_number, provider_code, status, created_by)
           VALUES ($1,$2,0,'fixture_provider','started',$3)`,
          [TENANT_A, MESSAGE_A, USER_A]
        ),
        '23514'
      )
    );
  });

  it('requires a non-blank error_summary for errored attempts', async () => {
    for (const summary of [null, '   ']) {
      await withRolledBackTx(admin, {}, (c) =>
        expectSqlState(
          c.query(
            `INSERT INTO shared.delivery_attempts
               (tenant_id, message_id, attempt_number, provider_code, status,
                error_summary, completed_at, created_by)
             VALUES ($1,$2,2,'fixture_provider','errored',$3,now(),$4)`,
            [TENANT_A, MESSAGE_A, summary, USER_A]
          ),
          '23514'
        )
      );
    }
  });

  it('pairs completed_at with the started-to-terminal lifecycle', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.delivery_attempts
             (tenant_id, message_id, attempt_number, provider_code, status, created_by)
           VALUES ($1,$2,2,'fixture_provider','accepted',$3)`,
          [TENANT_A, MESSAGE_A, USER_A]
        ),
        '23514'
      )
    );
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.delivery_attempts
             (tenant_id, message_id, attempt_number, provider_code, status,
              completed_at, created_by)
           VALUES ($1,$2,2,'fixture_provider','started',now(),$3)`,
          [TENANT_A, MESSAGE_A, USER_A]
        ),
        '23514'
      )
    );
  });

  it('uses a composite tenant/message FK', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.delivery_attempts
             (tenant_id, message_id, attempt_number, provider_code, status, created_by)
           VALUES ($1,$2,2,'fixture_provider','started',$3)`,
          [TENANT_B, MESSAGE_A, USER_B]
        ),
        '23503'
      )
    );
  });

  it('runtime sees only its tenant and cannot mutate messages or attempts', async () => {
    const messages = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(`SELECT id FROM shared.outbound_messages ORDER BY id`)
    );
    expect(messages.rows.map((row) => row.id)).toContain(MESSAGE_A);
    expect(messages.rows.map((row) => row.id)).not.toContain(MESSAGE_B);

    const attempts = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(`SELECT id FROM shared.delivery_attempts ORDER BY id`)
    );
    expect(attempts.rows.map((row) => row.id)).toEqual([ATTEMPT_A]);

    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.outbound_messages SET status='queued' WHERE id=$1`, [MESSAGE_A]),
        '42501'
      )
    );
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.delivery_attempts SET status='delivered' WHERE id=$1`, [ATTEMPT_A]),
        '42501'
      )
    );
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      expectSqlState(
        c.query(`DELETE FROM shared.delivery_attempts WHERE id=$1`, [ATTEMPT_A]),
        '42501'
      )
    );
  });
});
