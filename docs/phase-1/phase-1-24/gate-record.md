# P1-24 — Backend Integration and Release Gate Record

**Phase:** P1-24 — Backend Integration and Release Gate
**Prerequisite:** P1-23 closed and promoted; `origin/develop` at
`1c74454debfe0d75f521d2641fba0c20b03cdfe0` (tree `973f32c1`) before the feature merge
**Decision:** recorded in §12 below.

This is a **documentation-only** record. It changes no executable file, no test, no
script, no workflow, no manifest, no lockfile, no Supabase file, no seed, no migration
and no generated contract.

P1-24 is not a new business domain. It is the controlled integration, validation and
hardening gate over every backend capability delivered through P1-23 — 226 operations
across 19 modules — and its deliverable is as much the _mechanisms that make the proof
repeatable_ as the proof itself.

---

## 1. Protected merge evidence

Every value below was read live from the remote after the owner merge of the **feature**
pull request, not carried forward from the feature report. They are a snapshot of that
merge and are pinned to it — protected `develop` moved on when the gate pull request
itself merged, and that later state is recorded in §12 and in
[`promotion-record.md`](promotion-record.md) rather than by rewriting this table.

|                                    |                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Feature PR                         | **#151** — `feat(p1-24): complete backend integration and release gate`     |
| Reviewed feature SHA               | `76632b05c95c9618b90394eb4899513b0d0c5042`                                  |
| Reviewed feature tree              | `f7b06ecc5cf8072e0ed687933ce840834579d9f4`                                  |
| Feature merge SHA                  | `38d1ec22ddaf3a6507c876e0a4ffff447de8b972`                                  |
| Feature merge tree                 | `f7b06ecc5cf8072e0ed687933ce840834579d9f4`                                  |
| Merge first parent                 | `1c74454debfe0d75f521d2641fba0c20b03cdfe0` — the protected base             |
| Merge second parent                | `76632b05c95c9618b90394eb4899513b0d0c5042` — the reviewed feature           |
| Merge method                       | merge commit — the only method the ruleset permits                          |
| Merged by                          | `Ezzaldeen-Albitar` (owner), 2026-08-01T07:08:51Z                           |
| Protected `develop` at this merge  | `38d1ec22ddaf3a6507c876e0a4ffff447de8b972`                                  |
| Its tree                           | `f7b06ecc5cf8072e0ed687933ce840834579d9f4`                                  |
| Reviewed feature contained         | **yes** — `merge-base --is-ancestor` exit 0                                 |
| Tree identity                      | **byte-identical** — merge tree == reviewed feature tree                    |
| Files added after the reviewed SHA | **0** — `git diff 76632b0 38d1ec2` is empty                                 |
| `origin/main`                      | `db54acf1d09a3a8c499b6ee17660871ab8c410f9` — **untouched**, tree `973f32c1` |
| Open PRs after this merge          | 0                                                                           |
| Remote branches                    | `develop`, `main` — the feature branch was auto-deleted on merge            |

**No unreviewed executable change entered the merge.** The merge tree is byte-identical
to the tree that was reviewed and CI-verified, so nothing entered protected `develop`
**at this merge** that PR #151 did not carry. What the gate merge added afterwards — two
documentation files and nothing else — is measured in §12.

---

## 2. Protected merge-SHA CI

A green feature PR does not substitute for this. Both push-triggered workflows ran
against `38d1ec2` itself.

| Workflow                        | Run ID        | Trigger | Conclusion  |
| ------------------------------- | ------------- | ------- | ----------- |
| `CI`                            | `30689149654` | push    | **success** |
| `Protected branch verification` | `30689149773` | push    | **success** |

**17 check-runs, 17 success, 0 failed, 0 cancelled, 0 neutral, 0 skipped-without-reason.**

| Check                                                   | Result  |
| ------------------------------------------------------- | ------- |
| `protected-gate`                                        | success |
| `static-quality / static-quality`                       | success |
| `unit-tests-coverage / unit-coverage`                   | success |
| `integration-tests / integration-tests`                 | success |
| `database-security / security-matrix`                   | success |
| `database-migration-replay / migration-replay`          | success |
| `Database migrations and RLS tests`                     | success |
| `hosted-clean-room / hosted-clean-room`                 | success |
| `code-security / code-security (javascript-typescript)` | success |
| `code-security / code-security (actions)`               | success |
| `dependency-security / dependency-security`             | success |
| `secret-scan / secret-scan`                             | success |
| `Secret and sensitive-file scan`                        | success |
| `container-security / container-security`               | success |
| `Docker build validation`                               | success |
| `application-build / build`                             | success |
| `Lint, types, tests, build`                             | success |

`ci-gate` is the aggregate of the **pull-request** workflow and is therefore absent
here by design; on a protected push the aggregate is `protected-gate`, which is green.

---

## 3. Exact protected-SHA clean-room reproof

A **fresh clone** at `38d1ec2` — not the feature worktree, not its build artefacts.

|                              |                                                             |
| ---------------------------- | ----------------------------------------------------------- |
| Protected candidate SHA      | `38d1ec22ddaf3a6507c876e0a4ffff447de8b972`                  |
| Protected candidate tree     | `f7b06ecc5cf8072e0ed687933ce840834579d9f4`                  |
| Operating system             | Windows 11 Pro, 10.0.26200 (win32)                          |
| CPU / memory                 | 12 × Intel Core i7-8750H @ 2.20 GHz · 34 GB                 |
| Node                         | v24.16.0                                                    |
| npm                          | 11.13.0                                                     |
| Docker                       | 29.5.3 (build d1c06ef)                                      |
| PostgreSQL                   | 17.6, local Supabase container                              |
| Dependency install           | `npm ci` from the committed lockfile — exit 0, 438 packages |
| Working tree after every run | clean                                                       |

### Test tiers — recalculated, not copied

| Tier             | Command                | Files   | Tests    | Failed | Skipped |
| ---------------- | ---------------------- | ------- | -------- | ------ | ------- |
| Unit / component | `npm run test`         | 58      | **1288** | 0      | 0       |
| Backend          | `npm run test:backend` | 75      | **1752** | 0      | 0       |
| Database / RLS   | `npm run test:db`      | 138     | **1636** | 0      | 0       |
| **Total**        |                        | **271** | **4676** | **0**  | **0**   |

### Database / RLS — the ambiguity the brief asked to remove

The feature report was not explicit about whether `1636/1636` ran inside the fresh
clone or only in another local environment. It is now unambiguous:

|                           |                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact command             | `npm run test:db` → `vitest run --config vitest.config.db.ts`                                                                                                      |
| Working directory         | `C:/Users/Ezzaldeen/AppData/Local/Temp/claude/p24-post` — the fresh clone                                                                                          |
| Exact SHA at execution    | `38d1ec22ddaf3a6507c876e0a4ffff447de8b972`                                                                                                                         |
| Executed files            | 138                                                                                                                                                                |
| Executed tests            | 1636                                                                                                                                                               |
| Passed / failed / skipped | 1636 / 0 / 0                                                                                                                                                       |
| Runtime application role  | `app_runtime` — the deployed runtime identity, under RLS. `postgres` is used only to provision preconditions no application role may create, and never as evidence |
| Duration                  | 274.03 s                                                                                                                                                           |
| Evidence                  | this record §3; hosted `database-security / security-matrix` and `Database migrations and RLS tests` are separately green on the same SHA                          |

### Gates, all executed in the clean room at the protected SHA

Formatting · lint · typecheck · stylelint · `npm audit` (**0 vulnerabilities**) ·
encoding · module boundaries · authorization coverage · operation coverage ·
OpenAPI validation · exact-money · P1-24 register `--check` · P1-19…P1-23 phase
inventories · security scans (5/5) · production build (**compiled successfully**) ·
mutation matrix (**6/6 caught, 0 survived, 0 stillborn**) · dependency policy
(**pass**) · migration immutability · schema hash · final clean `git status`.

**One check needs its context recorded rather than a bare tick.**
`validate:canonical-docs` fails when run _without_ `--record-only` in this clean room,
and that is correct behaviour, not a defect. The two canonical DOCX files are
**external to the repository by design** — recorded at `../RootLco_Phase_1_…docx` and
`../documentation/RootLco_Master_…docx`, resolved from the repository root. They exist
beside the owner's checkout and were confirmed present there. Both CI workflows invoke
the check as `npm run validate:canonical-docs -- --record-only`, which is the mode that
applies anywhere other than the owner workstation; run that way in the clean room it
exits 0 and reports both documents as `EXTERNAL -- absent here, hash NOT compared`.

---

## 4. The four findings, re-proven on the protected tree

Each is re-proven against `38d1ec2`, not against the feature SHA.

### P1-24-F-001 — 39 operations outside the derived-evidence floor · **Resolved**

- **Fix in the protected tree:** `scripts/check-operation-test-coverage.mjs:205` —
  `export const P1_24_PREFIXES = ['iam.', 'meta.'];` added to `DERIVED_PREFIXES`;
  `tests/backend/p1-24-iam-route-depth.test.ts` (1851 lines, **88 tests**).
- **Coverage gate on protected `develop`:** 226 registered operations, **226 with
  required evidence, 0 invocation-only**.
- **Missing-permission denial:** 35 executed tests, one per authenticated
  `iam.`/`meta.` operation, each asserting `403` + `ERR-IAM-001`.
- **Same-tenant valid access:** the read surface answers 200 on the runtime identity
  and returns the addressed row.
- **Cross-tenant real-user-ID denial:** tenant B has its own administrator, role,
  grant, company and branch, so every "unreachable" assertion is about rows that
  genuinely exist; bidirectional for `iam.user-detail`.
- **No resource-existence leakage:** the denial document is asserted to carry the
  operation's _declared_ codes, never the caller's own failed subset, and to contain
  no resource identifier.
- **Deleting the evidence turns the gate red — verified on this tree:** removing the
  single token `cross-tenant` from one `COVERAGE-EVIDENCE` line produces
  `[FAIL] iam.user-detail … is missing required evidence [cross-tenant]`; restoring it
  returns the gate to green.

### P1-24-F-002 — public operations bypassed the canonical error pipeline · **Resolved**

- **Fix in the protected tree:** `src/server/http/route-handler.ts:288` —
  `return await handlePublic(operation, request, handler, options, correlationId);`
- **Every public operation enumerated on this tree:** 6 route files declare
  `public: true` — `iam.auth-login`, `iam.auth-logout`, `iam.auth-password-reset`,
  `iam.auth-password-reset-completion`, `shared.health-live`, `shared.health-ready` —
  and **all six dispatch through `handleOperation`**. There is no approved equivalent
  in use, because there is no exception.
- **Counterfactual on this tree:** removing the `await` fails three regression tests
  (`…answers a canonical problem document rather than rejecting`). Restored, green.

### P1-24-F-003 — the published contract understated its own scope · **Resolved**

- **Fix in the protected tree:** `src/server/openapi/document.ts:249` `describeSurface()`,
  used at `:273` as `summary: describeSurface(operations)`.
- **The contract's own self-description now reads:** "226 operations across 19 backend
  modules (billing, crm, delivery, diagnostics, iam, inventory, meta, payments,
  pricing, quality, quotation, reception, reporting, service-catalog, shared-services,
  technician, vehicle, warranty, work-order)."
- **Reproducible:** regenerating with `UPDATE_OPENAPI=1` and re-formatting leaves **no
  diff** on this tree.

### P1-24-F-004 — the last dependency waiver had outlived its cause · **Resolved**

| Requirement                         | Measured on `38d1ec2`                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm audit`                         | **0 vulnerabilities**                                                                                |
| Committed dependency exceptions     | **0** (`developmentAdvisories: []`)                                                                  |
| Committed licence exceptions        | **0**                                                                                                |
| Committed waiver entries            | **0** — history retained under `removedAdvisories` (1)                                               |
| Dependency policy gate              | **pass**                                                                                             |
| Synthetic fixtures prove every rule | `tests/ci/dependency-gate.test.ts` **33/33**                                                         |
| Previous ESLint-breaking override   | **not reintroduced** — `overrides` are `postcss`, `sharp`, `fast-uri` only; no `brace-expansion` key |

---

## 5. Database and migrations

|                                                     | Verified on `38d1ec2`                                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration count                                     | **119**                                                                                                                                         |
| First / last                                        | `0001_extensions.sql` / `20260730090000_crm_customer_notes_write_capability.sql`                                                                |
| Migration 120                                       | **absent**                                                                                                                                      |
| Historical migration diff vs the P1-24 base         | **0 files**                                                                                                                                     |
| Whole `supabase/` diff vs the P1-24 base            | **0 files**                                                                                                                                     |
| Schema hash                                         | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`                                                                              |
| Live tables                                         | 242 · policies 631 · foreign keys 537 · indexes 999                                                                                             |
| Tables with RLS enabled but **not** forced          | **0**                                                                                                                                           |
| `SECURITY DEFINER` functions in application schemas | **0**                                                                                                                                           |
| Application roles with `BYPASSRLS`                  | **none** — the single non-platform holder is `supabase_etl_admin`, a Supabase platform role                                                     |
| Structural review                                   | **PASS** — all FKs validated, no runtime-reachable destructive cascade, complete FK index coverage, no duplicate indexes, zero dictionary drift |

P1-24 added, changed, deleted and reordered **no** migration.

---

## 6. Contracts and coverage

Recalculated from the protected candidate, not carried forward.

| Measure                       | Protected value                                                      |
| ----------------------------- | -------------------------------------------------------------------- |
| Domains (modules) inventoried | **19**                                                               |
| Operations inventoried        | **226**                                                              |
| Covered                       | **226**                                                              |
| Partially covered             | **0**                                                                |
| Uncovered                     | **0**                                                                |
| Not applicable                | **0**                                                                |
| Blocked                       | **0**                                                                |
| OpenAPI paths                 | **195**                                                              |
| OpenAPI operations            | **226**                                                              |
| Unique operation IDs          | 226 of 226                                                           |
| Shared component schemas      | 3 (`ProblemDocument`, `Money`, `PageEnvelope`)                       |
| Published error codes         | 28 — the whole catalog                                               |
| Permission codes seeded       | 104                                                                  |
| Audit actions catalogued      | 153                                                                  |
| Domain events                 | 50 catalogued, 47 produced, 3 reserved, **0 foreign outbox writers** |

Proven on this tree: every public operation is classified; no operation has
invocation-only coverage; permission, scope and error-path evidence exists wherever the
registration creates the obligation; no documented route is missing an implementation
and no public route is undocumented (`validate:openapi` and
`validate:authorization-coverage` both OK); operation IDs are unique; and regenerating
the contract produces no unexplained diff.

`Covered` is **computed** from the union of evidence flags an operation's own tests
declare, measured against what its own registration derives. It is not assigned by a
human, and the register's ceilings on `Partially covered` and `Uncovered` are both 0.

---

## 7. Security posture

|                               | Protected value               |
| ----------------------------- | ----------------------------- |
| CodeQL **Critical**           | **0**                         |
| CodeQL **High**               | **0**                         |
| CodeQL Medium                 | **1**, pre-existing           |
| Secret scan (CI job)          | green                         |
| Dependency policy             | pass                          |
| `npm audit`                   | 0 vulnerabilities             |
| Container security            | green                         |
| Privilege-escalation findings | 1 — P1-24-F-001, **resolved** |
| File-security findings        | 0                             |
| **Open security blockers**    | **0**                         |

**The one Medium, reported accurately.** Alert **#33**, rule `js/http-to-file-access`,
`security_severity_level: medium`, `severity: warning`, at
`scripts/ci/check-commit-checks.mjs:252`. Created **2026-07-29**, first seen in
`refs/heads/main` — it pre-dates P1-24 and is in CI tooling, not application code. It
is **not** High and is not reported as such.

**Three different things, deliberately not conflated:**

1. **Hosted repository feature state.** GitHub **Dependabot alerts are DISABLED**
   (API 403) and **Secret scanning is DISABLED** (API 404). This is a repository
   setting the owner has not enabled, tracked as **`P1-21-A-01`** and still
   applicable. P1-24 does not claim these features are on.
2. **Custom CI security-job state.** The repository's own `dependency-security`,
   `secret-scan`, `code-security` and `container-security` jobs are all **green** on
   the protected merge SHA. These are what actually gate a merge here.
3. **Actual vulnerability findings.** 0 Critical, 0 High, 0 dependency advisories,
   0 secrets.

---

## 8. Risks

**These four are P1-20's risks, not P1-24's.** `RSK-24`…`RSK-27` are recorded in
`docs/phase-1/phase-1-20/evidence/open-decisions.md`; P1-24 owns no risk register of
its own and did not author them. They are carried into this integration gate because
P1-24's remit is the whole backend through P1-23, so their controls are re-exercised
here. Their wording below is the repository's, unedited.

| Risk                                                                      | Recorded disposition                                                                                                                                                                                                                                                                                                                                                   | P1-24 gate disposition                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RSK-24** — financial calculation drift between application and database | **Mitigated.** PostgreSQL is the only calculation engine; `insertItem` writes the CHECK constraints' own expressions with each parameter cast to its column's precision and scale, so the engine and the validator cannot disagree. `Decimal` performs no authoritative arithmetic and 34 unit tests pin values IEEE-754 gets wrong.                                   | **Holds.** `tests/unit/p1-20-decimal.test.ts` executes **34/34** at `38d1ec2`, and the whole P1-20 backend surface passes inside the 1752-test tier.                                                                 |
| **RSK-25** — commercial data exposed beyond its audience                  | **Mitigated.** The catalog read carries no price and that is asserted by scanning the whole response body; `svc.price.read` is `medium` risk; every branch-scoped read is authorized against a concrete target, including the case where the caller's grant union already contains the branch.                                                                         | **Holds.** The P1-20 service-catalog and isolation suites pass at `38d1ec2`; the derived floor now additionally requires `isolation` evidence wherever a registration declares company or branch scope.              |
| **RSK-26** — a customer charged for work they did not approve             | **Mitigated.** Decisions are per item and the first decision on a line is final; `presentedRevisionId` prevents approving a revision the client did not read; any rejected line makes the quotation rejected; the additional-work link refuses a superseded, draft, expired, rejected or undecided revision, and refuses one belonging to another work order or scope. | **Holds.** Re-exercised at `38d1ec2`, and strengthened at the seam: the P1-24 cross-domain journey proves an invoice with an open balance blocks the handover, and mutation **M6** fails if that blocker is removed. |
| **RSK-27** — an issued quotation changing after presentation              | **Mitigated.** `quo.guard_quotation_item` refuses item writes on a non-draft parent and `quo.guard_quotation_revision_freeze` freezes captured totals. Proven by republishing the price list at five times the amount after issue and asserting the stored columns for that revision do not move.                                                                      | **Holds.** Both protected guards are present in the live catalog and the P1-20 quotation suite passes at `38d1ec2`.                                                                                                  |

**One correction, made rather than repeated.** RSK-24's own text cites "34 unit tests".
An earlier revision said 32; P1-20's completeness audit recorded that as a
documentation error. Measured here at the protected SHA the file executes **34** tests,
so the current wording is right and this record does not perpetuate the old figure.

---

## 9. Open decisions

| Decision                                                                              | Classification                                                                                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Product name (`[PRODUCT NAME — Pending Final Approval]`, ADR-011)                     | **Decision-neutral for P1-24** — deliberately absent from the published contract                                                    |
| Scalability / production capacity (`NFR-SCL`, `P1-OD-027`)                            | **Accepted limitation** — no approved figure exists, so P1-24 records a baseline and claims no threshold                            |
| Currency minor units (P1-20)                                                          | **Decision-neutral for P1-24** — amounts stored and returned at column scale; no minor-unit rounding invented                       |
| Rounding mode and stage                                                               | **Resolved** in P1-10 by the schema; listed so a reader does not look for an open decision                                          |
| Malware / antivirus scanning of uploads                                               | **Accepted limitation** — no scanner exists; the document lifecycle states this and P1-24 does not soften it                        |
| Repository Dependabot and Secret-scanning settings (`P1-21-A-01`)                     | **Blocks a later phase only** — owner settings, not content; CI security jobs are green regardless                                  |
| Deployment, monitoring and alert routing                                              | **Accepted limitation** — nothing is deployed, so `NFR-OBS-001` is discharged for the code that exists, not for an operating system |
| `document.accepted`, `work-order.created`, `message.delivery.changed` reserved events | **Accepted limitation** — `implementedIn: null`, each with a structural reason in its own catalog comment                           |
| **Blocking P1-G24**                                                                   | **none**                                                                                                                            |

No product, tax, payment, retention, country or other business-policy decision was
resolved by assumption in this phase.

---

## 10. Task completion

| Group                                 | Complete  |
| ------------------------------------- | --------- |
| Backend (`P1-24-BE-001`…`014`)        | **14/14** |
| Security (`P1-24-SEC-001`…`004`)      | **4/4**   |
| QA (`P1-24-QA-001`…`005`)             | **5/5**   |
| DevOps (`P1-24-DO-001`…`002`)         | **2/2**   |
| Documentation (`P1-24-DOC-001`…`002`) | **2/2**   |

Per-task requirement, artifact and result are in
[`evidence/task-traceability.md`](evidence/task-traceability.md). Rows are marked
"verified, no gap" where the task was a verification rather than a delivery — which is
most of them, and saying so is more useful than inventing artifacts.

---

## 11. Governance

- The feature Pull Request was **merged by the owner through the protected workflow**,
  as a merge commit — the only method the ruleset permits.
- **This gate-record Pull Request (#152) was merged the same way**, by the owner, as a
  merge commit, on 2026-08-01T07:59:35Z. Its evidence is §12 and
  [`promotion-record.md`](promotion-record.md).
- **No direct push to `develop`.** **No direct push to `main`.**
- **No force-push** to any protected branch. The reviewed feature commit was not
  rewritten.
- **No `main` promotion at this gate.** `origin/main` was `db54acf1`, tree `973f32c1`,
  untouched throughout P1-24. Promotion is a separate founders' reserved decision
  (ADR-006) recorded in [`promotion-record.md`](promotion-record.md), not here.
- **No release. No tag. No deployment. No customer-data migration.**
- **No P1-25 work** — no branch, no pull request, no `docs/phase-1/phase-1-25`, and no
  P1-25 code in `src/`, `tests/`, `scripts/`, `.github/` or `supabase/`. Stated
  precisely, because the repository does mention the phase: `src/app/page.tsx` carries a
  comment saying the placeholder page "is replaced when real frontend work begins
  (Phase 1-25 onward)", and ADR-002, the ADR register, `phase-1-1/open-decisions.md`,
  the P1-13 plan and the OWASP ASVS matrix all defer frontend items to "Phase 1-25
  onward". Those are pre-existing **forward references**, none authored by P1-24 and
  none an implementation. The earlier phrasing "no reference" was too strong.
- **No migration was created**, and none may be created in this gate branch.
- **Zoom Vehicle Inspection and Evaluation Services remains excluded** from Phase 1.
- **Benzene remains a configurable first subscribed tenant and pilot**, never
  hard-coded as the platform owner — enforced by `security:scope-exclusions`, green.
- **The product name remains pending final approval** (ADR-011) and is deliberately
  absent from the published contract.

---

## 12. Decision

**Decision: Go — P1-24 Backend Integration and Release Gate Passed**

**As written on the gate branch, before that branch was merged:** this is the
**proposed technical decision** recorded on a documentation-only branch. It
rests on protected-SHA evidence: the merge tree is byte-identical to the reviewed tree,
all 17 protected-branch checks are green on `38d1ec2`, a fresh clone at that SHA passes
4676 tests with 0 failed and 0 skipped, the mutation matrix catches 6 of 6, migrations
are unchanged at 119 with the schema hash unmoved, coverage is 226/226 with nothing
partial or uncovered, and CodeQL reports 0 Critical and 0 High.

### Closure — the two conditions this record set, and how each was met

When this record was written on the gate branch it refused to claim closure, and set two
conditions instead. **Both are now met, and the evidence for each is recorded below
rather than asserted.** The paragraph above is kept word for word and labelled with when
it was written, rather than quietly rewritten into the present tense: a record that
edits away what it used to say is the failure this section exists to prevent.

| Condition set by this record                                              | Met | Evidence                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. the authorized owner merges this Pull Request into protected `develop` | ✅  | PR **#152**, merged by `Ezzaldeen-Albitar` 2026-08-01T07:59:35Z as merge commit `0b68b7c9a3d6eebacce88c40dc9951d9d99b5d66` — merge method `merge`, the only one the ruleset permits                                                                                                                             |
| 2. protected `develop` re-verified after that merge — **merge shape**     | ✅  | first parent `38d1ec22` (the feature merge), second parent `2bf135e6` (the reviewed gate commit); two parents, not a squash                                                                                                                                                                                     |
| 2. …**tree identity**                                                     | ✅  | merge tree `c6601886eddf36a4a67e4f6e62c78b449698a891` is **byte-identical** to the reviewed gate tree; the gate merge changed 2 files against the feature merge, both under `docs/phase-1/phase-1-24/`, and **0** executable, test, script, workflow, manifest, Supabase, migration or generated-contract files |
| 2. …**a green protected-branch CI run on the new merge SHA**              | ✅  | **17 checks, 17 success, 0 skipped, 0 failed** on `0b68b7c9`, including the `protected-gate` aggregate — runs `30690845932` (CI) and `30690846041` (Protected branch verification)                                                                                                                              |

**P1-G24 is therefore closed on protected `develop` with the decision above.** The
phase's own numbers were re-measured at `0b68b7c9` rather than carried forward: unit
**1288**, backend **1752**, database/RLS **1636**, total **4676**, 0 failed and 0
skipped; migrations **119** with no `120`; schema hash unmoved; 226/226 operations
Covered; mutation matrix 6/6.

Promotion of `develop` to `main` remains a separate, founders' reserved decision
(ADR-006). It is not part of this gate and is recorded in
[`promotion-record.md`](promotion-record.md).
