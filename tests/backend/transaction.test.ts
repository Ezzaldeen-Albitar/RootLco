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
 * This suite runs on the DBCR-P1-13-001 rehearsal role, because `app_runtime`
 * cannot perform two of the four writes at all — see `helpers.ts` and
 * `capabilities.test.ts`. The behaviour proven here is the behaviour the change
 * request unblocks; the rehearsal is what makes the proof possible without
 * touching a migration.
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
  crRehearsalPool,
  dropCrRehearsalRole,
  ensureBackendFixtures,
  ensureCrRehearsalRole,
  ensureTestLogins,
  expectSqlState,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  withReadOnlyTransaction,
  withSavepoint,
  withTransaction,
  type DbHandle,
} from '@/server/db/transaction';
import { __resetCapabilitiesForTests } from '@/server/db/capabilities';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';

let admin: Pool;
let rehearsal: Pool;

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
  await ensureCrRehearsalRole(admin);
  rehearsal = crRehearsalPool();
  __setPrimaryPoolForTests(rehearsal);
});

beforeEach(() => {
  __resetCapabilitiesForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await rehearsal.end();
  await cleanBackendFixtures(admin);
  await dropCrRehearsalRole(admin);
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
