/**
 * Every quality command is owned, classified, and reachable.
 *
 * ## Why this gate exists
 *
 * Three defects found during the workspace normalization shared one shape: a
 * check existed, was correct, and had never run.
 *
 *   - `security:scope-exclusions` went red the day `apps/web` landed and stayed
 *     red, because no aggregate invoked it.
 *   - `lint:web` had never once succeeded — its config crashed inside its own
 *     error formatter — and nothing noticed, because no aggregate invoked it.
 *   - `apps/web`'s Stylelint RTL rule was declared with an invalid option shape,
 *     so Stylelint skipped it and reported "0 problems" for that rule forever.
 *
 * A repository cannot tell the difference between "this check passes" and "this
 * check never ran" by looking at a green log. The only durable answer is a
 * register that must account for every command, and a mechanical proof that
 * every REQUIRED one is reachable from the aggregate a human actually runs and
 * from the workflows CI actually executes.
 *
 * ## What it proves
 *
 *   1. Every script in every workspace appears in the register below — a new
 *      command cannot be added without being classified.
 *   2. Every register entry names a script that still exists — the register
 *      cannot rot into a description of a repository that no longer exists.
 *   3. Every `required` command is reachable from `verify:workspaces` by
 *      following `npm run` edges transitively.
 *   4. Every `required` command is invoked by at least one hosted workflow,
 *      directly or through an aggregate it is reachable from.
 *
 * Usage: node scripts/ci/check-command-coverage.mjs [--json]
 * Exit codes: 0 covered · 1 a gap · 2 IO error.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  API_ROOT,
  GITHUB_ROOT,
  WEB_ROOT,
  fromRoot,
  toRepositoryPath,
} from '../lib/repository-paths.mjs';

/** The command a developer runs, and the root of the reachability proof. */
export const AGGREGATE = 'verify:workspaces';

const ROOT = 'root';
const API = '@rootlco/api';
const WEB = '@rootlco/web';

/**
 * The register. `tier` is the whole point:
 *
 *   required      — a quality gate. Must be reachable from the aggregate AND
 *                   invoked by hosted CI. This is the class that silently rotted.
 *   ci-only       — a gate whose answer depends on the BRANCH, so the local
 *                   repository-wide aggregate cannot run it. Must be invoked by
 *                   hosted CI, and that half is enforced exactly as strictly as
 *                   it is for `required`.
 *   informational — produces a report or a fix; failing it is not a verdict.
 *   interactive   — a developer convenience (watch mode, dev server, database
 *                   lifecycle). Running it in CI would hang or mutate state.
 *   environment   — needs a live database, Docker or credentials, so it runs in
 *                   its own workflow job rather than from the local aggregate.
 *
 * These five are the WHOLE vocabulary, and that is now enforced rather than
 * described. `evaluate()` skips anything it does not recognise, so an
 * unrecognised tier — a sixth word somebody invented, or `requird` — silently
 * means "not a gate". One entry was registered `optional` and nothing noticed.
 *
 * `ci-only` exists because of `validate:phase-ownership`. It is a real gate, its
 * rules are tested, and it was invoked by NO workflow — and it was registered
 * `informational` with a paragraph EXPLAINING that no job ran it. A comment
 * saying a check is unreachable is not a finding, it is a defect with a note
 * attached. It could not be `required`, because it takes a per-branch profile
 * that a repository-wide aggregate cannot supply; the honest answer was a tier
 * that enforces the half that applies, rather than a tier that enforces neither.
 */
export const TIERS = Object.freeze([
  'required',
  'ci-only',
  'informational',
  'interactive',
  'environment',
]);

/** Tiers whose commands a hosted workflow must invoke. */
export const CI_ENFORCED = Object.freeze(['required', 'ci-only']);

/** Tiers whose commands `verify:workspaces` must reach. */
export const AGGREGATE_ENFORCED = Object.freeze(['required']);

export const REGISTER = Object.freeze([
  // --- root: repository-level quality gates ---------------------------------
  { name: 'lint', owner: ROOT, tier: 'required', why: 'repository tooling, tests and configs' },
  { name: 'typecheck', owner: ROOT, tier: 'required', why: 'repository tests and scripts' },
  { name: 'format:check', owner: ROOT, tier: 'required', why: 'repository-owned files' },
  { name: 'format:check:all', owner: ROOT, tier: 'required', why: 'root plus every workspace' },
  { name: 'test:unit', owner: ROOT, tier: 'required', why: 'unit and component tier' },
  { name: 'validate:encoding', owner: ROOT, tier: 'required', why: 'Trojan Source and mojibake' },
  { name: 'validate:run-block-syntax', owner: ROOT, tier: 'required', why: 'workflow run blocks' },
  { name: 'validate:no-fake-data', owner: ROOT, tier: 'required', why: 'no-fake-data policy' },
  { name: 'validate:module-boundaries', owner: ROOT, tier: 'required', why: 'ADR-001 boundaries' },
  {
    name: 'validate:authorization-coverage',
    owner: ROOT,
    tier: 'required',
    why: 'every route guarded',
  },
  { name: 'validate:operation-coverage', owner: ROOT, tier: 'required', why: 'operation evidence' },
  { name: 'validate:openapi', owner: ROOT, tier: 'required', why: 'published contract' },
  {
    name: 'validate:openapi-success-status',
    owner: ROOT,
    tier: 'required',
    why: 'the published success status is the one the handler returns',
  },
  {
    name: 'validate:named-wire-shapes',
    owner: ROOT,
    tier: 'required',
    why: 'no route serialises an anonymous type to the wire',
  },
  { name: 'validate:exact-money', owner: ROOT, tier: 'required', why: 'decimal money surface' },
  { name: 'validate:p1-19-inventory', owner: ROOT, tier: 'required', why: 'phase inventory' },
  { name: 'validate:p1-20-inventory', owner: ROOT, tier: 'required', why: 'phase inventory' },
  { name: 'validate:p1-21-inventory', owner: ROOT, tier: 'required', why: 'phase inventory' },
  { name: 'validate:p1-22-inventory', owner: ROOT, tier: 'required', why: 'phase inventory' },
  { name: 'validate:p1-23-inventory', owner: ROOT, tier: 'required', why: 'phase inventory' },
  { name: 'validate:p1-24-register', owner: ROOT, tier: 'required', why: 'operation register' },
  {
    name: 'validate:idempotent-operations',
    owner: ROOT,
    tier: 'required',
    why: "the Web client's idempotency table is derived from the published contract, not from the HTTP method (P1-27-INT-003) — drift means a mutation the backend refuses before authorization",
  },
  { name: 'validate:command-coverage', owner: ROOT, tier: 'required', why: 'this gate' },
  {
    name: 'validate:p1-26-frontend',
    owner: ROOT,
    tier: 'required',
    // A real gate, not a reporter: it fails on a token in browser storage, on
    // floating-point money, on a redirect parameter in the authentication flow,
    // on a second session-cookie authority, on unsafe HTML, and on a
    // `'use server'` module exporting anything but an async function. Its rules
    // are proven by tests/ci/p1-26-frontend-gate.test.ts, which plants each
    // violation and asserts the gate catches that one.
    why: 'P1-26 frontend security and boundary rules',
  },
  {
    name: 'validate:p1-27-frontend',
    owner: ROOT,
    tier: 'required',
    // P1-26's gate covers what any Frontend must not do. This covers what P1-27
    // DECIDED: no merge caller while `P1-OD-017` is open, no duplicate scan from
    // a review surface, no client-asserted scope, no invented total, no upload
    // path while `P1-OD-025` is open, no console output. Wave 6 shipped a
    // working merge form past review, typecheck, lint and 669 tests — a test can
    // be deleted around a decision, a gate cannot.
    why: 'P1-27 CRM and Vehicle frontend decision rules',
  },
  {
    name: 'validate:p1-27-reachability',
    owner: ROOT,
    tier: 'required',
    // The gate above asks what the frontend must not DO. This asks whether a
    // person can reach what the backend already offers. Ten canonical P1-27
    // writes shipped with a route, a permission, an audit class, an idempotency
    // entry, an OpenAPI path and a register row — and no screen from which
    // anybody could invoke them, while every automated tier stayed green. The
    // operation list is derived from the P1-24 register rather than written
    // down, so a new operation is UNCLASSIFIED rather than unnoticed, and every
    // rule is mutation-proved by tests/foundation/p1-27-write-reachability.test.ts.
    why: 'every canonical P1-27 mutation is reachable, deliberately absent, or decision-neutral',
  },
  {
    name: 'validate:p1-27-evidence',
    owner: ROOT,
    tier: 'required',
    // P1-27-QA-005. The phase shipped twenty-five evidence documents and no
    // digest over any of them, so a count could be corrected or a verdict
    // softened without the repository being able to tell. This is the `--check`
    // half of `evidence:p1-27`: it fails when a document has moved and the
    // manifest has not, and it names the documents that moved rather than just
    // reporting that the manifest is stale.
    why: 'every P1-27 evidence document is digested, and the digests match the bytes',
  },
  {
    name: 'validate:p1-27-matrix',
    owner: ROOT,
    tier: 'required',
    // The canonical 42-task authority. This phase once counted 33 adjudicated
    // items as 42 canonical tasks with nine listed nowhere, so the universe is
    // derived from `canonical-plan.md` and this refuses any drift between the
    // plan, the recorded verdicts and the committed matrix.
    why: 'the 42-task matrix still matches the canonical plan and the recorded verdicts',
  },
  {
    name: 'validate:p1-27-doc-counts',
    owner: ROOT,
    tier: 'required',
    // Round five found thirteen stale counts in the phase records and they are
    // one defect: a number written by hand that nothing recomputes. This makes
    // the tree the authority and refuses any document that disagrees with it.
    why: 'every count a P1-27 document states about the repository is derivable',
  },
  {
    name: 'validate:p1-27-lifecycle',
    owner: ROOT,
    tier: 'required',
    // The closure lifecycle as a state machine. The phase carried a rule that
    // could not be satisfied in any order — no merge until every row is PASS, no
    // PASS while a reproof is outstanding, no reproof without the merge — and
    // this refuses any declared state the tree does not support, in either
    // direction: a blocker the ledger does not declare, and a declared blocker
    // the tree no longer raises.
    why: 'the declared P1-27 lifecycle state is the one the tree actually holds',
  },
  {
    name: 'validate:p1-27-closing-values',
    owner: ROOT,
    tier: 'required',
    // Six hosted-CI figures on the two evidence pages were falsified with every
    // gate green, and fewer than half the values those pages state were read by
    // anything. This classifies every value on both pages as locally derivable,
    // git-derivable, hosted-attested, protected-only, historical or
    // non-normative, refuses a value nothing claims, and refuses a hosted value
    // that names no run — while saying plainly that it re-derives no hosted
    // observation and could not.
    why: 'every closing value on the two P1-27 evidence pages names the authority that decides it',
  },
  {
    name: 'record:p1-27-run',
    owner: ROOT,
    // `interactive` rather than `required`: it is invoked by a person taking a
    // measurement, and it must NOT run inside an aggregate — a gate that
    // rewrote the record it checks would agree with itself every time.
    tier: 'interactive',
    // The only writer of evidence/local-run-ledger.json. It is not a gate: it
    // runs a tier and records what the tier did, with the commit it was taken
    // at, so an executed total can be bound to a command's output instead of to
    // another document. `validate:p1-27-closing-values` is what refuses the
    // record once it is stale.
    why: 'the recorded local tier measurement is a command output, not a hand-written number',
  },
  {
    name: 'matrix:p1-27',
    owner: ROOT,
    tier: 'informational',
    // The writer, for the same reason `evidence:p1-27` is not required: a CI job
    // that regenerated the matrix would repair the drift the check reports.
    why: 'regenerates the canonical P1-27 task matrix',
  },
  {
    name: 'validate:p1-28-matrix',
    owner: ROOT,
    tier: 'required',
    // The P1-28 sibling of `validate:p1-27-matrix`, registered on DAY ONE of the
    // phase rather than mid-phase: P1-27 built this authority only after 33
    // adjudicated items had been counted as 42 canonical tasks. The universe is
    // derived from `docs/phase-1/phase-1-28/canonical-plan.md` and this refuses
    // any drift between the plan, the recorded verdicts and the committed matrix.
    why: 'the 35-task P1-28 matrix still matches the canonical plan and the recorded verdicts',
  },
  {
    name: 'matrix:p1-28',
    owner: ROOT,
    tier: 'informational',
    // The writer, for the same reason `matrix:p1-27` is not required: a CI job
    // that regenerated the matrix would repair the drift the check reports.
    why: 'regenerates the canonical P1-28 task matrix',
  },
  {
    name: 'validate:p1-28-evidence',
    owner: ROOT,
    tier: 'required',
    // P1-28-QA-005. The `--check` half of `evidence:p1-28`. It seals the phase
    // directory by digesting every file's BYTES, and it does two things its
    // P1-27 sibling does not, because a digest cannot check either: it refuses a
    // candidate the two halves of the closing package disagree about, and it
    // DERIVES the unclosed-task set from task-matrix-verdicts.json so a task
    // that stops being named in the package fails rather than reading like a
    // task that closed. Named by a hosted job directly rather than riding the
    // clean-room aggregate the way its P1-27 sibling still does.
    why: 'every P1-28 evidence document is digested, the digests match the bytes, and the closing package binds its candidate and names every unclosed task',
  },
  {
    name: 'evidence:p1-28',
    owner: ROOT,
    tier: 'informational',
    // The writer, for the same reason `evidence:p1-27` is not required: a CI job
    // that regenerated the manifest would repair the drift the check reports,
    // resealing an edit instead of reporting it.
    why: 'regenerates the P1-28 evidence digest manifest',
  },
  {
    name: 'validate:p1-28-write-reachability',
    owner: ROOT,
    tier: 'required',
    // The P1-28 sibling of `validate:p1-27-reachability` (SEC-004), built on
    // DAY ONE: the crm/veh gate covers crm/veh only, so the apt/rec writes this
    // phase consumes had no reachability authority at all. The operation list
    // is derived from the P1-24 register; a write nobody can reach is either
    // on a frozen, shrink-only allow-list with a recorded reason, or a
    // violation — so INT-113 (declared-but-never-wired) cannot recur silently.
    // Mutation-proved by tests/ci/p1-28-write-reachability.test.ts.
    why: 'every canonical P1-28 apt/rec write is reachable, allow-listed with a reason, or deliberately absent',
  },
  {
    name: 'validate:p1-28-adapter-reachability',
    owner: ROOT,
    tier: 'required',
    // The READ half, and the lifecycle its sibling has no need of. Ownership is
    // split on purpose: a Backend remediation MUST publish an operation and its
    // web contract mirror together, and CANNOT write the adapter the mirror row
    // then obliges, because its profile forbids handwritten `web`. Widening the
    // profile would let Frontend ride inside a Backend change reviewed by
    // nobody, so the transition is named — PENDING_FRONTEND_ADAPTER — and every
    // entry is fail-closed on seven conditions this gate checks against the
    // registry, the mirror, the matrix, the verdicts, the ownership profiles and
    // the branch list. Reachability ITSELF is derived by QA-001, which runs the
    // adapters; declaring REACHABLE here is refused. The pending state is also
    // the 35/35 block: `validate:p1-28-matrix` is a byte-identity check with no
    // verdict semantics, so a full pass can only be claimed by writing PASS into
    // the verdicts, which condition 5 refuses while an adapter is still owed.
    // Mutation-proved by tests/ci/p1-28-adapter-reachability.test.ts.
    why: 'every published P1-28 apt/rec read is mirrored, and any pending Frontend adapter is a fail-closed, task-owned, still-open debt',
  },
  {
    name: 'validate:p1-29-payload-parity',
    owner: ROOT,
    tier: 'required',
    // `PRE-P1-29-BR-08c`. A SIBLING of the two P1-28 gates above, never a
    // generalisation of them: those are what P1-28's seal rests on, and widening
    // one to reach P1-29 would change a gate a sealed phase depends on.
    //
    // It compares the hand-written web contract mirror against the REAL zod
    // schemas, read as values — which is only possible because `BR-08b` exported
    // them. The extraction runs under vitest, where `@/` resolves; a `.mjs` gate
    // cannot import a TypeScript route module, and re-implementing zod semantics
    // by hand is exactly what the export made unnecessary.
    //
    // Two things it deliberately does not do, both stated in its own output
    // rather than left to be inferred from a green run: it does not check
    // RESPONSES (no machine-readable response source exists in this repository),
    // and it does not compare length, pattern or array-cardinality facets,
    // because a TypeScript interface cannot carry them. That second ceiling is
    // why the mirror declares one type per operation and shares none.
    //
    // It pins no counts. The contract's "34 bodies, one bodyless" was measured at
    // 305 operations and the tree is at 334; a hard-coded number would fail on
    // its first run, and relaxing the assertion to fix that would delete the
    // anti-vacuity protection it exists for. It asserts a relationship instead.
    // Mutation-proved by tests/ci/p1-29-payload-parity.test.ts, C1-C11.
    why: 'every P1-29 request body is mirrored in apps/web field-for-field, and every omission is declared with a reason',
  },
  {
    name: 'validate:p1-29-canonical-record',
    owner: ROOT,
    tier: 'required',
    // The P1-29 canonical record states counts ABOUT THE TREE — how many Owner
    // requirement rows, how many surfaces the read-model contract names, how
    // many `dia.*` operations exist. Round five of P1-27 found thirteen stale
    // counts in the phase records and they were one defect: a number written by
    // hand that nothing recomputes. This reads the numbers out of the record and
    // recomputes each from the tree, so the record cannot outlive what it says.
    why: 'every count and reference in the P1-29 canonical record is derivable',
  },
  {
    name: 'validate:p1-29-access',
    owner: ROOT,
    tier: 'required',
    // `gate-before-read` for P1-29, ARMED BEFORE THE SCREENS EXIST. It examines
    // zero route pages today, and that is deliberate rather than premature: a
    // gate written after the screens land does not check them, it ratifies them,
    // because whatever shape they were built in becomes the shape it accepts.
    //
    // A pass over an empty set proves nothing, so the gate says so in its own
    // output and its teeth are proved by planting ungated pages —
    // tests/ci/p1-29-access-gate.test.ts, seven cases including the P1-28 gate's
    // recorded defect: a page whose only `holds` computes a control capability
    // and denies nothing would read as gated to anything keyed on the first
    // `holds` of any kind.
    //
    // A SIBLING of check-p1-28-access.mjs, which stays byte-identical because
    // P1-28's seal rests on it.
    why: 'every P1-29 route page denies and returns on a permission before its first awaited read',
  },
  {
    name: 'validate:p1-28-access',
    owner: ROOT,
    tier: 'required',
    // `P1-28-SEC-001` / `SEC-003`. SEC-004's gate asks whether an operation can
    // be reached; this asks the two questions after it — whether the screen
    // requires exactly the permission its operations require and no more, and
    // whether anything in these trees puts a scope into a request. Both were
    // enforced by test files alone before this, and a test can be deleted in the
    // same commit as the code it guards. Mutation-proved by
    // tests/ci/p1-28-access-gate.test.ts.
    why: 'every P1-28 screen gates before it reads, consults only published codes, requires no more than its operations require, and asserts no scope in a URL',
  },
  {
    name: 'validate:p1-28-version-sourcing',
    owner: ROOT,
    tier: 'required',
    // QA-004's mechanical half. The canonical plan states the sourcing rule in
    // one sentence — a version-guarded write takes its recordVersion from a
    // READ or from the immediately prior command response — and until this gate
    // that sentence had nothing behind it: a screen sending `version + 1` would
    // satisfy every adapter test in the suite, because the adapter forwards
    // whatever number it is handed, and approve answers sent + 1 or sent + 2
    // depending on a state the screen does not control. The guarded operations
    // are derived from the published contract, the adapters from the tree, and
    // every If-Match argument is traced to a parameter or a server-stated
    // recordVersion. Mutation-proved by tests/ci/p1-28-version-sourcing.test.ts.
    why: 'every version-guarded P1-28 command sources its If-Match from a read or a command response, never from arithmetic or a cached guess',
  },
  {
    name: 'validate:p1-28-traceability',
    owner: ROOT,
    tier: 'required',
    // `P1-28-DOC-001`. The P1-28 sibling of `validate:p1-27-doc-counts`, and it
    // exists for the same defect: a true sentence that stopped being true. This
    // phase corrected its contract archaeology twice in one week — the second
    // time because PR #227 overtook the first correction — so every figure a
    // P1-28 document states about the platform is now a `derived:` marker this
    // gate substitutes the tree's answer for. It also binds each canonical test
    // id to quoted cases in comment-stripped source, so P1-27's twenty-nine
    // declared-and-unbound ids cannot recur. Mutation-proved by
    // tests/ci/p1-28-matrix.test.ts.
    why: 'every P1-28 derived count matches the tree, every canonical test id resolves to real cases, and no withdrawn claim returns',
  },
  {
    name: 'evidence:p1-27',
    owner: ROOT,
    // `informational`, not `optional`. `optional` is not one of the four tiers
    // this register defines, and `evaluate()` treats ANY unrecognised string as
    // "not a gate" — so a typo like `requird` would silently unenforce a real
    // one. The vocabulary is now asserted by `tests/ci/command-coverage.test.ts`.
    tier: 'informational',
    // The writer. Deliberately NOT required: a CI job that ran this would repair
    // the drift the required check exists to report, and a gate that fixes its
    // own failure is not a gate.
    why: 'regenerates the P1-27 evidence digest manifest',
  },
  {
    name: 'validate:web-theme',
    owner: ROOT,
    tier: 'required',
    // The workspace delegate for `@rootlco/web`'s `validate:theme`. Registered
    // here as well as in the web block because BOTH halves of a delegating pair
    // have to be classified — the root script is what CI actually invokes.
    why: 'delegates to the web Tailwind theme gate',
  },
  {
    name: 'validate:plain-language',
    owner: ROOT,
    tier: 'required',
    // Owner-acceptance defect 9. The person writing a message is the person for
    // whom its jargon reads as ordinary English, so review cannot catch this and
    // a gate can. Twenty-four rules over both message catalogues.
    why: 'no technical vocabulary in a message a workshop employee reads',
  },
  { name: 'dev:all', owner: ROOT, tier: 'interactive', why: 'owner-visible local stack launcher' },
  { name: 'dev:status', owner: ROOT, tier: 'interactive', why: 'reports the live local stack' },
  { name: 'dev:stop', owner: ROOT, tier: 'interactive', why: 'stops only launcher-owned PIDs' },
  {
    name: 'dev:verify-single-instance',
    owner: ROOT,
    tier: 'interactive',
    why: 'starts and stops real servers to prove two dev:all runs cannot duplicate the stack',
  },
  {
    name: 'acceptance:serve',
    owner: ROOT,
    tier: 'interactive',
    // The Owner acceptance stack, and the reason it cannot be `next dev`: a
    // development server compiles each route on first request, and a route
    // bundle compiled without having run the API's IAM composition holds an
    // unconfigured authenticator that refuses a valid bearer token. Measured
    // twice — 200 on /receptions while /vehicles and /work-orders answered 401
    // in the same process, with a different subset the second time — and every
    // one of them answered 200 on a production build of the same tree.
    why: 'builds both workspaces and serves them with next start: the Owner acceptance stack',
  },
  // The Owner-acceptance tooling is `interactive` for the same reason `dev:*`
  // is: it needs a running local Supabase and refuses every other target, so a
  // hosted runner could not execute it even if a workflow asked. Requiring it
  // in CI would mean requiring CI to hold a database it is not given.
  {
    name: 'acceptance:create-owner',
    owner: ROOT,
    tier: 'interactive',
    why: 'creates the local-only Owner acceptance account and all three synthetic tenants',
  },
  {
    name: 'acceptance:provision-fixtures',
    owner: ROOT,
    tier: 'interactive',
    // Not `required`, and not merely because it needs a database: it needs a
    // RUNNING API, because every row it writes is written by an authenticated
    // call to a published operation rather than by an INSERT. The browser tier
    // provisions the same fixtures through the same module, so CI needs no step
    // of its own; this command exists so a human can reach the configured
    // workspace by hand.
    why: 'configures the intake catalogues of the acceptance workspace through the published management contracts',
  },
  {
    name: 'acceptance:status-owner',
    owner: ROOT,
    tier: 'interactive',
    why: 'proves the local acceptance account can actually sign in and resolve its permissions',
  },
  {
    name: 'acceptance:reset-owner',
    owner: ROOT,
    tier: 'interactive',
    why: 'removes only the local acceptance fixtures, by catalogue-discovered dependency order',
  },
  {
    name: 'acceptance:verify-reset',
    owner: ROOT,
    tier: 'interactive',
    // The reset exiting zero means its statements succeeded, not that the right
    // statements were chosen. This asks the database instead, and its ordering
    // logic is proven by tests/ci/acceptance-discovery.test.ts in the required
    // unit tier — so the part that can be tested without a database, is.
    why: 'proves by row count that every acceptance fixture is gone before the Database tier runs',
  },
  {
    name: 'acceptance:full-cycle',
    owner: ROOT,
    tier: 'interactive',
    // The fixtures and the Database tier's clean-database tests are mutually
    // exclusive. This is what keeps them apart in the one order where both stay
    // true, so that neither test is ever weakened to accommodate the other.
    why: 'runs the whole fixture lifecycle: clean, prove, create, verify, reset, prove, clean',
  },
  {
    name: 'test:web-e2e-authenticated',
    owner: ROOT,
    tier: 'interactive',
    why: 'the authenticated browser tier, which needs a live API and a real local account',
  },
  {
    name: 'validate:p1-26-readiness',
    owner: ROOT,
    tier: 'informational',
    // A REPORTER, not a gate: "not ready" is the correct state while OIR-01 and
    // OIR-06 are open, so it exits 0 either way. The P1-26 branch-creation step
    // calls it with --assert-ready, which does fail. Its rule table is proven by
    // tests/ci/p1-26-readiness.test.ts in the required unit tier.
    why: 'derives P1-26 dependency readiness from the tree so the answer cannot go stale',
  },
  {
    name: 'validate:product-name',
    owner: ROOT,
    tier: 'required',
    why: 'one product name across both tiers — both pending, or both the same approved value',
  },
  {
    name: 'validate:api-backend-only',
    owner: ROOT,
    tier: 'required',
    why: 'apps/api is Backend-only — no page, stylesheet, client component or tracked build output',
  },
  {
    name: 'validate:permission-catalog',
    owner: ROOT,
    tier: 'required',
    // `docs/database/permission-catalog-reference.md` declared itself a
    // rendering of the IAM seed and said that regenerating it after a seed
    // change was part of that change — and then nothing regenerated it and
    // nothing read it. It was reconciled by hand once, against a seed of 43
    // codes, and stood still through six phases while the seed reached 112,
    // holding not one `tech.` code. Every tier stayed green throughout, because
    // the only executable claim over that catalog is a FLOOR in
    // `tests/db/iam-seeds.test.ts` (at least 19 codes across `org` and `iam`),
    // and a floor cannot detect growth. This is the missing half: the document
    // is derived from the seed, the risk vocabulary from the CHECK constraint
    // that decides it, and the baseline-role table from the fixture that proves
    // it — so a seed change without a regeneration fails here rather than
    // ageing quietly into a reference that reads authoritative and is wrong.
    // Mutation-proved by tests/ci/permission-catalog-reference.test.ts, which
    // plants one defect at a time — a wildcard code, a domain column that
    // disagrees with its own code, a duplicate, a reordered INSERT, a row
    // commented out of the catalog — and asserts this names that one.
    why: 'the permission catalog reference still renders the seed it claims to render',
  },
  {
    name: 'validate:permission-parity',
    owner: ROOT,
    tier: 'required',
    // `required` rather than `informational` because failing it IS a verdict.
    // `defineOperation` never checks a code against the catalogue, and no RLS
    // policy in the work-order domain consults a permission code, so a misspelt
    // code has no second line of defence anywhere.
    why: 'every permission an operation or a navigation entry declares exists in the seeded catalogue',
  },
  {
    name: 'validate:generated-artifacts',
    owner: ROOT,
    tier: 'required',
    why: 'no generated output tracked anywhere, one root lockfile, ignore rules intact',
  },
  {
    name: 'validate:phase-ownership',
    owner: ROOT,
    tier: 'ci-only',
    // Takes a profile and a base ref, so it cannot run from the repository-wide
    // aggregate: the profile is a property of the BRANCH, not of the repository.
    // That is why it is `ci-only` rather than `required` — and `ci-only` rather
    // than `informational`, which is what it was.
    //
    // The note that stood here said, in prose, that NO CI job invoked it: "a
    // grep of `.github/` for `phase-ownership` returns nothing, and it has never
    // returned anything." It found seven API source files riding inside the
    // P1-27 Frontend branch only because somebody ran it by hand. A register
    // entry that DOCUMENTS a gate as unreachable is not a record of a decision;
    // it is this phase's defect class written down in the file whose job is to
    // catch it — `evaluate()` skipped the entry precisely because the tier said
    // to, so the sentence was the only thing standing between the repository and
    // an unenforced rule.
    //
    // `_reusable-node-quality.yml`, task `static-quality`, now invokes it on
    // every pull request, resolving the profile from
    // `.github/ci-baselines/phase-ownership-profiles.json` and REFUSING a branch
    // that declares none. Under `ci-only` the invocation is enforced: delete
    // that step and this gate fails instead of narrating (`P1-27-DO-003`).
    //
    // The first version of that step then exited 0 whenever the pull-request
    // inputs were absent, which is every protected-branch push — the gate was
    // wired in and still ran nowhere authoritative. `--resolve-context` decides
    // instead: a push or dispatch on an ordinary branch resolves the profile
    // from the pushed ref, a push on `develop` or `main` is a DECLARED skip
    // carrying `checked: false`, and a `pull_request` run whose caller omitted
    // the refs is refused rather than skipped.
    why: 'per-phase changed-file ownership; the profile is a property of the branch, so hosted CI resolves it per pull request and the local aggregate cannot (P1-27-DO-003)',
  },
  {
    name: 'validate:web-topology',
    owner: ROOT,
    tier: 'required',
    why: 'one App Router root under src, proxy convention, no nested lockfile, no tracked artefacts',
  },
  { name: 'security:all', owner: ROOT, tier: 'required', why: 'security gate aggregate' },
  { name: 'security:tracked-secrets', owner: ROOT, tier: 'required', why: 'committed secrets' },
  {
    name: 'security:browser-secrets',
    owner: ROOT,
    tier: 'required',
    why: 'client-exposed secrets',
  },
  { name: 'security:scope-exclusions', owner: ROOT, tier: 'required', why: 'excluded-scope guard' },
  {
    name: 'validate:canonical-docs',
    owner: ROOT,
    tier: 'environment',
    why: 'canonical DOCX live outside the repository',
  },
  {
    name: 'validate:crm-classification',
    owner: ROOT,
    tier: 'environment',
    why: 'CRM classification',
  },
  {
    name: 'validate:veh-classification',
    owner: ROOT,
    tier: 'environment',
    why: 'vehicle classification',
  },
  {
    name: 'validate:aptrec-classification',
    owner: ROOT,
    tier: 'environment',
    why: 'appointment classification',
  },
  {
    name: 'validate:wo-tech-dia-qms-classification',
    owner: ROOT,
    tier: 'environment',
    why: 'work-order classification',
  },
  {
    name: 'validate:svc-quo-inv-classification',
    owner: ROOT,
    tier: 'environment',
    why: 'catalogue classification',
  },
  {
    name: 'validate:sal-wty-rpt-classification',
    owner: ROOT,
    tier: 'environment',
    why: 'billing classification',
  },

  // --- root: workspace delegation -------------------------------------------
  { name: 'verify:workspaces', owner: ROOT, tier: 'required', why: 'the aggregate itself' },
  {
    name: 'verify:policies',
    owner: ROOT,
    tier: 'required',
    why: 'encoding, run-block, command coverage',
  },
  { name: 'verify:repository', owner: ROOT, tier: 'required', why: 'repository-level quality' },
  { name: 'verify:api', owner: ROOT, tier: 'required', why: 'API workspace quality' },
  { name: 'verify:web', owner: ROOT, tier: 'required', why: 'web workspace quality' },
  { name: 'verify:contracts', owner: ROOT, tier: 'required', why: 'API contract validators' },
  { name: 'verify:inventories', owner: ROOT, tier: 'required', why: 'phase endpoint inventories' },
  {
    name: 'verify:classifications',
    owner: ROOT,
    tier: 'environment',
    why: 'domain classification validators — every one needs PostgreSQL (P1-25-F-023)',
  },
  {
    name: 'verify:database',
    owner: ROOT,
    tier: 'environment',
    // The local mirror of the hosted `database` job in `ci.yml`, in that job's own
    // order: seed state, the six classifications, then the Database tier. It
    // exists because PR #263 (BR-03) added one row to
    // `supabase/seeds/04_iam_permission_catalog.sql` and stale-dated two
    // hand-maintained mirrors in `tests/db/` — a pinned catalogue total and an
    // exhaustive permission-code list — while every local gate the author ran
    // stayed green and three hosted jobs went red.
    //
    // Deliberately NOT reachable from `verify:workspaces`, and that is the whole
    // design. The aggregate is the command a developer runs before every commit,
    // including a docs-only one, and the clean room mirrors it to claim that a
    // fresh clone passes "exactly what a developer runs"; requiring a live
    // PostgreSQL would make that claim false for anyone without the stack up and
    // would train people to skip the aggregate — the precise failure this
    // register exists to prevent. The clean room also runs `test:db` INSIDE its
    // schema-hash envelope and runs the aggregate AFTER the closing hash, so a
    // `test:db` folded into the aggregate would execute a schema-mutating suite
    // outside the envelope that guards it, and double-run a serial suite.
    //
    // `environment` is therefore the honest tier, with the honest cost stated:
    // nothing enforces this command. It is documented as the pre-push step in
    // CONTRIBUTING §8 for any change touching `supabase/seeds/**` or
    // `supabase/migrations/**`. The durable fix for the defect class is to
    // derive those two `tests/db/` mirrors from the seed file instead of
    // maintaining them by hand; this aggregate shortens the feedback loop, it
    // does not close the hole.
    why: 'the pre-push Database aggregate — seed state, classifications and the Database tier, all needing PostgreSQL (mirrors the hosted `database` job)',
  },
  {
    name: 'validate:use-server-exports',
    owner: ROOT,
    tier: 'required',
    // A `'use server'` file exporting a value breaks the whole server chunk in a
    // PRODUCTION build and takes down Server Actions in other features that
    // never imported it. `next dev` evaluates lazily and never shows it, so the
    // defect survived a full green local battery and was found only when the
    // acceptance environment was built the way the product ships.
    why: "'use server' modules export async functions and nothing else",
  },
  {
    name: 'verify:storage',
    owner: ROOT,
    tier: 'environment',
    // The P1-OD-025 acceptance proof: it signs an upload, PUTs real bytes, reads
    // them back and compares the hash, against whatever S3-compatible endpoint
    // the launcher configured. That is the whole point of it — a class that
    // COULD be configured is not a store that IS, and only moving an object
    // tells the two apart — so it cannot be `required`: the aggregate would run
    // it on a machine with no store, and hosted CI provisions none.
    //
    // `environment` rather than `informational` because failing it IS a verdict.
    // It is the only check standing between "the acceptance environment has an
    // object store" and a screen that offers capture into nothing.
    why: 'the acceptance object store — needs a live S3-compatible endpoint (P1-OD-025)',
  },
  {
    name: 'build',
    owner: ROOT,
    tier: 'informational',
    why: 'historical alias of build:api, which the aggregate runs',
  },
  { name: 'build:api', owner: ROOT, tier: 'required', why: 'API production build' },
  { name: 'build:web', owner: ROOT, tier: 'required', why: 'web production build' },
  { name: 'lint:api', owner: ROOT, tier: 'required', why: 'API lint' },
  { name: 'lint:web', owner: ROOT, tier: 'required', why: 'web lint' },
  { name: 'typecheck:api', owner: ROOT, tier: 'required', why: 'API typecheck' },
  { name: 'typecheck:web', owner: ROOT, tier: 'required', why: 'web typecheck' },
  {
    name: 'style:check',
    owner: ROOT,
    tier: 'informational',
    // After the pre-P1-26 boundary remediation apps/api holds no stylesheets,
    // so this root name now resolves to exactly the same stylelint run as
    // `style:check:web`. ADR-013, CONTRIBUTING and the styling standard name
    // it as the developer-facing gating form, so it keeps working — but the
    // REQUIRED coverage is carried once, by style:check:web.
    why: 'documented developer alias of style:check:web, which carries the required coverage',
  },
  { name: 'style:check:web', owner: ROOT, tier: 'required', why: 'web Sass' },
  {
    name: 'style:check:all',
    owner: ROOT,
    tier: 'informational',
    why: 'convenience alias; verify:api and verify:web each run their own half',
  },
  { name: 'test:web', owner: ROOT, tier: 'required', why: 'web component tier' },
  {
    name: 'test:web-ci',
    owner: ROOT,
    tier: 'informational',
    why: 'the same suite as test:web, with the reporters CI needs for evidence',
  },
  { name: 'format:check:api', owner: ROOT, tier: 'required', why: 'API formatting' },
  { name: 'format:check:web', owner: ROOT, tier: 'required', why: 'web formatting' },
  { name: 'validate:web-tokens', owner: ROOT, tier: 'required', why: 'design-token gate' },
  { name: 'validate:web-brand', owner: ROOT, tier: 'required', why: 'brand-isolation gate' },
  {
    name: 'validate:notification-authority',
    owner: ROOT,
    tier: 'required',
    why: 'exactly one toast authority, mounted once, and no competing library',
  },
  {
    name: 'validate:web-boundary',
    owner: ROOT,
    tier: 'required',
    why: 'no fetch outside the API layer, no API or Supabase import, no unsafe HTML',
  },
  {
    name: 'test:web-e2e',
    owner: ROOT,
    tier: 'required',
    why: 'browser smoke across five viewport and direction projects',
  },

  // --- root: environment-bound --------------------------------------------
  {
    name: 'test',
    owner: ROOT,
    tier: 'informational',
    why: 'alias of test:unit, kept for muscle memory',
  },
  { name: 'test:backend', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'test:db', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'test:integration', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  {
    name: 'test:coverage',
    owner: ROOT,
    tier: 'environment',
    why: 'coverage run, gated separately',
  },
  { name: 'db:apply-migrations', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'validate:seed-state', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'validate:schema-inventory', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'validate:structural-review', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'validate:upgrade-matrix', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'validate:baseline-manifest', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'gate:p1-12', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  {
    name: 'validate:p1-23-mutations',
    owner: ROOT,
    tier: 'environment',
    why: 'mutation run, needs PostgreSQL',
  },
  {
    name: 'validate:p1-24-mutations',
    owner: ROOT,
    tier: 'environment',
    why: 'mutation run, needs PostgreSQL',
  },

  // --- root: interactive / fix-mode ----------------------------------------
  { name: 'dev', owner: ROOT, tier: 'interactive', why: 'dev server' },
  { name: 'dev:api', owner: ROOT, tier: 'interactive', why: 'dev server' },
  { name: 'dev:web', owner: ROOT, tier: 'interactive', why: 'dev server' },
  { name: 'dev:container', owner: ROOT, tier: 'interactive', why: 'dev server in a container' },
  { name: 'start', owner: ROOT, tier: 'interactive', why: 'production server' },
  { name: 'test:watch', owner: ROOT, tier: 'interactive', why: 'watch mode' },
  { name: 'lint:fix', owner: ROOT, tier: 'interactive', why: 'fix mode' },
  { name: 'format', owner: ROOT, tier: 'interactive', why: 'fix mode' },
  { name: 'style:lint', owner: ROOT, tier: 'interactive', why: 'report mode' },
  { name: 'style:fix', owner: ROOT, tier: 'interactive', why: 'fix mode' },
  { name: 'dev:up', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'dev:down', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'dev:logs', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'dev:reset', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'supabase:start', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'supabase:stop', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'supabase:status', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'supabase:reset', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'verify', owner: ROOT, tier: 'informational', why: 'superseded by verify:workspaces' },
  { name: 'gate:p1-13', owner: ROOT, tier: 'informational', why: 'historical phase gate' },

  // --- API workspace --------------------------------------------------------
  { name: 'build', owner: API, tier: 'required', why: 'reached through build:api' },
  { name: 'lint', owner: API, tier: 'required', why: 'reached through lint:api' },
  { name: 'typecheck', owner: API, tier: 'required', why: 'reached through typecheck:api' },
  { name: 'format:check', owner: API, tier: 'required', why: 'reached through format:check:api' },

  { name: 'dev', owner: API, tier: 'interactive', why: 'dev server' },
  { name: 'dev:container', owner: API, tier: 'interactive', why: 'dev server' },
  { name: 'start', owner: API, tier: 'interactive', why: 'production server' },
  { name: 'lint:fix', owner: API, tier: 'interactive', why: 'fix mode' },
  { name: 'format', owner: API, tier: 'interactive', why: 'fix mode' },

  // --- web workspace --------------------------------------------------------
  { name: 'build', owner: WEB, tier: 'required', why: 'reached through build:web' },
  { name: 'lint', owner: WEB, tier: 'required', why: 'reached through lint:web' },
  { name: 'typecheck', owner: WEB, tier: 'required', why: 'reached through typecheck:web' },
  { name: 'format:check', owner: WEB, tier: 'required', why: 'reached through format:check:web' },
  { name: 'style:check', owner: WEB, tier: 'required', why: 'reached through style:check:web' },
  { name: 'style:lint', owner: WEB, tier: 'interactive', why: 'report mode' },
  { name: 'style:fix', owner: WEB, tier: 'interactive', why: 'fix mode' },
  { name: 'test', owner: WEB, tier: 'required', why: 'reached through test:web' },
  {
    name: 'validate:tokens',
    owner: WEB,
    tier: 'required',
    why: 'reached through validate:web-tokens',
  },
  {
    name: 'validate:brand',
    owner: WEB,
    tier: 'required',
    why: 'reached through validate:web-brand',
  },
  {
    name: 'validate:theme',
    owner: WEB,
    tier: 'required',
    why: 'reached through validate:web-theme',
  },
  {
    name: 'validate:boundary',
    owner: WEB,
    tier: 'required',
    why: 'reached through validate:web-boundary',
  },
  { name: 'test:e2e', owner: WEB, tier: 'required', why: 'reached through test:web-e2e' },
  {
    name: 'test:e2e:authenticated',
    owner: WEB,
    tier: 'interactive',
    // A hosted runner CAN be given all three — Docker is present, the Supabase
    // CLI is a devDependency, and the acceptance bootstrap creates the account
    // — and one now is: the `authenticated-browser` job in
    // `protected-develop-verification.yml` runs exactly this command. The
    // sentence that used to sit here, that none of it is available to a runner,
    // was simply wrong and was the whole reason the tier stayed unrun.
    //
    // Still not `required`, because `required` means BOTH reachable from
    // `verify:workspaces` AND invoked by CI, and the local aggregate must not
    // drag a forty-minute Docker stack into what a developer runs before a
    // commit. Not `ci-only` either: that tier is for gates whose answer depends
    // on the branch, and this one is a suite, not a gate.
    why: 'the three authenticated projects; reached through test:web-e2e-authenticated, run by the authenticated-browser job',
  },
  {
    name: 'test:ci',
    owner: WEB,
    tier: 'informational',
    why: 'the same suite as test, with the reporters CI needs for evidence',
  },
  {
    name: 'test:e2e:install',
    owner: WEB,
    tier: 'environment',
    why: 'downloads a browser; the CI job installs it as its own step',
  },
  { name: 'dev', owner: WEB, tier: 'interactive', why: 'dev server' },
  { name: 'start', owner: WEB, tier: 'interactive', why: 'production server' },
  { name: 'test:watch', owner: WEB, tier: 'interactive', why: 'watch mode' },
  { name: 'format', owner: WEB, tier: 'interactive', why: 'fix mode' },
]);

const MANIFESTS = Object.freeze([
  { owner: ROOT, path: fromRoot('package.json') },
  { owner: API, path: join(API_ROOT, 'package.json') },
  { owner: WEB, path: join(WEB_ROOT, 'package.json') },
]);

/** `owner::name`, the register's primary key. */
export const key = (owner, name) => `${owner}::${name}`;

/** Every script that exists, as a Map of key -> command line. */
export function readScripts(read = (p) => readFileSync(p, 'utf8')) {
  const scripts = new Map();
  for (const manifest of MANIFESTS) {
    const parsed = JSON.parse(read(manifest.path));
    for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
      scripts.set(key(manifest.owner, name), command);
    }
  }
  return scripts;
}

/**
 * The `npm run` edges out of one command line.
 *
 * `--workspace @rootlco/web` retargets the edge, which is what makes the
 * reachability proof cross the workspace boundary instead of stopping at it.
 */
export function edgesOf(command, owner) {
  const out = [];
  const pattern = /npm run (?:--silent )?([a-zA-Z0-9:_-]+)((?:\s+--workspace[= ]\S+)?)/g;
  let match;
  while ((match = pattern.exec(command)) !== null) {
    const target = match[1];
    const workspace = /--workspace[= ](\S+)/.exec(match[2] ?? '');
    out.push(key(workspace ? workspace[1] : owner, target));
  }
  return out;
}

/** Transitive closure of `npm run` edges from one command. */
export function reachableFrom(scripts, start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const command = scripts.get(current);
    if (!command) continue;
    const owner = current.slice(0, current.indexOf('::'));
    for (const next of edgesOf(command, owner)) queue.push(next);
  }
  return seen;
}

/** Every `npm run <name>` a hosted workflow executes, as a root-owned key. */
export function readWorkflowInvocations(
  list = () => readdirSync(join(GITHUB_ROOT, 'workflows')),
  read = (name) => readFileSync(join(GITHUB_ROOT, 'workflows', name), 'utf8')
) {
  const invoked = new Set();
  for (const file of list()) {
    if (!/\.ya?ml$/.test(file)) continue;
    for (const edge of edgesOf(read(file), ROOT)) invoked.add(edge);
  }
  return invoked;
}

export function evaluate({ scripts, workflowInvocations, register = REGISTER }) {
  const failures = [];
  const registered = new Map(register.map((entry) => [key(entry.owner, entry.name), entry]));

  for (const scriptKey of scripts.keys()) {
    if (!registered.has(scriptKey)) {
      failures.push(
        `${scriptKey} is not in the register — every command must be classified before it can be trusted or ignored`
      );
    }
  }
  for (const registeredKey of registered.keys()) {
    if (!scripts.has(registeredKey)) {
      failures.push(
        `${registeredKey} is registered but no such script exists — the register has rotted`
      );
    }
  }

  const locallyReachable = reachableFrom(scripts, key(ROOT, AGGREGATE));
  const ciReachable = new Set();
  for (const invocation of workflowInvocations) {
    for (const reached of reachableFrom(scripts, invocation)) ciReachable.add(reached);
  }

  const rows = [];
  for (const entry of register) {
    const entryKey = key(entry.owner, entry.name);
    if (!scripts.has(entryKey)) continue;
    const local = locallyReachable.has(entryKey);
    const ci = ciReachable.has(entryKey);
    rows.push({ ...entry, key: entryKey, aggregate: local, hostedCi: ci });
    if (!TIERS.includes(entry.tier)) continue;
    if (AGGREGATE_ENFORCED.includes(entry.tier) && !local) {
      failures.push(`${entryKey} is required but not reachable from \`npm run ${AGGREGATE}\``);
    }
    if (CI_ENFORCED.includes(entry.tier) && !ci) {
      failures.push(
        `${entryKey} is tier \`${entry.tier}\` but no hosted workflow invokes it. A gate no job ` +
          'runs is a gate that has never run — wire it into a workflow, or reclassify it and say ' +
          'why in the same diff.'
      );
    }
  }

  return { failures, rows };
}

function main() {
  let scripts;
  let workflowInvocations;
  try {
    scripts = readScripts();
    workflowInvocations = readWorkflowInvocations();
  } catch (error) {
    console.error(`IO error: ${error.message}`);
    process.exit(2);
  }

  const { failures, rows } = evaluate({ scripts, workflowInvocations });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ aggregate: AGGREGATE, failures, commands: rows }, null, 2));
  } else {
    const required = rows.filter((r) => r.tier === 'required');
    // `ci-only` is counted SEPARATELY and out loud. Folding it into the
    // `required` totals would hide the one class whose whole story is that
    // nothing was watching it.
    const ciOnly = rows.filter((r) => r.tier === 'ci-only');
    console.log(
      `Command coverage: ${rows.length} registered command(s), ${required.length} required, ` +
        `${ciOnly.length} ci-only`
    );
    console.log(
      `  reachable from ${AGGREGATE}: ${required.filter((r) => r.aggregate).length}/${required.length} required`
    );
    console.log(
      `  invoked by hosted CI:        ${
        [...required, ...ciOnly].filter((r) => r.hostedCi).length
      }/${required.length + ciOnly.length} required + ci-only`
    );
    for (const row of ciOnly) {
      console.log(`  ci-only: ${row.key} — invoked by a workflow: ${row.hostedCi ? 'yes' : 'NO'}`);
    }
    for (const row of rows.filter((r) => r.tier !== 'required')) {
      if (row.aggregate) continue;
      // Informational only: a non-required command outside the aggregate is the
      // expected state, printed so the classification stays visible.
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} coverage gap(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      `\nA command that no aggregate runs is a command that has never run. Register it, ` +
        `or make it reachable. Registers live in ${toRepositoryPath(fromRoot('scripts/ci/check-command-coverage.mjs'))}.`
    );
    process.exit(1);
  }
  console.log('OK: every required command is reachable locally and in hosted CI');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
