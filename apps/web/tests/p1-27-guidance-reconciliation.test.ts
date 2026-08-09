import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_BY_KIND, query } from '@/lib/api/read-operation';
import { normalizeVinForDisplay } from '@/features/vehicles/contract';

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

/** Files directly in a feature root — the trees the guide's table describes. */
function rootFiles(dir: string): readonly string[] {
  return readdirSync(dir).filter(
    (name) => name.endsWith('.ts') && statSync(join(dir, name)).isFile()
  );
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

  it('names four failure meanings that are four distinct states in the code', () => {
    /*
     * The guide's table promises the operator that "you do not have permission",
     * "temporarily unavailable", "your session has ended" and "something went
     * wrong" mean different things and want different responses. That is only
     * true while the code maps them apart — collapse any two and the table
     * becomes advice to do the wrong thing.
     */
    expect(STATUS_BY_KIND.forbidden).toBe('denied');
    expect(STATUS_BY_KIND['rate-limited']).toBe('unavailable');
    expect(STATUS_BY_KIND.unauthenticated).toBe('expired');
    expect(STATUS_BY_KIND.server).toBe('error');

    const distinct = new Set([
      STATUS_BY_KIND.forbidden,
      STATUS_BY_KIND['rate-limited'],
      STATUS_BY_KIND.unauthenticated,
      STATUS_BY_KIND.server,
    ]);
    expect(distinct.size, 'the four rows must stay four states').toBe(4);

    for (const row of [
      'You do not have permission',
      'Temporarily unavailable',
      'Your session has ended',
      'Something went wrong',
    ]) {
      expect(OPERATOR).toContain(row);
    }
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

    const cells = [...(table?.[1] ?? '').matchAll(/\|\s*[^|]+\|\s*`([^`]+)`\s*\|/g)].map(
      (m) => m[1] ?? ''
    );
    expect(cells.length, 'every row must carry a backticked path').toBeGreaterThanOrEqual(6);

    // `a/{b,c}/d` → `a/b/d`, `a/c/d`. One level is all the table uses.
    const expand = (pattern: string): readonly string[] => {
      const brace = /\{([^}]+)\}/.exec(pattern);
      if (!brace) return [pattern];
      return (brace[1] ?? '')
        .split(',')
        .map((option) => pattern.replace(brace[0], option.trim()));
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
      rootFiles(dir)
        .filter((name) => /^['"]use server['"]/.test(readFileSync(join(dir, name), 'utf8').trim()))
        .map((name) =>
          join(dir, name)
            .slice(WEB_SRC.length + 1)
            .replace(/\\/g, '/')
        )
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
