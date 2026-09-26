/**
 * Protects the rule that an error-monitoring adapter only ever receives a
 * sanitised event.
 *
 * Sanitisation is done at the capture boundary rather than inside the adapter on
 * purpose: a third-party SDK installed later must be structurally incapable of
 * receiving a raw error object carrying request bodies, headers, or database
 * rows. That guarantee is only real if the boundary is proven to scrub the
 * message, the stack, and the caller-supplied context — the three places a
 * credential actually arrives.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DestinationStream } from 'pino';
import {
  RecordingErrorMonitor,
  captureException,
  errorMonitor,
  setErrorMonitor,
  __resetMonitorForTests,
  type MonitoringEvent,
} from '@/server/observability/monitoring';
import { REDACTED } from '@/server/observability/redaction';
import { __resetLoggerForTests } from '@/server/observability/logger';
import { AppFailure } from '@/server/errors/app-failure';

const CORRELATION_ID = '0f6a2f1e-5c2d-4a5b-8f2c-1a2b3c4d5e6f';
const TENANT_REF = '11111111-2222-4333-8444-555555555555';

const JWT_LIKE = ['ey', 'JhbGciOiJIUzI1NiJ9', '.', 'ey', 'JzdWIiOiJ4In0', '.', 'c2lnbmF0dXJl'].join(
  ''
);

/** Swallows the recording monitor's own log write so the suite stays quiet. */
const silentSink: DestinationStream = {
  write(): void {
    /* intentionally discarded */
  },
};

let monitor: RecordingErrorMonitor;

beforeEach(() => {
  __resetLoggerForTests(silentSink);
  monitor = __resetMonitorForTests();
});

afterEach(() => {
  __resetLoggerForTests();
  __resetMonitorForTests();
});

describe('captureException sanitisation', () => {
  it('scrubs the message, scrubs the stack, and redacts the context', () => {
    const error = new Error(`upstream rejected ${JWT_LIKE}`);
    captureException(error, {
      correlationId: CORRELATION_ID,
      module: 'foundation',
      operation: 'foundation.probe',
      tenantRef: TENANT_REF,
      errorCode: 'ERR-SYS-001',
      context: { password: 'rootlco-unit-test-value', detail: `bearer ${JWT_LIKE}`, safe: 'keep' },
    });

    const recorded = monitor.recorded();
    expect(recorded).toHaveLength(1);
    const event = recorded[0]!;

    expect(event.message).toBe(`upstream rejected ${REDACTED}`);
    expect(event.errorName).toBe('Error');
    expect(event.errorCode).toBe('ERR-SYS-001');
    expect(event.correlationId).toBe(CORRELATION_ID);
    expect(event.module).toBe('foundation');
    expect(event.operation).toBe('foundation.probe');
    expect(event.tenantRef).toBe(TENANT_REF);

    // The stack is retained — it is the point of error monitoring — but scrubbed.
    expect(event.stack).toBeDefined();
    expect(event.stack).toContain('Error');
    expect(event.stack).not.toContain(JWT_LIKE);

    const context = event.context as Record<string, unknown>;
    expect(context.password).toBe(REDACTED);
    expect(context.detail).toBe(`bearer ${REDACTED}`);
    expect(context.safe).toBe('keep');

    // Nothing anywhere in the event carries the credential.
    expect(JSON.stringify(event)).not.toContain(JWT_LIKE);
  });

  it('defaults severity to error and honours an explicit one', () => {
    captureException(new Error('first'), { correlationId: CORRELATION_ID });
    captureException(new Error('second'), { correlationId: CORRELATION_ID, severity: 'fatal' });

    expect(monitor.recorded().map((event) => event.severity)).toEqual(['error', 'fatal']);
  });

  it('classifies a non-Error throw without inventing a stack', () => {
    captureException('plain string failure', { correlationId: CORRELATION_ID });

    const event = monitor.recorded()[0]!;
    expect(event.message).toBe('plain string failure');
    expect(event.errorName).toBe('string');
    expect(event.stack).toBeUndefined();
  });

  it('records the catalog name for an AppFailure', () => {
    captureException(new AppFailure('ERR-CON-001'), {
      correlationId: CORRELATION_ID,
      errorCode: 'ERR-CON-001',
    });

    const event = monitor.recorded()[0]!;
    expect(event.errorName).toBe('AppFailure');
    expect(event.errorCode).toBe('ERR-CON-001');
  });

  it('omits optional fields the caller did not supply', () => {
    captureException(new Error('bare'), { correlationId: CORRELATION_ID });

    const event = monitor.recorded()[0]!;
    for (const absent of ['errorCode', 'module', 'operation', 'tenantRef', 'actorRef', 'context']) {
      expect(Object.prototype.hasOwnProperty.call(event, absent)).toBe(false);
    }
  });
});

describe('recording transport', () => {
  it('is installed by the test seam and returns the same instance from errorMonitor()', () => {
    expect(errorMonitor()).toBe(monitor);
  });

  it('keeps a bounded ring so a fault storm cannot exhaust memory', () => {
    for (let index = 0; index < 150; index += 1) {
      captureException(new Error(`fault-${index}`), { correlationId: CORRELATION_ID });
    }

    const recorded = monitor.recorded();
    expect(recorded).toHaveLength(100);
    // The ring keeps the most recent faults, which are the ones an incident needs.
    expect(recorded[recorded.length - 1]!.message).toBe('fault-149');
  });

  it('clears on request and returns a copy that cannot mutate the ring', () => {
    captureException(new Error('kept'), { correlationId: CORRELATION_ID });
    const snapshot = monitor.recorded() as MonitoringEvent[];
    snapshot.length = 0;
    expect(monitor.recorded()).toHaveLength(1);

    monitor.clear();
    expect(monitor.recorded()).toHaveLength(0);
  });

  it('routes capture through an installed adapter instead of the default', () => {
    const received: MonitoringEvent[] = [];
    setErrorMonitor({
      capture: (event) => {
        received.push(event);
      },
    });

    captureException(new Error('adapter path'), { correlationId: CORRELATION_ID });

    expect(received).toHaveLength(1);
    expect(received[0]!.message).toBe('adapter path');
    expect(monitor.recorded()).toHaveLength(0);
  });
});

/*
 * A database fault is logged by its structure, never by its words.
 *
 * The driver's message, its `detail` and a RAISE text routinely carry the value
 * the caller submitted — `Key (base_currency_code)=(JOR)`, `invalid input syntax
 * for type uuid: "…"`, an idempotency key. What an operator needs to find the
 * fault is the SQLSTATE, the constraint and the relation it names, and the code
 * path; those are copied field by field, and the stack is reduced to its frame
 * lines, so a message that runs over several lines cannot ride along in it.
 */
describe('database faults are logged by structure', () => {
  const FRAME = /^\s+at /;

  function capturedLines(): string[] {
    const lines: string[] = [];
    __resetLoggerForTests({
      write(chunk: string): void {
        lines.push(chunk);
      },
    });
    return lines;
  }

  function driverError(message: string, fields: Record<string, unknown>): Error {
    const error = new Error(message);
    error.name = 'error';
    return Object.assign(error, { severity: 'ERROR', file: 'ri_triggers.c', ...fields });
  }

  function onlyLine(lines: readonly string[]): {
    readonly raw: string;
    readonly record: { msg: string; context: Record<string, unknown> };
  } {
    expect(lines).toHaveLength(1);
    const raw = lines[0]!;
    return { raw, record: JSON.parse(raw) as { msg: string; context: Record<string, unknown> } };
  }

  it('logs the SQLSTATE, the constraint and the relation of a foreign-key refusal, and never its detail', () => {
    const lines = capturedLines();
    const detail = 'Key (base_currency_code)=(JOR) is not present in table "currencies".';
    captureException(
      driverError(
        'insert or update on table "legal_companies" violates foreign key constraint "fk_legal_companies_base_currency"',
        {
          code: '23503',
          routine: 'ri_ReportViolation',
          constraint: 'fk_legal_companies_base_currency',
          schema: 'org',
          table: 'legal_companies',
          detail,
          where: 'SQL statement "INSERT INTO org.legal_companies ... JOR"',
          hint: 'JOR',
        }
      ),
      { correlationId: CORRELATION_ID, errorCode: 'ERR-SYS-001' }
    );

    const event = monitor.recorded()[0]!;
    expect(event.message).toBe('Database error 23503');
    expect(event.database).toEqual({
      sqlState: '23503',
      constraint: 'fk_legal_companies_base_currency',
      schema: 'org',
      table: 'legal_companies',
      routine: 'ri_ReportViolation',
    });
    expect(event.stackFrames?.length).toBeGreaterThan(0);
    expect(event.stackFrames?.length).toBeLessThanOrEqual(20);
    for (const frame of event.stackFrames ?? []) expect(frame).toMatch(FRAME);

    const { raw, record } = onlyLine(lines);
    expect(record.msg).toBe('Database error 23503');
    const database = record.context.database as Record<string, unknown>;
    expect(database.sqlState).toBe('23503');
    expect(database.constraint).toBe('fk_legal_companies_base_currency');
    expect(database.schema).toBe('org');
    expect(database.table).toBe('legal_companies');
    expect(Array.isArray(record.context.stackFrames)).toBe(true);
    expect((record.context.stackFrames as unknown[]).length).toBeGreaterThan(0);
    for (const leaked of ['JOR', 'Key (', detail, 'INSERT INTO']) {
      expect(raw).not.toContain(leaked);
    }
  });

  it('keeps a value embedded in a multi-line driver message out of the line and the frames', () => {
    const lines = capturedLines();
    captureException(
      driverError(
        'invalid input syntax for type uuid: "submitted-value-one"\ncontinued with submitted-value-two',
        { code: '22P02', routine: 'string_to_uuid' }
      ),
      { correlationId: CORRELATION_ID }
    );

    const event = monitor.recorded()[0]!;
    expect(event.message).toBe('Database error 22P02');
    for (const frame of event.stackFrames ?? []) {
      expect(frame).toMatch(FRAME);
      expect(frame).not.toContain('submitted-value');
    }
    const { raw } = onlyLine(lines);
    expect(raw).not.toContain('submitted-value');
  });

  it('drops a message line that itself looks like a frame from the line and the frames', () => {
    const lines = capturedLines();
    captureException(
      driverError('invalid input syntax for type uuid: "x"\n    at injected (C:\\evil.js:1:1)', {
        code: '22P02',
        routine: 'string_to_uuid',
      }),
      { correlationId: CORRELATION_ID }
    );

    const event = monitor.recorded()[0]!;
    expect(event.message).toBe('Database error 22P02');
    expect(event.stackFrames?.length).toBeGreaterThan(0);
    const { raw, record } = onlyLine(lines);
    const frames = JSON.stringify(record.context.stackFrames);
    for (const leaked of ['injected', 'evil']) {
      expect(raw).not.toContain(leaked);
      expect(frames).not.toContain(leaked);
      expect(JSON.stringify(event.stackFrames)).not.toContain(leaked);
    }
  });

  it('treats a SQLSTATE-shaped code without a server routine or file as an ordinary error', () => {
    const lines = capturedLines();
    const error = Object.assign(new Error('not raised by the server'), {
      code: '23503',
      severity: 'ERROR',
    });
    captureException(error, { correlationId: CORRELATION_ID });

    const event = monitor.recorded()[0]!;
    expect(event.message).toBe('not raised by the server');
    expect(event.message).not.toBe('Database error 23503');
    expect(Object.prototype.hasOwnProperty.call(event, 'database')).toBe(false);
    const { record } = onlyLine(lines);
    expect(record.msg).toBe('not raised by the server');
    expect(record.context.database).toBeUndefined();
  });

  it('logs no idempotency key from a RAISE that names one', () => {
    const lines = capturedLines();
    const key = '7d4c2a10-9b8e-4f3a-a1b2-c3d4e5f6a7b8';
    captureException(
      driverError(`idempotency key ${key} was already used with a DIFFERENT request`, {
        code: '23000',
        routine: 'exec_stmt_raise',
        file: 'pl_exec.c',
      }),
      { correlationId: CORRELATION_ID }
    );

    expect(monitor.recorded()[0]!.message).toBe('Database error 23000');
    expect(JSON.stringify(monitor.recorded()[0]!.stackFrames)).not.toContain(key);
    expect(onlyLine(lines).raw).not.toContain(key);
  });

  it('does not mistake an operating-system error code for a database fault', () => {
    const lines = capturedLines();
    const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE', syscall: 'write' });
    captureException(error, { correlationId: CORRELATION_ID });

    const event = monitor.recorded()[0]!;
    expect(event.message).toBe('write EPIPE');
    expect(Object.prototype.hasOwnProperty.call(event, 'database')).toBe(false);
    expect(onlyLine(lines).record.context.database).toBeUndefined();
  });

  it('adds frame-only stack lines to an ordinary error and leaves its message and stack as they were', () => {
    const lines = capturedLines();
    captureException(new Error('ordinary failure'), { correlationId: CORRELATION_ID });

    const event = monitor.recorded()[0]!;
    expect(event.message).toBe('ordinary failure');
    expect(event.stack).toContain('Error');
    expect(event.stackFrames?.length).toBeGreaterThan(0);
    for (const frame of event.stackFrames ?? []) expect(frame).toMatch(FRAME);
    const { record } = onlyLine(lines);
    expect(record.msg).toBe('ordinary failure');
    expect(record.context.errorName).toBe('Error');
    expect(record.context.monitored).toBe(true);
    expect(record.context.stackFrames).toEqual(event.stackFrames);
  });
});
