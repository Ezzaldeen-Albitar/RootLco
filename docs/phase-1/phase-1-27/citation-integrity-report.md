# Phase 1-27 — citation integrity report

**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Status:** Exposure recorded — the named `client.ts` scope is REPAIRED and
anchored, and **no `action-result.ts` citation was repaired**; citation integrity
across this phase's records remains **PARTIAL**, with known drift ·
**Measured:** 2026-09-07, against base `3d752119`

**Company:** RootLco — Root Link Company · **Product:** CRM (temporary but
decided) · **Phase:** P1-27 — CRM and Vehicle Frontend ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review
under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. Method — resolution by content, never by offset

Every citation in this report was resolved **by content**. The literal symbol the
citation names was grepped in the target file at the commit that introduced the
citation, and grepped again at `HEAD`; the pair of results is the old and the new
line. No citation was moved by arithmetic on a diff.

That rule is not fastidiousness, and the cost of breaking it is measurable on
this tree. PR #339's line offsets predict that `client.ts:726-727` becomes
`786-787`. But that citation was written at `9eff8bd7`, against a file that was
then 728 lines long, and the construct it names is at **806-807** today. The
offsets are honest about the diff they describe; they are silent about every diff
that landed before the citation existed. **Offset arithmetic on a citation of
unknown age is wrong by an unknown amount**, and it is wrong in the direction
that looks right — it produces a plausible number, in range, pointing at real
code.

## 2. Measured exposure

The denominator is stated so the percentages below can be checked rather than
believed: **1556 citations across six documents**, counted at `3d752119`.

| document                       | citations | read by a gate     |
| ------------------------------ | --------- | ------------------ |
| `task-matrix.json`             | 643       | yes — the only one |
| `task-matrix-verdicts.json`    | 643       | no                 |
| `independent-task-audit.md`    | 135       | no                 |
| `finding-phase-disposition.md` | 73        | no                 |
| `adversarial-round-five.md`    | 50        | no                 |
| `continuation-checkpoint.md`   | 12        | no                 |
| **total**                      | **1556**  | **643 (41%)**      |

One document of the six is read by a gate at all. Inside it the coverage is
narrower again. Of the 643 citations in `task-matrix.json`, **199** cite a
`.test` file and **417** are line ranges — but only **134** are both, and the
`expect(` content check applies only to that intersection. Everything else is
checked for existence, or for nothing.

**134 of 1556 citations — 8.6% — receive any content check.** The remaining
1422 are checked for the existence of a file, or are not read by any gate.
**This slice repaired 23 of 1556 — 1.5%.**

## 3. Repaired — 23 occurrences

**Ten** distinct citations, appearing 23 times across the records: **13
occurrences edited by hand and 10 carried by a regenerated artefact**.

**The two numbers reconcile by counting occurrences, not rows:** the ten are
written as **10 cells in `task-matrix-verdicts.json`** — one of the ten is cited
by three separate cells, and two of the ten appear only in the markdown records
— **mirrored into 10 cells of the generated `task-matrix.json`**, plus **3
occurrences in the markdown records**. 10 + 10 + 3 = **23**, of which the 10 in
the generated matrix are the ones carried by regeneration and the other 13 were
edited by hand.

**Every one of the ten was correct when it was written.** Not one names a
construct that does not exist, and not one was a mistake at the keyboard. All of
the drift is later growth of the target file underneath a number that was true on
the day it was recorded.

| file        | cited   | resolves to |
| ----------- | ------- | ----------- |
| `client.ts` | 726-727 | 806-807     |
| `client.ts` | 697     | 757         |
| `client.ts` | 40-110  | 40-124      |
| `client.ts` | 591-665 | 655-745     |
| `client.ts` | 679-727 | 759-807     |
| `client.ts` | 350-352 | 365-367     |
| `client.ts` | 429-432 | 444-447     |
| `client.ts` | 488     | 503         |
| `client.ts` | 224-227 | 365-368     |
| `client.ts` | 226     | 367         |

Each repaired citation now carries the symbol it names, so the next reader — and
the gate — can resolve it by content rather than by trusting the number.

**No `action-result.ts` citation was repaired.** This scope contains exactly one
citation of that file, and it sits in `task-matrix-verdicts.json` cell 327, which
§4 records as superseded — so it is left standing, and every citation in the
table above is a `client.ts` one. Four further resolutions were **established and
deliberately not applied** for the same reason — `client.ts:369` -> 759,
`client.ts:218` -> 359, `action-result.ts:65` -> 102, and `client.ts:275` -> 463.
Their resolved targets are recorded in §4 so the follow-up does not have to do
that work again.

## 4. NOT repaired — claims, not line numbers

Nine rows, fifteen occurrences, deliberately left as they stand. This is the
load-bearing section of this report.

**The distinction is not between a citation that resolves and one that does
not.** All nine point at constructs that still exist in the source. What has
moved is not the line, it is the world around it: the behaviour each surrounding
claim describes was later **fixed**. Re-pointing the number would leave a
present-tense sentence attached to current code, asserting a defect that the code
no longer has. That converts a closed-defect record into a false statement about
the product, which is a worse outcome than a stale number, because a stale number
announces itself and a re-pointed one does not.

**Four in `continuation-checkpoint.md`, one at `independent-task-audit.md:71`**
are historical records that say so in their own text. The checkpoint is a
pre-fix root-cause narrative pinned to `ab87167`; the audit carries a SUPERSEDED
banner at its line 15. Their citations are **correctly stale** — they describe
the tree as it was, and that is what those documents are for.

**Four cells in `task-matrix-verdicts.json` — 68, 250, 276 and 327 — are the
serious case**, because that document is presented as a present-tense verdict
matrix and not as history.

- Cells **250** and **276** assert of a 409 that it "Resolves to
  `state.conflict.title` … no bespoke copy. Finding `H-02`". In the source,
  `failureMessageKey` at `apps/web/src/lib/api/client.ts:803-807` returns
  `state.conflict.title` only when `problem.code === CONCURRENT_CHANGE_CODE`,
  and `state.conflict.blocked.title` otherwise.
- Cell **327** asserts "no conflict-specific copy and no conflict test". The
  copy half of that is false. A residual may survive on the test half — there is
  no CRM screen conflict case — and that half is not adjudicated here.
- Cell **68** records `H-03` as a live DEFECT in an If-Match path that
  `profile-contract.ts:136-139` now retracts in the source.

**The resolutions were established anyway and are recorded here, unapplied**, so
that a follow-up that decides the claim question does not have to resolve the
lines a second time. None of the four was written into any document: applying one
would attach a present-tense sentence to current code and assert a defect the
code no longer has, which is what this section exists to refuse.

| cited                 | resolves to | where it is cited, and why it stands                                                           |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `client.ts`:369       | 759         | Cells 250 and 276 — the `H-02` contradiction below                                             |
| `client.ts`:218       | 359         | Cell 68 — `H-03` retracted in the source                                                       |
| `action-result.ts`:65 | 102         | Cell 327 — the only `action-result.ts` citation in this scope; its copy half is false          |
| `client.ts`:275       | 463         | Resolved while reading, then found to have **no referent**: no document under `docs/` cites it |

**The contradiction is stated plainly rather than resolved:** this phase's own
finding register, at `adversarial-round-five.md:131`, records `H-02` as **FIXED**,
closed by `fd511409`. The closure matrix therefore states as open a defect that
the phase's own evidence register states as closed. Deciding which of the two is
current is **re-adjudication of a verdict**, not the repair of a citation, and it
is out of scope here.

## 5. Other affected classes — measured or spot-checked, not repaired

**The i18n catalogues are the largest class.** `en.json` grew from 1092 lines to 3454. Twelve citations into the two catalogues were resolved by content and
**every one of them had drifted** — a 12 of 12 hit rate, which is why this class
is named first for the follow-up. The resolutions are recorded here so that work
does not have to be done twice:

| catalogue | cited   | resolves to |
| --------- | ------- | ----------- |
| `en.json` | 706     | 873         |
| `en.json` | 235-252 | 325-342     |
| `en.json` | 299-317 | 389-407     |
| `en.json` | 209-219 | 299-309     |
| `en.json` | 373-385 | 463-475     |
| `en.json` | 436-467 | 528-560     |
| `en.json` | 720-723 | 870-873     |
| `en.json` | 940-941 | 1111-1112   |
| `ar.json` | 235-252 | 325-342     |
| `ar.json` | 239-240 | 329-330     |
| `ar.json` | 273-290 | 363-380     |
| `ar.json` | 940-941 | 1111-1112   |

**One genuine authoring error, not drift.** `read-operation.ts:45` — cited at
`task-matrix.json:1445` and `task-matrix-verdicts.json:1061` — claims
`STATUS_BY_KIND.timeout`. `timeout:` was line **46** when the citation was
written and it is line 46 now. The number was never right, so no amount of
re-anchoring explains it; it is a different defect class from everything in §3.

**One value rewrite behind a surviving key.** `en.json` / `ar.json:940-941`
resolve cleanly to 1111-1112, but the English value of `vehicles.media.blocked`
was rewritten in the interval, so the citing cell now points at a string that no
longer supports the claim made about it. Re-anchoring the number alone would
**hide** that, which is the precise failure mode §4 exists to avoid.

**One short range.** `api-client.test.ts:726-800` starts exactly where it says it
does, but the `describe` block it means to enclose closes at 804.

**Drift is not universal.** These were spot-checked and are still exact at
`HEAD`: `read-operation.ts:52-61`, `:89` and `:92-100`; `env.ts:23` and `:128`;
`client-log.ts:265-267`, `:297` and `:448`.

**Bare-name ambiguity.** `client.ts` matches two tracked files in this
repository, so the three repaired markdown citations are unqualified and the
gate's resolver would refuse them if its corpus were widened past
`task-matrix.json`. `adversarial-round-five.md` also carries a deliberate
illustrative placeholder, `apps/web/tests/x.test.ts:10-20`, which is not a real
file and must not be treated as one.

## 6. Explicitly UNMEASURED

Named so that nothing below is read as covered by silence.

| not assessed                                                                                                       | why it matters                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| The roughly **190 unique citation strings** into `apps/web/src/app/**` and `apps/web/tests/**` in the two matrices | The largest untouched population; not resolved, not spot-checked                                            |
| The remaining citations in the four markdown records, beyond the 8 in this scope                                   | They were **counted** for §2 and not resolved                                                               |
| Every other phase's records — P1-28, P1-29, P1-30                                                                  | The same drift mechanism applies to them; this reading did not look                                         |
| Whether any un-audited citation's surrounding **claim** still holds                                                | §4 shows the claim can expire while the line resolves. That is a judgement no gate in this repository makes |

## 7. Coverage statement

**This repair is COMPLETE for its named scope** — the ten `client.ts` citations
listed in §3 — and those citations are now anchored to the symbols they name and
pinned by the baseline. **The scope does not include `action-result.ts`**: its
single citation is left standing for the reason §4 gives.

**Citation integrity across this phase's records remains PARTIAL, with known
drift**, quantified in §2 and §5 and left standing in §4.

**Nothing here should be read as "the documentation is verified".** 8.6% of the
citations in these six documents receive a content check; this slice moved 1.5%
of them; and no gate anywhere reads the claim a citation is attached to.

## 8. Follow-up

Two items, bounded.

**Re-anchor the remaining drifted citations, starting with the i18n class** —
the twelve resolutions in §5 are already measured and can be applied directly.

**Re-record the `unit` and the `web` tier from a new hosted run.** Both ledger
entries are hosted-provenance, taken at `17bbc814`, so
`npm run validate:p1-27-closing-values` reports **three** problems on this
branch and not one: `RUN_RECORD_STALE` for `unit`, `RUN_RECORD_FILE_COUNT_DISAGREES`
for `unit` (119 recorded against 120 in the tree), and `RUN_RECORD_STALE` for
`web` — the two stale entries each naming the same three new or changed
executable paths. One root cause, three symptoms: neither tier can go green
until a hosted run of a commit that carries this work exists to record.

**Owner:** the P1-27 record owner, Eng. Ezzaldeen Al-Bitar, under the existing
[Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).

**Acceptance criteria:**

1. Every citation is resolved **by content** at the commit that introduced it —
   never by offset arithmetic on a later diff.
2. Each re-anchored citation carries a `#symbol` anchor and is added to
   `.github/ci-baselines/p1-27-citation-anchors.json`.
3. The gate's corpus is widened past `task-matrix.json` to
   `task-matrix-verdicts.json` and the four markdown records. That requires two
   prerequisites first: qualifying the bare `client.ts` citations to a single
   tracked path, and exempting the `apps/web/tests/x.test.ts` illustrative
   placeholder.
4. Any citation whose surrounding **claim** is found SUPERSEDED is **reported**,
   in the shape of §4 — never silently re-pointed.
