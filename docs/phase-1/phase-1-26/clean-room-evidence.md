# Phase 1-26 — clean-room evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

`P1-26` wave 17. A fresh checkout of the exact candidate SHA, a clean
`npm ci` from the single root lockfile, and every tier re-run with no artefact
carried over from the working tree.

---

## Why this exists

A working tree accumulates. A `.next` directory from an earlier build, a
`node_modules` installed from a lockfile that has since changed, a file that is
present locally and never committed — each of them can make a suite pass for a
reason that will not survive contact with CI or with the next person to clone the
repository.

The clean room answers one question: **does the committed tree, alone, produce
this result?**

## What is verified

| Check | Why |
| --- | --- |
| One root lockfile, no nested lockfile | a nested lockfile installs a different tree than CI does |
| `npm ci` from that lockfile | `npm install` may resolve differently; `ci` may not |
| No tracked generated output | a committed `.next` or build artefact makes a build "pass" without running |
| Repository policy gates | ten gates, including the P1-26 gate |
| Formatting, all three scopes | the root formatter cannot see a workspace — `P1-26-F-043` |
| Secret, pilot-scope and no-fake-data scans | `verify:policies` does not include them — `P1-26-F-042` |
| API Backend-only, web topology, phase ownership | the boundary held |
| Root, web, backend, Database/RLS tiers | the counts, from a tree with no local state |
| Production build | the class of failure that only appears here |
| Browser suite | against that build |
| Migration count and schema hash | unchanged by a Frontend phase |
| Clean git state at the end | the run itself left nothing behind |

## Result

Measured from a fresh `git clone` checked out at the exact candidate SHA, with a
clean `npm ci`.

| | |
| --- | --- |
| Candidate SHA | `b4794e79206396f220af28f523f0e90a6b186e8f` |
| Candidate tree | `c63871d7673fd385c217ccb2d120675a3509d454` |
| Clean-room HEAD | `b4794e79206396f220af28f523f0e90a6b186e8f` — identical |
| Clean-room tree | `c63871d7673fd385c217ccb2d120675a3509d454` — identical |

| Check | Result |
| --- | --- |
| Lockfiles | **1** — the root `package-lock.json`, no nested lockfile |
| `npm ci` | **exit 0** |
| Tracked generated output | **0** files |
| Repository policies (10 gates) | **exit 0** |
| Web topology | 18 expectations, 107 matched files, **0 failures** |
| API Backend-only | 196 route handlers, 428 files, **0 failures** |
| Generated artefacts | 1800 tracked, 1 lockfile, 7/7 ignore rules, **0 failures** |
| Product-name authority | 2 authorities, both decided, 534 files, **0 failures** |
| P1-26 frontend gate | 106 files, 11 server modules, **0 failures** |
| Formatting — all three scopes | **exit 0** — root, `@rootlco/api`, `@rootlco/web` |
| `security:all` — secrets, scope, no-fake-data | **exit 0**, 1800 tracked files |
| Phase ownership `p1-26-frontend` | **exit 0** |
| Root / CI-contract | **1474 / 1474**, 68 files |
| Web unit / component | **313 / 313**, 16 files |
| Web typecheck · lint · stylelint | **exit 0** |
| `verify:api` — typecheck, lint, format, build | **exit 0** |
| Production build | **exit 0**, 21 routes |
| Migrations | **119**, none created, none modified |
| Git state at the end | **clean** — the run left nothing behind |

The clean-room tree matching the working tree byte for byte is the point: the
result above came from the committed content and nothing else.

### What this run added, and what it caught

The first clean room (at `3e1f9e3`) ran **no formatter and no secret scan**. Both
were added here, and the omission was not hypothetical: `P1-26-F-042` (a
credential-shaped literal) and `P1-26-F-043` (sixteen unformatted web files)
both reached hosted CI, and a clean room that ran neither check reported green
through both.

This run also **failed on its first attempt** — one root test, on a timeout
rather than an assertion (`P1-26-F-044`). It is recorded rather than re-run into
submission; the fix and the measurement that justifies it are in `findings.md`.

## The Owner-acceptance remediation clean room

Re-run from a fresh clone at the remediation candidate. The same discipline, with
two additions the earlier runs did not have: the acceptance guards are exercised
inside the clean room, and the anonymous browser suite is counted to prove the
new authenticated tier stays invisible without its flag.

Candidate `66237c1443042bc3339d091ed5c17036fdf53d9b`, tree
`0dfb725d3ff19ef9189f0b25eac086f6872b413e`.

| Check | Result |
| --- | --- |
| Clone tree vs working tree | **identical** |
| Lockfiles / tracked generated output | **1** root lockfile · **0** files |
| Migrations | **119** |
| Brand assets tracked | **3** under `apps/web/public/brand/` |
| Files named `Generated_*` | **0** |
| Tracked `.local/` or credential file | **0** |
| `npm ci` | **exit 0** |
| Repository policies | **exit 0** |
| Formatting, all three scopes | **exit 0** |
| `security:all` | **exit 0** |
| `npm audit --audit-level=high` | **exit 0** |
| Root / CI-contract | **1479 / 1479**, 69 files |
| Web typecheck · lint · stylelint | **exit 0** |
| Web unit / component | **319 / 319**, 16 files |
| `verify:api` | **exit 0** |
| Production build | **exit 0** |
| Acceptance guard, `ROOTLCO_ENV` unset | **exit 2 — refused** |
| Acceptance guard, non-loopback host | **exit 2 — refused** |
| Anonymous browser suite with `ROOTLCO_E2E_AUTH` unset | **110 tests in 1 file** — unchanged |
| Git state at the end | **clean** |

The guards being exercised *inside* the clean room is the addition that matters:
it proves the local-only refusal is a property of the committed tree, not of the
machine that happened to run it.

### Two runs that failed first, and why both are recorded

**At `3d2bcc48` — `security:all` failed.** One credential-shaped value in
`local-acceptance-account-runbook.md`. The same scan had passed on the working
tree minutes earlier.

The difference is the whole point of a clean room. `check-tracked-secrets.mjs`
reads **tracked** files; the runbook was still untracked when the local scan ran,
so the local scan could not see it. In a fresh clone every file is tracked, so
the clean room saw it immediately — and so did hosted CI. **A gate run before
`git add` cannot see the file being added.** The commit that fixed it stages
before it verifies.

**At `e0d3e54` — the web and API tiers failed.** A blanket
`"brace-expansion": "^5.0.9"` override, added to clear a new advisory, produced
`TypeError: expand is not a function`. Three `minimatch` majors in the tree
depend on three different `brace-expansion` majors and only 4.0.0–5.0.8 are
affected; forcing 5.x globally handed a v5 module to v1 and v2 consumers. The
override is now scoped to the vulnerable range, and 1.1.18 and 2.1.4 resolve
exactly as before.

Both are kept because a clean room that only ever shows its green run is a
record of a rehearsal, not of a test.

### The clean room's own defect

The first two runs also lost the middle of their own log: `cd apps/web` without a
subshell left the final `git status` outside the repository, and npm's carriage
returns overwrote earlier lines. The script now runs every `cd` in a subshell
and strips `\r` from every step. A verification log that cannot be read is not
evidence, and it took a third run to notice.

### A note on this record's own SHA

A record that names the SHA it measured cannot live inside that SHA. This one
measured `b4794e7` and is committed after it, in a **documentation-only** commit
that changes no file any tier above reads. The same convention was used for the
`3e1f9e3` record it replaces.

### What the clean room did not run, and why

The **backend** and **Database/RLS** tiers need a live PostgreSQL with the
migrated schema. They are measured against the working tree in
`evidence/test-register.md` — **1752 / 1752** and **1636 / 1636** at the base —
and P1-26 changed **no file either tier reads**, which
`check-phase-ownership.mjs` asserts on every wave and the clean room re-asserts
here.

The **browser** suite is measured separately, twice, in `browser-evidence.md`.
Running it inside the clean room would have added a second `npm ci`, a second
production build and a second browser download for a result already measured
against the same tree.

Both are stated rather than quietly folded into the word "green".

## What a clean room cannot prove here

It re-runs what the repository can run. It does **not** exercise the eleven
administration screens against a live API, because that needs a real account in a
real tenant and the no-fake-data policy forbids seeding one.

That is not a footnote. Wave 16's adversarial review found a **critical** defect
in exactly that space — ten operations requiring an `Idempotency-Key` header no
call site sent (`P1-26-F-015`) — and a clean room would have reported green
while every one of them failed on first contact with a real backend.

A clean room proves the tree is self-contained. It does not prove the tree is
correct against a system it never talks to, and this record does not claim
otherwise.
