/**
 * Protects the shape and the safety of every emitted log record.
 *
 * The standard field set is what makes one correlation ID searchable across web
 * and worker without per-call-site discipline; if a field silently stops being
 * emitted, nothing breaks until an incident, when the trail is already cold. And
 * because `context` is the field callers actually reach for, it is also the one
 * that will eventually be handed a row containing a credential — so the record is
 * asserted to be scrubbed at the emitted-line level, not merely at the helper.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { DestinationStream } from 'pino';
import { log, baseLogger, __resetLoggerForTests } from '@/server/observability/logger';
import { REDACTED } from '@/server/observability/redaction';
import { APP_NAME, APP_VERSION } from '@/shared/constants/app';

const CORRELATION_ID = '0f6a2f1e-5c2d-4a5b-8f2c-1a2b3c4d5e6f';
const CAUSATION_ID = '9b1c3d4e-6f70-4182-9345-a6b7c8d9e0f1';
const TENANT_REF = '11111111-2222-4333-8444-555555555555';
const ACTOR_REF = '66666666-7777-4888-8999-aaaaaaaaaaaa';

/** Collects emitted lines. Pino only requires a `write(string)` sink. */
function collector(): { destination: DestinationStream; records: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  return {
    destination: {
      write(chunk: string): void {
        chunks.push(chunk);
      },
    },
    records: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

afterEach(() => {
  // Restore the process-wide logger so a later suite is not writing into a
  // collector that no longer exists.
  __resetLoggerForTests();
});

describe('structured log records', () => {
  it('emits the standard field set on one JSON line', () => {
    const sink = collector();
    __resetLoggerForTests(sink.destination);

    log.info('operation completed', {
      module: 'foundation',
      operation: 'foundation.probe',
      correlationId: CORRELATION_ID,
      causationId: CAUSATION_ID,
      tenantRef: TENANT_REF,
      actorRef: ACTOR_REF,
      durationMs: 12,
      result: 'success',
      errorCode: 'ERR-RES-001',
    });

    const records = sink.records();
    expect(records).toHaveLength(1);
    const record = records[0]!;

    expect(record.severity).toBe('info');
    expect(record.service).toBe(APP_NAME);
    expect(record.version).toBe(APP_VERSION);
    expect(typeof record.env).toBe('string');
    expect((record.env as string).length).toBeGreaterThan(0);
    expect(typeof record.time).toBe('string');
    expect(record.module).toBe('foundation');
    expect(record.operation).toBe('foundation.probe');
    expect(record.correlationId).toBe(CORRELATION_ID);
    expect(record.causationId).toBe(CAUSATION_ID);
    expect(record.tenantRef).toBe(TENANT_REF);
    expect(record.actorRef).toBe(ACTOR_REF);
    expect(record.durationMs).toBe(12);
    expect(record.result).toBe('success');
    expect(record.errorCode).toBe('ERR-RES-001');
    expect(record.msg).toBe('operation completed');
  });

  it('omits fields the caller did not supply rather than emitting nulls', () => {
    const sink = collector();
    __resetLoggerForTests(sink.destination);

    log.warn('bare record');

    const record = sink.records()[0]!;
    for (const absent of [
      'module',
      'operation',
      'correlationId',
      'causationId',
      'tenantRef',
      'actorRef',
      'durationMs',
      'result',
      'errorCode',
      'context',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(record, absent)).toBe(false);
    }
  });

  it('emits each severity under the `severity` key, not pino numeric levels', () => {
    const sink = collector();
    __resetLoggerForTests(sink.destination);

    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(sink.records().map((record) => record.severity)).toEqual([
      'debug',
      'info',
      'warn',
      'error',
    ]);
    expect(sink.records().every((record) => record.level === undefined)).toBe(true);
  });

  it('pre-binds fields on a child logger', () => {
    const sink = collector();
    __resetLoggerForTests(sink.destination);

    const child = log.child({ module: 'outbox-worker', correlationId: CORRELATION_ID });
    child.info('claimed a batch', { durationMs: 3, result: 'success' });

    const record = sink.records()[0]!;
    expect(record.module).toBe('outbox-worker');
    expect(record.correlationId).toBe(CORRELATION_ID);
    expect(record.durationMs).toBe(3);
  });
});

describe('log safety', () => {
  it('never emits a secret passed through `context`', () => {
    const sink = collector();
    __resetLoggerForTests(sink.destination);

    const secret = 'rootlco-unit-test-service-role-value-4f2a';
    log.error('upstream rejected the call', {
      module: 'foundation',
      correlationId: CORRELATION_ID,
      result: 'failure',
      context: {
        apiKey: secret,
        nested: { sessionToken: secret },
        rows: [{ password: secret }],
        safe: 'visible',
      },
    });

    const raw = JSON.stringify(sink.records()[0]);
    expect(raw).not.toContain(secret);
    expect(raw).toContain(REDACTED);
    expect(raw).toContain('visible');
  });

  it('scrubs the message itself, which is often an upstream error string', () => {
    const sink = collector();
    __resetLoggerForTests(sink.destination);

    const bearer = ['Bearer ', 'rootlco-unit-test-token-0123456789'].join('');
    log.error(`upstream said: ${bearer}`, { correlationId: CORRELATION_ID });

    const record = sink.records()[0]!;
    expect(record.msg).toBe(`upstream said: ${REDACTED}`);
  });

  it('neutralises a newline in the message so one call cannot forge two records', () => {
    const sink = collector();
    __resetLoggerForTests(sink.destination);

    log.warn('real record\n{"severity":"info","msg":"forged"}', {
      correlationId: CORRELATION_ID,
    });

    const records = sink.records();
    expect(records).toHaveLength(1);
    expect(records[0]!.msg).toContain('\\x0a');
  });
});

describe('logger construction', () => {
  it('rebuilds the process-wide instance when the test seam is reset', () => {
    const first = baseLogger();
    expect(baseLogger()).toBe(first);

    __resetLoggerForTests();
    expect(baseLogger()).not.toBe(first);
  });
});
