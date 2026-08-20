# Phase 1-28 — Closure Record

**Classification:** Confidential — Commercial Product and Pilot Planning

**Status: CLOSED — `OWNER ACCEPTANCE: PASS`, 2026-08-20**

|                      |                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepted at          | protected `develop` `93af64dd2f02773abfb88792364d93ec7beb9f3e`, tree `4cd07a9490a18fe299ebb39007640898b9f96dcd`                                                |
| `main` at acceptance | `f085d82001a43de51725707426d5c10eb134c004` — unchanged at the moment of acceptance; promotion is a separate, separately authorized act recorded in its own PR  |
| Decision             | `OWNER ACCEPTANCE: PASS`, 2026-08-20, unconditional — returned verbatim against the running production application, with no conditions and no defects reported |
| Backend remediation  | PR #238, true merge `2645f70e`, second parent `f7174b58` (the reviewed head), merge tree identical to the reviewed tree                                        |
| Frontend remediation | PR #239, true merge `93af64dd`, second parent `93fd6a5a` (the reviewed head), merge tree identical to the reviewed tree                                        |
| Evidence candidate   | `e8a4200d`, tree `24dda02f` — QA-005 sealed, eleven hosted bindings BOUND, none pending                                                                        |
| Canonical matrix     | 35 PASS · 0 PARTIAL · 0 FAIL · 0 PENDING_FRONTEND_ADAPTER · 0 NOT_YET_WIRED                                                                                    |

---

## 1. What closed, and on whose word

P1-28 delivered the Appointment and Vehicle Reception Frontend. It reached a
state where every automated tier was green — and then the Product Owner tested
the merged application by hand and found five defects that none of those tiers
could see. Four were Frontend; the fifth was not a Frontend defect at all.

The permanent rule from P1-26 was applied without exception:

> No Frontend phase may be formally closed until the complete system runs
> locally, a usable Owner account exists, the Owner can sign in, the Owner can
> inspect every delivered screen by hand, real API integration is exercised, and
> the Owner explicitly records Pass.

It closes now because that rule was satisfied in full, against a **production
build of protected `develop` itself** — `next build` then `next start`, API on
`localhost:3000` and Web on `localhost:3100`, a real S3-compatible store attached
to the API process only, and the rate limiter active and observed refusing
(ten 401s then 429). Never a dev stack: `next dev` compiles route bundles lazily
and the API authenticator is installed as a side effect of composing the IAM
module, so an acceptance session on a dev stack reports refusals that do not
exist. On 2026-08-20 the Product Owner returned, verbatim:

> `OWNER ACCEPTANCE: PASS`

**Silence was never treated as Pass.** The verdict is the Owner's act; no count
in this repository derived it and none could have.

## 2. What was accepted

### The Backend authority — the defect that mattered most

Owner QA found the API accepting a damage-map write that named **no template
revision at all**. The requirement had been written as a Frontend concern, and a
compliant client is not a security boundary. The guard that was supposed to
enforce it opened with an early return on NULL, so on the shipped write path
every rule below it was optional for any caller that omitted the column — which
was all of them.

Migration 124 replaced that early return with a refusal. The invariant now lives
in the database, where a non-compliant caller cannot reach around it. It was
RED-proven rather than asserted: the same request answers **201 without the
revision id against the old guard and 422 with it against the new one**.

Reproved against protected `develop` by **live writes**, seven cases plus a
positive control, each answered by the exact rule and SQLSTATE it targets:

| case                              | outcome                                                              |
| --------------------------------- | -------------------------------------------------------------------- |
| a correct write (control)         | ACCEPTED                                                             |
| no template revision              | `23502` a damage map must name the template revision it was drawn on |
| another tenant's revision         | `23503` damage-map template version is not visible                   |
| a retired revision on a new visit | `23514` a retired … revision cannot be bound to a new visit          |
| the wrong document version        | `23514` does not carry its template revision document version        |
| the wrong slot type               | `23514` does not match its template type and perspective             |
| the wrong perspective             | `23514` same                                                         |
| a historical retired binding      | READABLE — 9 of 9, with their marks                                  |

The invariant is not advisory. `rec.damage_maps` is owned by `postgres`, and
`app_runtime`, `authenticated`, `anon` and `service_role` can none of them
disable the trigger.

### The four Frontend defects

- **The diagram picker printed the database's words** — `exterior`, `interior`,
  `front` reached the screen as themselves. Now localized in both languages.
- **A revision was a bare `1`** — now "Diagram revision 1", and the Arabic.
- **The signature ledger showed less than the contract already carried** —
  signer, role, purpose, capture method, signed-at and finalized-at were all in
  the payload and none of them on the screen.
- **The client did not send the template revision, and the strict adapter schema
  would have rejected it if it had.** Both halves now agree, and an
  adapter-level test proves the two shapes agree rather than trusting that they
  do. DOM tests mock the adapter, which is exactly why that drift stayed
  invisible until a browser refused it.

And the retired-template truth: Reception now distinguishes NEVER_PUBLISHED from
PUBLISHED_BUT_RETIRED from a Backend-provided count, not by inferring absence
from a bindable-only list — and still needs no `rec.catalogue.manage` to do it.

## 3. Recorded at the accepted state

Numbers, not adjectives — each produced by the run named, all taken at or against
the accepted content.

| tier                  | result                                       | source                                      |
| --------------------- | -------------------------------------------- | ------------------------------------------- |
| unit                  | 2780 total, 2777 passed, 0 failed, 104 files | run 32352973068, job 96375976877            |
| web                   | 2875 / 2875 / 0, 101 files                   | run 32352973068, job 96375976608            |
| backend               | 2056 / 2056 / 0, 88 files                    | run 32352973068, job 96375976947            |
| database (DB/RLS)     | 1717 / 1717 / 0, 143 files                   | run 32352973068, job 96375976888            |
| authenticated browser | recorded                                     | run 32352973068, job 96375976971            |
| protected hosted CI   | 19 of 19 success                             | run 32352973068, protected-gate 96380247793 |
| CodeQL                | 0 results, both languages                    | analyses 1646204264 and 1646195359          |
| `verify:policies`     | 0 problems                                   | protected `develop`                         |

The unit tier's three pending cases are `tests/acceptance/storage-round-trip.test.ts`,
which skips where no S3-compatible store is configured. Total, failed and file
count agree exactly with the local run; the difference is a named environment gap
and is declared in the package rather than smoothed over.

## 4. The Owner QA, as performed

Against the running production application, as `receptionist.acceptance@crm.local`
— 14 permissions, `rec.catalogue.manage` **false**:

- template facts arrived through the visit contract, with **no
  catalogue-administration control** on any screen;
- two damage marks placed, saved, and read back unchanged after a full reload —
  Dent / Rear right quarter panel / 0.72000 / 0.61000 and Scratch / Front left
  door / 0.25000 / 0.35000, notes intact;
- the retired-template sentence shown as its own distinct message, English and
  Arabic; historical maps on retired diagrams still readable with their marks;
- the signature ledger complete in words; **finalization performed live** on
  accepted evidence; non-accepted evidence refused — at _binding_, which is
  stronger than refusing finalization — with `23514 a rejected or quarantined
version cannot be signed`; repudiation preserving the original finalization
  timestamp beside its reason;
- an Arabic RTL pass with no uuid, no raw enum, no dotted key and no clipping;
- a smoke pass over the previously accepted flows, including EICAR quarantine —
  five infected scans against five quarantined versions, and none accepted.

**One row was not observable, and it is recorded rather than glossed.** The
active-template positive path, and with it the on-screen revision label, renders
only beside a _chosen active_ template. Every template slot in the acceptance
environment is retired from the Owner's own retirement test, and publishing a new
one needs `rec.catalogue.manage` — which the receptionist correctly does not
hold. The state that made the label unobservable is the state that proves the
permission split the same rows ask for. The behaviour is proven twice over: by
the component, which renders the label only when a template is chosen, and by the
database, which refuses a new binding to a retired revision.

## 5. What this record does not claim

This is a closure record, not a promotion record and not a technical gate. It
states that the Owner accepted P1-28 at `93af64dd`. Promotion of `develop` to
`main` is a separate, separately authorized act and is recorded in its own pull
request.

P1-29 has not begun.
