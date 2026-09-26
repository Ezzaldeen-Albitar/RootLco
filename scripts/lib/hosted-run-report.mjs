/**
 * Reads a tier's test report back out of the GitHub-hosted run that produced it.
 *
 * WHY THIS EXISTS
 *
 * `check-p1-27-closing-values.mjs --record` spawns a tier locally and writes what
 * it did. That is the strongest record when the local runner agrees with the
 * hosted one, and it is the only record that can be taken before a push. But the
 * ledger records the RUNNER'S OWN VERDICT, and a runner's verdict is a property
 * of the machine as much as of the tree: this repository's unit tier exits 0 on
 * the hosted runner and 1 on a slower machine, where three test files each hold a
 * worker's event loop past birpc's sixty-second deadline and vitest raises
 * unhandled `onTaskUpdate` timeouts with every one of 3051 cases passing.
 *
 * The gate is right to refuse that record — a non-zero runner verdict is not made
 * green by a zero failure count — so the record has to come from the runner whose
 * verdict the repository actually ships against.
 *
 * WHAT THIS IS ALLOWED TO CLAIM
 *
 * `check-p1-27-closing-values.mjs` already states the rule for facts of this kind
 * under `HOSTED_ARTIFACT_ATTESTED`: no local command can re-derive a hosted
 * observation, and the gate does not pretend otherwise. What it proves is
 * INTERNAL CONSISTENCY — that the value names a run, a job and the exact head it
 * describes, and that nothing claiming to be hosted is presented as locally
 * derived. The observation itself is collected from the GitHub API. This module
 * is that collection step, done by a script instead of by a person reading a log,
 * which is the same class of evidence with one fewer place to mistype.
 *
 * SO NOTHING HERE IS TYPED BY A HUMAN. Given a run id, every field is read from
 * the API or from the artifact the run uploaded:
 *
 *   - the head the run describes, from the run;
 *   - the job, found by the STEP that runs the tier rather than by a job name,
 *     because the step is what the tier is;
 *   - the exit code, from that step's own conclusion — the one fact the JSON
 *     report cannot carry, since it has no field for an unhandled error;
 *   - the counts, from the report the run uploaded, whose bytes are checked
 *     against the digest the API publishes for them.
 *
 * A caller can still pass the wrong run id. It cannot pass the wrong numbers.
 *
 * READING IS SEPARATE FROM DECIDING
 *
 * `fetchHostedTierRun` collects what the run IS — in flight, cancelled, red,
 * missing its artifact — and throws only when it cannot read at all.
 * `judgeHostedEligibility` then decides, from that observation alone, whether it
 * may become SUCCESS evidence for a given commit. Only a completed run that
 * concluded `success` or `failure`, describing that commit, whose ONE tier job
 * belongs to it and concluded `success`, whose tier step concluded `success`,
 * and whose artifact (from that run, on its digest) holds a report and a tier
 * summary that agree and record no failure, is eligible. The per-tier half of
 * that rule is `ELIGIBLE_RUN_CONCLUSIONS` below.
 */

import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

const API = 'https://api.github.com';

/**
 * One entry out of a zip archive, without a dependency.
 *
 * GitHub serves artifacts as zip and Node ships no reader for them, so this
 * walks the central directory rather than guessing at the local headers: an
 * archive's own index is the only place the entry order and the compression
 * method are stated. It handles the two methods an artifact actually uses —
 * stored and deflate — and REFUSES anything else rather than returning bytes it
 * has not decoded, including the zip64 sizes that would need a different index.
 */
export function readZipEntry(zip, wanted) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  // The end-of-central-directory record sits at the end, after a comment that
  // may be up to 64KiB, so it is searched for backwards rather than assumed.
  for (let i = zip.length - 22; i >= 0 && i >= zip.length - 22 - 0xffff; i -= 1) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive: no end-of-central-directory record');

  const entries = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const found = [];
  for (let n = 0; n < entries; n += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) {
      throw new Error(`central directory entry ${n} has the wrong signature`);
    }
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const uncompressed = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localAt = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    found.push(name);
    if (name === wanted) {
      if (compressed === 0xffffffff || uncompressed === 0xffffffff || localAt === 0xffffffff) {
        throw new Error(`\`${name}\` is stored with zip64 sizes, which this reader does not read`);
      }
      if (zip.readUInt32LE(localAt) !== 0x04034b50) {
        throw new Error(`\`${name}\` does not begin with a local file header`);
      }
      // The local header repeats the name and carries its own extra field, whose
      // length routinely differs from the central directory's. Reading the data
      // offset from anywhere else is the classic way to get an off-by-a-few.
      const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
      const raw = zip.subarray(dataAt, dataAt + compressed);
      if (method === 0) return raw;
      if (method === 8) return inflateRawSync(raw);
      throw new Error(
        `\`${name}\` uses compression method ${method}, which this reader does not read`
      );
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`the artifact holds no \`${wanted}\` — it holds ${found.join(', ')}`);
}

async function api(path, token, { raw = false } = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      accept: raw ? 'application/vnd.github+json' : 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'rootlco-run-ledger',
    },
  });
  if (!response.ok) {
    // The status and the path, never the token, and never the body: an error
    // body from this endpoint can echo request headers back.
    throw new Error(`GET ${path} answered ${response.status}`);
  }
  return raw ? Buffer.from(await response.arrayBuffer()) : response.json();
}

/**
 * Every tier this repository can replay, and the names that identify it in a
 * hosted run.
 *
 * `step` is the identity that matters. A job can be renamed, moved between
 * workflows or matrixed, and the tier is still whatever step runs the tier — so
 * the job is FOUND by its step rather than matched by a name that would drift.
 *
 * `summary` is the tier summary `scripts/ci/summarise-vitest.mjs` writes from
 * the same report in the same job and uploads in the same artifact. It is read
 * back only to be compared with the report: two derivations of one run that
 * disagree mean the artifact is not the run it claims to be.
 */
export const HOSTED_TIERS = Object.freeze({
  unit: Object.freeze({
    step: 'Unit tier with coverage',
    artifact: 'evidence-unit-coverage',
    report: 'vitest-unit.json',
    summary: 'test-totals-unit.json',
  }),
  web: Object.freeze({
    step: 'Web component tier',
    artifact: 'evidence-web-quality',
    report: 'apps/web/vitest-web.json',
    summary: 'test-totals-web.json',
  }),
});

/**
 * The run conclusions a tier may be taken from.
 *
 * `failure` is here on purpose, and only because of the per-tier rule below:
 * a PR CI run is several independent jobs, and the overall conclusion is
 * `failure` whenever ANY of them fails — including the clean-room job that
 * refuses the previous head's run record (`RUN_RECORD_STALE`) until this very
 * record is taken. What a tier's record may rest on is therefore that tier's
 * OWN job and step, never the run as a whole: a failed run can supply a tier
 * only when that tier's job concluded `success`, and a successful run cannot
 * supply a tier whose job did not.
 *
 * Every other conclusion — `cancelled`, `timed_out`, `skipped`, `neutral`,
 * `action_required`, `stale`, `startup_failure`, or none at all — is a run that
 * did not reach a pass-or-fail verdict, and nothing measured in it is evidence.
 */
export const ELIGIBLE_RUN_CONCLUSIONS = Object.freeze(['success', 'failure']);

/**
 * Why a hosted observation cannot become success evidence, one name per reason.
 *
 * These are the recorder's refusals, not the ledger gate's: they are decided
 * BEFORE anything is written, so an ineligible run never reaches the ledger.
 */
export const HOSTED_INELIGIBILITY = Object.freeze({
  HOSTED_RUN_NOT_COMPLETED: 'the run has not finished (queued, waiting or in progress)',
  HOSTED_RUN_CONCLUSION_INELIGIBLE:
    'the run reached no pass-or-fail verdict (cancelled, timed out, skipped or similar)',
  HOSTED_RUN_HEAD_MISMATCH: 'the run describes a different commit from the one being recorded',
  HOSTED_TIER_NOT_RUN: 'no job in the run reached a verdict on the tier step',
  HOSTED_TIER_AMBIGUOUS: 'more than one job in the run ran the tier',
  HOSTED_JOB_NOT_IN_RUN: 'the tier job belongs to a different run or a different head',
  HOSTED_JOB_NOT_SUCCESSFUL: 'the tier job did not complete with conclusion success',
  HOSTED_STEP_NOT_SUCCESSFUL: 'the tier step did not conclude success',
  HOSTED_ARTIFACT_UNUSABLE:
    'the tier artifact is missing, ambiguous, expired, from another run, off its digest or unreadable',
  HOSTED_SUMMARY_MISSING: 'the tier artifact carries no tier summary to cross-check the report',
  HOSTED_COUNTS_INCONSISTENT: 'the report counts disagree with themselves or with the tier summary',
  HOSTED_REPORT_NOT_SUCCESSFUL: 'the report or its summary records a failure or no success',
});

/**
 * Collects one tier's hosted observation. It READS; `judgeHostedEligibility`
 * decides.
 *
 * Everything a run can be — in flight, cancelled, red, missing its artifact —
 * is returned as an observation rather than thrown, so the same facts can be
 * refused as success evidence or kept as diagnostic history without being
 * fetched twice. What IS thrown is a failure to read at all: an unknown tier,
 * or an API answer that is not OK. Those leave nothing to judge.
 *
 * `request` replaces the GitHub API for tests, which replay recorded answers
 * instead of reaching the network: `request(path, { raw })` returns the parsed
 * JSON, or a Buffer when `raw` is set.
 */
export async function fetchHostedTierRun({ repo, runId, tier, token, request }) {
  const spec = HOSTED_TIERS[tier];
  if (!spec) throw new Error(`unknown tier \`${tier}\` — ${Object.keys(HOSTED_TIERS)}`);
  const get = request ?? ((path, options) => api(path, token, options));

  const run = await get(`/repos/${repo}/actions/runs/${runId}`);
  const observation = {
    tier,
    runId: String(runId),
    headSha: String(run.head_sha ?? ''),
    runUrl: String(run.html_url ?? ''),
    workflow: String(run.name ?? ''),
    runStatus: String(run.status ?? ''),
    runConclusion: run.conclusion == null ? null : String(run.conclusion),
    definingJobs: 0,
    carryingJobs: [],
    job: null,
    jobName: null,
    jobRunId: null,
    jobHeadSha: null,
    jobStatus: null,
    jobConclusion: null,
    step: spec.step,
    stepConclusion: null,
    exitCode: null,
    artifact: spec.artifact,
    artifactRunId: null,
    artifactHeadSha: null,
    artifactDigest: null,
    artifactProblem: null,
    field: spec.report,
    report: null,
    summaryField: spec.summary,
    summary: null,
    summaryProblem: null,
    completedAt: String(run.updated_at ?? ''),
  };
  // A run in flight has no verdict to read, and its jobs and artifacts are
  // still changing under the reader. Nothing further is collected.
  if (observation.runStatus !== 'completed') return observation;

  const jobs = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await get(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`);
    jobs.push(...(batch.jobs ?? []));
    if ((batch.jobs ?? []).length < 100) break;
  }
  /*
   * The step must have RUN, not merely exist.
   *
   * One reusable workflow defines every step and each task instantiates all of
   * them, so a run of this repository carries a `Unit tier with coverage` step in
   * three jobs and skips it in two. Selecting on the name alone found all three
   * and refused as ambiguous — correct, and useless. What identifies the tier is
   * the job where the step reached a verdict.
   */
  const ran = (step) => step.conclusion === 'success' || step.conclusion === 'failure';
  observation.definingJobs = jobs.filter((job) =>
    (job.steps ?? []).some((step) => step.name === spec.step)
  ).length;
  const carrying = jobs.filter((job) =>
    (job.steps ?? []).some((step) => step.name === spec.step && ran(step))
  );
  observation.carryingJobs = carrying.map((job) => String(job.id));
  if (carrying.length !== 1) return observation;

  const job = carrying[0];
  const step = job.steps.find((each) => each.name === spec.step && ran(each));
  observation.job = String(job.id);
  observation.jobName = String(job.name ?? '');
  observation.jobRunId = job.run_id == null ? null : String(job.run_id);
  observation.jobHeadSha = job.head_sha == null ? null : String(job.head_sha);
  observation.jobStatus = job.status == null ? null : String(job.status);
  observation.jobConclusion = job.conclusion == null ? null : String(job.conclusion);
  observation.stepConclusion = String(step.conclusion);
  // The one fact the JSON report cannot carry. vitest's json reporter has no
  // field for an unhandled error, so a run with three of them still reports
  // `success: true` and `numFailedTests: 0`. The step's conclusion is the
  // process's own verdict, which is the thing the ledger is meant to record.
  observation.exitCode = step.conclusion === 'success' ? 0 : 1;
  observation.completedAt = String(job.completed_at ?? run.updated_at ?? '');

  const artifacts = await get(`/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`);
  const matching = (artifacts.artifacts ?? []).filter((each) => each.name === spec.artifact);
  if (matching.length === 0) {
    observation.artifactProblem = `run ${runId} uploaded no \`${spec.artifact}\` artifact`;
    return observation;
  }
  if (matching.length > 1) {
    // Taking the first would let one upload stand in for another.
    observation.artifactProblem =
      `run ${runId} holds ${matching.length} artifacts named \`${spec.artifact}\` ` +
      `(${matching.map((each) => each.id).join(', ')}); which one this tier produced is unknowable`;
    return observation;
  }
  const artifact = matching[0];
  observation.artifactRunId =
    artifact.workflow_run?.id == null ? null : String(artifact.workflow_run.id);
  observation.artifactHeadSha =
    artifact.workflow_run?.head_sha == null ? null : String(artifact.workflow_run.head_sha);
  if (artifact.expired) {
    observation.artifactProblem = `\`${spec.artifact}\` from run ${runId} has expired and its bytes are gone`;
    return observation;
  }

  const zip = await get(`/repos/${repo}/actions/artifacts/${artifact.id}/zip`, { raw: true });
  // The digest the API publishes for the archive, checked against the bytes that
  // arrived. It is what makes the counts below an OBSERVATION rather than a file
  // somebody handed over: a tampered report no longer matches what GitHub holds.
  const declared = String(artifact.digest ?? '');
  const actual = `sha256:${createHash('sha256').update(zip).digest('hex')}`;
  if (declared && declared !== actual) {
    observation.artifactProblem = `\`${spec.artifact}\` does not match its published digest — ${declared} vs ${actual}`;
    return observation;
  }
  observation.artifactDigest = declared || actual;
  try {
    observation.report = JSON.parse(readZipEntry(zip, spec.report).toString('utf8'));
  } catch (error) {
    observation.artifactProblem = `\`${spec.artifact}\`: ${error.message}`;
    return observation;
  }
  try {
    observation.summary = JSON.parse(readZipEntry(zip, spec.summary).toString('utf8'));
  } catch (error) {
    observation.summaryProblem = `\`${spec.artifact}\`: ${error.message}`;
  }
  return observation;
}

const isCount = (value) => Number.isInteger(value) && value >= 0;

/**
 * The counts a report states about itself and the counts its tier summary
 * states about it, as one list of disagreements. Empty means they agree.
 */
export function countDisagreements(report, summary) {
  const problems = [];
  const files = report?.testResults ?? [];
  const total = report?.numTotalTests;
  const passed = report?.numPassedTests;
  const failed = report?.numFailedTests;
  const pending = report?.numPendingTests ?? 0;
  const todo = report?.numTodoTests ?? 0;
  for (const [name, value] of [
    ['numTotalTests', total],
    ['numPassedTests', passed],
    ['numFailedTests', failed],
    ['numPendingTests', pending],
    ['numTodoTests', todo],
  ]) {
    if (!isCount(value)) problems.push(`the report's ${name} is not a count (${String(value)})`);
  }
  if (problems.length > 0) return problems;
  if (passed + failed + pending + todo !== total) {
    problems.push(
      `the report states ${total} tests but passed ${passed} + failed ${failed} + ` +
        `pending ${pending} + todo ${todo} = ${passed + failed + pending + todo}`
    );
  }
  const cases = files.reduce((sum, file) => sum + (file?.assertionResults ?? []).length, 0);
  if (cases !== total) {
    problems.push(`the report states ${total} tests but its files carry ${cases} cases`);
  }
  if (summary !== null && summary !== undefined) {
    for (const [what, fromSummary, fromReport] of [
      ['files', summary.files, files.length],
      ['total', summary.total, total],
      ['passed', summary.passed, passed],
      ['failed', summary.failed, failed],
      ['pending', summary.pending, pending],
      ['todo', summary.todo, todo],
    ]) {
      if (fromSummary !== fromReport) {
        problems.push(
          `the tier summary states ${what} ${String(fromSummary)}; the report states ${fromReport}`
        );
      }
    }
    if (summary.success !== (report?.success === true)) {
      problems.push(
        `the tier summary states success ${String(summary.success)}; the report states ` +
          `${String(report?.success)}`
      );
    }
  }
  return problems;
}

/**
 * Decides whether an observation may become SUCCESS evidence for the commit
 * `head`. Returns one `{ id, text }` per reason it may not; empty means eligible.
 *
 * Pure: it reads the observation and nothing else, so every refusal can be
 * driven from a recorded fixture.
 */
export function judgeHostedEligibility(observation, { head } = {}) {
  const problems = [];
  const refuse = (id, text) => problems.push({ id, text: `${id}: ${text}` });
  const o = observation ?? {};
  const run = `run ${o.runId}`;

  if (o.runStatus !== 'completed') {
    refuse(
      'HOSTED_RUN_NOT_COMPLETED',
      `${run} is ${o.runStatus || 'of unknown status'}; a record may not be taken from a run in flight`
    );
    return problems;
  }
  if (!ELIGIBLE_RUN_CONCLUSIONS.includes(o.runConclusion)) {
    refuse(
      'HOSTED_RUN_CONCLUSION_INELIGIBLE',
      `${run} concluded ${String(o.runConclusion)}, which is no pass-or-fail verdict; nothing ` +
        'measured in it is evidence'
    );
  }
  if (typeof head !== 'string' || !/^[0-9a-f]{40}$/.test(head) || o.headSha !== head) {
    // Filing a run of one tree against another is the single way this writer
    // could manufacture a green record, so it is refused before anything is
    // written rather than left for the gate to catch afterwards.
    refuse(
      'HOSTED_RUN_HEAD_MISMATCH',
      `${run} describes ${String(o.headSha).slice(0, 8)} but HEAD is ${String(head).slice(0, 8)}; ` +
        'a record may only be filed against the head its run ran'
    );
  }
  const carrying = o.carryingJobs ?? [];
  if (carrying.length === 0) {
    refuse(
      'HOSTED_TIER_NOT_RUN',
      o.definingJobs > 0
        ? `${run} skipped its \`${o.step}\` step in all ${o.definingJobs} job(s) that define it`
        : `${run} has no job with a \`${o.step}\` step — it did not run the ${o.tier} tier`
    );
    return problems;
  }
  if (carrying.length > 1) {
    refuse(
      'HOSTED_TIER_AMBIGUOUS',
      `${run} ran the ${o.tier} tier in ${carrying.length} jobs (${carrying.join(', ')}); taking ` +
        'the first would let one stand in for the other'
    );
    return problems;
  }
  if (o.jobRunId !== o.runId || o.jobHeadSha !== o.headSha) {
    refuse(
      'HOSTED_JOB_NOT_IN_RUN',
      `job ${o.job} names run ${String(o.jobRunId)} at ${String(o.jobHeadSha).slice(0, 8)}, not ` +
        `${run} at ${String(o.headSha).slice(0, 8)}`
    );
  }
  if (o.jobStatus !== 'completed' || o.jobConclusion !== 'success') {
    refuse(
      'HOSTED_JOB_NOT_SUCCESSFUL',
      `the ${o.tier} job ${o.job} (${o.jobName}) is ${String(o.jobStatus)} with conclusion ` +
        `${String(o.jobConclusion)}. A tier is taken from its own job, and only a job that ` +
        'concluded success can supply it — whatever the rest of the run did'
    );
  }
  if (o.stepConclusion !== 'success') {
    refuse(
      'HOSTED_STEP_NOT_SUCCESSFUL',
      `the \`${o.step}\` step concluded ${String(o.stepConclusion)}`
    );
  }
  if (o.artifactProblem) {
    refuse('HOSTED_ARTIFACT_UNUSABLE', o.artifactProblem);
    return problems;
  }
  if (o.artifactRunId !== o.runId || o.artifactHeadSha !== o.headSha) {
    refuse(
      'HOSTED_ARTIFACT_UNUSABLE',
      `\`${o.artifact}\` names run ${String(o.artifactRunId)} at ` +
        `${String(o.artifactHeadSha).slice(0, 8)}, not ${run} at ${String(o.headSha).slice(0, 8)}`
    );
  }
  if (o.report === null || typeof o.report !== 'object') {
    refuse('HOSTED_ARTIFACT_UNUSABLE', `\`${o.artifact}\` yielded no \`${o.field}\` report`);
    return problems;
  }
  if (o.summary === null || typeof o.summary !== 'object') {
    refuse(
      'HOSTED_SUMMARY_MISSING',
      o.summaryProblem ??
        `\`${o.artifact}\` carries no \`${o.summaryField}\` to cross-check the report against`
    );
  }
  const disagreements = countDisagreements(o.report, o.summary);
  if (disagreements.length > 0) {
    refuse('HOSTED_COUNTS_INCONSISTENT', disagreements.join('; '));
  }
  const failedSuites = o.report.numFailedTestSuites;
  const summaryProblems = Array.isArray(o.summary?.problems) ? o.summary.problems : [];
  if (
    o.report.success !== true ||
    o.report.numFailedTests !== 0 ||
    (failedSuites !== undefined && failedSuites !== 0) ||
    summaryProblems.length > 0
  ) {
    refuse(
      'HOSTED_REPORT_NOT_SUCCESSFUL',
      `\`${o.field}\` records success ${String(o.report.success)}, ` +
        `${String(o.report.numFailedTests)} failed test(s), ${String(failedSuites ?? 0)} failed ` +
        `suite(s)${summaryProblems.length > 0 ? `, and its summary reports: ${summaryProblems.join(' ')}` : ''}`
    );
  }
  return problems;
}
