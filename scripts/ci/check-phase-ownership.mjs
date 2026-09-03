#!/usr/bin/env node
/**
 * Phase changed-file ownership gate.
 *
 * A phase declares which parts of the repository it is allowed to touch, and
 * this proves the branch honoured that declaration. It exists because the
 * expensive failure mode is not a broken build — it is a Backend or Database
 * change riding inside a Frontend phase, where nobody reviews it as Backend and
 * no Backend gate is triggered by it.
 *
 * ## Profiles
 *
 * `p1-26-frontend` is the one P1-26 will run under: a Frontend phase may change
 * `apps/web`, its own tests, its documentation and the repository tooling it
 * needs — and must change no API source, no Supabase, and no migration.
 *
 * `api-boundary` is the profile of the pre-P1-26 remediation itself, which is
 * the mirror image: it may change API and tooling, and must not change web
 * runtime source. Declaring it lets THIS branch run the gate against itself,
 * so the mechanism is proven by use before the phase that depends on it starts,
 * rather than being a check that has never once executed.
 *
 * ## Every changed file must classify
 *
 * An unclassified file is a failure, not a shrug. The point of the gate is that
 * somebody decided where each change belongs; a file nobody predicted is
 * exactly the one worth looking at.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Ordered classification rules. FIRST match wins, so the specific
 * `apps/api/src/app/api/**` case is stated before the general `apps/api/**`.
 */
export const CLASSIFIERS = [
  // Before 'web': the ONE file in apps/web a Backend branch may legitimately
  // carry — generator output kept in sync by the Backend's own register, and
  // validated by validate:generated-artifacts + validate:idempotent-operations.
  // A bucket of its own so a Backend profile can allow it without opening the
  // handwritten web tree (the hole every Backend profile exists to close).
  {
    bucket: 'webGenerated',
    test: (p) => p === 'apps/web/src/lib/api/idempotent-operations.ts',
  },
  // Before 'web', on the exact precedent of `webGenerated` above: the handwritten
  // files a Backend branch is FORCED to touch by publishing an operation.
  //
  // `idempotent-operations.ts` publishes every operation the contract carries.
  // Two handwritten mirrors then assert BIDIRECTIONAL equality against a slice
  // of it — `receptions-contract.test.ts:135` and
  // `appointments-contract.test.ts:128` both do `expect(mirrored).toEqual(published)`
  // over `rec.*` and `apt.*`. So a Backend branch that adds one `rec.*` route
  // regenerates the manifest, reddens a web test, and under every Backend
  // profile is FORBIDDEN to fix the file that went red. PRs #220/#221 escaped
  // that only because the contract layer did not exist when they merged.
  //
  // A mirror ROW is contract metadata — operation id, method, template,
  // idempotency, audit class, permission — forced by an exhaustiveness
  // assertion. It is not a Frontend design decision, and nothing about a
  // component, a screen, a route, a hook or a translation is in this bucket.
  // The handwritten web tree stays closed, which is the hole every Backend
  // profile exists to close.
  //
  // LITERAL PATHS, not a pattern, for the same reason `webGenerated` is one
  // literal path: a pattern like `*-contract.ts` would also swallow
  // `features/vehicles/duplicates-contract.ts` and six others that no
  // exhaustiveness assertion touches. The rule for adding an entry is exactly
  // the rule that put these here — the file is one half of a
  // `toEqual(published)` pair. `src/lib/api/operation-contract.ts` is
  // deliberately ABSENT: it reads the manifest but is a resolver, not a row
  // list, and a new operation costs it no edit.
  //
  // The two P1-28 suites below are here by the SAME rule, and were added when it
  // caught them. `p1-28-qa.test.ts` QA-001 does
  // `expect(unreached).toEqual([])` over the published `apt.*`/`rec.*` operator
  // surface, and `p1-28-security.test.ts` SEC-001 does `expect(narrower).toEqual([])`
  // over a register-derived filter. Both are halves of an exhaustiveness pair
  // against the published contract, so publishing ONE `rec.*` read reddens them
  // both — and under this profile the branch that reddened them may not fix them.
  //
  // That is not a hypothetical: DBCR-P1-18-002 publishes
  // `rec.receiving-employee-list`, which QA-001 reports unreached and which makes
  // SEC-001's "no narrower staff read exists" clause false in the same commit.
  // Neither is a Frontend decision. Declaring an operation's reachability state
  // and correcting a disposition the publication invalidated are both contract
  // bookkeeping forced by the publication itself.
  //
  // The handwritten web tree stays closed: no component, screen, route, hook,
  // translation or ADAPTER is in this bucket. `p1-28-qa.test.ts` may declare that
  // an operation is pending an adapter; it still cannot write one.
  {
    bucket: 'webContract',
    test: (p) =>
      p === 'apps/web/src/features/receptions/receptions-contract.ts' ||
      p === 'apps/web/tests/receptions-contract.test.ts' ||
      p === 'apps/web/src/features/appointments/appointments-contract.ts' ||
      p === 'apps/web/tests/appointments-contract.test.ts' ||
      p === 'apps/web/tests/p1-28-qa.test.ts' ||
      p === 'apps/web/tests/p1-28-security.test.ts',
  },
  { bucket: 'web', test: (p) => p.startsWith('apps/web/') },
  { bucket: 'apiSource', test: (p) => p.startsWith('apps/api/src/') },
  { bucket: 'apiConfig', test: (p) => p.startsWith('apps/api/') },
  { bucket: 'migrations', test: (p) => p.startsWith('supabase/migrations/') },
  // Before the catch-all below, for the same reason `migrations` is: a seed is
  // not the local database harness. `supabase/seeds/04_iam_permission_catalog.sql`
  // IS the canonical permission catalogue — 113 rows at the time of writing,
  // pinned by `permissionCount` in `.github/ci-baselines/schema-baseline.json`
  // rather than by this sentence — the only shipping insert into
  // `iam.permissions`, and zero migrations write to that table. A change
  // that adds a permission has to land there, so a profile has to be able to say
  // whether it may. Rolled into `supabase` it could only be granted alongside
  // `config.toml`, which is a different question with a different answer.
  { bucket: 'dbSeeds', test: (p) => p.startsWith('supabase/seeds/') },
  { bucket: 'supabase', test: (p) => p.startsWith('supabase/') },
  { bucket: 'docs', test: (p) => p.startsWith('docs/') || /^[A-Z]+\.md$/.test(p) },
  { bucket: 'tooling', test: (p) => p.startsWith('scripts/') || p.startsWith('.github/') },
  { bucket: 'tests', test: (p) => p.startsWith('tests/') },
  {
    bucket: 'rootConfig',
    test: (p) =>
      !p.includes('/') ||
      p.startsWith('.vscode/') ||
      p === 'Dockerfile' ||
      p === 'docker-compose.yml',
  },
];

/**
 * What each profile permits. A bucket not in `allowed` is FORBIDDEN.
 *
 * The `forbidden` map does not decide anything — it supplies the REASON a
 * reader is given when a refusal happens, in the profile author`s own words.
 * Deciding was once its job, and that was a fail-open: a bucket named in
 * neither list passed every rule silently, so six profiles permitted
 * `webGenerated` while declaring nothing about it, and adding a TWELFTH bucket
 * would have widened every profile in the file at once without a single line
 * changing. A gate whose declarations only ever narrow it by accident is not a
 * declaration.
 *
 * So `allowed` is the declaration and `forbidden` is the prose. A profile that
 * refuses a bucket it never mentions still refuses it, and says which profile
 * refused it and that the profile never claimed it.
 */
export const PROFILES = {
  'p1-26-frontend': {
    why: 'P1-26 is a Frontend phase',
    allowed: ['web', 'webContract', 'docs', 'tooling', 'tests', 'rootConfig'],
    forbidden: {
      apiSource:
        'a Frontend phase must not change API source — route it through a Backend remediation',
      apiConfig: 'a Frontend phase must not change API workspace configuration',
      migrations: 'a Frontend phase must not change a migration',
      supabase: 'a Frontend phase must not change the database',
    },
  },
  'p1-27-frontend': {
    why: 'P1-27 is a Frontend phase',
    // Identical rules to `p1-26-frontend`, declared under its own name because a
    // phase that borrows another phase's profile is not declaring anything. The
    // gate defaults to `p1-26-frontend` when no profile is given, which is how
    // P1-27 came to be measured against P1-26's declaration for its whole life.
    allowed: ['web', 'webContract', 'docs', 'tooling', 'tests', 'rootConfig'],
    forbidden: {
      apiSource:
        'a Frontend phase must not change API source — route it through a Backend remediation',
      apiConfig: 'a Frontend phase must not change API workspace configuration',
      migrations: 'a Frontend phase must not change a migration',
      supabase: 'a Frontend phase must not change the database',
    },
  },
  'p1-18-read-surface': {
    why:
      'the P1-18 appointment/reception read-surface remediation (P1-28 gaps G-APT-READ, G-REC-READ, ' +
      'G-CAT-*, G-REC-CLOSE): new GET routes, close commands, permission seeds, new migrations and tests',
    allowed: [
      'apiSource',
      'apiConfig',
      'docs',
      'tooling',
      'tests',
      'rootConfig',
      'migrations',
      'dbSeeds',
      'supabase',
      'webGenerated',
      // This profile is the reason the bucket exists. Every read it publishes is
      // an `apt.*` or `rec.*` operation, and both mirrors assert exhaustive
      // equality over exactly those prefixes — so a branch under this profile
      // cannot publish a read without a mirror row, and could not add one.
      'webContract',
    ],
    forbidden: {
      web:
        'Backend-only — the handwritten Frontend half is a separate change. The generated ' +
        'idempotent-operations.ts travels under its own webGenerated bucket, matching the P1-24 ' +
        'backend-merge precedent (#212/#213)',
    },
  },
  'p1-15-evidence-foundation': {
    why:
      'the P1-OD-025 shared private/versioned evidence remediation: an S3-compatible storage ' +
      'adapter, the scanner handoff, two evidence read operations, the category policy columns ' +
      'and the migration that carries them',
    allowed: [
      'apiSource',
      'apiConfig',
      'docs',
      'tooling',
      'tests',
      'rootConfig',
      'migrations',
      'dbSeeds',
      'supabase',
      // `apps/web/src/lib/api/idempotent-operations.ts`. A first draft of this
      // profile FORBADE it, reasoning that two new READ operations cannot move
      // an idempotency manifest. That reasoning was wrong about the file: it
      // publishes EVERY operation the contract carries, with its idempotency
      // and audit class as fields, so any new operation moves it. Allowing it
      // is the P1-18 read-surface and P1-24 backend-merge precedent (#212/#213)
      // — generator output the Backend's own register keeps in sync, validated
      // by `validate:generated-artifacts` and `validate:idempotent-operations`.
      'webGenerated',
      // Allowed for the same reason as `webGenerated`, and needed for the same
      // class of change even though this branch did not have to use it: the two
      // operations it publishes are `shared.*`, and no mirror asserts
      // exhaustiveness over that prefix, so nothing in the web tree went red.
      // A later evidence operation under `rec.*` would, and the declaration
      // should not have to be discovered by that branch turning CI red.
      'webContract',
    ],
    forbidden: {
      // Backend-only, for the reason every Backend profile gives: the reception
      // Frontend that will consume this evidence surface is a separate change,
      // reviewed as Frontend. `apiConfig` IS allowed here and is not allowed to
      // most Backend profiles — this change adds runtime dependencies to
      // `apps/api/package.json`, which is a Backend fact about a Backend
      // workspace, and hiding it in `rootConfig` would misdescribe it.
      web: 'the evidence foundation is Backend-only — the reception Frontend is a separate change',
    },
  },
  'p1-27-backend-partner-identity': {
    why: 'the P1-27-INT-025 partner-identity Backend remediation, split out of the Frontend branch',
    allowed: ['apiSource', 'apiConfig', 'docs', 'tooling', 'tests', 'rootConfig'],
    forbidden: {
      // `web` forbidden on purpose, for the same reason `backend-login-contract`
      // forbids it: this change exists BECAUSE seven API source files were
      // riding inside a Frontend branch where no Backend gate saw them. A
      // profile that permitted both halves would reopen the hole it closes.
      web: 'the partner-identity remediation is Backend-only — the Frontend half is a separate change',
      webContract:
        'this remediation publishes no operation, so no exhaustiveness assertion forces a mirror ' +
        'row on it. A successor that DOES publish one adds webContract to this list, which is a ' +
        'one-line diff and exactly the declaration the gate exists to require',
      migrations: 'the partner-identity remediation must not change a migration',
      supabase: 'the partner-identity remediation must not change the database',
    },
  },
  'p1-28-backend-owner-qa': {
    why:
      'the DBCR-P1-28-001 Backend remediation Owner QA forced: a damage map must NAME the template ' +
      'revision it was drawn on, enforced in the database rather than trusted from a compliant ' +
      'Frontend, plus the read field that lets Reception tell "never published" from "published ' +
      'and retired"',
    // A NARROWER surface than `p1-18-read-surface`, which would also have
    // permitted this diff. Borrowing it would have declared nothing — that
    // profile's `why` describes new GET routes, close commands and permission
    // seeds, and this branch publishes no operation at all. It changes one
    // guard, one repository read, the route and service that carry them, one
    // migration, and the tests that prove all of it.
    allowed: ['apiSource', 'migrations', 'docs', 'tooling', 'tests', 'rootConfig'],
    forbidden: {
      // The reason every Backend profile forbids it, and the reason this
      // remediation is split in two: the Frontend half of this change — sending
      // the revision, and rendering the retired sentence — is reviewed as
      // Frontend, against a Backend contract already merged. A profile
      // permitting both halves would let a write-invariant change and the client
      // that depends on it land in one unreviewed commit.
      web: 'Backend-only — the Frontend half is a separate change under the P1-28 Frontend profile',
      // Declared explicitly because it MUST be: `phase-ownership.test.ts` holds
      // every profile to naming `webContract` in one list or the other, since
      // the bucket sits before `web` in the classifier and silence about it
      // reads as permission to nobody and as refusal to nobody.
      //
      // Forbidden here on the bucket's own stated rule: an entry belongs to it
      // when the file is one half of a `toEqual(published)` pair forced by
      // publishing an operation. This branch publishes NO operation — it adds a
      // field to a response an existing operation already returns — so no
      // exhaustiveness assertion reaches the mirror, and typing that field is a
      // Frontend consumption decision rather than contract bookkeeping.
      webContract:
        'this remediation publishes no operation, so no exhaustiveness assertion forces a mirror ' +
        'row on it; typing the new response field is the Frontend half',
      webGenerated:
        'no operation is published, so the idempotency manifest cannot move — a regenerated ' +
        'manifest here would mean something else changed',
      apiConfig:
        'the API workspace configuration is untouched: this adds no dependency and no build setting',
      supabase:
        'nothing outside supabase/migrations — no seed, no config. A seed change would be a ' +
        'different claim about the database and should be declared as one',
    },
  },
  'repository-tooling': {
    why:
      'a repository-wide GATE and its suite, owned by no phase — the no-fake-data guard, the ' +
      'workflow that runs it, the tests that prove it can still fail, and the phase records its ' +
      'counts appear in',
    // `web` is forbidden for the same reason every Backend profile forbids it,
    // pointing the other way: a branch that may rewrite a gate must not also
    // carry product changes that the gate is what reviews. A profile borrowed
    // from a phase would declare nothing — this branch belongs to no phase, and
    // saying so is the whole content of the declaration.
    allowed: ['tooling', 'tests', 'docs', 'rootConfig'],
    forbidden: {
      web: 'a repository tooling change must not carry Frontend source — that is a phase change',
      webGenerated:
        'a repository tooling change must not regenerate the Frontend contract manifest',
      webContract:
        'nor edit a contract mirror. A gate change carries no operation, so nothing can force a ' +
        'mirror row on it',
      apiSource: 'a repository tooling change must not change API source',
      apiConfig: 'a repository tooling change must not change API workspace configuration',
      migrations: 'a repository tooling change must not change a migration',
      supabase: 'a repository tooling change must not change the database',
    },
  },
  'api-boundary': {
    why: 'the pre-P1-26 API file-boundary remediation',
    allowed: [
      'apiSource',
      'apiConfig',
      'docs',
      'tooling',
      'tests',
      'rootConfig',
      'web',
      'webContract',
    ],
    forbidden: {
      migrations: 'the boundary remediation must not change a migration',
      supabase: 'the boundary remediation must not change the database',
    },
  },
  /* ---- PRE-P1-29: multi-tenant administration, RBAC and operational workflow ----
   *
   * An initiative, not a phase, and it spans both halves of the product on
   * purpose: platform and company administration need API routes, migrations
   * that seed permissions, and the screens that operate them.
   *
   * THREE profiles rather than one, because a single profile spanning
   * everything forbids nothing and therefore declares nothing. The lanes below
   * keep each pull request answerable to one review boundary — a Backend change
   * cannot carry the screens that consume it, and a Web change cannot carry the
   * contract it renders. The initiative profile exists for the long-lived
   * integration branch that receives both.
   *
   * What all three refuse, and why each refusal is real rather than a formality:
   *
   *   supabase   `supabase/config.toml`, `seed.sql` and `seeds/` are the local
   *              database HARNESS, not this initiative`s business. Permissions
   *              and roles are seeded by MIGRATIONS, which are allowed, and the
   *              Owner acceptance fixtures live under
   *              `scripts/dev/owner-acceptance/`, which is tooling. Nothing this
   *              initiative must do needs the bucket. Same call as
   *              `p1-28-backend-owner-qa`.
   *   apiConfig  `apps/api/package.json` and `tsconfig.json`. Adding a dependency
   *              or moving a compiler setting is a workspace decision with its
   *              own review, and an administration feature is not the place to
   *              smuggle one.
   */
  'pre-p1-29-initiative': {
    why:
      'the PRE-P1-29 initiative integration branch — multi-tenant administration, RBAC and ' +
      'operational workflow, spanning API, migrations and Web',
    allowed: [
      'apiSource',
      'migrations',
      'dbSeeds',
      'web',
      'webGenerated',
      'webContract',
      'docs',
      'tooling',
      'tests',
      'rootConfig',
    ],
    forbidden: {
      apiConfig:
        'PRE-P1-29 must not change API workspace configuration — a dependency or compiler change ' +
        'is its own review, not a rider on an administration feature',
      supabase:
        'PRE-P1-29 must not change the database HARNESS — config.toml and the local bootstrap. ' +
        'The permission catalogue it does need is supabase/seeds, which travels under its own ' +
        'dbSeeds bucket, and the Owner acceptance fixtures live under scripts/dev/owner-acceptance',
    },
  },
  'pre-p1-29-backend': {
    why:
      'the Backend lane of PRE-P1-29 — platform and company administration contracts, RBAC ' +
      'authorization, tenant resolution and workflow commands, with the migrations that seed them',
    allowed: [
      'apiSource',
      'migrations',
      'dbSeeds',
      'webGenerated',
      'webContract',
      'docs',
      'tooling',
      'tests',
      'rootConfig',
    ],
    forbidden: {
      // Forbidden ON PURPOSE, on the `p1-18-read-surface` precedent: a Backend
      // lane that also permitted the handwritten Frontend would let both halves
      // of an administration contract land in one unreviewed commit. The
      // generated manifest travels under `webGenerated`, and a published
      // `rec.*`/`apt.*` operation may correct its mirror row under `webContract`
      // — neither opens a screen, a route or an adapter.
      web:
        'the PRE-P1-29 Backend lane is Backend-only — the screens are a separate change under ' +
        'pre-p1-29-web',
      apiConfig: 'PRE-P1-29 must not change API workspace configuration',
      supabase:
        'PRE-P1-29 must not change the database HARNESS — the permission catalogue it does need ' +
        'is supabase/seeds, which travels under its own dbSeeds bucket',
    },
  },
  'pre-p1-29-web': {
    why:
      'the Web lane of PRE-P1-29 — the Superadmin and company administration screens, the role ' +
      'editor, the capability-driven navigation and the human company/branch selectors',
    allowed: ['web', 'webContract', 'docs', 'tooling', 'tests', 'rootConfig'],
    forbidden: {
      apiSource:
        'the PRE-P1-29 Web lane must not change API source — route it through the Backend lane, ' +
        'so no screen ships against a contract nobody reviewed',
      apiConfig: 'PRE-P1-29 must not change API workspace configuration',
      webGenerated:
        'the idempotent-operations manifest is GENERATED from the Backend register — a screen that ' +
        'hand-edits it desynchronises the two, and the register is not on this side of the lane',
      migrations:
        'a screen must not carry a migration — a permission the UI offers is seeded by the ' +
        'Backend lane that publishes the operation behind it',
      dbSeeds:
        'a screen must not seed a permission — the code a role editor offers is seeded by the ' +
        'Backend lane that publishes the operation it guards',
      supabase: 'PRE-P1-29 must not change the database harness',
    },
  },
  /*
   * P1-29 is a MIXED phase — Backend prerequisites first, then the screens that
   * consume them — so it gets THREE profiles rather than one permissive profile
   * spanning both halves. The precedent is P1-28's: four of its five prefixes
   * map to `p1-27-frontend`, and the exception `remediation/p1-28-owner-qa-backend`
   * carries its own narrower profile, listed FIRST so the general rule cannot
   * reach it. A profile that permits both halves forbids nothing across the one
   * boundary that matters, and so declares nothing.
   *
   * `BR-08a` — the slice that adds these — is deliberately NOT one of them. It
   * changes a gate, its suite and the baseline it reads, which is
   * `repository-tooling`'s subject and already has a rule (`chore/pre-p1-29-`).
   * A slice that legislated its own compliance would be declaring nothing about
   * itself, which is the same fail-open in a different costume.
   */
  'p1-29-planning': {
    why:
      'a P1-29 preparation or planning branch: documentation only. Preparation decides what will ' +
      'be built and may not build any of it, and this profile is what makes that a mechanical ' +
      'fact rather than an intention',
    allowed: ['docs'],
    forbidden: {
      // The whole content of this declaration. Preparation slices in this
      // repository have twice been the place where an "obviously safe" script
      // or test edit rode along with the documents, and a docs-only claim that
      // only the author checks is not a claim.
      tooling:
        'a preparation slice must not change CI behaviour — that is what makes its own docs-only ' +
        'claim checkable by something other than its author',
      tests: 'nor a test: a preparation slice proves nothing by running anything',
      web: 'preparation authorises no screen',
      webGenerated: 'nor regenerates a manifest',
      webContract: 'nor edits a contract mirror',
      apiSource: 'preparation authorises no route, service or handler',
      apiConfig: 'nor API workspace configuration',
      migrations: 'preparation designs a migration; it does not write one',
      dbSeeds: 'nor seeds a permission — the slice that publishes the operation seeds its code',
      supabase: 'preparation must not change the database',
      rootConfig:
        'a documents-only branch needs no root configuration, and a lockfile or script change ' +
        'hidden beside a plan is exactly what this profile exists to refuse',
    },
  },
  'p1-29-backend': {
    why:
      'the Backend prerequisite lane of P1-29 (slice A0, contracts BR-01 … BR-09): the work-order, ' +
      'diagnostics, technician and quality contracts the frontend cannot be built without, with ' +
      'the migrations and permission seeds they need',
    allowed: [
      'apiSource',
      'migrations',
      // Two of the prerequisites mint a permission code — `tech.technician.manage`
      // and `dia.catalogue.manage` — and the only shipping insert into
      // `iam.permissions` is `supabase/seeds/04_iam_permission_catalog.sql`.
      // A Backend lane that could not open its own catalogue could not deliver
      // them, which is the reason `dbSeeds` is a bucket of its own.
      'dbSeeds',
      // The idempotent-operations manifest is GENERATED from the Backend
      // register. A slice that publishes an operation must be able to regenerate
      // it or `validate:generated-artifacts` goes red on its own change.
      'webGenerated',
      'docs',
      'tooling',
      'tests',
      'rootConfig',
    ],
    forbidden: {
      web:
        'the P1-29 Backend lane is Backend-only — the screens are a separate change under ' +
        'p1-29-frontend, so no screen ships against a contract nobody reviewed',
      webContract:
        'the contract-mirror allow-list names P1-28 appointment and reception files. A P1-29 ' +
        'operation has no row in it, so a Backend slice reaching for one is reaching for another ' +
        "phase's sealed artefact",
      apiConfig: 'P1-29 must not change API workspace configuration',
      supabase:
        'P1-29 must not change the database HARNESS — the migrations and the permission catalogue ' +
        'it does need travel under their own buckets',
    },
  },
  'p1-29-frontend': {
    why:
      'the Frontend lane of P1-29: the work-order board and detail, the technician workspace, the ' +
      'diagnostics experience, and the contract mirror that lets them consume the Backend without ' +
      'importing it',
    allowed: ['web', 'docs', 'tooling', 'tests', 'rootConfig'],
    forbidden: {
      apiSource:
        'a Frontend phase must not change API source — route it through the Backend lane. This is ' +
        'the same boundary p1-26-frontend and p1-27-frontend hold, declared under its own name ' +
        'because a profile borrowed from another phase declares nothing about this one',
      apiConfig: 'a Frontend phase must not change API workspace configuration',
      webGenerated:
        'the idempotent-operations manifest is GENERATED from the Backend register — a screen that ' +
        'hand-edits it desynchronises the two, and the register is not on this side of the lane',
      webContract:
        'that allow-list holds six frozen P1-28 files. The P1-29 mirror is new source under ' +
        'apps/web and travels as web',
      migrations: 'a screen must not carry a migration',
      dbSeeds:
        'a screen must not seed a permission — the Backend lane that publishes the operation does',
      supabase: 'a Frontend phase must not change the database',
    },
  },
  'p1-09-database-seed': {
    why:
      'a missed P1-09 DATABASE seed obligation, repaired after the fact: one declared seed file ' +
      'of platform reference rows, its [db.seed] declaration, the classification the seed-state ' +
      'and replay checks need, and the tests and records that prove it (first use: the platform ' +
      'diagnostic-type vocabulary, Owner decision of 2026-09-03, P1-29 W9-R4)',
    allowed: [
      'dbSeeds',
      // The seed is applied only if supabase/config.toml declares it under
      // [db.seed].sql_paths; the harness file is the one place that list lives.
      'supabase',
      // The seed-state validator and the replay baseline classify structural
      // catalogs by name; a new one must be classified or it is a finding.
      'tooling',
      'tests',
      'docs',
      'rootConfig',
    ],
    forbidden: {
      apiSource:
        'a seed repair that needed application code would not be a seed repair — route code ' +
        'through the lane of the phase that owns it',
      apiConfig: 'a seed repair does not change API workspace configuration',
      web: 'a seed repair ships no screen',
      webContract: 'a seed repair has no operation and therefore no contract mirror to touch',
      webGenerated: 'a seed repair publishes no operation, so the generated manifest cannot move',
      migrations:
        'the rows are reference data and belong in a declared seed; the no-fake-data migration ' +
        'gate refuses a top-level INSERT into a module schema, and this lane must not go around it',
    },
  },
  'backend-login-contract': {
    why: 'the login-identity Backend remediation P1-26 is blocked on',
    allowed: ['apiSource', 'apiConfig', 'docs', 'tooling', 'tests', 'rootConfig'],
    forbidden: {
      // `web` is forbidden ON PURPOSE. A Backend profile that also permitted
      // Frontend would let the two halves of this contract change land in one
      // unreviewed commit — which is the same hole `p1-26-frontend` exists to
      // close, merely pointing the other way. The Frontend half is a separate
      // change under `p1-26-frontend`, against a Backend contract already merged.
      web: 'the login-contract remediation is Backend-only — the Frontend half is a separate change',
      webContract:
        'the login contract publishes no rec.*/apt.* operation, so no exhaustiveness assertion ' +
        'reaches it. A successor that publishes one declares webContract here',
      migrations: 'the login-contract remediation must not change a migration',
      supabase: 'the login-contract remediation must not change the database',
    },
  },
};

/* ==========================================================================
 * Part two: WHICH ownership question this CI run can answer.
 *
 * Everything above decides whether a diff honoured a profile. This decides
 * whether the run has a diff and a profile to decide about — and what happens
 * when it does not.
 *
 * It lives in this file rather than beside it because the two halves are one
 * gate: a reader who finds the classification rules must also find the reason a
 * run can legitimately check nothing, or the second will be reinvented as an
 * `exit 0`. Which is exactly what happened — see `decideOwnershipRun()`.
 * ========================================================================== */

/** Where the branch → profile map lives. */
export const PROFILE_MAP_PATH = '.github/ci-baselines/phase-ownership-profiles.json';

/**
 * Branches on which the ownership question does not apply.
 *
 * Not configurable, for the reason `check-promotion-source.mjs` gives about the
 * same pair: `develop` and `main` are named in ADR-006 as permanent branches
 * with fixed meanings, and a configurable list would let the skip be widened by
 * editing a value rather than by amending the ADR.
 */
export const PROTECTED_BRANCHES = Object.freeze(['develop', 'main']);

/** Events that carry a pull request, and therefore must carry its refs. */
export const PULL_REQUEST_EVENTS = Object.freeze(['pull_request', 'pull_request_target']);

/**
 * The base a branch push is judged against.
 *
 * `static-quality` checks out at `fetch-depth: 0`, so `origin/develop` is
 * present. If it ever is not, `check-phase-ownership.mjs` exits 2 naming the
 * ref — a broken measurement, reported as one.
 */
export const DEFAULT_BASE = 'origin/develop';

/**
 * What may appear in a value the run block sources.
 *
 * A ref or profile name outside this set is not a real one, so refusing it costs
 * nothing and removes the whole class of question about what the shell would do
 * with it.
 */
const SAFE_VALUE = /^[A-Za-z0-9._/-]+$/;

const refuse = (reason) => ({
  action: 'refuse',
  checked: false,
  profile: null,
  base: null,
  reason,
});

/**
 * Resolve a branch against the committed profile map.
 *
 * @param {string} branch
 * @param {ReadonlyArray<{branchPrefix?: string, profile?: string}>} rules
 * @param {string} how  how this branch was arrived at, for the message
 */
function fromBranch(branch, base, rules, how) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return refuse(
      `${PROFILE_MAP_PATH} declares no rules, so every branch would resolve to nothing. An empty ` +
        'map is a broken map, not a permissive one.'
    );
  }
  const rule = rules.find(
    (r) =>
      typeof r?.branchPrefix === 'string' &&
      r.branchPrefix !== '' &&
      branch.startsWith(r.branchPrefix)
  );
  if (!rule) {
    return refuse(
      `branch \`${branch}\` declares no changed-file ownership profile. Add a rule to ` +
        `${PROFILE_MAP_PATH} saying which parts of the repository this branch is allowed to ` +
        "change. Refusing to judge it against another phase's declaration, which is how every " +
        'branch came to be measured against p1-26-frontend.'
    );
  }
  if (typeof rule.profile !== 'string' || !SAFE_VALUE.test(rule.profile)) {
    return refuse(
      `the rule matching \`${branch}\` names profile \`${String(rule.profile)}\`, which is not a ` +
        'usable profile name.'
    );
  }
  if (!SAFE_VALUE.test(base)) {
    return refuse(`base ref \`${base}\` is not a usable ref name, so nothing will be diffed.`);
  }
  return {
    action: 'check',
    checked: true,
    profile: rule.profile,
    base,
    reason: `${how} -> ownership profile '${rule.profile}', judged against '${base}'`,
  };
}

/**
 * @param {{headBranch?: string, baseRef?: string, eventName?: string, refName?: string,
 *          rules?: ReadonlyArray<{branchPrefix?: string, profile?: string}>}} context
 * @returns {{action: 'check'|'declared-skip'|'refuse', checked: boolean,
 *            profile: string|null, base: string|null, reason: string}}
 */
export function decideOwnershipRun(context = {}) {
  const head = String(context.headBranch ?? '').trim();
  const baseRef = String(context.baseRef ?? '').trim();
  const event = String(context.eventName ?? '').trim();
  const ref = String(context.refName ?? '').trim();
  const rules = context.rules ?? [];

  if (head !== '' && baseRef !== '') {
    /*
     * A PROMOTION — a pull request whose HEAD is itself a protected branch.
     *
     * This file already refuses to judge a protected branch on a push, and says
     * exactly why: changed-file ownership is a property of ONE phase branch
     * against its base, while a protected branch is the union of every phase
     * that has landed. That reasoning does not change because the same branch
     * arrives as the head of a pull request instead of as a push. `develop` ->
     * `main` carries 921 commits from every phase since P1-24, and no phase
     * profile could describe it.
     *
     * The gate REFUSED the first such promotion rather than guessing, which was
     * the right failure: the alternative — borrowing some phase's declaration —
     * is the exact fault this file exists to prevent, and its own message says
     * so. What was missing is not a profile but this case.
     *
     * It is a DECLARED SKIP, not a pass. Every commit in a promotion passed this
     * gate on the pull request that merged it to the protected branch, and the
     * promotion itself is reviewed by the protected gates it must pass at its
     * exact head. Nothing here was checked, and this run is not evidence that it
     * was.
     */
    if (PROTECTED_BRANCHES.includes(head)) {
      return {
        action: 'declared-skip',
        checked: false,
        profile: null,
        base: `origin/${baseRef}`,
        reason:
          `the pull-request head '${head}' is itself a protected branch, so this is a promotion ` +
          `onto '${baseRef}' rather than a phase change. Changed-file ownership is a property of ` +
          'ONE phase branch against its base; a protected branch is the union of every phase that ' +
          'has landed, so no profile could describe it. Every commit in this range passed this ' +
          'gate on the pull request that merged it, and the promotion is reviewed by the ' +
          'protected gates it must pass at its exact head. DECLARED SKIP — nothing was checked, ' +
          'and this run is not evidence that it was.',
      };
    }
    return fromBranch(head, `origin/${baseRef}`, rules, `pull-request head '${head}'`);
  }

  // Half a context is never a legitimate state: both inputs come from the same
  // event, so one without the other means the caller wired one of them wrong.
  // Treating it as "no pull request" is how a typo turns into a silent skip.
  if (head !== '' || baseRef !== '') {
    return refuse(
      `the caller supplied head-branch='${head}' and base-ref='${baseRef}' — exactly one of the ` +
        'two. Both come from the same event, so this is a wiring defect in the calling workflow.'
    );
  }

  if (PULL_REQUEST_EVENTS.includes(event)) {
    return refuse(
      `this is a '${event}' run, so a pull-request context exists, but the caller passed neither ` +
        'head-branch nor base-ref. The ownership gate would judge nothing and report success. ' +
        'Pass `head-branch: ${{ github.event.pull_request.head.ref }}` and `base-ref: ' +
        '${{ github.event.pull_request.base.ref }}` from the calling workflow.'
    );
  }

  if (event === '') {
    return refuse(
      'no event name was supplied, so this run cannot establish its own context. A check that ' +
        'cannot tell what it is running on must not report success.'
    );
  }

  if (ref === '') {
    return refuse(
      `a '${event}' run supplied no ref name: there is no pull request to read a profile from and ` +
        'no branch to resolve one from.'
    );
  }

  if (PROTECTED_BRANCHES.includes(ref)) {
    return {
      action: 'declared-skip',
      checked: false,
      profile: null,
      base: null,
      reason:
        `'${ref}' is a protected branch and this is a '${event}' run. Changed-file ownership is a ` +
        'property of ONE phase branch against its base; a protected branch is the union of every ' +
        'phase that has landed, so no profile could describe it and there is no base to diff ' +
        'against. Every commit here passed this gate on the pull request that merged it. ' +
        'DECLARED SKIP — nothing was checked, and this run is not evidence that it was.',
    };
  }

  // A push or dispatch on an ordinary branch. There is no pull request, but the
  // profile map is keyed on the branch, and the branch is right here.
  return fromBranch(ref, DEFAULT_BASE, rules, `'${event}' on branch '${ref}'`);
}

/**
 * A value the sourcing shell will read back exactly as written.
 *
 * POSIX single-quote escaping: close the quote, emit an escaped quote, reopen.
 * Values are validated before they reach here; this is the second of the two
 * independent defences.
 */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** The `KEY='value'` block the run block sources. */
export function envFileBody(verdict) {
  return (
    [
      `OWNERSHIP_ACTION=${shellQuote(verdict.action)}`,
      `OWNERSHIP_PROFILE=${shellQuote(verdict.profile ?? '')}`,
      `OWNERSHIP_BASE=${shellQuote(verdict.base ?? '')}`,
    ].join('\n') + '\n'
  );
}

/**
 * @param {string} path
 * @returns {string} bucket name, or 'unclassified'
 */
export function classify(path) {
  for (const rule of CLASSIFIERS) if (rule.test(path)) return rule.bucket;
  return 'unclassified';
}

/**
 * Whether an EMPTY changed set is the correct answer or a broken measurement.
 *
 * `git diff <base>...HEAD` runs from the MERGE BASE to the head, so an empty
 * file list is truthful exactly when those two commits name the same tree
 * object. That is the only fact that can separate "this branch changes nothing"
 * from "the comparison failed and produced no output", and it is a fact about
 * objects rather than about branch names.
 *
 * Takes a `git` reader rather than shelling out, for the reason the evidence
 * seal's analysers do: a rule that can only be exercised by arranging a real
 * repository is a rule whose failure paths go untested. `null` from the reader
 * is a REFUSAL — a question Git declined to answer has not been answered — and
 * every refusal here returns `null`, which the caller treats as not
 * established, which fails closed.
 *
 * @param {string} base
 * @param {(args: string[]) => string | null} git
 * @returns {{ mergeBase: string, tree: string, truthful: boolean } | null}
 */
export function emptyDiffAgreesWithTrees(base, git) {
  const sha = /^[0-9a-f]{40}$/;
  const read = (args) => String(git(args) ?? '').trim();
  const mergeBase = read(['merge-base', base, 'HEAD']);
  if (!sha.test(mergeBase)) return null;
  const from = read(['rev-parse', `${mergeBase}^{tree}`]);
  const to = read(['rev-parse', 'HEAD^{tree}']);
  if (!sha.test(from) || !sha.test(to)) return null;
  return { mergeBase, tree: from, truthful: from === to };
}

/**
 * @param {readonly string[]} changed changed files vs the phase base
 * @param {string} profileName
 * @param {boolean | null} [emptyDiffIsTruthful]
 *   Whether an EMPTY changed set is the correct answer rather than a broken
 *   measurement — that is, whether the tree the diff started from and the tree
 *   it ended at are the same object. `null` means nothing established it, and
 *   is treated as "not established", which fails closed.
 * @returns {{ failures: string[], counts: Record<string, number> }}
 */
export function evaluate(changed, profileName, emptyDiffIsTruthful = null) {
  /** @type {string[]} */
  const failures = [];
  /** @type {Record<string, number>} */
  const counts = {};

  const profile = PROFILES[profileName];
  if (!profile) {
    return { failures: [`unknown ownership profile: ${profileName}`], counts };
  }

  for (const bucket of Object.keys(PROFILES[profileName].forbidden)) counts[bucket] = 0;
  for (const bucket of profile.allowed) counts[bucket] = 0;
  counts.unclassified = 0;
  counts.changed = changed.length;

  /*
   * Anti-vacuity. Every rule below iterates the changed set, so an empty set
   * passes every rule having judged nothing — which is indistinguishable, from
   * the file list alone, from a diff that silently produced no output because
   * the base ref was wrong.
   *
   * From the file list alone. The TREES can tell those two apart, and now do:
   * `git diff <base>...HEAD` is the diff from the merge base to the head, so an
   * empty file list is truthful exactly when those two commits name the same
   * tree object. Equal trees mean this branch changes nothing and there is
   * nothing to own; unequal trees with no output mean the measurement failed,
   * and that is still refused.
   *
   * The case that forced the distinction is a SYNC MERGE — protected `main`
   * merged into `develop` so a promotion can satisfy its up-to-date rule. Such
   * a merge changes zero files by construction, and changing zero files is
   * precisely what makes it safe. Refusing it as a broken comparison would have
   * required inventing a file change to satisfy a gate, which is the one repair
   * this gate exists to prevent.
   *
   * Strictly stronger than what it replaces: the old rule could not see the
   * difference and refused both worlds; this one refuses the broken world and
   * says so about the empty one. `null` — nothing established the trees — is
   * "not established", and fails closed with the same words as before.
   */
  if (changed.length === 0) {
    if (emptyDiffIsTruthful === true) {
      counts.unchanged = 1;
      return { failures, counts };
    }
    failures.push(
      'no changed files were found against the base — a phase branch under review always has ' +
        'changes, so this is a broken comparison rather than a clean result'
    );
    return { failures, counts };
  }

  for (const path of changed) {
    const bucket = classify(path);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    if (bucket === 'unclassified') {
      failures.push(`unclassified changed file: ${path} — decide where it belongs`);
      continue;
    }
    /*
     * ALLOWED decides. A bucket this profile does not claim is refused whether
     * or not anybody wrote a sentence about it — which is the whole difference
     * between a declaration and a list of afterthoughts.
     */
    if (profile.allowed.includes(bucket)) continue;
    const reason =
      profile.forbidden[bucket] ??
      `the ${profileName} profile does not claim the ${bucket} bucket, so it may not change one`;
    failures.push(`${bucket}: ${path} — ${reason}`);
  }

  return { failures, counts };
}

/**
 * `--resolve-context`: decide what this run may ask, and say so.
 *
 * A separate entry point on the same file rather than a separate file, because
 * the decision and the rules it selects belong to one gate. The workflow calls
 * this first, then calls the gate proper only on the `check` verdict.
 */
function resolveContextMain() {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
  };

  let rules;
  try {
    rules = JSON.parse(readFileSync(PROFILE_MAP_PATH, 'utf8')).rules ?? [];
  } catch (error) {
    console.error(`::error::could not read ${PROFILE_MAP_PATH}: ${String(error)}`);
    process.exit(2);
  }

  const event = process.env.OWNERSHIP_EVENT_NAME ?? process.env.GITHUB_EVENT_NAME ?? '';
  const ref = process.env.OWNERSHIP_REF_NAME ?? process.env.GITHUB_REF_NAME ?? '';
  const verdict = decideOwnershipRun({
    headBranch: process.env.HEAD_BRANCH,
    baseRef: process.env.BASE_REF,
    eventName: event,
    refName: ref,
    rules,
  });

  console.log(`changed-file ownership: ${verdict.action.toUpperCase()}`);
  console.log(`  ${verdict.reason}`);

  const envOut = arg('env-out');
  if (envOut) writeFileSync(envOut, envFileBody(verdict), 'utf8');

  // Written only when asked. A default path would drop an untracked file into
  // the repository root every time somebody ran this by hand.
  const jsonOut = arg('json');
  if (jsonOut) {
    const record = {
      action: verdict.action,
      checked: verdict.checked,
      profile: verdict.profile,
      base: verdict.base,
      reason: verdict.reason,
      event,
      ref,
    };
    writeFileSync(jsonOut, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }

  // The declared skip is RECORDED, not merely printed: a skip nobody can find
  // afterwards is the silent success it replaced, one step removed.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Changed-file ownership — ${verdict.action}\n\n${verdict.reason}\n\n`,
      'utf8'
    );
  }

  if (verdict.action === 'refuse') {
    console.error(`::error::${verdict.reason}`);
    process.exit(1);
  }
  if (verdict.action === 'declared-skip') console.log(`::notice::${verdict.reason}`);
}

function main() {
  // Checked before anything reads `process.argv[2]` as a profile name, which is
  // what a flag would otherwise be taken for.
  if (process.argv.includes('--resolve-context')) return resolveContextMain();

  /*
   * Profile selection: argument, then environment, then the default.
   *
   * `PHASE_OWNERSHIP_PROFILE` exists because the npm script that invokes this
   * gate — `validate:phase-ownership` — passes no argument, so every caller got
   * `p1-26-frontend` whatever branch they were on. That is not a nuisance: on a
   * BACKEND branch the default forbids `apiSource`, so the gate cannot pass at
   * all, and the two P1-27 profiles below were reachable from no script and no
   * workflow. A profile nothing can select is a declaration, not a gate — which
   * is this phase's own recurring defect, in its own tooling.
   *
   * The env var lets one CI job select the profile per branch without a script
   * per profile. That job now exists — `_reusable-node-quality.yml`, task
   * `static-quality`, step "Changed-file ownership" — and it always sets both
   * variables: `--resolve-context` above resolves the profile from
   * the pull-request head branch, or from the pushed ref when there is no pull
   * request, and refuses the run rather than defaulting when it can resolve
   * neither.
   *
   * The `p1-26-frontend` fallback below therefore governs only a HAND run with
   * no argument and no environment. It is kept because removing it would make
   * `npm run validate:phase-ownership` fail for the person debugging the gate,
   * and it is stated here so nobody reads it as the CI behaviour: in CI nothing
   * is defaulted, and an unmapped branch is refused.
   */
  const profileName = process.argv[2] ?? process.env.PHASE_OWNERSHIP_PROFILE ?? 'p1-26-frontend';
  const base = process.argv[3] ?? process.env.PHASE_OWNERSHIP_BASE ?? 'origin/develop';

  let changed = [];
  try {
    changed = execFileSync(
      'git',
      ['diff', '--name-only', '-M', '--diff-filter=ACMRD', `${base}...HEAD`],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (error) {
    console.error(
      `could not diff against ${base}: ${error instanceof Error ? error.message : error}`
    );
    process.exit(2);
  }

  /*
   * Asked only when it can change the answer, and asked of the same two commits
   * the diff above ran between: `<base>...HEAD` starts at the merge base, so
   * that is the tree an empty file list has to agree with.
   */
  let emptyDiffIsTruthful = null;
  if (changed.length === 0) {
    const read = (args) => {
      try {
        return execFileSync('git', args, { encoding: 'utf8' });
      } catch {
        // A refusal, reported as one. `''` would read as an answer.
        return null;
      }
    };
    const agreement = emptyDiffAgreesWithTrees(base, read);
    emptyDiffIsTruthful = agreement === null ? null : agreement.truthful;
    if (agreement?.truthful) {
      console.log(
        `  the diff from ${agreement.mergeBase.slice(0, 8)} to HEAD is empty AND both name ` +
          `tree ${agreement.tree.slice(0, 8)}, so this branch changes nothing and there is ` +
          'nothing to own'
      );
    }
  }

  const { failures, counts } = evaluate(changed, profileName, emptyDiffIsTruthful);
  const profile = PROFILES[profileName];

  console.log(
    `Phase ownership [${profileName}${profile ? ` — ${profile.why}` : ''}] vs ${base}: ` +
      `${counts.changed ?? 0} changed file(s), ${failures.length} violation(s).`
  );
  const shown = Object.entries(counts)
    .filter(([k, v]) => k !== 'changed' && v > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(' · ');
  if (shown) console.log(`  ${shown}`);

  if (failures.length > 0) {
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\nA phase changes what it declared it would change. A Backend or Database ' +
        'change riding inside another phase is reviewed by nobody and gated by nothing.'
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
