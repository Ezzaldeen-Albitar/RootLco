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
 *  - **Consumption is decided by reading the API source**, not by a curated
 *    inventory. The inventory in `docs/platform/environment-configuration.md`
 *    describes what this measures; it is never the input.
 *  - **The two lists must not overlap.** A reserved name in the
 *    production-required set is precisely the defect this exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCEPTED_SETTING_NAMES,
  REQUIRED_WHEN_DEPLOYED,
  RESERVED_SETTINGS,
} from '@api/server/config/backend-config';
import { API_SRC_ROOT, toRepositoryPath } from '../../scripts/lib/repository-paths.mjs';

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
 * use without needing to strip comments correctly, which cannot be done with a
 * regular expression.
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

const files = sourceFiles(API_SRC_ROOT).filter((file) => file !== CONFIG_MODULE);
const sources = files.map((file) => ({ file, text: readFileSync(file, 'utf8') }));

/** The first `file:line` that reads `name`, or `undefined` when nothing does. */
function firstConsumer(name: string): string | undefined {
  const pattern = consumptionPattern(name);
  for (const { file, text } of sources) {
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
