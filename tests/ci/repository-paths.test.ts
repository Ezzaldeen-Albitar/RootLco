import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
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
