# Coverage policy

## The problem this solves

`vitest.config.ts` configured a v8 coverage provider with an explicit
include list — 11 entries today, 13 when this was written — and **no
thresholds**, and **no workflow ever invoked it** (CSA-07). Coverage could have
fallen to zero without a single check going red.

## Three tiers, measured separately

| Tier    | Scope                                                                  | Harness                                                         | Baseline file                    |
| ------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------- |
| unit    | the `coverage.include` list in `vitest.config.ts` — pure logic, no I/O | `npm run test -- --coverage`                                    | `coverage-baseline.unit.json`    |
| backend | `src/modules/**`, `src/server/**`                                      | `npm run test:backend -- --coverage`, against a live PostgreSQL | `coverage-baseline.backend.json` |
| web     | the `COVERAGE_INCLUDE` list in `apps/web/vitest.config.ts`             | the coverage flags inside the `@rootlco/web` `test:ci` script   | `coverage-baseline.web.json`     |

The web tier was absent from this table for the whole of its existence, while
`coverage-baseline.web.json` named this file as its policy — a tier governed by
a document that did not mention it. It is listed now. Two things about its
harness are load-bearing and are recorded in that baseline rather than repeated
here: it runs **both** vitest projects (`logic` in node, `dom` in jsdom) into one
report, because they are two environments over one application; and the coverage
flags live inside the workspace script deliberately, because
`npm run test:web -- --coverage` loses the separator at the second npm layer and
silently runs a plain `vitest run` that measures nothing and exits 0.

The three are **not merged**. A single combined number would overstate all of
them: the tiers exercise disjoint code through completely different harnesses,
and adding them together produces a figure that describes none of them.

## Three rules, in order of strictness

**1. Global ratchet.** No metric may fall more than
`tolerancePercentagePoints` below the recorded baseline. The tolerance exists
because v8 line attribution shifts by fractions of a point across Node patch
releases — it is not a licence to lose coverage, and it is **not** a mechanism
for absorbing a change of coverage provider (see "When the coverage provider
changes major version"). Unit tier: 0.5 pp. Web tier: 0.5 pp. Backend tier: 1 pp
(a database-bound tier is noisier).

**2. Critical-module floors.** Named modules hold an absolute minimum whatever
the global number does. An average hides a module going dark.

A floor whose path prefix matches **no file** is a hard failure, not a pass. A
floor over an empty set passes whatever happens to that module, which is worse
than no floor because it looks like protection. This is why the backend tier's
floors are listed as `plannedCriticalModules` and not yet enforced — they cannot
be added blind.

**3. Touched-file floor.** A production file changed by the pull request must
reach 60 % line coverage. A large global number cannot buy a new untested file.
`src/app/` and `src/styles/` are exempt: route handlers are covered through the
backend tier and stylesheets are not executable.

## Current unit-tier baseline

| Metric     | Value   | Raw     |
| ---------- | ------- | ------- |
| Lines      | 90.65 % | 407/449 |
| Statements | 88.85 % | 454/511 |
| Functions  | 86.33 % | 120/139 |
| Branches   | 83.56 % | 310/371 |

Re-established from a GitHub-hosted run at the move to `@vitest/coverage-v8`
4.1.11. The superseded figures — 93.26 / 93.26 / 84.75 / 93.61 — were measured
under 3.2.7 and are **not comparable** with these; see "When the coverage
provider changes major version". Note that lines and statements are no longer
equal, which is the signal that the basis moved.

### Enforced floors

| Module                     | Floor | Why                                                                                  |
| -------------------------- | ----- | ------------------------------------------------------------------------------------ |
| `src/server/errors`        | 95 %  | decides which text reaches a caller; a leak here discloses SQL, paths or tenant data |
| `src/server/db`            | 90 %  | optimistic concurrency and pagination bugs corrupt data or truncate results silently |
| `src/server/cache`         | 92 %  | a cache that ignores tenant scope is a cross-tenant disclosure                       |
| `src/server/http`          | 88 %  | validation, rate limiting and trusted-proxy handling are the outermost guard         |
| `src/server/observability` | 86 %  | correlation identifiers are how an incident is reconstructed                         |
| `src/server/worker`        | 95 %  | outbox retry decides whether an event is delivered once, never, or forever           |
| `src/lib/logging`          | 60 %  | the last thing between a credential and a public Actions log                         |
| `src/config`               | 50 %  | a bad environment value must fail at start, not at first request                     |

Each floor sits a few points below its measured value — enough headroom for
cross-platform attribution drift, tight enough that a real regression trips it.

`src/lib/logging` was **lowered from 72 % to 60 %** at the provider upgrade. The
72 was set against a vitest-3 measurement of 77.78 % on the single file that
prefix matches; vitest 4 measures the same untouched file at 64.00 % (16 of 25
lines). No line of it changed and no test of it was removed. 60 is one line below
the new measurement — the file carries 25 lines, so one line is exactly 4 pp and
15/25 is exactly 60.00 — which reproduces the shape of the old floor rather than
pinning it at the last number seen. It is deliberately not 64: a floor equal to
its own measurement is a transcript, not a guard.

## Closed gap

`src/shared/errors/app-error.ts` — 35 lines, **0 % covered**, and **zero
references anywhere in the repository** — was dead code superseded by
`src/server/errors/**`. It was deliberately **left in** the coverage include set
rather than excluded, because excluding it would have raised the global number by
hiding code rather than by testing it, and a baseline that improves because
something stopped being counted is a lie about the codebase.

**It has now been deleted**, along with its entry in the coverage `include` list.
That is the honest resolution: the code is gone, so it is neither counted nor
hidden. The baseline was re-measured rather than adjusted by hand.

The distinction the original note insisted on still holds, and the measurement
showed it plainly: **covered lines did not change**. They were 1355 before and
1355 after. Only the denominator fell, from 1488 to 1453 — exactly the 35 lines
this file contributed. Nothing became better tested.

Every count in the table below is a **`@vitest/coverage-v8` 3.2.7 measurement**
and describes a unit of account this tier no longer uses. It is kept, rather than
deleted or restated in today's numbers, because the deletion it records happened
under that provider and re-labelling those counts with 4.x figures would
manufacture a measurement nobody took. Read it as history. The tier today is
407/449 lines, 454/511 statements, 120/139 functions and 310/371 branches.

| Metric (vitest 3) | Before  | After   | Δ        | Counts                |
| ----------------- | ------- | ------- | -------- | --------------------- |
| Lines             | 91.06 % | 93.26 % | +2.20 pp | 1355/1488 → 1355/1453 |
| Statements        | 91.06 % | 93.26 % | +2.20 pp | 1355/1488 → 1355/1453 |
| Functions         | 84.87 % | 84.75 % | −0.12 pp | 101/119 → 100/118     |
| Branches          | 93.62 % | 93.61 % | −0.01 pp | 338/361 → 337/360     |

Lines and statements had their own rows here for a reason: they used to be a
single merged row, on the strength of the two being byte-identical in every
measurement this repository had ever produced. That identity was a **property of
v8 range mapping under vitest 3**, not a property of coverage, and it stopped
holding at the 4.0 major. A merged row would now be wrong; two rows carrying the
same historical figures record both the fact and the fact that it was contingent.

Three things a future reader should not be surprised by:

- **Functions and branches fell rather than rose.** The v8 provider _as vitest 3
  drove it_ counted the module's top-level scope as one covered function and one
  covered branch even though no statement inside it ever executed, so deleting
  the file removed one covered unit from each. These were baseline _reductions_,
  inside the 0.5 pp tolerance, and they were deliberate. Do not carry the
  behaviour forward as a general fact about v8: vitest 4 remaps against the AST
  and attributes differently.
- The earlier estimate of **2.35 pp** for the line gain was slightly high; the
  measured gain was **2.20 pp**.
- None of these percentages can be compared against the current baseline table.

## The ratcheting procedure

Raising a baseline is a reviewable diff. So is lowering one — that is the point.

1. Make the change that improves coverage.
2. Run the tier's coverage locally, or read the number from the hosted run.
3. Update `global` in the baseline file **in the same commit**.
4. If a critical module rose meaningfully, raise its floor too. A floor that
   never moves stops being a ratchet.

To _lower_ a baseline, write the reason in the commit message. There is no
mechanism that stops you; there is a diff that makes it visible.

## When the coverage provider changes major version

The 0.5 pp tolerance above is justified by v8 line attribution shifting by
fractions of a point across Node patch releases. That justification does **not**
extend to a provider major, and treating a major as if it were drift is the
failure this section exists to prevent.

**A provider major changes the unit of account.** `@vitest/coverage-v8` 4.x
remaps coverage against the AST where 3.x mapped byte ranges. Covered and total
are then counting different things, so the old percentages and the new ones are
_incommensurable_ — not "close", not "within tolerance", but answers to two
different questions. A tier can move by ten points in either direction with no
test added, no test removed and no line of application source touched.

**The identity that names the change.** Under 3.x's range mapping, `lines` and
`statements` were byte-identical in every measurement this repository ever
produced, on every tier. That is a signature of the mapping, not a fact about the
code. **If the two diverge, the basis changed** — check the provider version
before looking for a regression. It is the cheapest available diagnostic and it
is why every baseline here records raw counts and not only percentages.

**The correct response is re-establishment with a documented control**, never a
widened tolerance and never a suppression:

1. Measure the tier on **both** sides of the upgrade — the last commit before it
   and the upgrade commit — and keep both reports.
2. Prove the code did not move. The control is the same file set and the same
   test count on both runs; state both numbers. A differing file set means you
   are comparing two tiers and the control is void.
3. Record the new figures from a **hosted** run where one exists. A hosted figure
   outranks a local one, which is the rule every baseline file here already
   states about itself.
4. Rewrite each baseline's `global` from that measurement, keeping whatever
   headroom convention the file already documents. A tier that records `global`
   at its measurement keeps doing that; a tier that records `global` below its
   measurement keeps that gap.
5. Keep the superseded numbers in the file, labelled with the provider they were
   measured under. A silent overwrite makes the next reader assume a regression.
6. **State the reason for every lowered number in the commit message**, as the
   ratcheting procedure above requires. "The provider changed" is a reason; it is
   only a reason once the control in step 2 is stated with it.
7. Re-examine the critical-module floors separately. They are absolute, so a
   re-based tier can put one underwater without the global ratchet noticing.

**What re-establishment must not be used to hide.** Numbers can fall because the
new provider reports something the old one concealed. Vitest 3 reported whole
files with `branches.total: 0`, and a gate that defines "nothing to cover" as
100 % scored them perfectly while no branch in them had ever been evaluated;
vitest 4 reports those branches, uncovered. That is a real gap becoming visible,
not an artefact — record it as such, say plainly that coverage did not improve
and did not hold, and track closing it as coverage work rather than folding it
into the baseline commit.

## Coverage artifacts

Uploaded even on failure: `coverage-summary.json`, `coverage-final.json`, the
HTML report, and `coverage-gate.json` with the per-metric comparison. No source
secret is uploaded — the reports contain file paths and hit counts only.
