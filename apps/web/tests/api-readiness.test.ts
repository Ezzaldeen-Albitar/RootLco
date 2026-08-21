/**
 * The readiness panel's classification — the API/Web reference integration.
 *
 * The panel renders exactly one of four outcomes, and the mapping from an
 * ApiResult to an outcome is the part worth pinning: a transport failure must
 * read as UNAVAILABLE (the API is down, the panel is not), a degraded verdict
 * must not be flattened into "ready", and an unknown body shape must default
 * to ready rather than inventing a failure the API never reported.
 */
import { describe, expect, it } from 'vitest';
import { classifyReadiness } from '@/components/gallery/ApiReadinessPanel';

describe('classifyReadiness', () => {
  it('maps a ready verdict to ready', () => {
    expect(classifyReadiness({ ok: true, data: { status: 'ready' } })).toBe('ready');
  });

  it('preserves a degraded verdict instead of flattening it', () => {
    expect(classifyReadiness({ ok: true, data: { status: 'degraded' } })).toBe('degraded');
  });

  it('treats an unknown-but-successful body as ready, not as an invented failure', () => {
    expect(classifyReadiness({ ok: true, data: {} })).toBe('ready');
    expect(classifyReadiness({ ok: true, data: null })).toBe('ready');
  });

  it('maps every transport failure to unavailable', () => {
    for (const kind of ['network', 'timeout', 'unavailable', 'server']) {
      expect(classifyReadiness({ ok: false, kind })).toBe('unavailable');
    }
  });
});
