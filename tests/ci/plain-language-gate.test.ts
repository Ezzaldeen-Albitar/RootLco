import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
// Plain ESM JavaScript, deliberately: every gate in this repository runs from a
// hosted runner with no build step. `allowJs` resolves it, so no suppression is
// needed — and an unnecessary `@ts-expect-error` is itself a type error here.
import { RULES, inspect, selfTest } from '../../scripts/ci/check-plain-language.mjs';

/**
 * The plain-language gate, tested against the real catalogues and against
 * deliberate violations.
 *
 * Owner-acceptance defect 9 was "user-facing wording across the application
 * still assumes technical knowledge". A gate is the only durable answer,
 * because the person who writes `match_basis` into a message is the person for
 * whom it reads as ordinary English — and so is the person reviewing it.
 *
 * Two obligations, and the second is the one that matters:
 *
 *   1. the shipped catalogues are clean;
 *   2. the gate would say so *only* because they are clean.
 *
 * A sweep that has quietly stopped matching reports a clean tree exactly like a
 * sweep that is working. This phase has now shipped four of those.
 */

const ROOT = join(__dirname, '..', '..');
const CATALOGUES = ['en', 'ar'].map((locale) => ({
  locale,
  catalogue: JSON.parse(
    readFileSync(join(ROOT, 'apps', 'web', 'src', 'i18n', 'messages', `${locale}.json`), 'utf8')
  ) as Record<string, string>,
}));

describe('the shipped vocabulary', () => {
  it('is not empty, so the assertion below is not vacuous', () => {
    for (const { locale, catalogue } of CATALOGUES) {
      expect(Object.keys(catalogue).length, locale).toBeGreaterThan(900);
    }
  });

  it('contains no message that assumes technical knowledge', () => {
    for (const { locale, catalogue } of CATALOGUES) {
      const findings = inspect(locale, catalogue) as { key: string; rule: string }[];
      expect(
        findings.map((f) => `${f.key} (${f.rule})`),
        `${locale} messages a workshop employee would not understand`
      ).toEqual([]);
    }
  });
});

describe('the gate can still fail', () => {
  it('passes its own positive control', () => {
    expect(selfTest()).toBeNull();
  });

  it.each([
    ['internal-identifier', 'The match_basis could not be read.'],
    ['camel-identifier', 'This record has a stale recordVersion.'],
    ['permission-code', 'You need crm.customer.duplicate.review for this.'],
    /*
     * `crm.example-operation`, deliberately NOT a real operation id.
     *
     * The first draft named the real CRM duplicate-review operation, and
     * `scripts/p1-24-operation-register.mjs` — which scans test files for
     * operation ids — duly credited this wording gate as backend evidence that
     * the operation is exercised. It is not; this file never calls it. That is
     * the same defect the phase already recorded once.
     *
     * Then the SECOND draft failed the same way: the comment explaining the fix
     * still contained the literal id, and the register reads raw file text. It
     * does not strip comments, so a sentence about an operation counts as a test
     * of it. Sixth time this phase that a scanner has read prose about code as
     * code, and the first time it happened inside a comment written to explain
     * the previous five.
     *
     * A fixture that matches the RULE without naming anything real tests the
     * rule and claims nothing.
     */
    ['operation-id', 'The crm.example-operation call did not complete.'],
    ['null', 'The value is null.'],
    ['json', 'The JSON could not be parsed.'],
    ['uuid', 'Copy the UUID from the address bar.'],
    ['payload', 'The payload was rejected.'],
    ['schema', 'The schema does not allow that.'],
    ['api', 'The API is not responding.'],
    ['raw-key', 'crm.customers.title'],
  ])('catches %s', (rule, value) => {
    const findings = inspect('test', { 'a.b': value }) as { rule: string }[];
    expect(findings.map((f) => f.rule)).toContain(rule);
  });

  it.each([
    'No matching customer was found.',
    'The same telephone number or email address is used on both records.',
    'The two chassis numbers differ by only one character, which usually means someone mistyped one of them.',
    'Another user updated this record. Review the latest information and try again.',
    'Review duplicate vehicles',
    'Show password',
  ])('accepts ordinary business English: %s', (value) => {
    // Non-vacuity in the other direction. A gate that rejects everything would
    // pass every case above for the wrong reason.
    expect(inspect('test', { 'a.b': value })).toEqual([]);
  });

  it('declares a rule for every category the Product Owner named', () => {
    const ids = new Set((RULES as { id: string }[]).map((rule) => rule.id));
    for (const required of [
      'json',
      'uuid',
      'enum',
      'payload',
      'null',
      'boolean',
      'object-type',
      'permission-code',
      'operation-id',
      'internal-identifier',
      'raw-key',
    ]) {
      expect(ids, required).toContain(required);
    }
  });
});

/**
 * The alignment gate: an API rule token with no sentence is a defect, not a
 * silence.
 *
 * ## What was wrong, said plainly
 *
 * The API refuses a write by publishing `{ path, rule }` pairs — a field path
 * and a stable token, never prose. The browser turns each token into
 * `form.violation.<token>` when the catalogue carries that key, and into the
 * honest generic when it does not. That fallback is right: the tokens are many,
 * they arrive with every phase, and putting a raw one in front of a workshop
 * employee would be worse than a generic sentence.
 *
 * What was missing is the ACCOUNTING. Adding a token to a service and no
 * sentence to the catalogues degraded a specific, actionable refusal into the
 * generic one, silently, with every tier green — because nothing anywhere
 * compared the two sides. This is that comparison, and it fails closed: if it
 * finds no token at all it reports that as the defect rather than as a pass.
 *
 * ## Why it parses instead of matching text
 *
 * Two gates in this repository have already given a false green by matching
 * patterns over source that reads like code. A regular expression over these
 * files would also collect every token named in a DOCBLOCK — and several
 * docblocks list tokens precisely in order to explain that they are deliberately
 * uncatalogued — so prose about a rule would be counted as a rule. The TypeScript
 * parser reads declarations; comments are not nodes, so they cannot be mistaken
 * for one.
 *
 * ## Where the list may go, and where it may not
 *
 * `OWED` is the measured backlog: tokens the API publishes today that have no
 * sentence in either catalogue. It may only shrink. A token removed from it must
 * have gained a sentence, and a token that gains a sentence must be removed from
 * it — both directions are asserted, so the list cannot be used to hide a
 * regression and cannot rot around a rule nobody emits any more.
 *
 * `INTENTIONALLY_GENERIC` is the smaller list: tokens whose generic rendering is
 * the decision, each with the reason it is. It is not a waiting room.
 */

const API_MODULES = join(ROOT, 'apps', 'api', 'src', 'modules');

/** One rule token, and how the parser came to believe it is one. */
interface RuleToken {
  readonly rule: string;
  readonly file: string;
  readonly how: 'violation-literal' | 'rule-list';
}

/**
 * Every rule token declared in one TypeScript source, by parsing it.
 *
 * Two shapes are recognised, and they are the two the API actually uses:
 *
 *   1. an object literal carrying both `path` and a string-literal `rule` —
 *      the pair `safeDetails.violations` is built from;
 *   2. a closed rule-list constant named `*_RULES`, frozen or not, whose
 *      elements are string literals. A service that publishes one member of
 *      such a list publishes all of them.
 *
 * A `rule` whose value is not a string literal is deliberately NOT collected: it
 * is a computed token this gate cannot name, and reporting a guess would be
 * worse than reporting nothing. The two anti-vacuity cases below assert that
 * both shapes are still being found, so a parser that stopped recognising one of
 * them fails rather than reporting a shorter backlog.
 */
export function rulesInSource(fileName: string, text: string): RuleToken[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS
  );
  const found: RuleToken[] = [];

  const nameOf = (node: ts.PropertyName): string | null => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isStringLiteral(node)) return node.text;
    return null;
  };

  const unwrap = (node: ts.Expression): ts.Expression => {
    let current = node;
    for (;;) {
      if (ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) {
        current = current.expression;
        continue;
      }
      if (
        ts.isCallExpression(current) &&
        ts.isPropertyAccessExpression(current.expression) &&
        current.expression.name.text === 'freeze' &&
        current.arguments.length > 0
      ) {
        current = current.arguments[0] as ts.Expression;
        continue;
      }
      return current;
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      let hasPath = false;
      let rule: string | null = null;
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = nameOf(property.name);
        if (name === 'path') hasPath = true;
        if (name === 'rule' && ts.isStringLiteralLike(property.initializer)) {
          rule = property.initializer.text;
        }
      }
      if (hasPath && rule !== null) found.push({ rule, file: fileName, how: 'violation-literal' });
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (/_RULES$/.test(node.name.text)) {
        const list = unwrap(node.initializer);
        if (ts.isArrayLiteralExpression(list)) {
          for (const element of list.elements) {
            if (ts.isStringLiteralLike(element)) {
              found.push({ rule: element.text, file: fileName, how: 'rule-list' });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

function typeScriptFilesUnder(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) typeScriptFilesUnder(full, collected);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) collected.push(full);
  }
  return collected;
}

/**
 * The verdict, as a list of sentences. Empty means aligned.
 *
 * Written as a pure function of its inputs so the cases below can drive it with
 * a tree that declares nothing and assert that it COMPLAINS — the property a
 * sweep silently loses when its own reading stops working.
 */
export function alignmentProblems(
  tokens: readonly RuleToken[],
  catalogues: Readonly<Record<string, Readonly<Record<string, string>>>>,
  exempt: ReadonlySet<string>
): string[] {
  const problems: string[] = [];
  if (tokens.length === 0) {
    problems.push(
      'no rule token was found in the API modules at all, which means this comparison read ' +
        'nothing and its silence proves nothing'
    );
    return problems;
  }
  const locales = Object.keys(catalogues);
  for (const rule of [...new Set(tokens.map((token) => token.rule))].sort()) {
    if (exempt.has(rule)) continue;
    const key = `form.violation.${rule}`;
    for (const locale of locales) {
      if (typeof catalogues[locale]?.[key] !== 'string') {
        problems.push(`${key} is missing from ${locale}`);
      }
    }
  }
  return problems;
}

/**
 * Tokens whose generic rendering IS the decision, each with the reason.
 *
 * Every one of these is already reasoned somewhere in the shipped source; the
 * citation is what stops the reason being re-litigated from memory. A token
 * leaves this list only by the reason ceasing to hold.
 */
const INTENTIONALLY_GENERIC: Readonly<Record<string, string>> = Object.freeze({
  grant_revoked:
    'names a route parameter on a decision somebody else already took; ' +
    '`lib/forms/action-result.ts` records that these must stay generic so they cannot ' +
    'downgrade the banner the failure kind already earns',
  not_invited: 'same family as the entry above, and recorded in the same place for the same reason',
  invitation_not_accepted:
    'same family as the two entries above, and recorded in the same place for the same reason',
  unregistered_aggregate:
    '`lib/api/client.ts` names this token as the example of one that must never reach a ' +
    'reader as itself; the generic sentence is the intended rendering',
  refused_by_identity_provider:
    'the provider strength policy refused a new secret and ADR-019 forbids repeating its own ' +
    'sentence; the screens that raise it show their own wording, so a field sentence here ' +
    'would be a second, weaker authority',
  empty_selection:
    'the refusal is computed from the caller’s OWN permissions — nothing they may see is ' +
    'left, whether they named fields or took the default selection the route supplies when ' +
    'none is named — so a specific sentence would tell a reader which fields exist but are ' +
    'being kept from them, which is a permission-internal fact and not theirs to learn',
  unknown_price_list:
    '`price-list-service.ts` refuses with "is not visible", not "does not exist"; a sentence ' +
    'of its own would separate a hidden price list from an absent one and turn the field into ' +
    "an existence oracle for rows outside the caller's scope",
  not_visible:
    'the service refuses a diagnostic type that is neither at platform scope nor in the ' +
    'organisation the caller belongs to; a specific sentence would separate "hidden from ' +
    'you" from "does not exist" and turn the field into an existence oracle for records ' +
    'outside the scope the caller may see, so the generic rendering is the decision',
});

/**
 * The measured backlog: tokens the API publishes with no sentence in either
 * catalogue.
 *
 * One hundred and one when this list was first taken. Eight of those are
 * decisions rather than debt and stand in the list above; sixty-nine have been
 * given sentences since; the twenty-four below are what remains. Each remaining
 * entry renders as the catalogue's honest generic today; each is a sentence
 * somebody owes. The list is written down rather than tolerated silently,
 * because a backlog nobody can count is a backlog nobody will clear.
 */
const OWED: readonly string[] = Object.freeze([
  'branch_requires_company',
  'catalogue_constraint',
  'digest_format',
  'duplicate-active-profile',
  'duplicate-certification',
  'incoherent_scope',
  'invalid_sha256',
  'not_allow_listed',
  'not_allowed',
  'one_subject_required',
  'overlapping-window',
  'template_mismatch',
  'token_mismatch',
  'unknown_entity_type',
  'unknown_field',
  'unknown_link_purpose',
  'unknown_permission_code',
  'unknown_purpose',
  'unknown_resource',
  'unregistered_sequence',
  'unregistered_transition',
  'unsupported_channel',
  'version_already_published',
  'version_immutable',
]);

/**
 * The ceiling the backlog may never rise back to.
 *
 * It is the size of `OWED` at the moment it was measured. The case that reads it
 * compares the list against itself, so the only way to raise the ceiling is to
 * edit this number in a diff a reviewer sees beside the tokens it admits.
 */
const OWED_CEILING = 24;

describe('every rule token the API publishes has a sentence, or is on a named list', () => {
  const files = typeScriptFilesUnder(API_MODULES);
  const tokens = files.flatMap((file) =>
    rulesInSource(relative(ROOT, file).split(sep).join('/'), readFileSync(file, 'utf8'))
  );
  const distinct = [...new Set(tokens.map((token) => token.rule))].sort();
  const byLocale = Object.fromEntries(
    CATALOGUES.map(({ locale, catalogue }) => [locale, catalogue])
  );
  const exempt = new Set([...Object.keys(INTENTIONALLY_GENERIC), ...OWED]);
  const has = (rule: string, locale: string): boolean =>
    typeof byLocale[locale]?.[`form.violation.${rule}`] === 'string';

  it('read the module tree, so nothing below passes over an empty parse', () => {
    expect(files.length, 'no API module source was read').toBeGreaterThan(100);
    expect(distinct.length, 'no rule token was parsed out of it').toBeGreaterThan(50);
    expect(
      tokens.some((token) => token.how === 'violation-literal'),
      'the parser no longer recognises a published violation'
    ).toBe(true);
    expect(
      tokens.some((token) => token.how === 'rule-list'),
      'the parser no longer recognises a closed rule-list constant'
    ).toBe(true);
    expect(
      distinct.filter((rule) => has(rule, 'en')).length,
      'not one token resolved to a sentence, so the lookup itself is broken'
    ).toBeGreaterThan(20);
  });

  it('has a sentence in both languages for every token that is not on a list', () => {
    expect(alignmentProblems(tokens, byLocale, exempt)).toEqual([]);
  });

  it('fails closed on a tree that declares nothing', () => {
    // The property a sweep loses silently. An empty token set must be reported
    // as "this read nothing", never as alignment.
    const problems = alignmentProblems([], byLocale, exempt);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('no rule token was found');
  });

  it('fails when a token that is on no list has no sentence', () => {
    const invented: RuleToken[] = [
      { rule: 'a_token_no_catalogue_carries', file: 'probe.ts', how: 'violation-literal' },
    ];
    const problems = alignmentProblems(invented, byLocale, exempt);
    expect(problems).toEqual([
      'form.violation.a_token_no_catalogue_carries is missing from en',
      'form.violation.a_token_no_catalogue_carries is missing from ar',
    ]);
  });

  it('parses declarations rather than prose about them', () => {
    // A docblock naming a token is not a token. This is the false green two
    // gates in this repository have already shipped, and the reason the reader
    // above is a parser.
    const text = [
      '/** Publishes `{ path: "body.x", rule: "written_only_in_a_comment" }`. */',
      'export function refuse() {',
      "  throw new Error(JSON.stringify({ path: 'body.x', rule: 'written_in_code' }));",
      '}',
      "export const PROBE_RULES = Object.freeze(['from_a_frozen_list'] as const);",
    ].join('\n');
    const rules = rulesInSource('probe.ts', text).map((token) => token.rule);
    expect(rules).toContain('written_in_code');
    expect(rules).toContain('from_a_frozen_list');
    expect(rules).not.toContain('written_only_in_a_comment');
  });

  it('keeps both lists shrinking: nothing exempt is stale, nothing exempt is already written', () => {
    const emitted = new Set(distinct);
    const stale = [...exempt].filter((rule) => !emitted.has(rule)).sort();
    expect(
      stale,
      'these are excused from a comparison nothing makes any more — delete them'
    ).toEqual([]);

    const alreadyWritten = [...exempt].filter((rule) => has(rule, 'en') || has(rule, 'ar')).sort();
    expect(
      alreadyWritten,
      'these now have a sentence and must leave the list, or the list starts hiding a later gap'
    ).toEqual([]);
  });

  it('records the backlog as a number that may only fall', () => {
    expect(
      OWED.length,
      `${OWED.length} rule tokens still render as the catalogue's generic sentence; the ceiling ` +
        `is ${OWED_CEILING} and is lowered, never raised`
    ).toBeLessThanOrEqual(OWED_CEILING);
    expect(new Set(OWED).size, 'the backlog lists a token twice').toBe(OWED.length);
    expect(
      Object.keys(INTENTIONALLY_GENERIC).every((rule) => !OWED.includes(rule)),
      'a token is both a decision and a debt'
    ).toBe(true);
    for (const reason of Object.values(INTENTIONALLY_GENERIC)) {
      expect(reason.length, 'an exemption with no reason is not an exemption').toBeGreaterThan(40);
    }
  });
});
