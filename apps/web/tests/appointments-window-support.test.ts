import { describe, expect, it } from 'vitest';
import {
  WINDOW_ISSUE_KEY,
  composeDayInstant,
  composeInstant,
  utcOffsetAt,
} from '@/features/appointments/window-support';
import {
  hasExplicitUtcOffset,
  validateInstant,
  validateWindow,
} from '@/features/appointments/appointments-contract';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';

/**
 * The window composition layer (`P1-28-FE-002`/`FE-003`).
 *
 * Deliberately timezone-agnostic: the suite runs in whatever zone the machine
 * is in, so every expectation is structural (shape, offset presence, epoch
 * equality against the SAME environment's own answer) rather than a literal
 * that would pin the developer's timezone into CI.
 */

describe('utcOffsetAt', () => {
  it('produces the ±HH:MM shape the contract accepts', () => {
    const offset = utcOffsetAt(new Date('2026-08-13T12:00:00Z'));
    expect(offset).toMatch(/^[+-]\d{2}:\d{2}$/);
  });

  it('answers per instant, so daylight saving cannot be answered per page load', () => {
    // January and July differ wherever DST exists and agree where it does
    // not; both answers must at least be well-formed and self-consistent.
    const january = utcOffsetAt(new Date('2026-01-15T12:00:00Z'));
    const july = utcOffsetAt(new Date('2026-07-15T12:00:00Z'));
    expect(january).toMatch(/^[+-]\d{2}:\d{2}$/);
    expect(july).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
});

describe('composeInstant', () => {
  it('turns a local date-time into an instant the contract validates clean', () => {
    const composed = composeInstant('2026-08-21T09:00');
    expect(composed).not.toBeNull();
    expect(hasExplicitUtcOffset(composed as string)).toBe(true);
    expect(validateInstant(composed as string)).toBe('ok');
    // Seconds are always present — the list schema refuses their absence, and
    // a zone marker follows them. `[+-Z]` would be a RANGE from `+` to `Z`,
    // which accepts every digit and capital letter between them: written that
    // way this assertion also passed on `…:005`.
    expect(composed).toMatch(/^2026-08-21T09:00:00(?:Z|[+-])/);
  });

  it('denotes the same wall-clock moment the environment itself resolves', () => {
    const composed = composeInstant('2026-08-21T09:00') as string;
    // `new Date` on a timezone-less string IS local time by spec, so the
    // composed instant must parse to the identical epoch.
    expect(Date.parse(composed)).toBe(new Date('2026-08-21T09:00:00').getTime());
  });

  it('refuses what is not a complete local date-time', () => {
    for (const bad of ['', '2026-08-21', '09:00', '2026-08-21T09:00:00+03:00', 'soon']) {
      expect(composeInstant(bad), bad).toBeNull();
    }
  });
});

describe('composeDayInstant', () => {
  it('bounds the LOCAL day inclusively at both edges', () => {
    const start = composeDayInstant('2026-08-21', 'start') as string;
    const end = composeDayInstant('2026-08-21', 'end') as string;
    expect(start).toMatch(/T00:00:00/);
    expect(end).toMatch(/T23:59:59/);
    expect(validateInstant(start)).toBe('ok');
    expect(validateInstant(end)).toBe('ok');
    expect(Date.parse(end)).toBeGreaterThan(Date.parse(start));
  });

  it('refuses a malformed day', () => {
    expect(composeDayInstant('21/08/2026', 'start')).toBeNull();
    expect(composeDayInstant('', 'end')).toBeNull();
  });
});

describe('the issue-to-message map', () => {
  it('covers every refusal the contract validators can produce', () => {
    // Derived from the validators, not from the map: every issue token that
    // `validateWindow` can emit must map to a catalogue key in BOTH languages.
    const seen = new Set<string>();
    const windows: readonly [string, string][] = [
      ['', ''],
      [`x${'y'.repeat(70)}Z`, '2026-08-21T10:00:00Z'],
      ['2026-08-21T09:00:00', '2026-08-21T10:00:00Z'],
      ['not-a-time+03:00', '2026-08-21T10:00:00Z'],
      ['2026-08-21T10:00:00Z', '2026-08-21T09:00:00Z'],
    ];
    for (const [from, to] of windows) {
      const issues = validateWindow(from, to);
      if (issues.from) seen.add(issues.from);
      if (issues.to) seen.add(issues.to);
    }
    expect([...seen].sort()).toEqual(Object.keys(WINDOW_ISSUE_KEY).sort());
    for (const key of Object.values(WINDOW_ISSUE_KEY)) {
      expect(en, key).toHaveProperty(key);
      expect(ar, key).toHaveProperty(key);
    }
  });
});
