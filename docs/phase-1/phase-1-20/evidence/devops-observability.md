# P1-20 DevOps and observability

Covers **P1-20-DO-001** (continuous-integration quality gate) and **P1-20-DO-002**
(structured logging, monitoring and alert routing).

## P1-20-DO-001 — the CI quality gate

P1-20 adds one new gate and strengthens two existing ones. Nothing was weakened, and
no check was made conditional.

### New: `npm run validate:p1-20-inventory`

`scripts/p1-20-endpoint-inventory.mjs`, wired into the `quality` job beside the P1-19
inventory gate. It derives this phase's surface from the operation registry and fails
the build when:

1. a declared permission code is absent from `supabase/seeds/04_iam_permission_catalog.sql`;
2. a declared audit action is absent from the controlled catalog, **or is filed there
   under a different class**;
3. a published event type is absent from `EVENT_CATALOG`, or is published by a module
   that does not own it;
4. an event this phase publishes still carries `implementedIn: null`;
5. an operation declares `scope: 'branch'` but its handler enforces no scope;
6. any of the 27 task identifiers resolves to no evidence anchor;
7. either generated document is stale.

Two design details are load-bearing.

**Comments are stripped before the scope search.** P1-19's equivalent guard was first
satisfied by the comment explaining the fix rather than by the fix, so prose cannot
satisfy a structural check here.

**The gate excludes its own outputs from the anchor search.** Its first version
counted `task-traceability.md` — which prints every identifier by construction — so
all 27 "resolved" the moment the file was written. That is the same vacuous-pass shape
as a route missing from both OpenAPI and its own contract test, reached from the other
direction.

The reconciliation direction is **code → catalog**, deliberately. Catalog → code
would be wrong: the seeds carry codes for phases not yet implemented, and a phase is
not obliged to consume all of them.

### Strengthened

- `scripts/check-operation-test-coverage.mjs` — its namespace allow-list gained `svc`
  and `quo`. Without that every P1-20 `COVERAGE-EVIDENCE` line was invisible to the
  strictest gate in the repository, and the file's own comment warns that a new phase
  must extend it in the same commit that registers its operations.
- `tests/openapi-contract.test.ts` — eleven route import lines. A route absent from
  that list is absent from the published document **and** the contract test still
  passes, because both sides agree on the same incomplete registry. Only the count
  arithmetic between `check-authorization-coverage.mjs` and `check-openapi.mjs`
  catches it.

### Full gate list exercised by this phase

Dependency integrity (`npm ci`) · format · lint · typecheck · module boundaries ·
authorization coverage · operation-to-test coverage · P1-19 inventory · **P1-20
inventory** · OpenAPI validation · OpenAPI generation parity · encoding hygiene ·
unit · production build · Docker dev and runner stages · non-root runtime assertion ·
database migrations · RLS and constraint suites · backend suite · seed-state
validation · `svc/quo/inv` financial-data classification · secret and sensitive-file
scan · tracked-key scan · scope-exclusion guard · browser-exposed-secret scan ·
no-fake-data guard.

**No `|| true` anywhere, and no check was skipped or made advisory.**

## P1-20-DO-002 — structured logging, monitoring and alert routing

### What the platform already provides

Every operation runs through `handleOperation`, which emits a structured line per
request carrying `service`, `version`, `env`, `module`, `operation`, `correlationId`,
`tenantRef`, `actorRef`, `durationMs`, `result` and — on failure — `errorCode`. P1-20
adds no logging of its own at the route layer, because doing so would duplicate that
envelope.

### What P1-20 deliberately does NOT log

- **No amount, subtotal, tax, discount or total.** A price is what the business
  charges every customer in a segment; it belongs in the audit trail (classified
  `restricted`) and in the database, not in an operational log line that is shipped
  and retained elsewhere.
- **No evidence content and no reference note.** Audit records the evidence row id and
  its kind. A log line carrying a customer's note would put it somewhere with a
  different retention rule than the record it belongs to.
- **No customer identity.** `payerPartnerRef` appears in audit as `internal`, never in
  a log.

Identifiers that DO appear are safe references — `quotationId`, `revisionId`,
`priceListId`, `serviceId`, company and branch — which a reader can only resolve by
holding the permission to read the underlying row.

### Operational review methods

| Symptom                              | Where to look                                                              | What it means                                                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quotation create fails `ERR-VAL-001` | log `msg` on the `quotation` module line                                   | one of: service not available at that branch on that date; no price configured; a price rule naming a tax class with no effective rate. The three carry distinct messages in the log; the client sees only `ERR-VAL-001`, by design |
| Price resolution fails `ERR-CON-001` | same                                                                       | two price rules tie on specificity **and** priority. Structurally impossible while `uq_price_rules_signature` exists, so this indicates that index was dropped or widened                                                           |
| Publication fails `check_violation`  | `svc.publish_price_list_version` raise text                                | the new `effectiveFrom` is at or before the currently open published version's start; succession is forward-only                                                                                                                    |
| Publication fails `ERR-VAL-001`      | log `msg`                                                                  | the version has no active rules. Publishing it would produce a version that resolves no price, and every later quotation line would fail far away looking like missing data                                                         |
| Issue fails `ERR-VAL-001`            | log `msg`                                                                  | the revision has no lines                                                                                                                                                                                                           |
| Decision fails `ERR-CON-001`         | log `msg`                                                                  | the presented revision is not the one being decided, or it has been superseded. Expected when a client held a stale read                                                                                                            |
| Decision fails `ERR-TRN-001`         | log `msg`                                                                  | the revision is not `issued`, or it has expired, or a rejection already made it terminal                                                                                                                                            |
| Additional-work link fails           | log `msg` on the `work-order` module line                                  | which of the seven link conditions failed — wrong work order, wrong scope, superseded, draft, expired, rejected, or awaiting decisions                                                                                              |
| Quotation stuck `active`             | `quo.approval_decisions` vs `quo.quotation_items` for the current revision | lines remain undecided; the roll-up returns `null` until every line has a decision                                                                                                                                                  |
| Expiry not applied                   | `quo.quotation_revisions.expires_at` vs `now()`                            | expiry is evaluated against the **database** clock, so an application-clock skew is not the cause                                                                                                                                   |
| Outbox row not consumed              | `shared.event_outbox` by `event_key`                                       | keys are deterministic (`quotation.revision-issued:<revisionId>`), so a duplicate publish collides rather than double-sending                                                                                                       |

### Alert routing

No new alert route is introduced, and that is a decision rather than an omission: the
platform has no provisioned alerting destination (ADR-012 — no environment beyond
Local is approved), so a routing rule written now could not be tested and would be an
unverifiable claim. The signals a future route should consume are named above and are
already emitted; wiring them is deferred to the phase that provisions a destination.

Sentry context is populated by the existing foundation integration from the same
`RequestContext`, so P1-20 operations appear with correlation, tenant, company,
branch, operation and safe error code without this phase adding a capture call.

### Worker contract

`QuotationService.expireLapsed(db, limit)` is bounded, idempotent, and evaluates lapse
against the database's `now()`, so a sweep and a per-request expiry check cannot
disagree. It skips a revision a concurrent decision has already moved out of `issued`
rather than forcing it — the freeze guard treats `superseded`/`rejected`/`expired` as
terminal, and the decision that got there first is the truth.

It is **not** wired to a scheduler in this phase. No production scheduling
infrastructure is provisioned, and inventing one would be exactly the fabrication the
phase boundary forbids. The method is the repository-supported contract a scheduler
will call; `P1-20-A-05` records the gap.
