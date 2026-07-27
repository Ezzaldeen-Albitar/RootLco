# P1-20 — hostile audit: the CONFIRMED gap register

Produced by the hostile 100/100 completeness audit over `0d86a19..7a58272`, nine
independent reconciliation dimensions, every claimed gap adversarially verified by a
separate agent instructed to refute it.

**101 gaps claimed · 41 CONFIRMED · 47 OVERSTATED · 10 REFUTED.** Roughly half of what a
reconciler reports does not survive an adversarial check, which is why the verify pass
exists and why only the confirmed set is actionable.

Severity is the reconciler's, kept as reported rather than re-graded here.

## Read this caveat before acting on the grouping

The **counts are exact**: 101 claimed, 41 confirmed, 47 overstated, 10 refuted, taken from
the workflow journal. The **per-item pairing below is approximate.** Verifier results are
recorded in completion order rather than spawn order, so a title may sit under a verdict that
belongs to its neighbour. The authoritative per-finding verdict, with the verifier's full
reasoning and the file and line it checked, is in the run journal at
`subagents/workflows/wf_23515141-830/journal.jsonl`.

Treat this file as the work list, and re-read the journal entry before fixing any single item.
Locations were lost in export; the titles are specific enough to find the code, and the
journal has the exact references.

The four items whose confirmation I read in full and can vouch for individually:

1. **`discountRequestedBy` is accepted verbatim from the request body**, never validated
   against any principal and never recorded — so `maker_approver_distinct` is satisfied by
   naming any UUID other than the actor's. A separation-of-duties control that any caller can
   satisfy is not a control.
2. **The decision-path expiry gate read the process clock.** `assertDecidable` used
   `new Date()` and it is the only expiry gate on both shipped decision routes. **Fixed and
   pushed** in `2000db1`; verified 62/62 and 39/39.
3. **P1-20-BE-012's evidence write path is never executed by any test**, and the test named
   for it cannot fail on the defect it names.
4. **The money route schemas bound the decimal scale but not the integer part**, so an
   oversized amount reaches `numeric(18,4)` as a 500 instead of a field-level refusal.

## HIGH — 4

- **P1-20-BE-012's forged-attachment test cannot fail on the defect it names, and the evidence write path is never executed**
  - Location:
  - Minimal fix: Seed one document version linked to a different entity and one linked to the quotation; assert the unlinked one is refused with the link-specific message and the linked one produces a quo.approval_evidence row (count by SQL). That single fixture makes both the negative falsifiable and the positive path executed.
- **No P1-20 test replays an Idempotency-Key, so the `idempotency` flag on all eight idempotent writes proves only that the header is mandatory**
  - Location:
  - Minimal fix: Add one same-key replay case per idempotent operation asserting the replayed response body equals the first and that the row count is 1 (quo.quotation-item-decide already has the domain-level equivalent).
- **security-review.md still documents the wildcard/publication escalation as the design, after it was fixed**
  - Location:
  - Minimal fix: Replace the wildcard paragraph with the shipped rule (wildcard rule and publication both require the permission tenant-wide via callerHoldsPermissionTenantWide, i.e. an unrestricted grant), add that note to the publish and price-rule rows of the SEC-001 map, and add two abuse-case rows citing the tests "refuses a WILDCARD price rule" and "need an unrestricted grant".
- **Phase test totals are wrong in two documents, and the two contradict each other**
  - Location:
  - Minimal fix: Set the qa-evidence table to 34/24/21/47/60/12 with totals 58 unit / 140 backend / 198 phase; set change-log's Tests line to the same; update the six parenthesised counts in task-register.md and its "56 unit tests" to 58.

## MEDIUM — 19

- **P1-20-BE-010's "database clock on both sides" is false for the per-request expiry check, which is untested**
  - Location:
  - Minimal fix: Pass the repository's `serverNow(db)` into `assertDecidable` (the transaction is already open) and add one test that back-dates `expires_at` and asserts ERR-TRN-001 on `quo.quotation-item-decide`. If the app clock is retained deliberately, correct both documents to say so.
- **P1-20-BE-001 "Service management" ships as a read-only listing with no mutation surface**
  - Location:
  - Minimal fix: Restate BE-001 in the register as the catalog READ surface for this phase and raise the accepted limitation from an audit-catalog footnote to a task-level scope statement naming the missing operations, or add the create/update/publish operations the three orphan audit actions were registered for.
- **Most task proofs in the gate are substring checks that a skipped, renamed, or dead artifact satisfies**
  - Location:
  - Minimal fix: For `test` proofs, require the title to be preceded by `it(`/`test(`/`describe(` on the same line (rejecting `.skip`/`.todo`), and cross-check the title against a vitest `--reporter=json` run of the named file so a non-executing test fails the gate. Drop or replace the self-referential `TRACEABILITY` anchor, and give DO-002 an anchor in code rather than in its own document.
- **The incoherent company+branch pair — the documented reason `branchBelongsToCompany` exists — is untested, and no P1-20 fixture contains a company-scoped grant at all**
  - Location:
  - Minimal fix: Add two cases using the already-seeded COMPANY_A2 / BRANCH_A2_OF_COMPANY_A2: (1) as SVC_PRICE_SCOPED_A2, `GET /prices?companyId=COMPANY_A2&branchId=BRANCH_A2` must return ERR-VAL-001 with `branch_company_mismatch` and echo no amount; (2) the same pair as a price-rule selector must be refused and write no row. Add one company-scoped principal (a `scope_type='company'` grant row for COMPANY_A1) and assert what it may and may not do on the `/services` branch filter, so the behaviour is decided rather than incidental.
- **`payerPartnerRef` is client-supplied with no foreign key and no validation, so the forged-deciding-party control only requires echoing the creator's value**
  - Location:
  - Minimal fix: Validate `payerPartnerRef` at creation against the tenant's business partners — ideally against the parties recorded on the work order's reception visit, matching the P1-19 guard — and record the accepted `decidingPartyRef` as an `internal` detail on the `quo.quotation_item.decided` audit record.
- **quo.quotation-create — the mutation with the most writes has no atomicity test at all; both of its 'nothing was written' assertions are pre-check refusals**
  - Location:
  - Minimal fix: Add one case that pre-inserts a quo.quotations row carrying the quotation_number shared.number_sequences is about to render (collide on uq_quotations_number), then assert after the 4xx that next_value is unchanged and that no revision, item, audit record or outbox row for the failed attempt exists. Add 'rollback' to the COVERAGE-EVIDENCE line and to the operation's required list in scripts/check-operation-test-coverage.mjs:1406 so the flag cannot be dropped again.
- **Quotation approval evidence ignores the document-version scan status that its own helper returns**
  - Location:
  - Minimal fix: In resolveEvidenceRef, refuse when verified.status is in the same refused-state set the work-order path uses (lift EVIDENCE_REFUSED_STATES to a shared constant so the two cannot drift), with a test binding a quarantined version and asserting ERR-DOC-001 and zero quo.approval_evidence rows.
- **§QA-004 and devops-observability.md claim all P1-20 outbox keys collide on retry; two of the six cannot, because they are built from ids the database mints mid-transaction**
  - Location:
  - Minimal fix: Correct the two documents to enumerate all six shipped keys and to state, for quotation.created and quotation.item-decided, that the retry guard is the idempotency key and uq_approval_decisions_item rather than an outbox collision. Optionally re-key quotation.item-decided on the ITEM id (one decision per item is already terminal), which both restores collision-based dedup and makes a post-write rollback test possible.
- **Three surviving comments assert the discount ceiling and permission probe are read through @/modules/iam's public surface; the change-log records that fix as landed**
  - Location:
  - Minimal fix: Correct the three comments to name src/server/auth/authorization.ts as the reader, and amend change-log.md:146 so it does not claim a completed fix that left three of four instances in place.
- **The test named 'writes one financial audit record carrying the amount' never looks at the amount**
  - Location:
  - Minimal fix: Query iam.audit_record_details for the record and assert the amount field is present, equals the stored amount, and carries value_classification 'restricted'.
- **The published OpenAPI contract states no money shape at all; the Money schema is referenced zero times**
  - Location:
  - Minimal fix: Reference components.schemas.Money from at least the P1-20 money-bearing responses (or record the trivial-schema convention as an accepted platform limitation), and correct the Money pattern to 14 integer digits and 4 decimals.
- **security-review.md §SEC-001 documents superseded authorization behaviour for two of the thirteen operations**
  - Location:
  - Minimal fix: Update the two places in security-review.md to state the tenant-wide requirement: add a fourth column value for svc.price-list-version-publish naming callerHoldsPermissionTenantWide, and rewrite lines 60-62 to say a wildcard rule requires the permission granted tenant-wide (an unrestricted grant) rather than being left to the tenant check, citing tests/backend/p1-20-pricing.test.ts:1278 and :1323.
- **The `restricted` classification on the two money audit details the security review names is never asserted**
  - Location:
  - Minimal fix: Extend the existing two detail queries to cover svc.price_rule.recorded and quo.quotation_revision.issued, asserting the field name and `value_classification = 'restricted'`.
- **The operation-coverage gate's strict reference rule is satisfied for all 13 P1-20 operations by a describe() title**
  - Location:
  - Minimal fix: Require the id to appear in an executable position — e.g. an `OPERATION.id` reference, a `contextFor({ operation })`, or an assertion on the logged operation — rather than anywhere outside a comment.
- **The documented forward-only claim "a later one closes the prior effective_to" has no assertion**
  - Location:
  - Minimal fix: After the accepted publication, assert v1's `effective_to` equals the new `effective_from` and that exactly one published version has a NULL `effective_to`.
- **execution-checkpoint says the remediation is unpushed and names the wrong remote head**
  - Location:
  - Minimal fix: Set the pushed head to 7a58272, delete the "not yet pushed" sentence, and renumber the exact-next-action list to start at the CI/reproof step.
- **execution-checkpoint omits review pass 5 entirely, so its finding inventory understates the phase**
  - Location:
  - Minimal fix: Add a Wave 10 (or §Pass 5) row pointing at evidence/review-dispositions.md, and state the cumulative totals across all five passes (7 Highs, 14 Mediums, 13 Lows).
- **change-log.md "One predecessor document regenerated" — two were, the second with 562 added lines**
  - Location:
  - Minimal fix: Retitle to "Two predecessor documents regenerated" and add the phase-1-14 matrix with its cause (check-operation-test-coverage.mjs writes a matrix per phase) and its diff shape.
- **review-dispositions.md fixes 9 and 11 claim measurements that were never made or are already invalid**
  - Location:
  - Minimal fix: Point row 9 at the actual corrected counts (or make the correction), and re-state row 11 with the head figures 901 / 1217 and a note that 899 / 1211 were the 0096560 measurements.

## LOW — 18

- **The register's and QA evidence's test counts are stale at HEAD in five places**
  - Location:
  - Minimal fix: Re-measure and update the six-row table, the 190/56/134 line, the three register cells and RSK-24 — or state counts as "≥" and stop pinning exact numbers in prose.
- **security-review.md §SEC-003 states a 24-row abuse-case table that has 23 rows**
  - Location:
  - Minimal fix: Correct the count to 23 and qualify the two rows whose tests do not exercise the named control until those tests exist.
- **Two QA-evidence isolation-table rows point at the wrong test**
  - Location:
  - Minimal fix: Retitle the pricing case so the title matches what it now proves, and repoint the cross-tenant row at quotation.test.ts:1108 for item-decide.
- **Evidence written by the revision-wide decide path is referenced by no audit record, and security-review.md claims otherwise**
  - Location:
  - Minimal fix: Add an `evidenceCount` detail to the quo.quotation_revision.decided record (and, if the per-line trail is wanted, call auditDecision inside the loop), then correct security-review.md:186 to say what is actually recorded.
- **expireLapsed writes the revision before the quotation's optimistic guard and swallows the failure with `continue`**
  - Location:
  - Minimal fix: Move updateRevisionStatus after the successful quotation update, and replace `continue` with a thrown ERR-CON-001 (or an explicit comment naming the FOR UPDATE and the partial index as the reason it cannot fire).
- **No P1-20 test asserts the quo.quotation_status_history row that every quotation status change writes**
  - Location:
  - Minimal fix: Assert one history row with the expected from_status/to_status in the issue, accept and expire success cases, and assert zero in the issue rollback case. State in qa-evidence.md that `reason` is deliberately NULL because quotations have no reason-required edge.
- **versionGuarded on quo.quotation-revision-create cannot detect a lost update, because the guarded row's version never changes**
  - Location:
  - Minimal fix: Either drop the misleading disjunction and assert the actual deterministic outcome (two winners with distinct numbers, one per If-Match), or make the guard real by bumping the quotation's record_version when a revision is added — and say which in §QA-004.
- **The unit-test counts cited by RSK-24 and qa-evidence.md do not match the suites they name**
  - Location:
  - Minimal fix: Re-run the two unit files and correct the three numbers (34, 58, 192) in qa-evidence.md and the "32 unit tests" phrase in RSK-24.
- **Price resolution is not snapshot-stable across a quotation: one document can be priced from two published price-list versions**
  - Location:
  - Minimal fix: Take a shared lock on the resolved price list (or resolve all lines in one statement) for the duration of priceLines, and add a race test that publishes between two lines of one quotation.
- **"does not touch inventory" never checks that the approval it performs succeeded**
  - Location:
  - Minimal fix: Assert `status === 201` on the approval before comparing the movement counts.
- **The envelope suite is credited with a producer check it does not perform**
  - Location:
  - Minimal fix: Either grep the owning module for a `publishEvent({ eventType: … })` matching each implemented name, or soften the test title and the envelope.ts comment to what the assertions actually do.
- **The "requires If-Match" half of a stale-version test title is not exercised, and the documented 428 status is never asserted**
  - Location:
  - Minimal fix: Add a missing-If-Match case per version-guarded operation asserting status 428 and ERR-CON-002, or narrow the test title to what it proves.
- **"eleven route imports" — twelve were added to tests/openapi-contract.test.ts**
  - Location:
  - Minimal fix: Change "eleven" to "twelve" in both files.
- **Wave 4 credited with 5 operations; it delivered 6, and the wave table sums to 12 of 13**
  - Location:
  - Minimal fix: Change Wave 4 to "6 operations".
- **"Six more were recorded" — the same sentence lists seven**
  - Location:
  - Minimal fix: Change "Six more" to "Seven more".
- **"trimmed to the four flags that file proves" — the block declares five**
  - Location:
  - Minimal fix: Change "four flags" to "five flags".
- **RSK-24 claims 32 unit tests pin IEEE-754-unrepresentable values**
  - Location:
  - Minimal fix: Say "eight unit tests pin values IEEE-754 gets wrong, inside a 34-test exact-decimal suite".
- **execution-checkpoint commit table lists 7 of the branch's 16 commits**
  - Location:
  - Minimal fix: Extend the table through 7a58272 and label the e6bba08 verification block as historical.
