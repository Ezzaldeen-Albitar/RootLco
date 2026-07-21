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
