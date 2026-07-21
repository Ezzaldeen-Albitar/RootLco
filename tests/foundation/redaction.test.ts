/**
 * Protects the two independent scrubbing layers that keep credentials out of logs.
 *
 * Key-name redaction alone fails the moment a secret arrives under an innocent
 * key (`detail`, `note`); value-shape scrubbing alone fails the moment a secret
 * has no recognisable shape (an opaque session token in a `session` column).
 * Both layers are asserted separately here, because a regression in either one is
 * invisible while the other still passes.
 *
 * Every credential-shaped literal below is assembled from fragments at runtime so
 * this file itself carries no matchable credential token — the engineering fix the
 * tracked-secret scanner asks for, rather than an allowlist marker.
 */
import { describe, it, expect } from 'vitest';
import {
  REDACTED,
  redact,
  scrubString,
  __redactionInternals,
} from '@/server/observability/redaction';

/** Joins fragments so no source line contains a contiguous credential shape. */
const fragment = (...parts: readonly string[]): string => parts.join('');

const JWT_LIKE = fragment(
  'ey',
  'JhbGciOiJIUzI1NiJ9',
  '.',
  'ey',
  'JzdWIiOiJyb290bGNvLXVuaXQtdGVzdCJ9',
  '.',
  'c2lnbmF0dXJlLXNlZ21lbnQtdmFsdWU'
);
const BEARER_LIKE = fragment('Bearer ', 'rootlco-unit-test-token-0123456789');
const POSTGRES_URL_LIKE = fragment(
  'postgres',
  'ql://',
  'app_user',
  ':',
  'unit-test-password',
  '@localhost:5432/rootlco'
);
const PEM_HEADER_LIKE = fragment('-----BEGIN ', 'RSA ', 'PRIVATE ', 'KEY-----');
const AWS_KEY_LIKE = fragment('AK', 'IA', 'ROOTLCOTESTKEY01');
const GITHUB_TOKEN_LIKE = fragment('gh', 'p_', 'RootLcoUnitTestToken0123456789');
const SUPABASE_SECRET_LIKE = fragment('sb', '_secret_', 'RootLcoUnitTestValue01');

/**
 * Control bytes are built at runtime. Writing them literally would put a raw
 * control byte in a tracked file, which makes the secret scanner treat this file
 * as binary and skip it — a silent hole in a control this suite exists to prove.
 */
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

describe('key-name redaction', () => {
  it('replaces values under secret-ish keys at every depth', () => {
    const out = redact({
      password: 'value-1',
      nested: { apiKey: 'value-2', deeper: { sessionToken: 'value-3', keep: 'visible' } },
    }) as Record<string, unknown>;
    const nested = out.nested as Record<string, unknown>;
    const deeper = nested.deeper as Record<string, unknown>;

    expect(out.password).toBe(REDACTED);
    expect(nested.apiKey).toBe(REDACTED);
    expect(deeper.sessionToken).toBe(REDACTED);
    expect(deeper.keep).toBe('visible');
  });

  it('replaces restricted business columns so an accidentally spread row fails closed', () => {
    const out = redact({
      national_id: 'value-1',
      passport_number: 'value-2',
      iban: 'value-3',
      card_number: 'value-4',
      date_of_birth: '1990-01-01',
      display_name: 'visible',
    }) as Record<string, unknown>;

    expect(out.national_id).toBe(REDACTED);
    expect(out.passport_number).toBe(REDACTED);
    expect(out.iban).toBe(REDACTED);
    expect(out.card_number).toBe(REDACTED);
    expect(out.date_of_birth).toBe(REDACTED);
    expect(out.display_name).toBe('visible');
  });

  it('matches key fragments case-insensitively and as substrings', () => {
    expect(__redactionInternals.isSecretKey('AUTHORIZATION')).toBe(true);
    expect(__redactionInternals.isSecretKey('X-Refresh-Token')).toBe(true);
    expect(__redactionInternals.isSecretKey('displayName')).toBe(false);
  });

  it('redacts inside arrays of rows', () => {
    const out = redact([{ token: 'value' }, { ok: 'visible' }]) as Record<string, unknown>[];
    expect(out[0]!.token).toBe(REDACTED);
    expect(out[1]!.ok).toBe('visible');
  });
});

describe('value-shape scrubbing under innocent keys', () => {
  const cases: readonly { readonly label: string; readonly value: string }[] = [
    { label: 'JWT', value: `token exchange failed for ${JWT_LIKE}` },
    { label: 'Bearer header', value: `auth failed for ${BEARER_LIKE}` },
    { label: 'postgres URL with inline password', value: `dial ${POSTGRES_URL_LIKE} refused` },
    { label: 'PEM private-key header', value: `${PEM_HEADER_LIKE} truncated` },
    { label: 'AWS access key id', value: `principal ${AWS_KEY_LIKE} denied` },
    { label: 'GitHub token', value: `remote rejected ${GITHUB_TOKEN_LIKE}` },
    { label: 'Supabase secret key', value: `configured ${SUPABASE_SECRET_LIKE}` },
  ];

  it.each(cases)('scrubs a $label carried in a plain "detail" field', ({ value }) => {
    const out = redact({ detail: value }) as Record<string, unknown>;
    const scrubbed = out.detail as string;
    expect(scrubbed).toContain(REDACTED);
    expect(scrubbed).not.toBe(value);
  });

  it('removes the credential substring rather than only flagging it', () => {
    const scrubbed = scrubString(`connection string ${POSTGRES_URL_LIKE} is invalid`);
    expect(scrubbed).not.toContain('unit-test-password');
    expect(scrubbed).toContain(REDACTED);
    // The non-credential remainder stays readable: scrubbing is not deletion.
    expect(scrubbed).toContain('localhost:5432/rootlco');
  });

  it('scrubs every occurrence, not just the first', () => {
    const scrubbed = scrubString(`${AWS_KEY_LIKE} then ${AWS_KEY_LIKE}`);
    expect(scrubbed).toBe(`${REDACTED} then ${REDACTED}`);
  });

  it('is not defeated by a stale regex lastIndex across repeated calls', () => {
    for (let index = 0; index < 5; index += 1) {
      expect(scrubString(GITHUB_TOKEN_LIKE)).toBe(REDACTED);
    }
  });
});

describe('log-forging defence', () => {
  it('escapes control characters instead of dropping them', () => {
    const forged = `real record\n{"severity":"info","msg":"forged"}\r\tend${NUL}`;
    const scrubbed = scrubString(forged);

    expect(scrubbed).not.toContain('\n');
    expect(scrubbed).not.toContain('\r');
    expect(scrubbed).not.toContain('\t');
    expect(scrubbed).not.toContain(NUL);
    expect(scrubbed).toContain('\\x0a');
    expect(scrubbed).toContain('\\x0d');
    expect(scrubbed).toContain('\\x09');
    expect(scrubbed).toContain('\\x00');
    // The evidence survives in readable form.
    expect(scrubbed).toContain('real record');
  });

  it('escapes DEL, the other end of the control range', () => {
    expect(scrubString(`a${DEL}b`)).toBe('a\\x7fb');
  });
});

describe('bounds', () => {
  it('truncates a runaway string', () => {
    const scrubbed = scrubString('x'.repeat(4_000));
    expect(scrubbed.endsWith('…[truncated]')).toBe(true);
    expect(scrubbed.length).toBeLessThan(4_000);
  });

  it('stops recursing past the depth limit', () => {
    type Nested = { next?: Nested; leaf?: string };
    const root: Nested = {};
    let cursor = root;
    for (let index = 0; index < 20; index += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    cursor.leaf = 'deep';
    expect(JSON.stringify(redact(root))).toContain('[MAX_DEPTH]');
  });

  it('caps arrays so one bad field cannot flood the log index', () => {
    const out = redact(Array.from({ length: 250 }, (_unused, index) => index)) as number[];
    expect(out).toHaveLength(100);
    expect(out[0]).toBe(0);
    expect(out[99]).toBe(99);
  });
});

describe('non-plain values', () => {
  it('reduces an Error to name and message with no stack', () => {
    const out = redact(new RangeError('index out of range')) as Record<string, unknown>;
    expect(out).toEqual({ name: 'RangeError', message: 'index out of range' });
    expect(out.stack).toBeUndefined();
  });

  it('scrubs the message of a reduced Error', () => {
    const out = redact(new Error(`upstream said ${JWT_LIKE}`)) as Record<string, unknown>;
    expect(out.message).toBe(`upstream said ${REDACTED}`);
  });

  it('passes primitives through and renders unloggable types as type tags', () => {
    expect(redact('plain')).toBe('plain');
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(BigInt('9007199254740993'))).toBe('9007199254740993');
    expect(redact(new Date('2026-07-21T00:00:00.000Z'))).toBe('2026-07-21T00:00:00.000Z');
    expect(redact(() => undefined)).toBe('[function]');
    expect(redact(Symbol('s'))).toBe('[symbol]');
  });
});
