# Contributing

This repository belongs to **RootLco — Root Link Company** and contains the source, schema and planning material for the **[PRODUCT NAME — Pending Final Approval]** software product, temporarily described as the _Commercial Multi-Tenant Automotive CRM and ERP Platform_.

Repository classification: **Confidential — Commercial Product and Pilot Planning**.

| Role                                               | Holder                                        |
| -------------------------------------------------- | --------------------------------------------- |
| Technical and IT owner                             | Eng. Ezzaldeen Al-Bitar (`Ezzaldeen-Albitar`) |
| Product owners / final business approval (jointly) | Eng. Ezzaldeen Al-Bitar; Eng. Bilal Jradat    |

Every contribution must comply with the rules below. Where a rule and a convenience conflict, the rule wins.

---

## 1. Branch naming

All working branches are created from `develop`. Never from `main`.

Permitted prefixes:

| Prefix      | Use                                                       |
| ----------- | --------------------------------------------------------- |
| `feature/`  | New capability or module                                  |
| `fix/`      | Correction of defective behaviour                         |
| `chore/`    | Repository, tooling or housekeeping work                  |
| `docs/`     | Documentation-only change                                 |
| `test/`     | Test-only addition or correction                          |
| `refactor/` | Internal restructuring with no behavioural change         |
| `security/` | Security hardening, control implementation or remediation |

Branch names use lowercase, hyphen-separated words, and should carry the Phase 1 task identifier where one applies.

```
git checkout develop
git pull
git checkout -b chore/p1-01-development-readiness
```

Examples:

- `chore/p1-01-development-readiness`
- `docs/p1-01-doc-014-architecture-decision-register`
- `security/p1-01-sec-005-secret-scan`

## 2. Commit naming

Every commit message must reference the Phase 1 task it serves, using the canonical task identifier, a colon, a space, and an imperative summary.

```
P1-01-DO-002: add Docker local environment
P1-01-DOC-012: record the 22 entry criteria in the readiness checklist
P1-01-SEC-004: classify Phase 1 plan set sensitivity
```

Rules:

- The task identifier is mandatory. A commit that cannot be attributed to a task should not be made; raise the task first.
- The summary line is 72 characters or fewer, in the imperative mood, without a trailing full stop.
- A body may follow after a blank line and should explain intent and consequence, not restate the diff.
- Commits must state what was done. They must not assert that a gate passed, that an environment exists, or that an approval was granted.

## 3. Pull request process

- Pull requests target `develop`. Never `main`.
- `main` receives changes only through a reviewed promotion from `develop`, performed by the technical owner.
- One pull request addresses one task or one coherent group of tasks. Mixed, unrelated changes are rejected.
- The pull request must use the repository pull request template and complete every section of it.
- The description must list the Phase 1 task identifiers covered, the Definition of Done items satisfied, and any item deliberately left open.
- Review is required from the technical owner. Changes affecting architecture, schema, security posture or tenancy boundaries additionally require product-owner acknowledgement.
- Reviewers verify the rules in sections 5 to 12 of this document, not only code style.
- Review currently operates under the owner-approved
  [Solo Developer Review Policy](docs/governance/solo-developer-review-policy.md)
  (2026-07-16): the required approving-review count is temporarily **0** because the sole
  write-access collaborator is the author and GitHub does not count self-approval. The
  author performs and **documents** a technical self-review in the pull request; that
  self-review must never be presented as an independent review. Pull requests, successful
  CI, and conversation resolution remain mandatory.

**Status note (2026-07-16).** Branch rules were applied by the repository administrator and pull requests #1–#3 were merged through them. The build environment still has no GitHub CLI or API token, so ruleset changes and PR creation remain manual owner actions performed in the GitHub UI.

## 4. Required checks

The following checks must pass locally before a pull request is opened, and must be re-run by the reviewer:

| Check            | Purpose                                                     |
| ---------------- | ----------------------------------------------------------- |
| Lint             | Static style and correctness rules                          |
| Type-check       | TypeScript 5 strict mode, no errors, no suppressions added  |
| Unit tests       | All existing and new unit tests execute successfully        |
| Format check     | Prettier reports no differences (`npm run format:check`)    |
| SCSS style check | Stylelint passes with zero warnings (`npm run style:check`) |
| Production build | The Next.js production build completes                      |
| Dockerfile build | The container image builds from the repository Dockerfile   |

Rules:

- A check that has not been executed is reported as not executed. It is never reported as passing.
- Failing checks are fixed, not skipped, disabled or annotated away.
- `@ts-ignore`, `@ts-expect-error`, `eslint-disable` and equivalent suppressions require an explicit justification in the pull request and reviewer agreement.
- Independent QA ownership is **not assigned**. Technical tests are currently executed by Eng. Ezzaldeen Al-Bitar under the owner-approved [Solo Developer Review Policy](docs/governance/solo-developer-review-policy.md). This is a recorded, owner-accepted gap; it must remain visible in the risk record and must never be presented as independent verification.

## 4a. Styling rules

Sass/SCSS is the approved styling foundation (ADR-013; the full standard is
[docs/standards/styling-and-sass.md](docs/standards/styling-and-sass.md)). The rules below
are enforced by Stylelint where a machine can enforce them, and by review otherwise.

- Use `@use` / `@forward` only. Sass `@import` is deprecated and rejected by Stylelint.
- SCSS uses **relative** `@use` paths. The TypeScript `@/` alias is not reliable inside
  Sass under Turbopack and must not be used in stylesheets.
- Component styles live in scoped SCSS Modules (`ComponentName.module.scss`), never in
  global files. Business-module styles belong inside their module from Phase 1-2 onward.
- Consume design tokens (`var(--color-*)`, `var(--space-*)`, shared Sass variables)
  instead of hard-coding repeated colours, spacing, radii, or timing values.
- Direction safety: CSS logical properties only (`margin-inline-*`, `padding-inline-*`,
  `inset-inline-*`, `text-align: start`/`end`). Stylelint rejects the physical
  left/right forms. The `rtl`/`ltr`/`mirror-in-rtl` mixins are the documented escape
  hatch for cases logical properties cannot express.
- Maximum nesting depth is 2. `!important` requires a documented `stylelint-disable`
  comment explaining why.
- `npm run style:check` must pass (zero warnings) before every pull request.
- Do not introduce Tailwind CSS, shadcn/ui, or any other utility framework or component
  library without an owner decision — their adoption is Open (ADR-002). If adopted, the
  division of responsibility recorded in ADR-013 applies, and the same rule must not be
  duplicated across Sass, the framework, and inline styles without a documented reason.
- Brand colours are not approved. All colour tokens are neutral defaults pending design
  approval; do not invent brand values.

## 5. Definition of Ready

A task may be started only when all of the following hold:

1. The task has a Phase 1 identifier and appears in the approved Phase 1 task set.
2. The scope is stated in one sentence and the boundary of the task is explicit.
3. Acceptance criteria are written and verifiable.
4. Dependencies on other tasks are identified and either satisfied or explicitly accepted as a risk.
5. The task's effect on the database schema is known, and where schema change is required, the schema work is sequenced first (see section 8).
6. The task's effect on tenancy, Row-Level Security or configuration is known.
7. The documentation consequence of the task is identified (see section 9).
8. The task is within the current phase (see section 12).

## 6. Definition of Done

A task is done only when all of the following hold:

1. The change satisfies every stated acceptance criterion.
2. Schema and migrations precede and support the application code, and migrations apply cleanly to a fresh local database.
3. Row-Level Security policies exist and are exercised for every new tenant-scoped table.
4. All required checks in section 4 have been executed and pass, including the SCSS style check, and the styling rules in section 4a are satisfied.
5. Tests exist for the new behaviour, including at least one test asserting tenant isolation where tenant-scoped data is touched.
6. No secrets, credentials or tokens are present in the diff or in history.
7. No tenant-specific conditional logic is present (see section 10).
8. The Architecture Decision Register and the canonical Word documents are updated where the change alters architecture (see section 9).
9. The commit and pull request reference the correct task identifiers.
10. The pull request is reviewed and approved, and states honestly what was verified and what was not.

## 7. Security rules

- **No secrets are ever committed.** No passwords, API keys, service-role keys, tokens, connection strings, certificates, private keys or customer data. This applies to source, tests, fixtures, seed data, documentation, configuration, comments and commit messages.
- Secrets are supplied through environment variables and local `.env` files that are never tracked. Committed example files contain placeholder values only.
- A secret that reaches any branch is treated as compromised. Rotate it first, then remove it. Removal alone is not remediation.
- Every tenant-scoped table has Row-Level Security enabled and an explicit policy. A table without a policy is a defect, not an omission.
- Tenant identity is derived from the authenticated session and the tenant context. It is never taken from a client-supplied parameter that the client can freely set.
- Authorisation is enforced in the database and again in the application. The absence of a client-side route is not an access control.
- Dependencies are added deliberately and justified in the pull request.
- No fabricated compliance claims. Do not state or imply that any certification, audit, penetration test, attestation or accreditation has been achieved. None has. This applies to code comments, documentation, marketing text and commit messages alike (P1-01-SEC-005).
- Security ownership is not yet independently assigned; where this blocks a criterion, record it as blocking rather than closing it silently (P1-01-SEC-003).
- Suspected vulnerabilities are reported privately to the technical owner. They are not filed as public issues and not described in a public commit message.

## 8. Database-first rule

Schema and migrations precede application code. This is not a preference; it is the accepted implementation approach for this product.

Order of work for any change touching data:

1. Design the schema change: tables, columns, types, constraints, keys, indexes.
2. Write the migration. Migrations are forward-only, reviewed, and apply cleanly to a fresh local database.
3. Define Row-Level Security policies for every tenant-scoped table introduced or altered.
4. Add or update seed and configuration data.
5. Only then write the application code that consumes the schema.

Rules:

- The database is the authoritative definition of the data model. Application types are derived from the schema, not the reverse.
- Constraints, defaults, foreign keys and uniqueness are expressed in the database. Application-only validation is an addition to database constraints, never a substitute.
- A migration is never edited after it has been applied on a shared branch. Correct it with a new migration.
- A pull request that adds application code depending on a schema that does not yet exist in a migration is rejected.

## 9. Documentation synchronisation rule

Documentation is part of the change, not a follow-up.

- A code change that alters architecture must update the **Architecture Decision Register** (P1-01-DOC-014) in the same pull request. This includes changes to module boundaries, tenancy model, data model shape, authentication or authorisation approach, deployment topology, or any decision that a future contributor would otherwise have to reverse-engineer.
- An architectural change must also be reflected in the two canonical Word documents:
  - `RootLco_Phase_1_Development_Plan_recovered_v01.docx`
  - `RootLco_Master_Project_Documentation.docx`

  These documents live **outside this repository, in the parent folder, by owner decision** and are deliberately not committed. Git documentation is a working record; it is **never** a replacement canonical copy and must not be described as one.

- The pull request must state explicitly whether the canonical Word documents were updated, or record that the update is outstanding and who owns it. Silence is not acceptable.
- Where the repository and the canonical documents disagree, the disagreement is raised to the product owners for resolution. Contributors do not resolve it unilaterally in either direction.
- Documentation must not claim that a test passed, an environment exists, an approval was granted or a gate was cleared unless that is demonstrably true.

## 10. No tenant-specific hard-coding

The platform is multi-tenant, multi-company and multi-branch, and its behaviour is configuration-driven.

- **No tenant name may appear in a conditional.** Constructs of the form `if (tenant.name === 'Benzene')`, `if (tenantSlug === 'benzene')` or any equivalent are prohibited, in any language, in any layer, including SQL, migrations, seed logic, tests and styling.
- No tenant identifier, tenant slug or tenant UUID may be embedded as a literal in application logic.
- Differences in tenant behaviour are expressed as configuration, feature flags, policy rows or seed data — that is, as data the platform reads, never as branches the platform contains.
- **Benzene Vehicle Services (بنزين لخدمات المركبات)** is the **first customer, first subscribed tenant and first pilot**. It is onboarded through configuration and seed data only. Benzene is not the software owner, is not the platform owner, and is never hard-coded. RootLco is the company and platform owner.
- **Zoom Vehicle Inspection and Evaluation Services** is outside Phase 1. No Phase 1 code, tables, modules, APIs, migrations or workflows may be introduced for Zoom. A pull request that adds any of these is rejected regardless of quality.
- If a requirement appears to demand tenant-specific behaviour, the correct response is to model the required configuration surface, not to add a conditional. Raise it to the technical owner before writing code.

## 11. No direct push to main

- Protection of `main` is decided policy and was applied by the repository administrator (pull requests #1–#3 merged through it). No contributor pushes to `main` directly, and no contributor pushes to `develop` directly for substantive change.
- All work reaches `develop` through a pull request from a working branch, reviewed under the [Solo Developer Review Policy](docs/governance/solo-developer-review-policy.md).
- `main` is updated only by a reviewed promotion from `develop`, performed by the technical owner.
- History on `main` and `develop` is not rewritten. No force push, no amend of published commits, no rebase of shared branches.
- Enforcement note: the required-check names in the ruleset must match the names GitHub actually reports — see [github-required-checks.md](docs/phase-1/phase-1-1/github-required-checks.md). The live ruleset is administered in the GitHub UI; the build environment has no GitHub CLI or token and cannot inspect or change it.

## 12. Phase discipline

- The current phase is **Phase 1-2: Database Architecture and Engineering Standards**. Phase 1-1 closed with a recorded owner **Go** on 2026-07-16 ([gate record](docs/phase-1/phase-1-1/phase-1-1-owner-gate.md)).
- **Phase 1-3 has not started and must not start** until the owners record a Go or Conditional Go on the Phase 1-2 Database Standards Gate.
- Phase 1-2 establishes standards and shared foundation only: **no business-domain tables** (tenants, companies, branches, users, customers, vehicles, appointments, inspections, quotations, work orders, inventory, invoices, payments) may be created or merged during Phase 1-2.
- A Conditional Go carries conditions. Those conditions bind subsequent work and must be referenced in the pull requests that discharge them.
- Only the **Local** environment is being implemented. Development, Staging and Production are **Planned — not provisioned**. Docker-based local development is accepted by owner instruction.
- No cloud provider, production region or deployment platform has been approved. Any reference to one is **Proposed** or **Open**, never approved. Do not merge code, configuration or documentation that presumes an approved target.
- If a task is out of phase, it is not started. Raise it to the product owners instead.

---

## Reporting a problem with these rules

Where a rule blocks legitimate work, raise it with the technical owner rather than working around it. Rules are amended by decision and record, not by exception in a pull request.
