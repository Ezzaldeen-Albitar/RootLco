#!/usr/bin/env node
/**
 * P1-28 record-to-tree synchronization (`P1-28-DOC-001`).
 *
 * ## The question this answers
 *
 * DOC-001 owns the phase's factual record: the contract archaeology, the
 * canonical plan and the traceability between them. Its whole failure mode is
 * **a true sentence that stopped being true**, and this phase has already shipped
 * that failure twice inside one week:
 *
 *   - the archaeology asserted "no read exists anywhere in apt/rec" after PR #220
 *     had published fifteen of them and P1-28 screens were calling them; and
 *   - it asserted the warning-light catalogue "has no management operation"
 *     after PR #227 had registered twenty-one catalogue-management writes.
 *
 * Both were corrected by hand, which produces sentences that will be wrong
 * again. The durable fix is the one `check-p1-27-doc-counts.mjs` reached for the
 * same defect family: **the repository is the authority and a document may only
 * state a fact it opts into, which this gate substitutes the tree's answer for.**
 *
 * ## What it proves, one clause per axis DOC-001 owns
 *
 *   1. **Task mapping** — the record accounts for every canonical task in
 *      `canonical-plan.md` §5, and for no other id.
 *   2. **Operation catalogue** — every operation a §5 row binds is registered in
 *      the P1-24 operation register AT THIS HEAD. A `[MISSING Rn]` marker for a
 *      remediation that has landed fails here rather than ageing in prose.
 *   3. **Permissions** — every permission code the register attributes to a
 *      published `apt.*`/`rec.*` operation is accounted for by the record, and
 *      the record names no code the register does not publish.
 *   4. **Test references** — every `TC-P1-28-*` id the plan declares resolves to
 *      real cases in real files, quoted by title and matched against
 *      COMMENT-STRIPPED source. An id with no proof must state its gap; an
 *      unstated gap is a lie, and a title quoted from a comment is not a case.
 *   5. **Browser coverage** — the browser citations must come from the
 *      authenticated Playwright tier and nowhere else. Every other P1-28 tier
 *      mocks the transport, and `canonical-plan.md` §10 says in as many words
 *      that a mock is not production-integration evidence.
 *   6. **Decision references** — every decision this phase's records cite
 *      resolves against the decision headings of `canonical-plan.md` §7, using
 *      the same reader the SEC-004 gate uses, so the two cannot disagree.
 *   7. **Derived counts** — a `<!-- derived: KIND NAME = N -->` marker in any
 *      P1-28 document is compared against the tree. An unknown kind, a malformed
 *      marker or a name this gate cannot derive is a FAILURE, not a silent pass:
 *      a document that opts a number in and misspells the kind would otherwise be
 *      unchecked in a way indistinguishable from being checked.
 *   8. **Superseded claims** — a short list of sentences the tree has falsified.
 *      Each entry names the fact that killed it. This is the only hand-written
 *      list here and it is deliberately small: it catches the exact sentences
 *      that were found asserted after their subject had changed, so re-adding one
 *      is a diff a reviewer must argue with.
 *
 * ## Anti-vacuity
 *
 * Every clause above can pass by inspecting nothing, and four of them have in
 * this repository's history. So: no documents scanned, no marker claims found,
 * no canonical task read, no apt/rec operation derived, no declared test id and
 * no browser citation each fail the run on their own.
 *
 * ## Why the comment stripper is imported rather than written
 *
 * This repository has now shipped SEVEN scanners that read prose as code. The
 * scanner-with-modes in `check-p1-27-doc-counts.mjs` is the one implementation
 * that survived that history — it leaves string, template and regular-expression
 * literals intact, which is exactly what matching a quoted case title needs —
 * so it is imported. A second stripper here would be an eighth chance to be
 * wrong.
 *
 * Usage:  node scripts/ci/check-p1-28-traceability.mjs [--json out.json]
 * Exit:   0 clean · 1 the record disagrees with the tree · 2 the check could not run.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { stripComments } from './check-p1-27-doc-counts.mjs';
import { recordedDecisions, CLASSIFICATIONS } from './check-p1-28-write-reachability.mjs';
import { readCanonicalTasks, CATEGORIES } from './build-p1-28-task-matrix.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const native = (root, p) => join(root, p.split(posix.sep).join(sep));

export const PHASE_DIR = 'docs/phase-1/phase-1-28';
export const RECORD_PATH = `${PHASE_DIR}/evidence/traceability.json`;
export const PLAN_PATH = `${PHASE_DIR}/canonical-plan.md`;
export const REACHABILITY_PATH = `${PHASE_DIR}/write-reachability.json`;
export const MATRIX_PATH = `${PHASE_DIR}/task-matrix.json`;
export const REGISTER_PATH = 'docs/phase-1/phase-1-24/evidence/operation-register.json';

/** The one tier that observes the running application rather than a mock. */
export const BROWSER_TIER = 'apps/web/tests/e2e/';

/* ------------------------------------------------------------------ *
 * Derivation — every number this gate holds a document to
 * ------------------------------------------------------------------ */

const readJson = (root, relative) => JSON.parse(readFileSync(native(root, relative), 'utf8'));

/** Repository-relative POSIX path of an absolute one. */
const relativePosix = (root, absolute) =>
  absolute
    .slice(root.length + 1)
    .split(sep)
    .join(posix.sep);

/** Every `.md` under the phase directory. A symlink is not followed. */
export function phaseDocuments(root = ROOT) {
  const out = [];
  const descend = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) descend(full);
      else if (entry.name.endsWith('.md')) out.push(full);
    }
  };
  descend(native(root, PHASE_DIR));
  return out.sort();
}

/**
 * Every count this gate can derive, keyed by the name a document uses.
 *
 * The apt/rec surface figures are the ones that have gone stale twice. They are
 * read from the P1-24 register — the same file the SEC-004 gate derives its
 * canonical write list from — so a Backend remediation that publishes an
 * operation moves every document carrying the marker, in the commit that lands
 * it, with no edit to any sentence.
 */
export function deriveCounts(root = ROOT, injected = {}) {
  const register = readJson(root, REGISTER_PATH);
  const operations = register.operations ?? [];
  const phase = operations.filter((op) => /^(?:apt|rec)\./.test(op.id));
  const writes = phase.filter((op) => op.method !== 'GET');
  const reads = phase.filter((op) => op.method === 'GET');
  const isCatalogue = (op) => /^(?:apt|rec)\.catalogue-/.test(op.id);
  const permissions = [...new Set(phase.flatMap((op) => op.permissions ?? []))].sort();

  const surface = {
    operations: phase.length,
    writes: writes.length,
    reads: reads.length,
    permissions: permissions.length,
    'catalogue-writes': writes.filter(isCatalogue).length,
    'catalogue-reads': reads.filter(isCatalogue).length,
  };

  const canonical = readCanonicalTasks(root);
  const tasks = { total: canonical.length };
  for (const meta of Object.values(CATEGORIES)) {
    tasks[meta.category] = canonical.filter((task) => task.CATEGORY === meta.category).length;
  }

  const manifest = readJson(root, REACHABILITY_PATH);
  const reachability = { total: Object.keys(manifest.operations ?? {}).length };
  for (const entry of Object.values(manifest.operations ?? {})) {
    reachability[entry.classification] = (reachability[entry.classification] ?? 0) + 1;
  }

  const matrixRecord = readJson(root, MATRIX_PATH);
  const matrix = { taskCount: matrixRecord.taskCount };
  for (const [key, value] of Object.entries(matrixRecord.totals ?? {})) matrix[key] = value;

  const record = injected.record ?? readJson(root, RECORD_PATH);
  const entries = Object.entries(record.testIds ?? {});
  const bound = entries.filter(([, entry]) => (entry.provenBy ?? []).length > 0);
  const testids = {
    declared: declaredTestIds(readFileSync(native(root, PLAN_PATH), 'utf8')).length,
    bound: bound.length,
    unbound: entries.length - bound.length,
  };

  const browserFiles = new Set();
  let browserCases = 0;
  for (const [, entry] of entries) {
    for (const proof of entry.observedInBrowserBy ?? []) {
      browserFiles.add(proof.file);
      browserCases += (proof.cases ?? []).length;
    }
  }
  const browser = { cases: browserCases, files: browserFiles.size };

  /*
   * The gate surface a developer has to satisfy, derived from the gates. The
   * developer guide carries these as markers, so the day a rule is added the
   * guide fails rather than quietly describing a smaller gate than the one that
   * will refuse the change.
   */
  const gates = {
    'access-rules': accessRuleIds(root).length,
    'reachability-classifications': CLASSIFICATIONS.length,
    'marker-kinds': TABLE_KINDS.length,
  };

  return {
    surface,
    tasks,
    reachability,
    matrix,
    testids,
    browser,
    gates,
    permissionCodes: permissions,
    operationIds: new Set(operations.map((op) => op.id)),
  };
}

/**
 * The rule ids `check-p1-28-access.mjs` actually enforces, derived from itself.
 *
 * A violation of that gate is pushed as `rule-id: what went wrong`, so the ids
 * are readable off the EXECUTABLE source. They are read from there rather than
 * from the gate's own docblock for a reason this run found: the docblock is
 * headed "The six rules" and the gate enforces SEVEN — `composed-permission`,
 * which verifies every composed-permission row against the migration and policy
 * it cites, is enumerated nowhere in that list. A guide written from the
 * docblock would have described six and been wrong about the one nobody had
 * noticed, which is the DOC-002 failure mode exactly.
 *
 * Comments are stripped first, so the numbered prose in that docblock is not
 * what answers this question.
 */
export function accessRuleIds(root = ROOT) {
  const source = stripComments(
    readFileSync(native(root, 'scripts/ci/check-p1-28-access.mjs'), 'utf8')
  );
  return [
    ...new Set([...source.matchAll(/[`'"]([a-z][a-z0-9]*(?:-[a-z0-9]+)+):\s/g)].map((m) => m[1])),
  ].sort();
}

/** The `TC-P1-28-*` ids the canonical plan declares, deduplicated and sorted. */
export function declaredTestIds(planMarkdown) {
  return [
    ...new Set([...planMarkdown.matchAll(/`(TC-P1-28-[A-Z]+-\d+)`/g)].map((m) => m[1])),
  ].sort();
}

/**
 * Every operation id a §5 task row binds, read from the generated task matrix.
 *
 * The matrix is used rather than a second parse of the plan because the matrix
 * IS the parse — `build-p1-28-task-matrix.mjs` owns reading §5, `--check` proves
 * the committed matrix is what that reader produces, and a second reader here
 * could disagree with the first while both looked right.
 */
export function boundOperations(root = ROOT) {
  const matrix = readJson(root, MATRIX_PATH);
  const out = new Map();
  for (const task of matrix.tasks ?? []) {
    for (const binding of task.CANONICAL_BACKEND_OPERATIONS ?? []) {
      /*
       * `rec.reception-condition-evidence [kind complaint]` narrows ONE
       * registered operation to the part of its contract a task consumes; the
       * plan's §5 preamble defines the qualifier. The registration question is
       * about the operation, so the qualifier is dropped here — and dropping it
       * is the reason a task may bind the same operation five times without
       * five registrations being demanded.
       */
      const id = binding.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
      if (!out.has(id)) out.set(id, []);
      out.get(id).push(task.TASK_ID);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Derived markers
 * ------------------------------------------------------------------ */

const ANY_DERIVED = /<!--\s*derived:([\s\S]*?)-->/g;
const WELL_FORMED = /^\s*([a-z][a-z0-9]*)\s+(\S+)\s*=\s*(\d+)\s*$/;

export const TABLE_KINDS = [
  'surface',
  'tasks',
  'reachability',
  'matrix',
  'testids',
  'browser',
  'gates',
];

/**
 * A document may state a count for a named thing only if it matches the tree.
 *
 * Deliberately narrow, and for the reason `check-p1-27-doc-counts.mjs` gives: a
 * gate that tried to parse every bold number out of prose would either miss the
 * ones written differently or fire on unrelated figures, and this phase has
 * shipped both.
 */
export function checkMarkers(relative, source, derived) {
  const problems = [];
  let claims = 0;
  for (const marker of source.matchAll(ANY_DERIVED)) {
    claims += 1;
    const parsed = WELL_FORMED.exec(marker[1]);
    if (!parsed) {
      problems.push(
        `${relative}: malformed derived marker \`${marker[0].trim()}\` — ` +
          'the shape is `<!-- derived: KIND NAME = N -->`.'
      );
      continue;
    }
    const [, kind, name, stated] = parsed;
    if (!TABLE_KINDS.includes(kind)) {
      problems.push(
        `${relative}: unknown derived kind \`${kind}\` — this gate derives ${TABLE_KINDS.join(', ')}.`
      );
      continue;
    }
    const actual = derived[kind][name];
    if (actual === undefined) {
      problems.push(
        `${relative}: claims ${kind} for \`${name}\`, which this gate cannot derive. Check the name.`
      );
      continue;
    }
    if (Number(stated) !== actual) {
      problems.push(`${relative}: states ${kind} ${name} = ${stated}; the tree holds ${actual}.`);
    }
  }
  return { problems, claims };
}

/* ------------------------------------------------------------------ *
 * Superseded claims
 * ------------------------------------------------------------------ */

/**
 * Sentences the tree has falsified, each with the fact that killed it.
 *
 * Every entry here was found ASSERTED IN THE PRESENT TENSE after its subject had
 * changed. The list is short on purpose: it is not a style guide, it is the set
 * of specific claims this phase has already had to withdraw once, and it exists
 * so withdrawing them is permanent rather than a habit.
 *
 * A negated or historical restatement must not trip it, so each pattern is
 * written to match the ASSERTION and not a sentence about the assertion. Where
 * that is impossible the correction says what changed instead of quoting the
 * dead sentence, which is why none of these strings appears in the phase's own
 * account of correcting them.
 */
export const SUPERSEDED = Object.freeze([
  {
    pattern: /\[MISSING\s+R[1-5]\]/,
    sample: 'binds `rec.reception-detail` [MISSING R1] until the remediation lands',
    why: 'R1-R5 are EXECUTED and integrated (PR #220, PR #221); no binding may still name them as missing',
  },
  {
    pattern: /\bno\s+management\s+operation\b/i,
    sample: 'the table ships no rows, there is no seed and no management operation',
    why: 'PR #227 registered 21 intake-catalogue management writes behind apt.catalogue.manage / rec.catalogue.manage',
  },
  {
    pattern: /no\s+operation\s+anywhere\s+(?:in\s+the\s+product\s+)?can\s+add\s+one/i,
    sample: 'all four tables ship no rows, and no operation anywhere in the product can add one',
    why: 'PR #227 registered create, update and status-set across all seven intake catalogues',
  },
  {
    pattern: /there\s+is\s+no\s+GET\s+anywhere\s+in\s+apt\/rec/i,
    sample: 'the load-bearing claim was that there is no GET anywhere in apt/rec',
    why: 'PR #220 published the appointment, reception and catalogue reads; the phase consumes them',
  },
  {
    pattern: /\bzero\s+reads\b/i,
    sample: 'the public surface is 12 POST commands and zero reads',
    why: 'the apt/rec read surface exists at this head. The source-head fact is still worth stating and must be stated in words that cannot be read as the present tense — "no read at all", with the head named',
  },
]);

export function checkSuperseded(relative, source) {
  const problems = [];
  for (const { pattern, why } of SUPERSEDED) {
    const found = pattern.exec(source);
    if (!found) continue;
    const at = source.slice(0, found.index).split('\n').length;
    problems.push(
      `${relative}:${at}: superseded claim "${found[0].trim()}" — ${why}. ` +
        "The archaeology's own rule governs: if the tree disagrees with a row, the tree wins."
    );
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * The traceability record
 * ------------------------------------------------------------------ */

/**
 * Every declared test id resolves to real cases, or states its gap.
 *
 * This is `check-p1-27-doc-counts.mjs`'s `checkCatalogue` applied to this phase,
 * and it is here because P1-27 proved the failure it prevents: twenty-nine
 * canonical test ids were declared across three documents and a repository-wide
 * search returned NOTHING for any of them. Twenty-nine empty test files would
 * have made that search succeed and proved nothing, so the binding is data: one
 * record per id naming the executable cases that already prove it.
 */
export function checkRecord(root = ROOT, injected = {}) {
  const problems = [];
  const recordPath = native(root, RECORD_PATH);
  if (injected.record === undefined && !existsSync(recordPath)) {
    return [`${RECORD_PATH} does not exist`];
  }

  /*
   * `injected.record` exists so the mutation proofs can drive this function
   * with a record the tree does not hold. A checker whose refusals have never
   * been observed is a checker nobody has tested — every rule below is driven
   * from `tests/ci/p1-28-matrix.test.ts` with a record that breaks exactly one
   * of them.
   */
  const record = injected.record ?? JSON.parse(readFileSync(recordPath, 'utf8'));
  const plan = readFileSync(native(root, PLAN_PATH), 'utf8');

  /* --- 1. task mapping ------------------------------------------------- */
  const canonical = readCanonicalTasks(root)
    .map((task) => task.TASK_ID)
    .sort();
  if (canonical.length === 0) {
    return ['the canonical plan yields no task — this check would be vacuous'];
  }
  const mapped = Object.keys(record.tasks ?? {}).sort();
  for (const id of canonical) {
    if (!mapped.includes(id)) problems.push(`${id} is a canonical task and the record omits it`);
  }
  for (const id of mapped) {
    if (!canonical.includes(id))
      problems.push(`the record carries ${id}, which is no canonical task`);
  }
  for (const [id, entry] of Object.entries(record.tasks ?? {})) {
    if (!String(entry.testId ?? '').trim()) problems.push(`${id} records no test id`);
    if (!String(entry.surface ?? '').trim()) problems.push(`${id} names no implementation surface`);
  }

  /* --- 2. operation catalogue ------------------------------------------ */
  const derived = deriveCounts(root, { record });
  const bound = boundOperations(root);
  if (bound.size === 0)
    problems.push('no task binds an operation — the catalogue check is vacuous');
  for (const [id, tasks] of bound) {
    if (!derived.operationIds.has(id)) {
      problems.push(
        `${tasks.join(', ')} bind \`${id}\`, which the P1-24 operation register does not publish ` +
          'at this head'
      );
    }
  }

  /* --- 3. permissions --------------------------------------------------- */
  const recorded = record.permissions ?? {};
  if (derived.permissionCodes.length === 0) {
    problems.push('the register yields no apt/rec permission code — this check is vacuous');
  }
  for (const code of derived.permissionCodes) {
    if (!(code in recorded)) {
      problems.push(
        `the register publishes \`${code}\` on an apt/rec operation and the record omits it`
      );
    }
  }
  for (const code of Object.keys(recorded)) {
    if (!derived.permissionCodes.includes(code)) {
      problems.push(`the record names \`${code}\`, which no published apt/rec operation registers`);
    }
    if (!String(recorded[code] ?? '').trim()) problems.push(`\`${code}\` is recorded with no note`);
  }

  /* --- 4/5. test references and browser coverage ------------------------ */
  const declared = declaredTestIds(plan);
  if (declared.length === 0) {
    problems.push('the canonical plan declares no `TC-P1-28-*` id — this check would be vacuous');
  }
  const entries = record.testIds ?? {};
  for (const id of declared) {
    if (!(id in entries)) problems.push(`${id} is declared in the plan and has no record`);
  }
  for (const id of Object.keys(entries)) {
    if (!declared.includes(id)) problems.push(`${id} is recorded and the plan declares no such id`);
  }

  const sources = new Map();
  const readTest = (relative) => {
    if (sources.has(relative)) return sources.get(relative);
    const path = native(root, relative);
    // `literals: 'keep'` is required, not incidental: the titles being matched
    // ARE string literals, so blanking them would make every citation fail.
    const text = existsSync(path) ? stripComments(readFileSync(path, 'utf8')) : null;
    sources.set(relative, text);
    return text;
  };

  const checkProof = (where, proof) => {
    const text = readTest(proof.file);
    if (text === null) {
      problems.push(`${where} cites ${proof.file}, which does not exist`);
      return;
    }
    if (!/(?:^|[^.\w])(?:it|test)\s*\(/.test(text)) {
      problems.push(`${where} cites ${proof.file}, which declares no case at all`);
    }
    const seen = new Set();
    for (const title of proof.cases ?? []) {
      if (seen.has(title)) {
        problems.push(`${where} quotes "${title}" twice for ${proof.file} — that is not two cases`);
        continue;
      }
      seen.add(title);
      if (!text.includes(title)) {
        problems.push(`${where} quotes "${title}", which is in no case of ${proof.file}`);
      }
    }
    if ((proof.cases ?? []).length === 0) {
      problems.push(`${where} cites ${proof.file} and quotes no case — a file is not a proof`);
    }
  };

  let browserCitations = 0;
  for (const [id, entry] of Object.entries(entries)) {
    const proofs = entry.provenBy ?? [];
    if (proofs.length === 0 && !String(entry.gap ?? '').trim()) {
      problems.push(`${id} names no proof and states no gap — an unstated gap is a lie`);
    }
    for (const proof of proofs) checkProof(id, proof);
    for (const proof of entry.observedInBrowserBy ?? []) {
      browserCitations += 1;
      if (!proof.file?.startsWith(BROWSER_TIER)) {
        problems.push(
          `${id} offers ${proof.file} as browser evidence; only the authenticated tier under ` +
            `${BROWSER_TIER} observes the running application — every other tier mocks the transport`
        );
        continue;
      }
      checkProof(`${id} (browser)`, proof);
    }
  }
  if (browserCitations === 0) {
    problems.push(
      'no test id cites the browser tier — a phase whose only evidence is mocked has no ' +
        'production-integration evidence at all (`canonical-plan.md` §10)'
    );
  }

  /* --- 6. decision references ------------------------------------------- */
  const decisions = recordedDecisions(plan);
  if (decisions === null || decisions.length === 0) {
    problems.push(
      '`canonical-plan.md` §7 records no decision — every decision reference is unresolvable'
    );
  } else {
    const manifest = readJson(root, REACHABILITY_PATH);
    const referenced = new Set();
    for (const entry of Object.values(manifest.operations ?? {})) {
      if (entry.decisionRef) referenced.add(entry.decisionRef);
    }
    for (const [, entry] of Object.entries(record.tasks ?? {})) {
      if (entry.decisionRef) referenced.add(entry.decisionRef);
    }
    for (const reference of referenced) {
      if (!decisions.includes(reference)) {
        problems.push(
          `\`${reference}\` is cited as a decision and \`canonical-plan.md\` §7 records ` +
            `${decisions.join(', ')} — a reference naming no recorded decision is indistinguishable ` +
            'from an approved one'
        );
      }
    }
  }

  /* --- 7. the record's own declared totals ------------------------------ */
  for (const [name, actual] of Object.entries(derived.testids)) {
    const stated = record.totals?.[name];
    if (stated === undefined) {
      problems.push(`the record declares no total for \`${name}\``);
    } else if (stated !== actual) {
      problems.push(`the record states ${name} = ${stated}; its rows hold ${actual}`);
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function evaluate(root = ROOT) {
  const derived = deriveCounts(root);
  const problems = [];
  let claims = 0;

  const documents = phaseDocuments(root);
  if (documents.length === 0) {
    return {
      ok: false,
      problems: [`${PHASE_DIR} holds no document — this gate would inspect nothing`],
      claims: 0,
      documents: 0,
    };
  }
  for (const file of documents) {
    const relative = relativePosix(root, file);
    const source = readFileSync(file, 'utf8');
    const marked = checkMarkers(relative, source, derived);
    claims += marked.claims;
    problems.push(...marked.problems);
    problems.push(...checkSuperseded(relative, source));
  }
  if (claims === 0) {
    problems.push(
      'no P1-28 document states a derived count — every figure in the record is then a ' +
        'hand-written number, which is the defect this gate exists to close'
    );
  }
  if (derived.surface.operations === 0) {
    problems.push(
      'the operation register publishes no apt/rec operation — the surface check is vacuous'
    );
  }

  problems.push(...checkRecord(root).map((problem) => `${RECORD_PATH}: ${problem}`));
  return { ok: problems.length === 0, problems, claims, documents: documents.length, derived };
}

function main(argv) {
  let result;
  try {
    result = evaluate(ROOT);
  } catch (error) {
    process.stderr.write(`::error::cannot derive P1-28 traceability: ${error.message}\n`);
    return 2;
  }
  const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
  if (jsonOut) {
    writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  }
  for (const problem of result.problems) process.stderr.write(`::error::${problem}\n`);
  process.stdout.write(
    `P1-28 traceability: ${result.claims} derived claim(s) across ${result.documents} document(s), ` +
      `${result.problems.length} disagreement(s).\n`
  );
  return result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)));
}
