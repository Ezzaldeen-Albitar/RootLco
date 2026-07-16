import { describe, it, expect } from 'vitest';
import { redact } from '@/lib/logging/logger';

describe('log redaction', () => {
  it('redacts secret-ish keys at the top level', () => {
    const out = redact({
      SUPABASE_SERVICE_ROLE_KEY: 'sk_live_do_not_log',
      DATABASE_URL: 'postgresql://postgres:pw@localhost:54322/postgres',
      safeField: 'visible',
    }) as Record<string, unknown>;
    expect(out.SUPABASE_SERVICE_ROLE_KEY).toBe('[REDACTED]');
    expect(out.DATABASE_URL).toBe('[REDACTED]');
    expect(out.safeField).toBe('visible');
  });

  it('redacts nested secrets', () => {
    const out = redact({ a: { b: { password: 'hunter2', keep: 1 } } }) as {
      a: { b: { password: string; keep: number } };
    };
    expect(out.a.b.password).toBe('[REDACTED]');
    expect(out.a.b.keep).toBe(1);
  });

  it('redacts inside arrays', () => {
    const out = redact([{ token: 'abc' }, { ok: 'yes' }]) as Array<Record<string, unknown>>;
    expect(out[0]!.token).toBe('[REDACTED]');
    expect(out[1]!.ok).toBe('yes');
  });

  it('reduces Errors to name and message without a stack', () => {
    const out = redact(new Error('boom')) as Record<string, unknown>;
    expect(out).toEqual({ name: 'Error', message: 'boom' });
    expect(out.stack).toBeUndefined();
  });

  it('is case-insensitive about key names', () => {
    const out = redact({ AuthToken: 'x', cookie: 'y' }) as Record<string, unknown>;
    expect(out.AuthToken).toBe('[REDACTED]');
    expect(out.cookie).toBe('[REDACTED]');
  });

  it('terminates on deeply nested input', () => {
    type Nested = { next?: Nested };
    const root: Nested = {};
    let cur = root;
    for (let i = 0; i < 30; i++) {
      cur.next = {};
      cur = cur.next;
    }
    expect(() => redact(root)).not.toThrow();
    expect(JSON.stringify(redact(root))).toContain('[MAX_DEPTH]');
  });

  it('passes primitives through unchanged', () => {
    expect(redact('plain')).toBe('plain');
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });
});
