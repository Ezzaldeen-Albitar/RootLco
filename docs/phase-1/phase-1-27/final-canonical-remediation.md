# P1-27 — final canonical remediation checkpoint

**Status: NOT CLOSED. `OWNER ACCEPTANCE: FAIL` stands until the Product Owner
returns an explicit Pass.**

This record is written from repository truth at the SHAs named below, not from
the preceding status files. Where an earlier document or report was wrong, the
correction is recorded here rather than applied silently — the phase has already
been closed once on claims that later proved false, and erasing the trail is how
that happens twice.

---

## 1. Live checkpoint

**This section is a dated checkpoint, not live state.** It records the tree at
the moment the remediation was written; both Backend branches have since merged
and `origin/develop` has moved. The superseding checkpoint is immediately below
it, and the original is kept because the reasoning in §2 depends on what was true
then.

### 1a. As written

| Ref                                                      | SHA                                        |
| -------------------------------------------------------- | ------------------------------------------ |
| `remediation/p1-27-final-canonical-blockers` (candidate) | `2ff4820ac368ac97a1c86f4653de647155ebf140` |
| `remediation/p1-14-actor-display-identity` (Backend D3)  | `210aac2dc05edafdb8d8c88555517173f124d85c` |
| `origin/develop` (protected)                             | `6e99d7ef9a4870f57cec0a7af6c4e6064f003af2` |
| `origin/main` (protected, untouched)                     | `f085d82001a43de51725707426d5c10eb134c004` |

One worktree. Clean tree. `P1-G27` absent. P1-28 absent.

### 1b. Superseding checkpoint — both Backend remediations merged

| Ref                                                  | SHA                                        |
| ---------------------------------------------------- | ------------------------------------------ |
| `origin/develop` (protected)                         | `61d8ded` — merge of PR #212               |
| PR #213 `remediation/p1-27-backend-partner-identity` | head `8451427` → merge commit `1045c15`    |
| PR #212 `remediation/p1-14-actor-display-identity`   | head `76e37f0` → merge commit `61d8ded`    |
| `origin/main` (protected, still untouched)           | `f085d82001a43de51725707426d5c10eb134c004` |

Both are merge commits — verified by reading each merge's second parent, not by
trusting the merge screen. Merge-commit only, no squash, no rebase, no force, no
direct push to a protected branch.

`210aac2` is an **ancestor** of `76e37f0`, not a competing SHA: the D3 branch
gained three further commits before merging (a docblock correction; coverage for
the environment accessors the composition guard newly made visible; and a fix for
the operation-coverage gate grazing the 5 s timeout under `--coverage`).

`P1-G27` still absent. P1-28 still absent. `main` still untouched.

---

## 2. The D3 contradiction, reconciled from Git

A previous execution report contained two incompatible accounts of D3: one
describing a working provider-free implementation, one saying the D3 branch had
been discarded and D3 remained blocked. **Both were true, at different times, and
the report failed to make the chronology explicit.** That is a reporting failure,
not a repository inconsistency.

Established live:

```
git cat-file -t 210aac2                              → commit
git cat-file -t d0a6008                              → commit
git branch -a --contains 210aac2                     → remediation/p1-14-actor-display-identity (local + origin)
git branch -a --contains d0a6008                     → remediation/p1-27-final-canonical-blockers (local + origin)
git merge-base --is-ancestor 210aac2 origin/develop  → false
git merge-base --is-ancestor 210aac2 HEAD            → false
git merge-base --is-ancestor d0a6008 HEAD            → true
```

**`D3_STATE = PUSHED_BACKEND_BRANCH_NOT_MERGED`**, with the frontend half already
in the candidate branch.

**Re-established after the merges**, same commands, opposite answers on the two
that mattered:

```
git merge-base --is-ancestor 210aac2 origin/develop  → true
git merge-base --is-ancestor 210aac2 HEAD            → true
git merge-base --is-ancestor 76e37f0 origin/develop  → true    (D3 head as merged)
git merge-base --is-ancestor 8451427 origin/develop  → true    (D2 backend head as merged)
```

**`D3_STATE = MERGED`.** The transcript above is left standing rather than
rewritten: a checkpoint that silently updates itself cannot be checked, and the
whole point of §2 is that a chronology was once left implicit and caused a
contradiction.

The discarded branch was the **first** attempt. It composed `iamModule()`, which
made `veh.vehicle-history` answer 500, and it was deleted unpushed. The surviving
`210aac2` is the rebuild that fixed the coupling. Nothing was lost and nothing
needs rebuilding.

---

## 3. D3 — what was wrong and what fixes it

`veh.vehicle_attribute_history` stores an `actor_id` and no name, so the history
screen printed a uuid under a column headed "Changed by".

### 3.1 The composition defect that blocked the obvious fix

`iamModule()`'s composition root calls `installIamRuntime()`, which builds the
Supabase adapter and reads `clientEnv()`. Any module composing IAM merely to turn
an actor id into a name inherited a dependency on `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and answered `ERR-SYS-001` where those are unset.

**The repository already knew.** `apps/api/src/server/auth/authorization.ts:171-174`
and `:232-233` each refuse to route a permission check through `@/modules/iam`,
in prose, because doing so "would force that module's composition root —
including its Supabase client configuration — to boot on any request that prices
a discounted line, which is a coupling a permission check has no business
creating." Two phases met this wall and routed around it. `210aac2` removes it.

### 3.2 The fix

`iamDirectory()` — a second composition root constructing `IdentityDirectoryService`
and nothing else. `composeModule` memoises per closure rather than per module
name, so the two roots are independent. `iamModule()` is untouched, which is what
keeps the authentication bootstrap out of the blast radius of a display-name fix.

Projection is `id` + `displayName` only. `iam.user_employee_links` is deliberately
unused: **a user id is not an employee id**, and resolving through that
temporally-valid link would answer "which employee record is current" rather than
"who did this".

Gated on `iam.user.read`, the same code `iam.user-detail` requires, so nothing
widens.

The rest of this paragraph used to read: a caller without it "sees 'User
unavailable' — strictly less information than the uuid it replaces". That is
wrong twice, and the same sentence was corrected in `actor-identity.ts` and
`identity-directory-service.ts` for the same reasons. `WithActor<T>` is
ADDITIVE, so `actorId` is still on the wire for every caller and nothing was
taken away; and "User unavailable" is a phrase the FRONTEND chooses, while this
module publishes an absence. The narrowing that does hold is the one that
matters: an unentitled caller gets no name, and learns nothing they did not
already have.

### 3.3 Evidence

| Suite                                                | Result                                                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/foundation/iam-directory-composition.test.ts` | 5 — `iamDirectory()` composes with every provider variable unset while `iamModule()` still throws                                                         |
| `tests/backend/p1-17-vehicle-history.test.ts`        | 8 — the same row read by two callers differing only in `iam.user.read` names a person for one and not the other                                           |
| `apps/web/tests/vehicle-screens.dom.test.tsx`        | 29 — name shown; `null` and _absent_ both render "User unavailable"; the uuid is absent from rendered text (was recorded as 27; re-measured at this head) |

Mutation-proved four ways: reintroducing `installIamRuntime()` fails 4 of 5
foundation tests; dropping the permission check fails the withholding test;
restoring `{row.actorId}` fails all three frontend tests.

`actorName` is typed **optional on the wire** in the frontend contract. That is
deliberate and is the opposite of the `Named<T>` decision on the Backend, for the
opposite reason: there the type describes a value the code must produce, here it
describes a payload the code must not trust. `undefined` and `null` render
identically, so there is no merge order in which a uuid reappears.

---

## 4. D1 — proven structurally, not asserted

`scripts/ci/check-p1-27-write-reachability.mjs`, wired into
`validate:p1-27-reachability`, `verify:policies`, command coverage and hosted CI.

The operation list is **derived** from the P1-24 register — every `crm.*` /
`veh.*` operation whose method is not GET — so a new operation is UNCLASSIFIED
rather than unnoticed.

```
P1_27_CANONICAL_MUTATIONS            = 27
P1_27_REACHABLE_MUTATIONS            = 23
P1_27_DELIBERATELY_ABSENT            = 4
P1_27_DECISION_NEUTRAL_UNAVAILABLE   = 0
P1_27_BLOCKED                        = 0
P1_27_UNCLASSIFIED                   = 0
```

### REACHABLE (23)

`crm.individual-create`, `crm.company-create`, `crm.contact-add`,
`crm.address-add`, `crm.preference-set`, `crm.consent-record`, `crm.note-add`,
`crm.alert-raise`, `crm.tag-assign`, `crm.restriction-impose`,
`crm.customer-status-set`, `crm.duplicate-review`, `crm.vehicle-link`,
`veh.vehicle-create`, `veh.vehicle-update`, `veh.vehicle-status-change`,
`veh.vehicle-plate-assign`, `veh.vehicle-odometer-record`,
`veh.vehicle-ownership-transfer`, `veh.vehicle-ev-profile-set`,
`veh.vehicle-authorized-party-add`, `veh.vehicle-authorized-party-retire`,
`veh.vehicle-duplicate-review`.

### DELIBERATELY_ABSENT (4)

| Operation                    | Decision                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `crm.customer-merge`         | `P1-OD-017` — open Owner decision; affordance absent, not disabled                                        |
| `veh.vehicle-merge`          | `P1-OD-017` — same                                                                                        |
| `crm.duplicate-scan`         | `canonical-plan.md:268` — a privileged audited write; the creation-time warning uses `crm.duplicate-list` |
| `veh.vehicle-duplicate-scan` | `canonical-plan.md:268` — same                                                                            |

**Media upload is not in this table because no media operation exists in the
register at all.** `P1-OD-025` governs whether one should; there is nothing to
classify until it does.

### What does not count as a call site

Tests, comments, docblocks, translation copy, the generated
`lib/api/idempotent-operations.ts`, and `operation-contract.ts`. A read on the
same path as a write does not vouch for the write — `veh.vehicle-ev-profile-set`
(POST) and `-read` (GET) share one path in one file, and there is a test for it.

24 mutation tests in `tests/foundation/p1-27-write-reachability.test.ts`.

---

## 5. Corrections to the record

Recorded rather than erased.

| #   | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1 | **D1 was understated.** It was first reported as four blockers. The real count was ten unreachable canonical writes: contacts, addresses, plate, odometer, EV profile, ownership transfer, party authorise, party retire, customer-vehicle link and customer status.                                                                                                                                                                                                                            |
| C-2 | **D2's first fix risked widening Customer visibility.** `2c4520c` resolved partner names for any caller of a read guarded by `veh.vehicle.read`. `blocker-remediation-plan.md §2.2` had warned this widens `veh-ownership-visibility-matrix.md:49`, which grants such a caller an opaque uuid and denies the CRM columns for the reason "CRM RLS + CRM permission model" — and RLS alone does not implement that half. Corrected in `275129a`: resolution now checks `crm.customer.read` first. |
| C-3 | **D3's history was reported contradictorily.** Reconciled from Git in §2. The discarded branch was the first attempt; `210aac2` is the rebuild.                                                                                                                                                                                                                                                                                                                                                 |
| C-4 | **Root `npm run typecheck` does not cover `apps/web`.** It reported clean on five undefined identifiers that `typecheck:web` caught as `TS2304`. Both must be run.                                                                                                                                                                                                                                                                                                                              |
| C-5 | **`format:check:web` was red for four commits.** `34c11f6` and `b49b55b` left `RecordForm.tsx` and `CustomerProfileScreen.tsx` non-conformant; `lint:web` and `typecheck:web` were run and `format:check:web` was not. Proved by running prettier against those files as they stood at `1421c14`. Fixed in `2c4520c`.                                                                                                                                                                           |
| C-6 | **`validate:encoding` was red for three commits.** A PowerShell `Set-Content -Encoding utf8` wrote a BOM into `vehicle-relationship-writes.dom.test.tsx` at `e4abf4e`, and a later round-trip re-encoded punctuation as mojibake in that file and in `package.json`. Repaired in `2ff4820`; 1989 tracked files now scan clean. Same cause as C-5: running the checks a change obviously touches, not the ones it quietly touches.                                                               |
| C-7 | **The reachability gate itself shipped two bugs before it was calibrated.** It assumed the register field was `path` (it is `route`, already `/api/v1`-prefixed), producing 23 false violations; and it applied the register's `{param}` normalisation to whole source files, collapsing every function body and erasing the `writeVehicle(` marker, producing 3 more. Both found by running the gate against a tree known to be correct.                                                       |
| C-8 | **Fixture / no-fake-data ordering is a constraint, not a preference.** Acceptance fixtures and the no-fake-data DB tier cannot coexist. Order: reset fixtures → prove zero business rows → run DB/RLS → recreate fixtures. Misreading this as a product failure is documented as `P1-26-F-057`.                                                                                                                                                                                                 |
| C-9 | **PR creation is externally blocked.** No `gh`, no token in any environment variable, no repository tooling, SSH-only remote. An earlier note claiming `git credential fill` yields a token was true in a session with a cached HTTPS credential and is not true here. See §7.                                                                                                                                                                                                                  |

---

## 6. Separate finding — IAM authenticator bootstrap

**Classification: architecture risk requiring follow-up. Owning phase P1-13 /
P1-14 foundation. Does NOT block P1-27 acceptance.**

**Mechanism — proven.** `installIamRuntime()` has exactly one call site,
`iamModule()`'s factory, and is the only caller of `setSessionAuthenticator`. A
probe in a fresh module registry imported the vehicle history route and composed
`vehicleModule()`; `sessionAuthenticator()` remained `UnconfiguredAuthenticator`
in all three states. That authenticator returns `null`, so `handleOperation`
answers **401**.

**Why it does not block P1-27.** Every protected page calls `requireSession`,
which issues `GET /api/v1/auth/session` — an IAM route — before any domain route
in the same process. The browser journey therefore always installs the
authenticator first.

**Why it still matters.** A direct API consumer, or a request served by a process
that has not yet loaded an IAM route, would receive 401 for a valid token. It
fails **closed**, so it is an availability and correctness risk rather than a
security hole.

Deliberately not folded into D3: fixing an authentication bootstrap speculatively
inside a display-name remediation is how an unrelated regression gets shipped.

---

## 7. `PR_CREATION_BLOCKED` — RESOLVED

**Resolved.** The Product Owner authorised pull-request creation through the
already-authenticated browser session, and both Backend pull requests were
created and merged that way:

```
PR #213  remediation/p1-27-backend-partner-identity  head 8451427  →  merge 1045c15
PR #212  remediation/p1-14-actor-display-identity    head 76e37f0  →  merge 61d8ded
```

Nothing below was bypassed to achieve it. Every required check ran to completion
at the exact head before each merge (#213: 20 successful; #212: 19 successful,
1 skipped by change detection), both merges are merge commits, and no protected
branch was pushed to directly. One incident is worth recording because it is the
kind of thing that produces a wrong-base merge: GitHub pre-fills a new pull
request against the repository's DEFAULT branch, which here is `main`. A first
attempt (#211) was created that way — 194 commits, 1014 files — and was closed
unused. `main` remains untouched.

The diagnosis below stands as written and remains accurate about the SHELL
environment; it was simply not the only avenue.

### The environment as diagnosed

No authenticated mechanism exists in the shell:

- `gh` is not on `PATH` and is not in any standard install location
- `GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_PAT`, `GH_ENTERPRISE_TOKEN`,
  `GITHUB_API_TOKEN` are all unset
- `git credential fill` for `https://github.com` returns nothing — the remote is
  `git@github.com:` (SSH)
- no repository script creates pull requests

This is an external control-plane blocker. It is **not** permission to push to a
protected branch, and nothing here bypasses branch protection. Both branches are
pushed, green and ready.

### Pull request 1 — Backend, must merge first

```
branch : remediation/p1-14-actor-display-identity
head   : 210aac2dc05edafdb8d8c88555517173f124d85c
base   : develop
title  : feat(P1-14): provider-free IAM read surface for actor display identity (P1-27-INT-026)
```

### Pull request 2 — the P1-27 candidate

```
branch : remediation/p1-27-final-canonical-blockers
head   : 2ff4820ac368ac97a1c86f4653de647155ebf140
base   : develop
title  : fix(p1-27): close final canonical CRM and vehicle blockers
```

---

## 7A. The 42-task audit does NOT support 42/42

Derived independently from implementation truth by 30 agents reading the real
tree, every PASS then put through an adversarial recheck instructed to refute it.
Full detail in `independent-task-audit.md`.

```
TASKS_AUDITED = 42
PASS          = 20
FAIL          = 22
PASS_REFUTED  = 11
```

**P1-27 is not at 42/42 and must not be reported as such.** The most severe
finding, `FE-019`, is fixed at `8daf8e9`: the vehicle search listed vehicles and
offered no way to open one, so the entire vehicle profile — and every write this
remediation wired onto it — was reachable only from the duplicate-review queue.
That is the same defect shape as the unreachable writes, one level up.

The remaining findings include, verified by hand where quoted:

- `SEC-001` — `WRITE_PERMISSIONS` (`governance-contract.ts:142`) has **zero
  consumers**; ten write surfaces carry no client-side permission gate.
- `SEC-004` — a security test compares a path case-sensitively and fails on any
  POSIX runner; hosted CI is `ubuntu-latest`.
- `FE-002` — a search that matches nothing renders "Nothing here yet", because
  `isNarrowed()` cannot see criteria held outside `TableRequest`.
- `FE-029` — `actorName` is not published by the API on this branch, because the
  Backend half is on an unmerged branch. Expected, and it resolves on merge.
- **The CRM half of the same field has no producer**, and this was not disclosed
  until an adversarial recheck found it. The customer timeline's "Recorded by"
  column reads the safe sentence for **every human row**. No uuid is shown, which
  is the requirement, and the field is retained rather than deleted so that
  wiring it is a Backend change alone. Owned by P1-16 Backend, not by this phase.

  Two supporting statements here are corrected rather than deleted, because the
  conclusion survives both and the correction is the point. "`actorName` occurs
  nowhere in `apps/api` (verified repository-wide)" became false the moment
  PR #212 merged — it is published by `veh.vehicle-history`. And "touches five
  files" pinned a count to a branch that ended at nine. The load-bearing fact was
  never the count but the LOCATION: `iam/` and `vehicle/`, none under `crm/`.
  That is still true, so the customer timeline is still unwired and this bullet
  still holds.

- `FE-022`, `FE-023`, `FE-024` — missing permission gating and, for the
  electric-drive write, no test of any kind.
- `DOC-001`, `DOC-002`, `QA-005` — documents that name their own proof are stale
  or point at a gate that is currently red.

These are recorded rather than fixed. Fixing twenty-one findings inside this
remediation would repeat the mistake that produced them: a large change reported
green because the checks that would contradict it were not the ones run.

### 7A.1 Superseded — the same audit, re-derived after remediation

The block above is the state of the tree when the audit ran and is kept exactly
as written. It has since been worked through. Every one of the thirty-three
adjudicated items is closed, and the 42-task derivation now returns:

```
TASKS_AUDITED = 42
PASS          = 42
FAIL          =  0
```

Two things must be read with it, or the number means less than it looks.

**A refuted pass is a fail.** `PASS_REFUTED = 11` above meant the audit's own
`PASS = 20` was really nine — the correction is preserved in
`evidence/change-log.md` under "Audit progression". The count is only worth
anything because each of the thirty-three was named, reproduced, individually
adjudicated and mutation-proved; the itemised list is `final-task-adjudication.md`,
which is canonical for status.

**Forty-two tasks is not a delivered phase.** `P1-27` remains
`OWNER ACCEPTANCE: FAIL` and closes only on an explicit Owner verdict against the
running application. This phase has already recorded three occasions where every
automated tier was green over a defect a person found by hand, so the pipeline's
agreement is necessary and has never been sufficient.

### The D2 Backend half was riding inside this Frontend branch

Found by running the full gate set, not by review. `npm run validate:phase-ownership`
failed with **seven `apiSource` violations** — 290 insertions across
`customer-read-service.ts`, `customer-read-repository.ts`, `partner-identity.ts`,
`vehicle-registration-service.ts`, `vehicle-relations-service.ts` and the two
repositories beneath them — introduced by three commits made before this
remediation began.

The gate's own message is the instruction: "a Frontend phase must not change API
source — route it through a Backend remediation." That is now
`remediation/p1-27-backend-partner-identity`, pushed, carrying the seven files,
the Backend test they shipped without, and two ownership profiles: one so that
branch can gate itself, and `p1-27-frontend` because the gate DEFAULTS to
`p1-26-frontend`, so P1-27 was measured against another phase's declaration for
its entire life.

**Merge order is Backend first, and it is not the cost-free option.** On
`develop` today the relationships cell renders `row.partnerId`, so Backend-first
leaves that uuid on screen until the Frontend merges; Frontend-first would remove
it immediately and show "Customer unavailable" until the Backend merges.
Backend-first is chosen so the API change is reviewed as API before anything
depends on it. `PartyLabel` was hardened to treat an absent field the same as a
null one, so the Frontend-first window would also be safe.

The finding worth keeping is not the split. It is that a Backend change reached
three merges to `develop` with **no Backend test of any kind**, and nothing
noticed, because every web test mocks the adapter: the resolution path could
have returned an empty map and 1144 web tests would still have passed.

---

## 8. What remains before the Owner can accept

1. Both pull requests opened, exact-head CI green, merged with true merge commits.
2. `develop` reintegrated into the candidate branch and the merge reproved.
3. Full DB/RLS tier in the correct fixture order.
4. Acceptance dataset rebuilt and cross-tenant visibility measured at zero.
5. Installed-Chrome review across CRM and Vehicle in English and Arabic.

Until those complete, **P1-27 remains `OWNER ACCEPTANCE: FAIL`** and no gate
record exists.
