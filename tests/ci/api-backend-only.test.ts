/**
 * Mutation tests for the API-backend-only gate.
 *
 * Each test constructs the violation the gate exists to catch and proves the
 * gate FAILS on it. A gate proven only on the happy path has never been proven
 * at all — this repository has paid for that repeatedly (a Stylelint rule
 * silently skipped for weeks, a documented path check that matched nothing).
 *
 * The negative tests matter as much as the positive ones here. The first draft
 * of the browser-global rule flagged four lines of correct Backend code
 * (`const document = …` for an attachment record, `input.window.from` for a
 * job-assignment time window). A gate that cries wolf is a gate somebody
 * switches off, so the false-positive cases are pinned too.
 */
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_APP_FILES,
  CODE_RULES,
  ESLINT_CONFIG,
  evaluate,
  REQUIRED_RESTRICTED_GLOBALS,
  stripNonCode,
} from '../../scripts/ci/check-api-backend-only.mjs';

/** A minimal healthy API workspace satisfying every requirement. */
function healthyFiles(): string[] {
  return [
    'apps/api/package.json',
    'apps/api/next.config.ts',
    'apps/api/tsconfig.json',
    'apps/api/eslint.config.mjs',
    'apps/api/.env.example',
    'apps/api/public/.gitkeep',
    'apps/api/src/app/api/health/route.ts',
    'apps/api/src/app/api/v1/users/route.ts',
    'apps/api/src/config/env.ts',
    'apps/api/src/lib/logging/logger.ts',
    'apps/api/src/modules/iam/index.ts',
    'apps/api/src/server/http/route-handler.ts',
    'apps/api/src/shared/constants/app.ts',
  ];
}

/** A reader whose eslint config declares every required restricted global. */
const healthyRead = (p: string): string | null => {
  if (p === ESLINT_CONFIG) {
    return REQUIRED_RESTRICTED_GLOBALS.map((g) => `{ name: '${g}', message: 'no' },`).join('\n');
  }
  return '';
};

describe('API backend-only gate — healthy tree', () => {
  it('passes a Route-Handler-only workspace and counts what it examined', () => {
    const { failures, counts } = evaluate(healthyFiles(), healthyRead);
    expect(failures).toEqual([]);
    // Anti-vacuity: the scan matched real entries rather than passing over an
    // empty set. A gate reporting zero failures having examined nothing is the
    // exact defect class this repository keeps finding.
    expect(counts['route handlers']).toBe(2);
    expect(counts['source files scanned']).toBeGreaterThan(0);
    expect(counts['restricted globals declared']).toBe(REQUIRED_RESTRICTED_GLOBALS.length);
  });

  it('treats apps/api/src/app/api/**/route.ts as correct, never as a violation', () => {
    // The repeated word `api` is the workspace plus the Next Route Handler
    // namespace. It is the point of the workspace, not a defect.
    const { failures } = evaluate(healthyFiles(), healthyRead);
    expect(failures.filter((f) => f.includes('route.ts'))).toEqual([]);
  });

  it('keeps the framework allowlist empty, because the build proved none is needed', () => {
    // Removing layout.tsx and re-running `npm run build:api` exited 0 and
    // emitted 196 /api/** routes. If a future Next requires a root layout, the
    // allowlist grows WITH the build output that proves it.
    expect(ALLOWED_APP_FILES).toEqual([]);
  });
});

describe('API backend-only gate — mutations it must catch', () => {
  it('fails when a React page appears in the API app tree', () => {
    const { failures } = evaluate([...healthyFiles(), 'apps/api/src/app/page.tsx'], healthyRead);
    expect(failures.some((f) => f.includes('page.tsx'))).toBe(true);
  });

  it('fails when a root layout is reintroduced without being allowlisted', () => {
    const { failures } = evaluate([...healthyFiles(), 'apps/api/src/app/layout.tsx'], healthyRead);
    expect(failures.some((f) => f.includes('layout.tsx'))).toBe(true);
  });

  it('fails when a CSS Module appears', () => {
    const { failures } = evaluate(
      [...healthyFiles(), 'apps/api/src/app/page.module.scss'],
      healthyRead
    );
    expect(failures.some((f) => f.includes('page.module.scss'))).toBe(true);
  });

  it('fails when a stylesheet tier appears', () => {
    const { failures } = evaluate(
      [...healthyFiles(), 'apps/api/src/styles/globals.scss'],
      healthyRead
    );
    expect(failures.some((f) => f.includes('src/styles/'))).toBe(true);
  });

  it('fails when a Frontend component directory appears', () => {
    const { failures } = evaluate(
      [...healthyFiles(), 'apps/api/src/components/ui/Button.tsx'],
      healthyRead
    );
    expect(failures.some((f) => f.includes('src/components/'))).toBe(true);
  });

  it('fails when a UI route group appears', () => {
    const { failures } = evaluate(
      [...healthyFiles(), 'apps/api/src/app/(dashboard)/users/route.ts'],
      healthyRead
    );
    expect(failures.some((f) => f.includes('src/app/('))).toBe(true);
  });

  it("fails on a 'use client' directive", () => {
    const files = [...healthyFiles(), 'apps/api/src/server/thing.ts'];
    const read = (p: string): string | null =>
      p === 'apps/api/src/server/thing.ts' ? "'use client';\nexport const x = 1;" : healthyRead(p);
    const { failures } = evaluate(files, read);
    expect(failures.some((f) => f.includes('use-client'))).toBe(true);
  });

  it('fails when API source imports the web workspace', () => {
    const files = [...healthyFiles(), 'apps/api/src/server/bad.ts'];
    const read = (p: string): string | null =>
      p === 'apps/api/src/server/bad.ts'
        ? "import { BrandMark } from '../../../web/src/components/brand/BrandMark';"
        : healthyRead(p);
    const { failures } = evaluate(files, read);
    expect(failures.some((f) => f.includes('web-workspace-import'))).toBe(true);
  });

  it('fails on a React client hook', () => {
    const files = [...healthyFiles(), 'apps/api/src/server/hooky.ts'];
    const read = (p: string): string | null =>
      p === 'apps/api/src/server/hooky.ts'
        ? 'export function f() { const [a, b] = useState(1); return [a, b]; }'
        : healthyRead(p);
    const { failures } = evaluate(files, read);
    expect(failures.some((f) => f.includes('react-client-hook'))).toBe(true);
  });

  it('fails on a stylesheet import', () => {
    const files = [...healthyFiles(), 'apps/api/src/server/styled.ts'];
    const read = (p: string): string | null =>
      p === 'apps/api/src/server/styled.ts'
        ? "import '@/styles/globals.scss';\nexport const x = 1;"
        : healthyRead(p);
    const { failures } = evaluate(files, read);
    expect(failures.some((f) => f.includes('stylesheet-import'))).toBe(true);
  });

  it('fails on a Next client-module import', () => {
    const files = [...healthyFiles(), 'apps/api/src/server/nav.ts'];
    const read = (p: string): string | null =>
      p === 'apps/api/src/server/nav.ts'
        ? "import { useRouter } from 'next/navigation';\nexport const x = useRouter;"
        : healthyRead(p);
    const { failures } = evaluate(files, read);
    expect(failures.some((f) => f.includes('react-dom-import'))).toBe(true);
  });

  it('fails on a UI framework import', () => {
    const files = [...healthyFiles(), 'apps/api/src/server/ui.ts'];
    const read = (p: string): string | null =>
      p === 'apps/api/src/server/ui.ts'
        ? "import clsx from 'clsx';\nexport const x = clsx;"
        : healthyRead(p);
    const { failures } = evaluate(files, read);
    expect(failures.some((f) => f.includes('ui-framework'))).toBe(true);
  });

  it('fails on browser storage', () => {
    const files = [...healthyFiles(), 'apps/api/src/server/store.ts'];
    const read = (p: string): string | null =>
      p === 'apps/api/src/server/store.ts'
        ? "export const t = localStorage.getItem('token');"
        : healthyRead(p);
    const { failures } = evaluate(files, read);
    expect(failures.some((f) => f.includes('browser-storage'))).toBe(true);
  });

  it('fails when a nested lockfile appears', () => {
    const { failures } = evaluate([...healthyFiles(), 'apps/api/package-lock.json'], healthyRead);
    expect(failures.some((f) => f.includes('package-lock.json'))).toBe(true);
  });

  it('fails when generated output is tracked', () => {
    const { failures } = evaluate(
      [...healthyFiles(), 'apps/api/.next/server/app/page.js'],
      healthyRead
    );
    expect(failures.some((f) => f.includes('.next/'))).toBe(true);
  });

  it('fails when a tsbuildinfo is tracked', () => {
    const { failures } = evaluate(
      [...healthyFiles(), 'apps/api/tsconfig.tsbuildinfo'],
      healthyRead
    );
    expect(failures.some((f) => f.includes('tsbuildinfo'))).toBe(true);
  });

  it('fails when the scan matches zero API files, rather than passing vacuously', () => {
    const { failures } = evaluate(['apps/web/src/app/page.tsx'], healthyRead);
    expect(failures.some((f) => f.includes('examined nothing'))).toBe(true);
  });

  it('fails when there are no Route Handlers at all', () => {
    const files = healthyFiles().filter((f) => !f.includes('/app/api/'));
    const { failures } = evaluate(files, healthyRead);
    expect(failures.some((f) => f.includes('no Route Handlers'))).toBe(true);
  });

  it('fails when the ESLint browser-global restriction is removed', () => {
    // The scope-aware half of the rule lives in ESLint. Deleting it must not be
    // silent, or this gate becomes decorative.
    const read = (p: string): string | null => (p === ESLINT_CONFIG ? 'export default [];' : '');
    const { failures } = evaluate(healthyFiles(), read);
    expect(failures.some((f) => f.includes('no longer declares'))).toBe(true);
  });
});

describe('API backend-only gate — false positives it must NOT raise', () => {
  it('does not flag a domain variable named document', () => {
    // Real code from apps/api/src/modules/shared-services: `document` is an
    // attachment record, not the DOM. ESLint's scope analysis owns this call.
    const files = [...healthyFiles(), 'apps/api/src/modules/shared-services/attach.ts'];
    const read = (p: string): string | null =>
      p === 'apps/api/src/modules/shared-services/attach.ts'
        ? 'export function f(document: { record_version: number }) { return document.record_version; }'
        : healthyRead(p);
    const { failures } = evaluate(files, read);
    expect(failures).toEqual([]);
  });

  it('does not flag a domain property named window', () => {
    // Real code from apps/api/src/modules/work-order: an appointment time window.
    const files = [...healthyFiles(), 'apps/api/src/modules/work-order/assign.ts'];
    const read = (p: string): string | null =>
      p === 'apps/api/src/modules/work-order/assign.ts'
        ? 'export function f(input: { window: { from: string } }) { return input.window.from; }'
        : healthyRead(p);
    const { failures } = evaluate(files, read);
    expect(failures).toEqual([]);
  });

  it('does not flag browser words inside comments or string literals', () => {
    const files = [...healthyFiles(), 'apps/api/src/server/auth/audit-actions.ts'];
    const read = (p: string): string | null =>
      p === 'apps/api/src/server/auth/audit-actions.ts'
        ? [
            '// RFC 9457 problem document. The window moves while confirmed.',
            "export const code = 'shared.document.upload_authorized';",
            "export const other = 'localStorage.getItem is only a string here';",
          ].join('\n')
        : healthyRead(p);
    const { failures } = evaluate(files, read);
    expect(failures).toEqual([]);
  });

  it('does not flag a server-only guard on window', () => {
    // `typeof window !== 'undefined'` is how the API REFUSES to run in a
    // browser. Flagging it would penalise the boundary being enforced.
    const files = [...healthyFiles(), 'apps/api/src/config/guard.ts'];
    const read = (p: string): string | null =>
      p === 'apps/api/src/config/guard.ts'
        ? "export function serverEnv() { if (typeof window !== 'undefined') throw new Error('server only'); return 1; }"
        : healthyRead(p);
    const { failures } = evaluate(files, read);
    expect(failures).toEqual([]);
  });
});

describe('rule scopes', () => {
  it('every rule declares a scope the evaluator understands', () => {
    // The bug this pins: the first draft scanned import rules against
    // string-stripped source, so all five matched nothing while the gate
    // reported success. A rule with a missing or misspelt scope must be
    // impossible rather than quietly inert.
    for (const rule of CODE_RULES) {
      expect(['code', 'imports'], `rule ${rule.id}`).toContain(rule.scope);
    }
  });

  it('keeps every import rule out of the string-stripped view', () => {
    // An import specifier IS a string literal; scanning it stripped is the
    // exact silent failure above.
    const importRules = CODE_RULES.filter((r) => /import|use-client|ui-framework/.test(r.id));
    expect(importRules.length).toBeGreaterThan(0);
    for (const rule of importRules) expect(rule.scope).toBe('imports');
  });
});

describe('stripNonCode', () => {
  it('removes line comments, block comments and string literals', () => {
    const stripped = stripNonCode(
      ['// localStorage.getItem', '/* document.body */', "const a = 'sessionStorage.x';"].join('\n')
    );
    expect(stripped).not.toContain('localStorage.getItem');
    expect(stripped).not.toContain('document.body');
    expect(stripped).not.toContain('sessionStorage.x');
    expect(stripped).toContain('const a =');
  });

  it('leaves real code intact', () => {
    expect(stripNonCode('const x = localStorage.getItem;')).toContain('localStorage.getItem');
  });

  it('handles escaped quotes without swallowing the rest of the file', () => {
    const stripped = stripNonCode(`const a = 'it\\'s fine'; const b = localStorage.x;`);
    expect(stripped).toContain('localStorage.x');
  });
});
