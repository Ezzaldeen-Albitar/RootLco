/**
 * P1-27-QA-005 — regression and immutable evidence packaging.
 *
 * ## The defect this closes
 *
 * The independent audit put it exactly: *"no checksum/digest manifest exists
 * under docs/phase-1/phase-1-27/evidence/"*. The phase shipped twenty-five
 * evidence documents and nothing tied any of them to a byte. Any one could be
 * edited — a count corrected, a verdict softened, a superseded measurement
 * quietly refreshed — and the repository could not tell, because a Markdown
 * file that changes looks exactly like a Markdown file that was always that way.
 *
 * A phase closes on its evidence. Evidence that can be revised without leaving a
 * trace is testimony, not evidence.
 *
 * ## What the manifest is, and what it deliberately is not
 *
 * It is a SHA-256 digest of every `.md` and `.json` file in the phase directory,
 * derived by walking the tree rather than from a hand-written list — the whole
 * class of defect this phase kept hitting is a list that stops describing the
 * thing it lists. A document added without regenerating the manifest fails the
 * check as loudly as a document edited.
 *
 * It is NOT a tamper-proof seal. Anyone who edits a document can re-run this and
 * commit both. What it makes impossible is editing evidence SILENTLY: the diff
 * now carries a digest change beside the prose change, in a file whose only
 * purpose is to be looked at. That is the honest claim, and it is stated in the
 * manifest itself so no reader infers the stronger one.
 *
 * ## The manifest cannot digest itself
 *
 * A file whose content includes its own hash has no fixed point. The manifest
 * therefore excludes exactly one path — its own — and
 * `tests/ci/p1-27-evidence-manifest.test.ts` asserts that the excluded set is
 * that one path and nothing else, so "excluded" cannot quietly grow.
 *
 * Usage:  node scripts/ci/build-p1-27-evidence-manifest.mjs [--check] [--json]
 * Exit:   0 written / in sync · 1 drifted (--check) · 2 IO error.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');

export const PHASE_DIR = 'docs/phase-1/phase-1-27';
export const MANIFEST_PATH = `${PHASE_DIR}/evidence/evidence-manifest.json`;

/** Extensions that carry evidence. Binary attachments are listed, not digested. */
const DIGESTED = ['.md', '.json'];

/**
 * Every digestible file under the phase directory, repository-relative, sorted.
 *
 * Sorted because the manifest is committed: an unstable order would produce a
 * diff on every regeneration and train reviewers to skim past it, which is the
 * failure mode this file exists to prevent.
 */
export function evidenceFiles(root = ROOT) {
  const out = [];
  const walk = (rel) => {
    const entries = readdirSync(join(root, rel.split(posix.sep).join(sep)), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (DIGESTED.some((ext) => entry.name.endsWith(ext))) out.push(child);
    }
  };
  walk(PHASE_DIR);
  return out.filter((p) => p !== MANIFEST_PATH).sort();
}

/**
 * SHA-256 of a file's BYTES, not of its decoded text.
 *
 * Reading as utf8 and hashing the string would make a byte-order mark and an
 * encoding repair invisible — and this repository has shipped both by accident.
 * `validate:encoding` owns that rule; this must not quietly disagree with it.
 */
export function digest(root, relative) {
  const bytes = readFileSync(join(root, relative.split(posix.sep).join(sep)));
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

export function buildManifest(root = ROOT) {
  const files = evidenceFiles(root);
  const entries = {};
  for (const file of files) entries[file] = digest(root, file);

  return {
    task: 'P1-27-QA-005',
    what: 'SHA-256 digests of every evidence document in the P1-27 phase directory.',
    howToRegenerate: 'npm run evidence:p1-27',
    whatThisProves:
      'An evidence document cannot be edited without this file changing in the same diff. Digests are over file BYTES, so an encoding change counts as a change.',
    whatThisDoesNotProve:
      'This is not a tamper-proof seal. Anyone able to edit a document is able to re-run the generator and commit both. It removes SILENT revision, not revision.',
    selfExclusion:
      'This manifest is the only path excluded from its own digest set, because a file containing its own hash has no fixed point. tests/ci/p1-27-evidence-manifest.test.ts asserts the exclusion is exactly this one path.',
    fileCount: files.length,
    files: entries,
  };
}

/** Stable serialisation — trailing newline, so Prettier and git agree. */
export function serialise(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function main(argv) {
  const check = argv.includes('--check');
  const asJson = argv.includes('--json');
  const target = join(ROOT, MANIFEST_PATH.split(posix.sep).join(sep));

  let manifest;
  try {
    manifest = buildManifest(ROOT);
  } catch (error) {
    process.stderr.write(`::error::cannot read the P1-27 evidence tree: ${error.message}\n`);
    return 2;
  }
  const rendered = serialise(manifest);

  if (!check) {
    writeFileSync(target, rendered, 'utf8');
    process.stdout.write(`wrote ${MANIFEST_PATH} — ${manifest.fileCount} evidence documents\n`);
    return 0;
  }

  if (!existsSync(target)) {
    process.stderr.write(
      `::error::${MANIFEST_PATH} does not exist. P1-27-QA-005 requires a digest manifest; run \`npm run evidence:p1-27\`.\n`
    );
    return 1;
  }

  const committed = readFileSync(target, 'utf8');
  if (committed === rendered) {
    if (asJson) process.stdout.write(`${JSON.stringify({ ok: true, ...manifest }, null, 2)}\n`);
    else process.stdout.write(`evidence manifest in sync — ${manifest.fileCount} documents\n`);
    return 0;
  }

  // Name WHICH documents moved. "The manifest is stale" sends a reader to diff
  // twenty-five files; "task-traceability.md changed" sends them to one.
  const previous = JSON.parse(committed);
  const before = previous.files ?? {};
  const after = manifest.files;
  const added = Object.keys(after).filter((f) => !(f in before));
  const removed = Object.keys(before).filter((f) => !(f in after));
  const changed = Object.keys(after).filter(
    (f) => f in before && before[f].sha256 !== after[f].sha256
  );

  process.stderr.write(
    '::error::the P1-27 evidence manifest no longer describes the evidence. Regenerate it in the same commit as the document change: `npm run evidence:p1-27`.\n'
  );
  for (const f of changed) process.stderr.write(`  edited:  ${f}\n`);
  for (const f of added) process.stderr.write(`  added:   ${f}\n`);
  for (const f of removed) process.stderr.write(`  removed: ${f}\n`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)));
}
