/**
 * The TDP-2026-10 verification ledger and hosted checkpoint register, held to
 * their own rules.
 *
 * Under the temporary development-path policy (Owner approval 2026-10-05) a
 * pull request into develop no longer proves everything, so WHAT is still owed,
 * and where it was finally proved, has to be written down somewhere a test can
 * read. That place is `docs/product/owner-directive-2026-09-16/capability-status.md`,
 * and this file is what stops it from turning into a list of claims:
 *
 *   - a row is in exactly one of five states;
 *   - "Passed full checkpoint verification" must cite a checkpoint whose register
 *     row carries the dispatch run, D, the records run and D';
 *   - "Passed targeted hosted checks" must carry a run id at a 40-character SHA;
 *   - "Full hosted verification pending" must say where it is owed;
 *   - no column but State may claim a pass;
 *   - the register is append-only against the pull request's base.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const LEDGER_FILE = 'docs/product/owner-directive-2026-09-16/capability-status.md';

const STATES = [
  'Passed locally',
  'Passed targeted hosted checks',
  'Full hosted verification pending',
  'Blocked by missing access or an unanswered business decision',
  'Passed full checkpoint verification',
] as const;

const LEDGER_COLUMNS = [
  'ID',
  'Requirement, defect or scenario (source)',
  'Test',
  'Pull request @ revision',
  'Local result',
  'Hosted result',
  'State',
  'Reason for deferral',
  'Owed at',
  'Result link and tested revision',
];
const REGISTER_COLUMNS = [
  'Checkpoint',
  'Integration revision D',
  'Dispatch run and protected-gate decision',
  'Merge-integrity runs covered',
  'Records pull request and its STRICT run',
  "Records revision D'",
  'Local QA row',
  'State',
];

type Row = Record<string, string>;

/** The first markdown table under a `### heading`, as header + rows of cells. */
function tableUnder(source: string, heading: string): { header: string[]; rows: Row[] } {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (start === -1) throw new Error(`no "### ${heading}" section`);
  let i = start + 1;
  while (i < lines.length && !(lines[i] ?? '').trim().startsWith('|')) {
    if ((lines[i] ?? '').startsWith('#')) throw new Error(`"${heading}" holds no table`);
    i += 1;
  }
  const cells = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const header = cells(lines[i] ?? '');
  const rows: Row[] = [];
  for (let j = i + 2; j < lines.length && (lines[j] ?? '').trim().startsWith('|'); j += 1) {
    const values = cells(lines[j] ?? '');
    rows.push(Object.fromEntries(header.map((h, k) => [h, values[k] ?? ''])));
  }
  return { header, rows };
}

const SHA40 = /\b[0-9a-f]{40}\b/;
const CHECKPOINT_ID = /^CP-\d{8}-\d+$/;
const EMPTY = (v: string | undefined) => !v || v === '—' || v === '-';

/**
 * Whether a cell cites a workflow run of THIS repository by URL. Parsed as a
 * URL and compared by host and path, rather than matched as a substring, so a
 * look-alike host or a path elsewhere cannot satisfy it.
 */
function citesRun(cell: string | undefined): boolean {
  return (cell ?? '').split(/\s+/).some((token) => {
    try {
      const url = new URL(token.replace(/[),.;]+$/, ''));
      return (
        url.protocol === 'https:' &&
        url.host === 'github.com' &&
        /^\/Ezzaldeen-Albitar\/RootLco\/actions\/runs\/\d+$/.test(url.pathname)
      );
    } catch {
      return false;
    }
  });
}

/** Every rule a ledger and its register must satisfy. Returns the violations. */
function judgeLedger(ledger: Row[], register: Row[]): string[] {
  const problems: string[] = [];
  const registerById = new Map(register.map((r) => [r['Checkpoint'] ?? '', r]));
  const seen = new Set<string>();
  for (const row of ledger) {
    const id = row['ID'] ?? '';
    if (!/^VL-(CI|DB|RLS|PERM|MONEY|WEB|E2E|DEP|INFRA|P131|P132)-\d{3}$/.test(id)) {
      problems.push(`${id || '(no id)'}: not a VL-<area>-NNN id`);
    }
    if (seen.has(id)) problems.push(`${id}: duplicated`);
    seen.add(id);
    const state = row['State'] ?? '';
    if (!(STATES as readonly string[]).includes(state)) {
      problems.push(`${id}: state "${state}" is not one of the five`);
    }
    for (const [column, value] of Object.entries(row)) {
      if (column === 'State') continue;
      if (/\bpass(ed|es)?\b/i.test(value)) {
        problems.push(`${id}: the ${column} column claims a pass; only State may`);
      }
    }
    if (state === 'Full hosted verification pending' && EMPTY(row['Owed at'])) {
      problems.push(`${id}: pending, but owed nowhere`);
    }
    if (state === 'Passed targeted hosted checks') {
      const hosted = row['Hosted result'] ?? '';
      if (!/\b\d{6,}\b/.test(hosted) || !/@\s*`?[0-9a-f]{40}`?/.test(hosted)) {
        problems.push(`${id}: a targeted hosted pass must cite a run id @ a 40-character SHA`);
      }
    }
    if (state === 'Passed full checkpoint verification') {
      const cited = `${row['Hosted result'] ?? ''} ${row['Result link and tested revision'] ?? ''}`;
      const cp = /\bCP-\d{8}-\d+\b/.exec(cited)?.[0];
      const entry = cp ? registerById.get(cp) : undefined;
      if (!cp || !entry) {
        problems.push(`${id}: a full checkpoint pass must cite a checkpoint in the register`);
      } else {
        if (!SHA40.test(entry['Integration revision D'] ?? '')) {
          problems.push(`${id}: ${cp} carries no 40-character D`);
        }
        if (!citesRun(entry['Dispatch run and protected-gate decision'])) {
          problems.push(`${id}: ${cp} carries no dispatch run URL`);
        }
        if (!citesRun(entry['Records pull request and its STRICT run'])) {
          problems.push(`${id}: ${cp} carries no records-pull-request run`);
        }
        if (!SHA40.test(entry["Records revision D'"] ?? '')) {
          problems.push(`${id}: ${cp} carries no 40-character D'`);
        }
        if (entry['State'] !== 'Passed full checkpoint verification') {
          problems.push(`${id}: ${cp} is not itself recorded as passed`);
        }
      }
    }
  }
  for (const entry of register) {
    const cp = entry['Checkpoint'] ?? '';
    if (!CHECKPOINT_ID.test(cp)) problems.push(`register: "${cp}" is not CP-YYYYMMDD-N`);
    if (!(STATES as readonly string[]).includes(entry['State'] ?? '')) {
      problems.push(`register ${cp}: state "${entry['State']}" is not one of the five`);
    }
    for (const [column, value] of Object.entries(entry)) {
      if (column === 'State') continue;
      if (/\bpass(ed|es)?\b/i.test(value)) {
        problems.push(`register ${cp}: the ${column} column claims a pass; only State may`);
      }
    }
  }
  return problems;
}

/** Register rows at the base must survive, except for blank cells being filled. */
function judgeAppendOnly(base: Row[], head: Row[]): string[] {
  const problems: string[] = [];
  for (const before of base) {
    const id = before['Checkpoint'] ?? '';
    const after = head.find((r) => r['Checkpoint'] === id);
    if (!after) {
      problems.push(`register row ${id} was removed`);
      continue;
    }
    for (const [column, value] of Object.entries(before)) {
      if (column === 'State') continue;
      if (!EMPTY(value) && after[column] !== value) {
        problems.push(`register row ${id}: "${column}" was rewritten`);
      }
    }
  }
  return problems;
}

const source = readFileSync(join(ROOT, LEDGER_FILE), 'utf8');

describe('the TDP-2026-10 verification ledger', () => {
  const ledger = tableUnder(source, 'Verification ledger');
  const register = tableUnder(source, 'Hosted checkpoint register');

  it('has exactly the columns the policy defines', () => {
    expect(ledger.header).toEqual(LEDGER_COLUMNS);
    expect(register.header).toEqual(REGISTER_COLUMNS);
  });

  it('carries the three seed rows the policy owes', () => {
    const ids = ledger.rows.map((r) => r['ID']);
    for (const id of ['VL-CI-001', 'VL-CI-002', 'VL-CI-003']) expect(ids).toContain(id);
    expect(ledger.rows.find((r) => r['ID'] === 'VL-CI-001')?.['State']).toBe(
      'Full hosted verification pending'
    );
  });

  it('satisfies every rule', () => {
    expect(judgeLedger(ledger.rows, register.rows)).toEqual([]);
  });

  it('keeps every register row every earlier version of the file held', () => {
    /*
     * Append-only, proved against the file's own history rather than against
     * a branch ref a CI checkout may not have fetched: every committed version
     * that holds the register, oldest to newest, then the working copy. A row
     * may only gain a value in a blank cell. This covers the pull request's base
     * and everything before it, so a rewrite cannot slip in across two commits.
     */
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const versions = git('log', '--format=%H', '--', LEDGER_FILE)
      .split('\n')
      .filter(Boolean)
      .reverse()
      .map((sha) => git('show', `${sha}:${LEDGER_FILE}`))
      .filter((text) => text.includes('### Hosted checkpoint register'));
    versions.push(source);
    const problems: string[] = [];
    for (let i = 1; i < versions.length; i += 1) {
      problems.push(
        ...judgeAppendOnly(
          tableUnder(versions[i - 1] as string, 'Hosted checkpoint register').rows,
          tableUnder(versions[i] as string, 'Hosted checkpoint register').rows
        )
      );
    }
    expect(versions.length, 'the working copy holds no register').toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });
});

describe('the ledger rules refuse what they exist to refuse', () => {
  const pending: Row = {
    ID: 'VL-CI-900',
    'Requirement, defect or scenario (source)': 'x',
    Test: 'x',
    'Pull request @ revision': 'x',
    'Local result': 'not executed',
    'Hosted result': 'not executed',
    State: 'Full hosted verification pending',
    'Reason for deferral': 'x',
    'Owed at': 'the first checkpoint',
    'Result link and tested revision': '—',
  };
  const D = 'a'.repeat(40);
  const checkpoint: Row = {
    Checkpoint: 'CP-20261006-1',
    'Integration revision D': D,
    'Dispatch run and protected-gate decision':
      'https://github.com/Ezzaldeen-Albitar/RootLco/actions/runs/123456789 — Go',
    'Merge-integrity runs covered': '2',
    'Records pull request and its STRICT run':
      '#600, https://github.com/Ezzaldeen-Albitar/RootLco/actions/runs/123456790',
    "Records revision D'": 'b'.repeat(40),
    'Local QA row': 'row 13',
    State: 'Passed full checkpoint verification',
  };

  it('accepts a well-formed pending row', () => {
    expect(judgeLedger([pending], [])).toEqual([]);
  });

  it('refuses a sixth state, a pending row owed nowhere, and a pass outside State', () => {
    expect(judgeLedger([{ ...pending, State: 'Green' }], [])).not.toEqual([]);
    expect(judgeLedger([{ ...pending, 'Owed at': '—' }], [])).not.toEqual([]);
    expect(judgeLedger([{ ...pending, 'Local result': 'passed on my machine' }], [])).not.toEqual(
      []
    );
  });

  it('refuses a targeted hosted pass without a run at a SHA', () => {
    const row = { ...pending, State: 'Passed targeted hosted checks' };
    expect(judgeLedger([{ ...row, 'Hosted result': 'green' }], [])).not.toEqual([]);
    expect(
      judgeLedger([{ ...row, 'Hosted result': `run 37306715232 @ ${'c'.repeat(40)}` }], [])
    ).toEqual([]);
  });

  it('refuses a full checkpoint pass that its register row does not back', () => {
    const row = {
      ...pending,
      State: 'Passed full checkpoint verification',
      'Result link and tested revision': 'CP-20261006-1',
    };
    expect(judgeLedger([row], [])).not.toEqual([]);
    expect(judgeLedger([row], [checkpoint])).toEqual([]);
    expect(judgeLedger([row], [{ ...checkpoint, "Records revision D'": 'pending' }])).not.toEqual(
      []
    );
    expect(
      judgeLedger([row], [{ ...checkpoint, 'Dispatch run and protected-gate decision': 'Go' }])
    ).not.toEqual([]);
    expect(
      judgeLedger(
        [row],
        [
          {
            ...checkpoint,
            'Dispatch run and protected-gate decision':
              'https://github.com.example.net/Ezzaldeen-Albitar/RootLco/actions/runs/123456789 — Go',
          },
        ]
      )
    ).not.toEqual([]);
  });

  it('refuses a rewritten or removed register row, and accepts a filled blank', () => {
    const blank = {
      ...checkpoint,
      "Records revision D'": '—',
      State: 'Full hosted verification pending',
    };
    expect(judgeAppendOnly([blank], [checkpoint])).toEqual([]);
    expect(judgeAppendOnly([checkpoint], [])).not.toEqual([]);
    expect(
      judgeAppendOnly([checkpoint], [{ ...checkpoint, 'Integration revision D': 'f'.repeat(40) }])
    ).not.toEqual([]);
  });
});
