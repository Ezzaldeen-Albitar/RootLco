/**
 * All-or-nothing across the four foundation writes (P1-13-BE-011, BR-INT-001).
 *
 * A command that changes business state also writes its status history, its
 * audit record, and its outbox event. The whole design rests on those four
 * landing together or not at all:
 *
 *  - an audit record that survives a rolled-back command is a lie about
 *    something that never happened;
 *  - a committed command with no audit record is an integrity hole nobody
 *    notices until an investigation needs the record that was never written;
 *  - an outbox event published for a rolled-back command is the dual-write
 *    failure the transactional-outbox pattern exists to eliminate — consumers
 *    would react to a state change that does not exist.
 *
 * One transaction removes all three failure modes at once, which is why the
 * assertion here is a *count of zero in four places* after an injected failure,
 * and a count of exactly one in four places after success. Anything weaker (for
 * example checking only the business row) would pass while the outbox leaked.
 *
 * This suite runs on `rootlco_test_runtime` — a member of `app_runtime`, the
 * archetype the application actually deploys with. Before DBCR-P1-13-001 was
 * applied it could not perform two of the four writes at all and the proof had
 * to borrow a rehearsal role; now the deployed identity does the work, so the
 * evidence is about the real thing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  USER_PERMITTED,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  withReadOnlyTransaction,
  withSavepoint,
  withTransaction,
  type DbHandle,
} from '@/server/db/transaction';
import { __resetCapabilitiesForTests } from '@/server/db/capabilities';
import { AUDIT_CLASSIFICATIONS, appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';

let admin: Pool;
let runtime: Pool;

interface CommandResult {
  readonly partnerId: string;
  readonly eventKey: string;
  readonly action: string;
}

/** Inserts the business row and returns its id. */
async function writePartner(db: DbHandle, displayName: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
     VALUES ($1, 'organization', $2, $3)
     RETURNING id`,
    [TENANT_A, displayName, USER_PERMITTED]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('business partner insert returned no id');
  return id;
}

/**
 * The four writes a real command performs, in the order the pipeline performs
 * them: business state, status history, audit record, outbox event.
 */
async function runCommand(db: DbHandle, tag: string): Promise<CommandResult> {
  const partnerId = await writePartner(db, `fx_p1_13_${tag}`);

  await db.query(
    `INSERT INTO crm.partner_status_history
       (tenant_id, partner_id, status_kind, from_state, to_state, reason, correlation_id)
     VALUES ($1, $2, 'lifecycle', 'prospect', 'active', 'phase 1-13 harness', $3)`,
    [TENANT_A, partnerId, db.context.correlationId]
  );

  const action = `test.p1_13.${tag}`;
  await appendAudit(db, {
    action,
    entityType: 'crm.business_partner',
    entityId: partnerId,
    details: [{ field: 'lifecycle_status', classification: 'internal', value: 'active' }],
  });

  const eventKey = `fx_p1_13_${tag}_${randomUUID()}`;
  await publishEvent(db, {
    // The catalog reserves names; P1-13 implements none of them. This entry is
    // used as a stand-in purely because its aggregate type matches the row
    // written above and `buildEventEnvelope` refuses an unregistered name.
    eventType: 'business-partner.merged',
    aggregateId: partnerId,
    aggregateVersion: 1,
    producer: 'crm',
    payload: { partnerId },
    eventKey,
  });

  return { partnerId, eventKey, action };
}

async function countsFor(result: CommandResult): Promise<{
  partners: number;
  history: number;
  audit: number;
  outbox: number;
}> {
  return {
    partners: await countRows(admin, 'crm.business_partners', 'id = $1', [result.partnerId]),
    history: await countRows(admin, 'crm.partner_status_history', 'partner_id = $1', [
      result.partnerId,
    ]),
    audit: await countRows(admin, 'iam.audit_records', 'tenant_id = $1 AND action = $2', [
      TENANT_A,
      result.action,
    ]),
    outbox: await countRows(admin, 'shared.event_outbox', 'tenant_id = $1 AND event_key = $2', [
      TENANT_A,
      result.eventKey,
    ]),
  };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

beforeEach(() => {
  __resetCapabilitiesForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('the four foundation writes commit together', () => {
  it('leaves exactly one row in each place when the command succeeds', async () => {
    const result = await withTransaction(contextFor({}), (db) => runCommand(db, 'committed'));

    expect(await countsFor(result)).toEqual({ partners: 1, history: 1, audit: 1, outbox: 1 });

    // The audit chain is the reason audit_append is the only writer: the record
    // must be linked, not merely present.
    const linked = await countRows(
      admin,
      'iam.audit_integrity_links l JOIN iam.audit_records r ON r.id = l.audit_record_id',
      'r.tenant_id = $1 AND r.action = $2',
      [TENANT_A, result.action]
    );
    expect(linked).toBe(1);
  });

  it('records what each field changed from and to, masked by its classification', async () => {
    // A count of audit rows says nothing about their contents. `appendAudit`
    // takes {field, classification, previousValue, value} while the database
    // reads {field, old, new, class} out of each JSON element, so the two must
    // be translated — and a mismatch is invisible to a row count: the record
    // still lands, saying only that some field changed.
    const action = `test.p1_13.detail_${randomUUID()}`;
    await withTransaction(contextFor({}), (db) =>
      appendAudit(db, {
        action,
        entityType: 'crm.business_partner',
        details: [
          {
            field: 'display_name',
            classification: 'internal',
            previousValue: 'Before',
            value: 'After',
          },
          { field: 'tax_number', classification: 'restricted', previousValue: 'T-1', value: 'T-2' },
          { field: 'api_token', classification: 'secret', previousValue: 'old', value: 'new' },
        ],
      })
    );

    const stored = await admin.query<{
      field_name: string;
      old_value_masked: string | null;
      new_value_masked: string | null;
      value_classification: string;
    }>(
      `SELECT d.field_name, d.old_value_masked, d.new_value_masked, d.value_classification
         FROM iam.audit_record_details d
         JOIN iam.audit_records r ON r.id = d.audit_record_id
        WHERE r.tenant_id = $1 AND r.action = $2
        ORDER BY d.field_name`,
      [TENANT_A, action]
    );

    expect(stored.rows).toEqual([
      // Restricted and secret collapse to the marker; the raw value never lands.
      {
        field_name: 'api_token',
        old_value_masked: '***',
        new_value_masked: '***',
        value_classification: 'secret',
      },
      {
        field_name: 'display_name',
        old_value_masked: 'Before',
        new_value_masked: 'After',
        value_classification: 'internal',
      },
      {
        field_name: 'tax_number',
        old_value_masked: '***',
        new_value_masked: '***',
        value_classification: 'restricted',
      },
    ]);
  });

  it('accepts every classification the database allows, and no other', async () => {
    // ck_audit_record_details_class is the contract. A value outside it aborts
    // the whole command on a CHECK violation — and the rejected row, raw values
    // included, appears in the PostgreSQL error DETAIL before masking runs.
    const { rows } = await admin.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint WHERE conname = 'ck_audit_record_details_class'`
    );
    const definition = rows[0]?.definition ?? '';
    for (const classification of AUDIT_CLASSIFICATIONS) {
      expect(definition, `${classification} must be accepted by the database`).toContain(
        `'${classification}'`
      );
    }
    // Exactly four, so a value added to the database without being added here
    // (or vice versa) is caught.
    expect(definition.match(/'[a-z]+'::text/g)).toHaveLength(AUDIT_CLASSIFICATIONS.length);
  });
});

describe('the four foundation writes roll back together', () => {
  it('leaves ZERO rows in each place when the command throws after the outbox write', async () => {
    let observed: CommandResult | undefined;

    await expect(
      withTransaction(contextFor({}), async (db) => {
        observed = await runCommand(db, 'rolled_back');
        // Injected failure AFTER all four writes: the hardest case, because
        // every one of them already succeeded at the statement level.
        throw new Error('injected failure after the outbox write');
      })
    ).rejects.toThrow('injected failure after the outbox write');

    expect(observed).toBeDefined();
    expect(await countsFor(observed as CommandResult)).toEqual({
      partners: 0,
      history: 0,
      audit: 0,
      outbox: 0,
    });
  });

  it('does not leave the audit chain with a gap after a rollback', async () => {
    const before = await admin.query<{ report: { ok: boolean } }>(
      'SELECT iam.audit_verify_chain($1) AS report',
      [TENANT_A]
    );
    expect(before.rows[0]?.report.ok).toBe(true);

    await expect(
      withTransaction(contextFor({}), async (db) => {
        await runCommand(db, 'chain_gap');
        throw new Error('injected failure');
      })
    ).rejects.toThrow('injected failure');

    const after = await admin.query<{ report: { ok: boolean } }>(
      'SELECT iam.audit_verify_chain($1) AS report',
      [TENANT_A]
    );
    expect(after.rows[0]?.report.ok).toBe(true);
  });
});

describe('savepoints scope a failure to the nested block only', () => {
  it('keeps the outer write and discards only the inner one', async () => {
    const outerName = `fx_p1_13_outer_${randomUUID()}`;
    const innerName = `fx_p1_13_inner_${randomUUID()}`;

    const outerId = await withTransaction(contextFor({}), async (db) => {
      const id = await writePartner(db, outerName);

      await expect(
        withSavepoint(db, async (nested) => {
          expect(nested.depth).toBe(db.depth + 1);
          await writePartner(nested, innerName);
          throw new Error('inner step failed');
        })
      ).rejects.toThrow('inner step failed');

      // The outer transaction is still usable — that is the whole point of a
      // savepoint, as opposed to letting the failure abort everything.
      const stillAlive = await db.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM crm.business_partners WHERE display_name = $1',
        [outerName]
      );
      expect(stillAlive.rows[0]?.total).toBe('1');
      return id;
    });

    expect(await countRows(admin, 'crm.business_partners', 'id = $1', [outerId])).toBe(1);
    expect(await countRows(admin, 'crm.business_partners', 'display_name = $1', [innerName])).toBe(
      0
    );
  });
});

describe('a read-only transaction is enforced by the database', () => {
  it('rejects a write with read_only_sql_transaction', async () => {
    await withReadOnlyTransaction(contextFor({}), async (db) => {
      const state = await expectSqlState(
        db.query(
          `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
           VALUES ($1, 'organization', $2, $3)`,
          [TENANT_A, `fx_p1_13_readonly_${randomUUID()}`, USER_PERMITTED]
        ),
        '25006'
      );
      expect(state).toBe('25006');
    });
  });

  it('still serves reads under the same context', async () => {
    const rows = await withReadOnlyTransaction(contextFor({}), (db) =>
      db.query<{ id: string }>('SELECT id FROM org.tenants WHERE id = iam.current_tenant_id()')
    );
    expect(rows.rows[0]?.id).toBe(TENANT_A);
  });
});
