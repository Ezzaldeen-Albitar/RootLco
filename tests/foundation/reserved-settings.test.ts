/**
 * A setting is not operational because a validator accepts it.
 *
 * `backend-config.ts` hands the whole of `process.env` to one zod object, and
 * for a long time the only thing that distinguished a setting the deployment
 * could rely on from one that did nothing at all was whether somebody had
 * happened to write a consumer. Two names — `CORS_ALLOWED_ORIGINS` and
 * `CACHE_DEFAULT_TTL_SECONDS` — were validated, documented, carried in the
 * templates and, in the CORS case, REQUIRED of a deployment by the readiness
 * check, while no line of code read either. A deployment could have been held
 * out of rotation for omitting a value that governs nothing.
 *
 * This suite is the mechanical answer, and its shape matters:
 *
 *  - **The accepted names come from the schema itself**, via
 *    `ACCEPTED_SETTING_NAMES`, which is `Object.keys(schema.shape)`. Nothing
 *    here re-parses the source and nothing here reads prose, so a name added to
 *    the schema is in scope from the moment it exists — there is no second list
 *    to forget.
 *  - **Consumption is decided by reading the source**, not by a curated
 *    inventory. The inventory in `docs/platform/environment-configuration.md`
 *    describes what this measures; it is never the input.
 *  - **The two lists must not overlap.** A reserved name in the
 *    production-required set is precisely the defect this exists to prevent.
 *  - **The other two schemas are in scope too.** `apps/api/src/config/env.ts`
 *    and `apps/web/src/lib/env.ts` accept names of their own, and a name
 *    validated there while nothing reads it is the same defect wearing a
 *    different file name. Their keys are read from the schema source by the
 *    extractor the environment-contract check already uses, and each is looked
 *    for in its own tier's tree.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCEPTED_SETTING_NAMES,
  REQUIRED_WHEN_DEPLOYED,
  RESERVED_SETTINGS,
} from '@api/server/config/backend-config';
import { readSchemaKeys } from '../../scripts/ci/check-env-contract.mjs';
import {
  API_SRC_ROOT,
  WEB_SRC_ROOT,
  toRepositoryPath,
} from '../../scripts/lib/repository-paths.mjs';

/** The module that declares the settings. A name read here is not a consumer. */
const CONFIG_MODULE = join(API_SRC_ROOT, 'server', 'config', 'backend-config.ts');

/**
 * The three spellings by which this codebase READS a setting, and deliberately
 * nothing looser.
 *
 *  1. `config.NAME` / `process.env.NAME` — a property access, the common form.
 *  2. `env['NAME']` — the indexed form `productionConfigurationProblems` uses.
 *  3. `const { NAME } = backendConfig()` — the destructured form `pool.ts` uses
 *     for `DATABASE_URL` and `PLATFORM_DATABASE_URL`.
 *
 * A bare `\bNAME\b` would be the obvious rule and it is the wrong one: every
 * reserved name is NAMED in a comment explaining why it is inert — `pool.ts:8`
 * discusses `DATABASE_REPLICA_URL` at length — so a bare match would report all
 * three as consumed and this suite would pass over exactly the defect it exists
 * to catch. Requiring the shape of a READ is what separates a mention from a
 * use for ordinary prose.
 *
 * It is not sufficient on its own, which is why `withoutCommentLines` runs
 * first: a comment is free to quote the read form itself — `// config.NAME is
 * deliberately ignored` — and this pattern cannot tell that from the statement
 * it quotes. That direction is the dangerous one, a silent pass, so the comment
 * has to be gone before the pattern is applied.
 *
 * A fourth spelling would read as "not consumed" and fail this suite until it is
 * added here or the name is declared reserved. That direction is the safe one:
 * the failure is loud and local, where a missed read would be a silent pass.
 */
function consumptionPattern(name: string): RegExp {
  return new RegExp(
    `\\.${name}\\b` +
      `|\\[['"\`]${name}['"\`]\\]` +
      `|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*(?:backendConfig|serverEnv|clientEnv)\\(\\)`
  );
}

/**
 * Blanks whole-line comments, keeping every line in place.
 *
 * Deliberately line-based rather than a parse. A character-level stripper has to
 * track strings, template literals and regular expression literals to know where
 * a comment begins, and a mistake there blanks real code across the rest of a
 * file — so the cheap version of "be thorough" is the one that can go silently
 * wrong at scale. Blanking only lines whose first non-space characters are
 * a line-comment marker, a block-comment opener, or the asterisk that continues
 * or closes a block cannot misread a string, and it covers the shape that
 * matters: a commented-out or quoted read inside a comment block.
 *
 * The line count is preserved exactly, because the citation this suite reports
 * is a line number in the ORIGINAL file.
 *
 * **Known limit, stated rather than implied:** a trailing comment on a line that
 * also holds code (`const x = 1; // config.NAME`) is not removed, so such a line
 * can still read as a consumer. It only matters for a name that has no genuine
 * read anywhere, and the remedy is the same one as for a fourth read spelling —
 * a consumer, or an entry in `RESERVED_SETTINGS`.
 */
function withoutCommentLines(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      const isComment =
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*/') ||
        trimmed.startsWith('*');
      return isComment ? '' : line;
    })
    .join('\n');
}

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(entry.name)) found.push(full);
    }
  };
  walk(root);
  return found;
}

interface Source {
  readonly file: string;
  /** The file with its whole-line comments blanked. Line numbers unchanged. */
  readonly text: string;
}

/** Every source under `root` except the module that DECLARES the names. */
function corpus(root: string, declaringModule: string): Source[] {
  return sourceFiles(root)
    .filter((file) => file !== declaringModule)
    .map((file) => ({ file, text: withoutCommentLines(readFileSync(file, 'utf8')) }));
}

const files = sourceFiles(API_SRC_ROOT).filter((file) => file !== CONFIG_MODULE);
const sources = corpus(API_SRC_ROOT, CONFIG_MODULE);

/** The first `file:line` that reads `name`, or `undefined` when nothing does. */
function firstConsumer(name: string, within: Source[] = sources): string | undefined {
  const pattern = consumptionPattern(name);
  for (const { file, text } of within) {
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (pattern.test(lines[index] as string)) {
        return `${toRepositoryPath(file)}:${index + 1}`;
      }
    }
  }
  return undefined;
}

describe('the scan itself', () => {
  it('reads a real, non-empty source tree', () => {
    // Refuses to report "every setting is consumed" over zero files, which is
    // how a path mistake would otherwise turn into a green suite.
    expect(files.length).toBeGreaterThan(100);
    expect(files).not.toContain(CONFIG_MODULE);
  });

  it('does not count a name that is only mentioned in a comment', () => {
    const mention = ' *  - `replica` — reserved. `DATABASE_REPLICA_URL` may be configured so';
    expect(consumptionPattern('DATABASE_REPLICA_URL').test(mention)).toBe(false);
  });

  it('does not count a read that is QUOTED inside a comment', () => {
    // The case the read-shape rule alone cannot decide, and the dangerous
    // direction: a comment is free to write the exact shape of a read while
    // explaining that nothing performs it. Only removing the comment separates
    // the sentence about the code from the code.
    const commented = [
      '/**',
      ' * Nothing reads config.CORS_ALLOWED_ORIGINS today.',
      ' */',
      '// const origins = config.CORS_ALLOWED_ORIGINS;',
    ].join('\n');

    expect(consumptionPattern('CORS_ALLOWED_ORIGINS').test(commented)).toBe(true);
    expect(consumptionPattern('CORS_ALLOWED_ORIGINS').test(withoutCommentLines(commented))).toBe(
      false
    );
  });

  it('blanks comments without moving a single line', () => {
    // The citation this suite reports is a line number in the original file, so
    // a stripper that removed lines would report the wrong one.
    const lines = withoutCommentLines(
      ['// const a = config.DB_POOL_MAX;', 'const b = config.DB_POOL_MAX;'].join('\n')
    ).split('\n');

    expect(lines).toHaveLength(2);
    expect(consumptionPattern('DB_POOL_MAX').test(lines[0] as string)).toBe(false);
    expect(consumptionPattern('DB_POOL_MAX').test(lines[1] as string)).toBe(true);
  });

  it('counts each of the three read spellings', () => {
    expect(consumptionPattern('DB_POOL_MAX').test('    max: config.DB_POOL_MAX,')).toBe(true);
    expect(consumptionPattern('STORAGE_BUCKET').test("  const b = env['STORAGE_BUCKET'];")).toBe(
      true
    );
    expect(
      consumptionPattern('PLATFORM_DATABASE_URL').test(
        '    const { PLATFORM_DATABASE_URL } = backendConfig();'
      )
    ).toBe(true);
  });

  it('derives the accepted names from the schema, not from a list beside it', () => {
    // A sanity floor and three names that decide whether a request can be
    // served at all. If `ACCEPTED_SETTING_NAMES` ever stopped reflecting the
    // schema, this is where it shows.
    expect(ACCEPTED_SETTING_NAMES.length).toBeGreaterThan(40);
    expect(ACCEPTED_SETTING_NAMES).toContain('DATABASE_URL');
    expect(ACCEPTED_SETTING_NAMES).toContain('PLATFORM_DATABASE_URL');
    expect(ACCEPTED_SETTING_NAMES).toContain('AUTH_JWT_SECRET');
  });
});

describe('every accepted setting is either consumed or declared reserved', () => {
  it('leaves no accepted name unaccounted for', () => {
    const unaccounted = ACCEPTED_SETTING_NAMES.filter(
      (name) => !(name in RESERVED_SETTINGS) && firstConsumer(name) === undefined
    );

    // Named, not counted: a failure has to say WHICH setting is accepted while
    // nothing reads it, so the answer is either a consumer or an entry in
    // `RESERVED_SETTINGS` — never a widened rule here.
    expect(unaccounted).toEqual([]);
  });

  it('carries no reserved name that has quietly gained a consumer', () => {
    // The opposite drift, and the one that makes the reserved list a lie: a
    // setting wired up later must leave the list in the same change.
    const nowConsumed = Object.keys(RESERVED_SETTINGS)
      .map((name) => ({ name, consumer: firstConsumer(name) }))
      .filter((entry) => entry.consumer !== undefined);

    expect(nowConsumed).toEqual([]);
  });

  it('reserves only names the schema actually accepts', () => {
    const notAccepted = Object.keys(RESERVED_SETTINGS).filter(
      (name) => !ACCEPTED_SETTING_NAMES.includes(name)
    );

    // A reserved name that is not in the schema would be a stale entry
    // documenting a setting nobody can even set.
    expect(notAccepted).toEqual([]);
  });

  it('gives every reserved name a reason, so the list cannot grow silently', () => {
    for (const [name, reason] of Object.entries(RESERVED_SETTINGS)) {
      expect(reason.length, `${name} needs a stated reason`).toBeGreaterThan(40);
    }
  });
});

describe('a reserved setting can never hold a deployment out of rotation', () => {
  it('shares no name with the production-required set', () => {
    const overlap = REQUIRED_WHEN_DEPLOYED.filter((name) => name in RESERVED_SETTINGS);

    expect(overlap).toEqual([]);
  });

  it('requires nothing in production that nothing reads', () => {
    // The same property from the other side, and the one that was false until
    // this change: every name a deployment is refused readiness for must have a
    // consumer that would be affected by its absence.
    const requiredButUnread = REQUIRED_WHEN_DEPLOYED.filter(
      (name) => firstConsumer(name) === undefined
    );

    expect(requiredButUnread).toEqual([]);
  });
});

interface SecondarySchema {
  /** The schema file, cited as it is written in the inventory. */
  readonly label: string;
  readonly schemaFile: string;
  /** The tree a consumer of THIS schema's names would live in. */
  readonly searchRoot: string;
  /** A floor on the extracted names, so a path mistake cannot read as "all clear". */
  readonly minimumNames: number;
}

/**
 * The two schemas that are not `backend-config.ts`.
 *
 * `ACCEPTED_SETTING_NAMES` covers the backend schema and nothing else, which
 * left the other two accepting names with no mechanical guard at all — the
 * identical defect, one file over. Their keys cannot be imported (neither module
 * exports its schema, and the web one parses at module load, so importing it
 * from the unit tier would throw), so they are read from the schema SOURCE with
 * the extractor `scripts/ci/check-env-contract.mjs` already uses for the backend
 * schema. That extractor is a regex over a schema literal, not over prose, and
 * a shape it cannot see shrinks the set — which is why each entry carries a
 * floor on how many names must come out.
 *
 * The search root differs per schema because the tiers do not share source: a
 * web name is read in `apps/web/src`, and looking for it in the API tree would
 * report every one of them unread.
 */
const SECONDARY_SCHEMAS: SecondarySchema[] = [
  {
    label: 'apps/api/src/config/env.ts',
    schemaFile: join(API_SRC_ROOT, 'config', 'env.ts'),
    searchRoot: API_SRC_ROOT,
    minimumNames: 6,
  },
  {
    label: 'apps/web/src/lib/env.ts',
    schemaFile: join(WEB_SRC_ROOT, 'lib', 'env.ts'),
    searchRoot: WEB_SRC_ROOT,
    minimumNames: 4,
  },
];

describe.each(SECONDARY_SCHEMAS)('$label accepts nothing that nothing reads', (schema) => {
  const accepted: string[] = [...readSchemaKeys(readFileSync(schema.schemaFile, 'utf8'))];
  const within = corpus(schema.searchRoot, schema.schemaFile);

  it('extracts the names it is supposed to, over a real tree', () => {
    expect(accepted.length).toBeGreaterThanOrEqual(schema.minimumNames);
    expect(within.length).toBeGreaterThan(10);
  });

  it('has a consumer outside the schema for every name it accepts', () => {
    // Same rule as the backend schema: validation is not consumption. A name
    // that fails here is either wired to the code path that ought to obey it or
    // demoted in the inventory as reserved, never excused by a list here.
    const unread = accepted.filter((name) => firstConsumer(name, within) === undefined);

    expect(unread).toEqual([]);
  });
});
