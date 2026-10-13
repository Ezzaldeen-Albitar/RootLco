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
 *     row carries the dispatch run, D, the records run and D', whose records
 *     pull request stayed inside the records allow-list, and whose D' sits
 *     directly on D (first parent of D' is D) — both recorded AND recomputed
 *     from git, so code that the full run never saw cannot be covered by it;
 *   - "Passed targeted hosted checks" must carry a run id at a 40-character SHA;
 *   - "Full hosted verification pending" must say where it is owed;
 *   - no column but State may claim a pass;
 *   - the register is append-only against the pull request's base.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RECORDS_FILE_ALLOW_LIST, matchesAny } from '../../scripts/lib/development-profile.mjs';

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
  "First parent of D'",
  'Records-only (change detection)',
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

/**
 * What git says about a checkpoint's two commits. `null` when git cannot answer
 * (an object the checkout does not hold), which the rules treat as a refusal.
 */
type History = {
  firstParent: (sha: string) => string | null;
  changedFiles: (from: string, to: string) => string[] | null;
};

/**
 * The conditions a checkpoint must meet to count as passed, beyond its run
 * links: the records pull request changed only records files, and D' is that
 * records pull request's merge directly onto D — no other merge in between.
 * Both are recorded in the register AND recomputed from git, so neither rests
 * on a claim.
 */
function checkpointProblems(where: string, entry: Row, history?: History): string[] {
  const problems: string[] = [];
  const d = SHA40.exec(entry['Integration revision D'] ?? '')?.[0];
  const dPrime = SHA40.exec(entry["Records revision D'"] ?? '')?.[0];
  if (!d) problems.push(`${where} carries no 40-character D`);
  if (!citesRun(entry['Dispatch run and protected-gate decision'])) {
    problems.push(`${where} carries no dispatch run URL`);
  }
  if (!citesRun(entry['Records pull request and its STRICT run'])) {
    problems.push(`${where} carries no records-pull-request run`);
  }
  if (!dPrime) problems.push(`${where} carries no 40-character D'`);
  const recordedParent = SHA40.exec(entry["First parent of D'"] ?? '')?.[0];
  if (!recordedParent || recordedParent !== d) {
    problems.push(`${where}: the first parent of D' is not recorded as D`);
  }
  if ((entry['Records-only (change detection)'] ?? '').replace(/`/g, '') !== 'true') {
    problems.push(`${where}: the records pull request is not recorded as records-only`);
  }
  if (history && d && dPrime) {
    const parent = history.firstParent(dPrime);
    if (parent === null) {
      problems.push(`${where}: git cannot resolve the first parent of D' ${dPrime}`);
    } else if (parent !== d) {
      problems.push(`${where}: the first parent of D' is ${parent}, not D ${d}`);
    }
    const files = history.changedFiles(d, dPrime);
    if (files === null) {
      problems.push(`${where}: git cannot list the files between D and D'`);
    } else {
      const outside = files.filter((f) => !matchesAny(f, RECORDS_FILE_ALLOW_LIST));
      if (files.length === 0 || outside.length > 0) {
        problems.push(
          `${where}: D..D' is not records-only (${outside.slice(0, 3).join(', ') || 'no files'})`
        );
      }
    }
  }
  return problems;
}

/** Every rule a ledger and its register must satisfy. Returns the violations. */
function judgeLedger(ledger: Row[], register: Row[], history?: History): string[] {
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
        problems.push(...checkpointProblems(`${id}: ${cp}`, entry, history));
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
    if (entry['State'] === 'Passed full checkpoint verification') {
      problems.push(...checkpointProblems(`register ${cp}`, entry, history));
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

/** The repository's own history, answering for the register's commits. */
const gitHistory: History = {
  firstParent: (sha) => {
    try {
      return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${sha}^1`], {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim();
    } catch {
      return null;
    }
  },
  changedFiles: (from, to) => {
    try {
      return execFileSync('git', ['diff', '--name-only', from, to], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
        .split('\n')
        .filter(Boolean);
    } catch {
      return null;
    }
  },
};

/** git for the history reads below: stdout as bytes, an optional stdin. */
function git(
  args: string[],
  input?: string,
  maxBuffer = 64 * 1024 * 1024,
  env?: NodeJS.ProcessEnv
): Buffer {
  return execFileSync('git', args, { cwd: ROOT, input, maxBuffer, env });
}

/**
 * The remotes this checkout may fetch missing objects from — none in an
 * ordinary clone, which holds every object it names.
 */
function promisorRemotes(): string[] {
  let listed: string;
  try {
    listed = git([
      'config',
      '--get-regexp',
      '^(remote\\..+\\.promisor|extensions\\.partialclone)$',
    ]).toString('utf8');
  } catch (error) {
    // Exit 1 is git's "no such key", which is the ordinary clone.
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
  const names = new Set<string>();
  for (const line of listed.split('\n')) {
    const remote = /^remote\.(.+)\.promisor (true|yes|on|1)$/i.exec(line)?.[1];
    const extension = /^extensions\.partialclone (.+)$/.exec(line)?.[1];
    if (remote) names.add(remote);
    if (extension) names.add(extension);
  }
  return [...names];
}

/**
 * In a partial clone, bring every blob the read below needs and the checkout
 * does not hold in ONE fetch, before anything reads them.
 *
 * The hosted checkouts are such a clone: the bootstrap checkout fetches with
 * `--filter=blob:none`, which registers the remote as a promisor, and the
 * full-history fetch that follows inherits that filter — so history arrives
 * as commits and trees, and git fetches each historical blob from the network
 * the moment something reads it, one fetch per blob. That, not the number of
 * local processes, is what made this read cost seconds per run and grow with
 * every pull request that touched the file.
 *
 * An ordinary clone has no promisor remote: this returns before resolving
 * anything and no network is touched. A failure here is never the verdict:
 * it leaves the blobs missing, the read below asks git for them as it always
 * did, and a blob that cannot be had fails there, by name.
 */
function fetchMissingBlobsAtOnce(specs: string[]): void {
  const remotes = promisorRemotes();
  if (remotes.length === 0) return;
  try {
    // Trees are held locally, so naming the blobs fetches nothing. In slices,
    // because the names travel as arguments and a command line is bounded.
    const blobs = new Set<string>();
    for (let i = 0; i < specs.length; i += 200) {
      const names = git(['rev-parse', ...specs.slice(i, i + 200)]).toString('utf8');
      for (const blob of names.split('\n').filter(Boolean)) blobs.add(blob);
    }
    // Asked with lazy fetching off, git reports an absent blob as missing
    // instead of going to fetch it.
    const missing = git(['cat-file', '--batch-check'], `${[...blobs].join('\n')}\n`, undefined, {
      ...process.env,
      GIT_NO_LAZY_FETCH: '1',
    })
      .toString('utf8')
      .split('\n')
      .filter((line) => line.endsWith(' missing'))
      .map((line) => line.slice(0, -' missing'.length));
    if (missing.length === 0) return;
    for (const remote of remotes) {
      try {
        // The request git itself makes for a missing object, with every
        // missing blob in it. No `--filter`: the remote's own is inherited,
        // so nothing is written to the configuration.
        git(
          [
            '-c',
            'fetch.negotiationAlgorithm=noop',
            'fetch',
            remote,
            '--no-tags',
            '--no-write-fetch-head',
            '--recurse-submodules=no',
            '--stdin',
          ],
          `${missing.join('\n')}\n`
        );
        return;
      } catch {
        // git has already said why on stderr; the next remote may hold them.
      }
    }
  } catch {
    // Left to the read below, which fetches lazily and fails if it cannot.
  }
}

/**
 * Every committed version of a file, oldest first: one entry per commit that
 * `git log -- <path>` lists, each resolved as `<commit>:<path>` — the commits
 * and the object expression a `git show` per commit would use.
 *
 * In an ordinary clone that is four git processes whatever the history holds:
 * the log, the promisor lookup, one `cat-file --batch-check` that resolves
 * every commit to its blob, and one `cat-file --batch` that reads each
 * DISTINCT blob once. A commit whose tree does not hold the file as a blob is
 * an error here, as it was for `git show`.
 */
function committedVersions(path: string): string[] {
  const commits = git(['log', '--format=%H', '--', path])
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .reverse();
  if (commits.length === 0) return [];

  const specs = commits.map((sha) => `${sha}:${path}`);
  fetchMissingBlobsAtOnce(specs);
  const resolved = git(['cat-file', '--batch-check'], `${specs.join('\n')}\n`)
    .toString('utf8')
    .split('\n')
    .filter(Boolean);
  if (resolved.length !== specs.length) {
    throw new Error(`git resolved ${resolved.length} of ${specs.length} versions of ${path}`);
  }
  const sizeByBlob = new Map<string, number>();
  const blobs = resolved.map((line, i) => {
    const match = /^([0-9a-f]{40,64}) blob (\d+)$/.exec(line);
    if (!match) throw new Error(`git holds no blob for ${specs[i]}: ${line}`);
    const [, blob = '', size = ''] = match;
    sizeByBlob.set(blob, Number.parseInt(size, 10));
    return blob;
  });

  // The sizes are known, so the buffer is sized to what will be read rather
  // than to a ceiling the file's history would one day outgrow.
  const distinct = [...sizeByBlob.keys()];
  const expectedBytes = [...sizeByBlob.values()].reduce((sum, size) => sum + size, 0);
  const out = git(
    ['cat-file', '--batch'],
    `${distinct.join('\n')}\n`,
    expectedBytes + distinct.length * 256
  );
  const textByBlob = new Map<string, string>();
  let offset = 0;
  for (const blob of distinct) {
    const size = sizeByBlob.get(blob) ?? 0;
    const headerEnd = out.indexOf(0x0a, offset);
    const header = headerEnd === -1 ? '' : out.subarray(offset, headerEnd).toString('utf8');
    if (header !== `${blob} blob ${size}`) {
      throw new Error(`git answered "${header}" where blob ${blob} of ${path} was asked for`);
    }
    const start = headerEnd + 1;
    textByBlob.set(blob, out.subarray(start, start + size).toString('utf8'));
    offset = start + size + 1;
  }
  // Nothing unread, nothing invented: the stream ends where the last blob
  // does, and every commit gets the text of its own blob.
  if (offset !== out.length) {
    throw new Error(
      `git wrote ${out.length} bytes for ${distinct.length} blob(s) of ${path}, ` +
        `of which ${offset} are accounted for`
    );
  }
  const texts = blobs.map((blob) => {
    const text = textByBlob.get(blob);
    if (text === undefined) throw new Error(`no text was read for blob ${blob} of ${path}`);
    return text;
  });
  if (texts.length !== commits.length) {
    throw new Error(`${texts.length} version(s) were read for ${commits.length} commit(s)`);
  }
  return texts;
}

/** What the checkout holds of history, for a guard that has to say so. */
function describeHistory(): string {
  const answer = (...args: string[]) => git(args).toString('utf8').trim();
  const commits = answer('rev-list', '--count', 'HEAD');
  return answer('rev-parse', '--is-shallow-repository') === 'true'
    ? `This checkout is shallow (${commits} commit(s) reachable from HEAD), so the history this ` +
        'case reads was not fetched. It needs the full history: fetch-depth 0, or ' +
        '`git fetch --unshallow`.'
    : `This checkout is not shallow (${commits} commit(s) reachable from HEAD), so the history ` +
        'itself holds no earlier version.';
}

describe('the TDP-2026-10 verification ledger', () => {
  const ledger = tableUnder(source, 'Verification ledger');
  const register = tableUnder(source, 'Hosted checkpoint register');

  it('has exactly the columns the policy defines', () => {
    expect(ledger.header).toEqual(LEDGER_COLUMNS);
    expect(register.header).toEqual(REGISTER_COLUMNS);
  });

  it('carries the four seed rows the policy owes', () => {
    const ids = ledger.rows.map((r) => r['ID']);
    for (const id of ['VL-CI-001', 'VL-CI-002', 'VL-CI-003', 'VL-CI-004']) {
      expect(ids).toContain(id);
    }
    expect(ledger.rows.find((r) => r['ID'] === 'VL-CI-001')?.['State']).toBe(
      'Full hosted verification pending'
    );
  });

  it('satisfies every rule, with each passed checkpoint recomputed from git', () => {
    expect(judgeLedger(ledger.rows, register.rows, gitHistory)).toEqual([]);
  });

  it('keeps every register row every earlier version of the file held', () => {
    /*
     * Append-only, proved against the file's own history rather than against
     * a branch ref a CI checkout may not have fetched: every committed version
     * that holds the register, oldest to newest, then the working copy. A row
     * may only gain a value in a blank cell. This covers the pull request's base
     * and everything before it, so a rewrite cannot slip in across two commits.
     */
    const committed = committedVersions(LEDGER_FILE);
    const earlier = committed.filter((text) => text.includes('### Hosted checkpoint register'));
    const versions = [...earlier, source];
    const problems: string[] = [];
    for (let i = 1; i < versions.length; i += 1) {
      problems.push(
        ...judgeAppendOnly(
          tableUnder(versions[i - 1] as string, 'Hosted checkpoint register').rows,
          tableUnder(versions[i] as string, 'Hosted checkpoint register').rows
        )
      );
    }
    /*
     * The loop above reports no problem when it compared nothing, which would
     * read as a kept promise. A depth-1 checkout is that case: its one
     * committed version IS the working copy, so the only pair compared is a
     * file with itself. The guard therefore counts the earlier versions that
     * differ from the working copy, line endings aside, and fails when there
     * is none — naming what the checkout holds of history rather than passing.
     */
    const lf = (text: string) => text.replace(/\r\n/g, '\n');
    const workingCopy = lf(source);
    const compared = earlier.filter((text) => lf(text) !== workingCopy);
    expect(
      compared.length,
      compared.length > 0
        ? ''
        : `git listed ${committed.length} committed version(s) of ${LEDGER_FILE}; ` +
            `${earlier.length} hold the register and none of those differs from the working ` +
            `copy, so nothing earlier was compared. ${describeHistory()}`
    ).toBeGreaterThan(0);
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
    "First parent of D'": D,
    'Records-only (change detection)': 'true',
    'Local QA row': 'row 13',
    State: 'Passed full checkpoint verification',
  };
  /** A history in which D' is a records-only merge directly onto D. */
  const honest: History = {
    firstParent: (sha) => (sha === 'b'.repeat(40) ? D : null),
    changedFiles: () => ['docs/phase-1/phase-1-27/evidence/local-run-ledger.json'],
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

  it("refuses a full checkpoint pass whose records PR carried code or whose D' is not on D", () => {
    const row = {
      ...pending,
      State: 'Passed full checkpoint verification',
      'Result link and tested revision': 'CP-20261006-1',
    };
    expect(judgeLedger([row], [checkpoint], honest)).toEqual([]);
    // The two conditions must be recorded...
    expect(
      judgeLedger([row], [{ ...checkpoint, 'Records-only (change detection)': 'false' }], honest)
    ).not.toEqual([]);
    expect(
      judgeLedger([row], [{ ...checkpoint, 'Records-only (change detection)': '—' }], honest)
    ).not.toEqual([]);
    expect(
      judgeLedger([row], [{ ...checkpoint, "First parent of D'": 'c'.repeat(40) }], honest)
    ).not.toEqual([]);
    // ...and git must agree with what is recorded: a feature merge between D and
    // the records pull request, or a records pull request that also carried code.
    expect(
      judgeLedger([row], [checkpoint], { ...honest, firstParent: () => 'c'.repeat(40) })
    ).not.toEqual([]);
    expect(
      judgeLedger([row], [checkpoint], {
        ...honest,
        changedFiles: () => [
          'docs/phase-1/phase-1-27/evidence/local-run-ledger.json',
          'apps/api/src/modules/billing/application/x.ts',
        ],
      })
    ).not.toEqual([]);
    // A history that cannot answer is a refusal, not a pass.
    expect(
      judgeLedger([row], [checkpoint], { firstParent: () => null, changedFiles: () => null })
    ).not.toEqual([]);
    // A register row recorded as passed is held to the same rules even before a
    // ledger row cites it.
    expect(
      judgeLedger([], [{ ...checkpoint, 'Records-only (change detection)': 'false' }], honest)
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
