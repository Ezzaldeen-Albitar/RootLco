import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A verdict written to a file nobody opens is not a verdict (`WTF-10`).
 *
 * ## The defect
 *
 * `_reusable-node-quality.yml` runs `summarise-vitest.mjs` for the web tier and
 * writes `tests-web.md` — the executed count, the skipped cases, the anti-shrink
 * floor result. The job summary loop beside it listed seven other markdown files
 * and omitted that one. The web tier's honesty verdict was uploaded as an
 * artifact and rendered nowhere a reviewer reads.
 *
 * Two more in the same file (`build-output-scan.md`, `web-build-scan.md`) and one
 * in `_reusable-container.yml` (`reachability-brace-expansion.md`) were missing
 * for the same reason: the list of things to render is written by hand beside the
 * list of things produced, and only one of the two is ever updated.
 *
 * ## What this does about it
 *
 * It derives the PRODUCED set from each workflow's own `--markdown` arguments and
 * the RENDERED set from its own summary steps, and requires the first to be a
 * subset of the second. Adding a summariser without rendering it now fails here
 * rather than going unnoticed for a phase.
 *
 * The rendered set is read only from lines that write to `GITHUB_STEP_SUMMARY`,
 * or from a `for file in …` list within a few lines of one — so an artifact
 * upload block, which also names these files, cannot be mistaken for rendering
 * them. That distinction is the whole point: every one of the four missing files
 * WAS uploaded.
 */

const WORKFLOWS = join(process.cwd(), '.github', 'workflows');

/** `--markdown foo.md`. A dynamic target contains `$` and is handled separately. */
const PRODUCES = /--markdown\s+"?([\w.-]+\.md)"?/g;

/** A dynamic target, e.g. `--markdown "codeql-policy-${MATRIX_LANGUAGE}.md"`. */
const PRODUCES_DYNAMIC = /--markdown\s+"[^"]*\$\{[^"]*\.md"/g;

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name));
}

function produced(source: string): string[] {
  return [...source.matchAll(PRODUCES)].map((m) => m[1] as string);
}

function rendered(source: string): Set<string> {
  const lines = source.split('\n');
  const out = new Set<string>();
  lines.forEach((line, index) => {
    const writesSummary = line.includes('GITHUB_STEP_SUMMARY');
    // A `for file in a.md b.md; do` list counts only when the loop it opens
    // actually writes to the summary. The redaction loop in the container
    // workflow iterates files too, and renders nothing.
    const loopIntoSummary =
      /for file in /.test(line) &&
      lines
        .slice(index, index + 6)
        .join('\n')
        .includes('GITHUB_STEP_SUMMARY');
    if (!writesSummary && !loopIntoSummary) return;
    for (const m of line.matchAll(/([\w.-]+\.md)/g)) out.add(m[1] as string);
  });
  return out;
}

describe('every markdown verdict a job writes is rendered where a reviewer reads it', () => {
  const files = workflowFiles();

  it('reads the workflow directory at all', () => {
    // Without this, an empty directory would make every case below pass having
    // examined nothing — the exact shape of failure this file is about.
    expect(files.length, 'no workflow files were found').toBeGreaterThan(10);
    const all = files.map((name) => produced(readFileSync(join(WORKFLOWS, name), 'utf8'))).flat();
    expect(all.length, 'no `--markdown` output was found in any workflow').toBeGreaterThan(15);
  });

  it.each(workflowFiles())('%s renders every markdown it produces', (name) => {
    const source = readFileSync(join(WORKFLOWS, name), 'utf8');
    const writes = produced(source);
    if (writes.length === 0) return;
    const shown = rendered(source);
    const missing = [...new Set(writes)].filter((file) => !shown.has(file));
    expect(
      missing,
      `${name} writes these markdown verdicts and renders none of them in a job summary:\n  ` +
        `${missing.join('\n  ')}\nUploading a file is not showing it.`
    ).toEqual([]);
  });

  it('names the four that were missing, so the regression has a case of its own', () => {
    const nodeQuality = readFileSync(join(WORKFLOWS, '_reusable-node-quality.yml'), 'utf8');
    const shown = rendered(nodeQuality);
    // `tests-web.md` is the headline: the web tier's floor verdict.
    expect(shown.has('tests-web.md'), 'the web tier honesty verdict is rendered nowhere').toBe(
      true
    );
    expect(shown.has('build-output-scan.md')).toBe(true);
    expect(shown.has('web-build-scan.md')).toBe(true);
    const container = readFileSync(join(WORKFLOWS, '_reusable-container.yml'), 'utf8');
    expect(rendered(container).has('reachability-brace-expansion.md')).toBe(true);
  });

  it('does not mistake an artifact upload for a summary', () => {
    /*
     * The inversion guard. `tests-web.md` was listed in the upload block for the
     * whole of P1-27 and that is precisely why the omission survived: the file
     * existed, was collected, and was never shown. If `rendered()` ever starts
     * reading upload paths this case fails, because the upload block names a
     * file no summary step does.
     */
    const nodeQuality = readFileSync(join(WORKFLOWS, '_reusable-node-quality.yml'), 'utf8');
    expect(nodeQuality, 'the upload block no longer collects the web build log').toContain(
      'web-build.log'
    );
    expect(
      rendered(nodeQuality).has('classification.md'),
      'rendered() is picking up files this workflow never renders'
    ).toBe(false);
  });

  it('accounts for the one dynamic markdown target rather than ignoring it', () => {
    /*
     * `_reusable-code-security.yml` writes `codeql-policy-${MATRIX_LANGUAGE}.md`,
     * which the static extraction above cannot name. Silently skipping it would
     * be the same blind spot one level down, so the file is required to render
     * the same expression it writes.
     */
    const dynamic = workflowFiles().filter((name) =>
      PRODUCES_DYNAMIC.test(readFileSync(join(WORKFLOWS, name), 'utf8'))
    );
    PRODUCES_DYNAMIC.lastIndex = 0;
    expect(dynamic, 'the set of dynamic markdown targets has changed').toEqual([
      '_reusable-code-security.yml',
    ]);
    const source = readFileSync(join(WORKFLOWS, '_reusable-code-security.yml'), 'utf8');
    const rendersDynamic = source
      .split('\n')
      .some((line) => line.includes('GITHUB_STEP_SUMMARY') && line.includes('codeql-policy-$'));
    expect(rendersDynamic, 'the CodeQL policy verdict is written and never shown').toBe(true);
  });
});
