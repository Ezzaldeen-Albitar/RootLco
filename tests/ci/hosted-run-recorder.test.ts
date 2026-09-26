import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DIAGNOSTICS_KEY,
  FAILURES,
  RUN_LEDGER_PATH,
  hostedRunRecord,
  judgeRunDiagnostics,
  judgeRunLedger,
  localDiagnosticRecord,
  recordHosted,
  recordProblems,
} from '../../scripts/ci/check-p1-27-closing-values.mjs';
import {
  PROVENANCE_LOCAL,
  fakeGit,
  tierBinding,
} from '../../scripts/ci/build-p1-28-evidence-manifest.mjs';
import { writeFilesAtomically } from '../../scripts/lib/atomic-files.mjs';
import {
  ELIGIBLE_RUN_CONCLUSIONS,
  HOSTED_INELIGIBILITY,
  countDisagreements,
  fetchHostedTierRun,
  judgeHostedEligibility,
} from '../../scripts/lib/hosted-run-report.mjs';

/**
 * The hosted-run recorder records SUCCESS only, and writes all or nothing.
 *
 * Every case replays GitHub API answers instead of reaching the network. The
 * answers are transcribed from PR CI run 36245483798 — the run the unit and web
 * tiers were last recorded from — trimmed to the fields the recorder reads, and
 * then mutated one fact at a time: the run's conclusion, the tier job's
 * conclusion, the head, the artifact, the counts. The artifact is a real zip
 * built here, and its digest is computed from its bytes, exactly as GitHub
 * publishes one.
 *
 * The rule under test (see `ELIGIBLE_RUN_CONCLUSIONS`): a tier is taken from its
 * OWN job. A run whose other jobs failed may supply a tier whose job concluded
 * success; nothing else — a failed tier job, a cancelled or unfinished run, a
 * different head, a missing or foreign artifact, counts that disagree — may.
 */

const HEAD = '8af2b6871de143c7dba10e02021cd40bc67ec5ba';
const OTHER_HEAD = '7e72410b6000000000000000000000000000beef';
const RUN_ID = '36245483798';
const REPO = 'owner/repo';
const UNIT_JOB = 108413839071;
const WEB_JOB = 108413839017;
const CLEAN_ROOM_JOB = 108413839555;
const UNIT_ARTIFACT = 10907386862;
const WEB_ARTIFACT = 10906744803;

/* ------------------------------------------------------------------ *
 * The artifact: a real zip, by the specification
 * ------------------------------------------------------------------ */

const zipOf = (entries: readonly { name: string; body: Buffer; deflate: boolean }[]): Buffer => {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const payload = entry.deflate ? deflateRawSync(entry.body) : entry.body;
    const name = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, payload);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    dir.writeUInt32LE(payload.length, 20);
    dir.writeUInt32LE(entry.body.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + payload.length;
  }
  const body = Buffer.concat(locals);
  const index = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, index, end]);
};

type Json = Record<string, unknown>;

/** A vitest JSON report: two files, five cases, one pending. */
const report = (): Json => ({
  success: true,
  numTotalTests: 5,
  numPassedTests: 4,
  numFailedTests: 0,
  numPendingTests: 1,
  numTodoTests: 0,
  numFailedTestSuites: 0,
  testResults: [
    {
      name: 'tests/ci/a.test.ts',
      status: 'passed',
      assertionResults: [{ status: 'passed' }, { status: 'passed' }, { status: 'pending' }],
    },
    {
      name: 'tests/ci/b.test.ts',
      status: 'passed',
      assertionResults: [{ status: 'passed' }, { status: 'passed' }],
    },
  ],
});

/** What `summarise-vitest.mjs` writes from that report in the same job. */
const summary = (label: string): Json => ({
  label,
  files: 2,
  total: 5,
  executed: 4,
  passed: 4,
  failed: 0,
  pending: 1,
  todo: 0,
  success: true,
  problems: [],
});

const artifactZip = (
  reportName: string,
  summaryName: string,
  over: { report?: Json; summary?: Json | null } = {}
): Buffer =>
  zipOf([
    { name: 'tests-unit.md', body: Buffer.from('# summary\n'), deflate: true },
    {
      name: reportName,
      body: Buffer.from(JSON.stringify(over.report ?? report())),
      deflate: true,
    },
    ...(over.summary === null
      ? []
      : [
          {
            name: summaryName,
            body: Buffer.from(JSON.stringify(over.summary ?? summary('unit'))),
            deflate: false,
          },
        ]),
  ]);

const digest = (bytes: Buffer): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/* ------------------------------------------------------------------ *
 * The API answers
 * ------------------------------------------------------------------ */

const step = (name: string, conclusion: string): Json => ({ name, conclusion });

const job = (id: number, name: string, unit: string, web: string, over: Json = {}): Json => ({
  id,
  run_id: Number(RUN_ID),
  head_sha: HEAD,
  name,
  status: 'completed',
  conclusion: 'success',
  completed_at: '2026-09-26T13:35:15Z',
  steps: [
    step('Set up job', 'success'),
    step('Unit tier with coverage', unit),
    step('Web component tier', web),
    step('Upload evidence', 'success'),
  ],
  ...over,
});

interface World {
  run: Json;
  jobs: Json[];
  artifacts: Json[];
  zips: Record<number, Buffer>;
  failOn?: string;
}

/** The run as it happened: overall `failure`, both tier jobs `success`. */
const world = (): World => {
  const unitZip = artifactZip('vitest-unit.json', 'test-totals-unit.json');
  const webZip = artifactZip('apps/web/vitest-web.json', 'test-totals-web.json', {
    summary: summary('web'),
  });
  return {
    run: {
      id: Number(RUN_ID),
      head_sha: HEAD,
      html_url: `https://github.com/${REPO}/actions/runs/${RUN_ID}`,
      name: 'PR CI',
      status: 'completed',
      conclusion: 'failure',
      updated_at: '2026-09-26T13:45:00Z',
    },
    jobs: [
      job(UNIT_JOB, 'unit-tests-coverage / unit-coverage', 'success', 'skipped'),
      job(WEB_JOB, 'Web quality / web-quality', 'skipped', 'success'),
      // The job that made the run red: the clean-room gate refusing the
      // previous head's run record. It defines both tier steps and runs neither.
      job(CLEAN_ROOM_JOB, 'Clean room / clean-room', 'skipped', 'skipped', {
        conclusion: 'failure',
      }),
    ],
    artifacts: [
      {
        id: UNIT_ARTIFACT,
        name: 'evidence-unit-coverage',
        expired: false,
        digest: digest(unitZip),
        workflow_run: { id: Number(RUN_ID), head_sha: HEAD },
      },
      {
        id: WEB_ARTIFACT,
        name: 'evidence-web-quality',
        expired: false,
        digest: digest(webZip),
        workflow_run: { id: Number(RUN_ID), head_sha: HEAD },
      },
    ],
    zips: { [UNIT_ARTIFACT]: unitZip, [WEB_ARTIFACT]: webZip },
  };
};

/** Replays `w` as the GitHub API, recording every path it is asked for. */
const replay = (w: World) => {
  const asked: string[] = [];
  const request = async (path: string): Promise<unknown> => {
    asked.push(path);
    if (w.failOn !== undefined && path.includes(w.failOn)) {
      throw new Error(`GET ${path} answered 502`);
    }
    if (path === `/repos/${REPO}/actions/runs/${RUN_ID}`) return w.run;
    if (path.startsWith(`/repos/${REPO}/actions/runs/${RUN_ID}/jobs`)) return { jobs: w.jobs };
    if (path.startsWith(`/repos/${REPO}/actions/runs/${RUN_ID}/artifacts`)) {
      return { artifacts: w.artifacts };
    }
    const zip = /\/actions\/artifacts\/(\d+)\/zip$/.exec(path);
    if (zip) return w.zips[Number(zip[1])];
    throw new Error(`GET ${path} answered 404`);
  };
  return { request, asked };
};

const unitJob = (w: World): Json => w.jobs.find((j) => j.id === UNIT_JOB) as Json;

/* ------------------------------------------------------------------ *
 * A throwaway repository root holding a ledger
 * ------------------------------------------------------------------ */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PRIOR_WEB = {
  command: 'npm run test --workspace @rootlco/web -- --reporter=json',
  tests: 6488,
  passed: 6488,
  failed: 0,
  skipped: 0,
  files: 183,
  exitCode: 0,
  reporterSuccess: true,
  failedSuites: [],
  filesWithoutCases: [],
  measuredAtCommit: HEAD,
  dirtyExecutablePaths: [],
  measuredAt: '2026-09-26T13:41:19Z',
};

const seededRoot = (): { root: string; ledgerPath: string; before: Buffer } => {
  const root = mkdtempSync(join(tmpdir(), 'rootlco-recorder-'));
  roots.push(root);
  const ledgerPath = join(root, ...RUN_LEDGER_PATH.split('/'));
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(
    ledgerPath,
    `${JSON.stringify({ task: 'P1-27 local tier measurements', tiers: { web: PRIOR_WEB } }, null, 2)}\n`
  );
  return { root, ledgerPath, before: readFileSync(ledgerPath) };
};

interface Outcome {
  code: number;
  out: string;
  err: string;
  ledger: Json & { tiers: Record<string, Json>; diagnostics?: Json[] };
  bytes: Buffer;
  before: Buffer;
  leftovers: string[];
  asked: string[];
}

const record = async (
  w: World,
  tier: 'unit' | 'web' = 'unit',
  options: Json = {}
): Promise<Outcome> => {
  const { root, ledgerPath, before } = seededRoot();
  const { request, asked } = replay(w);
  let out = '';
  let err = '';
  const code = (await recordHosted(tier, RUN_ID, root, {
    request,
    token: 'unused-by-a-replay',
    repo: REPO,
    head: HEAD,
    stdout: (text: string) => {
      out += text;
    },
    stderr: (text: string) => {
      err += text;
    },
    ...options,
  })) as number;
  const bytes = readFileSync(ledgerPath);
  return {
    code,
    out,
    err,
    ledger: JSON.parse(bytes.toString('utf8')),
    bytes,
    before,
    leftovers: readdirSync(dirname(ledgerPath)).filter((name) => name.includes('.tmp-')),
    asked,
  };
};

/** A refusal: exit 1, the named reason, and a ledger byte-identical to before. */
const expectRefused = (outcome: Outcome, id: string): void => {
  expect(outcome.code, outcome.err).toBe(1);
  expect(outcome.err).toContain(id);
  expect(outcome.err).toContain('nothing was written');
  expect(outcome.bytes.equals(outcome.before), 'the ledger changed on a refusal').toBe(true);
  expect(outcome.leftovers).toEqual([]);
};

/* ------------------------------------------------------------------ *
 * Success recording
 * ------------------------------------------------------------------ */

describe('the hosted recorder records an eligible tier, exactly as before', () => {
  it('records the unit tier from a run whose OTHER job failed (per-tier provenance)', async () => {
    const w = world();
    expect(w.run.conclusion).toBe('failure');
    const outcome = await record(w);
    expect(outcome.code, outcome.err).toBe(0);
    expect(outcome.err).toBe('');
    const unit = outcome.ledger.tiers.unit as Json & { provenance: Json };
    expect(unit.tests).toBe(5);
    expect(unit.passed).toBe(4);
    expect(unit.skipped).toBe(1);
    expect(unit.files).toBe(2);
    expect(unit.exitCode).toBe(0);
    expect(unit.measuredAtCommit).toBe(HEAD);
    expect(unit.provenance.runId).toBe(RUN_ID);
    expect(unit.provenance.job).toBe(String(UNIT_JOB));
    expect(unit.provenance.artifactDigest).toBe(digest(w.zips[UNIT_ARTIFACT] as Buffer));
    // The other tier's record is untouched, and no history was added.
    expect(outcome.ledger.tiers.web).toEqual(PRIOR_WEB);
    expect(outcome.ledger).not.toHaveProperty(DIAGNOSTICS_KEY);
    // The same output line the recorder has always printed.
    expect(outcome.out).toBe(
      `recorded unit from hosted run ${RUN_ID} job ${UNIT_JOB}: 5 tests, 0 failed, 2 files, ` +
        `exit 0 at ${HEAD.slice(0, 8)}\n`
    );
    // Written whole, in the format the ledger has always had.
    expect(outcome.bytes.toString('utf8')).toBe(`${JSON.stringify(outcome.ledger, null, 2)}\n`);
    expect(outcome.leftovers).toEqual([]);
  });

  it('records a tier from a run that succeeded outright', async () => {
    const w = world();
    w.run.conclusion = 'success';
    const outcome = await record(w, 'web');
    expect(outcome.code, outcome.err).toBe(0);
    expect((outcome.ledger.tiers.web as Json & { provenance: Json }).provenance.job).toBe(
      String(WEB_JOB)
    );
  });

  it('writes the record the writer has always produced for that observation', async () => {
    const w = world();
    const observation = await fetchHostedTierRun({
      repo: REPO,
      runId: RUN_ID,
      tier: 'unit',
      token: 'unused-by-a-replay',
      request: replay(w).request,
    });
    expect(judgeHostedEligibility(observation, { head: HEAD })).toEqual([]);
    const outcome = await record(w);
    expect(outcome.ledger.tiers.unit).toEqual(hostedRunRecord('unit', observation));
  });
});

/* ------------------------------------------------------------------ *
 * Refusals: nothing is written
 * ------------------------------------------------------------------ */

describe('the hosted recorder refuses every run that is not success evidence', () => {
  it('refuses a tier whose own job FAILED, even when the run succeeded', async () => {
    const w = world();
    w.run.conclusion = 'success';
    Object.assign(unitJob(w), { conclusion: 'failure' });
    expectRefused(await record(w), 'HOSTED_JOB_NOT_SUCCESSFUL');
  });

  it('refuses a tier whose step failed (the recorder used to write it with exit 1)', async () => {
    const w = world();
    const failing = unitJob(w);
    failing.conclusion = 'failure';
    (failing.steps as Json[])[1] = step('Unit tier with coverage', 'failure');
    const outcome = await record(w);
    expectRefused(outcome, 'HOSTED_STEP_NOT_SUCCESSFUL');
    expect(outcome.err).toContain('HOSTED_JOB_NOT_SUCCESSFUL');
  });

  it('refuses a cancelled, timed-out, skipped or otherwise verdictless run', async () => {
    const verdictless = [
      'cancelled',
      'timed_out',
      'skipped',
      'neutral',
      'stale',
      'action_required',
      'startup_failure',
      null,
    ];
    for (const conclusion of verdictless) {
      expect(ELIGIBLE_RUN_CONCLUSIONS).not.toContain(conclusion);
      const w = world();
      w.run.conclusion = conclusion;
      expectRefused(await record(w), 'HOSTED_RUN_CONCLUSION_INELIGIBLE');
    }
  });

  it('refuses a queued or in-progress run without reading its jobs', async () => {
    for (const status of ['queued', 'in_progress', 'waiting']) {
      const w = world();
      w.run.status = status;
      w.run.conclusion = null;
      const outcome = await record(w);
      expectRefused(outcome, 'HOSTED_RUN_NOT_COMPLETED');
      expect(outcome.asked).toEqual([`/repos/${REPO}/actions/runs/${RUN_ID}`]);
    }
  });

  it('refuses a run of a different head from the commit being recorded', async () => {
    expectRefused(await record(world(), 'unit', { head: OTHER_HEAD }), 'HOSTED_RUN_HEAD_MISMATCH');
  });

  it('refuses a tier the run never ran — the only job that ran is another tier', async () => {
    const w = world();
    w.jobs = [unitJob(w)];
    const outcome = await record(w, 'web');
    expectRefused(outcome, 'HOSTED_TIER_NOT_RUN');
    expect(outcome.err).toContain('skipped its `Web component tier` step');
  });

  it('refuses a tier two jobs ran, rather than taking the first', async () => {
    const w = world();
    w.jobs.push(job(UNIT_JOB + 1, 'unit re-run', 'success', 'skipped'));
    expectRefused(await record(w), 'HOSTED_TIER_AMBIGUOUS');
  });

  it('refuses a tier job that belongs to a different run or head', async () => {
    const foreignRun = world();
    unitJob(foreignRun).run_id = 1;
    expectRefused(await record(foreignRun), 'HOSTED_JOB_NOT_IN_RUN');
    const foreignHead = world();
    unitJob(foreignHead).head_sha = OTHER_HEAD;
    expectRefused(await record(foreignHead), 'HOSTED_JOB_NOT_IN_RUN');
  });

  it('refuses a run whose tier artifact is missing, expired, foreign or off its digest', async () => {
    const missing = world();
    missing.artifacts = missing.artifacts.filter((a) => a.id !== UNIT_ARTIFACT);
    expectRefused(await record(missing), 'HOSTED_ARTIFACT_UNUSABLE');

    const expired = world();
    (expired.artifacts[0] as Json).expired = true;
    expectRefused(await record(expired), 'HOSTED_ARTIFACT_UNUSABLE');

    const foreign = world();
    (foreign.artifacts[0] as Json).workflow_run = { id: 1, head_sha: HEAD };
    expectRefused(await record(foreign), 'HOSTED_ARTIFACT_UNUSABLE');

    const tampered = world();
    tampered.zips[UNIT_ARTIFACT] = artifactZip('vitest-unit.json', 'test-totals-unit.json', {
      report: { ...report(), numPassedTests: 5, numPendingTests: 0 },
    });
    expectRefused(await record(tampered), 'HOSTED_ARTIFACT_UNUSABLE');

    const twice = world();
    twice.artifacts.push({ ...(twice.artifacts[0] as Json), id: UNIT_ARTIFACT + 1 });
    expectRefused(await record(twice), 'HOSTED_ARTIFACT_UNUSABLE');
  });

  it('refuses counts the report and its tier summary disagree on', async () => {
    const reseal = (w: World, over: { report?: Json; summary?: Json | null }): World => {
      const zip = artifactZip('vitest-unit.json', 'test-totals-unit.json', over);
      w.zips[UNIT_ARTIFACT] = zip;
      (w.artifacts[0] as Json).digest = digest(zip);
      return w;
    };
    expectRefused(
      await record(reseal(world(), { summary: { ...summary('unit'), total: 6, passed: 5 } })),
      'HOSTED_COUNTS_INCONSISTENT'
    );
    expectRefused(
      await record(reseal(world(), { summary: { ...summary('unit'), files: 3 } })),
      'HOSTED_COUNTS_INCONSISTENT'
    );
    // A report that does not add up to itself.
    expectRefused(
      await record(reseal(world(), { report: { ...report(), numTotalTests: 6 } })),
      'HOSTED_COUNTS_INCONSISTENT'
    );
    // And one with nothing to be compared against.
    expectRefused(await record(reseal(world(), { summary: null })), 'HOSTED_SUMMARY_MISSING');
  });

  it('refuses a report that records a failure, whatever the step said', async () => {
    const w = world();
    const red = { ...report(), success: false, numPassedTests: 3, numFailedTests: 1 };
    const zip = artifactZip('vitest-unit.json', 'test-totals-unit.json', {
      report: red,
      summary: { ...summary('unit'), passed: 3, failed: 1, success: false },
    });
    w.zips[UNIT_ARTIFACT] = zip;
    (w.artifacts[0] as Json).digest = digest(zip);
    expectRefused(await record(w), 'HOSTED_REPORT_NOT_SUCCESSFUL');
  });

  it('writes nothing when the API cannot be read, and says so', async () => {
    for (const failOn of [`/runs/${RUN_ID}/jobs`, '/artifacts', '/zip']) {
      const w = world();
      w.failOn = failOn;
      const outcome = await record(w);
      expect(outcome.code).toBe(2);
      expect(outcome.err).toContain('answered 502');
      expect(outcome.err).toContain('nothing was written');
      expect(outcome.bytes.equals(outcome.before)).toBe(true);
    }
  });

  it('reaches every ineligibility it declares, and declares every one it raises', () => {
    const observed = new Set<string>();
    const judge = (mutate: (w: World) => void, head = HEAD): Promise<void> => {
      const w = world();
      mutate(w);
      return fetchHostedTierRun({
        repo: REPO,
        runId: RUN_ID,
        tier: 'unit',
        token: 'unused-by-a-replay',
        request: replay(w).request,
      }).then((o) => {
        for (const p of judgeHostedEligibility(o, { head })) observed.add(p.id);
      });
    };
    return Promise.all([
      judge((w) => Object.assign(w.run, { status: 'in_progress', conclusion: null })),
      judge((w) => Object.assign(w.run, { conclusion: 'cancelled' }), OTHER_HEAD),
      judge((w) => {
        w.jobs = [];
      }),
      judge((w) => w.jobs.push(job(1, 'twin', 'success', 'skipped'))),
      judge((w) => Object.assign(unitJob(w), { run_id: 1, conclusion: 'failure' })),
      judge((w) => {
        (unitJob(w).steps as Json[])[1] = step('Unit tier with coverage', 'failure');
      }),
      judge((w) => {
        w.artifacts = [];
      }),
      judge((w) => {
        const zip = artifactZip('vitest-unit.json', 'test-totals-unit.json', {
          summary: null,
          report: { ...report(), success: false, numTotalTests: 9 },
        });
        w.zips[UNIT_ARTIFACT] = zip;
        (w.artifacts[0] as Json).digest = digest(zip);
      }),
    ]).then(() => {
      expect([...observed].sort()).toEqual(Object.keys(HOSTED_INELIGIBILITY).sort());
    });
  });

  it('agrees with a report whose counts add up, and names each disagreement otherwise', () => {
    expect(countDisagreements(report(), summary('unit'))).toEqual([]);
    expect(countDisagreements({ ...report(), numFailedTests: 'x' }, null).join(' ')).toContain(
      'numFailedTests is not a count'
    );
  });
});

/* ------------------------------------------------------------------ *
 * All or nothing
 * ------------------------------------------------------------------ */

describe('a validation or write failure leaves the tree byte-identical', () => {
  const pair = (): { dir: string; first: string; second: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'rootlco-atomic-'));
    roots.push(dir);
    const first = join(dir, 'first.json');
    const second = join(dir, 'second.json');
    writeFileSync(first, '{"first":1}\n');
    writeFileSync(second, '{"second":1}\n');
    return { dir, first, second };
  };

  it('writes every file when nothing fails', () => {
    const { dir, first, second } = pair();
    writeFilesAtomically([
      { path: first, content: 'A\n' },
      { path: second, content: 'B\n' },
    ]);
    expect(readFileSync(first, 'utf8')).toBe('A\n');
    expect(readFileSync(second, 'utf8')).toBe('B\n');
    expect(readdirSync(dir).sort()).toEqual(['first.json', 'second.json']);
  });

  it('puts back every file already written when a later write fails between them', () => {
    const { dir, first, second } = pair();
    const fresh = join(dir, 'fresh.json');
    const before = [readFileSync(first), readFileSync(second)];
    let renames = 0;
    const failSecond = (from: string, to: string): void => {
      renames += 1;
      if (renames === 3) throw new Error('injected: the disk filled between two writes');
      renameSync(from, to);
    };
    expect(() =>
      writeFilesAtomically(
        [
          { path: first, content: 'A\n' },
          { path: fresh, content: 'NEW\n' },
          { path: second, content: 'B\n' },
        ],
        { renameSync: failSecond }
      )
    ).toThrow(/injected/);
    // The two files that were swapped in are undone: one restored to its bytes,
    // one that did not exist removed again. The third never changed.
    expect(readFileSync(first).equals(before[0] as Buffer)).toBe(true);
    expect(existsSync(fresh)).toBe(false);
    expect(readFileSync(second).equals(before[1] as Buffer)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(['first.json', 'second.json']);
  });

  it('touches no target when staging fails', () => {
    const { dir, first, second } = pair();
    const before = [readFileSync(first), readFileSync(second)];
    let writes = 0;
    const failStaging = (path: string, content: string): void => {
      writes += 1;
      if (writes === 2) throw new Error('injected: staging failed');
      writeFileSync(path, content);
    };
    expect(() =>
      writeFilesAtomically(
        [
          { path: first, content: 'A\n' },
          { path: second, content: 'B\n' },
        ],
        { writeFileSync: failStaging }
      )
    ).toThrow(/injected/);
    expect(readFileSync(first).equals(before[0] as Buffer)).toBe(true);
    expect(readFileSync(second).equals(before[1] as Buffer)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(['first.json', 'second.json']);
  });

  it('leaves the ledger byte-identical when the recorder cannot swap it in', async () => {
    const outcome = await record(world(), 'unit', {
      fs: {
        renameSync: () => {
          throw new Error('injected: rename refused');
        },
      },
    });
    expect(outcome.code).toBe(2);
    expect(outcome.err).toContain('was not written, and is unchanged');
    expect(outcome.bytes.equals(outcome.before)).toBe(true);
    expect(outcome.leftovers).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Diagnostic history: explicit, marked, and never evidence
 * ------------------------------------------------------------------ */

describe('a failed run is kept as history only when asked, and never as evidence', () => {
  const failedTierJob = (): World => {
    const w = world();
    const failing = unitJob(w);
    failing.conclusion = 'failure';
    (failing.steps as Json[])[1] = step('Unit tier with coverage', 'failure');
    return w;
  };

  it('keeps a failed tier under `diagnostics`, marked, and leaves `tiers` alone', async () => {
    const outcome = await record(failedTierJob(), 'unit', { diagnostic: true });
    expect(outcome.code, outcome.err).toBe(0);
    expect(outcome.out).toContain('DIAGNOSTIC history (not evidence)');
    expect(outcome.ledger.tiers).toEqual({ web: PRIOR_WEB });
    const history = outcome.ledger.diagnostics as Json[];
    expect(history).toHaveLength(1);
    const entry = history[0] as Json & { run: Json; job: Json; refusedBecause: string[] };
    expect(entry.diagnostic).toBe(true);
    expect(String(entry.evidence)).toMatch(/^DIAGNOSTIC ONLY/);
    expect(entry.tier).toBe('unit');
    expect(entry.outcome).toBe('failure');
    expect(entry.run.id).toBe(RUN_ID);
    expect(entry.job.conclusion).toBe('failure');
    expect(entry.refusedBecause.join(' ')).toContain('HOSTED_JOB_NOT_SUCCESSFUL');
    expect(entry).not.toHaveProperty('measuredAtCommit');
    expect(entry).not.toHaveProperty('provenance');
  });

  it('refuses to file an ELIGIBLE run as a diagnostic', async () => {
    expectRefused(await record(world(), 'unit', { diagnostic: true }), 'eligible success evidence');
  });

  it('has nothing to keep from a run still in flight', async () => {
    const w = world();
    w.run.status = 'in_progress';
    w.run.conclusion = null;
    expectRefused(await record(w, 'unit', { diagnostic: true }), 'HOSTED_RUN_NOT_COMPLETED');
  });

  it('writes a failed LOCAL run only as marked history, never as the tier', () => {
    const red = {
      command: 'npx vitest run --reporter=json',
      tests: 5,
      passed: 4,
      failed: 1,
      skipped: 0,
      files: 2,
      exitCode: 1,
      reporterSuccess: false,
      failedSuites: [],
      filesWithoutCases: [],
      measuredAtCommit: HEAD,
      dirtyExecutablePaths: [],
      measuredAt: '2026-09-26T13:00:00Z',
    };
    const problems = recordProblems('unit', red);
    expect(problems.map((p: { id: string }) => p.id)).toContain('RUN_RECORD_RUN_NOT_SUCCESSFUL');
    expect(recordProblems('unit', { ...red, failed: 0, exitCode: 0, reporterSuccess: true })).toEqual(
      []
    );
    const entry = localDiagnosticRecord('unit', red, problems);
    expect(entry.diagnostic).toBe(true);
    expect(judgeRunDiagnostics({ tiers: {}, [DIAGNOSTICS_KEY]: [entry] })).toEqual([]);
  });

  describe('every reader of the ledger ignores the history, and refuses it in `tiers`', () => {
    const clean = hostedRunRecord('unit', {
      headSha: HEAD,
      runId: RUN_ID,
      runUrl: '',
      workflow: 'PR CI',
      job: String(UNIT_JOB),
      jobName: 'unit-tests-coverage / unit-coverage',
      step: 'Unit tier with coverage',
      exitCode: 0,
      artifact: 'evidence-unit-coverage',
      artifactDigest: `sha256:${'0'.repeat(64)}`,
      field: 'vitest-unit.json',
      completedAt: '2026-09-26T13:35:15Z',
      report: report(),
    });
    const history = {
      diagnostic: true,
      evidence: 'DIAGNOSTIC ONLY — a run that did not succeed, kept as history.',
      source: 'hosted',
      tier: 'unit',
      outcome: 'failure',
      counts: { tests: 9, passed: 1, failed: 8, skipped: 0, files: 7 },
    };
    const facts = (runs: Json) => ({
      runs,
      executableChanges: { [HEAD]: [] },
      tierFiles: { unit: 2 },
    });

    it('closing values: history changes no verdict; history in `tiers` is refused', () => {
      const without = { tiers: { unit: clean } };
      const withHistory = { tiers: { unit: clean }, [DIAGNOSTICS_KEY]: [history] };
      expect(judgeRunLedger(facts(without))).toEqual([]);
      expect(judgeRunLedger(facts(withHistory))).toEqual([]);

      const misplaced = judgeRunLedger(facts({ tiers: { unit: { ...clean, ...history } } }));
      expect(misplaced.map((p: { id: string }) => p.id)).toContain(
        'RUN_RECORD_DIAGNOSTIC_MISPLACED'
      );
      const unmarked = judgeRunLedger(
        facts({ tiers: { unit: clean }, [DIAGNOSTICS_KEY]: [{ ...history, diagnostic: false }] })
      );
      expect(unmarked.map((p: { id: string }) => p.id)).toEqual([
        'RUN_RECORD_DIAGNOSTIC_MISPLACED',
      ]);
      expect(FAILURES).toHaveProperty('RUN_RECORD_DIAGNOSTIC_MISPLACED');
    });

    it('QA-005 (P1-28 tier binding): reads the tier and never the history', () => {
      const candidateSha = 'c'.repeat(40);
      const ledgerCommit = 'd'.repeat(40);
      const measured = { ...clean, measuredAtCommit: candidateSha };
      const candidate = {
        candidate: { FINAL_CODE_SHA: candidateSha },
        tiers: {
          unit: {
            tests: 5,
            passed: 4,
            failed: 0,
            skipped: 1,
            files: 2,
            measuredAtCommit: candidateSha,
            provenance: PROVENANCE_LOCAL,
            localLedger: { path: 'docs/ledger.json', tier: 'unit', atCommit: ledgerCommit },
            hostedAttestation: {
              runId: 11,
              jobId: 22,
              headSha: candidateSha,
              artefact: 'totals-unit.json',
            },
          },
        },
      };
      const bind = (ledger: Json) =>
        tierBinding(
          candidate as never,
          fakeGit({
            [`show ${ledgerCommit}:docs/ledger.json`]: JSON.stringify(ledger),
            [`diff --name-only ${candidateSha}..${candidateSha}`]: '',
          })
        ) as unknown as { localProblems: string[]; verifiedLocally: string[] };

      const plain = bind({ tiers: { unit: measured } });
      expect(plain.localProblems).toEqual([]);
      expect(plain.verifiedLocally).toHaveLength(1);

      const withHistory = bind({ tiers: { unit: measured }, [DIAGNOSTICS_KEY]: [history] });
      expect(withHistory.localProblems).toEqual([]);
      expect(withHistory.verifiedLocally).toEqual(plain.verifiedLocally);

      // History moved into the tier is read as the tier, and its red figures
      // are refused against the package.
      const misplaced = bind({
        tiers: { unit: { ...history.counts, measuredAtCommit: candidateSha } },
      });
      expect(misplaced.localProblems.length).toBeGreaterThan(0);
    });
  });
});
