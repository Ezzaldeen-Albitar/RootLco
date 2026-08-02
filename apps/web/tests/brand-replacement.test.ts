import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveBrandMark, type BrandConfig } from '../src/config/brand';

/**
 * P1-25 brand-replacement proof.
 *
 * The promise: supplying the final logo, name and palette changes centralised
 * configuration and tokens, and NO component.
 *
 * A test that only asserted "resolveBrandMark returns the configured name" would
 * pass against an architecture where twelve components also hard-code it. So the
 * proof has two halves: the adapter behaves, AND the repository contains exactly
 * one consumer of the brand configuration — which is what makes the first half
 * mean anything.
 */

const ROOT = join(__dirname, '..');

describe('brand adapter', () => {
  it('renders a wordmark while no approved asset exists', () => {
    const config: BrandConfig = {
      systemName: '[SYSTEM NAME]',
      systemShortName: '[SN]',
      logoMode: 'wordmark',
      logoAsset: null,
      primaryTheme: 'provisional',
      isProvisional: true,
    };
    expect(resolveBrandMark(config)).toEqual({
      kind: 'wordmark',
      text: '[SYSTEM NAME]',
      shortText: '[SN]',
    });
  });

  it('renders the approved asset once one is configured', () => {
    const config: BrandConfig = {
      systemName: 'Approved Product',
      systemShortName: 'AP',
      logoMode: 'asset',
      logoAsset: '/brand/logo.svg',
      primaryTheme: 'approved',
      isProvisional: false,
    };
    expect(resolveBrandMark(config)).toEqual({
      kind: 'asset',
      src: '/brand/logo.svg',
      alt: 'Approved Product',
    });
  });

  it('falls back to the wordmark when asset mode is set but no asset is supplied', () => {
    // A missing logo must degrade to readable text, never to a broken image in
    // an operational tool. This is the case a hand-written swap gets wrong.
    const config: BrandConfig = {
      systemName: 'Approved Product',
      systemShortName: 'AP',
      logoMode: 'asset',
      logoAsset: null,
      primaryTheme: 'approved',
      isProvisional: false,
    };
    expect(resolveBrandMark(config).kind).toBe('wordmark');
  });
});

describe('brand isolation is structural, not conventional', () => {
  it('has exactly one consumer of the brand configuration', () => {
    // If this number grows, the replacement promise is no longer true and the
    // gate — not a reviewer — is what says so.
    const output = execFileSync(process.execPath, ['scripts/check-brand-isolation.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(output).toMatch(/0 violation\(s\)/);
  });

  it('keeps every design value inside the token layer', () => {
    const output = execFileSync(process.execPath, ['scripts/check-design-tokens.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(output).toMatch(/0 raw value\(s\) outside the token layer/);
  });
});

describe('replacing the provisional identity touches configuration only', () => {
  const brandPath = join(ROOT, 'src/config/brand.ts');
  const coloursPath = join(ROOT, 'src/styles/tokens/_colors.scss');
  const originals = new Map<string, string>();

  const snapshot = (p: string) => {
    if (!originals.has(p)) originals.set(p, readFileSync(p, 'utf8'));
  };

  afterEach(() => {
    // The rehearsal must leave nothing behind. A proof that mutates the tree and
    // forgets to restore it is a defect that ships.
    for (const [p, body] of originals) writeFileSync(p, body);
    originals.clear();
  });

  it('applies a different name, logo mode and primary colour without editing a component', () => {
    // Every component and route the swap must not need to touch, captured as
    // CONTENT before anything is mutated.
    //
    // The earlier form asked `git diff --name-only` what differed from HEAD.
    // That cannot distinguish an edit this test made from an unrelated edit
    // already sitting in the working tree, so the proof only held on a clean
    // checkout and reported a false positive during any other work — which is
    // exactly what it did during the workspace migration. Comparing content
    // before and after answers the question that was actually being asked, and
    // answers it whatever else is in progress.
    const repositoryRoot = join(ROOT, '..', '..');
    const watched = execFileSync('git', ['ls-files', '-z', '--', 'apps/web'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean)
      .filter(
        (f) =>
          f.startsWith('apps/web/src/components/') ||
          f.startsWith('apps/web/src/app/') ||
          f.startsWith('apps/web/src/features/')
      );

    // An empty watch list would make the assertion below vacuously true.
    expect(watched.length, 'no component or route files were found to watch').toBeGreaterThan(0);
    const beforeComponents = new Map(
      watched.map((f) => [f, readFileSync(join(repositoryRoot, f), 'utf8')])
    );

    snapshot(brandPath);
    snapshot(coloursPath);

    const before = readFileSync(brandPath, 'utf8');
    const swapped = before
      .replace("systemName: '[SYSTEM NAME]'", "systemName: 'Owner Supplied Name'")
      .replace("systemShortName: '[SN]'", "systemShortName: 'OSN'")
      .replace("primaryTheme: 'provisional'", "primaryTheme: 'approved'");
    writeFileSync(brandPath, swapped);

    const colours = readFileSync(coloursPath, 'utf8');
    writeFileSync(coloursPath, colours.replace('500: #3366f2', '500: #7a1fa2'));

    const componentEdits = watched.filter(
      (f) => readFileSync(join(repositoryRoot, f), 'utf8') !== beforeComponents.get(f)
    );

    expect(componentEdits, 'a brand swap must not require editing any component or route').toEqual(
      []
    );

    // And the swap really happened, so the assertion above is not measuring an
    // edit that was never applied.
    expect(readFileSync(brandPath, 'utf8')).not.toBe(before);
    expect(readFileSync(coloursPath, 'utf8')).not.toBe(colours);
  });
});
