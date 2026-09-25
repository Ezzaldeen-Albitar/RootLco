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
import { readFileSync } from 'node:fs';
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
  readonly COMPONENT_LIBRARY_RULES: readonly { readonly id: string; readonly what: string }[];
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
    expect(
      rulesOf(`import { createClient } from '@supabase/supabase-js'; export {createClient};`)
    ).toContain('supabase-import');
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

/**
 * The Material UI / MUI X boundary ADR-022 draws — rules 6 to 8.
 *
 * Every case is a sample the gate must refuse, beside the legal spelling it
 * must accept, so each rule is proven able to fail.
 */
describe('the component-library boundary (ADR-022)', () => {
  const GRID = `import { DataGrid } from '@mui/x-data-grid';`;

  it('declares the rules it documents', () => {
    expect(GATE.COMPONENT_LIBRARY_RULES.map((rule) => rule.id).sort()).toEqual([
      'grid-default-toolbar',
      'grid-derived-total',
      'grid-export-surface',
      'grid-indirect-render',
      'mui-commercial-edition',
    ]);
  });

  it('refuses a grid whose props it cannot read, outside the wrapper path', () => {
    const refused = [
      // A spread can carry `showToolbar` or a `rowCount` no attribute rule sees.
      `${GRID} export const G = (props: object) => <DataGrid rows={[]} columns={[]} rowCount={-1} {...props} />;`,
      // createElement renders it with no JSX attributes at all.
      `import { createElement } from 'react'; ${GRID} export const G = () => createElement(DataGrid, { rows: [], columns: [], rowCount: 10 });`,
      `import * as React from 'react'; ${GRID} export const G = () => React.createElement(DataGrid, { rows: [], columns: [] });`,
      // An alias assigned at runtime, or the grid handed on as a component.
      `${GRID} const Table = DataGrid; export const G = () => <Table rows={[]} columns={[]} rowCount={10} />;`,
      `${GRID} export const G = ({ Slot }: { Slot: (p: { component: unknown }) => null }) => <Slot component={DataGrid} />;`,
      `import * as X from '@mui/x-data-grid'; export const Grid = X.DataGrid;`,
      `import * as X from '@mui/x-data-grid'; export const all = X;`,
      // A re-export or a dynamic import moves the grid out of this file's sight.
      `export { DataGrid } from '@mui/x-data-grid';`,
      `export * from '@mui/x-data-grid';`,
      `export const load = () => import('@mui/x-data-grid');`,
    ];
    for (const sample of refused) {
      expect(rulesOf(sample), sample).toContain('grid-indirect-render');
    }
  });

  it('lets the shared OperationalGrid wrapper spread its props onto the grid', () => {
    const wrapper = `${GRID} export const OperationalGrid = (props: object) => <DataGrid rowCount={-1} paginationMode="server" {...props} />;`;
    expect(rulesOf(wrapper, 'src/components/data/OperationalGrid.tsx')).toEqual([]);
    expect(rulesOf(wrapper, 'src/components/data/OperationalGrid/index.tsx')).toEqual([]);
    expect(rulesOf(wrapper, 'src/features/x/Grid.tsx')).toContain('grid-indirect-render');
  });

  it('does not treat a type-only reference to the grid as a render', () => {
    const typed = `import type { ComponentProps } from 'react'; ${GRID} export type P = ComponentProps<typeof DataGrid>; export const G = () => <DataGrid rows={[]} columns={[]} rowCount={-1} paginationMode="server" />;`;
    expect(rulesOf(typed)).toEqual([]);
  });

  it('refuses every commercial, deferred or excluded MUI X package', () => {
    for (const spec of [
      '@mui/x-data-grid-pro',
      '@mui/x-data-grid-premium',
      '@mui/x-date-pickers-pro',
      '@mui/x-charts-pro',
      '@mui/x-tree-view-pro',
      '@mui/x-license',
      '@mui/x-scheduler',
      '@mui/x-chat',
    ]) {
      expect(rulesOf(`import { X } from '${spec}'; export { X };`), spec).toContain(
        'mui-commercial-edition'
      );
    }
    expect(rulesOf(`export const load = () => import('@mui/x-data-grid-pro');`)).toContain(
      'mui-commercial-edition'
    );
  });

  it('accepts the MIT editions the ADR adopts', () => {
    for (const spec of [
      '@mui/x-data-grid',
      '@mui/x-date-pickers/DatePicker',
      '@mui/x-charts/BarChart',
      '@mui/x-tree-view/SimpleTreeView',
      '@mui/material/Button',
    ]) {
      expect(rulesOf(`import X from '${spec}'; export { X };`), spec).toEqual([]);
    }
  });

  it('refuses the default toolbar and every export or print name', () => {
    expect(
      rulesOf(`${GRID} export const G = () => <DataGrid rows={[]} columns={[]} showToolbar />;`)
    ).toContain('grid-default-toolbar');
    expect(
      rulesOf(
        `import { DataGrid, GridToolbar } from '@mui/x-data-grid'; export const G = () => <DataGrid rows={[]} columns={[]} slots={{ toolbar: GridToolbar }} />;`
      )
    ).toContain('grid-default-toolbar');
    for (const sample of [
      `import { GridToolbarExport } from '@mui/x-data-grid'; export { GridToolbarExport };`,
      `export const save = (api: { current: { exportDataAsCsv(): void } }) => api.current.exportDataAsCsv();`,
      `export const print = (api: { current: { exportDataAsPrint(): void } }) => api.current.exportDataAsPrint();`,
      `export const props = { slotProps: { toolbar: { csvOptions: { fileName: 'x' } } } };`,
      `export const props = { 'printOptions': { hideFooter: true } };`,
    ]) {
      expect(rulesOf(sample), sample).toContain('grid-export-surface');
    }
  });

  it('refuses a row count that is not unknown, and an estimated total', () => {
    const refused = [
      `${GRID} export const G = ({ rows }: { rows: unknown[] }) => <DataGrid rows={rows} columns={[]} rowCount={rows.length} />;`,
      `${GRID} export const G = ({ total }: { total: number }) => <DataGrid rows={[]} columns={[]} rowCount={total} />;`,
      `${GRID} export const G = () => <DataGrid rows={[]} columns={[]} paginationMode="server" />;`,
      `${GRID} export const G = () => <DataGrid rows={[]} columns={[]} rowCount={-1} paginationMeta={{ hasNextPage: true, estimatedRowCount: 500 }} />;`,
      // An alias does not hide the grid.
      `import { DataGrid as Table } from '@mui/x-data-grid'; export const G = () => <Table rows={[]} columns={[]} rowCount={10} />;`,
      `import * as X from '@mui/x-data-grid'; export const G = () => <X.DataGrid rows={[]} columns={[]} rowCount={10} />;`,
    ];
    for (const sample of refused) expect(rulesOf(sample), sample).toContain('grid-derived-total');
  });

  it('accepts a server-paged grid with an unknown count and no toolbar', () => {
    const legal = `${GRID} export const G = ({ more }: { more: boolean }) => (
      <DataGrid rows={[]} columns={[]} paginationMode="server" rowCount={-1} paginationMeta={{ hasNextPage: more }} />
    );`;
    expect(rulesOf(legal)).toEqual([]);
  });

  it('does not read a comment or a string value as a grid surface', () => {
    const source = `// exportDataAsCsv is refused here, and so is showToolbar\nexport const label = 'csvOptions';`;
    expect(rulesOf(source)).toEqual([]);
  });

  it('passes the gallery grid the next pull requests copy', () => {
    const gallery = readFileSync(
      join(process.cwd(), 'src', 'components', 'gallery', 'MuiFoundationSection.tsx'),
      'utf8'
    );
    expect(gallery).toContain('rowCount={-1}');
    expect(rulesOf(gallery, 'src/components/gallery/MuiFoundationSection.tsx')).toEqual([]);
  });
});
