# P1-31 — canonical reference locations

**Task:** P1-31-DOC-001. **Observed:** 2026-09-14. **Review recipient:** Eng. Ezzaldeen Al-Bitar.
This record distinguishes the Git checkout from the parent workspace containing the canonical
Word documents and their Markdown reference artifacts. The
[canonical-document policy](../../governance/canonical-documents.md) keeps the canonical Word
documents outside the repository. Those Word documents govern; the Markdown locations below
resolve references but do not acquire canonical authority. Finding a source does not establish
execution, acceptance or a change to its planned status.

## Physical source mapping

The paths below are relative to the parent workspace. From a normal repository checkout named
`RootLco`, they begin with `../documentation/` or `../phase-1/`. They were verified on the Owner's
workspace; hosted CI is not claimed to have these external files.

| Field 34 reference         | Existing source location                                  |
| -------------------------- | --------------------------------------------------------- |
| Requirements               | `documentation/04-chapter-03-requirements.md`             |
| Architecture               | `documentation/05-chapter-04-methodology-architecture.md` |
| Implementation plan        | `documentation/06-chapter-05-implementation-plan.md`      |
| Testing plan               | `documentation/07-chapter-06-testing-plan.md`             |
| Change log                 | `documentation/_registry/change-log.md`                   |
| Phase traceability         | `phase-1/10-phase-1-traceability-matrix.md`               |
| Phase decisions            | `phase-1/11-phase-1-open-decisions.md`                    |
| Phase risks                | `phase-1/12-phase-1-risk-register.md`                     |
| Phase deliverables         | `phase-1/13-phase-1-deliverable-manifest.md`              |
| Acceptance directory entry | `phase-1/_acceptance/README.md`                           |

The source-location inventory, byte lengths and SHA256 values are retained as LOCAL evidence in
`orchestration/evidence/p1-31/astra-fe009-20260914/physical-canonical-reference-map.json` in that
parent workspace. A directory entry does not prove that a phase-specific evidence packet has been
packaged there; packaging is a separate deliverable.

## Test definitions that resolve

The external testing plan contains all three test references used by the twenty-nine canonical
P1-31 task rows:

| Reference    | Source line at the recorded snapshot | Definition covers                                                                                        |
| ------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `TC-WTY-001` | 53                                   | Eligibility, claims, adjudication history and payer split                                                |
| `TC-QMS-001` | 56                                   | Closure quality gates, linked rework, required analysis/cost and independent sign-off                    |
| `TC-RPT-001` | 59                                   | Report scope, as-of/filter disclosure, sensitive export audit and the standard-report performance target |

Their actual-result, status, evidence and reviewer cells remain placeholders in the observed
source. These are test definitions, not passing test results. The task-by-task evidence account
must map the relevant obligations to actual artifacts and identify any cross-phase or unresolved
scope question. A warranty origin-row browser test, for example, does not establish claim
adjudication or payer splitting merely because it belongs to the same domain.

## Correction to the earlier absence claim

The preflight and closure records described a search confined to the repository as though it
established that the testing-plan source and numbered documentation tree did not exist. The
workspace inventory resolves that location question. Preserve the original observation with its
search scope and record this correction beside current claims. Do not carry a missing-file blocker
forward where the file now resolves, and do not replace it with a passing-test claim.

The remaining questions concern evidence coverage, source synchronization and any actual scope
or approval decision. The final decision packet must name those questions precisely. This record
does not change the canonical task status, resolve a business interpretation, create a second
canonical document tree, or grant QA/security certification.
