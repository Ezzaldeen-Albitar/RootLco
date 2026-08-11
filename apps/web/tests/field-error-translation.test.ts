import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  controlNameFor,
  violationMessageKey,
  VIOLATION_FALLBACK_KEY,
  VIOLATION_KEY_PREFIX,
} from '@/lib/api/client';
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

/**
 * A refusal the operator can read (`P1-27-FE-031`).
 *
 * ## The defect
 *
 * `violationMessageKey` derives `form.violation.${rule}` and keeps it only if
 * the English catalogue carries it, falling back to `form.violation.invalid`
 * otherwise. The fallback is right in general — the API emits more than eighty
 * rule tokens and an exhaustive catalogue would be wrong within a week — but it
 * is wrong for a rule a shipped form can actually produce.
 *
 * `below_current_odometer` was one of those. Recording a reading lower than the
 * vehicle's current one answers `422 ERR-VAL-001` with
 * `violations: [{ path: 'body.value', rule: 'below_current_odometer' }]`, the
 * catalogue had no such key, and the operator was told only "This value is not
 * accepted here." — under a field they had just typed a number into, with no
 * indication that the number was compared against anything.
 *
 * ## Scope, and the two directions this section has now held
 *
 * The server's full remedy is a CORRECTION: the route accepts `correctionOf` and
 * `correctionReason` and requires the reason when the reference is present.
 *
 * When this section was written the web form offered neither control, so the
 * copy named what was wrong and stopped there — and the rule was asserted rather
 * than described: a message that sends an operator to a control the screen does
 * not have is a worse failure than a vague one, so the case READ THE COMPONENT
 * and required the absence.
 *
 * `P1-27-FE-023` built the control. The obligation therefore inverts rather than
 * disappearing: the same case now reads the same component and requires the
 * fields to be PRESENT, and requires the copy to name the remedy. Written this
 * way round, neither half can be edited alone — deleting the control fails the
 * copy assertion, and softening the copy fails beside it.
 */
describe('a violation rule a shipped form can produce is catalogued', () => {
  const violationKeys = Object.keys(en).filter((key) => key.startsWith(VIOLATION_KEY_PREFIX));

  it('found the violation namespace at all, so the sweep is not vacuous', () => {
    expect(violationKeys.length).toBeGreaterThan(10);
    expect(violationKeys).toContain(VIOLATION_FALLBACK_KEY);
  });

  it.each(violationKeys)('%s resolves in BOTH catalogues', (key) => {
    // A key in one catalogue and not the other reaches an Arabic operator as
    // an English sentence, or as the raw key. `violationMessageKey` reads
    // membership out of `en` alone, so `ar` cannot be checked by that path.
    expect(resolvesEverywhere(key), `${key} is missing from a catalogue`).toBe(true);
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      expect(
        (catalogue as Record<string, string>)[key]?.trim(),
        `${key} in ${locale} is empty`
      ).toBeTruthy();
    }
  });

  it('resolves the odometer refusal to its own message, not to the generic one', () => {
    const key = violationMessageKey('below_current_odometer');
    expect(key).toBe('form.violation.below_current_odometer');
    expect(key, 'the operator is still being told only that the value is invalid').not.toBe(
      VIOLATION_FALLBACK_KEY
    );
    expect((en as Record<string, string>)[key]).not.toBe(
      (en as Record<string, string>)[VIOLATION_FALLBACK_KEY]
    );
    expect((ar as Record<string, string>)[key]).not.toBe(
      (ar as Record<string, string>)[VIOLATION_FALLBACK_KEY]
    );
    expect((en as Record<string, string>)[key]).not.toBe((ar as Record<string, string>)[key]);
  });

  it('lands on the control the API names, so the message appears under the field', () => {
    // `body.value` is the reading box on the odometer form. A violation whose
    // path resolved to no control would surface at form level instead, which is
    // where `empty_patch` belongs and this does not.
    expect(controlNameFor('body.value')).toBe('value');
  });

  it('names the correction control, and the odometer form has one', () => {
    /*
     * The two halves, in one case, because they are only true together.
     *
     * The server's answer to a downward reading is "submit it as a correction
     * with a reason". This case previously required the OPPOSITE of everything
     * below — no `correctionOf` field, no `correctionReason` field, and no
     * mention of a correction in either catalogue — because the form had no such
     * control and copy that describes an absent control is a worse failure than
     * copy that is merely vague.
     *
     * `P1-27-FE-023` built it. Reading the component rather than trusting a
     * comment is what makes the pairing enforceable in both directions: remove
     * the fields and the copy assertion is what fails.
     */
    const source = readFileSync(
      join(
        process.cwd(),
        'src',
        'features',
        'vehicles',
        'components',
        'VehicleHistorySections.tsx'
      ),
      'utf8'
    );
    expect(source, 'the odometer form has no correctionOf control').toMatch(
      /name:\s*'correctionOf'/
    );
    expect(source, 'the odometer form has no correctionReason control').toMatch(
      /name:\s*'correctionReason'/
    );

    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      const message = (catalogue as Record<string, string>)[
        'form.violation.below_current_odometer'
      ];
      expect(message, 'the key is missing').toBeTruthy();
      // Named in each language's own words, not by matching one shared token.
      expect(message, `${locale} does not name the remedy`).toMatch(
        locale === 'ar' ? /تصحيح/ : /correct/i
      );
    }
  });

  it('catalogues the refusals only a correction can produce', () => {
    /*
     * `not_earlier` and `unknown_reason` are emitted for a correction and for
     * nothing else. While no form could submit one they stayed on the generic
     * fallback deliberately; now that one can, an operator meeting either would
     * be told only "This value is not accepted here" under a select they had
     * just made a deliberate choice in.
     *
     * `unknown_reference` and `required` were already carried — checked here so
     * that the FOUR refusals this control can provoke are asserted as a set
     * rather than as the two that happened to be added.
     */
    for (const rule of ['not_earlier', 'unknown_reason', 'unknown_reference', 'required']) {
      expect(violationMessageKey(rule), rule).toBe(`${VIOLATION_KEY_PREFIX}${rule}`);
      expect(violationMessageKey(rule), rule).not.toBe(VIOLATION_FALLBACK_KEY);
    }
    // Each says something different from the generic message and from the other
    // language, so a key that exists but was pasted from its neighbour fails.
    for (const rule of ['not_earlier', 'unknown_reason']) {
      const key = `${VIOLATION_KEY_PREFIX}${rule}`;
      expect((en as Record<string, string>)[key]).not.toBe(
        (en as Record<string, string>)[VIOLATION_FALLBACK_KEY]
      );
      expect((en as Record<string, string>)[key]).not.toBe((ar as Record<string, string>)[key]);
    }
  });

  it('still falls back for a rule no form can produce', () => {
    // The fallback is not a bug to be catalogued away: the API emits more than
    // eighty rule tokens across eleven modules and an exhaustive catalogue would
    // be wrong within a week. An invented token must render as the generic
    // message and never as itself.
    expect(violationMessageKey('unregistered_aggregate')).toBe(VIOLATION_FALLBACK_KEY);
    expect(violationMessageKey('no_such_rule_at_all')).toBe(VIOLATION_FALLBACK_KEY);
  });
});
