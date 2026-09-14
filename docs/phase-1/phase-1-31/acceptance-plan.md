# P1-31 — fresh-organisation acceptance plan

**Status:** the harness is **AUTHORED and NOT EXECUTED**. Nothing in this document reports a
measurement. No organisation has been provisioned, no report has been run, no browser has been
opened, and no gate is claimed to have passed against a running system. The only things measured on
this branch are the static checks listed in §8, and they are checks on the source of the harness —
not on its behaviour.

**Authority:** the canonical chapter's Field 16 task **P1-31-QA-005** (regression and evidence
packaging) and rule 2 of [`task-matrix.md`](./task-matrix.md): no P1-31 task reaches
`end-to-end verified` until a phase acceptance record exists. This plan is what such a record would
be produced by; it is not that record.

**Precedent:** [`../phase-1-30/w9-acceptance-record.md`](../phase-1-30/w9-acceptance-record.md).
That record's §2 is a 71-step HTTP journey and its §5 states how it was driven. Its harness and its
browser spec were **session artefacts** and were never committed, so nobody could re-run them. This
phase commits both, which is the one deliberate difference: an acceptance that cannot be repeated
evidences the day it ran and nothing after it.

**Artefacts this plan describes**

| artefact                                                                    | what it is                                                                 |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `orchestration/acceptance/p1-31-journey.mjs` (outside the repository, §1.7) | the HTTP journey, its refusal cases, and the evidence it writes            |
| `apps/web/tests/e2e/authenticated/p1-31-handoff.ts`                         | how the browser half reads the world the HTTP half made                    |
| `apps/web/tests/e2e/authenticated/delivery-p1-31.spec.ts`                   | the readiness queue, the handover record, the printable copy               |
| `apps/web/tests/e2e/authenticated/warranty-p1-31.spec.ts`                   | the warranty list, the record with its ledger, and the plans screen        |
| `apps/web/tests/e2e/authenticated/reports-p1-31.spec.ts`                    | the catalogue and all four report screens                                  |
| `apps/web/tests/e2e/authenticated/audit-log-p1-31.spec.ts`                  | the audit log over this journey's own writes                               |
| `apps/web/tests/e2e/authenticated/overview-p1-31.spec.ts`                   | the operational overview — FE-010, and FE-016 by the address               |
| `apps/web/tests/e2e/authenticated/account-manifest.json` (generated)        | what each of the two credential kinds holds, so a case can pin one outcome |

---

## 1. Preconditions

### 1.1 The merges this acceptance required — all four are now on `develop`

When this plan was written the harness called operations that were not all on protected `develop`,
and this section listed the four branches that carried them. **All four are merged.** Re-measured on
protected `develop` **`811e9891353b466b7788e7ca8a7bddee8496de72`**, which is where each of them
landed. This branch has since taken a second merge of `develop` at
**`72782f489dd2412a3c3be46c65936252fc68ab00`** — the operational overview, PR #376 — and that head
carries everything below unchanged:

| #   | what the journey needs                                                                                                   | where it now lives on `develop` `811e9891`                      |
| --- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 1   | `org.employee-create` / `org.employee-list` / `org.employee-status-set`, `deliveringEmployeeId` on `sal.delivery-create` | P-17, change-control section 41; two migrations; bundle 76 → 78 |
| 2   | the four dataset definitions and the `rpt.report-run` engine behind them                                                 | P-11, sections 40 and 45 to 47                                  |
| 3   | the warranty plans screens (`/warranty/policies`)                                                                        | section 48                                                      |
| 4   | the report catalogue and the report screens (`/reports`, `/reports/{reportCode}`)                                        | section 50                                                      |

So the acceptance is taken against a build of `develop` itself plus this branch, and no integration
head has to be assembled first. Two consequences of that, because each turns a silent absence into a
loud one:

- **The bundle count is still the check, and it is no longer conditional.**
  `apps/api/src/modules/iam/domain/bootstrap-roles.ts` declares **78** codes on `develop`
  `811e9891`. The harness asserts 78 on the session read (step group 2), so a build that has somehow
  lost P-17 fails at step 18 rather than forty steps later with an unexplained refusal.
- **The two message-catalogue conditions are now regression guards rather than live skips.** The
  warranty-plans and report cases ask whether the screen's own strings exist —
  `warranty.policies.title` and `reports.catalogue.title` — and both resolve in `en.json` and
  `ar.json` at this head, so both sets of cases run once a handoff is present. The conditions are
  kept because a skip that states its reason is the honest answer if a screen is ever withdrawn, and
  because they do **not** assert a 404, which also passes on a build that is merely broken.

### 1.2 The shared local database — the operator steps are DONE

This section previously described a migration path an operator still had to walk. **It has been
walked.** The evidence is outside the repository, at
`orchestration/evidence/p1-31/p17-operator-20260912/`, whose `README.md` records each step with the
raw output of every command beside it:

| what the plan required                            | state on the shared local database                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| the migration ledger reconciled, never by a reset | 13 versions repaired, then the two P-17 migrations applied, each in its own transaction |
| the applied count                                 | **141**, equal to the 141 `supabase/migrations/*.sql` files in this tree                |
| the permission catalogue                          | **121** codes, from the declared seed `supabase/seeds/04_iam_permission_catalog.sql`    |
| the tenant administrator bundle                   | **78**, backfilled from 76 across every organisation that held it                       |

**Never `supabase db reset`.** It destroys the acceptance environment, which is a recorded standing
trap, and it is no less true now that the ledger is straight than it was before. An operator who
finds the counts disagreeing with the four above should read the evidence directory first: the tree
under test is then not the tree this plan describes, and the disagreement is the finding.

### 1.3 Exclusivity

`npm run test:db` and `npm run test:backend` **delete tenants by code prefix on this same shared
database**. Neither may run while the acceptance is in flight, in any worktree. The harness's own
organisation codes are `p31_journey_a_<stamp>` and `p31_journey_b_<stamp>`, which match no suite
prefix (`fx_`, `zz_mgmt_`, `w5_`, `acceptance_`) — that protects the journey's rows from a suite that
starts, and it does not protect the journey from a suite that truncates a table it happens to share.
One acceptance at a time, and nothing else against the database while it runs.

### 1.4 The mailbox

Every credential in this journey is established through the product's own reset or invitation
completion route, with the link read out of the local mailbox exactly as a person would click it.
The mailbox is the local SMTP service on **54324** (`supabase/config.toml`, `[local_smtp]`), and the
harness reads its URL from `supabase status` rather than hard-coding it. If the mailbox is not
running, the harness refuses before it writes anything.

### 1.5 Ports and the build

A **production build**, never `next dev`: a development server manufactures phantom 401s and hides
the hydration and bundle problems the browser half exists to catch.

| service                      | port  | how                                                                  |
| ---------------------------- | ----- | -------------------------------------------------------------------- |
| local database               | 54322 | `npm run supabase:start`                                             |
| local mailbox                | 54324 | the same stack                                                       |
| API                          | 3000  | production build, `--hostname localhost`                             |
| web, for a human to click    | 3100  | `npm run acceptance:serve`, the P1-30 arrangement                    |
| web, for the Playwright tier | 3210  | a **second** `next start`, which `apps/web/tests/e2e/origin.ts` owns |

The second web server on 3210 is the P1-30 approach and is deliberate: the browser tier gets its own
`next start` so that it can never contend with the human-facing server for a port or a build
directory. `apps/web/.env.local` must be present when the build is produced — without it
`NEXT_PUBLIC_APP_ENV` defaults to `production`, the session cookie is marked `Secure`, and a
plain-HTTP localhost discards it silently, so every authenticated case fails as though authentication
had regressed.

### 1.6 The genesis operator

Only an account holding `platform.organization.provision` may provision an organisation. That
account is created by `scripts/platform/genesis-platform-operator.mjs`, and the harness takes its
address from `GENESIS_OPERATOR_EMAIL` (or `ROOTLCO_P131_OPERATOR_EMAIL`). The harness does not create
it, does not elevate anything, and refuses when the address is absent or malformed.

### 1.7 Where the HTTP harness lives, why it is outside the repository, and how it is invoked

**The harness is NOT committed.** It lives beside the phase evidence, outside any git working
tree:

```
1millions/orchestration/acceptance/p1-31-journey.mjs
```

**The precedent is P1-30, and it is the same shape.** Section 5 of
[`../phase-1-30/w9-acceptance-record.md`](../phase-1-30/w9-acceptance-record.md) records that
phase's HTTP driver as `acceptance-p1-30-journey.mjs`, a **session artefact**, with only the
record committed. This phase keeps the browser half committed — the four specs execute in
continuous integration and are proper repository tests — and holds the HTTP driver outside, which
is a narrower version of the same arrangement rather than a departure from it.

**The engineering reason is specific and worth stating, because it is not squeamishness.** An
evidence writer is by construction a path from API responses to the filesystem. CodeQL reports
that as `js/http-to-file-access`, and it is right to: the harness records what the server
answered. The repository's policy in `.github/ci-baselines/codeql-baseline.json` is
`maximumOpenFindings: 0` with an **empty** `dismissals` array, and its own note records that the
one dismissal this repository ever held was removed because the finding was _fixed_. Two rounds of
real fixes closed five of the seven alerts this harness raised — an unguessable `mkdtemp`
directory, `0o700`/`0o600`, `wx` on the credential file, backslash-first escaping, and a
sanitising barrier on every value that reaches disk — but the last two are the network-to-file
edge itself, which only disappears if the evidence disappears.

So the choice was: dismiss a finding, delete the evidence the acceptance exists to produce, or
hold the driver where the scanner does not analyse it. **The third, on the P1-30 precedent.** The
two findings are resolved by RELOCATION, not by dismissal: no entry was added to `dismissals`, no
rule was relaxed and no suppression was written. Every guard, fix and hardening listed above
travelled with the file unchanged.

**What is committed, then:** the four browser specs, this plan, and — after the run — the
acceptance record. That is the P1-30 division exactly.

**How it is invoked.** Because the file no longer sits inside the tree, it cannot infer the
repository root from its own location, and it needs one for three things: the two modules it
borrows (`context.mjs`, `dev-config.mjs`), the guard that keeps the evidence directory OUT of the
working tree, and `readSupabase`. So the root is stated, not guessed:

```
set ROOTLCO_ENV=local-acceptance
set ROOTLCO_ACCEPTANCE_CONFIRM=p1-31
set GENESIS_OPERATOR_EMAIL=<the genesis platform operator's address>
set ROOTLCO_REPO=<the checkout under test>          rem or pass --repo <path>
node ../../orchestration/acceptance/p1-31-journey.mjs
```

`ROOTLCO_REPO` defaults to the conventional sibling layout, `1millions/RootLco`. A root that does
not carry `supabase/config.toml`, `context.mjs` and `dev-config.mjs` is refused with exit code 2
and the missing paths named, rather than failing half-way through a run.

**The guards are unchanged.** Three independent ones — `ROOTLCO_ENV`, a loopback database on
54322, and the phase confirmation — any one failing refuses the whole run with exit code 2. There
is deliberately **no npm script**, and now there could not be one: `validate:command-coverage`
would move, and a script cannot name a file the repository does not contain.

---

## 2. The journey, as authored

Fifteen sections, in this order. Each numbered step records `{n, opId, method, path, status,
correlationId, expected, ok, detail}`. An unexpected status is a **finding** and the run continues:
a harness that stops at the first surprise records one fact and hides every fact after it. A step
that cannot produce a value a later step needs records a `BLOCKED` row and abandons **that section
only**, so the isolation probes and the audit read still answer for themselves.

| §   | section                                  | what it establishes                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | platform operator and two organisations  | operator credential through the reset route and the mailbox; `platform.organization-provision` twice; activation through the status route when provisioning did not activate; both owners' credentials and logins                                                                                                                                                                                                                                                                       |
| 2   | session and branch                       | the first administrator holds **78** permission codes; the branch list answers one branch, and its company and branch ids are the scope everything below uses                                                                                                                                                                                                                                                                                                                           |
| 3   | service catalogue and pricing            | a published service, a published price list assigned to the branch, and a price the **server** resolved. Not P1-31's surface, and here because without a priced line the invoice carries no amount and the financial blocker is vacuous                                                                                                                                                                                                                                                 |
| 4   | inventory and opening stock              | category, unit looked up by its seeded code, item, warehouse, storage place, opening batch, a line, the maker≠checker refusal, a second person invited and activated through the shipped routes, the approval, on-hand, and one `opening` movement                                                                                                                                                                                                                                      |
| 5   | customer, vehicle, reception, work order | the P1-30 steps 45–52 chain, plus the `authorized_receiver` party role recorded on the **visit** — `sal.guard_authorized_receiver` reads the visit's roles, not the delivery's                                                                                                                                                                                                                                                                                                          |
| 6   | the people and the work                  | an **active** employee (the person who will hand over), a technician profile, a job, an assignment, a **closed** labour session, a work log, job → `done`, work order → `completed`. Every one of those transitions is `versionGuarded`, so each sends the counter the write or read that last touched **its own row** answered — and the work order is re-read immediately before its completion, because nothing on the journey has answered its counter since the conversion made it |
| 7   | quality control                          | a QC record opened, its checks answered, and the record finalised **passed**. An opened record carrying no checks is stated as a note rather than asserted either way                                                                                                                                                                                                                                                                                                                   |
| 8   | invoice, receipt, allocation             | service line, preview, invoice created with an explicit `payerPartnerId`, issued against the **invoice's** record version, cash method found by code, receipt, allocation, outstanding **zero**. Every amount is the decimal string the server published                                                                                                                                                                                                                                |
| 9   | work-order closure                       | closure eligibility, then `{ "toState": "closed" }` with `If-Match`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 10  | handover configuration                   | a checklist template with **two mandatory items**, set **active**; a warranty policy with a coverage window, plus a second service-only window                                                                                                                                                                                                                                                                                                                                          |
| 11  | the handover                             | readiness queue with the **four work-order facts established**; delivery opened; the three inline refusal cases; receiver verified; a signature document authorized, stored and registered, then bound; both checklist items recorded; eligibility clear; completion with the final odometer as a **decimal string**; `delivered`; status history                                                                                                                                       |
| 12  | warranty                                 | `wty.warranty-generate` under the named policy; the branch list carries it; the detail carries its terms; the plans list reads                                                                                                                                                                                                                                                                                                                                                          |
| 13  | reports                                  | a tenant configuration created, a version created with `parameterSchema` **omitted**, published, status set; the catalogue offers all four codes; all four run over a **half-open** day period                                                                                                                                                                                                                                                                                          |
| 14  | the audit trail                          | the log for the branch carries `sal.delivery.completed` and `wty.warranty.issued` — the two `auditAction` values the last two writes declare                                                                                                                                                                                                                                                                                                                                            |
| 15  | refusal cases                            | §4 below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### 2.1 Four contract details the harness gets right and a reader would get wrong

- **`finalOdometerValue`, not `odometerValue`.** `sal.delivery-complete`'s body names
  `finalOdometerValue`, an unsigned decimal string with at most two decimals, and `odometerUnit` is
  optional (`sal.complete_delivery` defaults to `km`). The harness sends `'12345.6'` and `'km'`.
- **`If-Match` on the price-list version CREATE and on the publish is both times the LIST's record
  version**, not the version's. The P1-30 W2 record names the trap for the publish; the create is
  `versionGuarded` in exactly the same way and against the same row. Neither write bumps the list's
  counter — `requireLockedList` compares it and refuses, and does not write — so both send the figure
  the list create answered. Sending the version's own counter answers 409.
- **`parameterSchema` is omitted on the configuration version, not sent empty.** The filter
  allow-list it carries must not be empty (`empty_filter_allowlist`), and omission is the shape that
  means "this configuration declares no tenant filter vocabulary".
- **`tech.labor-session-stop` is `versionGuarded` and NOT idempotent**, the only operation on this
  journey with that combination. It therefore carries an `If-Match` and deliberately carries no
  `Idempotency-Key`: the platform requires the header only for an operation that declares
  `idempotent: true`, and sending one here would put a replay guarantee into the evidence that this
  write does not offer. Every other guarded write on the journey takes both.

---

## 3. The browser matrix

Driven through the repository's own authenticated Playwright projects, signing in through the
product's own login form via `auth.setup.ts`. The author types no credential: the harness writes one
handoff document outside the repository and the specs read its path from `ROOTLCO_P131_HANDOFF`.

```
set ROOTLCO_P131_HANDOFF=<the handoff.json path the harness printed>
npm run test:e2e:authenticated
```

| spec                      | case                                                                       | `authenticated-en` | `authenticated-ar` |
| ------------------------- | -------------------------------------------------------------------------- | ------------------ | ------------------ |
| `delivery-p1-31.spec.ts`  | the readiness queue answers for every row it shows                         | yes                | yes                |
| `delivery-p1-31.spec.ts`  | the handover record shows its own facts                                    | yes                | yes                |
| `delivery-p1-31.spec.ts`  | the printable copy is produced and prints exactly once                     | yes                | yes                |
| `warranty-p1-31.spec.ts`  | the branch's warranty list carries the generated warranty                  | yes                | yes                |
| `warranty-p1-31.spec.ts`  | the warranty record shows its terms and what it covers                     | yes                | yes                |
| `warranty-p1-31.spec.ts`  | the warranty record shows the transition ledger the journey recorded       | yes                | yes                |
| `warranty-p1-31.spec.ts`  | the warranty plans screen lists the plan                                   | yes                | yes                |
| `reports-p1-31.spec.ts`   | the catalogue offers all four datasets                                     | yes                | yes                |
| `reports-p1-31.spec.ts`   | each of the four reports renders the rows the server answered (four cases) | yes                | yes                |
| `audit-log-p1-31.spec.ts` | the log records the completion and the warranty issue                      | yes                | yes                |
| `audit-log-p1-31.spec.ts` | the log offers no export, and says why                                     | yes                | yes                |
| `overview-p1-31.spec.ts`  | the four sections carry the figures the server published (FE-010)          | yes                | yes                |
| `overview-p1-31.spec.ts`  | the overview fixed to a branch by the address shows that branch (FE-016)   | yes                | yes                |

### 3.0 What runs in continuous integration, and what waits for a handoff

The cases above are the ones that need the world the HTTP half makes. They are not the whole
suite, and they must not be: a spec file that executes nothing in the governed job is a spec file
nobody would notice breaking, and the job's own zero-executed-test step fails **per file** for
exactly that reason.

So every one of the four files also carries at least one case that runs on the governed job's own
environment and asserts what that environment genuinely provides. That environment is not a
guess — `.github/workflows/_reusable-authenticated-browser.yml` stands a Supabase stack up,
applies every migration and seed, runs `npm run acceptance:create-owner` to make Tenant A, Tenant
B and the acceptance owner, builds and serves both applications, and signs in through the
product's own login form. The owner's permission set is `OWNER_PERMISSIONS` in
`scripts/dev/owner-acceptance/context.mjs`, and **what it holds and what it withholds is the
assertion**:

| spec                      | case that runs WITHOUT a handoff                                                     | what the environment provides, and what is therefore proved                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delivery-p1-31.spec.ts`  | the readiness queue is reachable, and idles with its reason stated                   | the owner holds all three of `sal.delivery.view`, `wo.work_order.read` and `sal.finance.view`, so the conjunction passes; the tenant has no work order, so the screen must state one of its two idle reasons rather than render a blank region |
| `warranty-p1-31.spec.ts`  | both warranty screens answer exactly what the signed-in account is entitled to       | the owner holds `wty.warranty.read` and **not** `wty.policy.manage`, so both pages render and the create panel beside them does not — the over-grant-by-omission that `wty.warranty.read` was minted to end, caught in the same render         |
| `reports-p1-31.spec.ts`   | the catalogue and the run screen answer what that account is entitled to (two cases) | the owner does **not** hold `rpt.report.read`, so both pages render their own title and the shared denial, and leak no part of the catalogue or the run form — the only browser proof that the gate runs BEFORE the read                       |
| `audit-log-p1-31.spec.ts` | the log offers no export, and says why                                               | the owner holds `iam.audit.view`, so the page renders; the absence of an export is a property of the screen and never needed journey data, and gating it on the handoff was a mistake this branch corrects                                     |
| `overview-p1-31.spec.ts`  | the overview answers exactly what the signed-in account is entitled to               | the owner does **not** hold `rpt.report.read`, which is the code this page tests before it reads anything, so the whole body is withheld and no summary section is drawn — FE-010's gate, proved in a browser                                  |

**The division is the rule, not a convenience.** A case is behind the handoff when, and only when,
it asserts on a record the journey made — a specific delivery id, a generated warranty, a report's
row count, an overview section's summary. Everything else — navigation reachability, permission
gating in both directions, the honest empty and denied states, locale and text direction — is
asserted unconditionally, because the governed job can answer for all of it today. Each remaining
skip states its own reason in the run output rather than deferring to a shared one.

**Every unconditional case pins ONE outcome, chosen by which credential signed in.** Two accounts
reach these screens and they hold different codes, and the cases used to answer that by accepting
either the surface or a complete refusal — which passes whichever way the screen answers and so
cannot fail for the reason it exists. Instead `auth.setup.ts` derives WHICH account signed in from
the address it actually used and writes `account-kind.json` beside the storage state; the codes each
kind holds are generated into `apps/web/tests/e2e/authenticated/account-manifest.json` from
`OWNER_PERMISSIONS` and `TENANT_ADMINISTRATOR_ROLE`, and are checked against both authorities by
`tests/ci/p1-31-account-manifest.test.ts`. An address the setup cannot place is a hard failure
there; no case defaults a kind. The handoff-gated cases carry a second gate for the same reason:
they run only when the browser is signed in as the organisation administrator whose records they
are about.

Twenty-one cases per project, forty-two in total, plus the sign-in setup. The specs are **not** added to
`authenticated-tablet`: that project's rule is that a document obliges the surface to work at tablet
width, and no document does for these screens.

### 3.1 What only the browser establishes

- **Direction.** `authenticated-en` drives `/en` and `authenticated-ar` drives `/ar`, and every case
  asserts the document direction — `rtl` for Arabic, `ltr` for English. On the printable copy it is
  the **computed** direction, because `PrintDocument` carries no `dir` of its own and inherits from
  the locale layout; asserting an attribute nobody writes would assert nothing.
- **The print contract.** A headless browser raises no print dialog, so `window.print` is replaced
  with a counter before any page script runs, and the Print control must call it **exactly once** —
  zero before the control is used, one after. What that proves is the button's behaviour inside the
  real production bundle.
- **Row counts against the server's own answer.** The report cases require the screen's row count to
  **equal** the count the HTTP half recorded for the same code, branch and period. A hard-coded
  number would be a second statement of a figure the server owns; "the table is not empty" would pass
  on a screen that dropped every row but one.
- **The warranty ledger, row for row (FE-009).** The transition ledger on the warranty record
  must hold exactly the transitions the HTTP half read back through `wty.warranty-status-history`
  for the same warranty — the count from the handoff, never a literal in the spec — and the oldest
  row must be drawn as a beginning: the origin wording, no "moved from", and nothing above it.
  Today that ledger is one row long, because nothing in this phase advances a warranty's state, and
  a one-row ledger rendered as "no history yet" is the defect this asserts against.
- **A verdict in every queue row.** Each readiness row must read `Ready` or the not-ready sentence. A
  blank verdict cell is the defect this asserts against, and it is the whole point of the screen.
- **Stated absences.** "There is no download here" on the report catalogue, and "the service
  publishes no export operation for audit records" on the audit log, are asserted as sentences — so a
  download control appearing later contradicts a claim rather than merely appearing.

---

## 4. The refusal, concurrency and isolation cases

Three are exercised **inline**, because each is only observable at one moment. The rest run on records
of their own, so that a refusal cannot leave the main handover half-finished.

| case                                                                      | expected                                | where                                         |
| ------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------- |
| the counter approving their own opening batch                             | 409                                     | §4, inline                                    |
| the same approval replayed under the same key                             | 200, no second approval                 | §4, inline                                    |
| an invited person signing in **before** activation                        | 401                                     | §4, inline                                    |
| the same delivery-create body under the **same** `Idempotency-Key`        | 201 then 200, **the same row id**       | §11, inline                                   |
| a **second** key for a work order that already has a live delivery        | 409 `ERR-RES-002`                       | §11, inline                                   |
| a **stale** `If-Match` on completion                                      | 409                                     | §11, inline, before the real completion       |
| a **retired** employee named as the person handing over                   | 422, violation rule `inactive_employee` | §15, on a second work order                   |
| completion while the active template's mandatory items have **no result** | refused (409 or 422)                    | §15, on that second work order's own handover |
| organisation B reading organisation A's delivery                          | 403 or 404                              | §15                                           |
| organisation B reading organisation A's warranty                          | 403 or 404                              | §15                                           |
| organisation B naming organisation A's branch on the readiness queue      | 403, or 200 with **no row**             | §15                                           |
| organisation B running a report over organisation A's branch              | 403, or 200 with **no row**             | §15                                           |
| a third person **without** `sal.finance.view` on the readiness queue      | 403 — refused, not blanked              | §15                                           |
| the same person on the invoice-and-payment report                         | 403                                     | §15                                           |
| the same person on the work-order report, whose code they **do** hold     | 200                                     | §15                                           |

Two of these need explaining rather than listing.

**Why the isolation probes accept two shapes.** The P1-30 record's **CC-14** observation is that the
refusal shape differs between the application scope check (403) and RLS (an empty 200), and that the
remediation moved one probe from the second to the first. A harness demanding one shape would report
that remediation as a regression. What is never acceptable is a **row**, and that is what is asserted.

**Why "completion without an active template" is written as an unanswered mandatory item.** With no
active template there are no mandatory items, so `sal.complete_delivery`'s checklist gate is
vacuously satisfied and nothing is refused — the literal reading of the case is not a refusal at all.
The substantive case is the one the gate exists for: the template **is** active, its two items are
mandatory, and no result has been recorded. That is what the harness exercises, on the second work
order, and it is named that way rather than under a title that does not describe it.

---

## 5. Evidence layout

Written **outside the repository**, to
`%LOCALAPPDATA%\Temp\claude\p1-31-acceptance\<stamp>\` by default and to `--evidence-dir <path>`
otherwise. The harness **refuses** a directory inside the working tree: an acceptance artefact that
lands in `git status` is one `git add -A` away from being committed.

| file           | contents                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summary.json` | the verdict, the step and finding counts, the run's notes, the organisation codes, and the identifiers of every record made. No token, no password, no email body |
| `steps.json`   | every step, in order, with its expected and actual status and its correlation id                                                                                  |
| `steps.md`     | the same as a Markdown table, ready to paste into the acceptance record as §2                                                                                     |
| `handoff.json` | the browser half's credentials and the identifiers the specs open. **Single use** — see below                                                                     |

Exit codes: `0` every step answered what it was expected to; `1` the run finished and at least one
step did not; `2` a guard refused before anything was written.

### 5.1 The handoff is removed by the run

`handoff.json` carries single-use credentials. The HTTP half cannot delete it at the end of its own
process — the browser half has not run yet — so removal is a **step of the run**, and the harness
prints the command that performs it:

```
node orchestration/acceptance/p1-31-journey.mjs --remove-handoff --evidence-dir <dir>
```

A run whose record is written while `handoff.json` still exists is not finished. The credentials it
holds are this run's own, were never valid before it, and are worthless to anything but the two
organisations it created — but "worthless" is not the standard, and a credential on disk with no
owner is the thing the standard exists to prevent.

---

## 6. How PASS is judged, per task

A **PASS** for this phase is not "the suites were green". It is the conjunction of three things, and
any one of them absent makes the answer NOT PASS rather than a qualified pass:

1. **Zero findings in the HTTP journey.** Every step answered the status it was expected to,
   including every refusal case in §4. `summary.json` carries the count, and a non-zero count is
   recorded with its steps rather than explained away.
2. **Every browser case ran and passed, in both projects, with no unexplained skip.** A skip is
   acceptable only for a reason §1.1 names — a branch not merged — and the reason is quoted in the
   record. A skip for any other reason is a finding.
3. **An explicit Owner verdict on the production build.** Every previous Frontend phase closed on one
   (P1-26, P1-28, P1-30), and the judgement of the screens' wording and layout beyond what the
   assertions state is the Owner's and nobody else's.

Per task, what this acceptance can and cannot answer:

| task                                   | what a PASS here establishes                                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FE-001** ready-for-delivery list     | the queue renders the four work-order facts for a real closed work order and a verdict in every row                                                                                       |
| **FE-002** delivery eligibility        | eligibility answers before and after the evidence, and the blockers it names are the ones the completion enforces                                                                         |
| **FE-003** authorized receiver         | a receiver verified against the visit's party roles, and the second-receiver refusal                                                                                                      |
| **FE-004** delivery checklist          | an active template's mandatory items recorded, and a completion refused while they are not                                                                                                |
| **FE-005** final odometer              | the odometer captured as a decimal string and the reading reachable from the record                                                                                                       |
| **FE-006** delivery signatures         | a document authorized, stored, registered and bound, with the work-order provenance check passing                                                                                         |
| **FE-007** delivery document           | the printable copy renders in both languages and prints exactly once                                                                                                                      |
| **FE-008** warranty record             | a warranty generated from a delivered handover, and its terms on screen                                                                                                                   |
| **FE-009** warranty history            | **NOT answered.** `CC-31` records that no history reader exists; the record states so in the operator's own language, and this acceptance can only confirm that statement, not the ledger |
| **FE-010** operational dashboard       | **NOT answered by this plan.** No dashboard route is in §1.1's merge list                                                                                                                 |
| **FE-011**–**FE-014** the four reports | each runs over a half-open period and the screen renders exactly the rows the server answered                                                                                             |
| **FE-015** audit report                | the two declared audit actions were really written, each read under its own filter                                                                                                        |
| **FE-016** branch pilot summary        | **NOT answered by this plan.** Nothing in §1.1 ships it                                                                                                                                   |

The three rows marked NOT answered are marked so deliberately. A plan that quietly omitted them would
let a record claim phase coverage it does not have.

---

## 7. What no part of this can do

- **It cannot judge the screens.** Wording, layout, whether an operator would understand a refusal —
  those are the Owner's, and §6.3 exists because the assertions cannot stand in for them.
- **It cannot prove the hosted path.** Everything here is loopback. No hosted environment exists for
  this phase, and no part of this document claims one does.
- **It cannot close a task on its own.** Rule 2 of the task matrix requires a record; this plan
  describes how to produce one.

---

## 8. What has been measured on this branch

Static checks on the source of the harness and the specs. Nothing was executed against a database, a
server or a browser.

Every command below was run on the merged head and every one of them passed. One of them — the last
— failed on the first attempt, over a registration these four specs owed and had never been given;
§8.1 records what that was, what decided the repair, and the hosted consequence that the repair does
**not** remove. It is written out rather than quietly re-run to green, because a list of checks that
drops the one that went red is worse than no list.

| check                                                    | scope                                                   |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `node --check` on the harness                            | the harness parses as an ES module                      |
| `npm run typecheck`, `typecheck:web`                     | the four specs and the handoff helper compile           |
| `npm run lint`, `lint:web`                               | no errors                                               |
| `npm run format:check`, `format:check:web`               | both trees                                              |
| `npm run validate:p1-24-register`                        | the register regenerates unchanged at 411 operations    |
| `npm run validate:web-boundary`                          | the specs reach no API source and no Node-only module   |
| `npm run validate:use-server-exports`                    | unaffected, and proved so                               |
| `npm run validate:module-boundaries`                     | unaffected, and proved so                               |
| `npm run validate:p1-31-access`                          | the phase access gate                                   |
| `npm run validate:encoding`                              | the new files are UTF-8 without a byte-order mark       |
| `npm run validate:generated-artifacts`                   | no generated artefact was hand-edited or committed      |
| `node scripts/check-no-fake-data.mjs`                    | no fabricated business record anywhere in the new files |
| `node scripts/check-scope-exclusions.mjs`                | no excluded name                                        |
| `node scripts/ci/check-test-honesty.mjs`                 | every conditional skip carries its recorded reason      |
| `npm run security:all`                                   | the aggregate security gate                             |
| `npx vitest run tests/ci tests/openapi-contract.test.ts` | 1991 passed, 0 failed, 69 files — see §8.1              |

### 8.1 The registration these five specs owed, and the hosted consequence of it

`tests/ci/e2e-tier-coverage.test.ts` requires every spec under
`apps/web/tests/e2e/authenticated/` to be named in `.github/ci-baselines/unrun-test-tiers.json` —
under `governed.specs` if a gate-governed job executes it, in `unrun` if none does. The list named
seven paths and none of these, so the tier was RED from the moment the specs were committed,
before any merge. **All five are now registered under `governed.specs`, and the fact decided which
list:**

- `apps/web/playwright.config.ts:204` and `:215` give the `authenticated-en` and `authenticated-ar`
  projects `testMatch: /authenticated[\\/].*\.spec\.ts/` — a directory-wide glob that matches these
  five the moment they exist. `authenticated-tablet` at `:255` matches only
  `(administration|appointments-and-receptions)` and does not.
- `.github/workflows/_reusable-authenticated-browser.yml:416` sets `ROOTLCO_E2E_AUTH: '1'` and runs
  `npm run test:web-e2e-authenticated`. The job is in the `needs` of both `ci-gate` and
  `protected-gate`.

So the governed job **does** execute them, and `unrun` was not available anyway: that file's own
`policy` fails a declaration whose spec is executed by the gate, and the last case in the coverage
test fails any `/authenticated/` entry in `unrun` while the tier is governed. Registration was the
only lawful answer, and it is a registration — no rule was relaxed, no directory exempted, no
suppression added.

**Registration alone would not have bought a green hosted check, and the specs were changed so
that it does.** The `A run that collected nothing is a failure, not a pass` step of the same
workflow reads the spec **directory** — not this list — counts only results whose status is not
`skipped`, and exits 1 naming **every file** that contributed none. As first written, every case in
each of these files skipped while `ROOTLCO_P131_HANDOFF` was unset, which it is on every runner, so
each of them would have been named and the check would have been red.

The answer was not to weaken that step. It was to stop shipping spec files that can never
execute — the "declared but never wired" defect class this phase exists to clean up, and the one
`P1-27-INT-113` is named for. **Each of the five now carries at least one case that runs on the
governed job's own environment**, asserting the permission gating, reachability, honest idle and
denied states, and text direction that environment genuinely provides; §3.0 sets out exactly what
each asserts and why the handoff is not needed for it. Only the assertions that genuinely require
journey data — a specific delivery id, a generated warranty, a report's row count — remain behind
the handoff, each stating its own reason.

So the guard is satisfied honestly rather than accommodated: every file contributes executed
tests, and no case pretends to prove something it has not seen. What still waits for the harness
to be run is the journey half, which is §1 through §6 of this plan.

**FE-009's ledger case adds no registration, and it is behind the handoff for a structural
reason.** `warranty-p1-31.spec.ts` is already declared under `governed.specs`, and the file already
contributes an executed case in the governed job — `both warranty screens answer exactly what the
signed-in account is entitled to` — so the zero-executed-test guard is unaffected and no list is
edited. The new case cannot join that unconditional half: the panel lives on a warranty RECORD, and
the governed job provisions no warranty, so there is no identifier to open. What CAN be pinned
without a handoff is already pinned there — `account-manifest.json` records `owner-acceptance` as
holding `wty.warranty.read`, which is the code this subresource answers, so the owner is entitled to
the panel and is simply never shown a record. The gated case asserts that entitlement explicitly
rather than assuming it, and treats a refusal inside the panel as a failure rather than as an
accepted alternative outcome.

**It depends on one harness step that is not yet written.** The case reads `warrantyHistory` from
the handoff and skips, with the reason stated in the run, when the document does not carry it. The
step the harness owes is a `wty.warranty-status-history` read for the journey's own warranty,
published as the transitions page; until it is added, this case skips and claims nothing.

**The overview spec is the fifth file, and it closes FE-010 and FE-016.** The record carried both
as reached but not verified: no HTTP step called what the screen calls, and no browser case opened
it. `overview-p1-31.spec.ts` carries three cases, in both locale projects:

| case                                                                         | gate                                        | what it establishes                                                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| the overview answers exactly what the signed-in account is entitled to       | none — runs in the governed job             | FE-010's gate. `rpt.report.read` decides the one outcome asserted: the whole refusal with no section drawn, or the whole form with the idle state said |
| the four sections carry the figures the server published                     | handoff **and** the journey's administrator | FE-010's figures. Each section renders exactly the summary rows the harness recorded for it, or says nothing was recorded — never an empty table       |
| the overview fixed to a branch by the address shows that branch, and says so | handoff **and** the journey's administrator | FE-016. The branch comes from `?branchId=`, resolves in the caller's own directory, is shown fixed and stated as fixed, and reads the same figures     |

The harness half of the same pair is a final-pass step set: the authorized company and branch
directory the screen resolves against, and one `rpt.report-run` per approved domain at the
overview's own page size of one row, taken twice — once for the chosen branch and once for the
branch the address fixes — with an assertion step requiring the two to agree.

A second static measurement was taken after `develop` `811e9891` was merged in, and it is the one
that matters: **every operation the harness calls was re-read against the declaration on that head**
— the method, the path, whether the operation requires an `Idempotency-Key`, and whether it requires
an `If-Match`. That comparison found real defects in the harness and they are fixed on this branch;
the change-control record names them. A harness whose call shapes disagree with the contracts would
have produced a run full of `ERR-INT-002` and `ERR-CON-002` refusals and read as forty product
defects.

### 8.2 What CodeQL found in the harness, and what was changed

The hosted `CodeQL` analysis raised **seven** alerts on the first pull-request run, every one of
them in the HTTP harness and every one of them real. They are
recorded here because a harness that writes single-use credentials is exactly the file where this
class of defect matters, and because the fixes changed behaviour rather than annotations.

| alert                           | what it was                                                                                                                                          | what changed                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `js/insecure-temporary-file` ×4 | the default evidence directory was a PREDICTABLE path under a shared temporary directory, and it holds `handoff.json` — a password                   | the default is now `mkdtempSync`, which asks the operating system for an unguessable name and creates it atomically, owner-only |
| `js/http-to-file-access` ×2     | server responses — a customer, a vehicle, an invoice — written to files in that shared directory with default permissions                            | the directory is created `0o700` and every evidence file is written `0o600`                                                     |
| `js/incomplete-sanitization`    | the Markdown table escaped `\|` without first escaping `\`, so a value ending in a backslash escaped the escape and one cell ate the rest of the row | the backslash is escaped first, and the comment states why the order is the point                                               |

`handoff.json` is additionally written with the `wx` flag: create, and **fail** if anything is
already at that path. A plain write would follow a symlink somebody else had planted there and
hand the credential over silently; refusing to write is the only answer that cannot.

**The two `js/http-to-file-access` alerts survived that first round and were closed structurally in
a second.** File permissions do not remove a network-to-file edge; only removing the edge does. The
repository's policy is `maximumOpenFindings: 0` with an **empty** `dismissals` array, and its own
note records that the one dismissal this repository ever held — the same rule, at
`scripts/ci/check-commit-checks.mjs` — was **removed because the finding was fixed**, not allowed to
expire. So the same standard applies here.

The edge is closed by `evidenceSafe`, one barrier every value crosses on its way to the filesystem:
applied in `Ledger.add`, where all 133 steps are assembled, and again at each `writeFileSync`. A
value reaches an evidence file only as a boolean, a finite number, `null`, or a string with no
control characters and at most 200 characters; anything else becomes a marker naming what it was.
It deliberately does **not** bound how MANY entries it carries — dropping the 41st step or the 41st
report row would silently shorten the evidence, which is a worse defect than the one the barrier
prevents — and its depth cap exists only so a cyclic structure terminates.

That is a correctness fix and not a gate manoeuvre. An acceptance record is read by a person and
diffed by a reviewer, and a misbehaving local API could otherwise put control characters that
rewrite a terminal, or Markdown that rewrites the table around it, straight into the artefact the
run is judged by. It was checked both ways before it was committed: a 133-step ledger carrying
60-row report details passes through with every step, every row and every nested leaf intact, and
the handoff still satisfies the shape `p1-31-handoff.ts` requires — the UUIDs, the e-mail, the
password and the report counts all unchanged.

**No alert was dismissed, suppressed or annotated away, and nothing was added to `dismissals`.** The
counts above are the counts. Whether the policy gate is satisfied is decided by the next hosted run,
and this document does not claim the result of a run it has not seen.

The §8 list is the whole of what is claimed. The journey's **behaviour** is still unmeasured — a call
shape that matches a declaration is not a call that has been answered — and the first person to run
it should expect to find further defects in the harness as well as in the product. The P1-30 record's
amendment A1 found one in its own driver and named it as such.
