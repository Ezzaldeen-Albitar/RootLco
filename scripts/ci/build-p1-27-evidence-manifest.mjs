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
 * It is a SHA-256 digest of EVERY file in the phase directory, derived by
 * walking the tree rather than from a hand-written list — the whole class of
 * defect this phase kept hitting is a list that stops describing the thing it
 * lists. A document added without regenerating the manifest fails the check as
 * loudly as a document edited.
 *
 * It is NOT a tamper-proof seal. Anyone who edits a document can re-run this and
 * commit both. What it makes impossible is editing evidence SILENTLY: the diff
 * now carries a digest change beside the prose change, in a file whose only
 * purpose is to be looked at. That is the honest claim, and it is stated in the
 * manifest itself so no reader infers the stronger one.
 *
 * ## Every file, not every file of a chosen extension (`QA005-07`)
 *
 * This used to digest an allow-list of `['.md', '.json']`, compared with
 * `endsWith`, and the docblock claimed binary attachments were "listed, not
 * digested". Both halves were wrong, and the second was worse than the first
 * because it described a behaviour that did not exist anywhere in the file:
 * nothing listed them. A `.PNG` was not listed. Neither was a `.pdf`.
 *
 * `endsWith` is also case-sensitive, so the allow-list did not even cover its own
 * extensions: `NOTES.MD` and `data.JSON` are ordinary spellings on a
 * case-insensitive filesystem, and both were invisible — not digested, not
 * listed, not counted, not mentioned. A file that the sealing mechanism cannot
 * see is the one place to put something you do not want sealed.
 *
 * The honest rule is the one with no exceptions to get wrong: digest everything.
 * A SHA-256 over a PNG is exactly as meaningful as one over Markdown, and it
 * costs nothing to take. There is now no extension test in this file at all,
 * which is why there is no longer a case-sensitivity question to answer.
 *
 * ## Reachability — a count floor cannot see a swap (`QA005-08`)
 *
 * The only structural check on the evidence SET was `> 20` documents. Eight of
 * the phase's documents could be deleted, the manifest regenerated, and every
 * case stayed green: the set shrank by a fifth and the floor never noticed,
 * because a count cannot tell you WHICH things it counted. That was reproduced
 * against this tree before it was fixed — 36 documents down to 28, gate green.
 *
 * So the set is now pinned by reference rather than by size. Every file under the
 * phase directory must be CITED from `INDEX_SET` — the phase's index, plan,
 * register and traceability record — or be named in `INTENTIONALLY_UNREFERENCED`
 * with a reason. And the inverse, which is what actually catches a deletion:
 * every in-phase path those four documents cite must resolve to a file that
 * exists. Delete a document and its citations remain, so the check fails and
 * names it.
 *
 * ## The manifest cannot digest itself
 *
 * A file whose content includes its own hash has no fixed point. The manifest
 * therefore excludes exactly one path — its own — and
 * `tests/ci/p1-27-evidence-manifest.test.ts` asserts that the excluded set is
 * that one path and nothing else, so "excluded" cannot quietly grow. It is also
 * the one path exempt from the dangling-citation check, for the same reason: the
 * index cites it and it is deliberately absent from its own file set.
 *
 * Usage:  node scripts/ci/build-p1-27-evidence-manifest.mjs [--check] [--json]
 * Exit:   0 written / in sync · 1 drifted or unreachable · 2 IO error.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');

export const PHASE_DIR = 'docs/phase-1/phase-1-27';
export const MANIFEST_PATH = `${PHASE_DIR}/evidence/evidence-manifest.json`;

/**
 * The four documents that index the phase: its deliverable manifest, its plan,
 * its task register and its evidence traceability record.
 *
 * "Reachable" means cited from one of these, not merely mentioned somewhere in
 * the tree. A document that only other loose documents mention is exactly the
 * one nobody would miss, so a mutual-mention rule would have declared the whole
 * set reachable and proved nothing — measured on this tree, "cited by ANY phase
 * document" leaves zero orphans while "cited by the index set" leaves one.
 */
export const INDEX_SET = [
  `${PHASE_DIR}/deliverable-manifest.md`,
  `${PHASE_DIR}/canonical-plan.md`,
  `${PHASE_DIR}/task-register.md`,
  `${PHASE_DIR}/evidence/task-traceability.md`,
];

/**
 * Files deliberately not cited by the index, each with the reason.
 *
 * This is an escape hatch and it is meant to be read as one: an entry here is a
 * standing claim that a document belongs in the sealed set while belonging to no
 * index, and the reason has to survive somebody asking about it. It is keyed by
 * path so an entry cannot outlive the file it excuses — `reachability` reports a
 * declaration naming a file that is not there.
 */
export const INTENTIONALLY_UNREFERENCED = {
  [`${PHASE_DIR}/continuation-checkpoint.md`]:
    'A handover note addressed to the next execution session, not a phase deliverable. It cites the index; the index deliberately does not cite it, because a checkpoint indexed by the deliverable manifest would be presented as evidence OF the phase rather than of a session. It is sealed because it is in the tree, and it is unindexed because it is not a deliverable.',
};

/**
 * A symlink inside the evidence tree is REFUSED (`QA005-12`).
 *
 * `Dirent.isDirectory()` is FALSE for a symlink that points at a directory:
 * `readdir` reports the link, not its target. So `if (entry.isDirectory())` does
 * not recurse into it, the extension test then rejects it as a file, and every
 * document beyond it is silently absent from a manifest whose entire claim is
 * that it covers everything. The re-walk in
 * `tests/ci/p1-27-evidence-manifest.test.ts` was written to be INDEPENDENT and
 * shared the same blind spot, so the two would have agreed about a tree neither
 * had read.
 *
 * Following the link instead is not the safer option here: a link can point
 * outside the phase directory or at an ancestor, and a digest manifest that
 * silently covers files from elsewhere is worse than one that stops.
 *
 * So this throws, `main()` turns it into exit 2, and the reader is told the
 * path. Every walker in this phase now applies the same policy.
 */
export function assertNotSymlink(entry, path) {
  if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
    throw new Error(
      `${path} is a symbolic link. The P1-27 evidence walkers refuse symlinks: a link is ` +
        'invisible to `isDirectory()`, so everything beyond it would be missing from the ' +
        'manifest with nothing to say so.'
    );
  }
}

/**
 * EVERY file under the phase directory, repository-relative, sorted.
 *
 * No extension test: see the `QA005-07` note in the file docblock. Whatever is in
 * the tree is in the manifest, so there is no spelling of a filename that makes a
 * file invisible to the seal.
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
      else {
        assertNotSymlink(entry, child);
        out.push(child);
      }
    }
  };
  walk(PHASE_DIR);
  return out.filter((p) => p !== MANIFEST_PATH).sort();
}

const escapeForRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every in-phase path a document cites, repository-relative.
 *
 * Two citation forms are recognised, because the phase uses both and a rule that
 * saw only one would have been a reachability check that mostly measured
 * formatting. Markdown links are the obvious form; measured against this tree
 * they are also the rare one — the index cites just five in-phase documents by
 * link and thirty-six by full repository-relative path in backticks or prose. A
 * link-only rule would have reported twenty-seven orphans that are all, in fact,
 * cited.
 *
 * Bare basenames are deliberately NOT a citation. `findings.md` names a file in
 * half the phases in this repository, and accepting it would let a document be
 * "reached" by a sentence about something else.
 */
export function citationsFrom(root, relative) {
  const text = readFileSync(join(root, relative.split(posix.sep).join(sep)), 'utf8');
  const dir = posix.dirname(relative);
  const found = new Set();

  for (const [, raw] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = raw.split('#')[0];
    if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;
    const resolved = posix.normalize(target.startsWith('docs/') ? target : posix.join(dir, target));
    if (resolved.startsWith(`${PHASE_DIR}/`)) found.add(resolved);
  }

  const qualified = new RegExp(
    `${escapeForRegExp(PHASE_DIR)}/[A-Za-z0-9._/-]+\\.[A-Za-z0-9]+`,
    'g'
  );
  for (const [match] of text.matchAll(qualified)) found.add(posix.normalize(match));

  return [...found].sort();
}

/**
 * Reachability of the sealed set, in both directions.
 *
 * `orphans` — sealed but cited by no index document and not declared. A document
 * nothing points at is one that can be swapped for another and never be missed.
 *
 * `dangling` — cited by an index document but not present. This is the half that
 * catches a DELETION, and it is the reason the check is not simply "is the count
 * still large enough": removing a file does not remove the sentences that name
 * it, so the citation outlives the document and says so.
 *
 * `staleDeclarations` — an `INTENTIONALLY_UNREFERENCED` entry whose file is gone,
 * so an exemption cannot quietly outlive the thing it exempted.
 */
export function reachability(root = ROOT) {
  const present = new Set(evidenceFiles(root));
  const cited = new Map();
  for (const index of INDEX_SET) {
    for (const target of citationsFrom(root, index)) {
      if (!cited.has(target)) cited.set(target, []);
      cited.get(target).push(index);
    }
  }

  const declared = Object.keys(INTENTIONALLY_UNREFERENCED);
  const orphans = [...present].filter(
    (file) => !INDEX_SET.includes(file) && !cited.has(file) && !declared.includes(file)
  );
  // The manifest is cited by the index and is deliberately absent from its own
  // file set; that is the one exemption, and it is the same one as above.
  const dangling = [...cited.keys()].filter(
    (target) => target !== MANIFEST_PATH && !present.has(target)
  );
  const staleDeclarations = declared.filter((file) => !present.has(file));

  return {
    orphans: orphans.sort(),
    dangling: dangling.sort(),
    staleDeclarations: staleDeclarations.sort(),
    citedBy: cited,
  };
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

/**
 * Report a digest set that is not SHA-256. Returns true when it is sound.
 *
 * `--check` compares the regenerated manifest with the committed one, so it is
 * structurally blind to a change in the DIGEST FUNCTION: mutate the hash and both
 * sides mutate together, byte-for-byte in sync, and the gate reports success. It
 * did — with every digest truncated to sixteen bytes, and again with all
 * thirty-six replaced by one constant.
 *
 * The shape is therefore checked directly. 64 lower-case hex characters is
 * SHA-256 and nothing else, and thirty-six distinct documents cannot share a
 * digest unless the digest is not a function of their bytes.
 */
function reportDigestShape(manifest) {
  const entries = Object.entries(manifest.files);
  const malformed = entries.filter(([, e]) => !/^[0-9a-f]{64}$/.test(e.sha256));
  if (malformed.length > 0) {
    process.stderr.write(
      '::error::the manifest records digests that are not SHA-256 (64 lower-case hex characters). The digest function has been changed.\n'
    );
    for (const [file, e] of malformed.slice(0, 10)) {
      process.stderr.write(`  ${file}: ${e.sha256.length} characters\n`);
    }
    return false;
  }
  const distinct = new Set(entries.map(([, e]) => e.sha256));
  if (entries.length > 1 && distinct.size !== entries.length) {
    process.stderr.write(
      `::error::${entries.length} documents share ${distinct.size} digests. A digest that repeats across different files is not a hash of their bytes.\n`
    );
    return false;
  }
  return true;
}

/**
 * Report reachability violations. Returns true when the set is sound.
 *
 * Applied in BOTH modes on purpose. The writer is where a document is added or
 * removed, so it is the moment a reader can still act; deferring the complaint to
 * `--check` would mean the first report of a deleted document arrives in CI,
 * attached to whoever pushed next.
 */
function reportReachability(root) {
  let sound = true;
  const { orphans, dangling, staleDeclarations } = reachability(root);

  if (dangling.length > 0) {
    sound = false;
    process.stderr.write(
      '::error::the P1-27 index cites evidence documents that are not in the tree. A document was deleted or renamed and the documents that name it were not updated.\n'
    );
    for (const f of dangling) process.stderr.write(`  cited but absent: ${f}\n`);
  }
  if (orphans.length > 0) {
    sound = false;
    process.stderr.write(
      `::error::evidence documents that no index document cites. Cite each from one of ${INDEX_SET.join(', ')}, or declare it in INTENTIONALLY_UNREFERENCED with a reason.\n`
    );
    for (const f of orphans) process.stderr.write(`  unreferenced: ${f}\n`);
  }
  if (staleDeclarations.length > 0) {
    sound = false;
    process.stderr.write(
      '::error::INTENTIONALLY_UNREFERENCED declares a file that is not in the tree. Remove the declaration with the file.\n'
    );
    for (const f of staleDeclarations) process.stderr.write(`  stale declaration: ${f}\n`);
  }
  return sound;
}

function main(argv) {
  const check = argv.includes('--check');
  const asJson = argv.includes('--json');
  const target = join(ROOT, MANIFEST_PATH.split(posix.sep).join(sep));

  let manifest;
  let sound;
  try {
    manifest = buildManifest(ROOT);
    // Both run before either verdict is used, so one failure does not hide another.
    const shapeOk = reportDigestShape(manifest);
    const reachableOk = reportReachability(ROOT);
    sound = shapeOk && reachableOk;
  } catch (error) {
    process.stderr.write(`::error::cannot read the P1-27 evidence tree: ${error.message}\n`);
    return 2;
  }
  const rendered = serialise(manifest);

  if (!check) {
    // Written before the reachability verdict is applied: the manifest is what
    // lets a reader see what actually changed, and withholding it because the
    // set is unsound would hide the evidence for the complaint.
    writeFileSync(target, rendered, 'utf8');
    process.stdout.write(`wrote ${MANIFEST_PATH} — ${manifest.fileCount} evidence documents\n`);
    return sound ? 0 : 1;
  }

  if (!existsSync(target)) {
    process.stderr.write(
      `::error::${MANIFEST_PATH} does not exist. P1-27-QA-005 requires a digest manifest; run \`npm run evidence:p1-27\`.\n`
    );
    return 1;
  }

  const committed = readFileSync(target, 'utf8');
  if (committed === rendered) {
    if (!sound) return 1;
    if (asJson) process.stdout.write(`${JSON.stringify({ ok: true, ...manifest }, null, 2)}\n`);
    else
      process.stdout.write(
        `evidence manifest in sync — ${manifest.fileCount} documents, every one reachable\n`
      );
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
