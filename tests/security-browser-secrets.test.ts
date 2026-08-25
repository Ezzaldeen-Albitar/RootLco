import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Regression tests for scripts/check-browser-exposed-secrets.mjs.
 *
 * The bug being locked out: the previous CI step grepped tracked files for the
 * literal prohibited variable name, and the workflow file containing that grep is
 * itself tracked — so the scan matched its own source and failed every run.
 *
 * Each test runs the REAL scanner against a THROWAWAY git repository, so the
 * genuine `git ls-files` path is exercised without ever touching this
 * repository's index. Temporary repositories are removed afterwards.
 *
 * The prohibited name is assembled from fragments here for the same reason it is
 * in the scanner: writing it as one literal in this tracked test file would make
 * the repository-wide scan fail on this very file.
 */

const SCANNER = resolve(__dirname, '../scripts/check-browser-exposed-secrets.mjs');
const REPO_ROOT = resolve(__dirname, '..');

/** Same fragments-joined-at-runtime trick as the scanner. Never inline this. */
const FORBIDDEN = 'NEXT_PUBLIC_' + 'SUPABASE_' + 'SERVICE_' + 'ROLE';

/** A fake value. Never a real or realistic credential. */
const FAKE_VALUE = 'not-a-real-key-test-fixture-0000';

function runScanner(cwd: string) {
  const res = spawnSync(process.execPath, [SCANNER], { cwd, encoding: 'utf8' });
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    output: (res.stdout ?? '') + (res.stderr ?? ''),
  };
}

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'rootlco-sec-'));
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Creates an isolated git repo with the given tracked files. */
function makeRepo(
  name: string,
  files: Record<string, string>,
  untracked: Record<string, string> = {}
) {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content, 'utf8');
    git('add', '--', rel);
  }
  for (const [rel, content] of Object.entries(untracked)) {
    writeFileSync(join(dir, rel), content, 'utf8');
  }
  return dir;
}

describe('browser-exposed service-role scanner', () => {
  it('passes when no prohibited variable exists', () => {
    const dir = makeRepo('clean', {
      'a.ts': 'export const ok = 1;\n',
      '.env.example': 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n',
    });
    const r = runScanner(dir);
    expect(r.status).toBe(0);
    expect(r.output).toContain('OK');
  });

  it('fails when the prohibited variable exists in a tracked file', () => {
    const dir = makeRepo('violation', {
      'leak.ts': `const bad = process.env.${FORBIDDEN}_KEY;\n`,
    });
    const r = runScanner(dir);
    expect(r.status).toBe(1);
    expect(r.output).toContain('leak.ts:1');
  });

  it('does not print the matching line content', () => {
    // The whole point: the value beside such a name IS the credential.
    const dir = makeRepo('no-leak-output', {
      'leak.ts': `const bad = '${FAKE_VALUE}'; // ${FORBIDDEN}_KEY\n`,
    });
    const r = runScanner(dir);
    expect(r.status).toBe(1);
    expect(r.output).toContain('leak.ts:1');
    expect(r.output).not.toContain(FAKE_VALUE);
    expect(r.output).not.toContain('const bad');
  });

  it('does not flag similar safe variable names', () => {
    const dir = makeRepo('safe-names', {
      // Server-only key without the NEXT_PUBLIC_ prefix: correct and must pass.
      '.env.example': [
        'SUPABASE_SERVICE_ROLE_KEY=',
        'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder',
        'NEXT_PUBLIC_APP_ENV=local',
      ].join('\n'),
    });
    const r = runScanner(dir);
    expect(r.status).toBe(0);
  });

  it('only scans tracked files', () => {
    const dir = makeRepo(
      'untracked',
      { 'tracked.ts': 'export const ok = 1;\n' },
      { 'untracked.ts': `const bad = '${FORBIDDEN}_KEY';\n` }
    );
    const r = runScanner(dir);
    expect(r.status).toBe(0);
  });

  it('does not match its own source, and passes against this repository', () => {
    // The regression itself. If either the scanner or this test ever inlines the
    // prohibited name, this fails — which is exactly the protection we want.
    const scannerSource = readFileSync(SCANNER, 'utf8');
    expect(scannerSource).not.toContain(FORBIDDEN);
    const testSource = readFileSync(__filename, 'utf8');
    expect(testSource).not.toContain(FORBIDDEN);

    const r = runScanner(REPO_ROOT);
    expect(r.status).toBe(0);
    expect(r.output).toContain('OK');
    // A real subprocess scanning every tracked file in the repository, so the
    // cost grows with the tree — P1-25 added an entire web application and this
    // began exceeding the default 5 s under full-suite load. Stated here rather
    // than raised globally, so the budget cannot quietly cover a different test
    // that has genuinely regressed.
    //
    // 30 s -> 120 s for the same reason a second time: PRE-P1-29 has added ~2400
    // tracked files since, and this began timing out under full-tier load while
    // passing alone and passing on the hosted Linux runner. The note above was
    // written when the first raise happened; this is that argument recurring,
    // which is itself the evidence that the cost really does track the tree.
  }, 120_000);
});
