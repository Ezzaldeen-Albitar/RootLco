#!/usr/bin/env node
/**
 * Every closing value on the two P1-27 evidence pages has exactly one authority,
 * and the page says which.
 *
 * ## The finding this closes
 *
 * An adversarial pass falsified six hosted-CI figures on `ci-evidence.md` and
 * `clean-room-evidence.md` with every gate green, and measured that fewer than
 * half of the values those pages state were read by anything at all. The two
 * pages are the phase's record of what was verified; a number on them that no
 * check consults is a decoration standing where evidence is supposed to be, and
 * the neighbouring checked numbers lend it credibility it has not earned.
 *
 * Fixing the six figures produces six figures that will be wrong again. What is
 * missing is not a correction, it is a RULE: no value may appear on a closing
 * page without naming the authority that decides it.
 *
 * ## The six classes, and why they are not interchangeable
 *
 * `DERIVABLE_LOCAL` — a command in this repository answers it. The binding runs
 * the derivation and compares. This is the strongest class and the only one that
 * can be wrong in a way this gate catches on its own.
 *
 * `DERIVABLE_GIT` — git object truth: a ref, a tree, a diff, an ancestry. It is
 * separated from the class above because git answers questions about commits
 * that are no longer checked out, which no filesystem walk can.
 *
 * `HOSTED_ARTIFACT_ATTESTED` — a fact about a GitHub-hosted runner. **No local
 * command can re-derive it and this gate does not pretend otherwise.** What it
 * proves is INTERNAL CONSISTENCY: that the value names a run, a job or artefact,
 * and the exact head it describes; that nothing claiming to be hosted is
 * presented as locally derived; and that nothing at the candidate is claimed by a
 * record describing a different head. The observation itself is collected
 * externally, from the GitHub API during exact-head CI, by a person or a workflow
 * step reading the run — and saying so is honest evidence. Manufacturing a local
 * "proof" of a hosted fact would not be.
 *
 * `PROTECTED_POST_MERGE_ONLY` — produced only by a push to a protected branch.
 * It cannot exist before the merge, so its value is `null` and the page states
 * the pending status rather than a figure. A number here would be a fabrication
 * with a delivery date.
 *
 * `HISTORICAL_SUPERSEDED` — true of a head this record no longer describes. It
 * is kept, because deleting it erases the evidence that the drift happened, and
 * it is excluded from the current seal by construction: its region is marked.
 *
 * `NON_NORMATIVE_EXAMPLE` — an illustration. Excluded for the same reason.
 *
 * ## Why the page is TILED rather than annotated
 *
 * A gate that only inspects values a document opts into reports zero problems
 * about a document that opts nothing in. That is the vacuity this repository has
 * now shipped in four scanners.
 *
 * So the two pages are covered edge to edge by `<!-- seal: KIND NAME -->` …
 * `<!-- seal: end NAME -->` regions with no gaps, and every value token inside a
 * `current` region must be claimed by a ledger entry. A `narrative` region is a
 * positive assertion that it holds no values — a token appearing in one is an
 * UNCLASSIFIED value, named with its line. Whitespace is the only thing allowed
 * between regions, and text before the first marker or after the last is a gap
 * whose tokens count as unclassified too.
 *
 * ## Why a document is never compared to another document
 *
 * `1586` sat on `clean-room-evidence.md` beside a tree running 1867 tests for a
 * whole wave, and two separate gates were watching it. Both compared the page to
 * `.github/ci-baselines/test-count-baseline.json` and neither compared either to
 * the repository, so the record and the baseline agreed with each other while
 * both disagreed with the tree. A cycle of mutually-confirming documents is not
 * evidence, however many members it has.
 *
 * An executed test total is therefore bound to `evidence/local-run-ledger.json`,
 * which is not a document: it is written only by `--record`, from the JSON a
 * vitest run emits, and it carries the commit it was taken at. This gate refuses
 * it when any executable path has changed since — so the record expires rather
 * than ages — and cross-checks its file count against a walk of the tree, which
 * is the comparison that would have caught 1586 the day it was written.
 *
 * A committed FLOOR is a different question from a MEASUREMENT, and the baseline
 * is the authority for the floor. Binding "the floor is 1793" to the file that
 * defines the floor is a definition, not a circle.
 *
 * Usage:
 *   node scripts/ci/check-p1-27-closing-values.mjs [--json out.json]
 *   node scripts/ci/check-p1-27-closing-values.mjs --record <tier>
 *   node scripts/ci/check-p1-27-closing-values.mjs --record <tier> --hosted-run <runId>
 * Exit: 0 clean · 1 a value is unclassified, unbound or misclassified · 2 IO.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { deriveCounts, walk } from './check-p1-27-doc-counts.mjs';
import { executableChangesSince, commitExists } from './check-p1-27-lifecycle.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const native = (root, p) => join(root, p.split(posix.sep).join(sep));

export const PHASE_DIR = 'docs/phase-1/phase-1-27';
export const LEDGER_PATH = `${PHASE_DIR}/evidence/closing-value-ledger.json`;
export const RUN_LEDGER_PATH = `${PHASE_DIR}/evidence/local-run-ledger.json`;
export const LIFECYCLE_PATH = `${PHASE_DIR}/evidence/lifecycle-ledger.json`;
export const BASELINE_PATH = '.github/ci-baselines/test-count-baseline.json';
/**
 * The DATABASE baseline, which is a different file answering a different
 * question. `BASELINE_PATH` above commits the test-count FLOORS; this one
 * commits what the migration-replay job re-proves from an empty PostgreSQL —
 * `migrationCount`, `permissionCount`, `schemaHash`, `structuralTotals`.
 *
 * It is bindable because `QA-005` has to compare a record row against the
 * committed baseline, and the row it used to read for that was
 * `Migrations applied` in the superseded hosted table: a historical
 * measurement, fixed at the head it describes. One row cannot answer to a fixed
 * historical head and a moving baseline at once, so raising `migrationCount`
 * turned one red gate into a different red gate. The two bindings are separate
 * now, and this constant is the second one's authority.
 */
export const SCHEMA_BASELINE_PATH = '.github/ci-baselines/schema-baseline.json';
export const CLEAN_ROOM = `${PHASE_DIR}/clean-room-evidence.md`;
export const CI_EVIDENCE = `${PHASE_DIR}/ci-evidence.md`;
export const SEALED_DOCUMENTS = Object.freeze([CLEAN_ROOM, CI_EVIDENCE]);

export const CLASSES = Object.freeze({
  DERIVABLE_LOCAL: { letter: 'A', current: true, region: 'current' },
  DERIVABLE_GIT: { letter: 'B', current: true, region: 'current' },
  HOSTED_ARTIFACT_ATTESTED: { letter: 'C', current: true, region: null },
  PROTECTED_POST_MERGE_ONLY: { letter: 'D', current: true, region: 'current' },
  HISTORICAL_SUPERSEDED: { letter: 'E', current: false, region: 'historical' },
  NON_NORMATIVE_EXAMPLE: { letter: 'F', current: false, region: 'example' },
});

export const STANDINGS = Object.freeze([
  'CURRENT',
  'HISTORICAL',
  'PENDING_CANDIDATE_OBSERVATION',
  'PENDING_PROTECTED_MERGE',
  'EXAMPLE',
]);

/** Which standings each class may take. A class/standing pair outside this fails. */
export const ALLOWED_STANDINGS = Object.freeze({
  DERIVABLE_LOCAL: ['CURRENT'],
  DERIVABLE_GIT: ['CURRENT'],
  HOSTED_ARTIFACT_ATTESTED: ['CURRENT', 'HISTORICAL', 'PENDING_CANDIDATE_OBSERVATION'],
  PROTECTED_POST_MERGE_ONLY: ['PENDING_PROTECTED_MERGE', 'CURRENT'],
  HISTORICAL_SUPERSEDED: ['HISTORICAL'],
  NON_NORMATIVE_EXAMPLE: ['EXAMPLE'],
});

/* ------------------------------------------------------------------ *
 * Region tiling
 * ------------------------------------------------------------------ */

export const REGION_KINDS = Object.freeze(['current', 'historical', 'example', 'narrative']);

/**
 * A visible banner every excluded region must carry, in the RENDERED text.
 *
 * An HTML comment is invisible to a reader, so a region marked excluded only in
 * a comment would read on the page exactly like current evidence. These classes
 * must be "visibly marked", and a marker nobody can see is not one.
 *
 * The pattern requires a BLOCKQUOTE at the start of a line rather than the word
 * appearing anywhere in the region. A section that happens to use the word
 * "superseded" in a sentence would otherwise satisfy the rule while rendering
 * with no banner at all — which is how a value gets excluded from the seal in
 * the ledger and reads as current on the page.
 */
export const VISIBLE_MARKERS = Object.freeze({
  historical: /^>\s*\*\*(?:HISTORICAL|SUPERSEDED)\b/m,
  example: /^>\s*\*\*NON-NORMATIVE\b/m,
});

const SEAL = /<!--\s*seal:\s*(current|historical|example|narrative|end)\s+([a-z0-9-]+)\s*-->/g;

/**
 * The regions a sealed document declares, and every way the tiling can be wrong.
 *
 * `gaps` are the spans no region covers. They are reported separately from
 * regions because a gap is not a classification error in one value, it is a
 * piece of the page nobody claimed — and its tokens are unclassified by
 * definition.
 */
export function parseRegions(relative, source) {
  const problems = [];
  const regions = [];
  const gaps = [];
  let open = null;
  let cursor = 0;
  SEAL.lastIndex = 0;
  for (const m of source.matchAll(SEAL)) {
    const [text, kind, name] = m;
    const before = source.slice(cursor, m.index);
    if (kind === 'end') {
      if (!open) {
        problems.push(`${relative}: \`seal: end ${name}\` closes no open region.`);
      } else if (open.name !== name) {
        problems.push(
          `${relative}: \`seal: end ${name}\` closes \`${open.name}\`, which is what is open.`
        );
      } else {
        regions.push({ ...open, end: m.index, text: source.slice(open.start, m.index) });
        open = null;
      }
      cursor = m.index + text.length;
      continue;
    }
    if (open) {
      problems.push(
        `${relative}: \`seal: ${kind} ${name}\` opens inside \`${open.name}\` — regions do not nest.`
      );
      cursor = m.index + text.length;
      continue;
    }
    if (before.trim() !== '') gaps.push({ start: cursor, end: m.index, text: before });
    open = { kind, name, start: m.index + text.length };
    cursor = m.index + text.length;
  }
  if (open) {
    problems.push(`${relative}: \`seal: ${open.kind} ${open.name}\` is never closed.`);
    regions.push({ ...open, end: source.length, text: source.slice(open.start) });
  } else if (source.slice(cursor).trim() !== '') {
    gaps.push({ start: cursor, end: source.length, text: source.slice(cursor) });
  }
  if (regions.length === 0) {
    problems.push(
      `${relative}: declares no \`<!-- seal: KIND NAME -->\` region, so nothing on it is classified.`
    );
  }
  const names = regions.map((r) => r.name);
  for (const name of new Set(names)) {
    if (names.filter((n) => n === name).length > 1) {
      problems.push(`${relative}: region name \`${name}\` is used more than once.`);
    }
  }
  for (const region of regions) {
    const marker = VISIBLE_MARKERS[region.kind];
    if (marker && !marker.test(region.text)) {
      problems.push(
        `${relative}: region \`${region.name}\` is sealed \`${region.kind}\` but its rendered ` +
          `text carries no visible ${marker.source} banner — a reader cannot see it is excluded.`
      );
    }
    if (region.text.trim() === '') {
      problems.push(`${relative}: region \`${region.name}\` is empty, so it classifies nothing.`);
    }
  }
  return { regions, gaps, problems, subjectless: subjectlessHistory(relative, regions) };
}

/**
 * A `historical` region must say what it is history OF.
 *
 * The value tokens inside an excluded region are not scanned — that is what
 * "excluded from the current seal" means — so without this rule the region is a
 * place to move a number nobody wants checked. Naming the subject is what makes
 * the exclusion accountable: a reader can go and look at that head, that run or
 * that pull request, and the figures either describe it or they do not.
 *
 * The escape hatch is deliberate and it is meant to be read as one. Not every
 * piece of history is a commit — the first clean room of this phase failed twice
 * before any record existed to pin — so a region may instead state, in words,
 * that no commit is named and why. What it may not do is say nothing.
 */
const SUBJECT = /`[0-9a-f]{7,40}`|\bPR #\d+|\brun `\d+`|\bpull request #\d+/;
const NO_SUBJECT_REASON = /no commit is named here because/;

function subjectlessHistory(relative, regions) {
  const out = [];
  for (const region of regions) {
    if (region.kind !== 'historical') continue;
    if (SUBJECT.test(region.text) || NO_SUBJECT_REASON.test(region.text)) continue;
    out.push(
      `${relative}: region \`${region.name}\` is sealed \`historical\` and names no head, run or ` +
        'pull request it is history of. Name one, or state "no commit is named here because …".'
    );
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Value tokens
 * ------------------------------------------------------------------ */

/**
 * A candidate value token.
 *
 * Two alternatives: a hexadecimal run of seven characters or more (commit
 * abbreviations, digests, workflow run ids — which are legal hexadecimal) and a
 * decimal figure with optional thousands/decimal punctuation and an optional
 * per-cent sign.
 *
 * The boundaries are what make the scan usable on prose. A digit glued to
 * letters or hyphens on either side is part of an IDENTIFIER, not a value:
 * `P1-27`, `QA-005`, `H-24`, `phase-1-27`, `sha256:`, `2026-08-11`. Those are
 * names that happen to contain digits, and treating them as values would bury a
 * real finding under a hundred false ones. `#214` and `` `31312531302` `` are
 * values: `#` and a backtick are not identifier characters.
 */
export const VALUE_TOKEN =
  /(?<![A-Za-z0-9_.\-])(?<!Phase )(?:\d+-\d+(?!-?\d)|[0-9a-f]{7,64}|\d+(?:[.,]\d+)*%?)(?![A-Za-z0-9_\-])/g;

/*
 * The first alternative is a hyphenated RANGE, and it was missing.
 *
 * The identifier guards deliberately exclude a hyphen on either side, so that
 * `P1-27`, `phase-1-27` and `QA-005` produce no value. The cost was that a
 * range produced none either: a false current sentence containing
 * "lines 244-604" or "1180-1216" was invisible, and the gate reported
 * `UNCLASSIFIED_CURRENT_VALUES=0` while sitting on it. An adversarial pass
 * demonstrated exactly that.
 *
 * A range is matched WHOLE, before the bare-integer alternative, so the pair is
 * one value rather than two unrelated ones. `(?!-?\d)` is what keeps a date
 * out: on `2026-08-11` the attempt at `2026-08` sees `-1` and rejects, and the
 * attempt at `08-11` is refused by the leading guard because a hyphen precedes
 * it — so the date yields nothing, which is the behaviour the guards were added
 * for in the first place.
 */

/**
 * A verdict stated as a table cell — `Go`, `pass`, `clean`, `identical`.
 *
 * These are closing values with no digits in them, and the audit that prompted
 * this work counted them. Restricting the lexicon to a whole table CELL keeps it
 * exact: the word "pass" in a sentence is prose, `| Go |` in the decision column
 * of a results table is a verdict.
 */
export const VERDICTS = Object.freeze([
  'Go',
  'No-Go',
  'pass',
  'passed',
  'clean',
  'compiled',
  'identical',
  'green',
  'red',
]);

const VERDICT_CELL = new RegExp(`^(?:\\*\\*|\`)*(${VERDICTS.join('|')})(?:\\*\\*|\`)*$`, 'i');

/** Every value token in `text`, as `{ value, index }` absolute to the document. */
export function tokensIn(text, offset = 0) {
  const out = [];
  for (const m of text.matchAll(VALUE_TOKEN)) out.push({ value: m[0], index: offset + m.index });
  for (const row of text.matchAll(/^\|.*\|\s*$/gm)) {
    if (/^\|[\s:|-]+\|\s*$/.test(row[0])) continue;
    let at = offset + row.index;
    for (const cell of row[0].split('|')) {
      const found = VERDICT_CELL.exec(cell.trim());
      if (found) out.push({ value: found[1], index: at + cell.indexOf(found[1]) });
      at += cell.length + 1;
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/* ------------------------------------------------------------------ *
 * Bindings
 * ------------------------------------------------------------------ */

/** A canonical key for a git question, so `readFacts` resolves each one once. */
export function gitKey(binding) {
  const { op } = binding;
  if (op === 'revParse') return `revParse:${binding.ref}`;
  // `until` defaults to HEAD for compatibility, but a one-sided span MOVES with
  // every commit — post-closure it answers a different question on every push.
  // A durable equivalence pins both sides (the P1-24 lesson), and the key must
  // carry both so two spans never share a cache cell.
  if (op === 'executableDiffCount')
    return `executableDiffCount:${binding.since}..${binding.until ?? 'HEAD'}`;
  if (op === 'trackedFiles') return `trackedFiles:${binding.dir}:${binding.match ?? ''}`;
  if (op === 'lsTree') return `lsTree:${binding.sha}:${binding.pathspec}:${binding.match ?? ''}`;
  if (op === 'revListCount') return `revListCount:${binding.from}..${binding.to}`;
  return null;
}

/**
 * The value a binding resolves to, as a string, or `null` when it cannot.
 *
 * Every answer is stringified before comparison. The page states `70`, not the
 * number seventy, and a comparison that coerces is a comparison that accepts
 * `"70 "` and `"0070"`.
 */
export function resolveBinding(binding, facts) {
  if (!binding || typeof binding !== 'object') return { value: null, why: 'no binding' };
  switch (binding.kind) {
    case 'derived': {
      const table = facts.derived?.[binding.table];
      if (!table) return { value: null, why: `no derived table \`${binding.table}\`` };
      const found = table[binding.name];
      if (found === undefined) {
        return { value: null, why: `\`${binding.table}.${binding.name}\` is not derivable` };
      }
      return { value: String(found), why: `${binding.table}.${binding.name}` };
    }
    case 'unitTierFiles':
      return { value: String(facts.unitTierFiles), why: 'the unit tier include/exclude rule' };
    case 'run': {
      const tier = facts.runs?.tiers?.[binding.tier];
      if (!tier) return { value: null, why: `the run ledger records no \`${binding.tier}\` tier` };
      const found = tier[binding.field];
      if (found === undefined) {
        return { value: null, why: `the \`${binding.tier}\` record has no \`${binding.field}\`` };
      }
      return { value: String(found), why: `local-run-ledger ${binding.tier}.${binding.field}` };
    }
    case 'baseline': {
      const tier = facts.baseline?.tiers?.[binding.tier];
      if (!tier) return { value: null, why: `no committed floor for \`${binding.tier}\`` };
      const found = tier[binding.field];
      if (found === undefined) {
        return { value: null, why: `the \`${binding.tier}\` floor has no \`${binding.field}\`` };
      }
      return { value: String(found), why: `${BASELINE_PATH} ${binding.tier}.${binding.field}` };
    }
    case 'schemaBaseline': {
      const found = facts.schemaBaseline?.[binding.field];
      if (found === undefined) {
        return {
          value: null,
          why: `${SCHEMA_BASELINE_PATH} has no \`${binding.field}\``,
        };
      }
      return { value: String(found), why: `${SCHEMA_BASELINE_PATH} ${binding.field}` };
    }
    case 'git': {
      const key = gitKey(binding);
      if (key === null) return { value: null, why: `unknown git op \`${binding.op}\`` };
      if (!(key in (facts.git ?? {})))
        return { value: null, why: `git \`${key}\` was not resolved` };
      const raw = facts.git[key];
      if (raw === null) return { value: null, why: `git \`${key}\` failed` };
      const value = binding.abbrev ? String(raw).slice(0, binding.abbrev) : String(raw);
      return { value, why: `git ${key}` };
    }
    default:
      return { value: null, why: `unknown binding kind \`${binding.kind}\`` };
  }
}

/* ------------------------------------------------------------------ *
 * Judgement — pure, so the self-check can drive it
 * ------------------------------------------------------------------ */

/**
 * Every failure this gate can name.
 *
 * Frozen and exported for the same reason the lifecycle gate freezes its blocker
 * table: `tests/ci/p1-27-closing-values.test.ts` asserts every id here is
 * reachable from the self-check table, so a declared failure that no input can
 * produce is caught rather than admired.
 */
export const FAILURES = Object.freeze({
  UNCLASSIFIED_CURRENT_VALUE: 'a value token in a current or narrative region that no entry claims',
  VALUE_NOT_IN_LOCATOR: 'the ledger states a value the page does not carry where it says it does',
  LOCATOR_NOT_UNIQUE: 'the locator matches zero or more than one place in the document',
  DERIVED_VALUE_DISAGREES: 'a locally derivable value disagrees with the command output',
  UNBOUND_DERIVABLE_VALUE: 'a class A or B value whose binding resolves to nothing',
  HOSTED_VALUE_WITHOUT_PROVENANCE: 'a hosted value naming no run, job/artefact or head',
  HOSTED_VALUE_CLAIMS_LOCAL_PROVENANCE: 'a hosted value bound to a local derivation',
  HOSTED_VALUE_HEAD_NOT_A_COMMIT: 'a hosted value naming a head this repository does not hold',
  HOSTED_VALUE_NOT_AT_CANDIDATE:
    'a current hosted value describing a head that is not the candidate',
  PROTECTED_VALUE_MISREPRESENTED_AS_PREMERGE:
    'a protected-only value carrying a figure before the merge exists',
  PROTECTED_PENDING_NOT_STATED: 'a protected-only obligation the page does not state as pending',
  HISTORICAL_VALUE_COUNTED_AS_CURRENT: 'an excluded value whose locator sits in a current region',
  EXCLUDED_VALUE_WITHOUT_DISPOSITION:
    'an excluded value that neither names the check binding it nor says why none can',
  EXCLUDED_REGION_NAMES_NO_SUBJECT:
    'a historical region that does not say which head, run or pull request it is history of',
  RUN_RECORD_STALE: 'the local run record predates an executable change',
  RUN_RECORD_FILE_COUNT_DISAGREES: 'the local run record counted a different set of files',
  RUN_RECORD_INCOMPLETE:
    'the local run record does not carry the fields that make a vanished case visible',
  RUN_RECORD_FILE_RAN_NO_CASES: 'the local run reported a test file that contributed no case',
  RUN_RECORD_SUITE_FAILED: 'the local run failed a suite without failing a case',
  RUN_RECORD_RUN_NOT_SUCCESSFUL:
    'the local run did not succeed, whatever its case counts add up to',
  RUN_RECORD_HOSTED_PROVENANCE_INCOMPLETE:
    'a run record claiming a hosted runner without naming the run it came from',
  RUN_RECORD_HOSTED_HEAD_MISMATCH:
    'a hosted run record whose run describes a different head than the record does',
  RUN_RECORD_HOSTED_CLAIMS_LOCAL_MEASUREMENT:
    'a hosted run record carrying a local measurement it could not have taken',
  UNKNOWN_CLASS: 'an entry naming a class this gate does not implement',
  BAD_STANDING: 'a class and standing pair the vocabulary does not allow',
  UNSEALED_DOCUMENT: 'a document whose regions do not tile it',
});

const problem = (id, text) => ({ id, text: `${id}: ${text}` });

export function judge(facts) {
  const problems = [];
  const entries = Array.isArray(facts.ledger?.values) ? facts.ledger.values : [];
  const claimed = new Map(); // document -> Set of claimed token indices
  const regionsBy = new Map();

  for (const relative of SEALED_DOCUMENTS) {
    const source = facts.docs[relative];
    if (typeof source !== 'string') {
      problems.push(problem('UNSEALED_DOCUMENT', `${relative} could not be read`));
      continue;
    }
    const parsed = parseRegions(relative, source);
    for (const text of parsed.problems) problems.push(problem('UNSEALED_DOCUMENT', text));
    for (const text of parsed.subjectless) {
      problems.push(problem('EXCLUDED_REGION_NAMES_NO_SUBJECT', text));
    }
    /*
     * A gap is a piece of the page nobody classified. It is reported here rather
     * than only through its tokens, because a gap holding no digits is still a
     * hole in the tiling — and the next paragraph written into it inherits the
     * hole rather than being refused.
     */
    for (const gap of parsed.gaps) {
      problems.push(
        problem(
          'UNSEALED_DOCUMENT',
          `${relative}:${lineOf(source, gap.start)} is outside every ` +
            `seal region — "${gap.text.trim().slice(0, 60).replace(/\s+/g, ' ')}…"`
        )
      );
    }
    regionsBy.set(relative, parsed);
    claimed.set(relative, new Set());
  }

  /** The region a document offset falls in, or `undefined` for a gap. */
  const regionAt = (relative, index) =>
    regionsBy.get(relative)?.regions.find((r) => index >= r.start && index < r.end);

  const counters = {
    UNCLASSIFIED_CURRENT_VALUES: 0,
    UNBOUND_DERIVABLE_VALUES: 0,
    HOSTED_VALUES_WITHOUT_PROVENANCE: 0,
    PROTECTED_VALUES_MISREPRESENTED_AS_PREMERGE: 0,
    HISTORICAL_VALUES_COUNTED_AS_CURRENT: 0,
    /*
     * A MEASUREMENT, not a failure. It is the number of value tokens sitting in
     * banner-marked `historical` and `example` regions — the ones the coverage
     * rule deliberately does not scan. Reporting it is what stops "excluded"
     * being a word: a reader sees how much of the page is excluded, and the
     * subject rule above makes each of those regions say what it is history of.
     */
    EXCLUDED_VALUES: 0,
  };
  const byClass = Object.fromEntries(Object.keys(CLASSES).map((c) => [c, 0]));

  const seen = new Set();
  for (const entry of entries) {
    const id = entry?.id ?? '(unnamed)';
    if (seen.has(id)) problems.push(problem('UNKNOWN_CLASS', `\`${id}\` is declared twice`));
    seen.add(id);
    const spec = CLASSES[entry?.class];
    if (!spec) {
      problems.push(
        problem(
          'UNKNOWN_CLASS',
          `\`${id}\` is class \`${entry?.class}\`, which is not one of ` +
            Object.keys(CLASSES).join(', ')
        )
      );
      continue;
    }
    byClass[entry.class] += 1;
    const allowed = ALLOWED_STANDINGS[entry.class];
    if (!allowed.includes(entry.standing)) {
      problems.push(
        problem(
          'BAD_STANDING',
          `\`${id}\` is ${entry.class} with standing \`${entry.standing}\`; ` +
            `that class may only be ${allowed.join(' or ')}`
        )
      );
      continue;
    }

    /* -- the page side: where the value is, and that it is there -------- */
    const relative = entry.document;
    const source = facts.docs[relative];
    /*
     * A page-side fault does NOT skip the authority side. The first revision
     * returned early here, so an entry with a broken locator was never asked
     * where its number came from — a defect could hide behind a typo.
     */
    if (entry.value !== null && entry.value !== undefined && typeof source === 'string') {
      const hits = [...source.matchAll(new RegExp(escape(entry.locator ?? ''), 'g'))];
      if ((entry.locator ?? '') === '' || hits.length !== 1) {
        problems.push(
          problem(
            'LOCATOR_NOT_UNIQUE',
            `\`${id}\` has ${hits.length} match(es) in ${relative} for ` +
              `its locator — it must have exactly one`
          )
        );
      } else {
        const start = hits[0].index;
        const wanted = entry.occurrences ?? 1;
        const inside = tokensIn(source.slice(start, start + entry.locator.length), start).filter(
          (t) => t.value === entry.value
        );
        if (inside.length !== wanted) {
          problems.push(
            problem(
              'VALUE_NOT_IN_LOCATOR',
              `\`${id}\` claims ${wanted} occurrence(s) of ` +
                `\`${entry.value}\` at ${relative}:${lineOf(source, start)}; the locator holds ` +
                `${inside.length}`
            )
          );
        } else {
          for (const token of inside) claimed.get(relative)?.add(token.index);
        }
        const region = regionAt(relative, start);
        const wantedRegion =
          spec.region ?? (entry.standing === 'HISTORICAL' ? 'historical' : 'current');
        if (region?.kind !== wantedRegion) {
          const id2 =
            spec.current === false || entry.standing === 'HISTORICAL'
              ? 'HISTORICAL_VALUE_COUNTED_AS_CURRENT'
              : 'UNCLASSIFIED_CURRENT_VALUE';
          problems.push(
            problem(
              id2,
              `\`${id}\` is ${entry.class}/${entry.standing} but its locator sits in ` +
                `a \`${region?.kind ?? 'gap'}\` region; it belongs in a \`${wantedRegion}\` one`
            )
          );
          if (id2 === 'HISTORICAL_VALUE_COUNTED_AS_CURRENT') {
            counters.HISTORICAL_VALUES_COUNTED_AS_CURRENT += 1;
          } else {
            counters.UNCLASSIFIED_CURRENT_VALUES += 1;
          }
        }
      }
    } else if (entry.value !== null && entry.value !== undefined) {
      problems.push(problem('LOCATOR_NOT_UNIQUE', `\`${id}\` names document ${relative}`));
    }

    /* -- the authority side --------------------------------------------- */
    if (entry.class === 'DERIVABLE_LOCAL' || entry.class === 'DERIVABLE_GIT') {
      const { value, why } = resolveBinding(entry.binding, facts);
      if (value === null) {
        counters.UNBOUND_DERIVABLE_VALUES += 1;
        problems.push(
          problem(
            'UNBOUND_DERIVABLE_VALUE',
            `\`${id}\` is ${entry.class} and its binding ` + `resolves to nothing — ${why}`
          )
        );
      } else if (value !== entry.value) {
        problems.push(
          problem(
            'DERIVED_VALUE_DISAGREES',
            `\`${id}\` states \`${entry.value}\`; ${why} ` + `answers \`${value}\``
          )
        );
      }
    }

    if (entry.class === 'HOSTED_ARTIFACT_ATTESTED') {
      const p = entry.provenance ?? {};
      if (entry.binding) {
        problems.push(
          problem(
            'HOSTED_VALUE_CLAIMS_LOCAL_PROVENANCE',
            `\`${id}\` is hosted and also declares ` +
              `a local binding; a hosted fact has no local derivation`
          )
        );
      }
      if (entry.standing === 'PENDING_CANDIDATE_OBSERVATION') {
        if (entry.value !== null) {
          problems.push(
            problem(
              'HOSTED_VALUE_WITHOUT_PROVENANCE',
              `\`${id}\` is pending observation and ` + `still carries the value \`${entry.value}\``
            )
          );
          counters.HOSTED_VALUES_WITHOUT_PROVENANCE += 1;
        }
        /*
         * A pending field must say where the observation will come from. Without
         * it the entry is a promise with no address, and the set of pending
         * fields becomes a place to put anything nobody wants to measure.
         */
        if (typeof entry.collection !== 'string' || entry.collection.trim() === '') {
          problems.push(
            problem(
              'HOSTED_VALUE_WITHOUT_PROVENANCE',
              `\`${id}\` is pending observation and ` + `names no source it will be collected from`
            )
          );
          counters.HOSTED_VALUES_WITHOUT_PROVENANCE += 1;
        }
      } else {
        const missing = ['source', 'runId', 'job', 'headSha', 'artifact', 'field'].filter(
          (k) => typeof p[k] !== 'string' || p[k].trim() === ''
        );
        if (p.source !== undefined && p.source !== 'HOSTED_ARTIFACT') {
          missing.push('source must be HOSTED_ARTIFACT');
        }
        if (typeof p.runId === 'string' && !/^\d+$/.test(p.runId))
          missing.push('runId is not a run id');
        if (typeof p.headSha === 'string' && !/^[0-9a-f]{40}$/.test(p.headSha)) {
          missing.push('headSha is not a 40-character sha');
        }
        if (entry.standing === 'CURRENT' && typeof p.job === 'string' && !/^\d+$/.test(p.job)) {
          missing.push('a CURRENT hosted value must name a numeric job id');
        }
        if (missing.length > 0) {
          counters.HOSTED_VALUES_WITHOUT_PROVENANCE += 1;
          problems.push(
            problem(
              'HOSTED_VALUE_WITHOUT_PROVENANCE',
              `\`${id}\` is hosted and its provenance is ` + `incomplete — ${missing.join(', ')}`
            )
          );
        }
        /*
         * The head must RESOLVE, not merely be well-shaped.
         *
         * This rule exists because the author of this ledger wrote a
         * forty-character hexadecimal string that named no commit — expanding an
         * abbreviated sha from the page by hand instead of reading it from the
         * baseline that records the run. Every shape check above passed it. It
         * is the same defect the record beside it already documents once:
         * "`deadbeef` repeated five times satisfies a shape test perfectly."
         *
         * Fail-closed. A head this repository has not been asked about is not
         * evidence, so an unresolved key is a failure rather than a skip.
         */
        if (typeof p.headSha === 'string' && facts.commits?.[p.headSha] !== true) {
          counters.HOSTED_VALUES_WITHOUT_PROVENANCE += 1;
          problems.push(
            problem(
              'HOSTED_VALUE_HEAD_NOT_A_COMMIT',
              `\`${id}\` names head ${p.headSha}, which this repository does not hold as a ` +
                'commit. A well-formed sha is not an existence.'
            )
          );
        }
        if (missing.length === 0 && entry.standing === 'CURRENT') {
          const candidate = facts.lifecycle?.observations?.CODE_CANDIDATE_SHA ?? null;
          if (p.headSha !== candidate) {
            counters.HISTORICAL_VALUES_COUNTED_AS_CURRENT += 1;
            problems.push(
              problem(
                'HOSTED_VALUE_NOT_AT_CANDIDATE',
                `\`${id}\` is stated as CURRENT and ` +
                  `describes head ${p.headSha}; the code candidate is ${candidate ?? 'NOT FROZEN'}`
              )
            );
          }
        }
      }
    }

    /*
     * An excluded value is excluded from the SEAL, not from accountability.
     * A `historical` region's tokens are not scanned — that is what "excluded"
     * means — so without this rule the region would be a place to move a number
     * nobody wants checked. Each excluded value must either name the check that
     * binds it (several are derivable from the head they describe, because that
     * tree is still in the object database) or say in words why none can.
     */
    if (entry.class === 'HISTORICAL_SUPERSEDED' || entry.class === 'NON_NORMATIVE_EXAMPLE') {
      const bound = entry.boundBy;
      const excused = typeof entry.unbindable === 'string' && entry.unbindable.trim() !== '';
      if (!excused) {
        const source = typeof bound?.file === 'string' ? facts.files?.[bound.file] : undefined;
        if (typeof source !== 'string') {
          problems.push(
            problem(
              'EXCLUDED_VALUE_WITHOUT_DISPOSITION',
              `\`${id}\` names no readable ` +
                `\`boundBy.file\` and states no \`unbindable\` reason`
            )
          );
        } else if (typeof bound.contains !== 'string' || !source.includes(bound.contains)) {
          problems.push(
            problem(
              'EXCLUDED_VALUE_WITHOUT_DISPOSITION',
              `\`${id}\` says ${bound.file} binds it, ` +
                `and that file does not contain ${JSON.stringify(bound.contains ?? null)}`
            )
          );
        }
      }
    }

    if (entry.class === 'PROTECTED_POST_MERGE_ONLY') {
      const taken = facts.lifecycle?.observations?.PROTECTED_MERGE?.taken === true;
      if (!taken && entry.value !== null && entry.value !== undefined) {
        counters.PROTECTED_VALUES_MISREPRESENTED_AS_PREMERGE += 1;
        problems.push(
          problem(
            'PROTECTED_VALUE_MISREPRESENTED_AS_PREMERGE',
            `\`${id}\` carries the value ` +
              `\`${entry.value}\` while the protected merge has not been taken`
          )
        );
      }
      const phrase = entry.pendingPhrase;
      const doc = facts.docs[relative];
      const at = typeof doc === 'string' && typeof phrase === 'string' ? doc.indexOf(phrase) : -1;
      if (at === -1) {
        problems.push(
          problem(
            'PROTECTED_PENDING_NOT_STATED',
            `\`${id}\` declares the pending phrase ` +
              `${JSON.stringify(phrase ?? null)}, which ${relative} does not carry`
          )
        );
      } else if (regionAt(relative, at)?.kind !== 'current') {
        problems.push(
          problem(
            'PROTECTED_PENDING_NOT_STATED',
            `\`${id}\` states its pending status inside a ` +
              `\`${regionAt(relative, at)?.kind ?? 'gap'}\` region, where a reader reads it as history`
          )
        );
      }
    }
  }

  /* -- coverage: every token in a current or narrative region ----------- */
  const unclassified = [];
  for (const relative of SEALED_DOCUMENTS) {
    const source = facts.docs[relative];
    const parsed = regionsBy.get(relative);
    if (typeof source !== 'string' || !parsed) continue;
    const spans = [
      ...parsed.regions
        .filter((r) => r.kind === 'current' || r.kind === 'narrative')
        .map((r) => ({ from: r.start, to: r.end, where: `${r.kind} region \`${r.name}\`` })),
      ...parsed.gaps.map((g) => ({ from: g.start, to: g.end, where: 'an unsealed gap' })),
    ];
    for (const span of spans) {
      for (const token of tokensIn(source.slice(span.from, span.to), span.from)) {
        if (claimed.get(relative)?.has(token.index)) continue;
        unclassified.push(
          `${relative}:${lineOf(source, token.index)} \`${token.value}\` in ${span.where}`
        );
      }
    }
  }
  counters.UNCLASSIFIED_CURRENT_VALUES += unclassified.length;
  for (const text of unclassified) problems.push(problem('UNCLASSIFIED_CURRENT_VALUE', text));

  for (const relative of SEALED_DOCUMENTS) {
    const source = facts.docs[relative];
    const parsed = regionsBy.get(relative);
    if (typeof source !== 'string' || !parsed) continue;
    for (const region of parsed.regions) {
      if (region.kind !== 'historical' && region.kind !== 'example') continue;
      counters.EXCLUDED_VALUES += tokensIn(region.text).length;
    }
  }

  /* -- the run record's own freshness ----------------------------------- */
  problems.push(...judgeRunLedger(facts));

  return {
    ok: problems.length === 0,
    problems: problems.map((p) => p.text),
    failureIds: problems.map((p) => p.id),
    counters,
    byClass,
    values: entries.length,
    documents: SEALED_DOCUMENTS.length,
  };
}

/**
 * The run record expires rather than ages.
 *
 * Two rules, and the second is the one that matters. The first refuses a record
 * taken before an executable change — the tree it measured is not this tree. The
 * second compares the number of FILES the run reported against a walk of the
 * repository, which is a different question from the number of TESTS and is the
 * one that catches a stale total: `1586` was recorded when the suite held 65
 * files and sat there while it grew to 70, and no check compared either number
 * to the tree.
 */
/**
 * The fields `--record` must carry for the rules below to mean anything.
 *
 * A record written before this guard existed carries none of them, and that is
 * treated as INCOMPLETE rather than passing — an absent field is not evidence of
 * absence, and a gate that reads `undefined` as "nothing wrong" is the same
 * false green in a different place.
 */
export const RUN_RECORD_REQUIRED_FIELDS = Object.freeze([
  'exitCode',
  'reporterSuccess',
  'failedSuites',
  'filesWithoutCases',
]);

/**
 * What a vitest JSON report says about EXECUTION rather than about outcomes.
 *
 * The defect this exists for: a test file can be COUNTED in `testResults` and
 * contribute zero assertions — a file that failed to collect, a suite whose
 * top-level throw happened before any `it` registered, a `describe` that
 * returned early. vitest reports `numFailedTests: 0` for all of those, so a
 * ledger recording tests/passed/failed/files sees a smaller green run and
 * nothing else. The tier total moves on an unchanged tree and no gate objects.
 *
 * So four facts are recorded that outcomes alone cannot express:
 *   exitCode         what the runner itself returned
 *   reporterSuccess  the reporter's own verdict
 *   failedSuites     suites that failed without failing a case
 *   filesWithoutCases files present in the report that ran nothing
 */
export function runCompleteness(report, exitCode) {
  const files = report?.testResults ?? [];
  const filesWithoutCases = files
    .filter((file) => (file?.assertionResults ?? []).length === 0)
    .map((file) => String(file?.name ?? '(unnamed)'))
    .sort();
  const failedSuites = files
    .filter(
      (file) =>
        file?.status === 'failed' &&
        (file?.assertionResults ?? []).every((a) => a?.status !== 'failed')
    )
    .map((file) => String(file?.name ?? '(unnamed)'))
    .sort();
  return {
    exitCode,
    reporterSuccess: report?.success === true,
    failedSuites,
    filesWithoutCases,
  };
}

/**
 * Refuses a run record that cannot see a vanished case.
 *
 * Separate from the staleness rules above because it asks a different question:
 * those ask WHEN the run was taken, this asks whether the run actually ran what
 * it claims to have run.
 */
export function judgeRunCompleteness(tier, record) {
  const problems = [];
  const missing = RUN_RECORD_REQUIRED_FIELDS.filter((field) => record?.[field] === undefined);
  if (missing.length > 0) {
    problems.push(
      problem(
        'RUN_RECORD_INCOMPLETE',
        `the \`${tier}\` run record carries no ${missing.join(', ')} — it was taken ` +
          'before the run was asked whether every file contributed a case. Re-record it'
      )
    );
    // Deliberately NOT returning here: an incomplete record may still carry one
    // of the other fields, and a rule that can fire should fire.
  }
  const empty = record?.filesWithoutCases;
  if (Array.isArray(empty) && empty.length > 0) {
    problems.push(
      problem(
        'RUN_RECORD_FILE_RAN_NO_CASES',
        `the \`${tier}\` run reported ${empty.length} test file(s) that contributed no case — ` +
          `${empty.slice(0, 4).join(', ')}${empty.length > 4 ? ', …' : ''}. ` +
          'A counted file that runs nothing is a silent coverage loss, not a smaller green run'
      )
    );
  }
  const failedSuites = record?.failedSuites;
  if (Array.isArray(failedSuites) && failedSuites.length > 0) {
    problems.push(
      problem(
        'RUN_RECORD_SUITE_FAILED',
        `the \`${tier}\` run failed ${failedSuites.length} suite(s) without failing a case — ` +
          `${failedSuites.slice(0, 4).join(', ')}${failedSuites.length > 4 ? ', …' : ''}`
      )
    );
  }
  if (record?.exitCode !== undefined && record.exitCode !== 0) {
    problems.push(
      problem(
        'RUN_RECORD_RUN_NOT_SUCCESSFUL',
        `the \`${tier}\` run exited ${record.exitCode}; a non-zero runner verdict is not made ` +
          'green by a zero failure count'
      )
    );
  }
  if (record?.reporterSuccess === false) {
    problems.push(
      problem(
        'RUN_RECORD_RUN_NOT_SUCCESSFUL',
        `the \`${tier}\` run's reporter recorded success: false`
      )
    );
  }
  return problems;
}

/**
 * What a run record must name to be believed about a runner nobody here can see.
 *
 * The same shape this gate already demands of a HOSTED_ARTIFACT_ATTESTED closing
 * value, for the same reason: no local command can re-derive a hosted
 * observation, so what is checkable is INTERNAL CONSISTENCY — that the record
 * names a run, a job and the exact head it describes.
 */
export const HOSTED_PROVENANCE_FIELDS = Object.freeze([
  'source',
  'runId',
  'job',
  'headSha',
  'artifact',
  'field',
]);

/**
 * Refuses a run record that claims a hosted runner it cannot account for.
 *
 * A local record is judged by the rules above and nothing here applies to it.
 * What this exists for is the record taken from a GitHub run, which is the
 * stronger evidence — it is the runner the repository actually ships against —
 * and which for exactly that reason must not be assertable by hand.
 *
 * None of these rules relax the completeness rules. A hosted record with a
 * non-zero exit code is refused by `judgeRunCompleteness` just as a local one
 * is; the runner being authoritative is what makes its verdict binding, not what
 * makes it negotiable.
 */
export function judgeRunProvenance(tier, record) {
  const p = record?.provenance;
  if (p === undefined) return [];
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    return [
      problem(
        'RUN_RECORD_HOSTED_PROVENANCE_INCOMPLETE',
        `the \`${tier}\` run record carries a provenance that is not an object`
      ),
    ];
  }
  const problems = [];
  const missing = HOSTED_PROVENANCE_FIELDS.filter(
    (field) => typeof p[field] !== 'string' || p[field].trim() === ''
  );
  if (p.source !== undefined && p.source !== 'hosted') {
    // One source is supported. A record naming another was written by something
    // this gate does not know, and reading it as hosted would be believing a
    // claim nobody checked.
    missing.push(`source \`${String(p.source)}\` is not \`hosted\``);
  }
  if (typeof p.runId === 'string' && !/^\d+$/.test(p.runId)) missing.push('runId is not a run id');
  if (typeof p.job === 'string' && !/^\d+$/.test(p.job)) missing.push('job is not a job id');
  if (typeof p.headSha === 'string' && !/^[0-9a-f]{40}$/.test(p.headSha)) {
    missing.push('headSha is not a 40-character commit');
  }
  if (missing.length > 0) {
    problems.push(
      problem(
        'RUN_RECORD_HOSTED_PROVENANCE_INCOMPLETE',
        `the \`${tier}\` run record claims a hosted runner but its provenance is incomplete — ` +
          `${missing.join(', ')}. A hosted fact that names no run is an assertion`
      )
    );
  }
  if (
    typeof p.headSha === 'string' &&
    typeof record.measuredAtCommit === 'string' &&
    p.headSha !== record.measuredAtCommit
  ) {
    // The one way a record could be assembled out of two runs: counts from a
    // green run of one tree, filed against another.
    problems.push(
      problem(
        'RUN_RECORD_HOSTED_HEAD_MISMATCH',
        `the \`${tier}\` run record was taken at ${record.measuredAtCommit.slice(0, 8)} but its ` +
          `run describes ${p.headSha.slice(0, 8)}`
      )
    );
  }
  if (Array.isArray(record.dirtyExecutablePaths) && record.dirtyExecutablePaths.length > 0) {
    // A hosted runner checks a commit out and runs it. It has no working tree to
    // be dirty, so a hosted record naming dirty paths was assembled somewhere
    // else and describes a tree the run never saw.
    problems.push(
      problem(
        'RUN_RECORD_HOSTED_CLAIMS_LOCAL_MEASUREMENT',
        `the \`${tier}\` run record is hosted yet names ${record.dirtyExecutablePaths.length} ` +
          'dirty executable path(s); a hosted checkout has none'
      )
    );
  }
  return problems;
}

export function judgeRunLedger(facts) {
  const problems = [];
  const runs = facts.runs;
  if (!runs || typeof runs !== 'object') {
    return [problem('RUN_RECORD_STALE', `${RUN_LEDGER_PATH} is absent — run \`--record\``)];
  }
  for (const [tier, record] of Object.entries(runs.tiers ?? {})) {
    // Completeness FIRST, and outside the staleness short-circuits below: a
    // record that names no resolvable commit `continue`s, and a run that ran
    // nothing would then never be judged at all.
    problems.push(...judgeRunCompleteness(tier, record));
    problems.push(...judgeRunProvenance(tier, record));
    const at = record.measuredAtCommit;
    if (typeof at !== 'string' || !/^[0-9a-f]{40}$/.test(at)) {
      problems.push(
        problem('RUN_RECORD_STALE', `the \`${tier}\` run record names no 40-character commit`)
      );
      continue;
    }
    const changed = facts.executableChanges?.[at];
    if (changed === undefined) {
      problems.push(
        problem(
          'RUN_RECORD_STALE',
          `the \`${tier}\` run record names commit ${at}, ` + `which this repository cannot resolve`
        )
      );
      continue;
    }
    if (changed.length > 0) {
      problems.push(
        problem(
          'RUN_RECORD_STALE',
          `the \`${tier}\` run was taken at ${at.slice(0, 8)} and ` +
            `${changed.length} executable path(s) have changed since — ${changed.slice(0, 4).join(', ')}` +
            `${changed.length > 4 ? ', …' : ''}`
        )
      );
    }
    if (Array.isArray(record.dirtyExecutablePaths) && record.dirtyExecutablePaths.length > 0) {
      problems.push(
        problem(
          'RUN_RECORD_STALE',
          `the \`${tier}\` run was taken with ` +
            `${record.dirtyExecutablePaths.length} uncommitted executable path(s) in the tree`
        )
      );
    }
    const expected = facts.tierFiles?.[tier];
    if (expected !== undefined && Number(record.files) !== expected) {
      problems.push(
        problem(
          'RUN_RECORD_FILE_COUNT_DISAGREES',
          `the \`${tier}\` run reported ` + `${record.files} file(s); this tree holds ${expected}`
        )
      );
    }
    if (Number(record.failed) !== 0) {
      problems.push(
        problem('RUN_RECORD_STALE', `the \`${tier}\` run recorded ${record.failed} failure(s)`)
      );
    }
  }
  return problems;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------------------------------------------ *
 * Negative proofs, run on every invocation
 * ------------------------------------------------------------------ */

/** A minimal tree the self-check mutates, so each case differs in one thing. */
function baselineFacts() {
  const cleanRoom =
    '<!-- seal: current tree -->\n' +
    '\nThe suite holds **70 web test files**.\n' +
    '\nCODEQL_REPOSITORY_CEILING — PENDING PROTECTED MERGE.\n' +
    '\n<!-- seal: end tree -->\n' +
    '<!-- seal: historical old -->\n' +
    '\n> **HISTORICAL** — this describes `bbbbbbb`, a head this record supersedes.\n' +
    '\nThe tier ran 1216 tests.\n' +
    '\n| gate | decision |\n| ---- | -------- |\n| ci | Go |\n\n' +
    '<!-- seal: end old -->\n';
  const ciEvidence =
    '<!-- seal: narrative masthead -->\n\nNothing numeric here.\n\n<!-- seal: end masthead -->\n';
  return {
    docs: { [CLEAN_ROOM]: cleanRoom, [CI_EVIDENCE]: ciEvidence },
    files: { 'tests/ci/p1-27-doc-counts.test.ts': 'the superseded web tier row' },
    commits: { ['b'.repeat(40)]: true },
    derived: { counts: { 'apps/web/tests': 70 } },
    unitTierFiles: 90,
    git: { 'trackedFiles:docs:': 38 },
    baseline: { tiers: { web: { minTests: 1793 } } },
    runs: {
      tiers: {
        // The four completeness fields are part of the CLEAN baseline, so cases
        // R1-R4 below mutate a record that starts valid. Without them the baseline
        // itself is INCOMPLETE and every case would pass for that reason instead
        // of for its own.
        web: {
          tests: 1867,
          files: 70,
          failed: 0,
          exitCode: 0,
          reporterSuccess: true,
          failedSuites: [],
          filesWithoutCases: [],
          measuredAtCommit: 'a'.repeat(40),
        },
      },
    },
    tierFiles: { web: 70 },
    executableChanges: { ['a'.repeat(40)]: [] },
    lifecycle: {
      observations: { CODE_CANDIDATE_SHA: null, PROTECTED_MERGE: { taken: false } },
    },
    ledger: {
      values: [
        {
          id: 'FILES',
          class: 'DERIVABLE_LOCAL',
          standing: 'CURRENT',
          document: CLEAN_ROOM,
          locator: 'holds **70 web test files**',
          value: '70',
          binding: { kind: 'derived', table: 'counts', name: 'apps/web/tests' },
        },
        {
          id: 'GATE',
          class: 'HOSTED_ARTIFACT_ATTESTED',
          standing: 'PENDING_CANDIDATE_OBSERVATION',
          document: CLEAN_ROOM,
          value: null,
          collection: 'the `ci-gate` job summary on the candidate’s hosted run',
        },
        {
          id: 'DECISION',
          class: 'HOSTED_ARTIFACT_ATTESTED',
          standing: 'HISTORICAL',
          document: CLEAN_ROOM,
          locator: '| ci | Go |',
          value: 'Go',
          provenance: {
            source: 'HOSTED_ARTIFACT',
            runId: '31312531302',
            job: 'ci-gate',
            headSha: 'b'.repeat(40),
            artifact: 'ci-gate-decision',
            field: 'decision',
          },
        },
        {
          id: 'CEILING',
          class: 'PROTECTED_POST_MERGE_ONLY',
          standing: 'PENDING_PROTECTED_MERGE',
          document: CLEAN_ROOM,
          value: null,
          pendingPhrase: 'CODEQL_REPOSITORY_CEILING — PENDING PROTECTED MERGE.',
        },
        {
          id: 'OLD-WEB',
          class: 'HISTORICAL_SUPERSEDED',
          standing: 'HISTORICAL',
          document: CLEAN_ROOM,
          locator: 'The tier ran 1216 tests.',
          value: '1216',
          boundBy: {
            file: 'tests/ci/p1-27-doc-counts.test.ts',
            contains: 'the superseded web tier row',
          },
        },
      ],
    },
  };
}

const clone = (facts) => JSON.parse(JSON.stringify(facts));

/**
 * Eight mutations, each of which must be REFUSED, and the failure each must name.
 *
 * They run inside the gate on every invocation rather than only under vitest,
 * because a gate whose negative proofs live somewhere else is a gate that can be
 * weakened by editing one file and running the other.
 */
export const SELF_CHECK_CASES = Object.freeze([
  {
    id: 'A',
    what: 'a derived value the tree contradicts',
    expect: 'DERIVED_VALUE_DISAGREES',
    mutate: (f) => {
      f.derived.counts['apps/web/tests'] = 71;
    },
  },
  {
    id: 'B',
    what: 'a value token nothing claims',
    expect: 'UNCLASSIFIED_CURRENT_VALUE',
    mutate: (f) => {
      f.docs[CLEAN_ROOM] = f.docs[CLEAN_ROOM].replace(
        'The suite holds',
        'The floor is 1793 and the suite holds'
      );
    },
  },
  {
    id: 'C',
    what: 'a locator that matches nothing',
    expect: 'LOCATOR_NOT_UNIQUE',
    mutate: (f) => {
      f.ledger.values[0].locator = 'holds **71 web test files**';
    },
  },
  {
    id: 'D',
    what: 'an excluded value moved into a current region',
    expect: 'HISTORICAL_VALUE_COUNTED_AS_CURRENT',
    mutate: (f) => {
      f.docs[CLEAN_ROOM] = f.docs[CLEAN_ROOM].replace(
        '\nThe tier ran 1216 tests.\n',
        '\nThe tier ran no tests.\n'
      ).replace('The suite holds', 'The tier ran 1216 tests. The suite holds');
      f.ledger.values[4].locator = 'The tier ran 1216 tests.';
    },
  },
  {
    id: 'E',
    what: 'a hosted value with no job or artefact named',
    expect: 'HOSTED_VALUE_WITHOUT_PROVENANCE',
    mutate: (f) => {
      delete f.ledger.values[2].provenance.job;
    },
  },
  {
    id: 'E2',
    what: 'a hosted value naming a well-formed sha that resolves to nothing',
    expect: 'HOSTED_VALUE_HEAD_NOT_A_COMMIT',
    mutate: (f) => {
      f.ledger.values[2].provenance.headSha = 'deadbeef'.repeat(5);
    },
  },
  {
    id: 'F',
    what: 'a hosted value promoted to CURRENT at a head that is not the candidate',
    expect: 'HOSTED_VALUE_NOT_AT_CANDIDATE',
    mutate: (f) => {
      f.ledger.values[2].standing = 'CURRENT';
      f.ledger.values[2].provenance.job = '93836261711';
    },
  },
  {
    id: 'G',
    what: 'a protected-only value given a figure before the merge',
    expect: 'PROTECTED_VALUE_MISREPRESENTED_AS_PREMERGE',
    mutate: (f) => {
      f.ledger.values[3].value = '0';
      f.ledger.values[3].locator = '`CODEQL_REPOSITORY_CEILING` — PENDING PROTECTED MERGE.';
    },
  },
  {
    id: 'H',
    what: 'a run record taken before an executable change',
    expect: 'RUN_RECORD_STALE',
    mutate: (f) => {
      f.executableChanges['a'.repeat(40)] = ['apps/web/src/lib/api/client.ts'];
    },
  },
  {
    id: 'I',
    what: 'a run record whose file count is not the tree’s',
    expect: 'RUN_RECORD_FILE_COUNT_DISAGREES',
    mutate: (f) => {
      f.runs.tiers.web.files = 65;
    },
  },
  // The zero-case false-green class. Each mutation is the SMALLEST change that
  // produces its failure, so a case cannot pass by accidentally tripping another
  // rule — which is the whole reason this self-check table exists.
  {
    id: 'R1',
    what: 'a run record that counted a file which contributed no case',
    expect: 'RUN_RECORD_FILE_RAN_NO_CASES',
    mutate: (f) => {
      f.runs.tiers.web.filesWithoutCases = ['apps/web/tests/reception-checkin.dom.test.tsx'];
    },
  },
  {
    id: 'R2',
    what: 'a run record taken before the run was asked whether every file ran',
    expect: 'RUN_RECORD_INCOMPLETE',
    mutate: (f) => {
      delete f.runs.tiers.web.filesWithoutCases;
    },
  },
  {
    id: 'R3',
    what: 'a suite that failed without failing a case',
    expect: 'RUN_RECORD_SUITE_FAILED',
    mutate: (f) => {
      f.runs.tiers.web.failedSuites = ['apps/web/tests/p1-28-qa.test.tsx'];
    },
  },
  {
    id: 'R4',
    what: 'a runner that exited non-zero while every case it ran passed',
    expect: 'RUN_RECORD_RUN_NOT_SUCCESSFUL',
    mutate: (f) => {
      f.runs.tiers.web.exitCode = 1;
    },
  },
  {
    id: 'R5',
    what: 'a record claiming a hosted runner without naming the run',
    expect: 'RUN_RECORD_HOSTED_PROVENANCE_INCOMPLETE',
    mutate: (f) => {
      f.runs.tiers.web.provenance = { source: 'hosted' };
    },
  },
  {
    id: 'R6',
    what: 'a hosted record whose run describes a different head',
    expect: 'RUN_RECORD_HOSTED_HEAD_MISMATCH',
    mutate: (f) => {
      f.runs.tiers.web.provenance = {
        source: 'hosted',
        runId: '1',
        job: '2',
        headSha: 'f'.repeat(40),
        artifact: 'evidence-web-quality',
        field: 'apps/web/vitest-web.json',
      };
    },
  },
  {
    id: 'R7',
    what: 'a hosted record carrying a dirty working tree no hosted checkout has',
    expect: 'RUN_RECORD_HOSTED_CLAIMS_LOCAL_MEASUREMENT',
    mutate: (f) => {
      f.runs.tiers.web.provenance = {
        source: 'hosted',
        runId: '1',
        job: '2',
        headSha: f.runs.tiers.web.measuredAtCommit,
        artifact: 'evidence-web-quality',
        field: 'apps/web/vitest-web.json',
      };
      f.runs.tiers.web.dirtyExecutablePaths = ['apps/web/src/app/page.tsx'];
    },
  },
  {
    id: 'J',
    what: 'a document with an unsealed gap',
    expect: 'UNSEALED_DOCUMENT',
    mutate: (f) => {
      f.docs[CI_EVIDENCE] += '\nAn unsealed paragraph.\n';
    },
  },
  {
    id: 'K0',
    what: 'a ledger value the page does not carry where the ledger says it does',
    expect: 'VALUE_NOT_IN_LOCATOR',
    mutate: (f) => {
      f.ledger.values[0].value = '71';
    },
  },
  {
    id: 'K',
    what: 'an excluded value with no check named and no reason given',
    expect: 'EXCLUDED_VALUE_WITHOUT_DISPOSITION',
    mutate: (f) => {
      delete f.ledger.values[4].boundBy;
    },
  },
  {
    id: 'L0',
    what: 'a historical region that does not say which head it is history of',
    expect: 'EXCLUDED_REGION_NAMES_NO_SUBJECT',
    mutate: (f) => {
      f.docs[CLEAN_ROOM] = f.docs[CLEAN_ROOM].replace(
        '> **HISTORICAL** — this describes `bbbbbbb`, a head this record supersedes.',
        '> **HISTORICAL** — this describes an earlier state of the branch.'
      );
    },
  },
  {
    id: 'L',
    what: 'an excluded region whose banner is invisible to a reader',
    expect: 'UNSEALED_DOCUMENT',
    mutate: (f) => {
      f.docs[CLEAN_ROOM] = f.docs[CLEAN_ROOM].replace(
        '> **HISTORICAL** — this describes `bbbbbbb`, a head this record supersedes.',
        'This describes a head this record supersedes.'
      );
    },
  },
]);

export function selfCheck(cases = SELF_CHECK_CASES) {
  const failures = [];
  const base = judge(baselineFacts());
  if (!base.ok) {
    failures.push(`the self-check baseline is not clean: ${base.problems.join('; ')}`);
  }
  for (const test of cases) {
    const facts = clone(baselineFacts());
    test.mutate(facts);
    const result = judge(facts);
    if (!result.failureIds.includes(test.expect)) {
      failures.push(
        `self-check ${test.id} (${test.what}) was accepted, or named ` +
          `${result.failureIds.join('/') || 'nothing'} rather than ${test.expect}`
      );
    }
  }
  return failures;
}

/* ------------------------------------------------------------------ *
 * Reading the tree
 * ------------------------------------------------------------------ */

function git(args, root = ROOT) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const readJson = (root, relative) =>
  existsSync(native(root, relative))
    ? JSON.parse(readFileSync(native(root, relative), 'utf8'))
    : null;

/** The unit tier's files, by the rule `vitest.config.ts` applies. */
export function unitTierFiles(root = ROOT) {
  const excluded = [join('tests', 'db') + sep, join('tests', 'backend') + sep];
  return walk(join(root, 'tests'), (p) => /\.test\.ts$/.test(p)).filter(
    (p) => !excluded.some((dir) => p.includes(dir))
  ).length;
}

export function readFacts(root = ROOT) {
  const ledger = readJson(root, LEDGER_PATH);
  const docs = {};
  for (const relative of SEALED_DOCUMENTS) {
    const path = native(root, relative);
    if (existsSync(path)) docs[relative] = readFileSync(path, 'utf8');
  }
  const derived = deriveCounts(root);
  const runs = readJson(root, RUN_LEDGER_PATH);

  /* Every head a hosted record names is looked up in the object database. */
  const commits = {};
  for (const entry of ledger?.values ?? []) {
    const head = entry?.provenance?.headSha;
    if (typeof head !== 'string' || head in commits) continue;
    commits[head] = commitExists(head, root);
  }

  /* Only the files an excluded value names as its binding are read. */
  const files = {};
  for (const entry of ledger?.values ?? []) {
    const path = entry?.boundBy?.file;
    if (typeof path !== 'string' || path in files) continue;
    files[path] = existsSync(native(root, path)) ? readFileSync(native(root, path), 'utf8') : null;
  }

  /* Only the git questions the ledger actually asks are run. */
  const gitFacts = {};
  for (const entry of ledger?.values ?? []) {
    if (entry?.binding?.kind !== 'git') continue;
    const key = gitKey(entry.binding);
    if (key === null || key in gitFacts) continue;
    gitFacts[key] = resolveGit(entry.binding, root);
  }

  const executableChanges = {};
  for (const record of Object.values(runs?.tiers ?? {})) {
    const at = record?.measuredAtCommit;
    if (typeof at !== 'string' || at in executableChanges) continue;
    executableChanges[at] = commitExists(at, root) ? executableChangesSince(at, root) : undefined;
  }

  return {
    ledger,
    docs,
    files,
    commits,
    derived,
    unitTierFiles: unitTierFiles(root),
    git: gitFacts,
    baseline: readJson(root, BASELINE_PATH),
    schemaBaseline: readJson(root, SCHEMA_BASELINE_PATH),
    lifecycle: readJson(root, LIFECYCLE_PATH),
    runs,
    executableChanges,
    tierFiles: { web: derived.counts['apps/web/tests'], unit: unitTierFiles(root) },
  };
}

function resolveGit(binding, root) {
  try {
    switch (binding.op) {
      case 'revParse':
        return git(['rev-parse', binding.ref], root).trim();
      case 'executableDiffCount':
        return executableChangesSince(binding.since, root, undefined, binding.until ?? 'HEAD')
          .length;
      case 'trackedFiles': {
        const files = git(['ls-files', '--', binding.dir], root).split('\n').filter(Boolean);
        const re = binding.match ? new RegExp(binding.match) : null;
        return files.filter((p) => (re ? re.test(p) : true)).length;
      }
      case 'lsTree': {
        const files = git(
          ['ls-tree', '-r', '--name-only', binding.sha, '--', binding.pathspec],
          root
        )
          .split('\n')
          .filter(Boolean);
        const re = binding.match ? new RegExp(binding.match) : null;
        return files.filter((p) => (re ? re.test(p) : true)).length;
      }
      case 'revListCount':
        return Number(git(['rev-list', '--count', `${binding.from}..${binding.to}`], root).trim());
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * `--record` — the only writer of the run ledger
 * ------------------------------------------------------------------ */

export const TIER_COMMANDS = Object.freeze({
  unit: ['npx', 'vitest', 'run'],
  web: ['npm', 'run', 'test', '--workspace', '@rootlco/web', '--'],
});

/**
 * Run a tier and record what it did, with the commit it was taken at.
 *
 * The command is spawned here rather than read from a file somebody produced,
 * so the ledger has one author and a hand-assembled total cannot enter it.
 * `testResults.length` is the file count — `numTotalTestSuites` counts `describe`
 * blocks, which is 486 for a 90-file tier and would have made the cross-check
 * against the tree meaningless.
 */
function record(tier, root = ROOT) {
  const command = TIER_COMMANDS[tier];
  if (!command) {
    process.stderr.write(`::error::unknown tier \`${tier}\` — ${Object.keys(TIER_COMMANDS)}\n`);
    return 2;
  }
  /*
   * The reporter's output goes to a temporary directory, not the repository.
   * A JSON report dropped in the working tree is an untracked artefact that
   * `validate:generated-artifacts` would have to learn about, and the ledger is
   * the thing meant to be committed — the raw report is an intermediate.
   */
  const out = join(tmpdir(), `rootlco-vitest-${tier}-${process.pid}.json`);
  const args = [...command.slice(1), '--reporter=json', `--outputFile=${out}`];
  const head = git(['rev-parse', 'HEAD'], root).trim();
  const dirty = git(['status', '--porcelain'], root)
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  let exitCode = 0;
  try {
    execFileSync(command[0], args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  } catch (error) {
    // The runner's own verdict, KEPT rather than discarded. A tier can exit
    // non-zero while every case it managed to run passed — a file that failed to
    // COLLECT is the ordinary way — and `numFailedTests` is 0 in exactly that
    // case. Throwing the exit code away is what made the two indistinguishable.
    exitCode = typeof error?.status === 'number' ? error.status : 1;
  }
  if (!existsSync(out)) {
    process.stderr.write(`::error::the ${tier} run produced no JSON report at ${out}\n`);
    return 2;
  }
  const report = JSON.parse(readFileSync(out, 'utf8'));
  const ledger = readJson(root, RUN_LEDGER_PATH) ?? {
    task: 'P1-27 local tier measurements',
    what: 'What a tier DID when it was run, written only by `check-p1-27-closing-values.mjs --record`.',
    why: 'An executed test total is not derivable by reading files, and binding it to another document is the circle that let 1586 stand beside a tree of 1867. This is a command’s output, carrying the commit it was taken at, and it expires when any executable path changes.',
    howToTake: 'node scripts/ci/check-p1-27-closing-values.mjs --record <tier>',
    tiers: {},
  };
  ledger.tiers[tier] = {
    command: `${command.join(' ')} --reporter=json`,
    tests: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    files: (report.testResults ?? []).length,
    ...runCompleteness(report, exitCode),
    measuredAtCommit: head,
    dirtyExecutablePaths: dirty.filter((p) => !p.startsWith('docs/') && !p.endsWith('.md')),
    measuredAt: new Date().toISOString(),
  };
  writeFileSync(native(root, RUN_LEDGER_PATH), `${JSON.stringify(ledger, null, 2)}\n`);
  process.stdout.write(
    `recorded ${tier}: ${report.numTotalTests} tests, ${report.numFailedTests} failed, ` +
      `${(report.testResults ?? []).length} files at ${head.slice(0, 8)}\n`
  );
  return 0;
}

/**
 * Records a tier from the GitHub run that produced it, rather than from a run of
 * it here.
 *
 * WHY A SECOND WRITER EXISTS. The ledger records the RUNNER'S OWN VERDICT, and
 * that verdict is a property of the machine as much as of the tree. This
 * repository's unit tier exits 0 on the hosted runner and 1 on a slower one,
 * where three test files each hold a worker's event loop past birpc's
 * sixty-second deadline and vitest raises unhandled `onTaskUpdate` timeouts with
 * all 3051 cases passing. `judgeRunCompleteness` refuses that record, correctly.
 * So the record has to be taken from the runner whose verdict this repository
 * ships against — which is also the stronger evidence, and which the test-count
 * baseline already says supersedes a local figure.
 *
 * NOTHING HERE IS TYPED. Given a run id, the head, the job, the exit code and
 * the counts are all read from the API or from the artifact the run uploaded,
 * whose bytes are checked against the digest GitHub publishes for them. A caller
 * can pass the wrong run; it cannot pass the wrong numbers.
 *
 * The run must describe THIS head, and the record is filed against the commit it
 * was taken at, so the staleness rules expire it exactly as they expire a local
 * one. A hosted record buys authority, not permanence.
 */
export async function recordHosted(tier, runId, root = ROOT) {
  if (!TIER_COMMANDS[tier]) {
    process.stderr.write(`::error::unknown tier \`${tier}\` — ${Object.keys(TIER_COMMANDS)}\n`);
    return 2;
  }
  if (!/^\d+$/.test(String(runId ?? ''))) {
    process.stderr.write('::error::--hosted-run needs a numeric GitHub run id\n');
    return 2;
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    process.stderr.write(
      '::error::no GH_TOKEN/GITHUB_TOKEN. Reading a hosted run needs an authenticated read, and ' +
        'refusing is the only honest answer without one\n'
    );
    return 2;
  }
  const remote = git(['remote', 'get-url', 'origin'], root).trim();
  const repo =
    process.env.GITHUB_REPOSITORY ?? remote.match(/github\.com[/:]([^/]+\/[^/.]+)/)?.[1] ?? '';
  if (!repo) {
    process.stderr.write('::error::cannot tell which repository this is from `origin`\n');
    return 2;
  }

  let hosted;
  try {
    const { fetchHostedTierRun } = await import('../lib/hosted-run-report.mjs');
    hosted = await fetchHostedTierRun({ repo, runId: String(runId), tier, token });
  } catch (error) {
    process.stderr.write(`::error::${error.message}\n`);
    return 2;
  }

  const head = git(['rev-parse', 'HEAD'], root).trim();
  if (hosted.headSha !== head) {
    // Filing a run of one tree against another is the single way this writer
    // could manufacture a green record, so it is refused here rather than left
    // for the gate to catch afterwards.
    process.stderr.write(
      `::error::run ${runId} describes ${hosted.headSha.slice(0, 8)} but HEAD is ` +
        `${head.slice(0, 8)}; a record may only be filed against the head its run ran\n`
    );
    return 2;
  }

  const report = hosted.report;
  const ledger = readJson(root, RUN_LEDGER_PATH) ?? { tiers: {} };
  ledger.tiers[tier] = {
    command: `${TIER_COMMANDS[tier].join(' ')} --reporter=json`,
    tests: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    files: (report.testResults ?? []).length,
    ...runCompleteness(report, hosted.exitCode),
    measuredAtCommit: hosted.headSha,
    // A hosted checkout has no working tree to be dirty. Stated as an empty list
    // rather than omitted, because the gate reads an absent field as unknown.
    dirtyExecutablePaths: [],
    measuredAt: hosted.completedAt,
    provenance: {
      source: 'hosted',
      runId: hosted.runId,
      runUrl: hosted.runUrl,
      workflow: hosted.workflow,
      job: hosted.job,
      jobName: hosted.jobName,
      step: hosted.step,
      artifact: hosted.artifact,
      artifactDigest: hosted.artifactDigest,
      field: hosted.field,
    },
  };
  writeFileSync(native(root, RUN_LEDGER_PATH), `${JSON.stringify(ledger, null, 2)}\n`);
  process.stdout.write(
    `recorded ${tier} from hosted run ${hosted.runId} job ${hosted.job}: ` +
      `${report.numTotalTests} tests, ${report.numFailedTests} failed, ` +
      `${(report.testResults ?? []).length} files, exit ${hosted.exitCode} at ` +
      `${hosted.headSha.slice(0, 8)}\n`
  );
  return 0;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function evaluate(root = ROOT) {
  const selfFailures = selfCheck();
  const result = judge(readFacts(root));
  return {
    ...result,
    ok: result.ok && selfFailures.length === 0,
    problems: [...selfFailures, ...result.problems],
  };
}

function main(argv) {
  if (argv.includes('--record')) {
    const tier = argv[argv.indexOf('--record') + 1];
    return argv.includes('--hosted-run')
      ? recordHosted(tier, argv[argv.indexOf('--hosted-run') + 1], ROOT)
      : record(tier, ROOT);
  }
  let result;
  try {
    result = evaluate(ROOT);
  } catch (error) {
    process.stderr.write(`::error::cannot classify P1-27 closing values: ${error.message}\n`);
    return 2;
  }
  const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  for (const text of result.problems) process.stderr.write(`::error::${text}\n`);
  const c = result.counters;
  process.stdout.write(
    `P1-27 closing values: ${result.values} classified across ${result.documents} document(s) — ` +
      Object.entries(result.byClass)
        .map(([name, n]) => `${CLASSES[name].letter}:${n}`)
        .join(' ') +
      `\n  UNCLASSIFIED_CURRENT_VALUES=${c.UNCLASSIFIED_CURRENT_VALUES}` +
      ` UNBOUND_DERIVABLE_VALUES=${c.UNBOUND_DERIVABLE_VALUES}` +
      ` HOSTED_VALUES_WITHOUT_PROVENANCE=${c.HOSTED_VALUES_WITHOUT_PROVENANCE}` +
      ` PROTECTED_VALUES_MISREPRESENTED_AS_PREMERGE=${c.PROTECTED_VALUES_MISREPRESENTED_AS_PREMERGE}` +
      ` HISTORICAL_VALUES_COUNTED_AS_CURRENT=${c.HISTORICAL_VALUES_COUNTED_AS_CURRENT}\n` +
      `  EXCLUDED_VALUES=${c.EXCLUDED_VALUES} (in banner-marked regions, each naming its subject)\n` +
      `  ${result.problems.length} problem(s).\n`
  );
  return result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // `--record --hosted-run` reads the GitHub API, so main may answer with a
  // promise. Every other path stays synchronous and exits exactly as before.
  const answer = main(process.argv.slice(2));
  if (typeof answer === 'number') process.exit(answer);
  else
    answer.then(
      (code) => process.exit(code),
      (error) => {
        process.stderr.write(`::error::${error.message}\n`);
        process.exit(2);
      }
    );
}
