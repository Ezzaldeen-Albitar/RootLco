# P1-20 change log

Covers **P1-20-DOC-002**. What changed, and what deliberately did not.

## Database

**No migration.** 119 migrations, no 120, none modified. `app_runtime` already held
`INSERT/SELECT/UPDATE` on every `svc` and `quo` table this phase writes, and
`INSERT/SELECT` on the three append-only ledgers, so no change request was required.

The only `supabase/` change is additive and idempotent: three read permission codes in
`seeds/04_iam_permission_catalog.sql` (93 → 96). Applying the seed twice leaves the
count at 96, and `validate:seed-state` exits 0.

## New modules

| Module            | Owns                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service-catalog` | `svc.services`, `service_categories`, `service_versions`, `standard_labor_times`, `branch_service_availability`                                             |
| `pricing`         | `svc.price_lists`, `price_list_versions`, `price_rules`, `price_list_assignments`, `discount_rules`, `pricing_approval_policies`, and the `org.tax_*` reads |
| `quotation`       | the whole `quo` schema                                                                                                                                      |

`svc` is split across two modules by **aggregate**, not arbitrarily: a service and its
price change for different reasons, under different permissions, and never in the same
transaction.

## New foundation

| Addition                                                  | Why it is foundation rather than a module                                                                                                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `callerHoldsPermission` in `server/auth/authorization.ts` | evaluates a bare permission code — the value `svc.pricing_approval_policies.required_permission_code` names, which appears in no `defineOperation` declaration. `iam.has_permission_in_scope` is already called in that file |
| `callerApprovalCeiling` in the same file                  | an approval limit is an authorization fact. Routing it through `@/modules/iam` forced that module's composition root, Supabase client configuration included, to boot on every discounted quotation line                     |
| `server/contracts/commercial-approval.ts`                 | inverts the work-order → quotation dependency. `quotation` already imports `work-order` for `requireWorkOrder`, so importing back would close a module cycle                                                                 |

Both authorization helpers were first written on the iam module surface and **removed
from there** once moved, rather than left as a second definition.

## Catalogs

| Catalog         | Before                     | After                                                               |
| --------------- | -------------------------- | ------------------------------------------------------------------- |
| IAM permissions | 93                         | **96** (`svc.service.read`, `svc.price.read`, `quo.quotation.read`) |
| `EVENT_CATALOG` | 31                         | **39**                                                              |
| Audit actions   | 110                        | **127**                                                             |
| OpenAPI         | 140 paths / 168 operations | **152 / 181**                                                       |

### Event naming reconciliation

The P1-10 backend contract anticipated `service.published.v1`,
`price-list.published.v1`, `quotation.created.v1` and so on. The `.v1` suffix is **not
used**: every shipped name in `EVENT_CATALOG` is unsuffixed and carries its version in
`schemaVersion`, which is also what `shared.event_outbox.schema_version` stores.
Encoding the version in two places that can disagree is the drift the registry exists
to prevent.

`quotation.item-decided` takes the **item** as its aggregate, matching where the
database actually records a decision.

## API surface — 13 operations

`GET /services` · `GET /price-lists` · `POST /price-lists` ·
`POST /price-lists/{priceListId}/versions` ·
`POST /price-lists/{priceListId}/versions/{versionId}/rules` ·
`POST /price-lists/{priceListId}/versions/{versionId}/publication` · `GET /prices` ·
`POST /quotations` · `GET /quotations/{quotationId}` ·
`POST /quotations/{quotationId}/revisions` · `POST /quotations/{quotationId}/issue` ·
`POST /quotation-items/{quotationItemId}/decisions` ·
`POST /quotation-revisions/{revisionId}/decisions`

Plus one extended operation: `POST /additional-work/{requestId}/approval` accepts an
optional `quotationRevisionRef` (BE-013).

### Path-grammar reconciliation

The phase prose specified `:issue`, `:revise` and `:decide`. The operation registry's
`PATH_PATTERN` accepts only lower-case literal or `{camelCase}` segments, so a
colon-action path **cannot be registered at all**. Sub-resource nouns are used, matching
the shipped convention (`/transition`, `/closure`, `/approval` already existed).

## CI

One new required check — `validate:p1-20-inventory` — and two strengthened:
the operation-coverage namespace allow-list gained `svc` and `quo`, and
`tests/openapi-contract.test.ts` gained eleven route imports. Nothing was weakened,
skipped or made advisory.

## One predecessor document regenerated

`docs/phase-1/phase-1-19/evidence/endpoint-inventory.md` changed by exactly one line:
its **total registry** count, 168 → 181. P1-19's own delivered count is unchanged at
58, and no P1-19 row was touched.

That document is GENERATED and `validate:p1-19-inventory` is a required CI check, so
leaving it stale would leave a gate red. Regenerating a derived document is not the
same as editing P1-19 history: no commit, gate record, or evidence claim of that phase
was altered.

## Tests

244 added: 60 unit, 184 backend — each figure MEASURED by running that one suite. The
line previously read "161 added: 56 unit, 105 backend", a count taken before Wave 9 and
never re-measured; it disagreed with qa-evidence.md in the same commit. `tests/backend/p1-20-helpers.ts` provides the fixtures
(principals, catalog, tax classes with and without a rate, quotation number sequences,
discount ceilings, price-list assignments).

## What this phase deliberately did NOT do

No frontend. No invoicing or billing. No payment. No stock reservation, issue or any
inventory mutation — asserted, not assumed: the link suite counts `inv.stock_movements`
before and after an accepted linkage and requires it unchanged. No Zoom. No
currency conversion. No tax jurisdiction default. No Benzene-specific path, default
tenant, default company or default branch. The product name remains
`[PRODUCT NAME — Pending Final Approval]`.

## Corrections made during the phase, and what they cost

Recorded because each was a real error in this phase's own work, found by running
something rather than by reading it.

| Correction                                                                                                                                                            | How it was found                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `assertPercentageRange` used `parseFloat` on a financial value                                                                                                        | writing the discount tests                                                                   |
| A zero-base guard in `exceedsThreshold` was unreachable                                                                                                               | a test that could not construct the case                                                     |
| `svc.price_lists.currency_code` has an FK to `shared.currencies`; only EUR/JOD/USD are seeded, and my comment claimed shape-only validation                           | a 500 on GBP                                                                                 |
| Duplicate price-list code and duplicate rule signature reached clients as `ERR-SYS-001`                                                                               | the same run                                                                                 |
| Every event `producer` used the schema prefix where the module name is required                                                                                       | publication failing at runtime; the three quotation producers would have failed identically  |
| The services handler imported `@/server/db/pagination`, which B4 forbids                                                                                              | the boundary gate                                                                            |
| `quo.quotation-detail` declared a rate-limit policy that does not exist                                                                                               | every detail call throwing                                                                   |
| `quo.quotation-create` needed `wo.work_order.read` as well                                                                                                            | a 404 that read like a missing work order                                                    |
| The permission probe booted the iam composition root                                                                                                                  | `EnvironmentValidationError` on a discounted line                                            |
| The traceability gate counted its own generated document as an anchor                                                                                                 | all 27 identifiers "resolving" the moment the file was written                               |
| The event scanner read a ternary's condition as an event type                                                                                                         | `accepted` reported as unregistered                                                          |
| Two test expectations were wrong rather than the code — the revision-wide refusal is `ERR-TRN-001` at the state gate, and problem documents carry no internal message | running them                                                                                 |
| The operation-coverage gate had no derived floor for `svc.`/`quo.` — the visible hook was extended, `DERIVED_PREFIXES` was not                                        | an independent review measuring the gate's own `--json`: 13/13 operations with `derived: []` |
| `expireLapsed` force-expired an ACCEPTED quotation, because a revision stays `issued` after approval                                                                  | reading what the roll-up actually writes                                                     |
| The commercial-approval port could be uninstalled in a process serving the approval endpoint                                                                          | a review tracing every importer of `@/modules/quotation`                                     |
| 20 declared coverage flags across 11 operations had no assertion that could fail on the defect they named                                                             | a dedicated flag-honesty audit                                                               |
| `lineBase` returned the exact scale-7 product, which `Decimal.parse(_, MONEY)` refuses                                                                                | the backend suite: 47 of 55 quotation tests 500ing on `100.0000 × 2.000`                     |
| `svc.discount.authorized` and `quo.additional_work.quotation_linked` were declared and emitted by nothing                                                             | a per-literal producer search                                                                |
| The quotation link was validated without a lock, into a column frozen at INSERT                                                                                       | a review of the write ordering                                                               |
| `quo.quotation.read` was not required to cite a revision, so `wo.additional_work.approve` alone disclosed a revision's standing                                       | the same review                                                                              |
| The link refusal named a FOREIGN work-order id, and the scope check ran after it                                                                                      | the same review                                                                              |
| Expiry and `commercialApproval` read the Node clock, not `now()`                                                                                                      | the same review                                                                              |
| `DecimalError`/`CurrencyMismatchError` reached callers as HTTP 500 on ordinary configuration                                                                          | a financial-correctness review                                                               |
| A role-derived approval ceiling ignored grant scope, crossing companies                                                                                               | a cross-reference from the architecture reviewer                                             |
| The task-anchor search still passed vacuously: `task-register.md` prints all 27 identifiers                                                                           | a second review, after the first blacklist fix                                               |
| `quotation.accepted`/`.rejected` payloads carried `grandTotal`                                                                                                        | a review of what an outbox row may hold                                                      |
| Four comments claimed the approval ceiling is read through `@/modules/iam`; it is the foundation helper                                                               | the architecture reviewer reading both call paths                                            |
| `commercial-approval.ts` claimed mutual module imports are "the shape this repository avoids" — three such pairs are live                                             | the same reviewer                                                                            |

### What Wave 9 cost, stated plainly

Sixteen further corrections, five of them Highs, found by four independent reviewers
after the branch was pushed and CI was green. Four are worth separating out:

- **Two were defects in my own earlier fixes**, not in the original implementation. The
  `lineBase` scale-7 regression was introduced by the totals-reconciliation fix from the
  previous session and would have 500ed the ordinary case; the first two attempts at the
  task-anchor rule were both still vacuous.
- **Four were false claims in evidence rather than defects in code** — the coverage
  flags, the isolation principals, the `@/modules/iam` comments, the mutual-import claim.
  That is the same failure mode P1-18 and P1-19 each had to remediate, and it is the one
  a green gate is least able to catch: every one of those gates passed.
- **The gate that should have caught the largest cluster was itself the defect.**
  Extending `parseProvidedFlags` to accept `svc|quo` made the gate _look_ extended while
  `derivedRequirements()` returned `[]` for all thirteen operations. A gate that reports
  success on an empty requirement set is worse than no gate, because it is cited as
  evidence.
- **One was a genuine behaviour change to a closed phase**, and it is recorded rather
  than smuggled: citing a quotation revision on a P1-19 additional-work approval now
  requires `quo.quotation.read`. Approvals that cite no quotation are unaffected.

## Gate record — P1-20 closed on protected `develop`

Added by the documentation-only gate branch
`gate/p1-20-service-catalog-pricing-quotation-backend`. No executable file changes.

| Item                     | Value                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------- |
| Feature PR               | #84 — merged into protected `develop`                                                  |
| Reviewed feature SHA     | `e7462536d183e410ff2db9792c7a6090df7f4698`                                             |
| Protected merge SHA      | `db7ef97a4c1e090911e22ddac5936f725470f084`                                             |
| Merge parents            | `0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0` + `e7462536d183e410ff2db9792c7a6090df7f4698` |
| Merge tree               | `dc644ea5821d1a8c7da8efd22ddf924cf15d31bf` — byte-identical to `e746253^{tree}`        |
| Protected push CI        | Run #267 (`30296722364`) — push / `develop` / `db7ef97` — **Success 4/4**, 6m 50s      |
| Decision                 | **Go — P1-20 Service Catalog, Pricing, and Quotation Backend Gate Passed**             |
| `origin/main`            | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — untouched                                 |

### Two evidence documents were corrected in this gate branch

Both were pre-final drafts that the feature branch shipped without updating, and both are
corrected here rather than left to be read as current:

- **`evidence/pull-request-body.md`** stated 13 operations, OpenAPI 152/181, unit 901 and
  a `PENDING` backend total. Those were the true figures **before** the service-catalog
  mutation surface was built. Correcting the file on the feature branch would have moved
  the head off `e746253` and invalidated the exact-SHA hosted-CI and clean-room evidence,
  so the corrected text was placed in the GitHub pull-request description — which is what
  the merge commit message derives from — and the committed copy is brought into line
  here.
- **`evidence/clean-room-validation.md`** recorded a run against
  `17e59ae51395bff064677abbfe9e15eebf716383`, whose delta to the merged tree is 37 files
  including the four new service-catalog routes and their suite. That run therefore did
  not cover the tree being gated. A clean room was re-run against the protected merge SHA
  and the document now records both.

Recording this rather than silently overwriting: a stale evidence document that reads as
current is the same failure mode this phase's largest finding turned on.
