/**
 * P1-15 query primitives: bounded filtering, sorting, and query-bound cursors.
 *
 * `src/modules/shared-services/domain/query-primitives.ts` exists to make one
 * shape unavailable — `WHERE ${field} ${operator} '${value}'`. A review can
 * confirm the current source does not build SQL that way; only an executable
 * suite can keep it that way, because the regression is a one-line edit that
 * still returns correct rows for every honest input. So the assertions below are
 * written against the *emitted SQL text*, not against the helper's return code:
 * a builder that starts interpolating passes every "does it filter?" test ever
 * written and fails these.
 *
 * What is proven here, and why each one is worth an assertion:
 *
 *  - **Every caller value is a bound parameter.** Asserted by comparing the
 *    placeholder sequence in the predicate against `values`, and by requiring
 *    that the only single-quoted literal the builder may emit anywhere is the
 *    LIKE escape character.
 *  - **Caller strings never appear in SQL** — not the value, and not even the
 *    caller-visible field *name* (the contract maps it to a column constant).
 *    The fixture contract deliberately gives every field a name that differs
 *    from its column so this is falsifiable.
 *  - **Refusals are stable and silent about the payload.** Each rejection is
 *    checked for `ERR-VAL-001`, an exact `{path, rule}` violation with no extra
 *    keys, and the absence of the submitted value from both `safeDetails` and
 *    the developer message (that message reaches logs).
 *  - **Every bound is enforced**: filter count, `in` list length, empty `in`,
 *    text length. An unbounded `in` list is a denial-of-service with extra steps.
 *  - **Prefix filters cannot become wildcard scans.** `%`, `_` and `\` are
 *    escaped and the fragment carries `ESCAPE`, so the only unescaped wildcard
 *    in the bound value is the trailing one the builder itself appends.
 *  - **A cursor is bound to its query.** The same filters+sort+tenant produce
 *    the same ordering key; any change to any of the three produces a different
 *    key, and `decodeCursor()` fails closed across them with `ERR-PAG-001`.
 *
 * ## Two limits this file states rather than hides
 *
 * 1. The cursor is unsigned base64url JSON and the fingerprint is not a
 *    signature. Editing `v`/`i` while leaving `k` intact IS accepted, and the
 *    test named for it asserts that acceptance instead of pretending otherwise.
 *    That is safe only because the cursor decides nothing about authorization —
 *    every page still runs under RLS — and it is asserted so the day someone
 *    claims the cursor is tamper-proof, this file contradicts them.
 * 2. The structural-equivalence proof between the module-local
 *    `OrderingContract` and the foundation's is a *compile-time* one. Vitest
 *    does not typecheck, so `npm run typecheck` is what enforces it; the runtime
 *    assertions in that test only keep the bindings live. The same test also
 *    passes the module value straight into `pageRequest()`/`keysetFragment()`,
 *    which is the runtime half of the same claim.
 *
 * Fixture ids mirror the deterministic UUIDs in `tests/db/helpers.ts`; nothing
 * here touches a database, a clock, or a network.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_FILTERS,
  MAX_FILTER_TEXT_LENGTH,
  MAX_IN_VALUES,
  boundOrderingContract,
  buildFilterPredicate,
  escapeLikePrefix,
  resolveSort,
  type BuiltFilter,
  type FilterInput,
  type OrderingContract as ModuleOrderingContract,
  type QueryContract,
  type SortInput,
} from '@/modules/shared-services/domain/query-primitives';
import {
  decodeCursor,
  encodeCursor,
  keysetFragment,
  pageRequest,
  type Cursor,
  type OrderingContract as FoundationOrderingContract,
} from '@/server/db/pagination';
import { AppFailure, isAppFailure } from '@/server/errors/app-failure';

// Deterministic fixture UUIDs (database-test-fixtures standard, mirrored from
// tests/db/helpers.ts rather than imported: that module opens pg pools and
// belongs to the database tier, and this file must stay database-free).
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = 'a0000000-0000-4000-8000-000000000001';
const USER_B = 'b0000000-0000-4000-8000-000000000001';
const ROW_A1 = 'a1000000-0000-4000-8000-000000000001';

/**
 * Fixture contract. Every `name` differs from its `column` on purpose: it makes
 * "the caller-visible name never reaches SQL" a falsifiable claim rather than a
 * coincidence of naming.
 */
const CONTRACT: QueryContract = {
  key: 'shared.documents',
  filterable: [
    { name: 'ownerId', column: 'd.owner_id', type: 'uuid', operators: ['eq', 'in'] },
    {
      name: 'displayTitle',
      column: 'd.display_title',
      type: 'text',
      operators: ['eq', 'prefix', 'in'],
    },
    { name: 'createdAt', column: 'd.created_at', type: 'timestamp', operators: ['gte', 'lte'] },
    {
      name: 'revisionNumber',
      column: 'd.revision_number',
      type: 'integer',
      operators: ['eq', 'gt', 'in'],
    },
    { name: 'isArchived', column: 'd.is_archived', type: 'boolean', operators: ['eq'] },
    {
      name: 'taxIdentifier',
      column: 'd.tax_identifier',
      type: 'text',
      operators: ['eq', 'prefix'],
      sensitive: true,
    },
  ],
  sortable: [
    { name: 'createdAt', column: 'd.created_at' },
    { name: 'displayTitle', column: 'd.display_title' },
  ],
  defaultSort: { field: 'createdAt', direction: 'desc' },
  idColumn: 'd.id',
};

/** Every caller-visible filterable/sortable name in the fixture contract. */
const CALLER_VISIBLE_NAMES = [
  ...CONTRACT.filterable.map((field) => field.name),
  ...CONTRACT.sortable.map((field) => field.name),
];

const PUBLIC_READER = { mayReadSensitive: false } as const;
const SENSITIVE_READER = { mayReadSensitive: true } as const;

/**
 * Payloads that would end the story if any of them were interpolated. They are
 * submitted as *values*, which is the only place a caller string is accepted at
 * all — field names and operators are matched against the contract.
 */
const INJECTION_PAYLOADS = [
  "' OR 1=1 --",
  "'; DROP TABLE shared.documents; --",
  "' UNION SELECT id FROM iam.users --",
  "x'); DELETE FROM shared.documents; --",
  "100%_' OR '1'='1",
] as const;

function captureFailure(run: () => unknown): AppFailure {
  try {
    run();
  } catch (error) {
    if (isAppFailure(error)) return error;
    throw error;
  }
  throw new Error('expected the call to throw an AppFailure');
}

/** Asserts the refusal is the documented one and carries nothing else. */
function expectValidationFailure(failure: AppFailure, path: string, rule: string): void {
  expect(failure.code).toBe('ERR-VAL-001');
  expect(failure.status).toBe(422);
  expect(failure.safeDetails.violations).toEqual([{ path, rule }]);
  // No extra keys: `safeDetails` is the ONLY structure that reaches a caller, so
  // an added field is an added disclosure.
  expect(Object.keys(failure.safeDetails.violations?.[0] ?? {}).sort()).toEqual(['path', 'rule']);
}

/**
 * Asserts the submitted payload appears in neither the caller-safe details nor
 * the developer message. Filter values are business data and the message is
 * written to logs.
 */
function expectNoEcho(failure: AppFailure, submitted: string): void {
  expect(JSON.stringify(failure.safeDetails)).not.toContain(submitted);
  expect(failure.message).not.toContain(submitted);
}

const placeholders = (sql: string): string[] => sql.match(/\$\d+/g) ?? [];

const singleQuotedLiterals = (sql: string): string[] =>
  [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');

/**
 * The central structural claim: the predicate carries exactly one placeholder
 * per bound value, numbered consecutively from `startIndex`, and the only
 * single-quoted literal it is permitted to contain is the LIKE escape character.
 */
function expectFullyParameterised(built: BuiltFilter, startIndex: number): void {
  expect(placeholders(built.predicate)).toEqual(
    built.values.map((_value, offset) => `$${startIndex + offset}`)
  );
  expect(built.nextParamIndex).toBe(startIndex + built.values.length);
  for (const literal of singleQuotedLiterals(built.predicate)) expect(literal).toBe('\\');
}

/** Asserts no caller-visible contract name leaked into the emitted SQL. */
function expectNoCallerVisibleNames(predicate: string): void {
  for (const name of CALLER_VISIBLE_NAMES) expect(predicate).not.toContain(name);
}

/** True when every `%` and `_` in the value is backslash-escaped. */
function hasOnlyEscapedWildcards(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '%' || character === '_') return false;
  }
  return true;
}

describe('buildFilterPredicate: every caller value becomes a bound parameter', () => {
  it('emits no predicate, no values and no index movement when nothing is filtered', () => {
    const built = buildFilterPredicate(CONTRACT, [], 1, PUBLIC_READER);

    expect(built.predicate).toBe('');
    expect(built.values).toEqual([]);
    expect(built.nextParamIndex).toBe(1);
    expect(built.canonical).toBe('');
  });

  it('binds a single scalar and records it canonically without touching the SQL text', () => {
    const built = buildFilterPredicate(
      CONTRACT,
      [{ field: 'ownerId', operator: 'eq', value: USER_A }],
      1,
      PUBLIC_READER
    );

    expect(built.predicate).toBe('AND d.owner_id = $1');
    expect(built.values).toEqual([USER_A]);
    expect(built.canonical).toBe(`ownerId:eq:${USER_A}`);
    expect(built.predicate).not.toContain(USER_A);
    expectFullyParameterised(built, 1);
    expectNoCallerVisibleNames(built.predicate);
  });

  it('binds every operator in one mixed query with consecutive placeholders', () => {
    const built = buildFilterPredicate(
      CONTRACT,
      [
        { field: 'ownerId', operator: 'in', value: [USER_A, USER_B] },
        { field: 'displayTitle', operator: 'prefix', value: 'fx_' },
        { field: 'createdAt', operator: 'gte', value: '2026-07-01' },
        { field: 'revisionNumber', operator: 'gt', value: 3 },
        { field: 'isArchived', operator: 'eq', value: false },
      ],
      1,
      PUBLIC_READER
    );

    expect(built.predicate).toBe(
      'AND d.owner_id = ANY($1::uuid[]) ' +
        "AND d.display_title LIKE $2 ESCAPE '\\' " +
        'AND d.created_at >= $3 ' +
        'AND d.revision_number > $4 ' +
        'AND d.is_archived = $5'
    );
    expect(built.values).toEqual([[USER_A, USER_B], 'fx\\_%', '2026-07-01', 3, false]);
    expectFullyParameterised(built, 1);
    expectNoCallerVisibleNames(built.predicate);
  });

  it('continues the parameter numbering it was given instead of restarting at $1', () => {
    const built = buildFilterPredicate(
      CONTRACT,
      [
        { field: 'ownerId', operator: 'eq', value: USER_A },
        { field: 'isArchived', operator: 'eq', value: true },
      ],
      4,
      PUBLIC_READER
    );

    expect(built.predicate).toBe('AND d.owner_id = $4 AND d.is_archived = $5');
    expect(built.nextParamIndex).toBe(6);
    expectFullyParameterised(built, 4);
  });

  it('normalises a UUID to lower case as data, never as text spliced into SQL', () => {
    const built = buildFilterPredicate(
      CONTRACT,
      [{ field: 'ownerId', operator: 'eq', value: USER_A.toUpperCase() }],
      1,
      PUBLIC_READER
    );

    expect(built.values).toEqual([USER_A]);
    expect(built.predicate).toBe('AND d.owner_id = $1');
  });

  it('casts an `in` list to the declared array type of the field', () => {
    const built = buildFilterPredicate(
      CONTRACT,
      [{ field: 'revisionNumber', operator: 'in', value: [1, 2, 3] }],
      1,
      PUBLIC_READER
    );

    expect(built.predicate).toBe('AND d.revision_number = ANY($1::bigint[])');
    expect(built.values).toEqual([[1, 2, 3]]);
    expectFullyParameterised(built, 1);
  });
});

describe('buildFilterPredicate: refusals are stable and never echo the payload', () => {
  const UNKNOWN_FIELD_PAYLOAD = 'fx_unknown_field_payload_a1';

  it('refuses a field the contract does not offer', () => {
    const failure = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [{ field: 'internalCostBasis', operator: 'eq', value: UNKNOWN_FIELD_PAYLOAD }],
        1,
        PUBLIC_READER
      )
    );

    expectValidationFailure(failure, 'query.filter.0', 'unknown_field');
    expectNoEcho(failure, UNKNOWN_FIELD_PAYLOAD);
    // The unrecognised name is not quoted back either; it is never interpolated,
    // not even into an error.
    expectNoEcho(failure, 'internalCostBasis');
  });

  it('reports the position of the offending filter, not just that one failed', () => {
    const failure = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [
          { field: 'ownerId', operator: 'eq', value: USER_A },
          { field: 'isArchived', operator: 'eq', value: false },
          { field: 'internalCostBasis', operator: 'eq', value: UNKNOWN_FIELD_PAYLOAD },
        ],
        1,
        PUBLIC_READER
      )
    );

    expectValidationFailure(failure, 'query.filter.2', 'unknown_field');
  });

  it('refuses an operator the field does not declare, so equality cannot become a scan', () => {
    const failure = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [{ field: 'ownerId', operator: 'prefix', value: 'a1000000' }],
        1,
        PUBLIC_READER
      )
    );

    expectValidationFailure(failure, 'query.filter.0', 'unsupported_operator');
    expectNoEcho(failure, 'a1000000');
  });

  it.each([
    ['uuid', { field: 'ownerId', operator: 'eq', value: 'fx_not_a_uuid_value' }, 'invalid_uuid'],
    ['text', { field: 'displayTitle', operator: 'eq', value: 12345 }, 'invalid_type'],
    [
      'timestamp',
      { field: 'createdAt', operator: 'gte', value: 'fx_not_a_timestamp' },
      'invalid_timestamp',
    ],
    [
      'integer',
      { field: 'revisionNumber', operator: 'gt', value: 'fx_not_an_integer' },
      'invalid_integer',
    ],
    [
      'integer (fractional)',
      { field: 'revisionNumber', operator: 'gt', value: 1.5 },
      'invalid_integer',
    ],
    [
      'boolean',
      { field: 'isArchived', operator: 'eq', value: 'fx_not_a_boolean' },
      'invalid_boolean',
    ],
  ] as const)('refuses a %s field given the wrong value type', (_label, filter, rule) => {
    const failure = captureFailure(() =>
      buildFilterPredicate(CONTRACT, [filter as FilterInput], 1, PUBLIC_READER)
    );

    expectValidationFailure(failure, 'query.filter.0', rule);
    if (typeof filter.value === 'string') expectNoEcho(failure, filter.value);
  });

  it('refuses filter text longer than the declared bound', () => {
    const overlong = `fx_${'a'.repeat(MAX_FILTER_TEXT_LENGTH)}`;
    expect(overlong.length).toBeGreaterThan(MAX_FILTER_TEXT_LENGTH);

    const failure = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [{ field: 'displayTitle', operator: 'eq', value: overlong }],
        1,
        PUBLIC_READER
      )
    );

    expectValidationFailure(failure, 'query.filter.0', 'too_long');
    expectNoEcho(failure, overlong);
  });

  it('refuses a list for a scalar operator and a scalar for `in`', () => {
    const listForScalar = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [{ field: 'revisionNumber', operator: 'eq', value: [1, 2] }],
        1,
        PUBLIC_READER
      )
    );
    expectValidationFailure(listForScalar, 'query.filter.0', 'invalid_type');

    const scalarForList = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [{ field: 'revisionNumber', operator: 'in', value: 7 }],
        1,
        PUBLIC_READER
      )
    );
    expectValidationFailure(scalarForList, 'query.filter.0', 'invalid_type');
  });
});

describe('buildFilterPredicate: every bound is enforced', () => {
  const uuidAt = (position: number): string =>
    `a1000000-0000-4000-8000-00000000000${position.toString(16)}`;

  it('accepts exactly MAX_FILTERS filters', () => {
    expect(MAX_FILTERS).toBe(8);
    const filters: FilterInput[] = Array.from({ length: MAX_FILTERS }, (_unused, position) => ({
      field: 'ownerId',
      operator: 'eq',
      value: uuidAt(position + 1),
    }));

    const built = buildFilterPredicate(CONTRACT, filters, 1, PUBLIC_READER);

    expect(placeholders(built.predicate)).toHaveLength(MAX_FILTERS);
    expectFullyParameterised(built, 1);
  });

  it('refuses one filter more than MAX_FILTERS', () => {
    const filters: FilterInput[] = Array.from({ length: MAX_FILTERS + 1 }, (_unused, position) => ({
      field: 'ownerId',
      operator: 'eq',
      value: uuidAt(position + 1),
    }));

    const failure = captureFailure(() => buildFilterPredicate(CONTRACT, filters, 1, PUBLIC_READER));

    // Rejected as a whole-query violation before any field is examined: the
    // bound protects the builder itself, not an individual filter.
    expectValidationFailure(failure, 'query.filter', 'too_many_filters');
  });

  it('accepts exactly MAX_IN_VALUES values in an `in` list', () => {
    expect(MAX_IN_VALUES).toBe(50);
    const list = Array.from({ length: MAX_IN_VALUES }, (_unused, index) => index + 1);

    const built = buildFilterPredicate(
      CONTRACT,
      [{ field: 'revisionNumber', operator: 'in', value: list }],
      1,
      PUBLIC_READER
    );

    expect(built.values).toEqual([list]);
    expectFullyParameterised(built, 1);
  });

  it('refuses one value more than MAX_IN_VALUES', () => {
    const list = Array.from({ length: MAX_IN_VALUES + 1 }, (_unused, index) => index + 1);

    const failure = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [{ field: 'revisionNumber', operator: 'in', value: list }],
        1,
        PUBLIC_READER
      )
    );

    expectValidationFailure(failure, 'query.filter.0', 'list_too_long');
  });

  it('refuses an empty `in` list rather than emitting a predicate that matches nothing', () => {
    const failure = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [{ field: 'revisionNumber', operator: 'in', value: [] }],
        1,
        PUBLIC_READER
      )
    );

    expectValidationFailure(failure, 'query.filter.0', 'empty_list');
  });
});

describe('buildFilterPredicate: injection payloads are bound, never interpolated', () => {
  it.each(INJECTION_PAYLOADS)('binds %j submitted to an equality filter', (payload) => {
    const built = buildFilterPredicate(
      CONTRACT,
      [{ field: 'displayTitle', operator: 'eq', value: payload }],
      1,
      PUBLIC_READER
    );

    // Exact equality is the strongest available statement: the emitted text is
    // fully determined by the contract and the parameter index.
    expect(built.predicate).toBe('AND d.display_title = $1');
    expect(built.predicate).not.toContain(payload);
    expect(built.values).toEqual([payload]);
    expectFullyParameterised(built, 1);
  });

  it.each(INJECTION_PAYLOADS)('binds %j submitted to a prefix filter', (payload) => {
    const built = buildFilterPredicate(
      CONTRACT,
      [{ field: 'displayTitle', operator: 'prefix', value: payload }],
      1,
      PUBLIC_READER
    );

    expect(built.predicate).toBe("AND d.display_title LIKE $1 ESCAPE '\\'");
    expect(built.predicate).not.toContain(payload);
    expect(built.values).toEqual([`${escapeLikePrefix(payload)}%`]);
    expectFullyParameterised(built, 1);
  });

  it.each(INJECTION_PAYLOADS)('binds %j inside an `in` list, as one array parameter', (payload) => {
    const built = buildFilterPredicate(
      CONTRACT,
      [{ field: 'displayTitle', operator: 'in', value: ['fx_ordinary_value', payload] }],
      1,
      PUBLIC_READER
    );

    // The whole list is a single bound array, so list length changes the data
    // and never the SQL text.
    expect(built.predicate).toBe('AND d.display_title = ANY($1::text[])');
    expect(built.predicate).not.toContain(payload);
    expect(built.values).toEqual([['fx_ordinary_value', payload]]);
    expectFullyParameterised(built, 1);
  });

  it.each(INJECTION_PAYLOADS)('refuses %j against a typed field before binding it', (payload) => {
    // On a uuid field the payload never reaches the builder at all: the declared
    // type rejects it first, and the refusal does not quote it back.
    const rejected = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [{ field: 'ownerId', operator: 'in', value: [USER_A, payload] }],
        1,
        PUBLIC_READER
      )
    );

    expectValidationFailure(rejected, 'query.filter.0', 'invalid_uuid');
    expectNoEcho(rejected, payload);
  });

  it('refuses an injection payload submitted as a field name or a sort field', () => {
    const asField = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [{ field: "d.owner_id = d.owner_id OR '1'='1", operator: 'eq', value: USER_A }],
        1,
        PUBLIC_READER
      )
    );
    expectValidationFailure(asField, 'query.filter.0', 'unknown_field');
    expectNoEcho(asField, "OR '1'='1");

    const asSort = captureFailure(() =>
      resolveSort(CONTRACT, { field: 'created_at; DROP TABLE shared.documents', direction: 'asc' })
    );
    expectValidationFailure(asSort, 'query.sort.field', 'unknown_field');
    expectNoEcho(asSort, 'DROP TABLE');
  });
});

describe('escapeLikePrefix', () => {
  it.each([
    ['plain-fx-value', 'plain-fx-value'],
    ['100%', '100\\%'],
    ['fx_code', 'fx\\_code'],
    ['a\\b', 'a\\\\b'],
    ['%_\\', '\\%\\_\\\\'],
    ['%%__', '\\%\\%\\_\\_'],
  ])('escapes %j to %j', (input, expected) => {
    expect(escapeLikePrefix(input)).toBe(expected);
  });

  it('leaves a value with no LIKE metacharacters untouched', () => {
    expect(escapeLikePrefix('fx-2026-07-23')).toBe('fx-2026-07-23');
  });

  it('produces a bound value whose only unescaped wildcard is the one it appended', () => {
    const built = buildFilterPredicate(
      CONTRACT,
      [{ field: 'displayTitle', operator: 'prefix', value: '%_\\fx_' }],
      1,
      PUBLIC_READER
    );

    expect(built.predicate).toBe("AND d.display_title LIKE $1 ESCAPE '\\'");
    expect(built.values).toEqual(['\\%\\_\\\\fx\\_%']);

    const bound = String(built.values[0]);
    expect(bound.endsWith('%')).toBe(true);
    // Strip the anchor the builder appended; nothing wildcard-capable may remain.
    expect(hasOnlyEscapedWildcards(bound.slice(0, -1))).toBe(true);
  });

  it('would let a bare `%` become a full scan if the escape were dropped', () => {
    // The negative control for the assertion above: an unescaped value fails the
    // same check, so `hasOnlyEscapedWildcards` is not vacuously true.
    expect(hasOnlyEscapedWildcards('%')).toBe(false);
    expect(hasOnlyEscapedWildcards('fx_code')).toBe(false);
    expect(hasOnlyEscapedWildcards('fx\\_code')).toBe(true);
  });
});

describe('sensitive fields', () => {
  it('refuses a sensitive field when the caller may not read sensitive data', () => {
    const failure = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [{ field: 'taxIdentifier', operator: 'eq', value: 'fx_tax_identifier_a1' }],
        1,
        PUBLIC_READER
      )
    );

    expectValidationFailure(failure, 'query.filter.0', 'sensitive_field');
    expectNoEcho(failure, 'fx_tax_identifier_a1');
  });

  it('refuses rather than silently dropping the filter', () => {
    // Dropping it would widen the result set while looking like the filter
    // worked — the failure mode this rule exists to prevent.
    const built = buildFilterPredicate(
      CONTRACT,
      [{ field: 'ownerId', operator: 'eq', value: USER_A }],
      1,
      PUBLIC_READER
    );
    expect(built.predicate).toBe('AND d.owner_id = $1');

    expect(() =>
      buildFilterPredicate(
        CONTRACT,
        [
          { field: 'ownerId', operator: 'eq', value: USER_A },
          { field: 'taxIdentifier', operator: 'eq', value: 'fx_tax_identifier_a1' },
        ],
        1,
        PUBLIC_READER
      )
    ).toThrow(AppFailure);
  });

  it('gives the same refusal whether or not the operator would have been valid', () => {
    // Filtering is a read oracle. If the unpermitted caller learned which
    // operators the field supports, the refusal would leak the contract.
    const supported = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [{ field: 'taxIdentifier', operator: 'eq', value: 'fx_tax_identifier_a1' }],
        1,
        PUBLIC_READER
      )
    );
    const unsupported = captureFailure(() =>
      buildFilterPredicate(
        CONTRACT,
        [{ field: 'taxIdentifier', operator: 'gt', value: 'fx_tax_identifier_a1' }],
        1,
        PUBLIC_READER
      )
    );

    expectValidationFailure(supported, 'query.filter.0', 'sensitive_field');
    expectValidationFailure(unsupported, 'query.filter.0', 'sensitive_field');
    expect(unsupported.safeDetails).toEqual(supported.safeDetails);
  });

  it('allows the sensitive field when the caller holds the permission, still bound', () => {
    const built = buildFilterPredicate(
      CONTRACT,
      [{ field: 'taxIdentifier', operator: 'eq', value: 'fx_tax_identifier_a1' }],
      1,
      SENSITIVE_READER
    );

    expect(built.predicate).toBe('AND d.tax_identifier = $1');
    expect(built.values).toEqual(['fx_tax_identifier_a1']);
    expect(built.predicate).not.toContain('fx_tax_identifier_a1');
    expectFullyParameterised(built, 1);
  });
});

describe('resolveSort', () => {
  it('falls back to the contract default when the caller names no sort', () => {
    expect(resolveSort(CONTRACT, undefined)).toEqual({
      column: 'd.created_at',
      direction: 'desc',
      canonical: 'createdAt:desc',
    });
  });

  it('resolves a requested sort to the column constant, not the caller name', () => {
    const sort = resolveSort(CONTRACT, { field: 'displayTitle', direction: 'asc' });

    expect(sort).toEqual({
      column: 'd.display_title',
      direction: 'asc',
      canonical: 'displayTitle:asc',
    });
    expect(sort.column).not.toContain('displayTitle');
  });

  it('refuses a field the contract does not declare sortable', () => {
    // `taxIdentifier` is filterable but not sortable: the two lists are separate
    // grants, and sorting by a column is its own read oracle.
    const failure = captureFailure(() =>
      resolveSort(CONTRACT, { field: 'taxIdentifier', direction: 'asc' })
    );

    expectValidationFailure(failure, 'query.sort.field', 'unknown_field');
    expectNoEcho(failure, 'taxIdentifier');
  });

  it('refuses a direction outside asc/desc', () => {
    const failure = captureFailure(() =>
      resolveSort(CONTRACT, {
        field: 'displayTitle',
        direction: 'asc; DROP TABLE shared.documents',
      } as unknown as SortInput)
    );

    expectValidationFailure(failure, 'query.sort.direction', 'invalid_direction');
    expectNoEcho(failure, 'DROP TABLE');
  });
});

describe('boundOrderingContract', () => {
  const sortDesc = resolveSort(CONTRACT, undefined);
  const sortAsc = resolveSort(CONTRACT, { field: 'displayTitle', direction: 'asc' });

  const canonicalOf = (filters: readonly FilterInput[]): string =>
    buildFilterPredicate(CONTRACT, filters, 1, PUBLIC_READER).canonical;

  const FILTERS_A: readonly FilterInput[] = [
    { field: 'ownerId', operator: 'eq', value: USER_A },
    { field: 'isArchived', operator: 'eq', value: false },
  ];
  const FILTERS_B: readonly FilterInput[] = [
    { field: 'ownerId', operator: 'eq', value: USER_B },
    { field: 'isArchived', operator: 'eq', value: false },
  ];

  const CANONICAL_A = canonicalOf(FILTERS_A);
  const CANONICAL_B = canonicalOf(FILTERS_B);

  it('produces a stable key for the same filters, sort and tenant', () => {
    const first = boundOrderingContract(CONTRACT, sortDesc, CANONICAL_A, TENANT_A);
    const second = boundOrderingContract(CONTRACT, sortDesc, CANONICAL_A, TENANT_A);

    expect(first).toEqual(second);
    expect(first.key).toMatch(/^shared\.documents#[0-9a-f]{16}$/);
    expect(first.direction).toBe('desc');
  });

  it('is insensitive to the order the caller submitted the filters in', () => {
    // The canonical form is sorted, so re-ordering the query string must not
    // invalidate a cursor the caller is already paging with.
    const reversed = canonicalOf([...FILTERS_A].reverse());
    expect(reversed).toBe(CANONICAL_A);
    expect(boundOrderingContract(CONTRACT, sortDesc, reversed, TENANT_A).key).toBe(
      boundOrderingContract(CONTRACT, sortDesc, CANONICAL_A, TENANT_A).key
    );
  });

  it('changes the key when a filter value changes', () => {
    expect(CANONICAL_B).not.toBe(CANONICAL_A);
    expect(boundOrderingContract(CONTRACT, sortDesc, CANONICAL_B, TENANT_A).key).not.toBe(
      boundOrderingContract(CONTRACT, sortDesc, CANONICAL_A, TENANT_A).key
    );
  });

  it('changes the key when the sort changes', () => {
    expect(boundOrderingContract(CONTRACT, sortAsc, CANONICAL_A, TENANT_A).key).not.toBe(
      boundOrderingContract(CONTRACT, sortDesc, CANONICAL_A, TENANT_A).key
    );
  });

  it('changes the key when the tenant changes', () => {
    expect(boundOrderingContract(CONTRACT, sortDesc, CANONICAL_A, TENANT_B).key).not.toBe(
      boundOrderingContract(CONTRACT, sortDesc, CANONICAL_A, TENANT_A).key
    );
  });

  it('carries the resolved direction through to the ordering contract', () => {
    expect(boundOrderingContract(CONTRACT, sortAsc, CANONICAL_A, TENANT_A).direction).toBe('asc');
  });
});

describe('cursors are bound to the query that issued them', () => {
  const sortDesc = resolveSort(CONTRACT, undefined);
  const sortAsc = resolveSort(CONTRACT, { field: 'displayTitle', direction: 'asc' });

  const canonicalOf = (filters: readonly FilterInput[]): string =>
    buildFilterPredicate(CONTRACT, filters, 1, PUBLIC_READER).canonical;

  const CANONICAL_A = canonicalOf([{ field: 'ownerId', operator: 'eq', value: USER_A }]);
  const CANONICAL_B = canonicalOf([{ field: 'ownerId', operator: 'eq', value: USER_B }]);

  const ORDERING = boundOrderingContract(CONTRACT, sortDesc, CANONICAL_A, TENANT_A);
  const OTHER_FILTERS = boundOrderingContract(CONTRACT, sortDesc, CANONICAL_B, TENANT_A);
  const OTHER_SORT = boundOrderingContract(CONTRACT, sortAsc, CANONICAL_A, TENANT_A);
  const OTHER_TENANT = boundOrderingContract(CONTRACT, sortDesc, CANONICAL_A, TENANT_B);

  const POSITION: Cursor = { k: ORDERING.key, v: '2026-07-21T00:00:00.000Z', i: ROW_A1 };
  const issued = encodeCursor(POSITION);

  it('accepts a cursor under the contract that issued it', () => {
    expect(decodeCursor(issued, ORDERING)).toEqual(POSITION);
  });

  it('refuses the cursor when the filter set changed', () => {
    const failure = captureFailure(() => decodeCursor(issued, OTHER_FILTERS));

    expect(failure.code).toBe('ERR-PAG-001');
    expect(failure.status).toBe(400);
    // The alternative is worse than an error: a page from the wrong position
    // that looks perfectly healthy.
    expect(JSON.stringify(failure.safeDetails)).not.toContain(ROW_A1);
  });

  it('refuses the cursor when the sort changed', () => {
    expect(captureFailure(() => decodeCursor(issued, OTHER_SORT)).code).toBe('ERR-PAG-001');
  });

  it('refuses the cursor when the tenant changed', () => {
    expect(captureFailure(() => decodeCursor(issued, OTHER_TENANT)).code).toBe('ERR-PAG-001');
  });

  it('refuses through pageRequest(), the entry point a route actually calls', () => {
    expect(pageRequest(ORDERING, { limit: 10, cursor: issued }).cursor).toEqual(POSITION);
    expect(
      captureFailure(() => pageRequest(OTHER_TENANT, { limit: 10, cursor: issued })).code
    ).toBe('ERR-PAG-001');
  });

  it('refuses a cursor whose base64url payload was edited to change the contract key', () => {
    const decoded = JSON.parse(Buffer.from(issued, 'base64url').toString('utf8')) as Cursor;
    const lastCharacter = decoded.k.slice(-1);
    const tampered = encodeCursor({
      ...decoded,
      k: `${decoded.k.slice(0, -1)}${lastCharacter === '0' ? '1' : '0'}`,
    });

    expect(tampered).not.toBe(issued);
    expect(captureFailure(() => decodeCursor(tampered, ORDERING)).code).toBe('ERR-PAG-001');
  });

  it('refuses a truncated payload and a well-formed document of the wrong shape', () => {
    const truncated = issued.slice(0, 12);
    expect(captureFailure(() => decodeCursor(truncated, ORDERING)).code).toBe('ERR-PAG-001');

    const wrongShape = Buffer.from(
      JSON.stringify({ k: ORDERING.key, v: 1, i: 2 }),
      'utf8'
    ).toString('base64url');
    expect(captureFailure(() => decodeCursor(wrongShape, ORDERING)).code).toBe('ERR-PAG-001');
  });

  it('does NOT detect a payload edit that only moves the position (documented limit)', () => {
    // Stated, not hidden: the fingerprint binds the *query*, not the position,
    // and it is a fingerprint rather than a signature — no key management is
    // provisioned. A caller who edits `v`/`i` while leaving `k` intact gets a
    // different page OF THEIR OWN ROWS, because the page still runs under RLS
    // and the caller's own context. If cursor integrity ever becomes a security
    // claim, this test must fail first.
    const moved = encodeCursor({ ...POSITION, v: '2020-01-01T00:00:00.000Z', i: USER_B });

    expect(decodeCursor(moved, ORDERING)).toEqual({
      k: ORDERING.key,
      v: '2020-01-01T00:00:00.000Z',
      i: USER_B,
    });
  });
});

describe('structural equivalence with the foundation ordering contract', () => {
  it('keeps the module-local OrderingContract assignable to @/server/db/pagination', () => {
    const sort = resolveSort(CONTRACT, undefined);
    const canonical = buildFilterPredicate(
      CONTRACT,
      [{ field: 'ownerId', operator: 'eq', value: USER_A }],
      1,
      PUBLIC_READER
    ).canonical;

    const moduleContract: ModuleOrderingContract = boundOrderingContract(
      CONTRACT,
      sort,
      canonical,
      TENANT_A
    );

    // The compile-time proof. `npm run typecheck` is what enforces it — vitest
    // does not typecheck — so if the foundation type gains a field, the failure
    // lands here rather than as a silent divergence between the two shapes.
    const foundationContract: FoundationOrderingContract = moduleContract;
    const roundTrip: ModuleOrderingContract = foundationContract;

    expect(foundationContract).toBe(moduleContract);
    expect(roundTrip.key).toBe(moduleContract.key);
    expect(roundTrip.direction).toBe('desc');
  });

  it('is accepted unchanged by the foundation pagination helpers', () => {
    const sort = resolveSort(CONTRACT, undefined);
    const filter = buildFilterPredicate(
      CONTRACT,
      [{ field: 'ownerId', operator: 'eq', value: USER_A }],
      1,
      PUBLIC_READER
    );
    const ordering = boundOrderingContract(CONTRACT, sort, filter.canonical, TENANT_A);

    const request = pageRequest(ordering, { limit: 10 });
    expect(request).toEqual({ limit: 10, cursor: null });

    // The filter's `nextParamIndex` hands off to the keyset fragment, so the two
    // layers share one continuous parameter sequence.
    const fragment = keysetFragment(
      request,
      { sort: sort.column, id: CONTRACT.idColumn },
      ordering,
      filter.nextParamIndex
    );
    expect(fragment.order).toBe('ORDER BY d.created_at DESC, d.id DESC');
    expect(fragment.limitClause).toBe('LIMIT $2');
    expect(fragment.values).toEqual([11]);
  });
});
