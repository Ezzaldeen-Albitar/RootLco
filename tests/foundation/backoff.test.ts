/**
 * Protects the two arithmetic properties that keep a retry schedule from becoming
 * an outage amplifier.
 *
 * The ceiling must hold for *every* attempt count, including the large ones a
 * poison message reaches — an unclamped `2 ** n` produces Infinity, and
 * `Math.floor(random() * Infinity)` is not a delay, it is a crash or a permanent
 * stall. And the delay must never be negative, because a negative interval fed to
 * `shared.fail_outbox_event` schedules a retry in the past, which is a hot loop.
 *
 * Randomness is injected so the bounds are asserted at the edges rather than
 * sampled and hoped for.
 */
import { describe, it, expect } from 'vitest';
import { backoffDelayMs, backoffInterval, type BackoffOptions } from '@/server/worker/backoff';

const BASE_MS = 1_000;
const MAX_MS = 300_000;

/** The extremes of the [0, 1) contract, plus two interior points. */
const RANDOM_SAMPLES = [0, 0.25, 0.5, 0.999_999_999];

function options(random: number): BackoffOptions {
  return { baseMs: BASE_MS, maxMs: MAX_MS, random: () => random };
}

describe('backoffDelayMs', () => {
  it('stays inside [0, min(maxMs, base * 2 ** (attempt - 1))] for attempts 1..40', () => {
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      const ceiling = Math.min(MAX_MS, BASE_MS * 2 ** (attempt - 1));
      for (const random of RANDOM_SAMPLES) {
        const delay = backoffDelayMs(attempt, options(random));

        expect(Number.isFinite(delay)).toBe(true);
        expect(Number.isInteger(delay)).toBe(true);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(ceiling);
        expect(delay).toBeLessThanOrEqual(MAX_MS);
      }
    }
  });

  it('grows exponentially until the ceiling and then stops', () => {
    const atCeiling = (attempt: number) => backoffDelayMs(attempt, options(0.999_999_999));

    expect(atCeiling(1)).toBe(999);
    expect(atCeiling(2)).toBe(1_999);
    expect(atCeiling(3)).toBe(3_999);
    // 1000 * 2 ** 9 = 512_000, already past the 300_000 ceiling.
    expect(atCeiling(10)).toBe(MAX_MS - 1);
    expect(atCeiling(40)).toBe(MAX_MS - 1);
  });

  it('returns zero at the bottom of the jitter range', () => {
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      expect(backoffDelayMs(attempt, options(0))).toBe(0);
    }
  });

  it('treats a zero, negative, or fractional attempt as the first attempt', () => {
    const half = options(0.5);
    expect(backoffDelayMs(1, half)).toBe(500);
    expect(backoffDelayMs(0, half)).toBe(500);
    expect(backoffDelayMs(-5, half)).toBe(500);
    expect(backoffDelayMs(1.9, half)).toBe(500);
  });

  it('spreads retries instead of synchronising them (full jitter, not a fixed step)', () => {
    const spread = new Set(RANDOM_SAMPLES.map((random) => backoffDelayMs(5, options(random))));
    expect(spread.size).toBe(RANDOM_SAMPLES.length);
  });
});

describe('backoffInterval', () => {
  it('renders a PostgreSQL interval literal in milliseconds', () => {
    expect(backoffInterval(1, options(0))).toBe('0 milliseconds');
    expect(backoffInterval(1, options(0.5))).toBe('500 milliseconds');
    expect(backoffInterval(40, options(0.999_999_999))).toBe(`${MAX_MS - 1} milliseconds`);
  });

  it('always matches the interval shape the outbox failure function expects', () => {
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      for (const random of RANDOM_SAMPLES) {
        expect(backoffInterval(attempt, options(random))).toMatch(/^\d+ milliseconds$/);
      }
    }
  });
});
