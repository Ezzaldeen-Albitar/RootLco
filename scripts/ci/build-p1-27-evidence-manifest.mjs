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
 * ## The gate proves it can fail before it reports that it passed
 *
 * Every rule here is applied in exactly one function, `judge`, and `main` drives
 * that function over a table of known-bad inputs before it looks at the tree.
 * The reason is recorded beside the table: three separate rules were stubbed out
 * by an adversarial pass and the validator exited 0 each time, because no test
 * named them and the real tree is sound, so a rule that always passes and a rule
 * that works are the same observation. See `selfCheck`.
 *
 * Usage:  node scripts/ci/build-p1-27-evidence-manifest.mjs [--check] [--json]
 * Exit:   0 written / in sync · 1 drifted, unreachable, or self-check failed ·
 *         2 IO error.
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

/* ------------------------------------------------------------------ *
 * Verdicts, and why they are all applied in exactly one place
 *
 * An adversarial pass defeated this validator three ways and it exited 0 every
 * time:
 *
 *   1. `reportDigestShape(manifest)` replaced with the literal `true`;
 *   2. `reportReachability(ROOT)` replaced with `true`, after which DELETING
 *      `contract-archaeology.md` printed "in sync — 35 documents, every one
 *      reachable";
 *   3. `digest()` mutated to hash the file's PATH instead of its bytes, after
 *      which the manifest regenerated cleanly — path digests are also 64 hex
 *      characters and also all distinct, so the shape rule agreed with them.
 *
 * (1) and (2) are one defect: neither reporter was exported, no test in
 * `tests/**` or `apps/web/tests/**` named either of them, and the real tree is
 * sound — so a rule that always returns true and a rule that works produced
 * identical output. Nothing anywhere ran either rule against an input it was
 * supposed to reject. A check that has never failed is not known to be a check.
 *
 * So every rule is now applied in exactly one place, `judge`, and `judge` runs
 * TWICE on every invocation: once over the real evidence tree, and once over a
 * table of known-bad inputs it is required to reject (`selfCheck`, run first in
 * `main`). Stub any rule and the corresponding known-bad case starts passing,
 * which is itself the failure.
 *
 * (3) is a different defect and needs a different answer: an oracle that does
 * not call the code it is checking. That is `verifyDigestBytes`.
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
 * Hashing the path was reproduced against this tree: 64 hex characters, 36
 * distinct values, manifest regenerated, gate green.
 *
 * Duplicating `createHash('sha256')` here is deliberate and must stay
 * duplicated. An oracle that calls the function it is checking is `f(x) === f(x)`
 * — which is the same mistake `tests/ci/p1-27-evidence-manifest.test.ts` records
 * having shipped once already, under `QA005-06`.
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
 * 64 lower-case hex characters is SHA-256 and nothing else, and thirty-six
 * distinct documents cannot share a digest unless the digest is not a function
 * of their bytes. Truncation to sixteen bytes and a single constant across every
 * document were both reproduced against this tree before this existed.
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
 * removed, so it is the moment a reader can still act; deferring the complaint to
 * `--check` would mean the first report of a deleted document arrives in CI,
 * attached to whoever pushed next.
 *
 * It takes the ANALYSIS rather than a root, so the same code path can be driven
 * with a deletion that has not happened. `reachability` reads a filesystem; a
 * rule that can only be exercised by mutating the repository is a rule nobody
 * exercises.
 */
export function reportReachability(analysis, write = toStderr) {
  let sound = true;
  const { orphans, dangling, staleDeclarations } = analysis;

  if (dangling.length > 0) {
    sound = false;
    write(
      '::error::the P1-27 index cites evidence documents that are not in the tree. A document was deleted or renamed and the documents that name it were not updated.\n'
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
 * The ONLY place a verdict is taken. Every rule fires here or nowhere.
 *
 * All three run before the aggregate is formed, so one failure does not hide
 * another — a reader fixing a deleted citation should not then discover the
 * digest function was also wrong.
 */
export function judge(inputs, write = toStderr) {
  const shapeOk = reportDigestShape(inputs.manifest, write);
  const bytesOk = reportDigestBytes(inputs.digestMismatches, write);
  const reachableOk = reportReachability(inputs.reachability, write);
  return { shapeOk, bytesOk, reachableOk, sound: shapeOk && bytesOk && reachableOk };
}

/* ------------------------------------------------------------------ *
 * The self-check
 * ------------------------------------------------------------------ */

/** 64 lower-case hex characters, distinct per tag. A well-formed fake digest. */
const wellFormed = (tag) => String(tag).padStart(64, 'a');

const SOUND_REACHABILITY = { orphans: [], dangling: [], staleDeclarations: [] };
const SOUND_MANIFEST = {
  files: {
    'a.md': { sha256: wellFormed(1), bytes: 1 },
    'b.md': { sha256: wellFormed(2), bytes: 2 },
  },
};

const inputs = (over = {}) => ({
  manifest: SOUND_MANIFEST,
  digestMismatches: [],
  reachability: SOUND_REACHABILITY,
  ...over,
});

/**
 * Inputs `judge` is REQUIRED to reject, and one it is required to accept.
 *
 * Each is a defect this validator has actually shipped, expressed as data rather
 * than as a sentence about the code. `expects` names the flag that must go
 * false: a case that only asserted `sound` would be satisfied by any rule
 * failing, so stubbing one rule while another fired would still look correct.
 *
 * `explains` is the second half. A rule that returns false and prints nothing
 * fails CI with no way to act on it, and this repository has shipped that too.
 */
export const SELF_CHECK_CASES = [
  {
    name: 'a sound manifest, a sound set',
    inputs: inputs(),
    expects: { shapeOk: true, bytesOk: true, reachableOk: true, sound: true },
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
];

/**
 * Drive `judge` over the known-bad table. Returns the ways it failed to fail.
 *
 * This is what makes every rule above load-bearing. It is not a test — it runs
 * inside the gate, on every invocation, in CI and locally, because the mutation
 * that defeated this validator was made to the gate and the gate is what has to
 * notice.
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
      '::error::the P1-27 evidence validator failed its own self-check: a rule accepted an input it is required to reject. A guard that cannot fail is not a guard, and every verdict below it is worthless.\n'
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
    }).sound;
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
