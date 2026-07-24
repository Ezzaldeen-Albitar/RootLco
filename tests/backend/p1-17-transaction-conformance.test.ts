/**
 * Controlled-transaction conformance for the vehicle module (Phase 1-17,
 * P1-17-BE-016, BR-INT-001).
 *
 * A vehicle command that changes state also writes its audit record and — where
 * the operation announces a change — its outbox event, and the frozen `veh`
 * triggers write the append-only history in the same transaction. BE-016 is the
 * proof that those land together or not at all: an audit record surviving a
 * rolled-back command is a lie; a committed command with no audit is an integrity
 * hole; an outbox event for a rolled-back command is the dual-write failure the
 * transactional outbox exists to prevent.
 *
 * Two representative shapes are exercised through the REAL module services on the
 * deployed `app_runtime` identity:
 *   - row + audit + event  (vehicle create → vehicle.created; the event carries the
 *     command's correlation id)
 *   - row + audit + ledger, NO event (status change → append-only status ledger only)
 * Each is asserted on success (exactly the right rows) and on an injected post-write
 * failure (zero rows everywhere).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { vehicleModule } from '@/modules/vehicle';

let admin: Pool;
let runtime: Pool;

async function vehicleCount(vehicleId: string): Promise<number> {
  return countRows(admin, 'veh.vehicles', 'id = $1', [vehicleId]);
}
async function auditCount(action: string, vehicleId: string): Promise<number> {
  return countRows(
    admin,
    'iam.audit_records',
    'tenant_id = $1 AND action = $2 AND entity_id = $3',
    [TENANT_A, action, vehicleId]
  );
}
async function outboxCount(aggregateId: string): Promise<number> {
  return countRows(admin, 'shared.event_outbox', 'tenant_id = $1 AND aggregate_id = $2', [
    TENANT_A,
    aggregateId,
  ]);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('veh.vehicle.manage','veh','Create and edit vehicles','medium',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    ['c1300000-0000-4000-8000-000000000001']
  );
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('row + audit + event (vehicle create) is one transaction', () => {
  it('commits exactly one row, one audit, and one event that share the correlation id', async () => {
    const correlationId = randomUUID();
    const { vehicleId } = await withTransaction(contextFor({ correlationId }), (db) =>
      vehicleModule().vehicleWrite.create(db, {})
    );

    expect(await vehicleCount(vehicleId)).toBe(1);
    expect(await auditCount('veh.vehicle.created', vehicleId)).toBe(1);
    expect(await outboxCount(vehicleId)).toBe(1);

    // The event was written in the same controlled transaction, so it carries the
    // command's correlation id — the thread that ties the announcement to the change.
    const event = await admin.query<{ correlation_id: string | null; event_key: string }>(
      `SELECT correlation_id, event_key FROM shared.event_outbox WHERE aggregate_id = $1`,
      [vehicleId]
    );
    expect(event.rows[0]?.correlation_id).toBe(correlationId);
    expect(event.rows[0]?.event_key).toBe(`vehicle.created:${vehicleId}`);
  });

  it('rolls ALL THREE back on an injected failure after every write succeeded', async () => {
    let captured = '';
    await expect(
      withTransaction(contextFor({}), async (db) => {
        const created = await vehicleModule().vehicleWrite.create(db, {});
        captured = created.vehicleId;
        // Hardest case: the row, its audit, and its outbox event have all already
        // succeeded at the statement level.
        throw new Error('injected failure after the outbox write');
      })
    ).rejects.toThrow('injected failure after the outbox write');

    expect(captured).not.toBe('');
    expect(await vehicleCount(captured)).toBe(0);
    expect(await auditCount('veh.vehicle.created', captured)).toBe(0);
    expect(await outboxCount(captured)).toBe(0);
  });
});

describe('row + audit, no event (status change) is one transaction', () => {
  it('commits the master change, its audit, and the ledger row together, and adds no event', async () => {
    const vehicleId = await withTransaction(
      contextFor({}),
      async (db) =>
        (
          await vehicleModule().vehicleWrite.create(db, {
            vin: `CONFVIN${randomUUID().slice(0, 6)}`,
          })
        ).vehicleId
    );
    const beforeEvents = await outboxCount(vehicleId);

    await withTransaction(contextFor({}), (db) =>
      vehicleModule().vehicleLifecycle.changeStatus(db, vehicleId, { lifecycleStatus: 'active' })
    );

    const master = await admin.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM veh.vehicles WHERE id = $1`,
      [vehicleId]
    );
    expect(master.rows[0]?.lifecycle_status).toBe('active');
    expect(await auditCount('veh.vehicle.status_changed', vehicleId)).toBe(1);
    // A status change announces nothing: no event beyond the create's.
    expect(await outboxCount(vehicleId)).toBe(beforeEvents);

    // The frozen AFTER-UPDATE trigger wrote the append-only status-history row in
    // the same controlled transaction as the master change (one row per axis).
    const ledger = await countRows(
      admin,
      'veh.vehicle_status_history',
      "vehicle_id = $1 AND status_kind = 'lifecycle' AND to_state = 'active'",
      [vehicleId]
    );
    expect(ledger).toBe(1);
  });

  it('rolls the master change and its audit back together on an injected failure', async () => {
    const vehicleId = await withTransaction(
      contextFor({}),
      async (db) =>
        (
          await vehicleModule().vehicleWrite.create(db, {
            vin: `CONFVIN${randomUUID().slice(0, 6)}`,
          })
        ).vehicleId
    );
    await withTransaction(contextFor({}), (db) =>
      vehicleModule().vehicleLifecycle.changeStatus(db, vehicleId, { lifecycleStatus: 'active' })
    );
    expect(await auditCount('veh.vehicle.status_changed', vehicleId)).toBe(1);

    await expect(
      withTransaction(contextFor({}), async (db) => {
        await vehicleModule().vehicleLifecycle.changeStatus(db, vehicleId, {
          lifecycleStatus: 'inactive',
        });
        throw new Error('injected failure after the status write');
      })
    ).rejects.toThrow('injected failure after the status write');

    // The rolled-back transition left neither the master nor a second audit behind.
    const master = await admin.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM veh.vehicles WHERE id = $1`,
      [vehicleId]
    );
    expect(master.rows[0]?.lifecycle_status).toBe('active');
    expect(await auditCount('veh.vehicle.status_changed', vehicleId)).toBe(1);
  });
});
