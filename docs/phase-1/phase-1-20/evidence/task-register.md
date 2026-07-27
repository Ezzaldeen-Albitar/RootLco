# P1-20 task register

The canonical 27 identifiers and where each is implemented and evidenced. Anchors are
verified mechanically by `scripts/p1-20-endpoint-inventory.mjs`, which fails the build
for any identifier that resolves nowhere — and excludes its own generated documents
from the search, so listing a task here is not what makes it resolve.

Covers **P1-20-DOC-001** (contract, catalog and traceability synchronization) and
**P1-20-DOC-002** (operator/developer guidance and change-log update).

## Backend — 14

| Task           | Title                                     | Implementation                                                                                          | Evidence                                                                                     |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `P1-20-BE-001` | Service management                        | `src/modules/service-catalog/` — `GET /api/v1/services`                                                 | `tests/backend/p1-20-service-catalog.test.ts` (21)                                           |
| `P1-20-BE-002` | Branch service availability               | `svc.branch_service_availability` read + `isSellableAt`; the availability filter on the catalog list    | same suite — branch-filter isolation cases; `P1-20-A-01` records the absent effective period |
| `P1-20-BE-003` | Standard labour time                      | `listLaborTimes` / `publishedVersion`, minutes as a `numeric(10,2)` STRING with an explicit `unit`      | `ServiceCatalogService.publishedVersion`; `P1-20-A-02` records the absent branch override    |
| `P1-20-BE-004` | Price-list selection                      | `svc.resolve_price` via `PriceResolutionService`; full lifecycle in `PriceListService`                  | `tests/backend/p1-20-pricing.test.ts` (35)                                                   |
| `P1-20-BE-005` | Tax calculation                           | `org.tax_classes`/`org.tax_rates` resolution; a missing rate is a refusal, not 0%                       | pricing suite — untaxed vs unrated cases                                                     |
| `P1-20-BE-006` | Discount authorization                    | `DiscountAuthorizationService` — policy threshold **and** `iam.approval_limits` ceiling, maker≠approver | `tests/unit/p1-20-discount-authorization.test.ts` (24)                                       |
| `P1-20-BE-007` | Quotation creation / versioning / sending | `QuotationService.create` / `revise` / `issue`                                                          | `tests/backend/p1-20-quotation.test.ts` (38)                                                 |
| `P1-20-BE-008` | Approval                                  | `QuotationDecisionService.decideItem` / `decideRevision`                                                | quotation suite — approval and roll-up                                                       |
| `P1-20-BE-009` | Rejection                                 | same services; `rejected` is the schema's word, not `declined`                                          | quotation suite — "treats one rejected line as a rejected quotation"                         |
| `P1-20-BE-010` | Expiration                                | `QuotationService.expireLapsed`, plus per-request `hasExpired`                                          | quotation suite — expiry refusals; link suite — expired revision                             |
| `P1-20-BE-011` | Revision                                  | `QuotationService.revise`; issued revisions are immutable                                               | quotation suite — "leaves an ISSUED revision unchanged when the price list is republished"   |
| `P1-20-BE-012` | Approval evidence                         | `AttachmentService.verifyEvidenceVersion` + `quo.approval_evidence`                                     | quotation suite — direct-key, shape-coupling and unlinked-document cases                     |
| `P1-20-BE-013` | Additional-work quotation                 | `CommercialApprovalReader` port; `wo.customer_approvals.quotation_revision_ref` set at INSERT           | `tests/backend/p1-20-additional-work-link.test.ts` (11)                                      |
| `P1-20-BE-014` | NUMERIC/DECIMAL source of truth           | `Decimal`/`Money` on scaled `bigint`; every amount computed in SQL                                      | `tests/unit/p1-20-decimal.test.ts` (32)                                                      |

## Security — 4

| Task            | Evidence                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `P1-20-SEC-001` | `evidence/security-review.md` §SEC-001 — full authorization map; structural scope guard                  |
| `P1-20-SEC-002` | `evidence/security-review.md` §SEC-002 — no price in the catalog read, money as strings, evidence policy |
| `P1-20-SEC-003` | `evidence/security-review.md` §SEC-003 — 24-row abuse-case table, each with its test                     |
| `P1-20-SEC-004` | `evidence/security-review.md` §SEC-004 — 17 audit actions, class agreement enforced twice                |

## QA — 5

| Task           | Evidence                                                                         |
| -------------- | -------------------------------------------------------------------------------- |
| `P1-20-QA-001` | `evidence/qa-evidence.md` §QA-001 — 56 unit tests, drift pins                    |
| `P1-20-QA-002` | `evidence/qa-evidence.md` §QA-002 — error-path matrix, OpenAPI parity arithmetic |
| `P1-20-QA-003` | `evidence/qa-evidence.md` §QA-003 — isolation table                              |
| `P1-20-QA-004` | `evidence/qa-evidence.md` §QA-004 — concurrency and rollback table               |
| `P1-20-QA-005` | `evidence/qa-evidence.md` §QA-005 — P1-19 regression 39/39, generated evidence   |

## DevOps — 2

| Task           | Evidence                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `P1-20-DO-001` | `evidence/devops-observability.md` §DO-001 — the new inventory gate and the two strengthened checks           |
| `P1-20-DO-002` | `evidence/devops-observability.md` §DO-002 — what is logged, what is deliberately not, and the operator table |

## Documentation — 2

| Task            | Evidence                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-20-DOC-001` | This register, `evidence/endpoint-inventory.md` and `evidence/task-traceability.md` (both generated), plus `evidence/wave-1-contract-archaeology.md` |
| `P1-20-DOC-002` | `evidence/devops-observability.md` operator table; `evidence/change-log.md`; `evidence/open-decisions.md`                                            |

## Totals

**27/27** identifiers, all resolving to at least one anchor outside this register and
outside the gate's own generated output.
