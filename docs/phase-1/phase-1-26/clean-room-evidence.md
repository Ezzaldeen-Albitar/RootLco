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
| Candidate SHA | `3e1f9e3ef56b4fc1320242f16951d8ae578d3f31` |
| Candidate tree | `5bdb10d481efc6cb8a7aaddad190fadc8137af65` |
| Clean-room HEAD | `3e1f9e3ef56b4fc1320242f16951d8ae578d3f31` — identical |
| Clean-room tree | `5bdb10d481efc6cb8a7aaddad190fadc8137af65` — identical |

| Check | Result |
| --- | --- |
| Lockfiles | **1** — the root `package-lock.json`, no nested lockfile |
| `npm ci` | **exit 0** |
| Tracked generated output | **0** files |
| Repository policies (10 gates) | **exit 0** |
| Web topology | 18 expectations, 107 matched files, **0 failures** |
| API Backend-only | 196 route handlers, 428 files, **0 failures** |
| Generated artefacts | 1799 tracked, 1 lockfile, 7/7 ignore rules, **0 failures** |
| Product-name authority | 2 authorities, both decided, **0 failures** |
| P1-26 frontend gate | 106 files, 11 server modules, **0 failures** |
| Phase ownership `p1-26-frontend` | **exit 0** |
| Root / CI-contract | **1467 / 1467**, 68 files |
| Web unit / component | **313 / 313**, 16 files |
| Web typecheck · lint · stylelint | **exit 0** |
| `verify:api` — typecheck, lint, format, build | **exit 0** |
| Production build | **exit 0**, 21 routes |
| Migrations | **119**, none created, none modified |
| Git state at the end | **clean** — the run left nothing behind |

The clean-room tree matching the working tree byte for byte is the point: the
result above came from the committed content and nothing else.

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
