import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { fieldErrorsFrom } from '@/features/crm/customers/action-support';
import { MAX_PERSON_NAME } from '@/features/crm/customers/creation-contract';
import {
  MAX_PREFERRED_LOCALE,
  MIN_PREFERRED_LOCALE,
} from '@/features/crm/customers/governance-contract';

/**
 * A field error must always be something an operator can read (`P1-27-FE-004`).
 *
 * ## The defect
 *
 * `creation-actions.ts` declared
 * `preferredLocale: z.string().trim().min(2).max(10).nullable()` — no
 * translation key on the floor, unlike the two name fields beside it. The
 * `optional()` helper turns only an EMPTY value into `null`, so a single
 * character survives to the schema, fails `.min(2)`, and Zod's own English
 * sentence is stored as the field error. `translateDynamic` returns a
 * non-catalogue string unchanged, so an Arabic operator who typed one character
 * into the preferred-language box was shown English library prose.
 *
 * The file's own comment claimed this could not happen — "only ... for the
 * bounds, where the form's `maxLength` has already stopped the operator anyway".
 * True of the ceilings. The floor has nothing stopping it.
 *
 * ## Why the fix is a fallback and not just a key
 *
 * Adding a key to that one field would fix that one field. Across the customer
 * and vehicle write schemas most bounds carry no key, and whether any given one
 * is reachable depends on whether some form three files away sets a matching
 * `maxLength` — a fact that lives nowhere near the schema and can change without
 * it. So `fieldErrorsFrom` maps any unkeyed message to a catalogue key by issue
 * code, and the schemas gained keys as well.
 *
 * ## What is asserted
 *
 * That no Zod default sentence can reach an operator, driven from the REAL
 * schemas by feeding them real bad input — not from a hand-built `ZodError`,
 * which would prove only that the mapper maps what the test already decided.
 */

const CATALOGUES = { en, ar } as const;

function resolvesEverywhere(key: string): boolean {
  return Object.values(CATALOGUES).every((c) => key in (c as Record<string, string>));
}

/**
 * The customer-creation schemas, rebuilt here from the same shape the action
 * declares.
 *
 * They are not exported — a `'use server'` module may export only async
 * functions — so the guard below pins the reconstruction against the real file's
 * text. Without that, this suite would drift into testing a schema nobody runs.
 */
const individualSchema = z.object({
  givenName: z.string().trim().min(1, 'field.required').max(100, 'field.tooLong'),
  familyName: z.string().trim().min(1, 'field.required').max(100, 'field.tooLong'),
  preferredLocale: z.string().trim().min(2, 'field.tooShort').max(10, 'field.tooLong').nullable(),
  lifecycleStatus: z.enum(['prospect', 'active']),
});

describe('every field error is a key both catalogues can resolve', () => {
  it('translates the one-character locale that produced English prose', () => {
    // The exact reported input: an operator types a single character.
    const parsed = individualSchema.safeParse({
      givenName: 'N',
      familyName: 'K',
      preferredLocale: 'a',
      lifecycleStatus: 'active',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const errors = fieldErrorsFrom(parsed.error);
    expect(errors.preferredLocale).toBe('field.tooShort');
    expect(resolvesEverywhere(errors.preferredLocale ?? ''), errors.preferredLocale).toBe(true);
    // Named explicitly: this is the sentence that used to be shown.
    expect(errors.preferredLocale).not.toContain(' ');
  });

  it('translates an unkeyed bound through the fallback', () => {
    // A schema with NO keys at all — which is what most of the write schemas
    // still look like, and what the fallback exists for.
    const unkeyed = z.object({
      code: z.string().min(4),
      size: z.string().max(2),
      count: z.number(),
    });
    const parsed = unkeyed.safeParse({ code: 'ab', size: 'abcdef', count: 'x' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const errors = fieldErrorsFrom(parsed.error);
    expect(errors).toEqual({
      code: 'field.tooShort',
      size: 'field.tooLong',
      count: 'field.required',
    });
    for (const key of Object.values(errors)) {
      expect(resolvesEverywhere(key), key).toBe(true);
    }
  });

  it('keeps a key the schema supplied rather than flattening it to the fallback', () => {
    // The fallback must not swallow the specific message. `field.required` on an
    // empty name says something `field.tooShort` does not.
    const parsed = individualSchema.safeParse({
      givenName: '',
      familyName: 'K',
      preferredLocale: null,
      lifecycleStatus: 'active',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(fieldErrorsFrom(parsed.error).givenName).toBe('field.required');
  });

  it('maps an unrecognised issue to a key rather than to its own text', () => {
    const parsed = z.object({ colour: z.enum(['red', 'blue']) }).safeParse({ colour: 'green' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const errors = fieldErrorsFrom(parsed.error);
    expect(resolvesEverywhere(errors.colour ?? ''), errors.colour).toBe(true);
  });

  it('recognises a key and rejects a sentence, which is the whole distinction', () => {
    // Driven through the public function, since the predicate is private.
    const key = z.object({ a: z.string().min(2, 'crm.customers.search.noMatch') });
    const sentence = z.object({ a: z.string().min(2, 'Too short, sorry.') });
    expect(fieldErrorsFrom((key.safeParse({ a: 'x' }) as { error: z.ZodError }).error).a).toBe(
      'crm.customers.search.noMatch'
    );
    expect(fieldErrorsFrom((sentence.safeParse({ a: 'x' }) as { error: z.ZodError }).error).a).toBe(
      'field.tooShort'
    );
  });
});

describe('the reconstruction above is pinned to the real schema', () => {
  it('matches what creation-actions.ts actually declares', () => {
    /*
     * The schemas cannot be imported: a `'use server'` module may export only
     * async functions, so they are module-private by construction.
     *
     * Reconstructing them is therefore necessary and is also the risk — a
     * reconstruction that drifts turns every assertion above into a test of
     * itself. So the real file is read and the load-bearing declarations are
     * asserted present. Not a full parse, which would be a second Zod; just the
     * facts this suite depends on.
     */
    const source = readFileSync(
      join(process.cwd(), 'src', 'features', 'crm', 'customers', 'creation-actions.ts'),
      'utf8'
    );
    for (const fragment of [
      ".min(MIN_PREFERRED_LOCALE, 'field.tooShort')",
      ".max(MAX_PREFERRED_LOCALE, 'field.tooLong')",
      ".min(1, 'field.required')",
    ]) {
      expect(source, fragment).toContain(fragment);
    }
    // And that it no longer carries its own copy of the mapper, which is how the
    // create form came to be the one place still showing English prose.
    expect(source).not.toMatch(/function fieldErrorsFrom/);
    expect(source).toContain("from './action-support'");
  });

  it('uses the same bounds this file reconstructs', () => {
    expect(MIN_PREFERRED_LOCALE).toBe(2);
    expect(MAX_PREFERRED_LOCALE).toBe(10);
    expect(MAX_PERSON_NAME).toBe(100);
  });
});

describe('the fallback keys exist in both catalogues', () => {
  it.each(['field.required', 'field.tooShort', 'field.tooLong', 'field.invalid'])('%s', (key) => {
    // Without this, every assertion above could pass against keys that render
    // as nothing — which is not better than English prose, only quieter.
    expect(resolvesEverywhere(key), key).toBe(true);
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      expect(
        (catalogue as Record<string, string>)[key]?.trim(),
        `${key} in ${locale}`
      ).toBeTruthy();
    }
  });

  it('says something different in each locale, so neither is a copy of the other', () => {
    for (const key of ['field.required', 'field.tooShort', 'field.tooLong', 'field.invalid']) {
      expect((en as Record<string, string>)[key], key).not.toBe(
        (ar as Record<string, string>)[key]
      );
    }
  });
});
