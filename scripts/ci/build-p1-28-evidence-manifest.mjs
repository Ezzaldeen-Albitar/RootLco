/**
 * P1-28-QA-005 — regression and immutable evidence packaging.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is a SHA-256 digest of EVERY file in the P1-28 phase directory, derived by
 * walking the tree rather than from a hand-written list, plus the bindings that
 * make those digests mean something: the frozen code candidate, the tier
 * measurements taken against it, and the tasks this phase could not close.
 *
 * It is NOT a tamper-proof seal. Anyone who edits a document can re-run this and
 * commit both. What it makes impossible is editing evidence SILENTLY: the diff
 * carries a digest change beside the prose change, in a file whose only purpose
 * is to be looked at. That is the honest claim, and it is stated in the manifest
 * itself so no reader infers the stronger one.
 *
 * ## Why this is not a copy of its P1-27 sibling
 *
 * `build-p1-27-evidence-manifest.mjs` seals a document set. That is necessary
 * and it was not sufficient here, because P1-28's closing package makes two
 * claims a digest cannot check:
 *
 *   1. **that every figure describes ONE named commit.** P1-27 shipped a closing
 *      page pinning a head 47 commits behind the tree it described, and it went
 *      on reading like evidence because nothing compared the claim with the
 *      repository. So the candidate is recorded as DATA in
 *      `closure-candidate.json`, restated in prose in `closure-evidence.md`, and
 *      `reportCandidate` refuses a disagreement between the two. Two documents
 *      that must agree cannot be half-updated.
 *
 *   2. **that the package names every task the phase could not close.** This is
 *      the rule that matters most to the reader it is written for. The Product
 *      Owner is being asked to accept a phase with three unclosed rows, and the
 *      failure mode is not a wrong number — it is a row that quietly stops being
 *      mentioned. So the blocked set is DERIVED from
 *      `task-matrix-verdicts.json` at check time, never listed here: any task
 *      whose verdict is not PASS must be named in both halves of the package,
 *      each with a blocker and an owner. Flip a fourth task to PARTIAL and this
 *      gate fails until the package says so.
 *
 * ## Every file, not every file of a chosen extension
 *
 * There is no extension test in this file. A SHA-256 over a PNG is exactly as
 * meaningful as one over Markdown and costs nothing to take, and an allow-list
 * compared with `endsWith` is case-sensitive — `NOTES.MD` is an ordinary
 * spelling on this filesystem and would have been invisible to the seal. A file
 * the sealing mechanism cannot see is the one place to put something you do not
 * want sealed.
 *
 * ## The manifest cannot digest itself
 *
 * A file whose content includes its own hash has no fixed point. The manifest
 * excludes exactly one path — its own — and
 * `tests/ci/p1-28-evidence-manifest.test.ts` asserts the excluded set is that
 * one path and nothing else, so "excluded" cannot quietly grow. It is also the
 * one path exempt from the dangling-citation check, for the same reason.
 *
 * ## The gate proves it can fail before it reports that it passed
 *
 * Every rule is applied in exactly one function, `judge`, and `main` drives that
 * function over a table of known-bad inputs before it looks at the tree. The
 * reason is recorded in the P1-27 sibling and is inherited here: three separate
 * rules were once stubbed out by an adversarial pass and that validator exited 0
 * each time, because no test named them and the real tree was sound — so a rule
 * that always passes and a rule that works are the same observation. See
 * `selfCheck`.
 *
 * Usage:  node scripts/ci/build-p1-28-evidence-manifest.mjs [--check] [--json]
 * Exit:   0 written / in sync · 1 drifted, unreachable, unbound or self-check
 *         failed · 2 IO error.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');

export const PHASE_DIR = 'docs/phase-1/phase-1-28';
export const MANIFEST_PATH = `${PHASE_DIR}/evidence/evidence-manifest.json`;
export const CANDIDATE_PATH = `${PHASE_DIR}/evidence/closure-candidate.json`;
export const PACKAGE_PATH = `${PHASE_DIR}/evidence/closure-evidence.md`;
export const VERDICTS_PATH = `${PHASE_DIR}/task-matrix-verdicts.json`;

/**
 * The documents that index the phase: its canonical plan, its traceability
 * record, and the closing package itself.
 *
 * "Reachable" means cited from one of these, not merely mentioned somewhere in
 * the tree. A document that only other loose documents mention is exactly the
 * one nobody would miss, so a mutual-mention rule would declare the whole set
 * reachable and prove nothing.
 *
 * P1-28 has no `deliverable-manifest.md` or `task-register.md` — the two
 * indexes its P1-27 sibling leans on — because this phase derives its universe
 * from `canonical-plan.md` instead of maintaining a register beside it. The
 * closing package therefore carries the indexing duty those documents carried,
 * which is why it cites every file in the phase directory by path.
 */
export const INDEX_SET = [
  `${PHASE_DIR}/canonical-plan.md`,
  `${PHASE_DIR}/evidence/traceability.md`,
  PACKAGE_PATH,
];

/**
 * Files deliberately not cited by the index, each with the reason.
 *
 * An escape hatch, meant to be read as one: an entry here is a standing claim
 * that a document belongs in the sealed set while belonging to no index, and the
 * reason has to survive somebody asking about it. Keyed by path so an entry
 * cannot outlive the file it excuses — `reachability` reports a declaration
 * naming a file that is not there.
 *
 * It is EMPTY today, and that is the honest state: the closing package cites
 * every one of the phase's files by repository-relative path, so nothing needs
 * excusing. It is kept because the alternative to an empty escape hatch is an
 * undeclared one.
 */
export const INTENTIONALLY_UNREFERENCED = {};

/**
 * A symlink inside the evidence tree is REFUSED.
 *
 * `Dirent.isDirectory()` is FALSE for a symlink that points at a directory:
 * `readdir` reports the link, not its target. So `if (entry.isDirectory())` does
 * not recurse into it and every document beyond it is silently absent from a
 * manifest whose entire claim is that it covers everything.
 *
 * Following the link instead is not the safer option: a link can point outside
 * the phase directory or at an ancestor, and a digest manifest that silently
 * covers files from elsewhere is worse than one that stops. So this throws,
 * `main()` turns it into exit 2, and the reader is told the path.
 */
export function assertNotSymlink(entry, path) {
  if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
    throw new Error(
      `${path} is a symbolic link. The P1-28 evidence walker refuses symlinks: a link is ` +
        'invisible to `isDirectory()`, so everything beyond it would be missing from the ' +
        'manifest with nothing to say so.'
    );
  }
}

/**
 * EVERY file under the phase directory, repository-relative, sorted.
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
 * saw only one would be a reachability check that mostly measured formatting.
 *
 * Bare basenames are deliberately NOT a citation. `change-log.md` names a file
 * in four phases of this repository, and accepting it would let a document be
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
 * `staleDeclarations` — an `INTENTIONALLY_UNREFERENCED` entry whose file is
 * gone, so an exemption cannot quietly outlive the thing it exempted.
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
  // The manifest is cited by the package and is deliberately absent from its own
  // file set; that is the one exemption.
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

const readJson = (root, relative) =>
  JSON.parse(readFileSync(join(root, relative.split(posix.sep).join(sep)), 'utf8'));

const readText = (root, relative) =>
  readFileSync(join(root, relative.split(posix.sep).join(sep)), 'utf8');

/**
 * The candidate binding, and whether the package's two halves agree about it.
 *
 * Returns an ANALYSIS rather than a verdict, for the same reason `reachability`
 * does: the rule has to be exercisable against a state that is not on disk. A
 * rule that can only be driven by mutating the repository is a rule nobody
 * drives.
 */
export function candidateBinding(root = ROOT) {
  const candidate = readJson(root, CANDIDATE_PATH).candidate ?? {};
  const prose = readText(root, PACKAGE_PATH);
  const sha = candidate.FINAL_CODE_SHA ?? '';
  const tree = candidate.FINAL_CODE_TREE ?? '';

  return {
    sha,
    tree,
    shaWellFormed: /^[0-9a-f]{40}$/.test(sha),
    treeWellFormed: /^[0-9a-f]{40}$/.test(tree),
    // The prose half must carry the SAME forty characters. A short prefix would
    // let two different commits satisfy the same sentence, which is how a
    // superseded head gets presented as current.
    shaInProse: sha.length === 40 && prose.includes(sha),
    treeInProse: tree.length === 40 && prose.includes(tree),
  };
}

/**
 * Every task the phase could not close, derived from the verdicts file, and
 * whether both halves of the package name each one.
 *
 * DERIVED, never listed. A hand-written list of blocked tasks cannot fail
 * because something was never added to it, which is precisely the failure this
 * rule exists to prevent: the Owner reads the package to learn what is unclosed,
 * and a row that stops being mentioned reads exactly like a row that closed.
 */
export function blockerCoverage(root = ROOT) {
  const verdicts = readJson(root, VERDICTS_PATH);
  const declared = readJson(root, CANDIDATE_PATH).blockedTasks ?? {};
  const prose = readText(root, PACKAGE_PATH);

  const unclosed = Object.entries(verdicts)
    .filter(([, row]) => row?.FINAL_VERDICT !== 'PASS')
    .map(([id]) => id)
    .sort();

  const missingFromData = unclosed.filter((id) => !(id in declared));
  const missingFromProse = unclosed.filter((id) => !prose.includes(id));
  // An entry that names a task which is no longer unclosed is the inverse
  // failure: the package would go on presenting a closed row as blocked.
  const staleEntries = Object.keys(declared)
    .filter((id) => !unclosed.includes(id))
    .sort();
  // A blocker with no owner is an item nobody has been asked to answer.
  const withoutOwner = unclosed.filter(
    (id) => id in declared && !(declared[id]?.owner ?? '').trim()
  );
  const withoutBlocker = unclosed.filter(
    (id) => id in declared && !(declared[id]?.blocker ?? '').trim()
  );

  return {
    unclosed,
    missingFromData,
    missingFromProse,
    staleEntries,
    withoutOwner,
    withoutBlocker,
  };
}

export function buildManifest(root = ROOT) {
  const files = evidenceFiles(root);
  const entries = {};
  for (const file of files) entries[file] = digest(root, file);

  const candidateFile = readJson(root, CANDIDATE_PATH);
  const candidate = candidateFile.candidate ?? {};
  const tiers = candidateFile.tiers ?? {};

  return {
    task: 'P1-28-QA-005',
    what: 'SHA-256 digests of every evidence document in the P1-28 phase directory, bound to the phase closing candidate.',
    howToRegenerate: 'npm run evidence:p1-28',
    whatThisProves:
      'An evidence document cannot be edited without this file changing in the same diff. Digests are over file BYTES, so an encoding change counts as a change.',
    whatThisDoesNotProve:
      'This is not a tamper-proof seal. Anyone able to edit a document is able to re-run the generator and commit both. It removes SILENT revision, not revision.',
    selfExclusion:
      'This manifest is the only path excluded from its own digest set, because a file containing its own hash has no fixed point. tests/ci/p1-28-evidence-manifest.test.ts asserts the exclusion is exactly this one path.',
    candidate: {
      FINAL_CODE_SHA: candidate.FINAL_CODE_SHA ?? null,
      FINAL_CODE_TREE: candidate.FINAL_CODE_TREE ?? null,
      pullRequest: candidate.pullRequest ?? null,
      recordedIn: CANDIDATE_PATH,
      restatedIn: PACKAGE_PATH,
    },
    tierTotals: Object.fromEntries(
      Object.entries(tiers).map(([name, tier]) => [
        name,
        {
          passed: tier.passed ?? null,
          failed: tier.failed ?? null,
          skipped: tier.skipped ?? null,
          provenance: tier.provenance ?? null,
        },
      ])
    ),
    fileCount: files.length,
    files: entries,
  };
}

/** Stable serialisation — trailing newline, so Prettier and git agree. */
export function serialise(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/* ------------------------------------------------------------------ *
 * Verdicts, and why they are all applied in exactly one place
 *
 * Inherited from the P1-27 sibling, where an adversarial pass defeated the
 * validator three ways and it exited 0 every time: two reporters replaced with
 * the literal `true`, and `digest()` mutated to hash the file's PATH instead of
 * its bytes — after which the manifest regenerated cleanly, because path digests
 * are also 64 hex characters and also all distinct.
 *
 * The first two were one defect: neither reporter was exported, no test named
 * either, and the real tree was sound, so a rule that always returns true and a
 * rule that works produced identical output. A check that has never failed is
 * not known to be a check.
 *
 * So every rule is applied in exactly one place, `judge`, and `judge` runs TWICE
 * on every invocation: once over the real tree, and once over a table of
 * known-bad inputs it is required to reject (`selfCheck`, run first in `main`).
 *
 * The third needs a different answer — an oracle that does not call the code it
 * is checking. That is `verifyDigestBytes`.
 * ------------------------------------------------------------------ */

/**
 * Where a verdict's complaint goes. Swapped for a collector by `selfCheck`.
 *
 * @type {(line: string) => void}
 */
const toStderr = (line) => {
  process.stderr.write(line);
};

/**
 * Every recorded digest, recomputed from the file's bytes WITHOUT `digest()`.
 *
 * `--check` compares a regenerated manifest against the committed one, so it is
 * structurally blind to a change in the digest FUNCTION: mutate the hash and
 * both sides mutate together, byte-for-byte in sync, and the gate reports
 * success. The shape rule below closes half of that — it catches a digest that
 * stopped LOOKING like SHA-256 — and it cannot close the other half, because a
 * SHA-256 of the wrong input looks exactly like a SHA-256 of the right one.
 *
 * Duplicating `createHash('sha256')` here is deliberate and must stay
 * duplicated. An oracle that calls the function it is checking is `f(x) === f(x)`.
 */
export function verifyDigestBytes(root, manifest) {
  const problems = [];
  for (const [file, entry] of Object.entries(manifest.files ?? {})) {
    const bytes = readFileSync(join(root, file.split(posix.sep).join(sep)));
    const expected = createHash('sha256').update(bytes).digest('hex');
    if (entry.sha256 !== expected) {
      problems.push(`${file}: the manifest records ${entry.sha256}; its bytes hash to ${expected}`);
    } else if (entry.bytes !== bytes.length) {
      problems.push(
        `${file}: the manifest records ${entry.bytes} bytes; the file holds ${bytes.length}`
      );
    }
  }
  return problems;
}

/**
 * Report a digest set that is not SHA-256. Returns true when it is sound.
 *
 * 64 lower-case hex characters is SHA-256 and nothing else, and distinct
 * documents cannot share a digest unless the digest is not a function of their
 * bytes.
 */
export function reportDigestShape(manifest, write = toStderr) {
  const entries = Object.entries(manifest.files ?? {});
  const malformed = entries.filter(([, e]) => !/^[0-9a-f]{64}$/.test(e.sha256));
  if (malformed.length > 0) {
    write(
      '::error::the manifest records digests that are not SHA-256 (64 lower-case hex characters). The digest function has been changed.\n'
    );
    for (const [file, e] of malformed.slice(0, 10)) {
      write(`  ${file}: ${String(e.sha256).length} characters\n`);
    }
    return false;
  }
  const distinct = new Set(entries.map(([, e]) => e.sha256));
  if (entries.length > 1 && distinct.size !== entries.length) {
    write(
      `::error::${entries.length} documents share ${distinct.size} digests. A digest that repeats across different files is not a hash of their bytes.\n`
    );
    return false;
  }
  return true;
}

/** Report digests that are not a hash of the bytes. Returns true when sound. */
export function reportDigestBytes(mismatches, write = toStderr) {
  if (mismatches.length === 0) return true;
  write(
    '::error::a recorded digest is not the SHA-256 of the file it names. The digest function no longer hashes the bytes, or the manifest was written against a different tree.\n'
  );
  for (const problem of mismatches.slice(0, 10)) write(`  ${problem}\n`);
  return false;
}

/**
 * Report reachability violations. Returns true when the set is sound.
 *
 * Applied in BOTH modes on purpose. The writer is where a document is added or
 * removed, so it is the moment a reader can still act; deferring the complaint
 * to `--check` would mean the first report of a deleted document arrives in CI,
 * attached to whoever pushed next.
 */
export function reportReachability(analysis, write = toStderr) {
  let sound = true;
  const { orphans, dangling, staleDeclarations } = analysis;

  if (dangling.length > 0) {
    sound = false;
    write(
      '::error::the P1-28 index cites evidence documents that are not in the tree. A document was deleted or renamed and the documents that name it were not updated.\n'
    );
    for (const f of dangling) write(`  cited but absent: ${f}\n`);
  }
  if (orphans.length > 0) {
    sound = false;
    write(
      `::error::evidence documents that no index document cites. Cite each from one of ${INDEX_SET.join(', ')}, or declare it in INTENTIONALLY_UNREFERENCED with a reason.\n`
    );
    for (const f of orphans) write(`  unreferenced: ${f}\n`);
  }
  if (staleDeclarations.length > 0) {
    sound = false;
    write(
      '::error::INTENTIONALLY_UNREFERENCED declares a file that is not in the tree. Remove the declaration with the file.\n'
    );
    for (const f of staleDeclarations) write(`  stale declaration: ${f}\n`);
  }
  return sound;
}

/**
 * Report a candidate the package does not agree with itself about.
 *
 * The failure this catches is a HALF-UPDATE: somebody re-freezes the candidate,
 * edits the JSON, and leaves the prose naming the old commit — or the reverse.
 * Both halves then read like evidence and one of them is describing a tree
 * nobody measured.
 */
export function reportCandidate(binding, write = toStderr) {
  let sound = true;
  if (!binding.shaWellFormed) {
    sound = false;
    write(
      `::error::${CANDIDATE_PATH} records FINAL_CODE_SHA \`${binding.sha}\`, which is not a 40-character commit id. A candidate that names no commit binds nothing.\n`
    );
  }
  if (!binding.treeWellFormed) {
    sound = false;
    write(
      `::error::${CANDIDATE_PATH} records FINAL_CODE_TREE \`${binding.tree}\`, which is not a 40-character tree id.\n`
    );
  }
  if (binding.shaWellFormed && !binding.shaInProse) {
    sound = false;
    write(
      `::error::${PACKAGE_PATH} does not state the candidate SHA ${binding.sha} that ${CANDIDATE_PATH} records. The two halves of the package describe different commits.\n`
    );
  }
  if (binding.treeWellFormed && !binding.treeInProse) {
    sound = false;
    write(
      `::error::${PACKAGE_PATH} does not state the candidate tree ${binding.tree} that ${CANDIDATE_PATH} records.\n`
    );
  }
  return sound;
}

/**
 * Report an unclosed task the package fails to name. Returns true when sound.
 *
 * This is the rule written for the Product Owner. Everything else here protects
 * a figure; this protects the sentence that says what was not delivered.
 */
export function reportBlockers(coverage, write = toStderr) {
  let sound = true;
  const { missingFromData, missingFromProse, staleEntries, withoutOwner, withoutBlocker } =
    coverage;

  if (missingFromData.length > 0) {
    sound = false;
    write(
      `::error::${VERDICTS_PATH} carries tasks that did not close, and ${CANDIDATE_PATH} does not name them. A blocked task the package omits reads exactly like a task that closed.\n`
    );
    for (const id of missingFromData) write(`  unclosed and unnamed: ${id}\n`);
  }
  if (missingFromProse.length > 0) {
    sound = false;
    write(
      `::error::${PACKAGE_PATH} does not name every unclosed task. The Owner reads this document to learn what is outstanding.\n`
    );
    for (const id of missingFromProse) write(`  unclosed and unnamed in prose: ${id}\n`);
  }
  if (staleEntries.length > 0) {
    sound = false;
    write(
      `::error::${CANDIDATE_PATH} names blocked tasks that are no longer unclosed. A closed row presented as blocked is as wrong as the reverse.\n`
    );
    for (const id of staleEntries) write(`  no longer unclosed: ${id}\n`);
  }
  if (withoutBlocker.length > 0) {
    sound = false;
    write('::error::an unclosed task is recorded with no blocker.\n');
    for (const id of withoutBlocker) write(`  no blocker: ${id}\n`);
  }
  if (withoutOwner.length > 0) {
    sound = false;
    write(
      '::error::an unclosed task is recorded with no owner. A blocker nobody owns is an item nobody has been asked to answer.\n'
    );
    for (const id of withoutOwner) write(`  no owner: ${id}\n`);
  }
  return sound;
}

/**
 * The ONLY place a verdict is taken. Every rule fires here or nowhere.
 *
 * All five run before the aggregate is formed, so one failure does not hide
 * another — a reader fixing a deleted citation should not then discover the
 * digest function was also wrong.
 */
export function judge(inputs, write = toStderr) {
  const shapeOk = reportDigestShape(inputs.manifest, write);
  const bytesOk = reportDigestBytes(inputs.digestMismatches, write);
  const reachableOk = reportReachability(inputs.reachability, write);
  const candidateOk = reportCandidate(inputs.candidate, write);
  const blockersOk = reportBlockers(inputs.blockers, write);
  return {
    shapeOk,
    bytesOk,
    reachableOk,
    candidateOk,
    blockersOk,
    sound: shapeOk && bytesOk && reachableOk && candidateOk && blockersOk,
  };
}

/* ------------------------------------------------------------------ *
 * The self-check
 * ------------------------------------------------------------------ */

/** 64 lower-case hex characters, distinct per tag. A well-formed fake digest. */
const wellFormed = (tag) => String(tag).padStart(64, 'a');
/** 40 lower-case hex characters. A well-formed fake commit id. */
const fakeSha = (tag) => String(tag).padStart(40, 'b');

const SOUND_REACHABILITY = { orphans: [], dangling: [], staleDeclarations: [] };
const SOUND_MANIFEST = {
  files: {
    'a.md': { sha256: wellFormed(1), bytes: 1 },
    'b.md': { sha256: wellFormed(2), bytes: 2 },
  },
};
const SOUND_CANDIDATE = {
  sha: fakeSha(1),
  tree: fakeSha(2),
  shaWellFormed: true,
  treeWellFormed: true,
  shaInProse: true,
  treeInProse: true,
};
const SOUND_BLOCKERS = {
  unclosed: ['FE-007'],
  missingFromData: [],
  missingFromProse: [],
  staleEntries: [],
  withoutOwner: [],
  withoutBlocker: [],
};

const inputs = (over = {}) => ({
  manifest: SOUND_MANIFEST,
  digestMismatches: [],
  reachability: SOUND_REACHABILITY,
  candidate: SOUND_CANDIDATE,
  blockers: SOUND_BLOCKERS,
  ...over,
});

/**
 * Inputs `judge` is REQUIRED to reject, and one it is required to accept.
 *
 * Each is expressed as data rather than as a sentence about the code. `expects`
 * names the flag that must go false: a case that only asserted `sound` would be
 * satisfied by any rule failing, so stubbing one rule while another fired would
 * still look correct.
 *
 * `explains` is the second half. A rule that returns false and prints nothing
 * fails CI with no way to act on it, and this repository has shipped that.
 */
export const SELF_CHECK_CASES = [
  {
    name: 'a sound manifest, a sound set, a bound candidate',
    inputs: inputs(),
    expects: {
      shapeOk: true,
      bytesOk: true,
      reachableOk: true,
      candidateOk: true,
      blockersOk: true,
      sound: true,
    },
    explains: false,
  },
  {
    name: 'a truncated digest',
    inputs: inputs({ manifest: { files: { 'a.md': { sha256: 'abcdef0123456789', bytes: 1 } } } }),
    expects: { shapeOk: false, sound: false },
    explains: true,
  },
  {
    name: 'an upper-case digest',
    inputs: inputs({
      manifest: { files: { 'a.md': { sha256: wellFormed(1).toUpperCase(), bytes: 1 } } },
    }),
    expects: { shapeOk: false, sound: false },
    explains: true,
  },
  {
    name: 'one constant digest across two documents',
    inputs: inputs({
      manifest: {
        files: {
          'a.md': { sha256: wellFormed(1), bytes: 1 },
          'b.md': { sha256: wellFormed(1), bytes: 2 },
        },
      },
    }),
    expects: { shapeOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a digest that is not a hash of the bytes',
    inputs: inputs({ digestMismatches: ['a.md: the manifest records …; its bytes hash to …'] }),
    expects: { bytesOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a cited document that was deleted',
    inputs: inputs({
      reachability: { ...SOUND_REACHABILITY, dangling: [`${PHASE_DIR}/contract-archaeology.md`] },
    }),
    expects: { reachableOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a document no index cites',
    inputs: inputs({
      reachability: { ...SOUND_REACHABILITY, orphans: [`${PHASE_DIR}/smuggled.md`] },
    }),
    expects: { reachableOk: false, sound: false },
    explains: true,
  },
  {
    name: 'an exemption that outlived its file',
    inputs: inputs({
      reachability: { ...SOUND_REACHABILITY, staleDeclarations: [`${PHASE_DIR}/gone.md`] },
    }),
    expects: { reachableOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a candidate SHA that names no commit',
    inputs: inputs({
      candidate: { ...SOUND_CANDIDATE, sha: 'HEAD', shaWellFormed: false, shaInProse: false },
    }),
    expects: { candidateOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a candidate the prose half does not state',
    inputs: inputs({ candidate: { ...SOUND_CANDIDATE, shaInProse: false } }),
    expects: { candidateOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a candidate tree the prose half does not state',
    inputs: inputs({ candidate: { ...SOUND_CANDIDATE, treeInProse: false } }),
    expects: { candidateOk: false, sound: false },
    explains: true,
  },
  {
    name: 'an unclosed task the package data does not name',
    inputs: inputs({ blockers: { ...SOUND_BLOCKERS, missingFromData: ['FE-012'] } }),
    expects: { blockersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'an unclosed task the prose does not name',
    inputs: inputs({ blockers: { ...SOUND_BLOCKERS, missingFromProse: ['FE-018'] } }),
    expects: { blockersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a closed task still presented as blocked',
    inputs: inputs({ blockers: { ...SOUND_BLOCKERS, staleEntries: ['QA-005'] } }),
    expects: { blockersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a blocker nobody owns',
    inputs: inputs({ blockers: { ...SOUND_BLOCKERS, withoutOwner: ['FE-007'] } }),
    expects: { blockersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'an unclosed task recorded with no blocker',
    inputs: inputs({ blockers: { ...SOUND_BLOCKERS, withoutBlocker: ['FE-007'] } }),
    expects: { blockersOk: false, sound: false },
    explains: true,
  },
];

/**
 * Drive `judge` over the known-bad table. Returns the ways it failed to fail.
 *
 * This is what makes every rule above load-bearing. It is not a test — it runs
 * inside the gate, on every invocation, in CI and locally, because the mutation
 * that defeated the P1-27 validator was made to the gate and the gate is what
 * has to notice.
 */
export function selfCheck(cases = SELF_CHECK_CASES) {
  const failures = [];
  for (const kase of cases) {
    const said = [];
    const verdict = judge(kase.inputs, (line) => said.push(line));
    for (const [flag, want] of Object.entries(kase.expects)) {
      if (verdict[flag] !== want) {
        failures.push(
          `${kase.name}: judge() reported ${flag} = ${verdict[flag]}, expected ${want}`
        );
      }
    }
    if (said.length > 0 !== kase.explains) {
      failures.push(
        kase.explains
          ? `${kase.name}: rejected and printed nothing a reader could act on`
          : `${kase.name}: is sound and was complained about anyway`
      );
    }
  }
  return failures;
}

function main(argv) {
  const check = argv.includes('--check');
  const asJson = argv.includes('--json');
  const target = join(ROOT, MANIFEST_PATH.split(posix.sep).join(sep));

  const selfFailures = selfCheck();
  if (selfFailures.length > 0) {
    process.stderr.write(
      '::error::the P1-28 evidence validator failed its own self-check: a rule accepted an input it is required to reject. A guard that cannot fail is not a guard, and every verdict below it is worthless.\n'
    );
    for (const failure of selfFailures) process.stderr.write(`  ${failure}\n`);
    return 1;
  }

  let manifest;
  let sound;
  try {
    manifest = buildManifest(ROOT);
    sound = judge({
      manifest,
      digestMismatches: verifyDigestBytes(ROOT, manifest),
      reachability: reachability(ROOT),
      candidate: candidateBinding(ROOT),
      blockers: blockerCoverage(ROOT),
    }).sound;
  } catch (error) {
    process.stderr.write(`::error::cannot read the P1-28 evidence tree: ${error.message}\n`);
    return 2;
  }
  const rendered = serialise(manifest);

  if (!check) {
    // Written before the verdict is applied: the manifest is what lets a reader
    // see what actually changed, and withholding it because the set is unsound
    // would hide the evidence for the complaint.
    writeFileSync(target, rendered, 'utf8');
    process.stdout.write(`wrote ${MANIFEST_PATH} — ${manifest.fileCount} evidence documents\n`);
    return sound ? 0 : 1;
  }

  if (!existsSync(target)) {
    process.stderr.write(
      `::error::${MANIFEST_PATH} does not exist. P1-28-QA-005 requires a digest manifest; run \`npm run evidence:p1-28\`.\n`
    );
    return 1;
  }

  const committed = readFileSync(target, 'utf8');
  if (committed === rendered) {
    if (!sound) return 1;
    if (asJson) process.stdout.write(`${JSON.stringify({ ok: true, ...manifest }, null, 2)}\n`);
    else
      process.stdout.write(
        `evidence manifest in sync — ${manifest.fileCount} documents, every one reachable, ` +
          `candidate ${manifest.candidate.FINAL_CODE_SHA?.slice(0, 8)}\n`
      );
    return 0;
  }

  // Name WHICH documents moved. "The manifest is stale" sends a reader to diff
  // twelve files; "closure-evidence.md changed" sends them to one.
  const previous = JSON.parse(committed);
  const before = previous.files ?? {};
  const after = manifest.files;
  const added = Object.keys(after).filter((f) => !(f in before));
  const removed = Object.keys(before).filter((f) => !(f in after));
  const changed = Object.keys(after).filter(
    (f) => f in before && before[f].sha256 !== after[f].sha256
  );

  process.stderr.write(
    '::error::the P1-28 evidence manifest no longer describes the evidence. Regenerate it in the same commit as the document change: `npm run evidence:p1-28`.\n'
  );
  for (const f of changed) process.stderr.write(`  edited:  ${f}\n`);
  for (const f of added) process.stderr.write(`  added:   ${f}\n`);
  for (const f of removed) process.stderr.write(`  removed: ${f}\n`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)));
}
