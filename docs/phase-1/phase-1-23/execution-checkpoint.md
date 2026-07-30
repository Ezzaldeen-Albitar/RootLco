# P1-23 — execution checkpoint

## Baseline (verified, not recalled)

|                                    |                                                                 |
| ---------------------------------- | --------------------------------------------------------------- |
| `P1_23_BASE_SHA`                   | `9f7ef083ba90be3343aec2be1c721e3826070946`                      |
| `P1_23_BASE_TREE`                  | `a921cae307dd9310fa5f51b7431a6ebe0d4d08ee`                      |
| `origin/main` at start             | `5f30902d4a19241eded98e0f675301edb0ee5669`                      |
| develop/main synchronized at start | **yes** — trees identical, `--is-ancestor` exit 0, diff 0 files |
| Branch                             | `feature/p1-23-documents-notifications-reporting-backend`       |
| Worktree                           | `C:/Users/EZZALD~1/AppData/Local/Temp/claude/p23`               |
| Migrations                         | 119, no 120                                                     |
| Prior closure                      | Pre-P1-23 Dependency Maintenance Batch — 100/100 VERIFIED       |

Open PR at start: **#138** (Dependabot re-proposing `hadolint-action` 3.4.0).
Closed as a duplicate of the tracked deferral **#136** — its blocker is
unchanged and no ignore was added because it is a _minor_. Open PRs then **0**.

## Wave 0 — baseline and archaeology · COMPLETE

- Protected baseline verified synchronized before the phase began.
- Branch created from the exact protected develop SHA.
- [`contract-archaeology.md`](contract-archaeology.md) written from the tree.

### What archaeology changed about the plan

**P1-15 already built most of this phase's write lifecycles.** Twenty-one
`shared.*` operations exist covering upload authorization, version
register/reject, download authorization, entity links, the full template
lifecycle, notification enqueue and export authorization. P1-23 is therefore
_additive_ — it supplies the **read, observability, retention and reporting**
surface those phases deliberately left out.

**No migration 120 is required.** Every table exists: `shared.documents`,
`document_versions`, `document_links`, `file_scan_results`, `retention_classes`,
`legal_holds`, `message_templates`, `template_versions`, `outbound_messages`,
`delivery_attempts`, plus `rpt.report_configurations`,
`report_configuration_versions`, `saved_filters`.

**The role split decides the notification design.** `app_runtime` may only
INSERT a `pending` message (policy-pinned, requires `shared.notification.send`)
and holds **no** UPDATE on `outbound_messages` and **nothing** on
`delivery_attempts`; `app_worker` owns `status`/`failure_class` UPDATE and
attempt INSERT. So a request can _ask_ for a send and can never claim one.
**Manual retry cannot be a request-runtime UPDATE** — recorded as a contract
boundary in the archaeology.

**The approved state vocabulary already exists** and must not be invented:
messages `pending→queued→sending→sent→delivered|failed|cancelled` with retry
only as `failed→queued`; attempts `started|accepted|delivered|errored` — which
already distinguishes provider acceptance from delivery.

**`rpt.report_configurations.export_permission_code`** is an FK to
`iam.permissions`, so per-report export permission separate from view permission
is a contract fact, not a design choice.

## Next exact action

Wave 0 remainder: repair operation-coverage namespace derivation
(`scripts/ci/check-operation-test-coverage.mjs`) so P1-23 namespaces derive
evidence, and add the permanent gate tests, **before** declaring any operation.

## Invariants to re-check at every wave

migrations 119 · no 120 · schema hash `a677eb05…` · production audit 0 ·
application CodeQL Critical 0 / High 0 · no deployment · no tag · P1-24 not
started · no real email sent · no real customer document uploaded.
