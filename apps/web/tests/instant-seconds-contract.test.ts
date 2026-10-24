import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { composeInstant } from '@/components/forms/instant';

/**
 * The client half of the datetime contract after zod 4.5 (P1-32-PRE-OD-DEP8).
 *
 * The API's datetime inputs (`z.string().datetime({ offset: true })` and
 * `z.iso.datetime({ offset: true })`) refuse an instant without seconds since
 * zod 4.5.0. Every screen composes its instants through `composeInstant`, so
 * this pins that the composed value always carries seconds and that both API
 * schema forms accept it, whether or not the operator typed seconds.
 */
describe('composeInstant emits what the API datetime schemas accept', () => {
  const apiForms = [z.string().datetime({ offset: true }), z.iso.datetime({ offset: true })];

  for (const typed of ['2026-10-24T10:15', '2026-10-24T10:15:30', '2026-02-28T23:59']) {
    it(`carries seconds for "${typed}"`, () => {
      const composed = composeInstant(typed);
      expect(composed).not.toBeNull();
      expect(composed).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/);
      for (const schema of apiForms) {
        expect(schema.safeParse(composed).success).toBe(true);
      }
    });
  }

  it('the same schemas refuse an instant written to the minute', () => {
    for (const schema of apiForms) {
      expect(schema.safeParse('2026-10-24T10:15Z').success).toBe(false);
    }
  });
});
