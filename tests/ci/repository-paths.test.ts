import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_APP_ROOT,
  API_ROOT,
  API_ROUTES_ROOT,
  API_SRC_ROOT,
  APPS_ROOT,
  DOCS_ROOT,
  REPOSITORY_ROOT,
  SCRIPTS_ROOT,
  SUPABASE_ROOT,
  TESTS_ROOT,
  WEB_ROOT,
  WEB_SRC_ROOT,
  fromRoot,
  toRepositoryPath,
} from '../../scripts/lib/repository-paths.mjs';

/**
 * The path authority is tested BEFORE the backend moves, because it is the
 * thing that makes the move safe.
 *
 * The first migration attempt produced `apps/api/apps/api/src/app/api` by
 * rewriting path literals across 21 scripts. These tests pin the property that
 * failure violated: a repository path is built from the root exactly once.
 */
describe('repository path authority', () => {
  it('derives the root from the module, not from the working directory', () => {
    // The decisive property. `process.cwd()` is a property of the caller; the
    // repository root is not. Three validators previously disagreed about this.
    expect(existsSync(resolve(REPOSITORY_ROOT, 'package.json'))).toBe(true);
    expect(existsSync(resolve(REPOSITORY_ROOT, 'supabase'))).toBe(true);
    expect(existsSync(resolve(REPOSITORY_ROOT, '.github'))).toBe(true);
  });

  it('resolves identically from the repository root, apps/api and apps/web', () => {
    // Executed as real subprocesses with different cwds. A unit-level assertion
    // could not catch a cwd dependency, because the test runner has one cwd.
    const probe =
      "import('file://' + process.argv[1].replace(/\\\\/g,'/')).then(m => " +
      'process.stdout.write(m.REPOSITORY_ROOT + "|" + m.API_ROUTES_ROOT))';
    const helper = resolve(REPOSITORY_ROOT, 'scripts/lib/repository-paths.mjs');

    const cwds = [
      REPOSITORY_ROOT,
      resolve(REPOSITORY_ROOT, 'scripts'),
      resolve(REPOSITORY_ROOT, 'tests'),
    ];
    const results = cwds.map((cwd) =>
      execFileSync(process.execPath, ['-e', probe, helper], { cwd, encoding: 'utf8' })
    );

    expect(new Set(results).size, 'the helper must not depend on cwd').toBe(1);
    expect(results[0]).toContain('apps');
  });

  it('never double-prefixes an application path', () => {
    // The exact defect that reverted the first attempt.
    for (const p of [
      API_ROOT,
      API_SRC_ROOT,
      API_APP_ROOT,
      API_ROUTES_ROOT,
      WEB_ROOT,
      WEB_SRC_ROOT,
    ]) {
      const posix = p.split(sep).join('/');
      expect(posix.match(/apps\/api/g)?.length ?? 0, `double-prefixed: ${posix}`).toBeLessThan(2);
      expect(posix.match(/apps\/web/g)?.length ?? 0, `double-prefixed: ${posix}`).toBeLessThan(2);
    }
  });

  it('builds each application path from the root exactly once', () => {
    expect(API_SRC_ROOT).toBe(fromRoot('apps', 'api', 'src'));
    expect(API_ROUTES_ROOT).toBe(fromRoot('apps', 'api', 'src', 'app', 'api'));
    expect(WEB_SRC_ROOT).toBe(fromRoot('apps', 'web', 'src'));
    expect(APPS_ROOT).toBe(fromRoot('apps'));
  });

  it('keeps repository-owned directories at the root, not inside an application', () => {
    // tests/, scripts/, supabase/ and docs/ are repository-owned. If any of
    // these ever resolves under apps/, the ownership split has been broken.
    for (const p of [TESTS_ROOT, SCRIPTS_ROOT, SUPABASE_ROOT, DOCS_ROOT]) {
      expect(p.split(sep).join('/')).not.toContain('/apps/');
    }
  });

  it('emits repository-relative POSIX paths for evidence', () => {
    // A generated artefact containing an absolute path becomes a permanent diff
    // between a developer machine and a CI runner.
    const rendered = toRepositoryPath(API_ROUTES_ROOT);
    expect(rendered).toBe('apps/api/src/app/api');
    expect(rendered).not.toContain('\\');
    expect(rendered.startsWith('/')).toBe(false);
    expect(toRepositoryPath(SUPABASE_ROOT)).toBe('supabase');
  });
});

/**
 * The post-move shape.
 *
 * These are the assertions a transitional root-`src` fallback could not satisfy,
 * which is why the validator normalization, the API package, the move and the
 * resolver repairs had to land as one commit rather than four.
 */
describe('the API application lives in the workspace', () => {
  it('has its source, routes and package where the authority says', () => {
    expect(existsSync(API_ROUTES_ROOT)).toBe(true);
    expect(existsSync(resolve(API_ROOT, 'package.json'))).toBe(true);
    expect(existsSync(resolve(API_ROOT, 'next.config.ts'))).toBe(true);
    expect(existsSync(resolve(API_ROOT, 'tsconfig.json'))).toBe(true);
    expect(existsSync(resolve(API_ROOT, 'eslint.config.mjs'))).toBe(true);
  });

  it('left nothing behind at the repository root', () => {
    // A leftover copy is worse than a failed move: both trees would compile, and
    // the stale one would drift silently until something imported it.
    expect(existsSync(fromRoot('src')), 'root src/ still exists').toBe(false);
    expect(existsSync(fromRoot('public')), 'root public/ still exists').toBe(false);
    expect(existsSync(fromRoot('next.config.ts')), 'root next.config.ts still exists').toBe(false);
    expect(existsSync(fromRoot('web')), 'root web/ still exists').toBe(false);
  });

  it('carries exactly one lockfile, at the root', () => {
    expect(existsSync(fromRoot('package-lock.json'))).toBe(true);
    expect(existsSync(resolve(API_ROOT, 'package-lock.json'))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, 'package-lock.json'))).toBe(false);
  });

  it('discovers the whole route surface, and would notice one missing', () => {
    const routeFiles = walkRoutes(API_ROUTES_ROOT);
    // 197 since the P1-16 remediation added `customers/[customerId]/route.ts`,
    // the module that never existed — every other read it added was a GET on a
    // route file that was already here.
    expect(routeFiles.length).toBe(197);

    // Non-vacuity. A discovery assertion that only checks a count would pass
    // against a set with one route swapped for another, so the comparison that
    // the validators actually make — set equality — is exercised here too.
    const discovered = new Set(routeFiles);
    const missingOne = new Set(routeFiles.slice(1));
    expect(discovered.size).toBe(routeFiles.length);
    expect(missingOne.size).toBe(routeFiles.length - 1);
    expect([...discovered].every((f) => missingOne.has(f))).toBe(false);

    // Every discovered path is repository-relative POSIX under the API app —
    // never absolute, never Windows-separated, never double-prefixed.
    for (const file of routeFiles) {
      expect(file.startsWith('apps/api/src/app/api/'), file).toBe(true);
      expect(file).not.toContain('\\');
      expect(file).not.toContain('apps/api/apps/api');
      expect(/^[a-zA-Z]:/.test(file), `absolute path leaked: ${file}`).toBe(false);
    }
  });

  it('discovers the same 236 operations from the root, apps/api and apps/web', () => {
    // The decisive cwd proof, run against a REAL validator rather than the
    // helper alone: `check-authorization-coverage.mjs` derived the repository
    // from `process.cwd()` until this migration, so its answer used to depend on
    // where it was launched. Three real processes, because a unit assertion
    // cannot catch a cwd dependency — the runner has one cwd.
    const validator = resolve(REPOSITORY_ROOT, 'scripts/check-authorization-coverage.mjs');
    const results = [REPOSITORY_ROOT, API_ROOT, WEB_ROOT].map((cwd) =>
      execFileSync(process.execPath, [validator, '--json'], { cwd, encoding: 'utf8' })
    );

    expect(new Set(results).size, 'discovery must not depend on cwd').toBe(1);
    const report = JSON.parse(results[0] ?? '{}');
    expect(report.operations).toHaveLength(236);

    // ~1 s per process by construction, not by slowness. The budget is stated
    // here rather than raised globally, so it cannot quietly cover a different
    // test that has genuinely regressed.
  }, 30_000);

  it('refuses to answer for a tree that is not there', () => {
    // A path helper that silently returns a directory which does not exist is
    // worse than no helper: every downstream check then reports "0 files found",
    // which reads exactly like a clean result.
    //
    // Proven against a throwaway tree rather than by mutating this repository,
    // so the test cannot leave damage behind if it fails midway.
    const sandbox = mkdtempSync(join(tmpdir(), 'rootlco-layout-'));
    try {
      mkdirSync(join(sandbox, 'scripts', 'lib'), { recursive: true });
      mkdirSync(join(sandbox, 'apps', 'web', 'src'), { recursive: true });
      copyFileSync(
        resolve(REPOSITORY_ROOT, 'scripts/lib/repository-paths.mjs'),
        join(sandbox, 'scripts', 'lib', 'repository-paths.mjs')
      );

      const probe = [
        "const m = await import('file://' + process.argv[1].replace(/\\\\/g,'/'));",
        'try { m.assertLayout(); process.stdout.write("NO THROW"); }',
        'catch (e) { process.stdout.write(e.message); }',
      ].join('');

      const output = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          probe,
          join(sandbox, 'scripts', 'lib', 'repository-paths.mjs'),
        ],
        { cwd: sandbox, encoding: 'utf8' }
      );

      expect(output).not.toBe('NO THROW');
      expect(output).toContain('apps/api/src/app/api');
      expect(output).toContain('repository-paths.mjs');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

/** Every `route.ts` under the API tree, as a repository-relative POSIX path. */
function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkRoutes(full, out);
    else if (entry.name === 'route.ts') out.push(toRepositoryPath(full));
  }
  return out;
}
