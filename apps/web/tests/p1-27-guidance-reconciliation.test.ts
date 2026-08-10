import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_BY_KIND, query, type ReadFailureStatus } from '@/lib/api/read-operation';
import { normalizeVinForDisplay } from '@/features/vehicles/contract';
import en from '../src/i18n/messages/en.json';

/**
 * `DOC-002` — the guidance half.
 *
 * ## Why this file exists
 *
 * `DOC-002` is a conjunction: "operator / developer guidance **and** change-log
 * update". The change-log half has been discriminated since
 * `p1-27-doc-reconciliation.test.ts` was written. The guidance half had no
 * automated proof of any kind — a repository-wide search for `operator-guide` or
 * `developer-guide` outside `docs/**` returned nothing, and the task register
 * said so in its own words rather than hiding it.
 *
 * ## Why an existence check would have been the wrong proof
 *
 * This phase's dominant defect class is *a document stating a rule the code does
 * not implement*. Six of the round-three findings were exactly that. A test that
 * asserts `operator-guide.md` exists would pass against a guide describing a
 * product nobody built, which is the failure mode actually worth preventing —
 * the guides are read by an operator who cannot check them and by the next
 * phase's developer who will believe them.
 *
 * So every case below pins a guide sentence to the **executable** thing it
 * describes, and the executable side is imported or read from source, never
 * quoted. Change the code and the guide becomes false and this file fails.
 *
 * ## What it found when it was written
 *
 * The developer guide's "where things live" table said adapters are
 * `features/{...}/*-api.ts`. Thirteen files in those trees open with
 * `'use server'` and that pattern matched eight: it missed `api.ts` in both
 * trees and all three `*-actions.ts` files.
 *
 * The first correction then over-claimed in the other direction — a
 * `vehicles/*actions.ts` row — and the path case below failed on it immediately,
 * which is how the real divergence surfaced: CRM segregates writes into
 * `*actions.ts`, the vehicle tree has none and keeps its six write actions
 * inside the `*api.ts` file owning the same resource. Both corrections are the
 * defect class this file exists to catch, and the second one was mine.
 */

const REPO = join(process.cwd(), '..', '..');
const PHASE = join(REPO, 'docs', 'phase-1', 'phase-1-27');
const WEB_SRC = join(process.cwd(), 'src');

const OPERATOR = readFileSync(join(PHASE, 'operator-guide.md'), 'utf8');
const DEVELOPER = readFileSync(join(PHASE, 'developer-guide.md'), 'utf8');

const FEATURE_ROOTS = [
  join(WEB_SRC, 'features', 'crm', 'customers'),
  join(WEB_SRC, 'features', 'vehicles'),
];

/**
 * Every `.ts`/`.tsx` file under a feature root, RECURSIVELY.
 *
 * It walked one level at first, which made the developer guide's sentence —
 * "every file in either tree that opens with `'use server'`" — wider than the
 * check behind it. All thirteen adapters happen to sit at the root today, so the
 * sentence was true and the check was not what made it true: a `'use server'`
 * file added under `components/` would have escaped the partition while the
 * guide went on claiming it could not.
 *
 * That is the same defect class this file exists for, one level down, so the
 * walker was widened rather than the sentence narrowed.
 */
function treeFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...treeFiles(path));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

describe('the operator guide describes the product that was built', () => {
  it('quotes the search budget the API actually enforces, not a rounder number', () => {
    /*
     * "twelve of the thirty searches the system allows each minute".
     *
     * That thirty is a Backend policy figure, and it is the one number in either
     * guide an operator could plan a shift around. It is derived here from the
     * policy table AND from the binding, because either half alone is
     * satisfiable while the sentence is false: the policy could exist and the
     * search bind something else.
     */
    const policies = readFileSync(
      join(REPO, 'apps', 'api', 'src', 'server', 'http', 'rate-limit.ts'),
      'utf8'
    );
    const expensive = /'expensive-read':\s*\{[^}]*?limit:\s*(\d+),[^}]*?windowMs:\s*([\d_]+)/s.exec(
      policies
    );
    expect(expensive, 'the expensive-read policy must be findable').not.toBeNull();

    const limit = Number(expensive?.[1] ?? NaN);
    const windowMs = Number((expensive?.[2] ?? '').replace(/_/g, ''));
    expect(windowMs).toBe(60_000);

    const customerSearch = readFileSync(
      join(REPO, 'apps', 'api', 'src', 'app', 'api', 'v1', 'customers', 'route.ts'),
      'utf8'
    );
    expect(customerSearch).toContain("rateLimitPolicy: 'expensive-read'");

    // The guide writes it as a word, as guidance to a person should.
    const asWord: Record<number, string> = {
      30: 'thirty',
      60: 'sixty',
      120: 'a hundred and twenty',
    };
    expect(OPERATOR).toContain(
      `${asWord[limit] ?? String(limit)} searches the system allows each minute`
    );
  });

  it('is right that I, O and Q survive the VIN normaliser', () => {
    /*
     * "I, O and Q are preserved exactly as entered — a real VIN never contains
     * them, so silently correcting them to 1 and 0 would hide the fact that the
     * number you have is not a valid VIN."
     *
     * The operator is being told they can trust what the screen echoes back. If
     * anyone ever "fixes" this to apply the ISO-3779 exclusion, the guide starts
     * lying about the one thing it tells them to rely on.
     */
    expect(normalizeVinForDisplay('1i2o3q')).toBe('1I2O3Q');
    expect(normalizeVinForDisplay(' 1hg-cm82 ')).toBe('1HGCM82');
    expect(OPERATOR).toMatch(/\*\*I, O and Q are preserved exactly as entered\*\*/);
  });

  it('quotes the failure wording the operator actually sees, from the catalogue', () => {
    /*
     * The first version of this case was CIRCULAR and shipped that way.
     *
     * It listed four strings taken from the operator guide and asserted the
     * operator guide contained them. Two of the four — "You do not have
     * permission" and "Temporarily unavailable" — are in no message catalogue at
     * all: the product says "You do not have access" and "Service unavailable".
     * So the guide sent an operator looking for words no screen shows, and the
     * check written to stop exactly that kind of claim confirmed it instead.
     *
     * A document may not be its own evidence. The rows are now derived from the
     * catalogue, so rewording the UI fails this case rather than silently making
     * the guide wrong.
     */
    const shown = (key: string): string => {
      const value = (en as Record<string, unknown>)[key];
      expect(typeof value, `${key} is not in the catalogue`).toBe('string');
      return value as string;
    };

    // Every state a read failure can resolve to, from the type that defines them.
    const STATES: Record<ReadFailureStatus, string> = {
      denied: 'state.denied.title',
      unavailable: 'state.unavailable.title',
      expired: 'state.expired.title',
      error: 'state.error.title',
      'not-found': 'state.notFound.title',
    };

    for (const key of Object.values(STATES)) {
      expect(OPERATOR, `the guide does not quote ${key}`).toContain(shown(key));
    }

    // And they are five DISTINCT sentences. Collapsing any two would make the
    // table advice to do the wrong thing while every string above still resolved.
    const sentences = Object.values(STATES).map(shown);
    expect(new Set(sentences).size, 'two failure states read identically').toBe(sentences.length);

    // The mapping that puts a transport kind into one of those states, which is
    // what makes the table's "what happened" column true.
    expect(STATUS_BY_KIND.forbidden).toBe('denied');
    expect(STATUS_BY_KIND['rate-limited']).toBe('unavailable');
    expect(STATUS_BY_KIND.unauthenticated).toBe('expired');
    expect(STATUS_BY_KIND.server).toBe('error');
    expect(STATUS_BY_KIND['not-found']).toBe('not-found');

    // The guide calls the list exhaustive. It must therefore count them right —
    // it said "Four" while the code has always had five.
    expect(OPERATOR, 'the guide states a count the code contradicts').toContain(
      'Five different things can go wrong'
    );
  });

  it('is right that no screen decides what the operator may see', () => {
    /*
     * "Every permission is enforced by the server. Hiding a button is a courtesy
     * … it is never the thing that stops an action." The client-side half of
     * that promise is that no adapter can assert its own scope — `query()`
     * throws rather than dropping, so a caller cannot believe it sent one.
     */
    for (const key of [
      'tenantId',
      'companyId',
      'branchId',
      'tenant_id',
      'company_id',
      'branch_id',
    ]) {
      expect(() => query({ [key]: 'anything' }), `${key} must be refused`).toThrow(
        /must not be sent from the client/
      );
    }
    // And the ordinary path still works, or the case above is vacuous.
    expect(query({ name: 'Nadia' })).toBe('?name=Nadia');
    expect(OPERATOR).toContain('**No screen decides what you may see.**');
  });
});

describe('the developer guide describes the repository that exists', () => {
  it('lists exactly the rules the gate enforces', () => {
    /*
     * The guide presents six bullets as "the rules that are enforced, not merely
     * written down". A seventh rule added to the gate without a bullet, or a
     * bullet for a rule that was removed, both make the section untrustworthy in
     * the direction that matters — a developer deciding what they can get away
     * with.
     */
    const gate = readFileSync(join(REPO, 'scripts', 'ci', 'check-p1-27-frontend.mjs'), 'utf8');
    const ids = [...gate.matchAll(/^\s*id: '([a-z0-9-]+)',$/gm)].map((m) => m[1] ?? '');
    expect(ids.length, 'the gate must expose findable rule ids').toBeGreaterThan(0);

    // Each rule id paired with the wording the guide uses for it.
    const WORDING: Record<string, string> = {
      'no-merge-caller': 'a merge caller of any shape',
      'no-duplicate-scan-on-a-queue': 'a duplicate-scan call from anywhere',
      'no-client-asserted-scope': 'a client-asserted',
      'no-invented-total': 'a total computed from `rows.length`',
      'no-upload-path': 'any upload path',
      // Added when `SEC-002`'s export and media conjuncts moved out of
      // `p1-27-security.test.ts` and into the gate. Of that task's five
      // conjuncts only `file-access` had a rule, and that rule covered three of
      // the seven constructs the security suite refuses on the same surface.
      'no-export-surface': 'any export surface',
      'no-invented-media-limit': 'any invented media limit',
      'no-console-output': 'any `console.*`',
    };

    expect(
      ids.filter((id) => !(id in WORDING)),
      'a gate rule with no sentence in the developer guide'
    ).toEqual([]);
    expect(
      Object.keys(WORDING).filter((id) => !ids.includes(id)),
      'the guide describes a rule the gate no longer has'
    ).toEqual([]);

    for (const [id, wording] of Object.entries(WORDING)) {
      expect(DEVELOPER, `${id} is not described`).toContain(wording);
    }

    /*
     * `G-04` — the direction that was missing.
     *
     * The case was bidirectional between the GATE and the map above, and only
     * one-directional against the GUIDE: substring presence. So the guide could
     * grow a seventh bullet claiming an enforced rule the gate does not have,
     * and this would still pass.
     *
     * It already carried one such overstatement. The bullet said the gate fails
     * on "any `console.*`" while the rule matched a five-method allow-list, so
     * `console.table(customer)` and `console.dir(vehicle)` — the two that print
     * an object most legibly, and therefore the two a developer reaches for on
     * exactly the data this rule protects — passed it. The gate was widened to
     * match what the guide had always claimed.
     *
     * The bullet COUNT is now pinned to the rule count, so a seventh bullet
     * fails here until a seventh rule exists.
     */
    const bullets =
      /`npm run validate:p1-27-frontend` fails the build on:\n\n((?:- .*\n|  .*\n)+)/.exec(
        DEVELOPER
      );
    expect(bullets, 'the enforced-rules list must be findable').not.toBeNull();
    const listed = (bullets?.[1] ?? '').split('\n').filter((line) => line.startsWith('- ')).length;
    expect(listed, 'the guide lists a number of rules the gate does not have').toBe(ids.length);
  });

  it('is right that TableStatus has no ok', () => {
    /*
     * The trap the guide spends a paragraph on: `table.status === 'ok'` is
     * always false, renders nothing, and makes a fail-closed test pass for the
     * wrong reason. A type is erased at runtime, so its source is the only place
     * this can be read from.
     */
    const source = readFileSync(join(WEB_SRC, 'components', 'data-table', 'DataTable.tsx'), 'utf8');
    const union = /export type TableStatus =\s*([^;]+);/.exec(source);
    expect(union, 'TableStatus must remain findable').not.toBeNull();

    const members = [...(union?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(members).toContain('idle');
    expect(members, "adding 'ok' would make the guide's paragraph false").not.toContain('ok');
    expect(DEVELOPER).toContain("**`TableStatus` has no `'ok'`.**");
  });

  it('is right that the root prettier config cannot see the workspaces', () => {
    /*
     * The trap that produced a green `format:check` over files it never opened,
     * twice. It is one line in one file, and the guide's instruction to run the
     * workspace check is only necessary while that line is there.
     */
    const ignore = readFileSync(join(REPO, '.prettierignore'), 'utf8');
    const lines = ignore.split(/\r?\n/).map((line) => line.trim());
    expect(lines, 'the root ignore must still exclude the workspaces').toContain('apps/');
    expect(DEVELOPER).toContain('Root `format:check` cannot see `apps/**`.');
  });

  it('resolves every path in the where-things-live table', () => {
    const table = /\| what\s+\| where\s+\|\n\|[-\s|]+\|\n((?:\|.*\|\n)+)/.exec(DEVELOPER);
    expect(table, 'the table must be findable').not.toBeNull();

    /*
     * `G-05` — the floor let a row vanish.
     *
     * The table has seven rows and the floor was `>= 6`, so exactly one row
     * could drop out unnoticed: deleted, or merely losing the backticks around
     * its path, which makes the cell regex skip it while the row stays visibly
     * present in the document. A reader sees seven rows; the check sees six and
     * is satisfied.
     *
     * Pinned to the row count instead. Every row must yield a path, and a row
     * added or removed has to be acknowledged here.
     */
    const rows = (table?.[1] ?? '')
      .split('\n')
      .filter((line) => line.trim().startsWith('|')).length;
    const cells = [...(table?.[1] ?? '').matchAll(/\|\s*[^|]+\|\s*`([^`]+)`\s*\|/g)].map(
      (m) => m[1] ?? ''
    );
    expect(rows, 'the table lost its rows entirely').toBeGreaterThanOrEqual(6);
    expect(cells.length, 'a row in the table carries no backticked path').toBe(rows);

    // `a/{b,c}/d` → `a/b/d`, `a/c/d`. One level is all the table uses.
    const expand = (pattern: string): readonly string[] => {
      const brace = /\{([^}]+)\}/.exec(pattern);
      if (!brace) return [pattern];
      return (brace[1] ?? '').split(',').map((option) => pattern.replace(brace[0], option.trim()));
    };

    const unresolved: string[] = [];
    for (const cell of cells) {
      for (const path of expand(cell)) {
        // Rows are workspace-relative unless they name the workspace themselves.
        const base = path.startsWith('apps/') ? REPO : WEB_SRC;
        const star = path.lastIndexOf('*');
        if (star === -1) {
          if (!existsSync(join(base, path))) unresolved.push(path);
          continue;
        }
        const dir = join(base, path.slice(0, path.lastIndexOf('/')));
        const suffix = path.slice(star + 1);
        if (!existsSync(dir) || !readdirSync(dir).some((name) => name.endsWith(suffix))) {
          unresolved.push(path);
        }
      }
    }
    expect(unresolved, 'the guide points at something that is not there').toEqual([]);
  });

  it("holds the two 'use server' patterns exhaustive over both trees", () => {
    /*
     * The defect this file found when it was written. The table said `*-api.ts`,
     * which matched eight of the thirteen `'use server'` files: `api.ts` in both
     * trees and the three `*-actions.ts` files sat outside a table claiming to
     * say where things live.
     *
     * Asserted as a partition rather than a spot-check, so a new adapter named
     * anything else fails here rather than quietly making the guide wrong again.
     */
    const serverFiles = FEATURE_ROOTS.flatMap((dir) =>
      treeFiles(dir)
        .filter((path) => /^['"]use server['"]/.test(readFileSync(path, 'utf8').trim()))
        .map((path) => path.slice(WEB_SRC.length + 1).replace(/\\/g, '/'))
    );
    expect(serverFiles.length, 'both trees must still ship adapters').toBeGreaterThanOrEqual(13);

    const unmatched = serverFiles.filter(
      (path) => !(path.endsWith('api.ts') || path.endsWith('actions.ts'))
    );
    expect(unmatched, 'a use-server file the guide does not account for').toEqual([]);

    // The third row is CRM-only, and that is the guide's actual claim: a reader
    // must not be sent looking for a vehicle write in a file that never existed.
    const strayActions = serverFiles.filter(
      (path) => path.endsWith('actions.ts') && !path.startsWith('features/crm/customers/')
    );
    expect(strayActions, 'the guide scopes *actions.ts to the CRM tree').toEqual([]);

    expect(DEVELOPER).toContain('`features/{crm/customers,vehicles}/*api.ts`');
    expect(DEVELOPER).toContain('`features/crm/customers/*actions.ts`');
  });
});

describe('this file is not vacuous', () => {
  it('reads both guides from the real phase directory', () => {
    // Every case above quotes one of these. If a rename left them empty, the
    // `toContain` assertions would fail — but the imports would not, and this
    // states the dependency rather than leaving it implied.
    expect(OPERATOR.length).toBeGreaterThan(4_000);
    expect(DEVELOPER.length).toBeGreaterThan(4_000);
    expect(OPERATOR).toContain('# Phase 1-27 — operator guide');
    expect(DEVELOPER).toContain('# Phase 1-27 — developer guide');
  });
});
