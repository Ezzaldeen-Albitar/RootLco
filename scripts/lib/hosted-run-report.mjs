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
 * Every tier this repository can replay, and the three names that identify it in
 * a hosted run.
 *
 * `step` is the identity that matters. A job can be renamed, moved between
 * workflows or matrixed, and the tier is still whatever step runs the tier — so
 * the job is FOUND by its step rather than matched by a name that would drift.
 */
export const HOSTED_TIERS = Object.freeze({
  unit: Object.freeze({
    step: 'Unit tier with coverage',
    artifact: 'evidence-unit-coverage',
    report: 'vitest-unit.json',
  }),
  web: Object.freeze({
    step: 'Web component tier',
    artifact: 'evidence-web-quality',
    report: 'apps/web/vitest-web.json',
  }),
});

/**
 * Collects one tier's hosted observation, or throws saying which fact was missing.
 *
 * It reads rather than decides: the only judgement here is that a run must name
 * exactly one job carrying the tier's step. Zero means the run never ran the
 * tier — a record taken from it would describe nothing. More than one means the
 * tier ran twice and the caller must say which, because silently taking the
 * first would let a green re-run stand in for a red original.
 */
export async function fetchHostedTierRun({ repo, runId, tier, token }) {
  const spec = HOSTED_TIERS[tier];
  if (!spec) throw new Error(`unknown tier \`${tier}\` — ${Object.keys(HOSTED_TIERS)}`);

  const run = await api(`/repos/${repo}/actions/runs/${runId}`, token);
  if (run.status !== 'completed') {
    throw new Error(
      `run ${runId} is ${run.status}; a record may not be taken from a run in flight`
    );
  }

  const jobs = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await api(
      `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`,
      token
    );
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
  const carrying = jobs.filter((job) =>
    (job.steps ?? []).some((step) => step.name === spec.step && ran(step))
  );
  if (carrying.length === 0) {
    const skipped = jobs.filter((job) => (job.steps ?? []).some((step) => step.name === spec.step));
    throw new Error(
      skipped.length > 0
        ? `run ${runId} skipped its \`${spec.step}\` step in all ${skipped.length} job(s) that define it`
        : `run ${runId} has no job with a \`${spec.step}\` step — it did not run the ${tier} tier`
    );
  }
  if (carrying.length > 1) {
    throw new Error(
      `run ${runId} ran the ${tier} tier in ${carrying.length} jobs (${carrying
        .map((job) => job.id)
        .join(', ')}); taking the first would let one stand in for the other`
    );
  }
  const job = carrying[0];
  const step = job.steps.find((each) => each.name === spec.step && ran(each));
  if (step.conclusion !== 'success' && step.conclusion !== 'failure') {
    throw new Error(
      `the \`${spec.step}\` step was ${step.conclusion}; it neither passed nor failed`
    );
  }

  const artifacts = await api(`/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, token);
  const artifact = (artifacts.artifacts ?? []).find((each) => each.name === spec.artifact);
  if (!artifact) {
    throw new Error(`run ${runId} uploaded no \`${spec.artifact}\` artifact`);
  }
  if (artifact.expired) {
    throw new Error(`\`${spec.artifact}\` from run ${runId} has expired and its bytes are gone`);
  }

  const zip = await api(`/repos/${repo}/actions/artifacts/${artifact.id}/zip`, token, {
    raw: true,
  });
  // The digest the API publishes for the archive, checked against the bytes that
  // arrived. It is what makes the counts below an OBSERVATION rather than a file
  // somebody handed over: a tampered report no longer matches what GitHub holds.
  const declared = String(artifact.digest ?? '');
  const actual = `sha256:${createHash('sha256').update(zip).digest('hex')}`;
  if (declared && declared !== actual) {
    throw new Error(
      `\`${spec.artifact}\` does not match its published digest — ${declared} vs ${actual}`
    );
  }

  return {
    headSha: String(run.head_sha),
    runId: String(runId),
    runUrl: String(run.html_url ?? ''),
    workflow: String(run.name ?? ''),
    job: String(job.id),
    jobName: String(job.name ?? ''),
    step: spec.step,
    // The one fact the JSON report cannot carry. vitest's json reporter has no
    // field for an unhandled error, so a run with three of them still reports
    // `success: true` and `numFailedTests: 0`. The step's conclusion is the
    // process's own verdict, which is the thing the ledger is meant to record.
    exitCode: step.conclusion === 'success' ? 0 : 1,
    artifact: spec.artifact,
    artifactDigest: declared || actual,
    field: spec.report,
    completedAt: String(job.completed_at ?? run.updated_at ?? ''),
    report: JSON.parse(readZipEntry(zip, spec.report).toString('utf8')),
  };
}
