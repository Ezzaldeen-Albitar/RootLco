/**
 * The web boundary gate must catch every spelling of the thing it forbids.
 *
 * ## Why this file exists
 *
 * `validate:boundary` is a REQUIRED command, and until this suite it had no test
 * of its own — only a passing mention in another file's docblock. Its import
 * rules were regexes over source text, and they were wrong in four independent
 * ways at once. Every one of these reached API server source while the gate
 * reported `0 violations`:
 *
 *     import { x } from '@rootlco/api';
 *     await import('@rootlco/api/src/server/db/pool');
 *     await import('../../../api/src/server/db/pool');
 *     import { pool } from '../../../api/src/server/db/pool';
 *
 * The last two never contain the literal `apps/api/` the rule looked for, and the
 * first two are not `from` clauses at all. `@rootlco/api` is a workspace package
 * symlinked into the root `node_modules`, so it resolves from `apps/web` whether
 * or not this workspace declares a dependency on it — the spelling the rule could
 * not see is the one that needs no setup to use.
 *
 * The rules read module specifiers from the parser now. These cases pin that a
 * spelling the author did not think of is still caught, which is the only
 * property a boundary rule actually needs.
 *
 * The gate is imported at RUNTIME rather than with a static specifier: this
 * workspace sets `allowJs: false`, so `import … from '../scripts/*.mjs'` is
 * `TS2307` in `typecheck:web` — the same reason `p1-27-security.test.ts` computes
 * its specifier.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Finding {
  readonly path: string;
  readonly rule: string;
  readonly what: string;
}

const GATE = (await import(
  pathToFileURL(join(process.cwd(), 'scripts', 'check-api-boundary.mjs')).href
)) as {
  readonly RULES: readonly { readonly id: string; readonly what: string }[];
  readonly NETWORK_OWNERS: readonly string[];
  readonly STORE_UPLOAD_OWNER: string;
  readonly moduleSpecifiers: (source: string) => string[];
  readonly inspect: (relPath: string, source: string) => Finding[];
  readonly stripComments: (source: string) => string;
};

/**
 * A path at the depth real feature code sits at, so the relative specifiers below
 * are the ones a file here would actually write: from `apps/web/src/features`,
 * `../../../api` resolves to `apps/api` and `../../../../supabase` to `supabase`.
 */
const DEEP = 'src/features/thing.ts';

const rulesOf = (source: string, path = DEEP) =>
  GATE.inspect(path, source).map((finding) => finding.rule);

describe('the API boundary gate reads imports, not text', () => {
  it('catches API server source however the import is spelled', () => {
    const spellings: Record<string, string> = {
      'static, workspace package': `import { x } from '@rootlco/api'; export { x };`,
      'static, package subpath': `import { p } from '@rootlco/api/src/server/db/pool'; export { p };`,
      'dynamic, package': `export const f = () => import('@rootlco/api/src/server/db/pool');`,
      'dynamic, relative': `export const f = () => import('../../../api/src/server/db/pool');`,
      'static, relative': `import { p } from '../../../api/src/server/db/pool'; export { p };`,
      're-export': `export { p } from '../../../api/src/server/db/pool';`,
      require: `const a = require('@rootlco/api'); export default a;`,
    };
    const missed = Object.entries(spellings)
      .filter(([, source]) => !rulesOf(source).includes('api-source-import'))
      .map(([name]) => name);
    // Named, not counted: a bare count would not say which spelling got through.
    expect(missed).toEqual([]);
  });

  it('catches a server-only module under either of its two names', () => {
    // `node:fs` and `fs` are the same module. A rule naming only the prefixed
    // form forbids a habit rather than a capability.
    expect(rulesOf(`import { readFileSync } from 'node:fs'; export { readFileSync };`)).toContain(
      'server-only-import'
    );
    expect(rulesOf(`import { readFileSync } from 'fs'; export { readFileSync };`)).toContain(
      'server-only-import'
    );
    expect(rulesOf(`import pg from 'pg'; export default pg;`)).toContain('server-only-import');
  });

  it('catches supabase by package and by path', () => {
    expect(rulesOf(`import { createClient } from '@supabase/supabase-js'; export {createClient};`)).toContain(
      'supabase-import'
    );
    expect(rulesOf(`export { x } from '../../../../supabase/functions/x';`)).toContain(
      'supabase-import'
    );
  });

  it('does not flag the imports the web tier is supposed to use', () => {
    // The other half of a boundary rule. One that fires on ordinary Frontend code
    // gets an allowance carved into it, and the allowance is what leaks.
    const legitimate = [
      `import { useState } from 'react'; export { useState };`,
      `import Link from 'next/link'; export default Link;`,
      `import { apiClient } from '@/lib/api'; export { apiClient };`,
      `import { thing } from './sibling'; export { thing };`,
      `import { thing } from '../shared/thing'; export { thing };`,
      `export const f = () => import('./lazy-panel');`,
    ];
    const wrongly = legitimate.filter((source) => rulesOf(source).length > 0);
    expect(wrongly).toEqual([]);
  });

  it('reads a specifier out of every import form', () => {
    const source = `
      import a from 'alpha';
      import type { B } from 'beta';
      export { c } from 'gamma';
      const d = () => import('delta');
      const e = require('epsilon');
      export { a, d, e };
    `;
    expect(GATE.moduleSpecifiers(source).sort()).toEqual([
      'alpha',
      'beta',
      'delta',
      'epsilon',
      'gamma',
    ]);
  });

  it('does not read prose as an import', () => {
    // The class this repository has recorded repeatedly: a scanner reading a
    // comment as code. The parser does not offer comments at all, so a docblock
    // naming the forbidden module is trivia rather than a false positive.
    const source = `
      /** Never import from '@rootlco/api' or from 'node:fs' here. */
      // import { pool } from '../../../api/src/server/db/pool';
      export const safe = 1;
    `;
    expect(rulesOf(source)).toEqual([]);
  });

  it('keeps the fetch allowance to exactly one named file', () => {
    // An allowance shaped like a directory grows by somebody putting a file in it.
    expect(GATE.STORE_UPLOAD_OWNER).toBe(join('src', 'features', 'attachments', 'api.ts'));
    expect(GATE.NETWORK_OWNERS).toEqual([join('src', 'lib', 'api')]);
    const fetching = `export const put = () => fetch('https://store.example/x');`;
    expect(rulesOf(fetching)).toContain('direct-fetch');
    expect(GATE.inspect(GATE.STORE_UPLOAD_OWNER, fetching)).toEqual([]);
  });

  it('still declares every rule it documents', () => {
    expect(GATE.RULES.map((rule) => rule.id).sort()).toEqual([
      'api-source-import',
      'direct-fetch',
      'server-only-import',
      'supabase-import',
      'unsafe-html',
    ]);
  });
});
