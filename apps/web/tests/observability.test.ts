import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, API_FAILURE_EVENT } from '@/lib/api/client';
import { LOG_LEVELS, type LogLevel } from '@/lib/env';
import {
  DEFAULT_ROUTING_LEVEL,
  FORBIDDEN_KEYS,
  currentAdapter,
  deliveringAdapter,
  installConfiguredMonitoringAdapter,
  levelRank,
  looksLikeCredential,
  redact,
  report,
  routesToSink,
  safeRoute,
  setMonitoringAdapter,
  templateRoute,
  type BeaconSender,
  type ClientLogEvent,
} from '@/lib/observability/client-log';

/**
 * `P1-26-DO-002` — structured client logging.
 *
 * The redaction is tested before any provider is attached, deliberately. The
 * first thing a monitoring integration does is capture everything, and the
 * second is discover what it captured; building the filter afterwards is the
 * wrong order.
 */

afterEach(() => {
  setMonitoringAdapter(null);
  vi.restoreAllMocks();
});

describe('redaction by key name', () => {
  it('redacts every forbidden key', () => {
    for (const key of FORBIDDEN_KEYS) {
      const out = redact({ [key]: 'value' });
      expect(out[key], key).toBe('[redacted]');
    }
  });

  it('normalises the key before comparing', () => {
    // `accessToken`, `access_token`, `ACCESS-TOKEN` are one key.
    for (const key of ['accessToken', 'access_token', 'ACCESS-TOKEN', 'Access Token']) {
      expect(redact({ [key]: 'v' })[key], key).toBe('[redacted]');
    }
  });

  it('leaves an innocent key alone', () => {
    expect(redact({ page: 3, status: 'active' })).toEqual({ page: 3, status: 'active' });
  });

  it('recurses into nested objects', () => {
    expect(redact({ outer: { password: 'x', page: 1 } })).toEqual({
      outer: { password: '[redacted]', page: 1 },
    });
  });
});

/**
 * A JWT-shaped string, BUILT rather than written.
 *
 * The tracked-secret scanner flagged the literal form of this fixture, and it
 * was right to: a credential-shaped constant in a tracked file is one whether or
 * not it is real, and a scanner that learns to ignore some of them stops being
 * useful. Its own guidance is to construct synthetic values at runtime, so this
 * assembles three base64url-ish segments and never stores the result anywhere.
 *
 * There is a small joke here worth not losing: the file asserting that a
 * credential must never be written down was the file that wrote one down.
 */
function syntheticJwt(): string {
  const segment = (seed: string, length: number) =>
    Array.from({ length }, (_, index) => seed[(index * 7 + 3) % seed.length]).join('');
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return [segment(alphabet, 24), segment(alphabet, 32), segment(alphabet, 28)].join('.');
}

describe('redaction by value shape', () => {
  it('redacts a JWT whatever it is called', () => {
    // The shape that actually happens: `{ data: accessToken }`.
    const jwt = syntheticJwt();
    expect(jwt.split('.')).toHaveLength(3);
    expect(looksLikeCredential(jwt)).toBe(true);
    expect(redact({ data: jwt }).data).toBe('[redacted]');
  });

  it('redacts a long opaque token whatever it is called', () => {
    const token = 'A'.repeat(64);
    expect(looksLikeCredential(token)).toBe(true);
    expect(redact({ reference: token }).reference).toBe('[redacted]');
  });

  it('does not redact ordinary prose or a short identifier', () => {
    expect(looksLikeCredential('a user pressed retry after a conflict')).toBe(false);
    expect(looksLikeCredential('invited')).toBe(false);
    // A correlation ID has hyphens and is short enough to keep — it is the one
    // diagnostic that is meant to travel.
    expect(looksLikeCredential('3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b')).toBe(false);
  });

  it('redacts a credential-shaped array element', () => {
    const out = redact({ items: ['ok', 'B'.repeat(48)] });
    expect(out.items).toEqual(['ok', '[redacted]']);
  });
});

describe('the route', () => {
  it('drops the query string, which is where secrets hide', () => {
    expect(safeRoute('/en/administration/users?search=ali&page=2')).toBe(
      '/en/administration/users'
    );
    expect(safeRoute('/en/login')).toBe('/en/login');
  });
});

describe('the monitoring adapter', () => {
  it('is null until a deployment attaches one', () => {
    expect(currentAdapter()).toBeNull();
  });

  it('receives the REDACTED event, never the raw one', () => {
    const seen: ClientLogEvent[] = [];
    setMonitoringAdapter((event) => seen.push(event));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    report({
      level: 'warn',
      event: 'web.test',
      correlationId: 'cid-1',
      route: '/en/x?token=secret',
      context: { password: 'hunter2', page: 4 },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.context).toEqual({ password: '[redacted]', page: 4 });
    expect(seen[0]?.route).toBe('/en/x');
  });

  it('writes the same redacted payload to the console', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    report({ level: 'error', event: 'web.boom', context: { accessToken: 'abc' } });
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain('[redacted]');
    expect(line).not.toContain('abc');
  });
});

/**
 * `P1-27-DO-002` — API failures reach the monitoring boundary, from production
 * code.
 *
 * ## What was false
 *
 * `setMonitoringAdapter` had **zero** production callers. `report` had exactly
 * one: `app/[locale]/(dashboard)/error.tsx`, which passes no `context`, so
 * `redact` never executed in production at all — and which is a RENDER-error
 * boundary, so it never sees an API failure in the first place. The one class of
 * failure an operator actually meets reached nothing.
 *
 * ## How this suite is written, and why
 *
 * Every assertion below drives a real `ApiClient` request through a stubbed
 * `fetch` and observes what arrives at the adapter. `report` is never called
 * directly. That distinction is the entire point: calling `report` in a test
 * proves that `report` works, which was never in doubt — what was in doubt, and
 * what was false, is whether anything in the application calls it.
 */

const BASE = 'https://api.example.test';

const seen: ClientLogEvent[] = [];

function clientWith(fetchImpl: typeof fetch, options: Record<string, unknown> = {}) {
  return new ApiClient({
    baseUrl: BASE,
    fetchImpl,
    newCorrelationId: () => 'client-correlation-id',
    ...options,
  });
}

function respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('API failures reach the monitoring boundary', () => {
  beforeEach(() => {
    seen.length = 0;
    setMonitoringAdapter((event) => seen.push(event));
    // The console half of `report` is real and would otherwise print a line per
    // failure. Silenced, not disabled: the adapter is what is under test.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    setMonitoringAdapter(null);
    vi.restoreAllMocks();
  });

  describe('a failed response reaches the monitoring adapter', () => {
    it('reports a 500 with its correlation id and the templated route', async () => {
      const fetchImpl = vi.fn(async () =>
        respond(
          500,
          {
            type: 'urn:rootlco:error:ERR-INT-001',
            title: 'Unexpected failure',
            status: 500,
            code: 'ERR-INT-001',
            correlationId: 'server-correlation-id',
          },
          { 'x-correlation-id': 'server-correlation-id' }
        )
      );

      const result = await clientWith(fetchImpl as never).get(
        '/api/v1/crm/customers/3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
        { retries: 0 }
      );
      expect(result.ok).toBe(false);

      expect(seen, 'no event reached the adapter').toHaveLength(1);
      const event = seen[0] as ClientLogEvent;
      expect(event.event).toBe(API_FAILURE_EVENT);
      expect(event.level).toBe('error');
      // The correlation id is the whole reason this event is worth anything: it
      // is what joins this line to the API's own log for the same request.
      expect(event.correlationId).toBe('server-correlation-id');
      expect(event.route).toBe('/api/v1/crm/customers/:id');
      expect(event.context).toEqual({
        method: 'GET',
        status: 500,
        kind: 'server',
        code: 'ERR-INT-001',
      });
    });

    it('reports a rejected request — the transport path, not the response path', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });

      const result = await clientWith(fetchImpl as never).send('POST', '/api/v1/crm/customers', {
        givenName: 'Layla',
      });
      expect(result.ok).toBe(false);

      expect(seen).toHaveLength(1);
      const event = seen[0] as ClientLogEvent;
      expect(event.event).toBe(API_FAILURE_EVENT);
      expect(event.level).toBe('error');
      // No response arrived, so the id is the one the client sent — which is the
      // id the API will have logged if it got that far.
      expect(event.correlationId).toBe('client-correlation-id');
      expect(event.context).toEqual({
        method: 'POST',
        status: null,
        kind: 'network',
        code: null,
      });
    });

    it('reports a refusal at a lower level than a fault', async () => {
      const fetchImpl = vi.fn(async () => respond(403, { code: 'ERR-IAM-001', status: 403 }));
      await clientWith(fetchImpl as never).get('/api/v1/iam/roles');
      // A 403 is the backend doing its job. Counting it as an error makes the
      // error rate meaningless.
      expect(seen[0]?.level).toBe('warn');
    });

    it('reports each attempt of a retried read, because each one failed', async () => {
      const fetchImpl = vi.fn(async () => respond(503, {}));
      await clientWith(fetchImpl as never).get('/api/v1/health/ready', { retries: 1 });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(seen).toHaveLength(2);
    });
  });

  describe('what the event may not carry', () => {
    it('carries no body, no header, no token and no query string', async () => {
      const secretToken = ['a'.repeat(24), 'b'.repeat(28), 'c'.repeat(30)].join('.');
      const fetchImpl = vi.fn(async () =>
        respond(422, {
          status: 422,
          code: 'ERR-VAL-001',
          // A response body full of things that must not travel.
          violations: [{ path: 'body.email', rule: 'invalid_format' }],
          title: 'Validation failed for ali@example.test',
        })
      );

      await clientWith(fetchImpl as never, {
        defaultHeaders: { authorization: `Bearer ${secretToken}` },
      }).send(
        'PATCH',
        '/api/v1/crm/customers/3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b?search=ali&plate=ABC1234',
        { email: 'ali@example.test', vin: 'WBA3A5C55DF123456' }
      );

      expect(seen).toHaveLength(1);
      const serialised = JSON.stringify(seen[0]);

      // Bodies.
      expect(serialised).not.toContain('ali@example.test');
      expect(serialised).not.toContain('WBA3A5C55DF123456');
      // Headers and credentials.
      expect(serialised.toLowerCase()).not.toContain('authorization');
      expect(serialised).not.toContain(secretToken);
      expect(serialised).not.toContain('Bearer');
      // The query string, where the rest of it hides.
      expect(serialised).not.toContain('search=');
      expect(serialised).not.toContain('ABC1234');
      // Server-authored prose.
      expect(serialised).not.toContain('Validation failed');
    });

    it('templates the record identifier out of the path', async () => {
      const customerId = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
      const fetchImpl = vi.fn(async () => respond(404, { code: 'ERR-CRM-001' }));
      await clientWith(fetchImpl as never).get(`/api/v1/crm/customers/${customerId}/addresses`);

      const event = seen[0] as ClientLogEvent;
      // A customer ID is not a name, but it is a stable handle to one, and a
      // stream of "customer X failed at 09:14" is a record of who was being worked
      // on and when.
      expect(event.route).not.toContain(customerId);
      expect(event.route).toBe('/api/v1/crm/customers/:id/addresses');
      expect(JSON.stringify(seen[0])).not.toContain(customerId);
    });

    it('templates a numeric identifier too, and leaves vocabulary alone', () => {
      expect(templateRoute('/api/v1/vehicles/1042/history')).toBe('/api/v1/vehicles/:id/history');
      expect(templateRoute('/en/crm/customers')).toBe('/en/crm/customers');
      expect(templateRoute('/ar/administration/users')).toBe('/ar/administration/users');
    });
  });

  describe('a cancelled request is not a fault', () => {
    it('is not reported at error level', async () => {
      const controller = new AbortController();
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
        controller.abort();
        throw Object.assign(new DOMException('aborted', 'AbortError'), { signal: init.signal });
      });

      const result = await clientWith(fetchImpl as never).get('/api/v1/crm/customers', {
        signal: controller.signal,
        retries: 0,
      });
      expect(result.ok).toBe(false);

      expect(seen).toHaveLength(1);
      const event = seen[0] as ClientLogEvent;
      expect(event.context?.['kind']).toBe('cancelled');
      // A user pressed Cancel. `#request` distinguishes that from a timeout
      // precisely so it is not shown as a backend failure; reporting it as an
      // error here would undo that one layer up.
      expect(event.level).not.toBe('error');
      expect(event.level).toBe('debug');
    });

    it('still reports our own timeout as an error, which is the distinction', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new DOMException('timeout', 'TimeoutError');
      });
      await clientWith(fetchImpl as never, { timeoutMs: 5 }).get('/api/v1/crm/customers', {
        retries: 0,
      });
      expect(seen[0]?.level).toBe('error');
      expect(seen[0]?.context?.['kind']).toBe('timeout');
    });
  });

  describe('the production installation', () => {
    /**
     * The other half of the finding. A boundary nobody attaches anything to is not
     * monitoring, and the fix is a caller a deployment can switch on — not an
     * invented vendor and not a key that does not exist.
     */
    it('installs nothing when no sink is configured, which is the default', () => {
      setMonitoringAdapter(null);
      expect(installConfiguredMonitoringAdapter(undefined, () => true)).toBe(false);
      expect(currentAdapter()).toBeNull();
    });

    it('installs nothing when there is no way to deliver, such as on the server', () => {
      setMonitoringAdapter(null);
      expect(installConfiguredMonitoringAdapter('https://sink.example.test/events', null)).toBe(
        false
      );
      expect(currentAdapter()).toBeNull();
    });

    it('installs a delivering adapter when a deployment configures a sink', async () => {
      setMonitoringAdapter(null);
      const delivered: Array<{ url: string; body: string }> = [];
      const installed = installConfiguredMonitoringAdapter(
        'https://sink.example.test/events',
        (url, body) => {
          delivered.push({ url, body });
          return true;
        }
      );
      expect(installed).toBe(true);
      expect(currentAdapter()).not.toBeNull();

      // Driven through the public client, not by calling `report`.
      const fetchImpl = vi.fn(async () => respond(503, { code: 'ERR-INT-003' }));
      await clientWith(fetchImpl as never).get('/api/v1/health/ready', { retries: 0 });

      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.url).toBe('https://sink.example.test/events');
      const payload = JSON.parse(delivered[0]?.body ?? '{}') as ClientLogEvent;
      expect(payload.event).toBe(API_FAILURE_EVENT);
      expect(payload.correlationId).toBe('client-correlation-id');
    });

    it('does not turn a sink outage into an application failure', () => {
      const adapter = deliveringAdapter('https://sink.example.test/events', () => {
        throw new Error('sink unreachable');
      });
      expect(() => adapter({ level: 'error', event: 'web.test' })).not.toThrow();
    });
  });
});

/**
 * `P1-27-DO-002` — **alert routing**: which events leave, and at what level.
 *
 * ## What was missing, precisely
 *
 * `DO-002` is "structured logging, monitoring and **alert routing**". The first
 * two were delivered and proven — `installConfiguredMonitoringAdapter` is a real
 * production caller, both `ApiClient` failure paths report, the CSP admits a
 * configured sink and the event carries no PII. The third was not: a destination
 * was configurable and **everything** the boundary saw was sent to it. A
 * destination with no rule about what reaches it is a firehose, not routing, and
 * this phase's own records conceded that nothing in `apps/web` defined a
 * severity threshold.
 *
 * ## What routing means at this tier, and what it does not
 *
 * It decides WHICH events leave the browser and at what severity. It does not
 * operate a pager, a rotation or a recipient — no such destination exists, and
 * `P1-27-OD-006` records that boundary rather than letting a reader infer more
 * from the word "alert" than is here.
 *
 * ## How these cases are written
 *
 * The behavioural ones drive a real `ApiClient` request through a stubbed
 * `fetch` and observe what arrives at the BEACON — not at the adapter. The
 * distinction is the whole point again: an assertion that the adapter was called
 * proves the boundary works, which was never in doubt; what is in doubt is
 * whether an event below the threshold is stopped before it leaves the device.
 * So the sink here is the `BeaconSender`, and the payload asserted is the
 * serialised body that would have gone over the wire.
 */

const ROUTING_SINK = 'https://sink.example.test/events';
const WEB_ROOT = join(__dirname, '..');

function readWebFile(...segments: string[]): string {
  return readFileSync(join(WEB_ROOT, ...segments), 'utf8');
}

describe('alert routing — the threshold decides what leaves the browser', () => {
  const delivered: ClientLogEvent[] = [];

  const beacon: BeaconSender = (_url, body) => {
    delivered.push(JSON.parse(body) as ClientLogEvent);
    return true;
  };

  beforeEach(() => {
    delivered.length = 0;
    setMonitoringAdapter(null);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    setMonitoringAdapter(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Installs the production adapter over a capturing beacon. */
  function installSink(threshold?: LogLevel): void {
    const installed =
      threshold === undefined
        ? installConfiguredMonitoringAdapter(ROUTING_SINK, beacon)
        : installConfiguredMonitoringAdapter(ROUTING_SINK, beacon, threshold);
    expect(installed, 'the sink was not installed').toBe(true);
  }

  describe('the rule itself', () => {
    it('orders the four severities, and the order IS the comparison', () => {
      // Written out once, here, because everything below depends on it and a
      // reordered tuple silently reverses every threshold in the deployment.
      expect([...LOG_LEVELS]).toEqual(['debug', 'info', 'warn', 'error']);
      expect(LOG_LEVELS.map(levelRank)).toEqual([0, 1, 2, 3]);
    });

    it('routes at or above the threshold, never merely above', () => {
      // Derived from the vocabulary rather than written out, so a fifth level
      // would be covered the day it is declared.
      for (const [index, level] of LOG_LEVELS.entries()) {
        for (const [floor, threshold] of LOG_LEVELS.entries()) {
          expect(routesToSink(level, threshold), `${level} at ${threshold}`).toBe(index >= floor);
        }
      }
      // The boundary case spelled out: "alert me on warnings" must include
      // warnings. An exclusive comparison would silently drop the exact level
      // the operator asked for.
      expect(routesToSink('warn', 'warn')).toBe(true);
    });

    it('defaults CLOSED — to the narrowest level, not the widest', () => {
      expect(DEFAULT_ROUTING_LEVEL).toBe('error');
      expect(levelRank(DEFAULT_ROUTING_LEVEL)).toBe(LOG_LEVELS.length - 1);
      // Every event that leaves is data leaving an operator's browser. A default
      // of `debug` would have made "configure a sink" mean "send everything",
      // which is the decision a deployment is least likely to have made on
      // purpose.
      for (const level of LOG_LEVELS) {
        expect(routesToSink(level, DEFAULT_ROUTING_LEVEL), level).toBe(level === 'error');
      }
    });
  });

  describe('with no threshold configured, only faults leave', () => {
    it('delivers a 500 — the system failed', async () => {
      installSink();
      const fetchImpl = vi.fn(async () => respond(500, { code: 'ERR-INT-001', status: 500 }));
      await clientWith(fetchImpl as never).get('/api/v1/crm/customers', { retries: 0 });

      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.level).toBe('error');
      expect(delivered[0]?.event).toBe(API_FAILURE_EVENT);
    });

    it('does NOT deliver a 403 — a refusal is the backend doing its job', async () => {
      installSink();
      const fetchImpl = vi.fn(async () => respond(403, { code: 'ERR-IAM-001', status: 403 }));
      await clientWith(fetchImpl as never).get('/api/v1/iam/roles', { retries: 0 });

      // It was reported. It was not routed. Those are two different things, and
      // conflating them is what made the sink a firehose.
      expect(delivered).toHaveLength(0);
    });

    it('does NOT deliver a cancellation — a user pressed Cancel', async () => {
      installSink();
      const controller = new AbortController();
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
        controller.abort();
        throw Object.assign(new DOMException('aborted', 'AbortError'), { signal: init.signal });
      });
      await clientWith(fetchImpl as never).get('/api/v1/crm/customers', {
        signal: controller.signal,
        retries: 0,
      });

      expect(delivered).toHaveLength(0);
    });

    it('still writes the dropped event to the console, because that is not egress', async () => {
      installSink();
      const warn = console.warn as unknown as ReturnType<typeof vi.fn>;
      const fetchImpl = vi.fn(async () => respond(403, { code: 'ERR-IAM-001', status: 403 }));
      await clientWith(fetchImpl as never).get('/api/v1/iam/roles', { retries: 0 });

      // The console is the only diagnostic a deployment with no sink has at all,
      // and a remote threshold must not take it away. If the filter had been put
      // in `report` instead of in the delivering adapter, this line would be
      // gone.
      expect(delivered).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(API_FAILURE_EVENT);
    });
  });

  describe('a deployment widens or narrows it deliberately', () => {
    it('at `warn`, refusals leave and a cancellation still does not', async () => {
      installSink('warn');
      const forbidden = vi.fn(async () => respond(403, { code: 'ERR-IAM-001', status: 403 }));
      await clientWith(forbidden as never).get('/api/v1/iam/roles', { retries: 0 });
      expect(delivered.map((event) => event.level)).toEqual(['warn']);

      const controller = new AbortController();
      const cancelled = vi.fn(async (_url: string, init: RequestInit) => {
        controller.abort();
        throw Object.assign(new DOMException('aborted', 'AbortError'), { signal: init.signal });
      });
      await clientWith(cancelled as never).get('/api/v1/crm/customers', {
        signal: controller.signal,
        retries: 0,
      });
      expect(delivered.map((event) => event.level)).toEqual(['warn']);
    });

    it('at `debug`, everything leaves — including the cancellation', async () => {
      installSink('debug');
      const controller = new AbortController();
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
        controller.abort();
        throw Object.assign(new DOMException('aborted', 'AbortError'), { signal: init.signal });
      });
      await clientWith(fetchImpl as never).get('/api/v1/crm/customers', {
        signal: controller.signal,
        retries: 0,
      });

      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.level).toBe('debug');
      expect(delivered[0]?.context?.['kind']).toBe('cancelled');
    });

    it('routes nothing at any threshold when no destination is configured', () => {
      // The threshold is half of a pair. Set alone it is inert, because the URL
      // is what installs an adapter at all — the sink fails closed and takes the
      // rule with it.
      setMonitoringAdapter(null);
      expect(installConfiguredMonitoringAdapter(undefined, beacon, 'debug')).toBe(false);
      expect(currentAdapter()).toBeNull();
      expect(delivered).toHaveLength(0);
    });

    it('widening the threshold does not weaken the redaction', async () => {
      installSink('debug');
      const secretToken = ['a'.repeat(24), 'b'.repeat(28), 'c'.repeat(30)].join('.');
      const fetchImpl = vi.fn(async () => respond(422, { code: 'ERR-VAL-001', status: 422 }));
      await clientWith(fetchImpl as never, {
        defaultHeaders: { authorization: `Bearer ${secretToken}` },
      }).send('PATCH', '/api/v1/crm/customers/3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b?plate=ABC1234', {
        email: 'ali@example.test',
      });

      expect(delivered).toHaveLength(1);
      const wire = JSON.stringify(delivered[0]);
      expect(wire).not.toContain(secretToken);
      expect(wire).not.toContain('ali@example.test');
      expect(wire).not.toContain('ABC1234');
      expect(wire).toContain('/api/v1/crm/customers/:id');
    });
  });

  /**
   * The environment half. `deliveringAdapter` can be handed any level by a
   * caller; what a DEPLOYMENT can hand it is whatever `lib/env.ts` accepts, and
   * that is the surface a misconfiguration arrives through.
   */
  describe('the deployment configures it through a validated variable', () => {
    async function loadEnv(value: string | undefined) {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_CLIENT_MONITORING_LEVEL', value);
      return (await import('@/lib/env')) as {
        env: { NEXT_PUBLIC_CLIENT_MONITORING_LEVEL?: string };
      };
    }

    /** The boot error, or `null` if the module loaded. Never a thrown assertion. */
    async function bootFailure(value: string): Promise<string | null> {
      return loadEnv(value).then(
        () => null,
        (error: unknown) => String(error)
      );
    }

    it('accepts each of the four levels', async () => {
      for (const level of LOG_LEVELS) {
        const loaded = await loadEnv(level);
        expect(loaded.env.NEXT_PUBLIC_CLIENT_MONITORING_LEVEL, level).toBe(level);
      }
    });

    it('refuses anything else at BOOT, naming the field and never the value', async () => {
      // Fails closed the second way. A threshold that fell back to a default on
      // a typo would route too much or nothing at all, and nothing would say so.
      for (const invalid of ['critical', 'ERROR', 'fatal', 'true']) {
        const failure = await bootFailure(invalid);
        expect(failure, `${invalid} was accepted`).toContain('NEXT_PUBLIC_CLIENT_MONITORING_LEVEL');
        // Never the value: an invalid env var is frequently a misconfigured
        // secret, and echoing it into a boot log is how it gets recorded.
        expect(failure, invalid).not.toContain(invalid);
      }
    });

    it('is absent when unset, which is what makes the code default it to `error`', async () => {
      const loaded = await loadEnv(undefined);
      expect(loaded.env.NEXT_PUBLIC_CLIENT_MONITORING_LEVEL).toBeUndefined();
    });
  });

  /**
   * The gate that stops this ageing.
   *
   * A behavioural case proves the threshold works today. It cannot prove that
   * the variable is still declared against the logger's own vocabulary, that the
   * production installer still reads it, or that the limitation `P1-27-OD-006`
   * records is still written down with an owner. Each of those has drifted from
   * the code in this phase before, so each is asserted against the source.
   */
  describe('the routing rule is bound to the code and to the register', () => {
    const LEVEL_VAR = 'NEXT_PUBLIC_CLIENT_MONITORING_LEVEL';
    const envSource = readWebFile('src', 'lib', 'env.ts');
    const logSource = readWebFile('src', 'lib', 'observability', 'client-log.ts');
    const decisions = readWebFile('..', '..', 'docs', 'phase-1', 'phase-1-27', 'open-decisions.md');

    it('validates the variable against the SAME tuple the logger orders by', () => {
      // `z.enum(LOG_LEVELS)`, not a re-typed list of four strings. A second copy
      // is a list no check compares with the first.
      expect(envSource).toContain(`${LEVEL_VAR}: z.enum(LOG_LEVELS)`);
      expect(envSource).toContain("export const LOG_LEVELS = ['debug', 'info', 'warn', 'error']");
      expect(logSource).toContain("import { env, LOG_LEVELS, type LogLevel } from '../env'");
    });

    it('reads that variable in the production installer, defaulting closed', () => {
      expect(logSource).toContain(`env.${LEVEL_VAR} ?? DEFAULT_ROUTING_LEVEL`);
      expect(logSource).toContain("export const DEFAULT_ROUTING_LEVEL: LogLevel = 'error'");
      // Derived, so there is no second rank table to fall out of step.
      expect(logSource).toContain('return LOG_LEVELS.indexOf(level)');
    });

    it('documents the variable where a deployment would look for it', () => {
      const example = readWebFile('.env.example');
      expect(example).toContain(LEVEL_VAR);
      expect(example).toMatch(/debug \| info \| warn \| error/);
    });

    it('carries `P1-27-OD-006` with an owner, a review date and the paging boundary', () => {
      // The limitation that survives the routing rule: no destination is
      // operated and nobody is paged. Recorded, owned, dated — the
      // `P1-20-A-06` precedent, applied to what is genuinely still absent.
      expect(decisions).toContain('`P1-27-OD-006`');
      expect(decisions).toMatch(/P1-20-A-06/);
      expect(decisions).toMatch(/\*\*Owner:\*\*/);
      expect(decisions).toMatch(/Review by:\*\*\s*20\d\d-\d\d-\d\d/);
      expect(decisions).toMatch(/no pager|not paging|nobody is paged/i);
    });

    it('never claims a monitoring or notification service exists', () => {
      // The failure this phase has shipped repeatedly is prose asserting a
      // capability the code does not have. No vendor may be named here.
      for (const [name, source] of [
        ['env.ts', envSource],
        ['client-log.ts', logSource],
      ] as const) {
        expect(source, name).not.toMatch(
          /sentry|datadog|new relic|pagerduty|opsgenie|slack|splunk/i
        );
      }
    });
  });
});
