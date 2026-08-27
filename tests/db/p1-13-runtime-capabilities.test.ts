/**
 * DBCR-P1-13-001 — tenant-safe backend runtime persistence.
 *
 * Migration `20260725090000_iam_shared_runtime_write_capabilities.sql` gives the
 * `app_runtime` archetype the four write capabilities the backend foundation
 * needs. A grant is the easiest thing in a database to get subtly wrong, so this
 * suite exists to prove the *shape* of what was granted, not merely that it
 * works:
 *
 *  - every assertion that the capability WORKS runs on `rootlco_test_runtime`,
 *    a member of `app_runtime` — the identity the application deploys with. The
 *    admin connection is fixtures and read-back only; it bypasses RLS and is
 *    never evidence about runtime behaviour.
 *  - every assertion that a capability is ABSENT is at least as important. A
 *    remediation that opened cross-tenant access, made audit rows mutable, or
 *    handed a producer the dispatch routines would pass a naive "can it append?"
 *    test and fail here.
 *
 * The audit-read boundary is the subtle one and has its own section. The writer
 * can see a record only while it has no chain link; the link is written last
 * inside `iam.audit_append`, so the window closes at the end of the append and
 * never reopens. Reading audit *history* still requires `iam.audit.view`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  readonlyPool,
  runtimePool,
  TENANT_A,
  TENANT_B,
  USER_A,
  withCommittedTx,
  withRolledBackTx,
  workerPool,
} from './helpers';

const AGGREGATE = 'd1300000-0000-4000-8000-0000000000a1';
const CTX_A = { tenantId: TENANT_A, userId: USER_A };
const CTX_B = { tenantId: TENANT_B, userId: USER_A };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;
let worker: Pool;

function key(tag: string): string {
  return `fx-p1-13-${tag}-${randomUUID()}`;
}

/** One outbox envelope, written by the producing identity. */
function outboxInsert(eventKey: string, tenantId: string = TENANT_A): [string, unknown[]] {
  return [
    `INSERT INTO shared.event_outbox
       (tenant_id, event_key, event_type, aggregate_type, aggregate_id, schema_version,
        aggregate_version, producer, payload, headers, created_by)
     VALUES ($1, $2, 'work_order.created', 'work_order', $3, 1, 1, 'backend.orders',
             '{}'::jsonb, '{}'::jsonb, $4)
     RETURNING id, status, attempt_count`,
    [tenantId, eventKey, AGGREGATE, USER_A],
  ];
}

function idempotencyInsert(
  idempotencyKey: string,
  tenantId: string | null = TENANT_A
): [string, unknown[]] {
  return [
    `INSERT INTO shared.idempotency_keys
       (tenant_id, operation, idempotency_key, request_fingerprint, response_document, created_by)
     VALUES ($1, 'fx_p1_13_command', $2, $3, '{"ok":true}'::jsonb, $4)`,
    [tenantId, idempotencyKey, 'a'.repeat(64), USER_A],
  ];
}

async function appendAsRuntime(action: string, tenantId: string = TENANT_A): Promise<string> {
  const result = await withCommittedTx(runtime, { tenantId, userId: USER_A }, (c) =>
    c.query(
      `SELECT iam.audit_append($1,$2,'user',$3,'iam.p1_13',NULL,NULL,NULL,NULL,NULL,$4::jsonb) AS id`,
      [
        tenantId,
        USER_A,
        action,
        JSON.stringify([{ field: 'state', old: 'draft', new: 'active', class: 'internal' }]),
      ]
    )
  );
  return result.rows[0].id as string;
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  readonly = readonlyPool();
  worker = workerPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
});

beforeEach(async () => {
  for (const tenant of [TENANT_A, TENANT_B]) {
    await admin.query('DELETE FROM iam.security_events WHERE tenant_id = $1', [tenant]);
    await admin.query('DELETE FROM shared.idempotency_keys WHERE tenant_id = $1', [tenant]);
    await admin.query('DELETE FROM shared.event_outbox WHERE tenant_id = $1', [tenant]);
    await admin.query('DELETE FROM iam.audit_records WHERE tenant_id = $1', [tenant]);
  }
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await readonly.end();
  await worker.end();
  await admin.end();
});

// ---------------------------------------------------------------------------
// 1. Role posture
// ---------------------------------------------------------------------------

describe('role posture is unchanged by the remediation', () => {
  it('leaves every application role without BYPASSRLS, superuser, or ownership', async () => {
    const roles = await admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb
         FROM pg_roles WHERE rolname IN ('app_runtime','app_readonly','app_worker')
        ORDER BY 1`
    );
    expect(roles.rows).toEqual([
      {
        rolname: 'app_readonly',
        rolsuper: false,
        rolbypassrls: false,
        rolcanlogin: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
      {
        rolname: 'app_runtime',
        rolsuper: false,
        rolbypassrls: false,
        rolcanlogin: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
      {
        rolname: 'app_worker',
        rolsuper: false,
        rolbypassrls: false,
        rolcanlogin: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
    ]);

    const owned = await admin.query(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
        WHERE r.rolname IN ('app_runtime','app_readonly','app_worker')`
    );
    expect(owned.rows[0].n).toBe(0);
  });

  it('adds no SECURITY DEFINER routine and no broad runtime write policy', async () => {
    const definers = await admin.query(
      `SELECT n.nspname || '.' || p.proname AS routine
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef
          AND n.nspname IN ('org','iam','shared','crm','veh','apt','rec','wo','tech','dia',
                            'qms','svc','quo','inv','sal','wty','rpt')`
    );
    expect(definers.rows).toEqual([]);

    // A write policy for the request role must never be unconditional. Read
    // policies on platform reference catalogues (currencies, timezones, …) are
    // deliberately global and predate this change, so the check is on writes.
    const broadWrites = await admin.query(
      `SELECT schemaname || '.' || tablename AS tbl, policyname, cmd
         FROM pg_policies
        WHERE 'app_runtime' = ANY(roles)
          AND cmd <> 'SELECT'
          AND (COALESCE(qual, '') = 'true' OR COALESCE(with_check, '') = 'true')`
    );
    expect(broadWrites.rows).toEqual([]);
  });

  it('keeps every one of the eleven new policies scoped to the resolved tenant', async () => {
    const { rows } = await admin.query(
      `SELECT policyname, COALESCE(with_check, qual) AS predicate
         FROM pg_policies
        WHERE policyname IN ('ins_audit_records_writer','sel_audit_records_unlinked',
              'ins_audit_record_details_writer','sel_audit_record_details_unlinked',
              'ins_audit_integrity_links_writer','sel_audit_integrity_links_chain',
              'ins_event_outbox_producer','sel_event_outbox_producer',
              'ins_idempotency_keys_tenant','sel_idempotency_keys_tenant',
              'ins_security_events_runtime')
        ORDER BY 1`
    );
    expect(rows).toHaveLength(11);
    for (const row of rows) {
      expect(row.predicate, `${row.policyname} must compare against the resolved tenant`).toContain(
        'tenant_id = iam.current_tenant_id()'
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. No request context means no capability
// ---------------------------------------------------------------------------

describe('a session with no resolved tenant can do nothing', () => {
  it('refuses the audit append, the outbox insert, and the idempotency insert', async () => {
    await withRolledBackTx(runtime, {}, (c) =>
      expectSqlState(
        c.query(`SELECT iam.audit_append($1,$2,'user','no.ctx','iam.p1_13')`, [TENANT_A, USER_A]),
        '42501'
      )
    );
    await withRolledBackTx(runtime, {}, (c) =>
      expectSqlState(c.query(...outboxInsert(key('no-ctx'))), '42501')
    );
    await withRolledBackTx(runtime, {}, (c) =>
      expectSqlState(c.query(...idempotencyInsert(key('no-ctx'))), '42501')
    );
    await withRolledBackTx(runtime, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.security_events (tenant_id, event_type, severity, actor_id)
           VALUES ($1, 'authorization.denied', 'warning', $2)`,
          [TENANT_A, USER_A]
        ),
        '42501'
      )
    );
  });

  it('shows a context-less session zero rows in every foundation table', async () => {
    await appendAsRuntime('visibility.probe');
    await withCommittedTx(runtime, CTX_A, (c) => c.query(...outboxInsert(key('visible'))));
    await withCommittedTx(runtime, CTX_A, (c) => c.query(...idempotencyInsert(key('visible'))));

    const counts = await withRolledBackTx(runtime, {}, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM shared.event_outbox)        AS outbox,
                (SELECT count(*)::int FROM shared.idempotency_keys)    AS idempotency,
                (SELECT count(*)::int FROM iam.audit_integrity_links)  AS links`
      )
    );
    expect(counts.rows[0]).toEqual({ outbox: 0, idempotency: 0, links: 0 });
  });
});

// ---------------------------------------------------------------------------
// 3. Cross-tenant writes and reads
// ---------------------------------------------------------------------------

describe('a tenant cannot reach another tenant', () => {
  it('refuses to write an audit record, an event, a key, or a security event for tenant B', async () => {
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(
        c.query(`SELECT iam.audit_append($1,$2,'user','cross.tenant','iam.p1_13')`, [
          TENANT_B,
          USER_A,
        ]),
        '42501'
      )
    );
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(c.query(...outboxInsert(key('cross'), TENANT_B)), '42501')
    );
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(c.query(...idempotencyInsert(key('cross'), TENANT_B)), '42501')
    );
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.security_events (tenant_id, event_type, severity, actor_id)
           VALUES ($1, 'authorization.denied', 'warning', $2)`,
          [TENANT_B, USER_A]
        ),
        '42501'
      )
    );
  });

  it('refuses a platform-scope (NULL tenant) key or security event', async () => {
    // Both columns are nullable BY DESIGN for platform-scope rows. The predicate
    // is NULL for them, so a tenant session can neither write nor read one.
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(c.query(...idempotencyInsert(key('platform'), null)), '42501')
    );
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.security_events (tenant_id, event_type, severity)
           VALUES (NULL, 'platform.probe', 'info')`
        ),
        '42501'
      )
    );
  });

  it('hides tenant A idempotency keys, envelopes, and chain links from tenant B', async () => {
    const sharedKey = key('isolation');
    await withCommittedTx(runtime, CTX_A, (c) => c.query(...idempotencyInsert(sharedKey)));
    await withCommittedTx(runtime, CTX_A, (c) => c.query(...outboxInsert(key('isolation'))));
    await appendAsRuntime('isolation.probe');

    const seen = await withRolledBackTx(runtime, CTX_B, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM shared.idempotency_keys)   AS idempotency,
                (SELECT count(*)::int FROM shared.event_outbox)       AS outbox,
                (SELECT count(*)::int FROM iam.audit_integrity_links) AS links,
                (SELECT count(*)::int FROM iam.audit_records)         AS records`
      )
    );
    expect(seen.rows[0]).toEqual({ idempotency: 0, outbox: 0, links: 0, records: 0 });
  });

  it('leaks nothing through the idempotency uniqueness constraint', async () => {
    // uq_idempotency_keys_scope is keyed on tenant_id, so tenant B reusing the
    // exact operation and key of tenant A must SUCCEED rather than collide —
    // a 23505 here would confirm the existence of another tenant's key.
    const shared = key('probe-existence');
    await withCommittedTx(runtime, CTX_A, (c) => c.query(...idempotencyInsert(shared)));
    await withRolledBackTx(runtime, CTX_B, async (c) => {
      const result = await c.query(...idempotencyInsert(shared, TENANT_B));
      expect(result.rowCount).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Producer and worker stay separate identities
// ---------------------------------------------------------------------------

describe('producing an event is not the same power as draining the queue', () => {
  it('denies the runtime every dispatch routine and every queue mutation', async () => {
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(c.query(`SELECT * FROM shared.claim_outbox_events('fx-probe', 1)`), '42501')
    );
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(
        c.query(`SELECT shared.complete_outbox_event(gen_random_uuid(), 'fx-probe')`),
        '42501'
      )
    );
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(
        c.query(
          `SELECT shared.fail_outbox_event(gen_random_uuid(), 'fx-probe', 'x', interval '1 min', 5)`
        ),
        '42501'
      )
    );
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(c.query(`UPDATE shared.event_outbox SET status = 'published'`), '42501')
    );
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(c.query(`DELETE FROM shared.event_outbox`), '42501')
    );
  });

  it('denies the runtime the worker-only consumer and error tables', async () => {
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(c.query(`SELECT count(*) FROM shared.processed_events`), '42501')
    );
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(c.query(`SELECT count(*) FROM shared.error_records`), '42501')
    );
  });

  it('keeps the worker unusable as a request identity', async () => {
    // The worker's queue policy is deliberately all-tenant, which is exactly why
    // it must never serve a request. It also holds no business-table access, so
    // a request executed as the worker could not read its own tenant's data.
    const workerPolicies = await admin.query<{
      policyname: string;
      qual: string | null;
      permissive: string;
    }>(
      `SELECT policyname, qual, permissive FROM pg_policies
        WHERE 'app_worker' = ANY(roles) AND schemaname = 'shared' ORDER BY 1`
    );
    expect(workerPolicies.rows.length).toBeGreaterThanOrEqual(3);

    // PERMISSIVE policies are what GRANT the worker its reach, and every one of
    // them must be the all-tenant dispatch surface — that is the property this
    // case exists for.
    const permissive = workerPolicies.rows.filter((r) => r.permissive === 'PERMISSIVE');
    expect(permissive.length).toBeGreaterThanOrEqual(3);
    for (const row of permissive) {
      expect(row.qual, `${row.policyname} is the all-tenant dispatch surface`).toBe('true');
    }

    // RESTRICTIVE policies can only ever NARROW that reach — they AND with the
    // permissive ones and can grant nothing. Holding them to `qual = 'true'`
    // would be asserting the opposite of what they are for, and an INSERT policy
    // has no USING clause to hold at all. They are listed rather than ignored,
    // so a new one still has to be looked at by whoever changes this file.
    const restrictive = workerPolicies.rows.filter((r) => r.permissive === 'RESTRICTIVE');
    expect(restrictive.map((r) => r.policyname)).toEqual(['wkr_outbound_messages_enqueue_scope']);

    await expectSqlState(worker.query('SELECT count(*) FROM crm.business_partners'), '42501');
    await expectSqlState(
      worker.query(`SELECT iam.audit_append($1,$2,'system','x','iam.p1_13')`, [TENANT_A, USER_A]),
      '42501'
    );
  });

  it('grants the read-only archetype none of the new capabilities', async () => {
    await expectSqlState(readonly.query('SELECT count(*) FROM shared.event_outbox'), '42501');
    await expectSqlState(readonly.query('SELECT count(*) FROM shared.idempotency_keys'), '42501');
    await expectSqlState(
      readonly.query(`SELECT iam.audit_append($1,$2,'user','x','iam.p1_13')`, [TENANT_A, USER_A]),
      '42501'
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Audit append, immutability, and the read boundary
// ---------------------------------------------------------------------------

describe('audit append through the runtime path', () => {
  it('writes a masked, linked, verifiable record', async () => {
    const id = await appendAsRuntime('append.basic');

    const record = await admin.query(
      `SELECT seq, action, actor_kind FROM iam.audit_records WHERE id = $1`,
      [id]
    );
    expect(record.rows[0]).toEqual({ seq: '1', action: 'append.basic', actor_kind: 'user' });

    const link = await admin.query(
      `SELECT seq, octet_length(prev_hash) AS prev_len, octet_length(record_hash) AS hash_len
         FROM iam.audit_integrity_links WHERE audit_record_id = $1`,
      [id]
    );
    expect(link.rows[0]).toEqual({ seq: '1', prev_len: 32, hash_len: 32 });

    const chain = await admin.query(`SELECT iam.audit_verify_chain($1) AS report`, [TENANT_A]);
    expect(chain.rows[0].report).toEqual({ ok: true, verified_through: 1 });
  });

  it('keeps the chain contiguous across many sequential runtime appends', async () => {
    for (let n = 0; n < 5; n += 1) {
      await appendAsRuntime(`append.sequential.${n}`);
    }
    const seqs = await admin.query(
      `SELECT seq FROM iam.audit_records WHERE tenant_id = $1 ORDER BY seq`,
      [TENANT_A]
    );
    expect(seqs.rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5]);
    const chain = await admin.query(`SELECT iam.audit_verify_chain($1) AS report`, [TENANT_A]);
    expect(chain.rows[0].report).toEqual({ ok: true, verified_through: 5 });
  });

  it('cannot fork the chain under concurrent runtime appends', async () => {
    // The per-tenant advisory lock is held to COMMIT, so ten concurrent runtime
    // transactions must still produce ten consecutive sequence numbers.
    await Promise.all(
      Array.from({ length: 10 }, (_unused, n) => appendAsRuntime(`append.concurrent.${n}`))
    );
    const seqs = await admin.query(
      `SELECT seq FROM iam.audit_records WHERE tenant_id = $1 ORDER BY seq`,
      [TENANT_A]
    );
    expect(seqs.rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const chain = await admin.query(`SELECT iam.audit_verify_chain($1) AS report`, [TENANT_A]);
    expect(chain.rows[0].report).toEqual({ ok: true, verified_through: 10 });
  });

  it('leaves audit rows immutable to the runtime', async () => {
    await appendAsRuntime('append.immutable');
    for (const statement of [
      `UPDATE iam.audit_records SET action = 'tampered'`,
      `DELETE FROM iam.audit_records`,
      `UPDATE iam.audit_record_details SET new_value_masked = 'tampered'`,
      `DELETE FROM iam.audit_record_details`,
      `UPDATE iam.audit_integrity_links SET record_hash = decode(repeat('00',32),'hex')`,
      `DELETE FROM iam.audit_integrity_links`,
      `UPDATE iam.security_events SET severity = 'info'`,
      `DELETE FROM iam.security_events`,
    ]) {
      await withRolledBackTx(runtime, CTX_A, (c) => expectSqlState(c.query(statement), '42501'));
    }
  });
});

describe('the writer-scoped audit read is not an audit-history read', () => {
  it('shows the appending session nothing of its own committed records', async () => {
    await appendAsRuntime('read.boundary');
    const seen = await withRolledBackTx(runtime, CTX_A, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM iam.audit_records)        AS records,
                (SELECT count(*)::int FROM iam.audit_record_details) AS details,
                (SELECT count(*)::int FROM iam.security_events)      AS security`
      )
    );
    expect(seen.rows[0]).toEqual({ records: 0, details: 0, security: 0 });
  });

  it('closes the read window again within the appending transaction itself', async () => {
    // The record is visible only between its INSERT and its chain link, both of
    // which happen inside iam.audit_append. By the time the function returns —
    // still inside the same transaction — the window is shut.
    const visible = await withRolledBackTx(runtime, CTX_A, async (c) => {
      await c.query(`SELECT iam.audit_append($1,$2,'user','read.window','iam.p1_13')`, [
        TENANT_A,
        USER_A,
      ]);
      const result = await c.query(`SELECT count(*)::int AS n FROM iam.audit_records`);
      return result.rows[0].n as number;
    });
    expect(visible).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Idempotency, outbox, security events, and all-or-nothing
// ---------------------------------------------------------------------------

describe('idempotency reservation', () => {
  it('accepts a first use and rejects the same key twice for the same tenant', async () => {
    const reused = key('first-use');
    await withCommittedTx(runtime, CTX_A, (c) => c.query(...idempotencyInsert(reused)));
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(c.query(...idempotencyInsert(reused)), '23505')
    );
  });

  it('elects exactly one winner when the same key is claimed concurrently', async () => {
    const contested = key('race');
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        withCommittedTx(runtime, CTX_A, (c) => c.query(...idempotencyInsert(contested)))
      )
    );
    const winners = attempts.filter((outcome) => outcome.status === 'fulfilled');
    expect(winners).toHaveLength(1);

    const stored = await admin.query(
      `SELECT count(*)::int AS n FROM shared.idempotency_keys
        WHERE tenant_id = $1 AND idempotency_key = $2`,
      [TENANT_A, contested]
    );
    expect(stored.rows[0].n).toBe(1);
  });

  it('never lets the runtime rewrite or remove a stored response', async () => {
    await withCommittedTx(runtime, CTX_A, (c) => c.query(...idempotencyInsert(key('immutable'))));
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.idempotency_keys SET response_document = '{}'::jsonb`),
        '42501'
      )
    );
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(c.query(`DELETE FROM shared.idempotency_keys`), '42501')
    );
  });
});

describe('outbox publication', () => {
  it('writes a pending, unstamped envelope and returns its id', async () => {
    const result = await withCommittedTx(runtime, CTX_A, (c) =>
      c.query(...outboxInsert(key('publish')))
    );
    expect(result.rows[0].status).toBe('pending');
    expect(result.rows[0].attempt_count).toBe(0);
    expect(result.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('still refuses a forged initial state from the producer', async () => {
    await withRolledBackTx(runtime, CTX_A, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.event_outbox
             (tenant_id, event_key, event_type, aggregate_type, aggregate_id, schema_version,
              aggregate_version, producer, payload, headers, created_by, status, published_at)
           VALUES ($1, $2, 'work_order.created', 'work_order', $3, 1, 1, 'backend.orders',
                   '{}'::jsonb, '{}'::jsonb, $4, 'published', now())`,
          [TENANT_A, key('forged'), AGGREGATE, USER_A]
        ),
        '23514'
      )
    );
  });
});

describe('security-event capture', () => {
  it('records a denial for the resolved tenant without being able to read it back', async () => {
    await withCommittedTx(runtime, CTX_A, (c) =>
      c.query(
        `INSERT INTO iam.security_events (tenant_id, event_type, severity, actor_id, detail)
         VALUES ($1, 'authorization.denied', 'warning', $2, 'operation refused')`,
        [TENANT_A, USER_A]
      )
    );
    const stored = await admin.query(
      `SELECT event_type, severity FROM iam.security_events WHERE tenant_id = $1`,
      [TENANT_A]
    );
    expect(stored.rows).toEqual([{ event_type: 'authorization.denied', severity: 'warning' }]);

    const visible = await withRolledBackTx(runtime, CTX_A, (c) =>
      c.query(`SELECT count(*)::int AS n FROM iam.security_events`)
    );
    expect(visible.rows[0].n).toBe(0);
  });
});

describe('all four writes are one transaction', () => {
  it('persists business row, audit record, event, and key together', async () => {
    const eventKey = key('atomic-commit');
    const idempotencyKey = key('atomic-commit');
    const partner = await withCommittedTx(runtime, CTX_A, async (c) => {
      const inserted = await c.query(
        `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
         VALUES ($1, 'organization', $2, $3) RETURNING id`,
        [TENANT_A, `fx_p1_13_atomic_${randomUUID()}`, USER_A]
      );
      await c.query(
        `SELECT iam.audit_append($1,$2,'user','atomic.commit','crm.business_partner',$3)`,
        [TENANT_A, USER_A, inserted.rows[0].id]
      );
      await c.query(...outboxInsert(eventKey));
      await c.query(...idempotencyInsert(idempotencyKey));
      return inserted.rows[0].id as string;
    });

    const counts = await admin.query(
      `SELECT (SELECT count(*)::int FROM crm.business_partners WHERE id = $1)                    AS partner,
              (SELECT count(*)::int FROM iam.audit_records WHERE action = 'atomic.commit')       AS audit,
              (SELECT count(*)::int FROM shared.event_outbox WHERE event_key = $2)               AS outbox,
              (SELECT count(*)::int FROM shared.idempotency_keys WHERE idempotency_key = $3)     AS idempotency`,
      [partner, eventKey, idempotencyKey]
    );
    expect(counts.rows[0]).toEqual({ partner: 1, audit: 1, outbox: 1, idempotency: 1 });
  });

  it('removes every one of them when the transaction fails', async () => {
    const eventKey = key('atomic-rollback');
    const idempotencyKey = key('atomic-rollback');
    const partnerName = `fx_p1_13_doomed_${randomUUID()}`;

    await expect(
      withCommittedTx(runtime, CTX_A, async (c) => {
        const inserted = await c.query(
          `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
           VALUES ($1, 'organization', $2, $3) RETURNING id`,
          [TENANT_A, partnerName, USER_A]
        );
        await c.query(
          `SELECT iam.audit_append($1,$2,'user','atomic.rollback','crm.business_partner',$3)`,
          [TENANT_A, USER_A, inserted.rows[0].id]
        );
        await c.query(...outboxInsert(eventKey));
        await c.query(...idempotencyInsert(idempotencyKey));
        // Injected AFTER all four writes: the hardest case, because every one of
        // them already succeeded at the statement level.
        throw new Error('injected failure after the fourth write');
      })
    ).rejects.toThrow('injected failure after the fourth write');

    const counts = await admin.query(
      `SELECT (SELECT count(*)::int FROM crm.business_partners WHERE display_name = $1)        AS partner,
              (SELECT count(*)::int FROM iam.audit_records WHERE action = 'atomic.rollback')   AS audit,
              (SELECT count(*)::int FROM shared.event_outbox WHERE event_key = $2)             AS outbox,
              (SELECT count(*)::int FROM shared.idempotency_keys WHERE idempotency_key = $3)   AS idempotency`,
      [partnerName, eventKey, idempotencyKey]
    );
    expect(counts.rows[0]).toEqual({ partner: 0, audit: 0, outbox: 0, idempotency: 0 });

    // And the chain must not be left with a hole where the rolled-back seq was.
    await appendAsRuntime('atomic.after-rollback');
    const chain = await admin.query(`SELECT iam.audit_verify_chain($1) AS report`, [TENANT_A]);
    expect(chain.rows[0].report.ok).toBe(true);
  });
});
