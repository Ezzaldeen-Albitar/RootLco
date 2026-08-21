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
import { spawnSync } from 'node:child_process';
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

/** Files outside the phase directory that the package makes checkable claims about. */
export const PLAYWRIGHT_CONFIG = 'apps/web/playwright.config.ts';
export const BASELINE_PATH = '.github/ci-baselines/unrun-test-tiers.json';
export const PHASE_SPEC = 'authenticated/appointments-and-receptions.spec.ts';

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

/* ------------------------------------------------------------------ *
 * The repository oracle
 *
 * The first revision of this file tested the candidate with
 * `/^[0-9a-f]{40}$/` and compared the two halves of the package with each
 * other. `git` was never invoked. A final review replaced the candidate with
 * `deadbeef…` — forty hex characters naming no object in this repository — in
 * BOTH halves and the gate printed "evidence manifest in sync … candidate
 * deadbeef" and exited 0, while the docblock at the top of this very file
 * described that exact failure as the thing P1-28 was built to prevent.
 *
 * Well-formedness is not existence, and agreement between two documents is not
 * evidence about a repository. Everything below computes against `git`.
 * ------------------------------------------------------------------ */

/**
 * A reader of the repository. Returns stdout, or `null` when git refuses.
 *
 * `null` rather than a throw because "this object does not exist" is the ANSWER
 * to several of the questions below, not an error in asking them. Injectable so
 * every rule that consumes it can be driven over a synthetic repository by
 * `selfCheck` — the whole reason the previous self-check discovered nothing was
 * that it drove `judge` over flags a human had already set to `false`, so no
 * case ever asked whether anything computed `false` from a tree.
 */
export function gitReader(root = ROOT) {
  const probe = (args) => {
    const result = spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return {
      status: result.error ? null : result.status,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
    };
  };
  const read = (args) => {
    const result = probe(args);
    return result.status === 0 ? result.stdout : null;
  };
  read.probe = probe;
  return read;
}

/** A fake `git`, keyed by the exact argument vector. Used only by `selfCheck`. */
export const GIT_COMMAND_FAILURE = Symbol('GIT_COMMAND_FAILURE');

export function fakeGit(table) {
  const read = (args) => {
    const key = args.join(' ');
    const value = table[key];
    return key in table && value !== GIT_COMMAND_FAILURE ? (value ?? null) : null;
  };
  read.probe = (args) => {
    const key = args.join(' ');
    if (table[key] === GIT_COMMAND_FAILURE) return { status: 2, stdout: '' };
    if (key in table) {
      return table[key] === undefined
        ? { status: 1, stdout: '' }
        : { status: 0, stdout: String(table[key] ?? '') };
    }
    /*
     * Synthetic ancestry tables omit the negative edge. Other omitted commands
     * are refusals. A failure world uses GIT_COMMAND_FAILURE explicitly so the
     * two answers remain distinguishable.
     */
    return args[0] === 'merge-base' && args[1] === '--is-ancestor'
      ? { status: 1, stdout: '' }
      : { status: 2, stdout: '' };
  };
  return read;
}

/** `true`, `false`, or `null` when Git could not answer the ancestry question. */
function ancestry(git, ancestor, descendant) {
  const args = ['merge-base', '--is-ancestor', ancestor, descendant];
  if (typeof git.probe === 'function') {
    const result = git.probe(args);
    if (result.status === 0) return true;
    if (result.status === 1) return false;
    return null;
  }
  /* Compatibility for narrow test wrappers around a real reader. */
  return git(args) === null ? false : true;
}

/** Whether `commit` is on `baseTip`'s first-parent line, or `null` on refusal. */
function firstParentLineContains(git, commit, baseTip) {
  if (commit === baseTip) return true;
  const raw = git(['rev-list', '--first-parent', baseTip]);
  return raw === null ? null : lines(raw).includes(commit);
}

const lines = (out) =>
  String(out ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * A path that changes no executable behaviour.
 *
 * The P1-27 spelling exactly: `docs/` or `*.md`. Kept identical so a reader who
 * knows one rule knows both, and so a successor cannot be documentation-only
 * under one gate and executable under the other.
 */
export const isDocumentationPath = (path) => path.startsWith('docs/') || path.endsWith('.md');

/**
 * The forms a base branch may take in a checkout, in the order they are tried.
 *
 * A remote-tracking ref first, because that is what a CI clone has and what is
 * CURRENT; the local branch second, because that is what a workstation has; the
 * bare name last, so a base given as a tag or a raw commit id still resolves.
 */
export const BASE_REF_FORMS = Object.freeze([
  (branch) => `refs/remotes/origin/${branch}`,
  (branch) => `refs/heads/${branch}`,
  (branch) => branch,
]);

/**
 * The base branch, resolved to a commit — or an honest `null`.
 *
 * `attempted` is returned so a failure names what was looked for. "The base
 * could not be resolved" sends a reader to guess; "tried
 * refs/remotes/origin/develop, refs/heads/develop, develop" sends them to fetch
 * one of three things.
 */
export function resolveBaseRef(git, baseBranch) {
  const branch = String(baseBranch ?? '').trim();
  const attempted = [];
  if (branch === '') return { branch, attempted, ref: null, sha: null };
  for (const form of BASE_REF_FORMS) {
    const ref = form(branch);
    attempted.push(ref);
    const sha = lines(git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]))[0] ?? null;
    if (sha !== null && /^[0-9a-f]{40}$/.test(sha)) return { branch, attempted, ref, sha };
  }
  return { branch, attempted, ref: null, sha: null };
}

/**
 * The head THIS BRANCH contributes, which is not always the checked-out commit.
 *
 * ## Classified by the CANDIDATE, not by the base — and why that matters
 *
 * The first revision of this function asked which parent was contained in the
 * BASE BRANCH, so it could not run at all unless a base ref resolved. That made
 * the merge-ref correction depend on the very thing a shallow or filtered clone
 * is most likely to be missing, and it threw away the one piece of information a
 * merge ref always carries: its own parents.
 *
 * The question is asked the other way round now. The branch under test is the
 * parent that CONTAINS THE CANDIDATE — a question about the candidate, which
 * this package always has — and the other parent is, by construction, the base
 * side of the merge. The base is therefore RECOVERED from the merge ref when no
 * ref names it, which is exactly the case a shallow checkout produces.
 *
 * When a base ref DOES resolve it is used as a cross-check and may only make
 * this function stricter: if the non-candidate parent is not contained in that
 * base, this is not a preview of this pull request and the unwrap is DECLINED
 * and said out loud.
 *
 * A two-parent merge where both parents carry the candidate is unwrapped only
 * when the resolved base identifies one parent exactly, or when the checkout is
 * itself proved to be on the resolved base line. Missing/failed ancestry,
 * ambiguous parents, a stale ref that only proves a shared ancestor, and failed
 * merge-content inspection are UNKNOWN and fail closed. A contentful merge is
 * deliberately left intact so its own bytes remain under judgement.
 *
 * `evilMergePaths` and `declined` are returned rather than swallowed: a merge
 * that was NOT unwrapped, and the reason, are facts a reader wants.
 */
export function phaseHead(git, candidateSha, baseSha) {
  return headAt(git, 'HEAD', candidateSha, baseSha, CONTENT_FREE_MERGE_HOPS);
}

/**
 * How many content-free merges may stand between the checkout and the head.
 *
 * Two is the most this repository can produce today — a promotion of a branch
 * whose own tip is a sync merge — and a budget rather than a boolean because a
 * chain is what a promotion cycle builds. Exceeding it is UNKNOWN, not a reason
 * to stop unwrapping and measure the wrong commit.
 */
const CONTENT_FREE_MERGE_HOPS = 10;

/**
 * `phaseHead` for an explicit revision.
 *
 * `hopsLeft` bounds how far a chain of content-free merges may be followed.
 */
function headAt(git, rev, candidateSha, baseSha, hopsLeft) {
  const row = lines(git(['rev-list', '--parents', '-n', '1', rev]))[0] ?? '';
  const ids = row.split(/\s+/).filter(Boolean);
  const checkout = ids[0] ?? null;
  const parents = ids.slice(1);
  const plain = {
    head: checkout,
    checkout,
    mergeRef: null,
    baseSide: null,
    evilMergePaths: [],
    declined: null,
    topologyUnknown: null,
    addsNothingTo: null,
  };
  if (checkout === null || parents.length !== 2 || !candidateSha) return plain;

  const candidateRelations = parents.map((p) => ancestry(git, candidateSha, p));
  if (candidateRelations.some((relation) => relation === null)) {
    return {
      ...plain,
      topologyUnknown:
        'Git could not determine whether the candidate is an ancestor of both merge parents',
    };
  }
  const carries = parents.filter((_, index) => candidateRelations[index] === true);
  /*
   * Ordinarily exactly one parent carries the candidate. Once the base has
   * absorbed it, both may. Parent order alone is not proof in that world: a
   * protected merge has base first, while `git merge develop` on a remediation
   * branch has the branch first. The resolved base must disambiguate them.
   */
  let branchSide = null;
  let baseSide = null;
  if (carries.length === 1) {
    branchSide = carries[0];
    baseSide = parents.find((p) => p !== branchSide) ?? null;
  } else if (carries.length === parents.length) {
    const exactBase = baseSha ? parents.filter((p) => p === baseSha) : [];
    if (exactBase.length === 1) {
      baseSide = exactBase[0];
      branchSide = parents.find((p) => p !== baseSide) ?? null;
    } else if (baseSha) {
      const checkoutOnBase = firstParentLineContains(git, checkout, baseSha);
      if (checkoutOnBase === null) {
        return {
          ...plain,
          topologyUnknown:
            'Git could not determine whether this merge commit is on the resolved base line',
        };
      }
      if (checkoutOnBase) {
        [baseSide, branchSide] = parents;
      } else {
        return {
          ...plain,
          topologyUnknown:
            'both merge parents contain the candidate and the resolved base does not uniquely identify either parent',
        };
      }
    } else {
      return {
        ...plain,
        topologyUnknown:
          'both merge parents contain the candidate and no resolved base identifies the base side',
      };
    }
  } else {
    return {
      ...plain,
      topologyUnknown: 'neither merge parent contains the candidate',
    };
  }
  if (baseSide === null) return plain;

  /*
   * A MERGE THAT ADDS NOTHING IS THE PARENT IT ADDS NOTHING TO.
   *
   * Two merges in this repository carry one parent's tree byte for byte, and
   * the code below reads both of them wrong.
   *
   * The first is a PROMOTION. `actions/checkout` takes the pull request's merge
   * ref, whose parents are `main` and `develop`. Its non-candidate parent is the
   * protected branch, which — in a repository that promotes by merge commit —
   * has accumulated merge topology the base branch has never seen. Neither
   * parent contains the other, so the check below declines the unwrap, and the
   * merge ref itself becomes the head under test. Subtracting the base then
   * leaves the PROTECTED branch's history: the phase's own recorded successors
   * read as fabricated and the promotion target's commits read as this phase's
   * unnamed successors. Measured: 28 in range, 4 fabricated, 24 unnamed, against
   * 10 / 0 / 0 for the same package on `develop`.
   *
   * The second is the SYNC that must precede it. `main` is protected with
   * `strict=true`, so `develop` cannot be promoted until it contains `main`, and
   * the merge that puts it there sits on `develop` from then on. That one is not
   * declined — once `main` is an ancestor of `develop` the check below is
   * satisfied — it is simply read as though `main` were "the base as it stood",
   * which subtracts the protected branch instead of the last feature branch's
   * base. Measured with `origin/develop` at the sync merge: 61 in range and 18
   * unnamed executable successors, on a package that had changed by nothing.
   *
   * Both are the same fact. A merge whose tree is IDENTICAL to one parent's
   * added nothing to that parent, so the head under test is that parent, read
   * exactly as that parent is read — its own base side, not this merge's.
   *
   * The condition is one fact, and the trees must match BYTE FOR BYTE. That is
   * what makes reading the parent safe rather than a concession: a checkout
   * identical in content to a parent can smuggle nothing in through the other
   * one. A merge that DID change content is left to the check below, exactly as
   * before — including an evil merge, whose tree matches neither parent.
   *
   * Unwrapping must not cost the SUBTRAHEND, which is why the base side falls
   * back to this merge's own. An ordinary feature merge into a base that has not
   * moved also carries its branch parent's tree, so this fires there too; the
   * parent it unwraps to is a plain commit with no base side of its own, and
   * without the fallback the range would be taken against the merge that
   * contains it and collapse to empty. With it, the answer is the one this
   * function already gave — which is the point. This is a generalisation, not a
   * change of behaviour: every unwrap it adds is one where the merge added no
   * content, and it was checked commit by commit against the previous revision
   * over the whole of the base branch since the candidate.
   *
   * Git declining to name either tree is UNKNOWN, not permission to proceed.
   */
  const checkoutTree = treeOf(git, checkout);
  const branchTree = treeOf(git, branchSide);
  if (checkoutTree === null || branchTree === null) {
    return {
      ...plain,
      topologyUnknown: `Git could not compare the tree of merge ${checkout.slice(0, 8)} with the tree of its candidate-carrying parent ${branchSide.slice(0, 8)}`,
    };
  }
  if (checkoutTree === branchTree) {
    if (hopsLeft <= 0) {
      return {
        ...plain,
        topologyUnknown: `more than ${CONTENT_FREE_MERGE_HOPS} content-free merges stand between the checkout and the head, so the head under test cannot be established`,
      };
    }
    const inner = headAt(git, branchSide, candidateSha, baseSha, hopsLeft - 1);
    return {
      ...inner,
      /*
       * Still a merge ref, and still said so. Unwrapping must not cost the
       * reader the fact that a merge was unwrapped, or the report reads as an
       * ordinary checkout of a commit nobody pushed.
       */
      mergeRef: checkout,
      baseSide: inner.baseSide ?? baseSide,
      checkout,
      addsNothingTo: branchSide,
    };
  }

  /*
   * The base-side parent may equal the observed base or precede it. The reverse
   * is not proof: when the observation is stale, both the real base and an
   * unrelated sibling can descend from it. That world is UNKNOWN, not a reason
   * to trust parent order.
   */
  if (baseSha && baseSide !== baseSha) {
    const sideBeforeBase = ancestry(git, baseSide, baseSha);
    const baseBeforeSide = ancestry(git, baseSha, baseSide);
    if (sideBeforeBase === null || baseBeforeSide === null) {
      return {
        ...plain,
        topologyUnknown: `Git could not compare merge parent ${baseSide.slice(0, 8)} with the resolved base ${baseSha.slice(0, 8)}`,
      };
    }
    if (!sideBeforeBase && baseBeforeSide) {
      return {
        ...plain,
        topologyUnknown: `the resolved base ${baseSha.slice(0, 8)} is stale behind merge parent ${baseSide.slice(0, 8)}, so topology cannot prove that parent is the base rather than a sibling branch`,
      };
    }
    if (!sideBeforeBase && !baseBeforeSide) {
      return {
        ...plain,
        declined: `its non-candidate parent ${baseSide.slice(0, 8)} is on neither side of the base branch ${baseSha.slice(0, 8)} — neither contains the other — so this is not a preview of this pull request`,
      };
    }
  }

  const combinedRaw = git(['diff-tree', '--cc', '--name-only', '--no-commit-id', checkout]);
  if (combinedRaw === null) {
    return {
      ...plain,
      topologyUnknown: `Git could not inspect whether merge ${checkout.slice(0, 8)} carries content belonging to neither parent`,
    };
  }
  const combined = lines(combinedRaw);
  if (combined.length > 0) return { ...plain, evilMergePaths: combined };

  return {
    head: branchSide,
    checkout,
    mergeRef: checkout,
    baseSide,
    evilMergePaths: [],
    declined: null,
    topologyUnknown: null,
    addsNothingTo: null,
  };
}

/** The tree a revision names, or `null` when Git declined to say. */
function treeOf(git, rev) {
  return lines(git(['rev-parse', `${rev}^{tree}`]))[0] ?? null;
}

/**
 * What the repository says about the candidate, its tree and its successors.
 *
 * An ANALYSIS, not a verdict, for the same reason `reachability` is one.
 *
 * ## On the successor rule, and the one hole it cannot close
 *
 * A commit cannot name itself: writing its own id into a file it contains
 * changes the id. So "the recorded successors are EXACTLY `git log
 * candidate..HEAD`" is not a rule any repository can satisfy. The checkable
 * rule, and the one applied here, is the one that loses nothing:
 *
 *   every commit after the candidate that touches an EXECUTABLE path must be
 *   named by its full id; a commit that touches only `docs/` and `*.md` may go
 *   unnamed, and the gate PRINTS the ones that did.
 *
 * That leaves exactly one kind of unnamed commit — the documentation-only
 * commit that carries this record — and it is reported rather than hidden. A
 * successor that adds a line of code and is not named fails.
 *
 * ## On WHOSE commits these are: the merge-ref hazard
 *
 * `HEAD` is not always this branch. `actions/checkout` defaults, for a
 * `pull_request` event, to the pull request's MERGE REF — a synthetic commit
 * merging this branch with its base — and this repository has been bitten by
 * that default before. Under it, `git log candidate..HEAD` sweeps in the BASE
 * BRANCH's own history, and every commit develop has taken since the freeze
 * reads as an unnamed executable successor of a candidate it has nothing to do
 * with. That is exactly what happened: hosted CI reported
 * `0c89647de1a661105ec3a612955789989da58a0d` — a develop commit, authored by
 * another session, absent from this branch — as a successor this package failed
 * to name. The same ref would poison `git diff candidate..HEAD -- apps
 * supabase`, where the base's product changes would read as a broken freeze.
 *
 * The successor set is "what THIS BRANCH added after the candidate", so it is
 * computed that way, in two independent subtractions:
 *
 *   the base branch is RESOLVED to a commit and excluded from the range
 *   (`--not <base>`), so a base commit can never be a successor of this phase;
 *   and
 *
 *   when the checkout is a synthetic merge of this branch with its base — HEAD
 *   is a two-parent commit, one parent contained in the base, the other
 *   descending from the candidate, and the merge introduces no content of its
 *   own — the head under test is that other parent, and the gate PRINTS the
 *   substitution rather than performing it quietly. The combined-diff condition
 *   is what stops an EVIL merge being unwrapped past: a merge carrying content
 *   neither parent has is not a preview of anything and is left to be judged as
 *   the commit it is.
 *
 * Both subtractions fail CLOSED. A base branch this checkout cannot resolve
 * makes the successor set UNKNOWN, and unknown is not none: a shallow clone that
 * cannot see the base is reported and refused, never waved through.
 */
export function repositoryBinding(candidateFile, git) {
  const candidate = candidateFile.candidate ?? {};
  const sha = candidate.FINAL_CODE_SHA ?? '';
  const tree = candidate.FINAL_CODE_TREE ?? '';
  const wellFormed = /^[0-9a-f]{40}$/.test(sha);

  const base = resolveBaseRef(git, String(candidate.baseBranch ?? ''));
  const head = phaseHead(git, sha, base.sha);
  /*
   * The base, from a ref if this checkout has one and from the merge ref's own
   * base-side parent if it does not. Recovering it is deliberate: a shallow or
   * filtered clone may carry no `refs/remotes/origin/<base>` at all, and a merge
   * ref names its base side in its parent list whether or not any ref does.
   */
  /*
   * The base as it STOOD, not the base as it is now — and the difference is
   * what a merge makes.
   *
   * The subtraction exists so a checkout does not count the base branch's own
   * commits as successors of the candidate. It presumes the base does not
   * contain the candidate. The moment this branch MERGES, that presumption
   * inverts: `origin/develop` then contains the whole branch, so subtracting it
   * removes every genuine successor and the range collapses to empty — which is
   * exactly what the protected-branch reproof reported, and what the two
   * anti-vacuity guards refused to pass on.
   *
   * A merge names its own base in its first parent: the base as it stood before
   * this branch landed. That is the honest subtrahend both before the merge (a
   * pull request's merge ref names the base tip it previewed against) and after
   * it (the merge commit names the develop it was merged into). It is preferred
   * over the resolved ref for the same reason the ref is only a cross-check in
   * `phaseHead`: a ref is a moving snapshot, a parent is a fact about the commit
   * under test.
   */
  const baseSha = head.baseSide ?? base.sha;
  const baseFrom = head.baseSide
    ? "the merge's own base-side parent — the base as it stood"
    : base.sha
      ? base.ref
      : null;
  const baseResolved = Boolean(baseSha);
  /*
   * Whether the base already contains the candidate — reported, NOT refused.
   *
   * It looks alarming and is not. The subtrahend answers one question: what did
   * THIS line of work add on top of the base it sits on? A branch cut from a
   * base that has already absorbed the candidate added exactly its own commits,
   * and subtracting that base is what says so. Nothing is hidden by it either:
   * the product-identity check is taken over the whole span from the candidate
   * to the head under test, not over this range, so a product file that moved
   * inside the absorbed history still fails.
   *
   * What this flag exists for is the reader. "0 successors" means something
   * different on a branch cut after the merge than it does before it, and the
   * gate says which it is looking at rather than leaving the number to be
   * misread.
   */
  const baseAbsorbedCandidate =
    baseResolved && wellFormed && git(['merge-base', '--is-ancestor', sha, baseSha]) !== null;

  const exists = wellFormed && git(['cat-file', '-e', `${sha}^{commit}`]) !== null;
  const actualTree = exists ? (lines(git(['rev-parse', `${sha}^{tree}`]))[0] ?? null) : null;
  const isAncestorOfHead =
    exists &&
    baseResolved &&
    Boolean(head.head) &&
    git(['merge-base', '--is-ancestor', sha, head.head]) !== null;

  /*
   * `null` from `git` is a REFUSAL, and `lines(null)` is `[]` — which reads as
   * "no product file differs" and "this branch added no successors". Both are
   * the fail-OPEN this package exists to prevent, so each is captured as its own
   * UNKNOWN and refused. A command that could not run has not answered the
   * question; it has declined to.
   */
  const productRaw = isAncestorOfHead
    ? git(['diff', '--name-only', `${sha}..${head.head}`, '--', 'apps', 'supabase'])
    : '';
  const productDiffUnknown = productRaw === null;
  const productDiff = productDiffUnknown ? [] : lines(productRaw);

  const rangeRaw = isAncestorOfHead
    ? git(['log', '--format=%H %s', head.head, '--not', sha, baseSha])
    : '';
  const rangeUnknown = rangeRaw === null;
  const commits = rangeUnknown
    ? []
    : lines(rangeRaw).map((line) => {
        const at = line.indexOf(' ');
        const id = at === -1 ? line : line.slice(0, at);
        const touched = git(['diff', '--name-only', `${id}^`, id]);
        return {
          sha: id,
          subject: at === -1 ? '' : line.slice(at + 1),
          // A commit whose diff cannot be taken (a root commit, an unreadable
          // parent) is NOT assumed harmless: `paths: null` means unknown, and
          // unknown must be recorded like any other executable successor.
          paths: touched === null ? null : lines(touched),
        };
      });

  const recorded = (candidateFile.successors ?? []).map((s) => String(s?.commit ?? ''));
  const absorbed = (candidateFile.absorbedSuccessors ?? []).map((s) => String(s?.commit ?? ''));
  const inRange = new Set(commits.map((c) => c.sha));
  const absorbedProblems = [];

  for (const id of absorbed) {
    if (!/^[0-9a-f]{40}$/.test(id)) {
      absorbedProblems.push(`absorbed successor \`${id}\` is not a 40-character commit id`);
      continue;
    }
    if (recorded.includes(id)) {
      absorbedProblems.push(
        `absorbed successor ${id.slice(0, 8)} is also listed as a current successor`
      );
      continue;
    }
    if (inRange.has(id)) {
      absorbedProblems.push(
        `absorbed successor ${id.slice(0, 8)} is in the current branch range and must remain in \`successors\``
      );
      continue;
    }
    if (git(['cat-file', '-e', `${id}^{commit}`]) === null) {
      absorbedProblems.push(`absorbed successor ${id} names no commit this repository can inspect`);
      continue;
    }
    const afterCandidate = ancestry(git, sha, id);
    const insideBase = baseSha ? ancestry(git, id, baseSha) : null;
    if (afterCandidate === null || insideBase === null) {
      absorbedProblems.push(
        `Git could not prove absorbed successor ${id.slice(0, 8)} lies between the candidate and the resolved base`
      );
      continue;
    }
    if (!afterCandidate || !insideBase) {
      absorbedProblems.push(
        `absorbed successor ${id.slice(0, 8)} is not contained between candidate ${sha.slice(0, 8)} and base ${String(baseSha).slice(0, 8)}`
      );
      continue;
    }
    const productRaw = git(['diff', '--name-only', `${sha}..${id}`, '--', 'apps', 'supabase']);
    if (productRaw === null) {
      absorbedProblems.push(
        `product identity for absorbed successor ${id.slice(0, 8)} is UNKNOWN because Git refused the diff`
      );
      continue;
    }
    const changed = lines(productRaw);
    if (changed.length > 0) {
      absorbedProblems.push(
        `absorbed successor ${id.slice(0, 8)} differs from the candidate at ${changed.length} product path(s): ${changed.slice(0, 5).join(', ')}`
      );
    }
  }

  if (new Set(absorbed).size !== absorbed.length) {
    absorbedProblems.push('absorbedSuccessors contains a duplicate commit id');
  }

  return {
    sha,
    tree,
    wellFormed,
    exists,
    actualTree,
    treeMatches: Boolean(actualTree) && actualTree === tree,
    baseBranch: base.branch,
    baseRef: base.ref,
    baseSha,
    baseFrom,
    baseAbsorbedCandidate,
    baseAttempted: base.attempted,
    baseResolved,
    phaseHead: head.head,
    checkoutHead: head.checkout,
    mergeAddsNothingTo: head.addsNothingTo,
    unwrappedMergeRef: head.mergeRef,
    mergeRefBaseSide: head.baseSide,
    evilMergePaths: head.evilMergePaths,
    declinedUnwrap: head.declined,
    topologyUnknown: head.topologyUnknown,
    isAncestorOfHead,
    productDiff,
    productDiffUnknown,
    rangeUnknown,
    commits,
    recorded,
    absorbed,
    absorbedProblems,
    malformedSuccessors: recorded.filter((id) => !/^[0-9a-f]{40}$/.test(id)),
    fabricatedSuccessors: recorded.filter((id) => /^[0-9a-f]{40}$/.test(id) && !inRange.has(id)),
    unrecordedExecutable: commits
      .filter(
        (c) =>
          !recorded.includes(c.sha) &&
          (c.paths === null || c.paths.some((p) => !isDocumentationPath(p)))
      )
      .map((c) => c.sha),
    unrecordedDocumentation: commits
      .filter(
        (c) =>
          !recorded.includes(c.sha) &&
          c.paths !== null &&
          c.paths.every((p) => isDocumentationPath(p))
      )
      .map((c) => c.sha),
  };
}

/**
 * The five figure fields the P1-27 run ledger actually writes.
 *
 * A LOCAL tier may carry these and no other number. `suites: 549` stood in this
 * package for the whole of its first revision and came from nowhere a reader
 * could reach — the ledger does not record suite counts, so there was nothing
 * to check it against and nothing that would have noticed it change.
 */
export const LEDGER_FIGURES = Object.freeze(['tests', 'passed', 'failed', 'skipped', 'files']);

export const PROVENANCE_LOCAL = 'LOCAL_AND_HOSTED_AGREE';
export const PROVENANCE_HOSTED = 'HOSTED_ARTEFACT_ATTESTED';

/**
 * The two PENDING provenances, and why a state for "not measured yet" had to
 * exist rather than being expressed by leaving the old numbers in place.
 *
 * A candidate is re-frozen whenever a fix touches a product file, and the hosted
 * observation of the OLD candidate does not travel with it: run 31750364479
 * describes `38afa5c2…`, and after three fix waves that commit is not the code
 * this package is about. Before these two states existed the package had exactly
 * two options — restate the superseded figures as though they had been taken
 * here, or fabricate a run id — and the first is the P1-27 failure this whole
 * gate was written to prevent.
 *
 *   `LOCAL_COMPUTED_HOSTED_PENDING` — the local half is measured and COMPUTED
 *   against the run ledger exactly as `LOCAL_AND_HOSTED_AGREE` requires; the
 *   hosted half has not been taken at this candidate, so the tier may not claim
 *   the two AGREE. Nothing about the local obligation is relaxed.
 *
 *   `HOSTED_PENDING_AT_CANDIDATE` — no measurement of this tier exists at this
 *   candidate at all. The figures shown are the superseded head's and the
 *   attestation must say so, name that head, and name what is awaited.
 *
 * Both are STRICTLY MORE demanding than silence: a pending tier must carry an
 * attestation marked `describesSupersededHead`, that head must be a commit this
 * repository contains AND an ancestor of the candidate, and every such binding
 * must appear in the package's `pendingHostedBindings` list — which the gate
 * computes and compares, so a pending binding cannot go unlisted and a listed
 * one cannot be decorative.
 */
export const PROVENANCE_LOCAL_PENDING = 'LOCAL_COMPUTED_HOSTED_PENDING';
export const PROVENANCE_HOSTED_PENDING = 'HOSTED_PENDING_AT_CANDIDATE';

/** Provenances whose local half must be computed against the run ledger. */
export const LOCAL_PROVENANCES = Object.freeze([PROVENANCE_LOCAL, PROVENANCE_LOCAL_PENDING]);
/** Provenances that claim no hosted observation of the candidate. */
export const PENDING_PROVENANCES = Object.freeze([
  PROVENANCE_LOCAL_PENDING,
  PROVENANCE_HOSTED_PENDING,
]);
/** Every provenance a tier may declare. */
export const ALL_PROVENANCES = Object.freeze([
  PROVENANCE_LOCAL,
  PROVENANCE_HOSTED,
  PROVENANCE_LOCAL_PENDING,
  PROVENANCE_HOSTED_PENDING,
]);

/** A path this package calls PRODUCT — the two trees the freeze is about. */
export const isProductPath = (path) => path.startsWith('apps/') || path.startsWith('supabase/');

/**
 * The declaration a hosted binding makes when its run was taken AFTER the
 * candidate, at a head whose product is provably the same.
 *
 * A marker rather than an inference, for the reason every other rule here is
 * written down: without it a `headSha` that is not the candidate is silent about
 * WHY, and a reader would have to run `git diff` to learn whether they are
 * looking at a forward citation, a stale one, or a typo. With it the package
 * states which of the two escapes it is taking, and the gate computes whether
 * the repository bears it out. A binding that declares nothing is refused
 * exactly as before.
 */
export const SUCCESSOR_MARKER = 'describesProductIdenticalSuccessor';

/**
 * Every block in the package that names the head it describes.
 *
 * Derived by looking for a `headSha` key rather than from a list of block names,
 * because a list is exactly what a new block would be added outside of. Anything
 * that names a head is checked against the candidate; anything that names none
 * is some other rule's complaint.
 */
export function hostedBindingSites(candidateFile) {
  const sites = [];
  for (const [name, tier] of Object.entries(candidateFile.tiers ?? {})) {
    if (tier?.hostedAttestation && typeof tier.hostedAttestation === 'object') {
      sites.push({ name: `tiers.${name}.hostedAttestation`, record: tier.hostedAttestation });
    }
  }
  for (const [key, value] of Object.entries(candidateFile)) {
    if (key === 'tiers' || key === 'candidate') continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && 'headSha' in value) {
      sites.push({ name: key, record: value });
    }
  }
  return sites;
}

/**
 * Which hosted bindings describe a head this candidate supersedes, which are
 * BOUND to it, and whether the package says so.
 *
 * COMPUTED in both directions. `superseded` is derived from the documents' own
 * `headSha` fields; `pendingHostedBindings.bindings` is what the package
 * declares; a difference either way is refused. A binding that quietly describes
 * another head is the defect; a declaration naming a binding that is in fact
 * bound is the inverse and reads as an unpaid debt that has been paid.
 *
 * A head that is not the candidate is one of exactly two things, and the package
 * must say which:
 *
 *   BEHIND it — `describesSupersededHead`. The run predates this code, so it
 *   describes a head the candidate supersedes and the binding is PENDING. The
 *   head must be a commit this repository contains and an ANCESTOR of the
 *   candidate, and it must name what replaces it.
 *
 *   AHEAD of it — `describesProductIdenticalSuccessor`. The run was taken after
 *   the candidate at a head that CONTAINS it and whose `apps/**` and
 *   `supabase/**` this repository computes to be byte-identical to it. The
 *   binding is BOUND: it describes this product, at a commit the reader is told.
 *
 * Nothing else passes. An undeclared head, a head this repository does not
 * contain, a head that is neither ancestor nor descendant, and a descendant
 * whose product differs are all refused — which is what makes the second escape
 * an escape from the CIRCULARITY (the seal cannot live inside the commit it
 * seals) rather than an escape from the evidence.
 */
export function pendingBinding(candidateFile, git) {
  const candidateSha = candidateFile.candidate?.FINAL_CODE_SHA ?? '';
  const problems = [];
  const superseded = [];
  const bound = [];
  const boundAtSuccessor = [];

  for (const { name, record } of hostedBindingSites(candidateFile)) {
    const head = String(record.headSha ?? '');
    const marked = record.describesSupersededHead === true;
    const forward = record[SUCCESSOR_MARKER] === true;
    if (head === candidateSha && candidateSha !== '') {
      if (marked) {
        problems.push(
          `${name}: is marked describesSupersededHead while the head it names IS the candidate, so the marker excuses nothing`
        );
        continue;
      }
      if (forward) {
        problems.push(
          `${name}: is marked ${SUCCESSOR_MARKER} while the head it names IS the candidate, so there is no successor to declare`
        );
        continue;
      }
      bound.push(name);
      continue;
    }
    if (marked && forward) {
      problems.push(
        `${name}: declares both describesSupersededHead and ${SUCCESSOR_MARKER}; one head cannot both precede and follow the candidate`
      );
      continue;
    }
    if (forward) {
      /*
       * THE FORWARD CITATION, and why it is not a relaxation.
       *
       * The seal's own machinery cannot be inside the candidate it seals, so it
       * lands after it and the hosted run is taken at a later head. Under the
       * rule that a hosted binding must name the candidate EXACTLY, every such
       * run would force another re-freeze, whose seal commit would move the head
       * again — an unbounded loop, and one this package walked into.
       *
       * The local half already solved this: a tier may be measured at a named
       * executable successor while `git diff` COMPUTES that no product path
       * differs. The claim is about the PRODUCT, and the product is provably the
       * same. The hosted half is allowed the same escape on the same evidence
       * and at the same rigour — every one of these is computed, none asserted:
       *
       *   the run head is a commit THIS repository contains;
       *   it DESCENDS from the candidate, so it cannot be a run that predates
       *   the code it is offered as evidence for (an ancestor stays exactly
       *   where it was: the `describesSupersededHead` path, which is unchanged);
       *   `git diff --name-only <candidate>..<runHead> -- apps supabase` is
       *   EMPTY, and a diff git refuses to take is UNKNOWN, never empty; and
       *   the binding names that head in `headSha`, so a reader sees which
       *   commit was exercised rather than being told "the candidate" over a run
       *   that touched a different commit.
       */
      if (!/^[0-9a-f]{40}$/.test(head)) {
        problems.push(`${name}: declares a successor run head \`${head}\` that is not a commit id`);
        continue;
      }
      if (git(['cat-file', '-e', `${head}^{commit}`]) === null) {
        problems.push(
          `${name}: cites a run at ${head}, which names no commit in this repository — a head nobody can fetch is not a citation`
        );
        continue;
      }
      if (git(['merge-base', '--is-ancestor', candidateSha, head]) === null) {
        problems.push(
          `${name}: cites a run at ${head.slice(0, 8)}, which does not descend from the candidate ${candidateSha.slice(0, 8)}. A run that does not contain this code cannot describe it; a run at a head the candidate SUPERSEDES must say \`describesSupersededHead\` instead.`
        );
        continue;
      }
      const diff = git([
        'diff',
        '--name-only',
        `${candidateSha}..${head}`,
        '--',
        'apps',
        'supabase',
      ]);
      if (diff === null) {
        problems.push(
          `${name}: \`git diff --name-only ${candidateSha.slice(0, 8)}..${head.slice(0, 8)} -- apps supabase\` could not be taken, so product identity is UNKNOWN — and unknown is not identical`
        );
        continue;
      }
      const productDrift = lines(diff);
      if (productDrift.length > 0) {
        problems.push(
          `${name}: cites a run at ${head.slice(0, 8)}, where ${productDrift.length} PRODUCT path(s) differ from the candidate — ${productDrift.slice(0, 5).join(', ')}. That run measured different software.`
        );
        continue;
      }
      bound.push(name);
      boundAtSuccessor.push(
        `${name} — run head ${head.slice(0, 8)}, product-identical to the candidate`
      );
      continue;
    }
    superseded.push(name);
    if (!marked) {
      /*
       * AN UNDECLARED HEAD IS REFUSED — which is what the docblock above has
       * always said and what this line used to contradict.
       *
       * It read `if (!marked) continue;`, deferring to "tierBinding /
       * packageArithmetic own the undeclared case". That is true of the five
       * `tiers.*.hostedAttestation` sites, which `tierBinding` checks for
       * fetchability. It is NOT true of the six top-level sites — `hostedCi`,
       * `codeql`, `database`, `browserByProject`, `dependencySecurity`,
       * `productionBuild` — which no other rule validates, so omitting the
       * marker took the head out of check entirely while the binding stayed in
       * the pending list and the package stayed green.
       *
       * Measured against the committed package by deleting the marker from
       * `codeql`: a head this repository does not contain was ACCEPTED, a head
       * that is not an ancestor of the candidate was ACCEPTED, and a binding
       * with no `supersededBy` at all was ACCEPTED. "A head nobody can fetch is
       * not a citation" was the rule three lines below, unreachable.
       *
       * So the declaration is now mandatory rather than merely load-bearing: a
       * head that is not the candidate must SAY whether it precedes or follows
       * it, and both answers are then checked.
       */
      problems.push(
        `${name}: names head ${head.slice(0, 8) || '(none)'}, which is not the candidate, and declares neither \`describesSupersededHead\` nor \`${SUCCESSOR_MARKER}\`. A head that is not the candidate is either behind it or ahead of it, and the package must say which — an undeclared head is checked by nothing.`
      );
      continue;
    }
    if (!/^[0-9a-f]{40}$/.test(head)) {
      problems.push(`${name}: declares a superseded head \`${head}\` that is not a commit id`);
      continue;
    }
    if (git(['cat-file', '-e', `${head}^{commit}`]) === null) {
      problems.push(
        `${name}: declares superseded head ${head}, which names no commit in this repository — a head nobody can fetch is not a citation`
      );
      continue;
    }
    if (git(['merge-base', '--is-ancestor', head, candidateSha]) === null) {
      problems.push(
        `${name}: declares superseded head ${head.slice(0, 8)}, which is not an ancestor of the candidate, so it is not a head this candidate supersedes`
      );
      continue;
    }
    if (!String(record.supersededBy ?? '').trim()) {
      problems.push(
        `${name}: describes a superseded head and says nothing about what replaces it — \`supersededBy\` must name the observation that is awaited`
      );
    }
  }

  const declaredBlock = candidateFile.pendingHostedBindings;
  const declared = Array.isArray(declaredBlock?.bindings)
    ? [...declaredBlock.bindings].map(String).sort()
    : null;
  const computed = [...superseded].sort();

  if (declared === null) {
    if (computed.length > 0) {
      problems.push(
        `pendingHostedBindings: ${computed.length} binding(s) describe a head other than the candidate and the package declares no pending list — ${computed.join(', ')}`
      );
    }
  } else if (declared.join('|') !== computed.join('|')) {
    problems.push(
      `pendingHostedBindings declares [${declared.join(', ') || 'none'}]; the package's own headSha fields compute [${computed.join(', ') || 'none'}]`
    );
  } else if (computed.length > 0 && !String(declaredBlock?.awaits ?? '').trim()) {
    problems.push('pendingHostedBindings names no observation that is awaited');
  }

  return {
    problems,
    superseded: computed,
    declared: declared ?? [],
    bound: [...bound].sort(),
    boundAtSuccessor: [...boundAtSuccessor].sort(),
  };
}

/** `planned` for a browser tier, `tests` for a collected one. */
const declaredTotal = (tier) => (typeof tier.planned === 'number' ? tier.planned : tier.tests);

/**
 * Every tier figure, checked against the thing it names.
 *
 * Three separate obligations, because they are three separate kinds of claim:
 *
 *   ARITHMETIC — `passed + failed + skipped` must be the declared total, for
 *   every tier regardless of provenance. This is what caught the review's second
 *   mutation: `passed: 3, failed: 812` beside `tests: 2475` was accepted by the
 *   first revision because nothing added the three numbers up.
 *
 *   LOCAL — the figures must equal the run ledger's, read out of git at the
 *   commit the tier names. Pinned to a commit rather than read from the working
 *   tree because the ledger MOVES: `check-p1-27-closing-values.mjs --record`
 *   rewrites it at whatever head it was last taken at, so a check against the
 *   working copy would go red on the next unrelated re-record and be relaxed.
 *   The measurement's own head is then required to differ from the candidate by
 *   no executable path — COMPUTED here, where the package used to assert it in
 *   a sentence beginning "Verify with `git diff`".
 *
 *   HOSTED — cannot be computed from this repository at all, and the gate says
 *   so in those words. What it can require is that the claim is FETCHABLE: a run
 *   id, a job id, the head the job ran at, and the artefact's name. A hosted
 *   figure without those is an assertion; with them it is an attestation a later
 *   reader can go and disagree with.
 */
export function tierBinding(candidateFile, git) {
  const candidateSha = candidateFile.candidate?.FINAL_CODE_SHA ?? '';
  const tiers = candidateFile.tiers ?? {};
  // Computed first, because whether a tier's hosted half is BOUND is a question
  // about the repository — containment, descent and product identity — and this
  // is the one place that asks it.
  const pendingAnalysis = pendingBinding(candidateFile, git);
  const boundSites = new Set(pendingAnalysis.bound);
  const arithmetic = [];
  const localProblems = [];
  const hostedProblems = [];
  const verifiedLocally = [];
  const attested = [];
  const pending = [];

  for (const [name, tier] of Object.entries(tiers)) {
    const total = declaredTotal(tier);
    const parts = (tier.passed ?? 0) + (tier.failed ?? 0) + (tier.skipped ?? 0);
    if (typeof total !== 'number') {
      arithmetic.push(
        `${name}: declares neither \`tests\` nor \`planned\`, so nothing adds up to it`
      );
    } else if (total !== parts) {
      arithmetic.push(
        `${name}: declares ${total} but passed ${tier.passed} + failed ${tier.failed} + skipped ${tier.skipped} = ${parts}`
      );
    }

    if (!ALL_PROVENANCES.includes(tier.provenance)) {
      hostedProblems.push(
        `${name}: provenance \`${tier.provenance}\` is none of ${ALL_PROVENANCES.join(', ')}`
      );
      continue;
    }
    const isPending = PENDING_PROVENANCES.includes(tier.provenance);

    const attestation = tier.hostedAttestation ?? {};
    const missing = [];
    for (const field of ['runId', 'jobId']) {
      if (!Number.isInteger(attestation[field]) || attestation[field] <= 0) {
        missing.push(`hostedAttestation.${field} is not a run/job id`);
      }
    }
    if (isPending) {
      // A PENDING tier still has to cite something a reader can fetch — the
      // superseded run — and it has to say that is what it is citing. Silence
      // here would let "pending" mean "the numbers are from somewhere".
      if (attestation.describesSupersededHead !== true) {
        missing.push(
          `provenance is ${tier.provenance} and its attestation does not declare \`describesSupersededHead\`, so the head these figures belong to is unstated`
        );
      }
    } else if (attestation.describesSupersededHead === true) {
      missing.push(
        `provenance \`${tier.provenance}\` claims a hosted observation OF THE CANDIDATE while its attestation describes a head the candidate supersedes`
      );
    } else if (attestation.headSha !== candidateSha) {
      // A run taken at a product-identical DESCENDANT is a run at this code, and
      // it must say so. `pendingBinding` owns whether the repository bears the
      // declaration out; this owns the undeclared case, exactly as before.
      if (attestation[SUCCESSOR_MARKER] !== true) {
        missing.push(
          `hostedAttestation.headSha \`${attestation.headSha}\` is not the candidate ${candidateSha}`
        );
      } else if (!boundSites.has(`tiers.${name}.hostedAttestation`)) {
        missing.push(
          `hostedAttestation declares a product-identical successor run head \`${attestation.headSha}\` that the repository does not bear out`
        );
      }
    }
    if (!String(attestation.artefact ?? '').trim())
      missing.push('hostedAttestation names no artefact');

    /*
     * THE HEADLINE AND THE ARTEFACT IT CITES MUST BE THE SAME MEASUREMENT.
     *
     * `hostedTotals` was added to this package when the pending bindings were
     * resolved, carrying what the downloaded artefacts actually said. The tier
     * headline beside it was left at its previous values, and nothing compared
     * the two — so the package shipped `backend: 2004 tests, 86 files` next to
     * its own attestation of 2056 and 88, and `database: 1647, 139` next to
     * 1717 and 143. Both were green. That is the HALF-UPDATE this package's own
     * `supersededObservations.whyKept` warns about, one field lower down.
     *
     * `passed` is deliberately NOT forced. The hosted unit run leaves the
     * storage round-trip cases pending where no S3 store is configured, so a
     * local 2777-of-2777 beside a hosted 2774 is a real and declared
     * difference. It is admitted only when the attestation SAYS so: the package
     * already claimed in prose that "total, failed and file count agree
     * exactly", and this is that sentence made computable rather than trusted.
     */
    /*
     * ...but only where the attestation claims to be ABOUT this candidate.
     *
     * A binding that declares `describesSupersededHead` is citing a run at a
     * head this candidate has moved past — by construction a different tree. Its
     * `hostedTotals` are the figures for that tree, while the headline beside
     * them is the LOCAL measurement of this one, and the package says which is
     * which. Requiring those to be equal would demand that re-freezing software
     * not change how many tests it has.
     *
     * This is a narrowing of the rule, not a hole in it: the headline of a
     * pending tier is still bound, by the LOCAL half above, to a run ledger
     * pinned at a commit — which is the stronger of the two checks, because it
     * is computed here rather than cited.
     */
    const totals = attestation.describesSupersededHead === true ? null : attestation.hostedTotals;
    if (totals && typeof totals === 'object') {
      const declared = declaredTotal(tier);
      /*
       * A HOSTED FAILURE cannot be sealed — and that is a question about the
       * hosted run alone.
       *
       * An earlier revision of this rule compared the tier's LOCAL `failed`
       * with the hosted artefact's, which was wrong twice over. They are
       * different runs of different trees, so a difference between them is
       * ordinary; and requiring equality made the rule SELF-REFERENTIAL — a
       * package that honestly recorded a red local run could never declare it
       * without failing the very cases that produce the redness, so the count
       * converged to two and stopped there. A rule that cannot be satisfied by
       * telling the truth is not a rule.
       *
       * What actually matters is simpler: the hosted artefact this package cites
       * must report no failures. The LOCAL figures are already bound, and far
       * more strictly, by the local half above — they are read out of a run
       * ledger pinned at a commit, and `judgeRunLedger` refuses a record that
       * carries failures at all.
       *
       * The size figures stay declarable. How many tests EXIST is a fact about a
       * tree: cases added to `tests/ci` after a hosted run change `total` and
       * `files` while apps/** and supabase/** stay byte-identical. That still
       * catches what the rule was written for — the shipped package stated
       * `backend: 2004 tests, 86 files` beside its own attestation of 2056 and
       * 88 with NO explanation, because those figures were stale rather than
       * different.
       */
      if (Number.isInteger(totals.failed) && totals.failed > 0) {
        missing.push(
          `cites a hosted run reporting ${totals.failed} failure(s). A hosted failure is a failure, and no declaration seals one`
        );
      }

      const explained = String(attestation.localVersusHosted ?? '').trim().length > 0;
      if (!explained) {
        for (const [what, mine, hosted] of [
          ['total', declared, totals.total],
          ['files', tier.files, totals.files],
          ['passed', tier.passed, totals.passed],
        ]) {
          if (Number.isInteger(hosted) && Number.isInteger(mine) && mine !== hosted) {
            missing.push(
              `declares ${what} ${mine} beside a hosted attestation of ${hosted}, and nothing says why — a difference between what ran here and what ran there is admissible, but only when the package states it`
            );
          }
        }
      }
    }

    /*
     * A tier with no local run must not name a measurement head other than the
     * one it cites. `measuredAtCommit` on all three hosted-only tiers still
     * read 1a186a7b after their attestations moved to 9d00a454 — a head the
     * figures did not come from, sitting unchecked beside one they did.
     */
    if (
      !LOCAL_PROVENANCES.includes(tier.provenance) &&
      typeof tier.measuredAtCommit === 'string' &&
      typeof attestation.headSha === 'string' &&
      tier.measuredAtCommit !== attestation.headSha
    ) {
      missing.push(
        `has no local run yet names measuredAtCommit ${tier.measuredAtCommit.slice(0, 8)} while its attestation cites ${attestation.headSha.slice(0, 8)} — the figures cannot have come from both`
      );
    }
    if (missing.length > 0) hostedProblems.push(...missing.map((m) => `${name}: ${m}`));
    else if (isPending) {
      pending.push(
        `${name} — awaiting a run at the candidate; cites superseded run ${attestation.runId}, job ${attestation.jobId} at ${String(attestation.headSha).slice(0, 8)}`
      );
    } else
      attested.push(
        `${name} — run ${attestation.runId}, job ${attestation.jobId}` +
          (attestation.headSha === candidateSha
            ? ''
            : ` at the product-identical successor ${String(attestation.headSha).slice(0, 8)}`)
      );

    /*
     * A tier that HOLDS a local measurement may not relabel itself hosted-only.
     *
     * `HOSTED_PENDING_AT_CANDIDATE` is legitimate for a tier this repository
     * cannot measure — `backend`, `database` and `browser` declare it because
     * there is no local run to compute against. It is NOT a label a tier with a
     * run ledger may adopt: `LOCAL_PROVENANCES` excludes it, so the line below
     * skips the ledger binding, the figure comparison, the `measuredAtCommit`
     * pin and the whole drift computation, and every one of those obligations
     * disappears from a package that still shows the ledger it is no longer
     * checked against.
     *
     * Found by mutating the committed package: setting `tiers.unit.provenance`
     * to `HOSTED_PENDING_AT_CANDIDATE` left the gate GREEN while `unit` kept its
     * `localLedger`, its tests, its files and its measured commit. That is the
     * pending mode working as a general escape hatch, which is the one thing it
     * must not become — a hosted binding may be awaited, but a LOCAL figure is
     * either computed here or it is not evidence.
     *
     * The contradiction is what is refused, not the provenance: saying "no local
     * observation exists" while carrying the local observation.
     */
    if (
      !LOCAL_PROVENANCES.includes(tier.provenance) &&
      tier.localLedger &&
      typeof tier.localLedger === 'object'
    ) {
      localProblems.push(
        `${name}: declares provenance ${String(tier.provenance)}, which claims no local observation of this candidate, while carrying a \`localLedger\` that names one — ${String(tier.localLedger.path ?? 'a ledger')}. A tier holding a local measurement must declare a local provenance (${LOCAL_PROVENANCES.join(' or ')}), because that label is what puts the figures, the ledger binding and the measurement head under check.`
      );
    }

    if (!LOCAL_PROVENANCES.includes(tier.provenance)) continue;

    const ledger = tier.localLedger ?? {};
    const extras = Object.keys(tier).filter(
      (key) => typeof tier[key] === 'number' && !LEDGER_FIGURES.includes(key)
    );
    if (extras.length > 0) {
      localProblems.push(
        `${name}: records ${extras.join(', ')}, which ${ledger.path ?? 'the run ledger'} does not carry, so nothing can check them`
      );
    }
    if (!/^[0-9a-f]{40}$/.test(String(ledger.atCommit ?? '')) || !ledger.path || !ledger.tier) {
      localProblems.push(
        `${name}: claims a local measurement and names no ledger (path, tier, atCommit)`
      );
      continue;
    }

    const raw = git(['show', `${ledger.atCommit}:${ledger.path}`]);
    if (raw === null) {
      localProblems.push(
        `${name}: ${ledger.path} does not exist at ${ledger.atCommit}, so the figures are checked against nothing`
      );
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(raw)?.tiers?.[ledger.tier];
    } catch {
      entry = undefined;
    }
    if (!entry) {
      localProblems.push(
        `${name}: ${ledger.path} at ${ledger.atCommit} has no \`${ledger.tier}\` tier`
      );
      continue;
    }
    for (const field of LEDGER_FIGURES) {
      if (tier[field] !== entry[field]) {
        localProblems.push(
          `${name}.${field}: the package records ${tier[field]}; ${ledger.path} at ${ledger.atCommit} records ${entry[field]}`
        );
      }
    }
    if (entry.measuredAtCommit !== tier.measuredAtCommit) {
      localProblems.push(
        `${name}: the package says it was measured at ${tier.measuredAtCommit}; the ledger entry says ${entry.measuredAtCommit}`
      );
      continue;
    }
    const drift = lines(
      git(['diff', '--name-only', `${tier.measuredAtCommit}..${candidateSha}`])
    ).filter((path) => !isDocumentationPath(path));
    const declaredDrift = Array.isArray(tier.measurementDrift)
      ? [...tier.measurementDrift].map(String).sort()
      : null;

    if (drift.length === 0) {
      if (declaredDrift !== null) {
        localProblems.push(
          `${name}: declares measurementDrift while no executable path differs between ${tier.measuredAtCommit.slice(0, 8)} and the candidate — a decorative field beside a figure is the thing this package is against`
        );
        continue;
      }
      verifiedLocally.push(`${name} — ${ledger.path}@${ledger.atCommit.slice(0, 8)}`);
      continue;
    }

    /*
     * The measurement head is not executable-identical to the candidate.
     *
     * There is exactly one admissible reason, and it is the shape this package
     * has always had: the seal cannot be inside the candidate it seals, so its
     * machinery lands as a NAMED successor, and the tiers are then re-run at
     * that successor because a tier run before it would describe a suite that no
     * longer exists. What must not be admissible is a measurement from anywhere
     * else, so all four of these are required together:
     *
     *   the measurement head is named either in the CURRENT `successors` range
     *   or in `absorbedSuccessors`, whose separate repository check proves it
     *   lies between the candidate and the resolved base (a later remediation
     *   branch must not invalidate the pinned measurement it inherited);
     *   no PRODUCT path is in the drift — the freeze is about apps/** and
     *   supabase/**, and a product difference makes the figure a measurement of
     *   different software;
     *   the package DECLARES the drift, path by path; and
     *   the declared list is exactly the computed one.
     *
     * The reader is then told what differed instead of being told nothing.
     */
    const namedCurrent = (candidateFile.successors ?? []).some(
      (s) => String(s?.commit ?? '') === tier.measuredAtCommit
    );
    const namedAbsorbed = (candidateFile.absorbedSuccessors ?? []).some(
      (s) => String(s?.commit ?? '') === tier.measuredAtCommit
    );
    const named = namedCurrent || namedAbsorbed;
    const productDrift = drift.filter(isProductPath);
    const computed = [...drift].sort();

    if (!named) {
      localProblems.push(
        `${name}: measured at ${tier.measuredAtCommit.slice(0, 8)}, and ${drift.length} executable path(s) differ between that commit and the candidate — ${computed.slice(0, 5).join(', ')}. A measurement head that is neither a NAMED current successor nor a base-absorbed successor must be executable-identical to the candidate.`
      );
    } else if (productDrift.length > 0) {
      localProblems.push(
        `${name}: measured at the named successor ${tier.measuredAtCommit.slice(0, 8)}, and ${productDrift.length} PRODUCT path(s) differ from the candidate — ${productDrift.slice(0, 5).join(', ')}. That is a measurement of different software, not of this candidate.`
      );
    } else if (declaredDrift === null) {
      localProblems.push(
        `${name}: measured at the named successor ${tier.measuredAtCommit.slice(0, 8)} and declares no \`measurementDrift\`, so a reader is not told which ${drift.length} executable path(s) the measured tree carried that the candidate does not`
      );
    } else if (declaredDrift.join('|') !== computed.join('|')) {
      localProblems.push(
        `${name}: declares measurementDrift [${declaredDrift.join(', ')}]; \`git diff --name-only ${tier.measuredAtCommit.slice(0, 8)}..${candidateSha.slice(0, 8)}\` computes [${computed.join(', ')}]`
      );
    } else {
      verifiedLocally.push(
        `${name} — ${ledger.path}@${ledger.atCommit.slice(0, 8)}, measured at named successor ${tier.measuredAtCommit.slice(0, 8)} with ${computed.length} declared non-product path(s) of drift`
      );
    }
  }

  hostedProblems.push(...pendingAnalysis.problems);

  return {
    arithmetic,
    localProblems,
    hostedProblems,
    verifiedLocally,
    attested,
    pending,
    supersededBindings: pendingAnalysis.superseded,
    boundBindings: pendingAnalysis.bound,
    boundAtSuccessor: pendingAnalysis.boundAtSuccessor,
  };
}

/**
 * The figures the package lists item by item, added up.
 *
 * `hostedCi` enumerates 21 checks and then states 21; `browserByProject`
 * enumerates three projects and then states 141. Neither total was derived from
 * the list beneath it, so either could have been typed wrong or edited later.
 * These are the only figures in the package a reader can check without leaving
 * the file, which is exactly why they should be checked here.
 */
export function packageArithmetic(candidateFile) {
  const problems = [];
  const sha = candidateFile.candidate?.FINAL_CODE_SHA ?? '';

  const ci = candidateFile.hostedCi ?? {};
  const checks = Array.isArray(ci.checks) ? ci.checks : [];
  if (ci.headSha !== sha && ci.describesSupersededHead !== true && ci[SUCCESSOR_MARKER] !== true) {
    problems.push(
      `hostedCi.headSha \`${ci.headSha}\` is not the candidate ${sha}, and it declares neither \`describesSupersededHead\` nor \`${SUCCESSOR_MARKER}\``
    );
  }
  if (ci.checksTotal !== checks.length) {
    problems.push(`hostedCi declares ${ci.checksTotal} checks and lists ${checks.length}`);
  }
  const succeeded = checks.filter((c) => c?.conclusion === 'success').length;
  if (ci.checksSuccess !== succeeded) {
    problems.push(`hostedCi declares ${ci.checksSuccess} successes and lists ${succeeded}`);
  }
  if (ci.checksTotal !== (ci.checksSuccess ?? 0) + (ci.checksFailure ?? 0)) {
    problems.push(
      `hostedCi: ${ci.checksSuccess} success + ${ci.checksFailure} failure is not ${ci.checksTotal}`
    );
  }

  const browser = candidateFile.browserByProject ?? {};
  const projects = Object.entries(browser.projects ?? {});
  if (
    browser.headSha !== sha &&
    browser.describesSupersededHead !== true &&
    browser[SUCCESSOR_MARKER] !== true
  ) {
    problems.push(
      `browserByProject.headSha \`${browser.headSha}\` is not the candidate ${sha}, and it declares neither \`describesSupersededHead\` nor \`${SUCCESSOR_MARKER}\``
    );
  }
  const planned = projects.reduce((sum, [, p]) => sum + (p?.planned ?? 0), 0);
  if (browser.total !== planned) {
    problems.push(`browserByProject declares ${browser.total} and its projects plan ${planned}`);
  }
  for (const [project, p] of projects) {
    const parts = (p?.passed ?? 0) + (p?.failed ?? 0) + (p?.skipped ?? 0);
    if (p?.planned !== parts) {
      problems.push(`browserByProject.${project}: planned ${p?.planned}, accounted ${parts}`);
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * Claims the verdict register makes about the tree
 * ------------------------------------------------------------------ */

/**
 * The spec names the `authenticated-tablet` project matches, read off the
 * config's own `testMatch` literal.
 *
 * Returns `null` when the project or its `testMatch` is not there — an unknown
 * answer, never a convenient one. The alternation is read as TEXT rather than
 * compiled: a `RegExp` built from a file this script reads is a regex-injection
 * flow, and nothing here needs the matching power.
 */
export function tabletProjectSpecs(source) {
  const at = String(source ?? '').indexOf("name: 'authenticated-tablet'");
  if (at < 0) return null;
  const match = /testMatch:\s*\/([^\n]*?)\/[gimsuy]*\s*,/.exec(String(source).slice(at));
  if (!match) return null;
  const group = /\(([^)]*)\)/.exec(match[1]);
  const names = (group ? group[1] : match[1])
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  return { literal: match[1], names };
}

/**
 * What is TRUE at this candidate, computed, for the claims below to be measured
 * against.
 *
 * Split into a pure half and a reading half so `selfCheck` can drive the pure
 * half over a synthetic `playwright.config.ts` — including a NARROWED one, where
 * the tablet sentence becomes true again and must be accepted.
 *
 * @param {Record<string, any>} candidateFile
 * @param {{ names: string[] } | null} tablet
 * @param {Set<string> | null} [boundSites] which named blocks are bound to this
 *   candidate's product, as `pendingBinding` COMPUTES it. Omitted means "not
 *   computed", and falls back to the stricter `headSha === candidate`.
 */
export function worldFrom(candidateFile, tablet, boundSites = null) {
  const sha = candidateFile.candidate?.FINAL_CODE_SHA ?? '';
  const ci = candidateFile.hostedCi ?? {};
  const browser = candidateFile.browserByProject ?? {};

  const tierRows = Object.values(candidateFile.tiers ?? {});

  /*
   * Whether a block is bound to THIS CODE, which is not the same question as
   * whether it names this COMMIT. `pendingBinding` computes it — a head that is
   * the candidate, or a product-identical descendant the repository bears out —
   * and passes the answer in. With no answer available the question falls back
   * to the stricter of the two, `headSha === candidate`, so a caller that
   * cannot compute the world never gets the more generous reading by default.
   */
  const isBound = (block, name) =>
    boundSites === null ? block.headSha === sha : boundSites.has(name);

  return {
    hostedCiRecorded: isBound(ci, 'hostedCi') && Number(ci.checksTotal) > 0,
    /*
     * How many tiers the package itself says were NOT measured at this candidate
     * at all. `LOCAL_COMPUTED_HOSTED_PENDING` is deliberately NOT counted: that
     * tier WAS re-run here and only its hosted half is outstanding, so counting
     * it would make the refutation below say something false in the other
     * direction. The anchored claim this feeds is about tiers with no
     * measurement of this candidate, and that is exactly what this counts.
     */
    unmeasuredTierCount: tierRows.filter((t) => t?.provenance === PROVENANCE_HOSTED_PENDING).length,
    tierCount: tierRows.length,
    tabletMatchesOnlyAdministration: tablet !== null && tablet.names.join('|') === 'administration',
    tabletNames: tablet?.names ?? [],
    tabletObservedThisPhase:
      isBound(browser, 'browserByProject') &&
      Number(browser.projects?.['authenticated-tablet']?.passed ?? 0) > 0 &&
      String(browser.spec ?? '') === PHASE_SPEC,
    phaseSpecObservedHosted:
      isBound(browser, 'browserByProject') &&
      Number(browser.total ?? 0) > 0 &&
      String(browser.spec ?? '') === PHASE_SPEC,
  };
}

export function claimWorld(root, candidateFile, git = gitReader(root)) {
  const configPath = join(root, PLAYWRIGHT_CONFIG.split(posix.sep).join(sep));
  return worldFrom(
    candidateFile,
    existsSync(configPath) ? tabletProjectSpecs(readFileSync(configPath, 'utf8')) : null,
    new Set(pendingBinding(candidateFile, git).bound)
  );
}

/**
 * Sentences a document may not carry while the repository says otherwise.
 *
 * This is the F4 class made mechanical. Thirty verdict rows told the Owner, in
 * the present tense, that the tablet project observes no P1-28 screen and that
 * no hosted-CI result exists for this head. Both were false at the candidate,
 * and the citation beside the first one landed on a docblock DESCRIBING the
 * state it was describing — so the citation appeared to confirm the claim.
 * Nothing parsed these strings, so nothing could disagree with them.
 *
 * Each entry is a pattern plus the condition under which the repository REFUTES
 * it. A claim is a violation only while its refutation holds: narrow the tablet
 * project again and the sentence becomes legal again, because it becomes true
 * again. A rule that banned the words outright would be a spell-checker.
 */
export const ANCHORED_CLAIMS = Object.freeze([
  {
    id: 'no-hosted-ci',
    pattern: /no hosted-CI result is recorded for this head/i,
    refutedWhen: (world) => world.hostedCiRecorded,
    says: (_world, candidateFile) =>
      `the package records hosted CI at the candidate — run ${candidateFile.hostedCi?.runId}, ` +
      `${candidateFile.hostedCi?.checksTotal} checks, ${candidateFile.hostedCi?.checksSuccess} success`,
  },
  {
    id: 'tablet-administration-only',
    pattern: /(?:runs|matches)\s+`administration\.spec\.ts`\s+only/i,
    refutedWhen: (world) => !world.tabletMatchesOnlyAdministration,
    says: (world) =>
      `${PLAYWRIGHT_CONFIG} matches ${world.tabletNames.join(', ') || 'nothing this reader could resolve'} in the authenticated-tablet project`,
  },
  {
    id: 'tablet-unobserved',
    pattern: /no P1-28 screen is observed at a tablet viewport/i,
    refutedWhen: (world) => world.tabletObservedThisPhase,
    says: (_world, candidateFile) =>
      `the package records ${candidateFile.browserByProject?.projects?.['authenticated-tablet']?.passed} passed P1-28 cases in authenticated-tablet at the candidate`,
  },
  {
    id: 'phase-spec-never-hosted',
    pattern: /no hosted run has yet covered the seventh spec/i,
    refutedWhen: (world) => world.phaseSpecObservedHosted,
    says: (_world, candidateFile) =>
      `the package records run ${candidateFile.browserByProject?.runId}, job ${candidateFile.browserByProject?.jobId} covering ${PHASE_SPEC} at the candidate`,
  },
  {
    id: 'seventh-spec-unobserved',
    pattern: /THE SEVENTH SPEC HAS NOT BEEN OBSERVED ON A HOSTED RUNNER/i,
    refutedWhen: (world) => world.phaseSpecObservedHosted,
    says: (_world, candidateFile) =>
      `run ${candidateFile.browserByProject?.runId} / job ${candidateFile.browserByProject?.jobId} executed ${candidateFile.browserByProject?.total} cases of that spec at the candidate`,
  },

  /* -------------------------------------------------------------- *
   * The same rule pointed the OTHER way.
   *
   * Every claim above bans a sentence that DENIES evidence which exists. That
   * caught thirty verdict rows and it is exactly half of the failure: when the
   * candidate is re-frozen after a fix wave, the hosted observation stays behind
   * on the head it was taken at, and the thirty-three cells that were corrected
   * to say the evidence EXISTS become the over-claim. A gate that only refuses
   * pessimism about its own evidence is a gate that ratchets one way.
   *
   * So these three ban a sentence asserting an observation OF THIS CANDIDATE
   * while the package itself records none. They are refuted by the same computed
   * world the negative ones read, and they go quiet the moment a run at the
   * candidate is bound — which is the discipline, not a word ban.
   * -------------------------------------------------------------- */
  {
    id: 'hosted-observed-at-this-candidate',
    pattern: /OBSERVED AT THIS CANDIDATE/i,
    refutedWhen: (world) => !world.hostedCiRecorded,
    says: (_world, candidateFile) =>
      `the package records no hosted CI bound to the candidate ${String(candidateFile.candidate?.FINAL_CODE_SHA ?? '').slice(0, 8)} — ` +
      `hostedCi describes ${String(candidateFile.hostedCi?.headSha ?? 'no head').slice(0, 8)}, which is neither the candidate nor a successor whose product this repository computes to be identical to it`,
  },
  {
    id: 'browser-tier-bound-at-candidate',
    pattern: /browser tier IS observed and bound/i,
    refutedWhen: (world) => !world.phaseSpecObservedHosted,
    says: (_world, candidateFile) =>
      `browserByProject describes ${String(candidateFile.browserByProject?.headSha ?? 'no head').slice(0, 8)}, which this package does not bind to the candidate ` +
      `${String(candidateFile.candidate?.FINAL_CODE_SHA ?? '').slice(0, 8)}, so no browser result is bound to this code`,
  },
  {
    id: 'every-tier-re-run-here',
    pattern: /all five tiers (?:were )?re-run against the (?:frozen )?candidate/i,
    refutedWhen: (world) => world.unmeasuredTierCount > 0,
    says: (world) =>
      `${world.unmeasuredTierCount} of ${world.tierCount} tiers carry no measurement of this candidate at all — their figures are a superseded head's`,
  },
]);

/** A `path:line` or `path:from-to` citation, repository-relative. */
export const CITATION_PATTERN = /`([A-Za-z0-9._/-]+\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?`/g;

const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts)$/;

/**
 * A line that carries no behaviour. Deliberately crude and deliberately
 * one-sided: it can call a line of code a comment (a `*` at the start of a
 * template literal) and never the reverse, so the rule below can demand more
 * evidence than a citation offers and never less.
 */
const isCommentLine = (line) => {
  const text = line.trim();
  return text === '' || text.startsWith('//') || text.startsWith('*') || text.startsWith('/*');
};

/**
 * Every claim and every citation the verdict register makes, judged.
 *
 * `contradictions` — an anchored claim the repository refutes, anywhere in any
 * cell of any row. Register-wide because the stale sentence had already escaped
 * `PROTECTED_REPROOF` into a `FINDING_IDS` cell.
 *
 * `citations` — restricted to `PROTECTED_REPROOF`, which is where the reproof
 * argument is made and where every citation is already repository-relative. The
 * other fields cite by short path (`appointments/page.tsx:38`) and resolving
 * those belongs to `validate:p1-28-traceability`, not here; a rule that reported
 * 281 unresolvable citations on its first run would be turned off.
 *
 * A citation must resolve, must lie inside the file, and — in a source file —
 * must include at least one line that is not a comment. That last clause is the
 * one that would have caught this: `apps/web/playwright.config.ts:225-233` is
 * nine consecutive comment lines, and the docblock they sit in describes the
 * PAST state, so it reads as confirmation of the sentence it was cited for.
 */
export function verdictClaims(verdicts, world, candidateFile, readLines) {
  const contradictions = [];
  const citations = [];

  for (const [id, row] of Object.entries(verdicts ?? {})) {
    for (const [field, cell] of Object.entries(row ?? {})) {
      if (typeof cell !== 'string') continue;

      for (const claim of ANCHORED_CLAIMS) {
        if (claim.pattern.test(cell) && claim.refutedWhen(world)) {
          contradictions.push(`${id}.${field}: ${claim.id} — ${claim.says(world, candidateFile)}`);
        }
      }

      if (field !== 'PROTECTED_REPROOF') continue;
      for (const [, file, from, to] of cell.matchAll(CITATION_PATTERN)) {
        const start = Number(from);
        const end = to ? Number(to) : start;
        const source = readLines(file);
        if (source === null) {
          citations.push(
            `${id}: cites \`${file}:${from}\`, which is not a file in this repository`
          );
          continue;
        }
        if (start < 1 || end < start || end > source.length) {
          citations.push(
            `${id}: cites \`${file}:${from}${to ? `-${to}` : ''}\`, and the file holds ${source.length} lines`
          );
          continue;
        }
        if (SOURCE_FILE.test(file) && source.slice(start - 1, end).every(isCommentLine)) {
          citations.push(
            `${id}: cites \`${file}:${from}${to ? `-${to}` : ''}\`, which is comment only — a docblock can describe a state the code no longer has, so it confirms a claim by sitting near it`
          );
        }
      }
    }
  }
  return { contradictions, citations };
}

/** Reads a file's lines, or `null` when it is not there. */
export function lineReader(root = ROOT) {
  const cache = new Map();
  return (relative) => {
    if (!cache.has(relative)) {
      const target = join(root, relative.split(posix.sep).join(sep));
      cache.set(relative, existsSync(target) ? readFileSync(target, 'utf8').split(/\r?\n/) : null);
    }
    return cache.get(relative);
  };
}

/**
 * The CI baseline's own prose, judged by the same anchored claims.
 *
 * `.github/ci-baselines/unrun-test-tiers.json` is the file a reader of a green
 * pull request consults to learn what that green does not cover, and its
 * `hostedObservation` field is printed verbatim into every job summary. It said
 * the P1-28 browser spec had never run on a hosted runner for as long as the run
 * that ran it was recorded three files away.
 */
export function baselineClaimsFrom(text, world, candidateFile) {
  const problems = [];
  for (const claim of ANCHORED_CLAIMS) {
    if (claim.pattern.test(text) && claim.refutedWhen(world)) {
      problems.push(`${BASELINE_PATH}: ${claim.id} — ${claim.says(world, candidateFile)}`);
    }
  }
  return problems;
}

/**
 * The same anchored claims applied to the CI baseline and to the prose half of
 * the package.
 *
 * Both are documents a reader consults for exactly the facts these claims are
 * about — the baseline is printed verbatim into every job summary, and
 * `closure-evidence.md` is what an acceptance session rests on — so a sentence
 * the candidate refutes belongs in neither. A HISTORICAL statement is still
 * allowed and always was: write it in the past tense and the pattern stops
 * matching, which is the discipline, not a loophole.
 */
export function baselineClaims(root, world, candidateFile) {
  const problems = [];
  for (const relative of [BASELINE_PATH, PACKAGE_PATH]) {
    const target = join(root, relative.split(posix.sep).join(sep));
    if (!existsSync(target)) {
      problems.push(`${relative} is not in the tree`);
      continue;
    }
    for (const problem of baselineClaimsFrom(readFileSync(target, 'utf8'), world, candidateFile)) {
      problems.push(problem.replace(BASELINE_PATH, relative));
    }
  }
  return problems;
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
 * Report a candidate the REPOSITORY does not support. Returns true when sound.
 *
 * Everything here is the answer to a question put to `git`. The rule above it
 * (`reportCandidate`) asks whether the package agrees with itself; this asks
 * whether either half is describing this repository at all.
 */
export function reportRepository(binding, write = toStderr) {
  let sound = true;
  if (!binding.wellFormed) return sound; // reportCandidate owns the shape complaint.

  if (!binding.exists) {
    sound = false;
    write(
      `::error::the candidate ${binding.sha} names no commit in this repository. Forty hex characters is a SHAPE, not an object; the first revision of this gate checked only the shape and accepted \`deadbeef…\`.\n`
    );
    return sound; // Nothing below can be asked about a commit that is not there.
  }
  if (!binding.treeMatches) {
    sound = false;
    write(
      `::error::${CANDIDATE_PATH} records FINAL_CODE_TREE ${binding.tree}; \`git rev-parse ${binding.sha.slice(0, 8)}^{tree}\` is ${binding.actualTree}. The package names a tree that commit does not have.\n`
    );
  }
  /*
   * The successor set is "what this branch added after the candidate", and it
   * cannot be computed without the base branch. A checkout that cannot see the
   * base is refused rather than credited: "I could not tell" is not "there are
   * none", and the whole reason this rule exists is that a merge-ref checkout
   * made the BASE's commits look like this phase's.
   */
  if (!binding.baseResolved) {
    sound = false;
    write(
      `::error::the base branch \`${binding.baseBranch || '(unnamed)'}\` could not be resolved in this checkout AND could not be recovered from a merge ref, so the successor set is UNKNOWN and this gate fails closed. Tried ${(binding.baseAttempted ?? []).join(', ') || 'nothing — the package names no baseBranch'}, then HEAD's own parents. A shallow clone may carry none of them; fetch the base (\`fetch-depth: 0\`), check out the pull request's merge ref, or record the base this candidate sits on.\n`
    );
    return sound;
  }
  if (binding.topologyUnknown) {
    sound = false;
    write(
      `::error::the Git world at HEAD is UNKNOWN: ${binding.topologyUnknown}. Parent order, a failed Git command, or an ambiguous ancestry cannot be interpreted as an empty successor set; this gate fails closed.\n`
    );
    return sound;
  }
  if (binding.declinedUnwrap) {
    // Not a failure by itself — the merge is judged as an ordinary commit —
    // but a reader must be told the unwrap was declined and why.
    write(`::notice::HEAD is a merge that was NOT unwrapped: ${binding.declinedUnwrap}\n`);
  }
  if (binding.evilMergePaths.length > 0) {
    // Not a failure by itself — the merge is judged as an ordinary commit
    // below — but a reader must be told the unwrap was declined and why.
    write(
      `::notice::HEAD is a merge with ${binding.evilMergePaths.length} path(s) of its own, so it is NOT treated as a merge-ref preview of this branch: ${binding.evilMergePaths.slice(0, 5).join(', ')}\n`
    );
  }
  if (!binding.isAncestorOfHead) {
    sound = false;
    write(
      `::error::the candidate ${binding.sha.slice(0, 8)} is not an ancestor of ${String(binding.phaseHead ?? 'the head under test').slice(0, 8)}. A frozen candidate the current branch does not contain describes a tree nobody is looking at.\n`
    );
    return sound;
  }
  /*
   * A command that could not run has not said "nothing differs" and has not said
   * "no successors". Both refusals used to arrive as an empty list and read as
   * the good answer — the same fail-open shape as a base ref that resolves to
   * nothing — so each is refused in its own words.
   */
  if (binding.productDiffUnknown) {
    sound = false;
    write(
      `::error::\`git diff --name-only ${binding.sha.slice(0, 8)}..${String(binding.phaseHead).slice(0, 8)} -- apps supabase\` could not be taken, so product identity between the candidate and the head under test is UNKNOWN. Unknown is not identical, and this gate fails closed on it.\n`
    );
    return sound;
  }
  if (binding.rangeUnknown) {
    sound = false;
    write(
      `::error::\`git log ${String(binding.phaseHead).slice(0, 8)} --not ${binding.sha.slice(0, 8)} ${String(binding.baseSha).slice(0, 8)}\` could not be taken, so the successor set is UNKNOWN. An empty answer from a command that refused to run is not "this branch added nothing".\n`
    );
    return sound;
  }
  if (binding.productDiff.length > 0) {
    sound = false;
    write(
      `::error::${binding.productDiff.length} product file(s) differ between the candidate and ${String(binding.phaseHead).slice(0, 8)}. Every figure in this package describes the candidate, so the candidate must be re-frozen and re-measured. This is COMPUTED from \`git diff --name-only ${binding.sha.slice(0, 8)}..${String(binding.phaseHead).slice(0, 8)} -- apps supabase\`; the package used to assert it in a sentence.\n`
    );
    for (const path of binding.productDiff.slice(0, 20)) write(`  product file changed: ${path}\n`);
  }
  if (binding.malformedSuccessors.length > 0) {
    sound = false;
    write('::error::a successor is recorded without a 40-character commit id.\n');
    for (const id of binding.malformedSuccessors) write(`  not a commit id: \`${id}\`\n`);
  }
  if (binding.fabricatedSuccessors.length > 0) {
    sound = false;
    write(
      `::error::${CANDIDATE_PATH} records successors that are not in \`git log ${String(binding.phaseHead).slice(0, 8)} --not ${binding.sha.slice(0, 8)} ${String(binding.baseSha).slice(0, 8)}\`.\n`
    );
    for (const id of binding.fabricatedSuccessors)
      write(`  not a successor of the candidate: ${id}\n`);
  }
  if ((binding.absorbedProblems ?? []).length > 0) {
    sound = false;
    write(
      '::error::an `absorbedSuccessors` entry is not proven historical base ancestry. Absorbed entries may preserve pinned measurement heads, but they never satisfy current-branch successor coverage and must lie product-identically between the candidate and the resolved base.\n'
    );
    for (const problem of binding.absorbedProblems ?? []) write(`  ${problem}\n`);
  }
  if (binding.unrecordedExecutable.length > 0) {
    sound = false;
    write(
      `::error::a commit after the candidate changes an executable path and is not named in \`successors\`. A commit cannot name itself, so a DOCUMENTATION-ONLY successor may go unnamed and is printed instead; an executable one may not.\n`
    );
    for (const id of binding.unrecordedExecutable) {
      const commit = binding.commits.find((c) => c.sha === id);
      write(`  unrecorded executable successor: ${id} — ${commit?.subject ?? ''}\n`);
    }
  }
  return sound;
}

/** Report tier figures that are checked against nothing. Returns true when sound. */
export function reportTiers(binding, arithmetic, write = toStderr) {
  let sound = true;
  const all = [...binding.arithmetic, ...arithmetic];
  if (all.length > 0) {
    sound = false;
    write(
      '::error::a figure in this package does not add up to the figures beside it. `passed + failed + skipped` is the declared total, and a list of items is its own count.\n'
    );
    for (const problem of all) write(`  ${problem}\n`);
  }
  if (binding.localProblems.length > 0) {
    sound = false;
    write(
      '::error::a tier claims a LOCAL measurement that the run ledger it names does not support. A figure copied into this package and checked against nothing is the P1-27 failure this package was written to prevent.\n'
    );
    for (const problem of binding.localProblems) write(`  ${problem}\n`);
  }
  if (binding.hostedProblems.length > 0) {
    sound = false;
    write(
      '::error::a HOSTED figure cannot be computed from this repository, so the gate requires it to be FETCHABLE instead: a run id, a job id, the head the job ran at, and the artefact. Without those it is an assertion, not an attestation. A figure taken at a head this candidate SUPERSEDES may be cited only while it says so, names a head this repository contains, and is listed in `pendingHostedBindings`; a figure taken at a head that DESCENDS from the candidate may be cited only while it says so and `git diff -- apps supabase` computes that head to be product-identical to the candidate.\n'
    );
    for (const problem of binding.hostedProblems) write(`  ${problem}\n`);
  }
  return sound;
}

/** Report a documented claim the repository refutes. Returns true when sound. */
export function reportClaims(claims, baseline, write = toStderr) {
  let sound = true;
  if (claims.contradictions.length > 0 || baseline.length > 0) {
    sound = false;
    write(
      '::error::a record states, in the present tense, something this candidate refutes. Nothing parsed these sentences before, which is how thirty verdict rows went on telling the Owner that evidence did not exist.\n'
    );
    for (const problem of [...claims.contradictions, ...baseline]) write(`  ${problem}\n`);
  }
  if (claims.citations.length > 0) {
    sound = false;
    write(
      '::error::a PROTECTED_REPROOF cell cites a line that does not support it. A citation is what a reader checks INSTEAD of the claim, so a stale one is worse than none.\n'
    );
    for (const problem of claims.citations) write(`  ${problem}\n`);
  }
  return sound;
}

/**
 * The ONLY place a verdict is taken. Every rule fires here or nowhere.
 *
 * All eight run before the aggregate is formed, so one failure does not hide
 * another — a reader fixing a deleted citation should not then discover the
 * digest function was also wrong.
 */
export function judge(inputs, write = toStderr) {
  const shapeOk = reportDigestShape(inputs.manifest, write);
  const bytesOk = reportDigestBytes(inputs.digestMismatches, write);
  const reachableOk = reportReachability(inputs.reachability, write);
  const candidateOk = reportCandidate(inputs.candidate, write);
  const blockersOk = reportBlockers(inputs.blockers, write);
  const repositoryOk = reportRepository(inputs.repository, write);
  const tiersOk = reportTiers(inputs.tiers, inputs.packageArithmetic ?? [], write);
  const claimsOk = reportClaims(inputs.claims, inputs.baselineClaims ?? [], write);
  return {
    shapeOk,
    bytesOk,
    reachableOk,
    candidateOk,
    blockersOk,
    repositoryOk,
    tiersOk,
    claimsOk,
    sound:
      shapeOk &&
      bytesOk &&
      reachableOk &&
      candidateOk &&
      blockersOk &&
      repositoryOk &&
      tiersOk &&
      claimsOk,
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

/* ---------------- the synthetic repository ---------------- *
 *
 * WHY THIS EXISTS, AND WHY THE TABLE BELOW IT WAS NOT ENOUGH.
 *
 * Every case in `SELF_CHECK_CASES` hands `judge` an ANALYSIS somebody wrote by
 * hand — `{ dangling: ['…'] }` — and asks whether `judge` complains. That proves
 * the reporters read their arguments. It cannot prove that anything ever
 * computes such an argument from a repository, and it did not: the candidate
 * rule was driven fifteen ways over hand-set flags while `git` was never invoked
 * in this file, so a candidate naming no object passed every one of them.
 *
 * The cases below hand the ANALYSERS a synthetic world — a `git` that answers
 * from a table, a candidate document, a verdict register, a `playwright.config`
 * — and let them derive their own verdict from it. A rule that stops computing
 * `false` from a bad world now fails here, in the gate, on every invocation.
 * ---------------------------------------------------------- */

const W = Object.freeze({
  candidate: 'a'.repeat(40),
  tree: 'b'.repeat(40),
  executableSuccessor: 'c'.repeat(40),
  documentationSuccessor: 'd'.repeat(40),
  ledgerCommit: 'e'.repeat(40),
  measuredAt: '1'.repeat(40),
  stranger: '9'.repeat(40),
  /** A head the candidate supersedes: a real ancestor, and not the candidate. */
  supersededHead: '7'.repeat(40),
  /** A ledger commit whose entry was measured at the machinery successor. */
  driftLedgerCommit: '8'.repeat(40),
  /** This branch's own tip — the head under test when the checkout is honest. */
  branchHead: '2'.repeat(40),
  /** The base branch's tip, which the candidate does not contain. */
  baseTip: '3'.repeat(40),
  /** A pull request's merge ref: this branch merged with the base, synthetically. */
  mergeRef: '4'.repeat(40),
  /** A hosted run taken at a DESCENDANT of the candidate, product-identical. */
  runHead: '6'.repeat(40),
  /** The base branch AFTER this branch merged into it: it contains the candidate. */
  mergedBase: '5'.repeat(40),
  /** A later commit on the base's first-parent line. */
  baseAdvanced: '0'.repeat(40),
  /*
   * Trees, because a merge is judged CONTENT-FREE by comparing its own tree with
   * its candidate-carrying parent's. Distinct by default, so every world below
   * keeps meaning what it meant: an ordinary merge-ref preview carries content
   * of its own and is read as a merge. The content-free worlds say so by keying
   * the merge's tree to the branch head's.
   */
  branchTree: 'ba'.repeat(20),
  mergeTree: 'bc'.repeat(20),
  baseTree: 'bd'.repeat(20),
  mergedBaseTree: 'be'.repeat(20),
});

const ledgerAt = (head) =>
  `${JSON.stringify({
    tiers: {
      unit: { tests: 10, passed: 10, failed: 0, skipped: 0, files: 2, measuredAtCommit: head },
    },
  })}\n`;

const SYNTHETIC_LEDGER = ledgerAt(W.measuredAt);
const SYNTHETIC_DRIFT_LEDGER = ledgerAt(W.executableSuccessor);

const SYNTHETIC_GIT_TABLE = Object.freeze({
  [`cat-file -e ${W.candidate}^{commit}`]: '',
  [`rev-parse ${W.candidate}^{tree}`]: `${W.tree}\n`,
  /* Distinct trees: no merge in this world is content-free unless it says so. */
  [`rev-parse ${W.branchHead}^{tree}`]: `${W.branchTree}\n`,
  [`rev-parse ${W.baseTip}^{tree}`]: `${W.baseTree}\n`,
  [`rev-parse ${W.mergedBase}^{tree}`]: `${W.mergedBaseTree}\n`,
  /*
   * The merge's own tree, unequal to either parent's: a merge in this world
   * carries content of its own unless the world says otherwise, which is what
   * keeps every case below meaning what it meant before the content-free rule
   * existed.
   */
  [`rev-parse ${W.mergeRef}^{tree}`]: `${W.mergeTree}\n`,
  /* The base branch, and an ordinary single-parent checkout of this branch. */
  [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: `${W.baseTip}\n`,
  [`rev-list --parents -n 1 HEAD`]: `${W.branchHead} ${W.documentationSuccessor}\n`,
  /*
   * The same question asked of that head BY NAME, which is what unwrapping a
   * content-free merge does: the rule re-reads the parent it unwrapped to,
   * exactly as a checkout of that parent would be read.
   */
  [`rev-list --parents -n 1 ${W.branchHead}`]: `${W.branchHead} ${W.documentationSuccessor}\n`,
  [`merge-base --is-ancestor ${W.candidate} ${W.branchHead}`]: '',
  [`diff --name-only ${W.candidate}..${W.branchHead} -- apps supabase`]: '',
  [`log --format=%H %s ${W.branchHead} --not ${W.candidate} ${W.baseTip}`]: `${W.documentationSuccessor} docs: re-record the ledger\n${W.executableSuccessor} feat: the packaging machinery\n`,
  [`diff --name-only ${W.executableSuccessor}^ ${W.executableSuccessor}`]:
    'scripts/ci/build-p1-28-evidence-manifest.mjs\n',
  [`diff --name-only ${W.documentationSuccessor}^ ${W.documentationSuccessor}`]:
    'docs/phase-1/phase-1-28/evidence/closure-candidate.json\n',
  [`show ${W.ledgerCommit}:docs/ledger.json`]: SYNTHETIC_LEDGER,
  [`diff --name-only ${W.measuredAt}..${W.candidate}`]:
    'docs/phase-1/phase-1-27/evidence/evidence-manifest.json\n',
  /* The machinery successor: a measurement taken AFTER the seal landed. */
  [`show ${W.driftLedgerCommit}:docs/ledger.json`]: SYNTHETIC_DRIFT_LEDGER,
  [`diff --name-only ${W.executableSuccessor}..${W.candidate}`]:
    'scripts/ci/build-p1-28-evidence-manifest.mjs\n',
  /* A head the candidate supersedes: it exists, and it is an ancestor. */
  [`cat-file -e ${W.supersededHead}^{commit}`]: '',
  [`merge-base --is-ancestor ${W.supersededHead} ${W.candidate}`]: '',
  [`cat-file -e ${W.stranger}^{commit}`]: '',
  /*
   * A hosted run taken AFTER the candidate: the commit exists, it descends from
   * the candidate, and no product path differs. `''` and not `undefined`, because
   * an empty diff and a diff git refused to take are different answers and the
   * rule must be able to tell them apart.
   */
  [`cat-file -e ${W.runHead}^{commit}`]: '',
  [`merge-base --is-ancestor ${W.candidate} ${W.runHead}`]: '',
  [`diff --name-only ${W.candidate}..${W.runHead} -- apps supabase`]: '',
});

/**
 * The same repository, checked out at the pull request's MERGE REF.
 *
 * HEAD is a two-parent commit: the base tip, which this branch does not contain,
 * and this branch's own head. Nothing else is keyed at the merge ref, so a rule
 * that failed to unwrap it would be asking `git` about a commit the table does
 * not answer for — and would go red rather than quietly right.
 */
const MERGE_REF_GIT = Object.freeze({
  [`rev-list --parents -n 1 HEAD`]: `${W.mergeRef} ${W.baseTip} ${W.branchHead}\n`,
  /* Which parent carries the candidate — the question that needs no base ref. */
  [`merge-base --is-ancestor ${W.candidate} ${W.baseTip}`]: undefined,
  /* The cross-check, applied only because a base ref also resolves here. */
  [`merge-base --is-ancestor ${W.baseTip} ${W.baseTip}`]: '',
  [`diff-tree --cc --name-only --no-commit-id ${W.mergeRef}`]: '',
});

/**
 * The same merge ref, carrying its branch parent's tree BYTE FOR BYTE.
 *
 * What a promotion looks like, and what the sync that must precede it looks
 * like: a merge that adds nothing to the parent it is read as.
 */
const CONTENT_FREE_MERGE_GIT = Object.freeze({
  ...MERGE_REF_GIT,
  [`rev-parse ${W.mergeRef}^{tree}`]: `${W.branchTree}\n`,
});

const syntheticGit = (over = {}) => {
  const table = { ...SYNTHETIC_GIT_TABLE, ...over };
  for (const key of Object.keys(over)) if (over[key] === undefined) delete table[key];
  return fakeGit(table);
};

/** A candidate document the synthetic repository supports in every particular. */
const syntheticCandidate = (over = {}) => ({
  candidate: { FINAL_CODE_SHA: W.candidate, FINAL_CODE_TREE: W.tree, baseBranch: 'develop' },
  successors: [{ commit: W.executableSuccessor, kind: 'evidence machinery' }],
  tiers: {
    unit: {
      tests: 10,
      passed: 10,
      failed: 0,
      skipped: 0,
      files: 2,
      measuredAtCommit: W.measuredAt,
      provenance: PROVENANCE_LOCAL,
      localLedger: { path: 'docs/ledger.json', tier: 'unit', atCommit: W.ledgerCommit },
      hostedAttestation: {
        runId: 11,
        jobId: 22,
        headSha: W.candidate,
        artefact: 'totals-unit.json',
      },
    },
    browser: {
      planned: 6,
      passed: 5,
      failed: 0,
      skipped: 1,
      provenance: PROVENANCE_HOSTED,
      hostedAttestation: { runId: 11, jobId: 33, headSha: W.candidate, artefact: 'report.json' },
    },
  },
  hostedCi: {
    runId: 11,
    headSha: W.candidate,
    checksTotal: 2,
    checksSuccess: 2,
    checksFailure: 0,
    checks: [
      { name: 'ci-gate', conclusion: 'success' },
      { name: 'CodeQL', conclusion: 'success' },
    ],
  },
  browserByProject: {
    spec: PHASE_SPEC,
    runId: 11,
    jobId: 33,
    headSha: W.candidate,
    total: 6,
    projects: { 'authenticated-tablet': { planned: 6, passed: 6, failed: 0, skipped: 0 } },
  },
  ...over,
});

/**
 * A candidate whose local tier was measured at the NAMED machinery successor.
 *
 * The shape this package actually has after a re-freeze: the seal's own
 * generator and test cannot be inside the candidate they seal, so they land
 * after it, and a tier run before them would report a suite that no longer
 * exists. The measurement is therefore taken at that successor and the drift is
 * declared path by path.
 */
const driftCandidate = (over = {}) => {
  const doc = syntheticCandidate();
  doc.tiers.unit = {
    ...doc.tiers.unit,
    measuredAtCommit: W.executableSuccessor,
    localLedger: { path: 'docs/ledger.json', tier: 'unit', atCommit: W.driftLedgerCommit },
    measurementDrift: ['scripts/ci/build-p1-28-evidence-manifest.mjs'],
  };
  if (over.unit) doc.tiers.unit = { ...doc.tiers.unit, ...over.unit };
  return doc;
};

/**
 * A candidate whose hosted observations were all taken at a DESCENDANT head.
 *
 * The state this rule exists for: the seal's machinery lands after the candidate
 * it seals, so the branch head is not the candidate and the hosted run is taken
 * there. Every binding names that head and declares what it is; nothing here is
 * marked pending, because a run at a product-identical descendant IS a run at
 * this code.
 */
const successorRunCandidate = (over = {}) => {
  const doc = syntheticCandidate();
  const forward = { headSha: W.runHead, [SUCCESSOR_MARKER]: true };
  doc.tiers.unit = {
    ...doc.tiers.unit,
    hostedAttestation: { ...doc.tiers.unit.hostedAttestation, ...forward },
  };
  doc.tiers.browser = {
    ...doc.tiers.browser,
    hostedAttestation: { ...doc.tiers.browser.hostedAttestation, ...forward },
  };
  doc.hostedCi = { ...doc.hostedCi, ...forward };
  doc.browserByProject = { ...doc.browserByProject, ...forward };
  return { ...doc, ...over };
};

/**
 * A candidate whose hosted observations all describe a head it supersedes.
 *
 * The state a re-freeze produces: three fix waves change product files, the
 * candidate moves, and the hosted run stays behind on the commit it measured.
 */
const pendingCandidate = (over = {}) => {
  const doc = syntheticCandidate();
  const superseded = {
    describesSupersededHead: true,
    headSha: W.supersededHead,
    supersededBy: 'an exact-head CI run at the candidate',
  };
  doc.tiers.unit = {
    ...doc.tiers.unit,
    provenance: PROVENANCE_LOCAL_PENDING,
    hostedAttestation: { ...doc.tiers.unit.hostedAttestation, ...superseded },
  };
  doc.tiers.browser = {
    ...doc.tiers.browser,
    provenance: PROVENANCE_HOSTED_PENDING,
    hostedAttestation: { ...doc.tiers.browser.hostedAttestation, ...superseded },
  };
  doc.hostedCi = { ...doc.hostedCi, ...superseded };
  doc.browserByProject = { ...doc.browserByProject, ...superseded };
  doc.pendingHostedBindings = {
    awaits: 'a CI run whose head is the candidate',
    bindings: [
      'browserByProject',
      'hostedCi',
      'tiers.browser.hostedAttestation',
      'tiers.unit.hostedAttestation',
    ],
  };
  return { ...doc, ...over };
};

/** The tablet project as it stands at this candidate, and as it stood before. */
const WIDE_CONFIG = [
  "    name: 'authenticated-tablet',",
  '    testMatch: /authenticated[\\\\/](administration|appointments-and-receptions)\\.spec\\.ts/,',
].join('\n');
const NARROW_CONFIG = [
  "    name: 'authenticated-tablet',",
  '    testMatch: /authenticated[\\\\/](administration)\\.spec\\.ts/,',
].join('\n');

const SYNTHETIC_FILES = Object.freeze({
  'apps/web/playwright.config.ts': [
    '/**',
    ' * The tablet viewport. The match below once named administration alone.',
    ' */',
    "name: 'authenticated-tablet',",
  ],
});
const syntheticLines = (relative) => SYNTHETIC_FILES[relative] ?? null;

/** Judge inputs derived from a synthetic world by the real analysers. */
function worldInputs({
  candidateFile = syntheticCandidate(),
  git = syntheticGit(),
  verdicts = {},
  config = WIDE_CONFIG,
  baseline = '',
} = {}) {
  // The claim world reads the SAME computed binding set the tier rule does, so a
  // record may say a tier is observed here exactly when the repository agrees.
  const world = worldFrom(
    candidateFile,
    tabletProjectSpecs(config),
    new Set(pendingBinding(candidateFile, git).bound)
  );
  return {
    manifest: SOUND_MANIFEST,
    digestMismatches: [],
    reachability: SOUND_REACHABILITY,
    candidate: {
      sha: candidateFile.candidate?.FINAL_CODE_SHA ?? '',
      tree: candidateFile.candidate?.FINAL_CODE_TREE ?? '',
      shaWellFormed: true,
      treeWellFormed: true,
      shaInProse: true,
      treeInProse: true,
    },
    blockers: SOUND_BLOCKERS,
    repository: repositoryBinding(candidateFile, git),
    tiers: tierBinding(candidateFile, git),
    packageArithmetic: packageArithmetic(candidateFile),
    claims: verdictClaims(verdicts, world, candidateFile, syntheticLines),
    baselineClaims: baselineClaimsFrom(baseline, world, candidateFile),
  };
}

const SOUND_WORLD = worldInputs();

const inputs = (over = {}) => ({
  manifest: SOUND_MANIFEST,
  digestMismatches: [],
  reachability: SOUND_REACHABILITY,
  candidate: SOUND_CANDIDATE,
  blockers: SOUND_BLOCKERS,
  repository: SOUND_WORLD.repository,
  tiers: SOUND_WORLD.tiers,
  packageArithmetic: [],
  claims: { contradictions: [], citations: [] },
  baselineClaims: [],
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
 * Known-bad WORLDS, each judged by the analysers rather than by hand.
 *
 * Nothing here sets a flag. Each case perturbs a repository, a document or a
 * config, and the case passes only if the code derives the failure itself.
 */
export const WORLD_CHECK_CASES = [
  {
    name: 'a candidate the repository contains, with every binding it claims',
    inputs: SOUND_WORLD,
    expects: { repositoryOk: true, tiersOk: true, claimsOk: true, sound: true },
    explains: false,
  },
  {
    name: 'a candidate SHA that names no object in the repository',
    inputs: worldInputs({
      git: syntheticGit({ [`cat-file -e ${W.candidate}^{commit}`]: undefined }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a recorded tree the candidate commit does not have',
    inputs: worldInputs({
      git: syntheticGit({ [`rev-parse ${W.candidate}^{tree}`]: `${W.stranger}\n` }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a candidate that is not an ancestor of the head under test',
    inputs: worldInputs({
      git: syntheticGit({ [`merge-base --is-ancestor ${W.candidate} ${W.branchHead}`]: undefined }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a successor that changed a product file',
    inputs: worldInputs({
      git: syntheticGit({
        [`diff --name-only ${W.candidate}..${W.branchHead} -- apps supabase`]:
          'apps/web/src/features/receptions/api.ts\n',
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'an executable successor the record does not name',
    inputs: worldInputs({ candidateFile: syntheticCandidate({ successors: [] }) }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a documentation-only successor the record does not name — allowed, and printed',
    inputs: SOUND_WORLD,
    expects: { repositoryOk: true },
    explains: false,
  },
  {
    name: 'a successor id that is in no commit range',
    inputs: worldInputs({
      candidateFile: syntheticCandidate({
        successors: [{ commit: W.executableSuccessor }, { commit: W.stranger }],
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a local tier figure the run ledger does not carry',
    inputs: (() => {
      const doc = syntheticCandidate();
      doc.tiers.unit = { ...doc.tiers.unit, passed: 3, failed: 7 };
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a tier whose parts do not add up to its total',
    inputs: (() => {
      const doc = syntheticCandidate();
      doc.tiers.unit = { ...doc.tiers.unit, passed: 3, failed: 812 };
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a local tier carrying a figure nothing can check',
    inputs: (() => {
      const doc = syntheticCandidate();
      doc.tiers.unit = { ...doc.tiers.unit, suites: 549 };
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a local tier whose ledger is not in the repository at the commit it names',
    inputs: worldInputs({
      git: syntheticGit({ [`show ${W.ledgerCommit}:docs/ledger.json`]: undefined }),
    }),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a local measurement taken at a head that differs from the candidate by executable paths',
    inputs: worldInputs({
      git: syntheticGit({
        [`diff --name-only ${W.measuredAt}..${W.candidate}`]:
          'apps/web/src/x.tsx\nscripts/ci/y.mjs\n',
      }),
    }),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a hosted tier attested with no job id',
    inputs: (() => {
      const doc = syntheticCandidate();
      doc.tiers.browser = {
        ...doc.tiers.browser,
        hostedAttestation: { runId: 11, headSha: W.candidate, artefact: 'report.json' },
      };
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a hosted tier attested at a head that is not the candidate',
    inputs: (() => {
      const doc = syntheticCandidate();
      doc.tiers.browser = {
        ...doc.tiers.browser,
        hostedAttestation: { runId: 11, jobId: 33, headSha: W.stranger, artefact: 'report.json' },
      };
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a check list whose declared total is not its length',
    inputs: (() => {
      const doc = syntheticCandidate();
      doc.hostedCi = { ...doc.hostedCi, checksTotal: 21, checksSuccess: 21 };
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a verdict cell denying a hosted-CI result the package records',
    inputs: worldInputs({
      verdicts: {
        'FE-001': { PROTECTED_REPROOF: 'No hosted-CI result is recorded for this head.' },
      },
    }),
    expects: { claimsOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a verdict cell saying the tablet project matches administration only, while it does not',
    inputs: worldInputs({
      verdicts: {
        'FE-002': { FINDING_IDS: 'authenticated-tablet matches `administration.spec.ts` only.' },
      },
    }),
    expects: { claimsOk: false, sound: false },
    explains: true,
  },
  {
    name: 'the SAME sentence against a narrowed config — true, and therefore allowed',
    inputs: worldInputs({
      config: NARROW_CONFIG,
      candidateFile: syntheticCandidate({
        browserByProject: {
          spec: PHASE_SPEC,
          runId: 11,
          jobId: 33,
          headSha: W.candidate,
          total: 6,
          projects: { 'authenticated-en': { planned: 6, passed: 6, failed: 0, skipped: 0 } },
        },
      }),
      verdicts: {
        'FE-002': {
          FINDING_IDS:
            'authenticated-tablet matches `administration.spec.ts` only, so no P1-28 screen is observed at a tablet viewport.',
        },
      },
    }),
    expects: { claimsOk: true },
    explains: false,
  },
  {
    name: 'a PROTECTED_REPROOF citation that lands on comment lines only',
    inputs: worldInputs({
      verdicts: { 'FE-003': { PROTECTED_REPROOF: 'see `apps/web/playwright.config.ts:1-3`' } },
    }),
    expects: { claimsOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a PROTECTED_REPROOF citation that runs off the end of the file',
    inputs: worldInputs({
      verdicts: { 'FE-004': { PROTECTED_REPROOF: 'see `apps/web/playwright.config.ts:900-910`' } },
    }),
    expects: { claimsOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a PROTECTED_REPROOF citation naming a file that is not there',
    inputs: worldInputs({
      verdicts: { 'FE-005': { PROTECTED_REPROOF: 'see `apps/web/gone.ts:1`' } },
    }),
    expects: { claimsOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a PROTECTED_REPROOF citation that reaches a line of code',
    inputs: worldInputs({
      verdicts: { 'FE-006': { PROTECTED_REPROOF: 'see `apps/web/playwright.config.ts:4`' } },
    }),
    expects: { claimsOk: true },
    explains: false,
  },
  {
    name: 'the CI baseline still saying the phase spec has never run hosted',
    inputs: worldInputs({ baseline: 'no hosted run has yet covered the seventh spec' }),
    expects: { claimsOk: false, sound: false },
    explains: true,
  },

  /* ---- the measurement head, after a re-freeze ---- */
  {
    name: 'a local measurement at a NAMED successor, drift declared and computed — allowed',
    inputs: worldInputs({ candidateFile: driftCandidate() }),
    expects: { tiersOk: true },
    explains: false,
  },
  {
    name: 'a local measurement at a named successor whose declared drift is not the computed one',
    inputs: worldInputs({
      candidateFile: driftCandidate({
        unit: { measurementDrift: ['scripts/ci/something-else.mjs'] },
      }),
    }),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a local measurement at a named successor that declares no drift at all',
    inputs: worldInputs({
      candidateFile: driftCandidate({ unit: { measurementDrift: undefined } }),
    }),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a local measurement at a named successor whose drift reaches a PRODUCT file',
    inputs: worldInputs({
      candidateFile: driftCandidate({
        unit: { measurementDrift: ['apps/web/src/features/receptions/api.ts'] },
      }),
      git: syntheticGit({
        [`diff --name-only ${W.executableSuccessor}..${W.candidate}`]:
          'apps/web/src/features/receptions/api.ts\n',
      }),
    }),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a tier declaring measurementDrift while nothing executable differs',
    inputs: (() => {
      const doc = syntheticCandidate();
      doc.tiers.unit = { ...doc.tiers.unit, measurementDrift: ['scripts/ci/invented.mjs'] };
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },

  /* ---- the hosted half, when no run at the candidate exists yet ---- */
  {
    name: 'every hosted binding pending at the candidate, declared and computed — allowed',
    inputs: worldInputs({ candidateFile: pendingCandidate() }),
    expects: { tiersOk: true },
    explains: false,
  },
  {
    name: 'a pending tier whose attestation does not say which head its figures belong to',
    inputs: (() => {
      const doc = pendingCandidate();
      const { describesSupersededHead: _drop, ...rest } = doc.tiers.browser.hostedAttestation;
      doc.tiers.browser = { ...doc.tiers.browser, hostedAttestation: rest };
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a tier claiming the hosted and local halves AGREE while its attestation is superseded',
    inputs: (() => {
      const doc = pendingCandidate();
      doc.tiers.unit = { ...doc.tiers.unit, provenance: PROVENANCE_LOCAL };
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a superseded binding the pending list does not name',
    inputs: worldInputs({
      candidateFile: pendingCandidate({
        pendingHostedBindings: {
          awaits: 'a CI run whose head is the candidate',
          bindings: ['hostedCi'],
        },
      }),
    }),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a superseded head that names no commit in this repository',
    inputs: worldInputs({
      candidateFile: pendingCandidate(),
      git: syntheticGit({ [`cat-file -e ${W.supersededHead}^{commit}`]: undefined }),
    }),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a superseded head that is not an ancestor of the candidate',
    inputs: worldInputs({
      candidateFile: pendingCandidate(),
      git: syntheticGit({
        [`merge-base --is-ancestor ${W.supersededHead} ${W.candidate}`]: undefined,
      }),
    }),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a binding marked superseded while the head it names IS the candidate',
    inputs: (() => {
      const doc = syntheticCandidate();
      doc.hostedCi = { ...doc.hostedCi, describesSupersededHead: true };
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a pending binding that names nothing to replace it',
    inputs: (() => {
      const doc = pendingCandidate();
      const { supersededBy: _drop, ...rest } = doc.hostedCi;
      doc.hostedCi = rest;
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },

  /* ---- the hosted half, when the run was taken at a LATER head ---- *
   *
   * The circularity these four close: the seal's own machinery cannot be inside
   * the candidate it seals, so hosted CI necessarily runs at a successor. Under
   * a rule that demanded the candidate exactly, every hosted run would force
   * another re-freeze whose seal commit moved the head again, for ever. The
   * escape is the local rule's, on the local rule's evidence — the product is
   * computed identical — and it is closed in all three directions below.
   */
  {
    name: 'a hosted run taken at a DESCENDANT head whose product is identical — allowed',
    inputs: worldInputs({ candidateFile: successorRunCandidate() }),
    expects: { tiersOk: true, claimsOk: true },
    explains: false,
  },
  {
    name: 'the same descendant head, with one PRODUCT file changed since the candidate',
    inputs: worldInputs({
      candidateFile: successorRunCandidate(),
      git: syntheticGit({
        [`diff --name-only ${W.candidate}..${W.runHead} -- apps supabase`]:
          'apps/web/src/features/receptions/api.ts\n',
      }),
    }),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a run head this repository does not contain',
    inputs: worldInputs({
      candidateFile: successorRunCandidate(),
      git: syntheticGit({ [`cat-file -e ${W.runHead}^{commit}`]: undefined }),
    }),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a run head that is an ANCESTOR of the candidate, cited as though it followed it',
    inputs: worldInputs({
      candidateFile: successorRunCandidate(),
      git: syntheticGit({
        [`merge-base --is-ancestor ${W.candidate} ${W.runHead}`]: undefined,
        [`merge-base --is-ancestor ${W.runHead} ${W.candidate}`]: '',
      }),
    }),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a product diff between candidate and run head that git refuses to take',
    inputs: worldInputs({
      candidateFile: successorRunCandidate(),
      git: syntheticGit({
        [`diff --name-only ${W.candidate}..${W.runHead} -- apps supabase`]: undefined,
      }),
    }),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a binding declaring both that its head precedes and that it follows the candidate',
    inputs: (() => {
      const doc = successorRunCandidate();
      doc.hostedCi = { ...doc.hostedCi, describesSupersededHead: true };
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a binding marked a successor while the head it names IS the candidate',
    inputs: (() => {
      const doc = syntheticCandidate();
      doc.hostedCi = { ...doc.hostedCi, [SUCCESSOR_MARKER]: true };
      return worldInputs({ candidateFile: doc });
    })(),
    expects: { tiersOk: false, sound: false },
    explains: true,
  },

  /* ---- whose commits these are: the base branch, and the merge ref ---- */
  {
    name: 'a checkout that is the pull request MERGE REF — judged as this branch, not as the merge',
    inputs: worldInputs({ git: syntheticGit(MERGE_REF_GIT) }),
    expects: { repositoryOk: true },
    explains: false,
  },
  {
    name: 'a merge-ref checkout carrying content of its own — not unwrapped, and said so',
    inputs: worldInputs({
      git: syntheticGit({
        ...MERGE_REF_GIT,
        [`diff-tree --cc --name-only --no-commit-id ${W.mergeRef}`]:
          'apps/web/src/features/receptions/api.ts\n',
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a base branch this checkout cannot resolve — unknown is not none',
    inputs: worldInputs({
      git: syntheticGit({
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: undefined,
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a base ref that resolves to something empty-but-present',
    inputs: worldInputs({
      git: syntheticGit({
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: '\n',
        [`rev-parse --verify --quiet refs/heads/develop^{commit}`]: '\n',
        [`rev-parse --verify --quiet develop^{commit}`]: '\n',
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'no base ref at all, recovered from the merge ref’s own base-side parent — allowed',
    inputs: worldInputs({
      git: syntheticGit({
        ...MERGE_REF_GIT,
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: undefined,
        /* The cross-check cannot be asked without a base ref, and is not. */
        [`merge-base --is-ancestor ${W.baseTip} ${W.baseTip}`]: undefined,
      }),
    }),
    expects: { repositoryOk: true },
    explains: false,
  },
  {
    name: 'a merge ref carrying its branch parent’s tree — read as that parent',
    inputs: worldInputs({ git: syntheticGit(CONTENT_FREE_MERGE_GIT) }),
    expects: { repositoryOk: true },
    explains: false,
  },
  {
    name: 'a content-free merge whose base side is a stranger — STILL read as its parent',
    /*
     * The promotion, in one world. Its non-candidate parent is the protected
     * branch, which the base branch does not contain and which does not contain
     * it — the very shape the decline below exists for. A merge that adds no
     * content is read as the parent it adds nothing to regardless, because
     * nothing can enter through a parent whose content is not in the result.
     */
    inputs: worldInputs({
      git: syntheticGit({
        ...CONTENT_FREE_MERGE_GIT,
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: `${W.stranger}\n`,
      }),
    }),
    expects: { repositoryOk: true },
    explains: false,
  },
  {
    name: 'a merge whose tree Git will not name — unknown, not content-free',
    inputs: worldInputs({
      git: syntheticGit({
        ...MERGE_REF_GIT,
        [`rev-parse ${W.mergeRef}^{tree}`]: GIT_COMMAND_FAILURE,
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a merge ref whose base side is not in the base branch — not unwrapped',
    inputs: worldInputs({
      git: syntheticGit({
        ...MERGE_REF_GIT,
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: `${W.stranger}\n`,
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  /* ---- after this branch has MERGED into its base ---- *
   *
   * The shape that took the protected-branch reproof red. The base subtraction
   * presumes the base does not contain the candidate; the merge inverts that,
   * and subtracting the base as it is NOW removes every genuine successor. The
   * base as it STOOD is in the merge's first parent, and these three worlds are
   * what hold the seal to reading it from there.
   */
  {
    name: 'the merge commit on the protected branch, base subtracted as it STOOD — allowed',
    inputs: worldInputs({
      git: syntheticGit({
        // `origin/develop` is now the merge itself and contains the candidate.
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: `${W.mergedBase}\n`,
        [`rev-list --parents -n 1 HEAD`]: `${W.mergeRef} ${W.baseTip} ${W.branchHead}\n`,
        [`merge-base --is-ancestor ${W.candidate} ${W.baseTip}`]: undefined,
        [`merge-base --is-ancestor ${W.baseTip} ${W.mergedBase}`]: '',
        [`diff-tree --cc --name-only --no-commit-id ${W.mergeRef}`]: '',
      }),
    }),
    expects: { repositoryOk: true },
    explains: false,
  },
  {
    name: 'a re-merge where BOTH parents carry the candidate — the base is the first parent',
    inputs: worldInputs({
      git: syntheticGit({
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: `${W.mergedBase}\n`,
        [`rev-list --parents -n 1 HEAD`]: `${W.mergeRef} ${W.mergedBase} ${W.branchHead}\n`,
        [`merge-base --is-ancestor ${W.candidate} ${W.mergedBase}`]: '',
        [`merge-base --is-ancestor ${W.mergedBase} ${W.mergedBase}`]: '',
        [`diff-tree --cc --name-only --no-commit-id ${W.mergeRef}`]: '',
        [`log --format=%H %s ${W.branchHead} --not ${W.candidate} ${W.mergedBase}`]: `${W.documentationSuccessor} docs: re-record the ledger\n${W.executableSuccessor} feat: the packaging machinery\n`,
      }),
    }),
    expects: { repositoryOk: true },
    explains: false,
  },
  {
    name: 'the protected merge remains identifiable after the base first-parent line advances',
    inputs: worldInputs({
      git: syntheticGit({
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: `${W.baseAdvanced}\n`,
        [`rev-list --parents -n 1 HEAD`]: `${W.mergeRef} ${W.mergedBase} ${W.branchHead}\n`,
        [`merge-base --is-ancestor ${W.candidate} ${W.mergedBase}`]: '',
        [`rev-list --first-parent ${W.baseAdvanced}`]: `${W.baseAdvanced}\n${W.mergeRef}\n${W.mergedBase}\n`,
        [`merge-base --is-ancestor ${W.mergedBase} ${W.baseAdvanced}`]: '',
        [`diff-tree --cc --name-only --no-commit-id ${W.mergeRef}`]: '',
        [`log --format=%H %s ${W.branchHead} --not ${W.candidate} ${W.mergedBase}`]: `${W.documentationSuccessor} docs: re-record the ledger\n${W.executableSuccessor} feat: the packaging machinery\n`,
      }),
    }),
    expects: { repositoryOk: true },
    explains: false,
  },
  {
    name: 'second-parent reachability is not the protected base first-parent line',
    inputs: worldInputs({
      git: syntheticGit({
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: `${W.baseAdvanced}\n`,
        [`rev-list --parents -n 1 HEAD`]: `${W.mergeRef} ${W.mergedBase} ${W.branchHead}\n`,
        [`merge-base --is-ancestor ${W.candidate} ${W.mergedBase}`]: '',
        [`rev-list --first-parent ${W.baseAdvanced}`]: `${W.baseAdvanced}\n${W.mergedBase}\n`,
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'both parents carry the candidate but a stale base identifies neither — fail closed',
    inputs: worldInputs({
      git: syntheticGit({
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: `${W.baseTip}\n`,
        [`rev-list --parents -n 1 HEAD`]: `${W.mergeRef} ${W.mergedBase} ${W.branchHead}\n`,
        [`merge-base --is-ancestor ${W.candidate} ${W.mergedBase}`]: '',
        [`merge-base --is-ancestor ${W.baseTip} ${W.mergedBase}`]: '',
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'candidate ancestry for a merge parent is UNKNOWN — fail closed',
    inputs: worldInputs({
      git: syntheticGit({
        ...MERGE_REF_GIT,
        [`merge-base --is-ancestor ${W.candidate} ${W.baseTip}`]: GIT_COMMAND_FAILURE,
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'merge-owned content inspection is UNKNOWN — fail closed',
    inputs: worldInputs({
      git: syntheticGit({
        ...MERGE_REF_GIT,
        [`diff-tree --cc --name-only --no-commit-id ${W.mergeRef}`]: GIT_COMMAND_FAILURE,
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'an alleged base parent is only a sibling beyond a stale base observation',
    inputs: worldInputs({
      git: syntheticGit({
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: `${W.baseTip}\n`,
        [`rev-list --parents -n 1 HEAD`]: `${W.mergeRef} ${W.mergedBase} ${W.branchHead}\n`,
        [`merge-base --is-ancestor ${W.baseTip} ${W.mergedBase}`]: '',
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a branch cut from a base that has ABSORBED the candidate — its own additions',
    inputs: worldInputs({
      git: syntheticGit({
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: `${W.mergedBase}\n`,
        [`merge-base --is-ancestor ${W.candidate} ${W.mergedBase}`]: '',
        [`log --format=%H %s ${W.branchHead} --not ${W.candidate} ${W.mergedBase}`]: `${W.documentationSuccessor} docs: re-record the ledger\n${W.executableSuccessor} feat: the packaging machinery\n`,
      }),
    }),
    expects: { repositoryOk: true },
    explains: false,
  },
  {
    name: 'a merge on the protected branch that carries content of its own — not stepped past',
    inputs: worldInputs({
      git: syntheticGit({
        [`rev-parse --verify --quiet refs/remotes/origin/develop^{commit}`]: `${W.mergedBase}\n`,
        [`rev-list --parents -n 1 HEAD`]: `${W.mergeRef} ${W.baseTip} ${W.branchHead}\n`,
        [`merge-base --is-ancestor ${W.candidate} ${W.baseTip}`]: undefined,
        [`merge-base --is-ancestor ${W.baseTip} ${W.mergedBase}`]: '',
        [`diff-tree --cc --name-only --no-commit-id ${W.mergeRef}`]:
          'apps/web/src/features/receptions/api.ts\n',
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },

  {
    name: 'a product diff between the candidate and the head under test that git refuses to take',
    inputs: worldInputs({
      git: syntheticGit({
        [`diff --name-only ${W.candidate}..${W.branchHead} -- apps supabase`]: undefined,
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a successor range git refuses to compute — an empty answer is not "none"',
    inputs: worldInputs({
      git: syntheticGit({
        [`log --format=%H %s ${W.branchHead} --not ${W.candidate} ${W.baseTip}`]: undefined,
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },
  {
    name: 'a package that names no base branch at all',
    inputs: worldInputs({
      candidateFile: syntheticCandidate({
        candidate: { FINAL_CODE_SHA: W.candidate, FINAL_CODE_TREE: W.tree },
      }),
    }),
    expects: { repositoryOk: false, sound: false },
    explains: true,
  },

  /* ---- the anchored claims, pointed the other way ---- */
  {
    name: 'a verdict cell saying hosted CI is OBSERVED AT THIS CANDIDATE while none is recorded',
    inputs: worldInputs({
      candidateFile: pendingCandidate(),
      verdicts: {
        'FE-007': {
          PROTECTED_REPROOF:
            'THE TABLET VIEWPORT AND HOSTED CI ARE BOTH OBSERVED AT THIS CANDIDATE.',
        },
      },
    }),
    expects: { claimsOk: false, sound: false },
    explains: true,
  },
  {
    name: 'the SAME sentence while a run at the candidate IS recorded — true, and allowed',
    inputs: worldInputs({
      verdicts: {
        'FE-007': {
          PROTECTED_REPROOF:
            'THE TABLET VIEWPORT AND HOSTED CI ARE BOTH OBSERVED AT THIS CANDIDATE.',
        },
      },
    }),
    expects: { claimsOk: true },
    explains: false,
  },
  {
    name: 'a record saying all five tiers were re-run here while two are recorded pending',
    inputs: worldInputs({
      candidateFile: pendingCandidate(),
      verdicts: {
        'QA-005': {
          PRODUCTION_TEST_EVIDENCE:
            'All five tiers re-run against the frozen candidate, 0 failures.',
        },
      },
    }),
    expects: { claimsOk: false, sound: false },
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
export const ALL_SELF_CHECK_CASES = [...SELF_CHECK_CASES, ...WORLD_CHECK_CASES];

export function selfCheck(cases = ALL_SELF_CHECK_CASES) {
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
  let repository;
  let tiers;
  try {
    manifest = buildManifest(ROOT);
    const git = gitReader(ROOT);
    const candidateFile = readJson(ROOT, CANDIDATE_PATH);
    const world = claimWorld(ROOT, candidateFile, git);
    repository = repositoryBinding(candidateFile, git);
    tiers = tierBinding(candidateFile, git);
    sound = judge({
      manifest,
      digestMismatches: verifyDigestBytes(ROOT, manifest),
      reachability: reachability(ROOT),
      candidate: candidateBinding(ROOT),
      blockers: blockerCoverage(ROOT),
      repository,
      tiers,
      packageArithmetic: packageArithmetic(candidateFile),
      claims: verdictClaims(readJson(ROOT, VERDICTS_PATH), world, candidateFile, lineReader(ROOT)),
      baselineClaims: baselineClaims(ROOT, world, candidateFile),
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
    else {
      process.stdout.write(
        `evidence manifest in sync — ${manifest.fileCount} documents, every one reachable, ` +
          `candidate ${manifest.candidate.FINAL_CODE_SHA?.slice(0, 8)}\n`
      );
      // Say WHAT was verified against the repository and what was merely
      // attested, in the same breath. The first revision of this gate printed
      // "candidate deadbeef" over a commit that did not exist, so a summary that
      // does not name its evidence is the thing being corrected here.
      process.stdout.write(
        `  repository-verified: the candidate exists, its tree is ${repository.actualTree?.slice(0, 8)}, ` +
          `it is an ancestor of ${String(repository.phaseHead).slice(0, 8)}, apps/** and supabase/** are byte-identical to it, and ` +
          `${repository.recorded.length} executable successor(s) are named\n`
      );
      process.stdout.write(
        `  successor set computed as \`git log ${String(repository.phaseHead).slice(0, 8)} --not ${repository.sha.slice(0, 8)} ${String(repository.baseSha).slice(0, 8)}\` — ` +
          `base ${repository.baseBranch} resolved at ${repository.baseRef}\n`
      );
      if (repository.unwrappedMergeRef) {
        // Said out loud, because the head being judged is then not the commit
        // that is checked out, and a reader must not have to infer that.
        process.stdout.write(
          `  the checkout ${String(repository.checkoutHead).slice(0, 8)} is a merge of this branch with its base ` +
            `${String(repository.mergeRefBaseSide).slice(0, 8)} and carries no content of its own, so the head under test is ` +
            `this branch's own ${String(repository.phaseHead).slice(0, 8)}\n`
        );
      }
      if (repository.unrecordedDocumentation.length > 0) {
        process.stdout.write(
          `  documentation-only successors, unnamed because a commit cannot name itself: ` +
            `${repository.unrecordedDocumentation.map((s) => s.slice(0, 8)).join(', ')}\n`
        );
      }
      process.stdout.write(
        `  tier figures COMPUTED against the run ledger: ${tiers.verifiedLocally.join('; ') || 'none'}\n`
      );
      process.stdout.write(
        `  tier figures ATTESTED, NOT COMPUTED — this repository cannot verify them, only cite them: ` +
          `${tiers.attested.join('; ') || 'none'}\n`
      );
      process.stdout.write(
        `  tier figures PENDING at this candidate — no hosted observation of this head exists yet: ` +
          `${tiers.pending.join('; ') || 'none'}\n`
      );
      process.stdout.write(
        `  hosted bindings that describe a SUPERSEDED head, declared and computed: ` +
          `${tiers.supersededBindings.join(', ') || 'none'}\n`
      );
      process.stdout.write(
        `  hosted bindings taken at a DESCENDANT head, computed product-identical to the candidate: ` +
          `${tiers.boundAtSuccessor.join('; ') || 'none'}\n`
      );
    }
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
