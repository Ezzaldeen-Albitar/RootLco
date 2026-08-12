import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLISHED_OPERATIONS } from '@/lib/api/idempotent-operations';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import {
  APPOINTMENT_OPERATIONS,
  APPOINTMENT_PERMISSIONS,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  MAX_INSTANT_LENGTH,
  TERMINAL_APPOINTMENT_STATUSES,
  canCancel,
  canRecordNoShow,
  canReschedule,
  hasExplicitUtcOffset,
  validateInstant,
  validateWindow,
} from '@/features/appointments/appointments-contract';

/**
 * The QA-001 contract mirror for the appointment module (P1-28, Wave A).
 *
 * Every row of `APPOINTMENT_OPERATIONS` is held against TWO authorities the
 * module itself does not own — the generated operation manifest
 * (`lib/api/idempotent-operations.ts`) and the published OpenAPI document —
 * so a contract-layer claim that drifts from what the backend registers fails
 * a test rather than waiting for a reviewer. The completeness check runs in
 * BOTH directions: a new `apt.*` operation the backend publishes fails here
 * until this layer covers it, and a row here naming an operation the backend
 * does not publish fails immediately.
 */

const OPENAPI = JSON.parse(
  readFileSync(join(process.cwd(), '..', '..', 'docs', 'api', 'openapi.v1.json'), 'utf8')
) as {
  readonly paths: Record<
    string,
    Record<
      string,
      {
        readonly operationId?: string;
        readonly parameters?: readonly { readonly $ref?: string }[];
        readonly 'x-required-permissions'?: readonly string[];
        readonly 'x-audit-class'?: string;
      }
    >
  >;
};

const IDEMPOTENCY_REF = '#/components/parameters/IdempotencyKey';
const IF_MATCH_REF = '#/components/parameters/IfMatch';

/** A concrete path for a template: every `{param}` becomes a well-formed uuid. */
function concrete(template: string): string {
  return '/api/v1' + template.replace(/\{[^}]+\}/g, '11111111-1111-4111-8111-111111111111');
}

function publishedDocumentOperation(method: string, template: string) {
  const path = OPENAPI.paths[`/api/v1${template}`];
  expect(path, `the OpenAPI document publishes no path /api/v1${template}`).toBeDefined();
  const operation = path?.[method.toLowerCase()];
  expect(operation, `${method} /api/v1${template} is not in the OpenAPI document`).toBeDefined();
  return operation as NonNullable<typeof operation>;
}

describe('every module row mirrors the generated operation manifest', () => {
  it.each(APPOINTMENT_OPERATIONS.map((row) => [row.operationId, row] as const))(
    '%s',
    (_id, row) => {
      const manifest = PUBLISHED_OPERATIONS.find((op) => op.operationId === row.operationId);
      expect(manifest, `${row.operationId} is not in the generated manifest`).toBeDefined();
      expect(manifest?.method).toBe(row.method);
      expect(manifest?.template).toBe(row.template);
      expect(manifest?.idempotent).toBe(row.idempotent);
      expect(manifest?.auditClass).toBe(row.auditClass);

      // The resolver must land a CONCRETE request path on this very operation
      // — a template that merely exists but loses path resolution would attach
      // the wrong contract to the wrong call.
      expect(resolveOperation(row.method, concrete(row.template))?.operationId).toBe(
        row.operationId
      );
      expect(requiresIdempotencyKey(row.method, concrete(row.template))).toBe(row.idempotent);
    }
  );

  it.each(APPOINTMENT_OPERATIONS.map((row) => [row.operationId, row] as const))(
    '%s carries the published permission, idempotency and version guard',
    (_id, row) => {
      const operation = publishedDocumentOperation(row.method, row.template);
      expect(operation.operationId).toBe(row.operationId);
      // ONE permission per operation, and exactly the one the row names.
      expect(operation['x-required-permissions']).toEqual([row.permission]);
      expect(operation['x-audit-class']).toBe(row.auditClass);

      const refs = (operation.parameters ?? []).map((parameter) => parameter.$ref);
      expect(refs.includes(IDEMPOTENCY_REF), 'IdempotencyKey parameter').toBe(row.idempotent);
      expect(refs.includes(IF_MATCH_REF), 'IfMatch parameter').toBe(row.versionGuarded);
    }
  );

  it('covers every published apt.* operation, and invents none', () => {
    const published = PUBLISHED_OPERATIONS.filter((op) => op.operationId.startsWith('apt.'))
      .map((op) => op.operationId)
      .sort();
    const mirrored = APPOINTMENT_OPERATIONS.map((row) => row.operationId).sort();
    expect(mirrored).toEqual(published);
  });

  it('names each operation exactly once', () => {
    const ids = APPOINTMENT_OPERATIONS.map((row) => row.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the contract facts the archaeology pinned', () => {
  it('has NO confirm operation — confirmation is a side effect of reschedule', () => {
    // UC-APT-001 is one use case. A "Confirm" control would call an operation
    // that does not exist; setting a firm window through reschedule IS the
    // confirmation, and it moves the status in the same statement.
    const aptOperations = PUBLISHED_OPERATIONS.filter((op) => op.operationId.startsWith('apt.'));
    for (const operation of aptOperations) {
      expect(operation.operationId).not.toMatch(/confirm/);
      expect(operation.template).not.toMatch(/confirm/);
    }
    const reschedule = APPOINTMENT_OPERATIONS.find(
      (row) => row.operationId === 'apt.appointment-reschedule'
    );
    expect(reschedule?.versionGuarded).toBe(true);
  });

  it('guards exactly the three lifecycle commands with If-Match', () => {
    const guarded = APPOINTMENT_OPERATIONS.filter((row) => row.versionGuarded)
      .map((row) => row.operationId)
      .sort();
    expect(guarded).toEqual([
      'apt.appointment-cancel',
      'apt.appointment-no-show',
      'apt.appointment-reschedule',
    ]);
  });

  it('requires an idempotency key on every write and on no read', () => {
    for (const row of APPOINTMENT_OPERATIONS) {
      expect(row.idempotent, row.operationId).toBe(row.method === 'POST');
    }
  });

  it('splits arranging from ending across two permission codes', () => {
    // Booking/rescheduling and cancelling/no-show are DIFFERENT authorities —
    // seeded as separate codes — so one gate must never render both control
    // groups.
    expect(APPOINTMENT_PERMISSIONS.manage).toBe('apt.appointment.manage');
    expect(APPOINTMENT_PERMISSIONS.lifecycleManage).toBe('apt.appointment.lifecycle.manage');
    expect(APPOINTMENT_PERMISSIONS.manage).not.toBe(APPOINTMENT_PERMISSIONS.lifecycleManage);
  });
});

describe('the lifecycle mirror matches the frozen CHECK constraint', () => {
  it('states exactly the six ck_appointments_status values, in order', () => {
    // Read from the migration that owns the constraint, so an invented value
    // fails here rather than rendering a raw key to an operator.
    const sql = readFileSync(
      join(
        process.cwd(),
        '..',
        '..',
        'supabase',
        'migrations',
        '20260721092000_apt_appointments.sql'
      ),
      'utf8'
    );
    const index = sql.indexOf('ck_appointments_status');
    expect(index).toBeGreaterThan(-1);
    const inList = /IN\s*\(([^)]*)\)/.exec(sql.slice(index));
    const database = [...(inList?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...APPOINTMENT_STATUSES].sort()).toEqual([...database].sort());
  });

  it('gives every status a transition row, and terminal states an empty one', () => {
    expect(Object.keys(APPOINTMENT_TRANSITIONS).sort()).toEqual([...APPOINTMENT_STATUSES].sort());
    for (const status of TERMINAL_APPOINTMENT_STATUSES) {
      expect(APPOINTMENT_TRANSITIONS[status]).toEqual([]);
    }
  });

  it('offers reschedule from every non-terminal state and from no terminal one', () => {
    expect(canReschedule('requested')).toBe(true);
    expect(canReschedule('pending_confirmation')).toBe(true);
    expect(canReschedule('confirmed')).toBe(true);
    expect(canReschedule('checked_in')).toBe(false);
    expect(canReschedule('cancelled')).toBe(false);
    expect(canReschedule('no_show')).toBe(false);
  });

  it('offers no-show from confirmed ONLY', () => {
    // You cannot fail to show up for an appointment nobody confirmed. Offering
    // it elsewhere would submit a command whose only possible answer is 409
    // ERR-TRN-001.
    for (const status of APPOINTMENT_STATUSES) {
      expect(canRecordNoShow(status), status).toBe(status === 'confirmed');
    }
  });

  it('offers cancel from every non-terminal state', () => {
    for (const status of APPOINTMENT_STATUSES) {
      expect(canCancel(status), status).toBe(!TERMINAL_APPOINTMENT_STATUSES.includes(status));
    }
  });
});

describe('the window rules mirror the module domain', () => {
  it('accepts Z and bounded numeric offsets, and refuses their absence', () => {
    expect(hasExplicitUtcOffset('2026-08-30T09:00:00Z')).toBe(true);
    expect(hasExplicitUtcOffset('2026-08-30T09:00:00+03:00')).toBe(true);
    expect(hasExplicitUtcOffset('2026-08-30T09:00:00-11:30')).toBe(true);
    // A timezone-less local timestamp would be resolved against the SERVER
    // zone — a real booking on the wrong hour.
    expect(hasExplicitUtcOffset('2026-08-30T09:00:00')).toBe(false);
  });

  it('refuses an offset wider than PostgreSQL accepts', () => {
    // V8 parses +16:00 happily; timestamptz refuses it as 22009, which nothing
    // maps — so the bound is enforced where the field is (±15:59).
    expect(hasExplicitUtcOffset('2026-08-30T09:00:00+15:59')).toBe(true);
    expect(hasExplicitUtcOffset('2026-08-30T09:00:00+16:00')).toBe(false);
  });

  it('validates a single instant with a named refusal', () => {
    expect(validateInstant('')).toBe('empty');
    expect(validateInstant('   ')).toBe('empty');
    expect(validateInstant('x'.repeat(MAX_INSTANT_LENGTH + 1))).toBe('too_long');
    expect(validateInstant('2026-08-30T09:00:00')).toBe('missing_offset');
    expect(validateInstant('not-a-date-at-allZ')).toBe('unparseable');
    expect(validateInstant('2026-08-30T09:00:00Z')).toBe('ok');
  });

  it('requires the end to be STRICTLY after the start, compared as instants', () => {
    expect(validateWindow('2026-08-30T09:00:00Z', '2026-08-30T10:00:00Z')).toEqual({});
    expect(validateWindow('2026-08-30T09:00:00Z', '2026-08-30T09:00:00Z')).toEqual({
      to: 'not_after_start',
    });
    // Chronologically ordered but lexically inverted across mixed offsets — a
    // string comparison would refuse it.
    expect(validateWindow('2026-08-30T12:00:00+05:00', '2026-08-30T09:00:00Z')).toEqual({});
  });

  it('reports both halves independently', () => {
    expect(validateWindow('', '2026-08-30T10:00:00')).toEqual({
      from: 'empty',
      to: 'missing_offset',
    });
  });

  it('bounds the instant exactly as the route schema does', () => {
    expect(MAX_INSTANT_LENGTH).toBe(64);
  });
});
