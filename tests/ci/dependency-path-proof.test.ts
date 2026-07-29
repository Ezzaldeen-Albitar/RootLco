/**
 * Tests for the dependency-path and reachability proof.
 *
 * This script produces the single piece of evidence the whole brace-expansion
 * risk acceptance rests on, and until AR-49 it had no tests at all. The gap was
 * not theoretical: the markdown it published on every run asserted that the
 * package was not "present in the built runner image", which reads as _the
 * vulnerable code is absent_. That is false — Node vendors brace-expansion into
 * the `node` binary via esbuild, so the code ships in any image with a Node
 * runtime and no build step removes it — and it directly contradicted the
 * exception record's own `finalContainerCodePresent: true`.
 *
 * The measurement itself was always right; only its label was wrong. These tests
 * pin both: what the field measures, and what the rendered evidence may claim.
 */
import { describe, expect, it } from 'vitest';

import { buildProof, findInstances, toMarkdown } from '../../scripts/ci/dependency-path-proof.mjs';

/** A minimal lockfile with one dev-only instance of the package. */
const lock = {
  packages: {
    '': { name: 'rootlco', dependencies: { next: '^16' }, devDependencies: { eslint: '^9' } },
    'node_modules/eslint': { version: '9.0.0', dev: true, dependencies: { minimatch: '^3' } },
    'node_modules/minimatch': {
      version: '3.1.5',
      dev: true,
      dependencies: { 'brace-expansion': '^1.1.7' },
    },
    'node_modules/brace-expansion': { version: '1.1.16', dev: true },
  },
};

/** A `find / -xdev -type f` listing with no resolvable copy of the package. */
const imageWithoutPackageDir = [
  '/app/server.js',
  '/app/node_modules/next/dist/server/next-server.js',
  '/usr/local/bin/node',
  '/app/.next/static/chunks/main.js',
].join('\n');

/** The same image, except something DID ship a resolvable copy. */
const imageWithPackageDir = [
  imageWithoutPackageDir,
  '/app/node_modules/brace-expansion/index.js',
].join('\n');

describe('dependency-path proof — what the runner-image field measures', () => {
  it('reports `not-verified-here` when no image inventory is supplied', () => {
    const proof = buildProof({ lock, packageName: 'brace-expansion' });
    expect(proof.packageDirInRunnerImage).toBe('not-verified-here');
    // Unverified must never collapse into a reachability claim in either
    // direction — absent input is not evidence of absence.
    expect(proof.productionReachable).toBe(false);
  });

  it('is false when the image resolves no `node_modules/<pkg>/` directory', () => {
    const proof = buildProof({
      lock,
      packageName: 'brace-expansion',
      imageInventory: imageWithoutPackageDir,
    });
    expect(proof.packageDirInRunnerImage).toBe(false);
    expect(proof.productionReachable).toBe(false);
  });

  it('is true — and makes the package production-reachable — when a copy resolves', () => {
    const proof = buildProof({
      lock,
      packageName: 'brace-expansion',
      imageInventory: imageWithPackageDir,
    });
    expect(proof.packageDirInRunnerImage).toBe(true);
    expect(proof.productionReachable).toBe(true);
  });

  it('still finds the instance and marks the root edge as a devDependency', () => {
    const proof = buildProof({ lock, packageName: 'brace-expansion' });
    expect(proof.instanceCount).toBe(1);
    expect(proof.versions).toEqual(['1.1.16']);
    expect(proof.productionInstances).toEqual([]);
    expect(proof.allRootEdgesAreDev).toBe(true);
    expect(findInstances(lock, 'brace-expansion')[0]?.devOnly).toBe(true);
  });
});

describe('AR-49 — the rendered evidence may not claim the code is absent', () => {
  const markdown = toMarkdown(
    buildProof({
      lock,
      packageName: 'brace-expansion',
      imageInventory: imageWithoutPackageDir,
    })
  );

  it('labels the row as resolvability, not presence', () => {
    expect(markdown).toContain('Resolvable as an installed package in the runner image');
  });

  it('never renders the claim that the package is absent from the image', () => {
    // The exact defect: `| Present in the built runner image | **no** |`. Any
    // row pairing image presence with a negative answer is the same lie in a
    // new costume, so match the shape rather than the old string.
    //
    // Asserted against the document MINUS the blockquote caveat, because the
    // caveat necessarily contains the forbidden phrase in order to disclaim it
    // ("It is NOT a claim that the code is absent from the image"). Matching
    // the raw document would fail on the very sentence that fixes the problem.
    const withoutCaveat = markdown
      .split('\n')
      .filter((line) => !line.startsWith('>'))
      .join('\n');
    expect(withoutCaveat).not.toMatch(/Present in the built runner image/i);
    expect(withoutCaveat).not.toMatch(/\bnot present\b[^|\n]*image/i);
    expect(withoutCaveat).not.toMatch(/\babsent\b[^|\n]*image/i);
    // …and the caveat must actually be a blockquote, or the filter above would
    // silently remove nothing and this assertion would be vacuous.
    expect(markdown.split('\n').some((line) => line.startsWith('>'))).toBe(true);
  });

  it('states the caveat whenever it reports a negative, so the row cannot be quoted alone', () => {
    expect(markdown).toMatch(/NOT a claim that the code is absent from the image/);
    expect(markdown).toMatch(/vendors some of these packages inside the `node` binary/);
  });

  it('omits the caveat when the answer is positive — there is nothing to qualify', () => {
    const reachable = toMarkdown(
      buildProof({
        lock,
        packageName: 'brace-expansion',
        imageInventory: imageWithPackageDir,
      })
    );
    expect(reachable).not.toMatch(/NOT a claim that the code is absent/);
    expect(reachable).toContain('| **Production reachable** | **YES** |');
  });
});
