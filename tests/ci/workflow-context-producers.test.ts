/**
 * Main's required status checks can be produced ONLY by their intended
 * producers. TDP-2026-10 (Owner approval 2026-10-05) made one check-run name
 * depend on the base branch, which is exactly the kind of change that could let
 * a develop run satisfy a check `main` requires. This holds the line by reading
 * every workflow in the repository.
 *
 * Main's ruleset (19896793) requires five contexts from GitHub Actions:
 * `ci-gate` and the four job names of `ci.yml`. The permitted producers are:
 *
 *   - `ci-gate` — the `ci-gate` job of `pr-ci.yml`, on a pull request whose
 *     base is main, and on nothing else;
 *   - the four `ci.yml` names — the four `ci.yml` jobs, which run on a pull
 *     request into main and a push to main, and on nothing else.
 *
 * Any other job in any workflow whose check-run name could resolve to one of
 * the five, under any event and any base, fails this file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateExpression, topLevelJobs, triggerBlock, unwrap } from './workflow-expression';

const ROOT = join(__dirname, '../..');
const WORKFLOWS = join(ROOT, '.github/workflows');
const read = (name: string): string => readFileSync(join(WORKFLOWS, name), 'utf8');
const files = readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n));

/** Main's required contexts, as recorded in docs/phase-1/phase-1-1/github-required-checks.md. */
const MAIN_CONTEXTS = [
  'ci-gate',
  'Lint, types, tests, build',
  'Docker build validation',
  'Database migrations and RLS tests',
  'Secret and sensitive-file scan',
] as const;
const CI_YML_PRODUCERS: Record<string, string> = {
  quality: 'Lint, types, tests, build',
  docker: 'Docker build validation',
  database: 'Database migrations and RLS tests',
  secrets: 'Secret and sensitive-file scan',
};

const EVENTS = [
  'pull_request',
  'push',
  'workflow_dispatch',
  'schedule',
  'workflow_call',
  'release',
];
const BASES = ['main', 'develop', '', 'feature/x'];

/**
 * Every name a job's check run could take, over every event and base. An
 * embedded expression this evaluator cannot resolve THROWS, so a name nobody
 * can predict fails the test rather than passing it unseen.
 */
function possibleNames(name: string | null, id: string): Set<string> {
  if (name === null) return new Set([id]);
  const literal = name.replace(/^(['"])(.*)\1$/, '$2');
  if (!literal.includes('${{')) return new Set([literal]);
  const out = new Set<string>();
  for (const event of EVENTS) {
    for (const base of BASES) {
      const context = {
        'github.event_name': event,
        'github.event.pull_request.base.ref': event === 'pull_request' ? base : null,
        'github.ref': base ? `refs/heads/${base}` : null,
        'github.base_ref': event === 'pull_request' ? base : null,
      };
      out.add(
        literal.replace(/\$\{\{([\s\S]*?)\}\}/g, (_m, expression: string) => {
          const value = evaluateExpression(unwrap(expression), context);
          return value === null ? '' : String(value);
        })
      );
    }
  }
  return out;
}

describe("main's required contexts have exactly the permitted producers", () => {
  it('lists the five contexts the required-checks record names', () => {
    const record = readFileSync(
      join(ROOT, 'docs/phase-1/phase-1-1/github-required-checks.md'),
      'utf8'
    );
    for (const context of MAIN_CONTEXTS) expect(record, context).toContain(context);
  });

  it('no job anywhere can emit a main context, except the permitted producers', () => {
    expect(files.length).toBeGreaterThan(10);
    const producers: string[] = [];
    for (const file of files) {
      for (const job of topLevelJobs(read(file))) {
        for (const name of possibleNames(job.name, job.id)) {
          if ((MAIN_CONTEXTS as readonly string[]).includes(name)) {
            producers.push(`${file}:${job.id}:${name}`);
          }
        }
      }
    }
    expect(producers.sort()).toEqual(
      [
        'pr-ci.yml:ci-gate:ci-gate',
        ...Object.entries(CI_YML_PRODUCERS).map(([id, name]) => `ci.yml:${id}:${name}`),
      ].sort()
    );
  });

  it('the PR gate emits `ci-gate` ONLY for a pull request into main', () => {
    const gate = topLevelJobs(read('pr-ci.yml')).find((j) => j.id === 'ci-gate');
    expect(gate?.name).toBeTruthy();
    for (const event of EVENTS) {
      for (const base of BASES) {
        const value = evaluateExpression(unwrap(gate?.name ?? ''), {
          'github.event_name': event,
          'github.event.pull_request.base.ref': event === 'pull_request' ? base : null,
        });
        const expected =
          event === 'pull_request' && base === 'main' ? 'ci-gate' : 'ci-gate (development)';
        expect(value, `${event} into '${base}'`).toBe(expected);
      }
    }
    // And the workflow has no trigger other than pull_request.
    const on = triggerBlock(read('pr-ci.yml'));
    expect(on.match(/^ {2}[a-z_]+:/gm)).toEqual(['  pull_request:']);
  });

  it('ci.yml runs ONLY on a pull request into main and a push to main', () => {
    const on = triggerBlock(read('ci.yml'));
    expect(on.match(/^ {2}[a-z_]+:/gm)).toEqual(['  pull_request:', '  push:']);
    expect(on).toMatch(/pull_request:\n {4}branches: \[main\]/);
    expect(on).toMatch(/push:\n {4}branches: \[main\]/);
    const names = topLevelJobs(read('ci.yml')).map((j) => [j.id, j.name]);
    expect(Object.fromEntries(names)).toEqual(CI_YML_PRODUCERS);
  });

  it('no reusable workflow job is named like a main context either', () => {
    // A called job reports as "caller / callee", so it cannot emit a bare
    // context today; this keeps that from becoming a coincidence anyone relies on.
    for (const file of files.filter((n) => n.startsWith('_reusable-'))) {
      for (const job of topLevelJobs(read(file))) {
        for (const name of possibleNames(job.name, job.id)) {
          expect((MAIN_CONTEXTS as readonly string[]).includes(name), `${file}:${job.id}`).toBe(
            false
          );
        }
      }
    }
  });

  it('the development gate name is produced by the PR gate alone', () => {
    const producers: string[] = [];
    for (const file of files) {
      for (const job of topLevelJobs(read(file))) {
        if (possibleNames(job.name, job.id).has('ci-gate (development)')) {
          producers.push(`${file}:${job.id}`);
        }
      }
    }
    expect(producers).toEqual(['pr-ci.yml:ci-gate']);
  });
});
