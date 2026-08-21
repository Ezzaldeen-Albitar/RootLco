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

    /*
     * `QA005-05`. This read `toContain(`${jobs.length - 1} jobs + ${gate[0]}`)`,
     * which is a SUBSTRING match on a number: bounded on the right by the words
     * that follow it and on the left by nothing at all. A record reading
     * "111 jobs + nightly-gate" CONTAINS "11 jobs + nightly-gate", so only an
     * understatement was ever detectable and the direction that inflates a
     * pipeline's apparent size passed silently.
     *
     * The figure is read out and compared as a NUMBER. That is bounded on both
     * sides by construction: `\d+` is greedy and the match begins at the FIRST
     * digit of the run, so "111 jobs" is captured as 111 and 111 !== 11 fails.
     *
     * The gate id is interpolated rather than escaped because a job key is
     * `[a-z][a-z0-9-]*` — `-` is the only non-alphanumeric it can hold, and
     * outside a character class that is a literal.
     */
    const stated = new RegExp(String.raw`(\d+) jobs \+ ${gate[0]}\b`).exec(record);
    expect(stated, `the record does not describe ${gate[0]}'s job count`).not.toBeNull();
    expect(
      Number((stated as RegExpExecArray)[1]),
      `the record must state \`${jobs.length - 1} jobs + ${gate[0]}\``
    ).toBe(jobs.length - 1);
  });

  it('states the workflow-security rule count that the linter actually registers', async () => {
    const { RULE_IDS } = await import('../../scripts/ci/check-workflow-security.mjs');
    expect(record).toContain(`**${RULE_IDS.length} workflow-security rules**`);
  });
});
