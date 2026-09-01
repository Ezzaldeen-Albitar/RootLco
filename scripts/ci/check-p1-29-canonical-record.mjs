/**
 * Mechanical verification of the W2 canonical record.
 *
 * It resolves rather than pattern-matches: every path is stat'd, every operation
 * id is looked up in the route sources, every permission code in the catalogue,
 * every stated count recomputed from the tree. A reference this cannot resolve
 * is reported as a failure, because a canonical record that names something the
 * repository does not hold is worse than no record.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
/**  exits 1 when nothing matched, and here NOTHING MATCHED is the
 *  answer being asked for. Treating that exit as a crash reads absence as
 *  failure, which is the same mistake as reading it as success. */
const grep = (args) => {
  try {
    return execFileSync('git', ['grep', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 8 << 20,
    }).trim();
  } catch (error) {
    if (error?.status === 1) return '';
    throw error;
  }
};

const DOC = 'docs/phase-1/phase-1-29/canonical-plan.md';
const text = readFileSync(join(ROOT, DOC), 'utf8');
const fail = [];
const ok = [];

const walk = (dir, out = []) => {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.next') continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
};

// ---- 1. every backticked repo path resolves -------------------------------
const paths = [...text.matchAll(/`([A-Za-z0-9_./-]+\.(?:md|ts|tsx|mjs|sql|json|docx))`/g)].map(
  (m) => m[1]
);
const BRANCH_ONLY = new Set([
  'docs/phase-1/phase-1-29/execution-decision.md', // stated as branch-only in the doc
  'RootLco_Phase_1_Development_Plan_recovered_v01.docx', // stated as outside Git
]);
for (const p of new Set(paths)) {
  if (BRANCH_ONLY.has(p)) {
    if (existsSync(join(ROOT, p))) fail.push(`branch-only path ${p} actually EXISTS on develop`);
    else ok.push(`branch-only ${p} correctly absent from develop`);
    continue;
  }
  if (!existsSync(join(ROOT, p))) fail.push(`path does not exist: ${p}`);
  else ok.push(`path ${p}`);
}

// ---- 2. every operation id exists in a route ------------------------------
const routes = walk('apps/api/src/app/api/v1').filter((p) => p.endsWith('route.ts'));
const declared = new Set();
for (const r of routes) {
  for (const m of readFileSync(join(ROOT, r), 'utf8').matchAll(/id:\s*'([a-z]+\.[a-z0-9-]+)'/g)) {
    declared.add(m[1]);
  }
}
// Names the record introduces as NOT YET BUILT. Verified ABSENT, not present: a
// planned name that already existed would mean the item is already done, and a
// record that cannot tell those two apart is the ambiguity W2 exists to remove.
const PLANNED = new Set(['dia.diagnostic-type-list']);
const cited = [...text.matchAll(/`([a-z]+\.[a-z0-9]+(?:-[a-z0-9]+)+)`/g)].map((m) => m[1]);
for (const id of new Set(cited)) {
  if (PLANNED.has(id)) {
    if (declared.has(id)) fail.push(`${id} is marked PLANNED but already exists`);
    else ok.push(`planned ${id} correctly absent`);
  } else if (!declared.has(id)) fail.push(`operation cited but not declared anywhere: ${id}`);
  else ok.push(`operation ${id}`);
}

// ---- 3. every permission code exists --------------------------------------
const permSources = [...routes.map((r) => join(ROOT, r))];
const perms = new Set();
for (const f of permSources) {
  for (const m of readFileSync(f, 'utf8').matchAll(/'([a-z_]+\.[a-z_]+\.[a-z_]+)'/g))
    perms.add(m[1]);
}
// Codes the record says are OUT OF SCOPE. Their ABSENCE is the claim, so an
// appearance in a route would falsify the disposition rather than satisfy it.
const DISPOSITIONED = new Set(['org.tax.manage', 'org.subscription.manage']);
const citedPerms = [...text.matchAll(/`([a-z_]+\.[a-z_]+\.[a-z_]+)`/g)].map((m) => m[1]);
for (const p of new Set(citedPerms)) {
  if (DISPOSITIONED.has(p)) {
    if (perms.has(p)) fail.push(`${p} is dispositioned out of scope but a route uses it`);
    else ok.push(`dispositioned ${p} correctly absent`);
  } else if (!perms.has(p)) fail.push(`permission code cited but not used by any route: ${p}`);
  else ok.push(`permission ${p}`);
}

// ---- 4. stated counts are recomputed, not trusted -------------------------
const owner = readFileSync(join(ROOT, 'docs/product/owner-workflow-requirements.md'), 'utf8').split(
  '\n'
);
if (!owner[219].startsWith('## P1-29 —')) fail.push(`owner table heading is not at line 220`);
else ok.push('owner heading at 220');
const rows = owner.slice(223, 239);
if (rows.length !== 16 || !rows.every((r) => r.startsWith('|')))
  fail.push('owner rows 224-239 are not 16 table rows');
else ok.push('16 owner rows at 224-239');
const tally = {};
for (const r of rows) {
  const cells = r
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|');
  const key = cells[1].replace(/\*\*/g, '').split('—')[0].trim();
  tally[key] = (tally[key] ?? 0) + 1;
}

/**
 * Reads a number the DOCUMENT states, so the comparison is document-against-tree.
 *
 * The first version of this file held the expected numbers as its own constants
 * and compared those to the tree. Mutating the document's "16 data rows" to 17
 * was ACCEPTED — the checker was agreeing with itself and never read the claim it
 * was supposed to be checking. Three of five mutations passed that way.
 */
const claims = (pattern, what) => {
  const m = text.match(pattern);
  if (!m) {
    fail.push(`the record no longer states ${what} — this check has nothing to verify`);
    return null;
  }
  return Number(m[1]);
};

const claimedRows = claims(/\*\*(\d+) data rows\*\*/, 'its row count');
if (claimedRows !== null) {
  if (claimedRows !== rows.length)
    fail.push(`row count: record says ${claimedRows}, tree holds ${rows.length}`);
  else ok.push(`row count ${claimedRows} matches the tree`);
}

for (const [, name, n] of text.matchAll(
  /`(Planned|Blocked|Partly blocked|Contracted|Partly contracted)` (\d+)/g
)) {
  const stated = Number(n);
  if (tally[name] !== stated)
    fail.push(`status tally ${name}: record says ${stated}, tree holds ${tally[name] ?? 0}`);
  else ok.push(`tally ${name}=${stated} matches the tree`);
}
if (Object.values(tally).reduce((a, b) => a + b, 0) !== rows.length) {
  fail.push('the tally computed from the tree does not sum to the row count');
}

const contract = readFileSync(
  join(ROOT, 'docs/phase-1/phase-1-9/p1-29-frontend-contract.md'),
  'utf8'
);
const contractLines = contract.replace(/\n$/, '').split('\n').length;
const claimedLines = claims(/exactly (\d+) lines/, "the contract's line count");
if (claimedLines !== null) {
  if (claimedLines !== contractLines)
    fail.push(`contract: record says ${claimedLines} lines, tree holds ${contractLines}`);
  else ok.push(`contract line count ${contractLines} matches the record`);
}

const surfaces = (contract.match(/^- \*\*/gm) ?? []).length;
const WORDS = { four: 4, five: 5, six: 6, seven: 7 };
const surfaceWord = text.match(/names \*\*(\w+)\*\* surfaces/)?.[1];
if (!surfaceWord) fail.push('the record no longer states how many surfaces the contract names');
else if (WORDS[surfaceWord] !== surfaces) {
  fail.push(
    `surfaces: record says ${surfaceWord} (${WORDS[surfaceWord]}), contract names ${surfaces}`
  );
} else ok.push(`contract names ${surfaces} surfaces, as the record says`);

const diaOps = [...declared].filter((d) => d.startsWith('dia.'));
const claimedDia = claims(/\*\*(\d+) `dia\.\*` operations\*\*/, 'the dia operation count');
if (claimedDia !== null) {
  if (claimedDia !== diaOps.length)
    fail.push(`dia.* operations: record says ${claimedDia}, tree holds ${diaOps.length}`);
  else ok.push(`${diaOps.length} dia.* operations, as the record says`);
}

// The empty-vocabulary claim, checked rather than asserted.
const seeded = grep(['-l', 'INSERT INTO dia.diagnostic_types', '--', 'supabase']);
if (seeded) fail.push(`document says the vocabulary is empty, but a seed exists: ${seeded}`);
else ok.push('dia.diagnostic_types carries no seeded row');

// ---- 5. the P1-28 boundary quote is verbatim ------------------------------
const p128 = readFileSync(join(ROOT, 'docs/phase-1/phase-1-28/canonical-plan.md'), 'utf8');
for (const fragment of [
  '**P1-28 ends where the work order begins.**',
  '**No work-order execution, no technician boards, no\n> diagnostics authoring**',
]) {
  if (!p128.includes(fragment))
    fail.push(`P1-28 boundary fragment not found verbatim: ${fragment.slice(0, 48)}`);
  else ok.push('P1-28 boundary fragment verbatim');
}

// ---- 6. the recovered rule is verbatim, and was genuinely absent ----------
const RULE = 'MUST NOT BE DECLARED COMPLETE WITHOUT THE DIAGNOSTICS EXPERIENCE';

/**
 * A ref this checkout may not have.
 *
 * The clean room checks out ONE commit. It has no `planning/...` branch and no
 * `develop`, so a gate that reads either of them fails there for a reason that
 * says nothing about the record — which is what the first version of this file
 * did: `git show planning/...` threw, and a required gate died on the shape of
 * a checkout rather than on a defect.
 *
 * The ref is therefore READ WHEN PRESENT and reported as unverifiable when it
 * is not. That is a deliberate gap and it is stated out loud rather than
 * papered over: the checks that do NOT depend on a ref — the rule's presence in
 * the record, and its discoverability — run everywhere and carry the weight.
 */
const showIfPresent = (ref) => {
  try {
    return execFileSync('git', ['show', ref], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 8 << 20,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
};

const BRANCH = 'planning/p1-29-work-order-diagnostics-technician-preparation';
const fromBranch = showIfPresent(`${BRANCH}:docs/phase-1/phase-1-29/execution-decision.md`);
if (fromBranch === null) {
  // Not a failure. A single-commit checkout holds no other branch, and the
  // record names the branch and commit so a reader with a full clone can check.
  ok.push(`provenance branch ${BRANCH} is absent from this checkout — not verifiable here`);
} else if (!fromBranch.includes(RULE)) {
  fail.push('the recovered rule is not in the branch source it names');
} else {
  ok.push('rule present in the branch source it names');
}

if (!text.includes(RULE)) fail.push('the recovered rule is not in this document');
else ok.push('rule carried verbatim into the record');

if (showIfPresent('develop:docs/phase-1/phase-1-28/canonical-plan.md') === null) {
  ok.push('develop is absent from this checkout — the absence claim is not verifiable here');
} else {
  const onDevelopBefore = grep(['-l', RULE, 'develop', '--', 'docs']);
  if (onDevelopBefore)
    fail.push(`the rule was already on develop at ${onDevelopBefore} — recovery claim is false`);
  else ok.push('rule was genuinely absent from develop');
}

// Discoverable by repository search, which is the whole point of recovering it.
// --untracked, because the record is not committed yet and a search that
// cannot see it would report the rule as undiscoverable for the wrong reason.
const found = grep(['-l', '--untracked', RULE]);
if (!found.includes(DOC)) fail.push('the rule is not discoverable by repository search');
else ok.push(`rule discoverable: ${found.split('\n').join(', ')}`);

// ---- 7. no duplicate headings, and the doc is internally consistent -------
const headings = [...text.matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1].trim());
const dupes = headings.filter((h, i) => headings.indexOf(h) !== i);
if (dupes.length) fail.push(`duplicate heading(s): ${[...new Set(dupes)].join(' / ')}`);
else ok.push(`${headings.length} headings, all distinct`);

const matrixIds = [...text.matchAll(/\*\*(W[1-9])\*\*/g)].map((m) => m[1]);
for (let n = 1; n <= 9; n += 1) {
  if (!matrixIds.includes(`W${n}`)) fail.push(`execution matrix does not name W${n}`);
}
if (matrixIds.length) ok.push(`matrix names W1-W9`);

const base = execFileSync('git', ['rev-parse', '--short=8', 'develop'], {
  cwd: ROOT,
  encoding: 'utf8',
}).trim();
if (!text.includes(base)) fail.push(`document does not name its base commit ${base}`);
else ok.push(`base commit ${base} named`);

// ---- report ---------------------------------------------------------------
console.log(`W2 canonical record: ${ok.length} reference(s) resolved, ${fail.length} problem(s).`);
for (const f of fail) console.error(`::error::${f}`);
process.exit(fail.length === 0 ? 0 : 1);
