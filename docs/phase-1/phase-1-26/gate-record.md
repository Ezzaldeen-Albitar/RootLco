# Phase 1-26 — Authentication and Administration Frontend — gate record

**Classification:** Confidential — Commercial Product and Pilot Planning

|                         |                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| **Gate**                | P1-G26                                                                                                    |
| **Final decision**      | **Go — P1-26 Authentication and Administration Frontend Gate Passed** (§10)                               |
| **Protected `develop`** | `fd0c2324b38995aa700e0199dee40e04f4de0b19`                                                                |
| **Protected tree**      | `190466042180f26e4534874d1a4b1c393bbd248c`                                                                |
| **`main` at this gate** | `f085d82001a43de51725707426d5c10eb134c004` — unchanged; P1-26 is **not** promoted                         |
| **Base at branch**      | `3598de624dbc181b742cc40700464115ba5c4fc6` — the P1-25 closure SHA                                        |
| **Final feature PR**    | [#174](https://github.com/Ezzaldeen-Albitar/RootLco/pull/174), reviewed head `b2899d9b`, merge `fd0c2324` |
| **Migrations**          | 119 — none created, none modified                                                                         |
| **Schema hash**         | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — unchanged                            |

> This record is **documentation only**. It creates no executable change, and it
> is written **after** the work it attests to is on protected `develop` and
> verified there. A gate record that arrives with its own subject is a record of
> an intention, not of a fact.

---

## 1. What P1-26 delivered

Eighteen screens on the P1-25 foundation, composed from it and forking none of
it.

**Authentication** — login, forgot password, password reset, invitation, account
activation, profile, session expiration.

**Administration** — organization, users, roles, permissions, approval limits,
numbering rules, taxes, currencies, languages, audit log, system settings.

Product name **CRM**, resolved from the single brand authority and never written
in a component. Green `#1F6B52` as the action colour, navy `#0F2742` as the
structural surface. Arabic RTL and English LTR, decided by the server.

## 2. Tasks — 31 / 31

| Group         | Complete | Total |
| ------------- | -------- | ----- |
| Frontend      | 18       | 18    |
| Security      | 4        | 4     |
| QA            | 5        | 5     |
| DevOps        | 2        | 2     |
| Documentation | 2        | 2     |

Each with an acceptance condition and a named proof in `task-register.md`.
Ten carry a **recorded limitation** — the acceptance condition is met for
everything the platform publishes, and what it does not publish is named in
`findings.md`, stated in the interface, and listed in `known-limitations.md`.

## 3. The finding that justifies this gate's existence

**`P1-26-F-015`, critical, found by adversarial review and fixed before merge.**

Ten operations in P1-26's surface declare `idempotent: true`. The backend's route
handler calls `requireIdempotencyKey` unconditionally for each of them — before
permissions are evaluated — and answers `ERR-INT-002` (400) without one. **No
call site sent a key.**

Every invitation, lifecycle change, role edit, permission mapping, approval limit
and settings write would have failed **100% of the time** on first contact with a
real backend. The 400 maps to `validation`, so the operator would have seen a
generic "check the form" banner naming no field, on a form with nothing wrong
with it.

At the moment it was found: `verify:workspaces` green, typecheck green, ESLint
green, 287 web tests green, 1465 root tests green, the production build green,
and 106 browser assertions green.

It could not have been caught locally. The requirement lives on the far side of a
boundary no test in this repository crosses, because crossing it needs a real
account in a real tenant and the no-fake-data policy forbids seeding one. That
gap was already written down in `browser-evidence.md` §3 before the defect was
found — this is what it costs, measured.

Two more of the same character: a 403 on the session read cleared a **valid**
cookie and produced an unbreakable sign-in loop for any account without
`iam.user.read` (`F-022`); and the session cookie's `Secure` attribute **failed
open** because its environment variable defaulted to `local` (`F-023`).

## 4. Findings

Forty-four raised (`F-001` … `F-044`). **One Critical, eleven High** — all fixed.
**Seven Medium are accepted contract gaps**, each a capability the platform does
not publish, recorded with its disposition and stated in the interface. **One
Low remains open**: `F-012`, an unexplained DB/RLS observation in P1-5's
shared-services surface that P1-26 did not cause and did not patch.

Three findings were the **same mistake as this phase's headline work**, reached
from different directions — a fabricated total. `F-001` created the cursor mode
to prevent it; `F-018` printed a 200-row server cap as "the complete list"; and
`F-024` put the table into counted mode while loading, on the line directly below
a new comment explaining why the previous version was wrong. That is worth
recording plainly: knowing a rule is not the same as following it, and only the
adversarial pass caught the second and third.

### The last three, found after the phase was otherwise finished

`F-042`, `F-043` and `F-044` all arrived after the work was believed complete,
and none of them was found by the tier that was supposed to find it.

- **`F-042`** — a credential-shaped literal in the very test that asserts
  credentials must never be logged. Found by hosted CI, because `verify:policies`
  does not include `security:all`.
- **`F-043`** — sixteen unformatted `apps/web` files, which failed two CI jobs
  and the aggregate. The root `format:check` had been run and was green: it is
  configured to skip `apps/` entirely and is structurally incapable of reporting
  on the Frontend.
- **`F-044`** — a five-second test timeout that was measuring the machine's
  process scheduling. Found by the local clean room while **all twenty hosted
  checks were green on the same tree**.

Two of the three are one mistake said twice: a command's **name** was taken for
its **scope**. Both are now pinned by tests, and the clean room runs the formatter
and the secret scan it previously did not.

The third points the other way, and is worth stating in a gate record: the local
clean room found something twenty hosted checks did not, and hosted CI found two
things every local tier had passed. **Neither tier is a superset of the other.**

## 5. File ownership

Measured at the candidate against the protected base — **123 changed files, 0
violations**: `web=85 · docs=31 · tests=4 · tooling=2 · rootConfig=1`.

```
APPS_API_CHANGED_FILES=0      SUPABASE_CHANGED_FILES=0
MIGRATION_CHANGED_FILES=0     UNCLASSIFIED_CHANGED_FILES=0
GENERATED_TRACKED_FILES=0     NESTED_LOCKFILES=0
DUPLICATE_FRONTEND_AUTHORITIES=0
```

Those zeros are stronger than they read: `apiSource`, `apiConfig`, `supabase` and
`migrations` are **absent from the report entirely** — no file classified into any
of them — rather than present with a count of zero.

`apps/api` remains Backend/API-only — 196 route handlers, unchanged.
`apps/api/src/app/api/**` remains the approved Route Handler namespace.

## 6. Verification

Clean room, from a fresh `git clone` at the exact candidate SHA with a clean
`npm ci`, tree byte-identical to the working tree:

| Check                                               | Result                                |
| --------------------------------------------------- | ------------------------------------- |
| Lockfiles / tracked generated output                | **1** root lockfile · **0** files     |
| Repository policies                                 | **exit 0** — 10 gates                 |
| Formatting, all three scopes                        | **exit 0**                            |
| `security:all` — secrets, pilot scope, no-fake-data | **exit 0**, 1800 tracked files        |
| Phase ownership                                     | **exit 0** — 123 files, 0 violations  |
| Root / CI-contract                                  | **1474 / 1474**, 68 files             |
| Web unit / component                                | **313 / 313**, 16 files               |
| `verify:api` · web typecheck · lint · stylelint     | **exit 0**                            |
| Production build                                    | **exit 0**, 21 routes                 |
| Migrations                                          | **119** — none created, none modified |
| Git state at the end                                | **clean**                             |

Browser: **106 passed · 0 failed · 4 skipped**, on pinned chromium and again on
installed Google Chrome. The 4 skips are one project-scoped test declining the
four projects it does not apply to; it runs and passes in `reduced-motion`.

The full feature-head figures, and the two hosted runs that were **red**, are in
`evidence/test-register.md` and `ci-evidence.md`. Both red runs are recorded
there with their causes rather than omitted.

### The protected merge, verified on the protected ref

| Check                                          | Result                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Exact-head CI on the reviewed head `b2899d9b`  | **20 checks, 20 success, 0 failure**                                                                              |
| Merge method                                   | **merge commit** — `fd0c2324` has **two** parents, `3598de62` and `b2899d9b`                                      |
| Merged tree vs reviewed tree                   | `190466042180f26e4534874d1a4b1c393bbd248c` — **identical**; the merge introduced nothing beyond the reviewed head |
| `apps/api` diff vs base                        | **0 files**                                                                                                       |
| `supabase/` diff vs base                       | **0 files**                                                                                                       |
| `supabase/migrations` diff vs base             | **0 files**                                                                                                       |
| Total changed vs base                          | **123 files**                                                                                                     |
| Ownership gate re-run **on the protected ref** | **exit 0** — 123 files, 0 violations                                                                              |
| Migrations on `develop`                        | **119**                                                                                                           |
| `main`                                         | `f085d820` — **unchanged**                                                                                        |
| CodeQL open alerts                             | **0** on `develop`, **0** on `main`, **0** repository-wide                                                        |
| Branches or files matching `p1-27`             | **0**                                                                                                             |
| Tags                                           | one, `release-2-database-baseline` — none created                                                                 |

Authorship of every commit the merge introduces is
`Ezzaldeen-Albitar <ezzaldeenalbitar9@gmail.com>` — one identity across all ten.
The merge commit itself is authored by the Owner's GitHub identity with `GitHub
<noreply@github.com>` as committer, which is what the platform records for any
merge performed through the API or the web interface; it is the same shape as the
P1-25 merge. **No `Co-authored-by` trailer and no assistant, bot, automation or
vendor name appears in any commit message or authorship field on this branch.**

## 7. Governance statements

- P1-25 was formally closed before P1-26 began.
- `apps/api` is Backend/API-only; `apps/web` is the only Frontend workspace.
- No hidden Backend development. No Database or migration development.
- No historical migration was modified; no migration was created. Migrations
  remain **119** and the schema hash is unchanged.
- No Frontend duplication: one design system, one table, one form system, one API
  client, one i18n authority, one brand authority, one colour authority, one
  session authority.
- No generated build output was committed.
- No direct push to a protected branch. No force push. No squash merge. No rebase
  merge.
- **Authorship is the Owner's alone.** All ten commits on the feature branch
  carry `Ezzaldeen-Albitar <ezzaldeenalbitar9@gmail.com>` as **both** author and
  committer — one distinct identity across the branch. The merge commit is
  authored by the Owner's GitHub identity
  (`123809664+Ezzaldeen-Albitar@users.noreply.github.com`) with `GitHub
<noreply@github.com>` as committer; that is what the platform records for any
  merge performed through the API or web interface, and it is the same shape as
  the P1-25 merge. Stated precisely rather than rounded to "the Owner
  throughout", because the committer field genuinely is not. No
  `Co-authored-by` trailer, and no assistant, bot, automation or vendor name
  appears in any commit message or in any authorship field.
- No `main` promotion. No deployment, release, tag, or customer migration.
- **Two untracked image files** (`apps/web/public/Generated_logo.png`,
  `Generated_NameLogo.png`) appeared in the Owner's checkout during this cycle.
  They are referenced by nothing, were not authored as part of P1-26, and are
  **deliberately not committed** — they remain untracked on disk. Committing an
  unreviewed brand asset into a phase whose brand decisions are Owner-gated is
  precisely the kind of thing that must not happen silently. Flagged for the
  Owner in §10.
- RootLco is the **company**, never the product name. Benzene is a configurable
  pilot tenant and appears nowhere as an identity or a default. Zoom remains
  outside Phase 1.
- **No P1-27 branch, pull request, documentation or implementation exists.**

## 8. Known limitations carried forward

Eleven, in `known-limitations.md`. The load-bearing ones: no silent session
renewal, because there is no refresh operation; five screens are settings-backed;
companies and branches show as references rather than names; profile is read-only
without an administrative permission; no audit export; monitoring has an adapter
boundary and **no external service is claimed to be operational**.

**Three things are not proven, and are stated as not proven**: cross-tenant
behaviour end to end, the eleven administration screens in a browser, and an
automated accessibility scan of those screens. All three need a real account in a
real tenant. `P1-26-F-015` is what lives in that space, and it is the reason the
gap is named rather than glossed.

## 9. The Owner decisions this gate rests on

| Decision         | Value                                                                            | Closes    |
| ---------------- | -------------------------------------------------------------------------------- | --------- |
| Product name     | **CRM** — temporarily approved working name                                      | OIR-01    |
| Primary green    | **#1F6B52**                                                                      | OIR-06    |
| Primary navy     | **#0F2742**                                                                      | OIR-06    |
| Neutrals         | **#FFFFFF**, **#000000**                                                         | OIR-06    |
| Visual direction | soft, elegant, premium, modern, user-friendly, rich in tools but never cluttered | OIR-06    |
| Prototype basis  | the approved P1-25 design system itself; no separate package required            | P1-EC-006 |

**Eight decisions remain open** (`OD-001` … `OD-008` in `open-decisions.md`).
None of them blocks this gate: each is a naming or policy choice the
implementation is deliberately neutral about, and the neutrality is
what is being gated. `OD-001` — the settings key namespace — is the one to
ratify first, because five screens read it.

## 10. Decision

**Go — P1-26 Authentication and Administration Frontend Gate Passed.**

Recorded against protected `develop` `fd0c2324b38995aa700e0199dee40e04f4de0b19`,
tree `190466042180f26e4534874d1a4b1c393bbd248c`, after PR #174 was merged by
`Ezzaldeen-Albitar` **as a merge commit** on a reviewed head that was green on
all 20 exact-head checks, and after the protected ref was re-verified: two
parents, an identical tree, zero `apps/api` / `supabase` / migration diff, the
ownership gate re-run on the protected ref, and `main` untouched.

**P1-G26 is therefore closed.**

### What the Owner is asked to note

- **Eight decisions remain open** (`OD-001` … `OD-008`). None blocks this gate;
  `OD-001`, the settings key namespace, is the one to ratify first because five
  screens read it.
- **Two untracked PNG files** — `apps/web/public/Generated_logo.png` and
  `Generated_NameLogo.png` — appeared in the working checkout during this cycle,
  are referenced by nothing, and were **not** committed. If they are intended as
  brand assets they need an explicit decision, because the brand authority is
  Owner-gated; if they are not, they can be deleted.
- **Three things this phase does not prove** are named in §8. They are not
  oversights; they need a real account in a real tenant, which the no-fake-data
  policy forbids seeding. `P1-26-F-015` is the measured cost of that gap.

P1-27 is **not** started: no branch, no pull request, no documentation, no
implementation, and no tag was created.
