/**
 * AR-51. The documented inventory must match the repository.
 *
 * The pull-request record described the pipeline with a set of round numbers —
 * how many jobs, how many scripts, how many documents. Every one of them was
 * written by hand and then went stale as the change grew: `pr-ci.yml` was
 * described as "13 jobs" when it declares 12 plus the gate, nightly as "10
 * jobs" when it has 11 plus its own gate, and the script and document counts
 * were each short by one or two.
 *
 * None of that broke a gate, which is exactly why it survived. A number nobody
 * checks is a number that drifts, and a reviewer who spot-checks one of these
 * and finds it wrong has no reason to trust the ones they did not check.
 *
 * So the counts are derived here from the filesystem and reconciled against the
 * prose. If a workflow, script, baseline or document is added or removed, this
 * fails until the record is updated in the same commit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../..');
const ls = (dir: string, filter: (name: string) => boolean) =>
  existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).filter(filter) : [];

/** Every `*.md` under a directory, recursively. */
const markdown = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
      else if (entry.name.endsWith('.md')) out.push(`${rel}/${entry.name}`);
    }
  };
  walk(dir);
  return out;
};

/** Top-level job keys of a workflow — two-space indented, no deeper. */
const declaredJobs = (workflow: string): string[] => {
  const source = readFileSync(join(ROOT, '.github/workflows', workflow), 'utf8');
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  expect(start, `${workflow} has no top-level jobs: block`).toBeGreaterThan(-1);
  const jobs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim() !== '') break; // next top-level key
    const match = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (match?.[1]) jobs.push(match[1]);
  }
  return jobs;
};

const record = readFileSync(
  join(ROOT, 'docs/engineering/ci-automation/pull-request-body.md'),
  'utf8'
);

describe('the documented inventory matches the repository', () => {
  const workflows = ls('.github/workflows', (n) => n.endsWith('.yml'));
  const reusable = workflows.filter((n) => n.startsWith('_reusable-'));

  it('counts workflows, scripts, baselines and documents as the record claims', () => {
    const phrases = [
      `**${reusable.length} reusable workflows**`,
      `**${workflows.length - reusable.length} top-level workflows**`,
      `**${ls('.github/actions', () => true).length} composite action**`,
      `**${ls('scripts/ci', (n) => n.endsWith('.mjs')).length} scripts in \`scripts/ci\`**`,
      `**${ls('.github/ci-baselines', (n) => n.endsWith('.json')).length} baselines**`,
      `**${markdown('docs/engineering/ci-automation').length} documents**`,
    ];
    for (const phrase of phrases) {
      expect(record, `the record must state: ${phrase}`).toContain(phrase);
    }
  });

  it('describes pr-ci.yml with all three of its true numbers', () => {
    const jobs = declaredJobs('pr-ci.yml');
    const governed = jobs.filter((j) => j !== 'ci-gate');
    // The three are different and get conflated: the gate governs 12, the file
    // declares 13, and 14 checks report because code-security is a 2-language
    // matrix. Stating one of them as if it were the others is how "13 jobs +
    // ci-gate = 14" came to look right while being wrong twice.
    expect(jobs).toContain('ci-gate');
    expect(record).toContain(
      `**${governed.length} governed jobs plus \`ci-gate\` = ${jobs.length}**`
    );

    const languages = /language:\s*\[([^\]]+)\]/.exec(
      readFileSync(join(ROOT, '.github/workflows/_reusable-code-security.yml'), 'utf8')
    );
    const matrixSize = (languages?.[1] ?? '').split(',').filter((s) => s.trim()).length;
    expect(matrixSize, 'code-security must still be a matrix').toBeGreaterThan(1);
    expect(record).toContain(`**${jobs.length - 1 + matrixSize} checks**`);
  });

  it('describes nightly-assurance.yml by its real job count', () => {
    const jobs = declaredJobs('nightly-assurance.yml');
    const gate = jobs.filter((j) => j.endsWith('-gate'));
    expect(gate.length, 'nightly must have exactly one gate job').toBe(1);
    expect(record).toContain(`${jobs.length - 1} jobs + ${gate[0]}`);
  });

  it('states the workflow-security rule count that the linter actually registers', async () => {
    const { RULE_IDS } = await import('../../scripts/ci/check-workflow-security.mjs');
    expect(record).toContain(`**${RULE_IDS.length} workflow-security rules**`);
  });
});
