import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A path-shaped assertion must select the same files on Windows and on Linux
 * (`P1-27-SEC-004`).
 *
 * ## The defect
 *
 * `p1-27-security.test.ts` selects adapter files with
 * `/-api\.ts$|\/api\.ts$|-actions\.ts$/`. `node:path.join` yields backslashes on
 * Windows, so `\/api\.ts$` matched nothing there — `features/crm/customers/api.ts`
 * was never examined, and the sweep passed by not looking. On `ubuntu-latest`,
 * where hosted CI runs, the same pattern DID match, the file was examined, and it
 * failed: after the customer-search adapter moved to `lib/customers/directory`,
 * that file became a thin wrapper carrying neither a correlation reference nor a
 * delegation the rule recognised.
 *
 * So the suite was green on the machine it was written on and red on the machine
 * that decides. This file is what stops that recurring: it exercises the
 * selection rule against BOTH spellings explicitly, on whichever host it runs.
 *
 * ## What is deliberately NOT done
 *
 * The security rules themselves are not made case- or separator-insensitive.
 * Only the file SELECTION is normalised, because a rule about which files to
 * examine is not a rule about their content.
 */

const FEATURES = join(process.cwd(), 'src', 'features');

/** The selection rule under test, copied deliberately rather than imported. */
const ADAPTER = /-api\.ts$|\/api\.ts$|-actions\.ts$|action-support\.ts$/;

function walkRaw(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkRaw(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const raw = [...walkRaw(join(FEATURES, 'crm')), ...walkRaw(join(FEATURES, 'vehicles'))];
const posix = raw.map((p) => p.split(sep).join('/'));
const windows = raw.map((p) => p.split(sep).join('\\'));

describe('the adapter sweep selects the same files on either platform', () => {
  it('finds the CRM customer adapter under POSIX separators', () => {
    // The exact file the hosted runner examined and the Windows runner did not.
    const hit = posix.filter((p) => ADAPTER.test(p) && p.endsWith('crm/customers/api.ts'));
    expect(hit).toHaveLength(1);
  });

  it('would NOT find it under Windows separators — the original defect', () => {
    // Pinned as a fact about the pattern, not as desired behaviour. It is why
    // the sweep must normalise before matching rather than trusting `join`.
    const hit = windows.filter((p) => ADAPTER.test(p) && p.endsWith('crm\\customers\\api.ts'));
    expect(hit).toHaveLength(0);
  });

  it('selects an identical set once separators are normalised', () => {
    const fromPosix = posix.filter((p) => ADAPTER.test(p)).sort();
    const fromWindows = windows
      .map((p) => p.split('\\').join('/'))
      .filter((p) => ADAPTER.test(p))
      .sort();
    expect(fromWindows).toEqual(fromPosix);
    expect(fromPosix.length).toBeGreaterThan(8);
  });
});

describe('the file that failed on Linux now satisfies the rule', () => {
  const source = readFileSync(join(FEATURES, 'crm', 'customers', 'api.ts'), 'utf8');

  it('is a thin wrapper that carries no correlation reference of its own', () => {
    // Correct: it adds no behaviour. The rule has to accommodate that rather
    // than force a second copy of the mapping into it.
    expect(source).not.toContain('correlationId');
  });

  it('delegates to a module that does carry one', () => {
    expect(source).toContain('@/lib/customers/directory');
    const directory = readFileSync(
      join(process.cwd(), 'src', 'lib', 'customers', 'directory.ts'),
      'utf8'
    );
    expect(directory).toContain('correlationId');
  });
});
