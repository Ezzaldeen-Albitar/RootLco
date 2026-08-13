# P1-28 — traceability: the record against the tree

**Classification:** Confidential — Commercial Product and Pilot Planning

`P1-28-DOC-001`. This page is the index of what binds to what. It states almost
no numbers of its own: every figure below is a **derived claim**, substituted
from the tree by `scripts/ci/check-p1-28-traceability.mjs`
(`npm run validate:p1-28-traceability`), and a figure that disagrees with the
tree fails the build naming the document, the marker and both values.

That arrangement is the whole point of the page. P1-27 closed two consecutive
waves on a sentence written in the present tense that its own successors
falsified, in the file whose job was to be current; and this phase corrected the
contract archaeology twice in one week, the second time because the first
correction was overtaken by PR #227 four days later. Correcting a hand-written
number produces a number that will be wrong again.

---

## 1. The axes DOC-001 owns, and where each is answered

| axis                   | answered by                                                               | held true by                                                                |
| ---------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Operation catalogue    | `contract-archaeology.md` §1 tables A-E                                   | every §5 binding resolved against the P1-24 operation register              |
| Error catalogue        | `contract-archaeology.md` conventions block and §5                        | the replay/refusal shapes are executed in `apps/web/tests/p1-28-qa.test.ts` |
| Permissions            | `evidence/traceability.json` → `permissions`, `composed-permissions.json` | both directions against the register; the composed rows against migrations  |
| Task mapping           | `canonical-plan.md` §5 → `task-matrix.json`                               | `validate:p1-28-matrix`, byte-identical to a fresh build                    |
| Test references        | `evidence/traceability.json` → `testIds`                                  | quoted case titles matched against comment-stripped source                  |
| Browser coverage       | `evidence/traceability.json` → `observedInBrowserBy`                      | the field may only cite `apps/web/tests/e2e/**`                             |
| Decision references    | `canonical-plan.md` §7                                                    | resolved by the SEC-004 gate's own reader, so the two cannot disagree       |
| Traceability of counts | the `derived:` markers in these documents                                 | this gate                                                                   |

## 2. The universe

<!-- derived: tasks total = 35 --> **35** canonical tasks —
<!-- derived: tasks Frontend = 22 --> **22** Frontend,
<!-- derived: tasks Security = 4 --> **4** Security,
<!-- derived: tasks QA = 5 --> **5** QA,
<!-- derived: tasks DevOps = 2 --> **2** DevOps and
<!-- derived: tasks Documentation = 2 --> **2** Documentation — read from

`canonical-plan.md` §5 rather than maintained beside it, so the state "a task
nothing lists" cannot come to exist. That state is exactly what P1-27 paid five
adversarial rounds for.

The judged matrix at this head holds
<!-- derived: matrix PASS = 25 --> **25** PASS,
<!-- derived: matrix PARTIAL = 10 --> **10** PARTIAL and
<!-- derived: matrix FAIL = 0 --> **0** FAIL across
<!-- derived: matrix taskCount = 35 --> **35** rows. Those verdicts are

judgements recorded in `task-matrix-verdicts.json`; this page does not argue
them, it only refuses to let their arithmetic drift.

## 3. Test references — the P1-27 defect that must not recur

P1-27 declared twenty-nine `TC-P1-27-*` ids across three documents and a
repository-wide search returned **nothing** for any of them. The plan said each
"will expand into the required path matrix", a future tense nobody discharged,
so twenty-nine canonical requirements sat with no binding at all.

P1-28 declares <!-- derived: testids declared = 22 --> **22** canonical test
ids. <!-- derived: testids bound = 22 --> **22** of them resolve to named,
executable cases and <!-- derived: testids unbound = 0 --> **0** are unbound.

The binding is data, not a search: `evidence/traceability.json` names the file
and **quotes the case titles**, and the gate matches each quoted title against
**comment-stripped** source. Twenty-two empty test files would have made a
search succeed and proved nothing; a title quoted out of a docblock would do the
same, which is why the stripper is the repository's scanner-with-modes rather
than a regular expression — this codebase has now shipped seven scanners that
read prose as code.

An id with no proof is not an error on its own: it must state its gap, and an
unstated gap fails the gate. Nothing is served by a record that can be satisfied
by silence.

## 4. Browser coverage — the one tier that is not a mock

`canonical-plan.md` §10 is quotable and binding: **mocks are test fixtures, and
mocks are not production-integration evidence.** Every P1-28 tier except one
mocks the transport, so `observedInBrowserBy` may cite only
`apps/web/tests/e2e/**` — the authenticated Playwright tier, where a real
session reaches the real Next.js server, the real API and the real database
under RLS. The gate refuses any other path in that field, and refuses a record
in which no id cites the browser at all.

<!-- derived: browser cases = 12 --> **12** browser cases across
<!-- derived: browser files = 1 --> **1** file are cited today. The tier

observes the honest blocked states as well as the working paths, and it seeds no
business row to manufacture a green one: an empty appointment-type catalogue
BLOCKS booking, and what the browser asserts is that the screen says so.

## 5. What this page is not

It is not a coverage claim. A cited case proves the sentence it is cited for and
nothing wider, and `matrixDischarged`-style completeness is not asserted
anywhere in this phase. It is also not a closure record: the phase is OPEN, no
`OWNER ACCEPTANCE` has been asked for or returned, and `main` is untouched.
