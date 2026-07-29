# Wave 7 — Diagnostics

Feature SHA `f161c8d`, remediated in the commit that follows it, on
`feature/p1-19-module-foundation`, PR #82. Base of this wave: `c4dd9f0`.
**No migration and no seed changed.**

## Operations delivered

| Operation                              | Method | Path                                                 | Permission                |
| -------------------------------------- | ------ | ---------------------------------------------------- | ------------------------- |
| `dia.diagnostic-create`                | POST   | `/jobs/{jobId}/inspections`                          | `dia.diagnostic.record`   |
| `dia.diagnostic-list`                  | GET    | `/jobs/{jobId}/inspections`                          | `dia.diagnostic.read`     |
| `dia.diagnostic-detail`                | GET    | `/inspections/{inspectionId}`                        | `dia.diagnostic.read`     |
| `dia.diagnostic-history`               | GET    | `/inspections/{inspectionId}/history`                | `dia.diagnostic.read`     |
| `dia.diagnostic-transition`            | POST   | `/inspections/{inspectionId}/transition`             | `dia.diagnostic.record`   |
| `dia.diagnostic-complete`              | POST   | `/inspections/{inspectionId}/completion`             | `dia.diagnostic.complete` |
| `dia.diagnostic-item-result`           | PUT    | `/inspections/{inspectionId}/items/{templateItemId}` | `dia.diagnostic.record`   |
| `dia.diagnostic-measurement-record`    | POST   | `/inspections/{inspectionId}/measurements`           | `dia.diagnostic.record`   |
| `dia.diagnostic-dtc-record`            | POST   | `/inspections/{inspectionId}/dtcs`                   | `dia.diagnostic.record`   |
| `dia.diagnostic-finding-record`        | POST   | `/inspections/{inspectionId}/findings`               | `dia.diagnostic.record`   |
| `dia.diagnostic-evidence-record`       | POST   | `/inspections/{inspectionId}/evidence`               | `dia.diagnostic.record`   |
| `dia.diagnostic-recommendation-record` | POST   | `/inspections/{inspectionId}/recommendations`        | `dia.diagnostic.record`   |
| `dia.diagnostic-review`                | POST   | `/inspections/{inspectionId}/reviews`                | `dia.diagnostic.review`   |

The path vocabulary is `inspections`; every identifier inside the phase names the
real `dia` tables. Both are kept deliberately: renaming the table was never available
(the schema is frozen) and renaming the route would have broken a published path for
a cosmetic gain.

## This graph IS mirrored, and the reason is not a preference

`dia.guard_diagnostic_report_transition` holds a FIXED PL/pgSQL `IF` chain —
`draft → in_progress | cancelled`, `in_progress → completed | cancelled`, both
terminal — with no catalog table and no tenant override. So it is code, and code can
be mirrored, which is what every module before P1-19 did with its own trigger-enforced
graph.

The work-order and job graphs are the opposite: `wo.work_order_transitions` and
`wo.job_transitions` are tenant-overridable catalog TABLES, so a TypeScript copy would
refuse a tenant's own edge and drift the moment one was added. That is why `work-order`
reads its graphs and keeps no copy, and this module does the reverse.

A mirror is only worth what keeps it honest, so
[`tests/db/p1-19-diagnostic-graph-reconciliation.test.ts`](../../../../tests/db/p1-19-diagnostic-graph-reconciliation.test.ts)
pins `REPORT_TRANSITIONS` against the DEPLOYED function body, checks that both
terminal statuses have no outbound edge, that the mirror's key set equals the CHECK
vocabulary exactly, and that the completion gate still counts mandatory items of the
report's PINNED version. Without it the distinction would be a story rather than a
property.

## The pin is what makes a report readable years later

`dia.guard_diagnostic_report_refs` refuses any report that does not pin a **published**
template version, and `dia.guard_template_item_frozen` refuses every change to a
published version's items — including a soft-delete. So the questions a report was
asked can never change after the fact, and every read in this module goes through the
REPORT's `template_version_id` rather than the template's current version.

Both halves are asserted: a `draft` version is refused (and told apart from an unknown
one, which the guard's single `check_violation` cannot do), and an attempt to alter a
published version's items is refused by the deployed guard, probed directly because no
route can express it.

The diagnostic TYPE is derived from the template rather than accepted. The column is
NOT NULL and foreign-keyed but nothing makes it agree with the template's, so
accepting it would have made a report's own classification a caller's choice.

## Three rules the database does not enforce

Stated as application rules, not implied:

1. **Entries against a finished report.** `dia.report_item_results`,
   `dia.measurements`, `dia.dtc_records`, `dia.findings`, `dia.diagnostic_evidence`
   and `dia.recommendations` all reference the report by foreign key and none consults
   its status. A completed report would silently accept new entries, changing what it
   says after it was completed and reviewed — which is the entire reason completion
   means anything. Asserted, not described.
2. **Reviewer separation.** `dia.stamp_review()` makes attribution unforgeable, but
   nothing stops the report's author being the actor, and
   `dia.diagnostic_reports.created_by` is the only comparison the schema offers. Its
   limit is written down: it catches the report's CREATOR, not everyone who recorded an
   entry, because the schema records no per-entry authorship a review could check
   against.
3. **Only a completed report may be reviewed.** A draft could otherwise be signed off
   and then changed underneath the signature.

Separation is proved in BOTH directions by two principals one permission apart:
`FULL` creates reports and does **not** hold `dia.diagnostic.review`; `REVIEWER` holds
it and reviews someone else's report. `REVIEWER` reviewing its own report is refused
with `ERR-QMS-001`. Without that split a service refusing every review would have
passed.

## Range validation happens in the database, in `numeric`

`dia.measurements.measured_value` is bare `numeric` — no precision, no scale, no
range — so a reading crosses as a decimal STRING and the bound comparison runs in SQL
as `numeric`. The bounds come from `dia.template_items.validation_rule`, read with
`->>` and cast, so a JSON number and a decimal string both work.

`within_range` is three-valued and never flattened: `true` in spec, `false` out of
spec, `null` **no range was configured** — because `false` would assert an out-of-spec
reading that nobody checked. Bounds are inclusive, asserted at the boundary.

**An out-of-range reading is RECORDED, not refused.** A diagnostic exists to record
what is wrong with a vehicle; refusing the observation would make the worst cases
unreportable.

Naming an item pins the unit and the response type. `ck_template_items_unit` makes a
numeric item's unit mandatory, so a reading in different units against that item means
nothing, and a reading against a `boolean` item is incoherent — neither is a schema
rule, because the foreign key names no unit and no response type.

### The one asymmetry, stated rather than papered over

A numeric **answer** (`dia.report_item_results`) is bounded nowhere: `result_value` is
`text`, nothing on that path reads `validation_rule`, and the table has no
`within_range` column to record a verdict in. The same number entered as a
**measurement** against the same item IS judged. That is the frozen schema's
asymmetry, and it is now pinned by a test that writes an absurd answer, proves it is
stored unbounded, proves the column does not exist, and proves the same value as a
measurement comes back `withinRange: false`.

An earlier draft of three comments claimed the database bounded the answer too. It
does not, and the adversarial review caught it — see below.

## The `validation_rule` contract is this phase's decision

The column is nullable `jsonb` with no CHECK and no seeded row anywhere, so its shape
is not a schema fact. It is written down in the domain layer rather than implied by
the code that reads it: `min`, `max` (JSON number or decimal string) and `options`,
all optional, and a rule with none of them treated as no rule at all.

## Completion, and why it is a separate command

`dia.diagnostic.record` is what a technician needs to fill a report in;
`dia.diagnostic.complete` is the authority to declare it finished and frozen.
Declaring a vehicle inspected is a different act from writing down what was measured,
so the transition endpoint REFUSES `completed` — otherwise the second permission would
be bypassable by choosing the other URL, exactly as the work-order closure split had
to prevent.

`dia.guard_diagnostic_report_transition` is the enforcement and re-counts unanswered
mandatory items inside the same statement as the write. What the service adds is the
LIST: the guard can only say "not yet", and a technician told that without being told
which of forty items is missing has been told nothing. Every outstanding item comes
back at once as `ERR-DIA-001` violations keyed by the template's own item codes — the
identifiers the caller is already reading to fill the report in.

A mandatory item may be answered by a VALUE **or** by a documented not-applicable
reason. Skipping is possible and never silent.

## Audit, events and the ledger

Five audit actions registered (sorted pin 96 → 101). `dia.diagnostic.entry_recorded`
covers all six entry tables, each record naming its `entry_kind`: they are the same
fact — something was added to this report — and splitting them would make "what went
into this report" six audit queries instead of one.

`EVT-DIA-001` `diagnostic-report.completed` moved from `implementedIn: null` to
`'P1-19'`, and both pins were updated. It is the only event this module publishes:
completion is the fact closure blocker B4 waits for, and nothing downstream reacts to
a draft. The payload carries identity and provenance only.

The reason travels through `app.status_reason` — the same GUC contract as `wo`,
because `dia.emit_diagnostic_report_status_history` reads it and the report has no
reason column. A service that validated a reason and never published it would leave
every ledger row NULL, which is the Wave 4 defect one schema over; the suite reads the
reason back out of the ledger.

`dia.guard_diagnostic_report_status_coherence` refuses any ledger row whose `to_state`
differs from the report's current status, so the ledger cannot be written
independently. The emitter is AFTER UPDATE only, so creation writes nothing — hence
the derived `origin` block, the same shape and the same reason as the work-order and
job histories.

## Revision numbering — `P1-19-A-02`

`dia.diagnostic_reports.revision_number` carries only `CHECK (> 0)`. There is **no
unique index** on `(job_id, revision_number)` anywhere in the schema.

The mitigation is the platform's own pattern: `pg_advisory_xact_lock` then
`COALESCE(MAX(...), 0) + 1`, exactly as `document-repository.ts:208` does for document
versions. But that file can add "the advisory lock makes a collision rare, and the
constraint makes one impossible" and this one cannot — there is no constraint behind
it. Recorded as accepted item **P1-19-A-02**; a partial unique index would close it and
no migration is authorised in this phase. Nothing claims guaranteed monotonicity, and
the test asserts sequential numbering rather than staging a race a constraint could not
back.

Soft-deleted reports are included in the maximum deliberately: a revision number once
issued must not be re-issued, or two reports would claim to be the same revision.

## Two reconciliations, not inventions

- **`dia.recommendations` has no `finding_id`.** There is no column anywhere tying a
  recommendation to the finding that prompted it, so naming one is refused rather than
  silently dropped — a client must not believe it recorded provenance nothing stores.
  The test queries `information_schema` to prove the column's absence rather than
  asserting it in prose.
- **The chain the schema DOES support runs the other way.**
  `wo.additional_work_requests.originating_finding_id` links additional work to a
  FINDING, and Wave 6 resolves it through this module's `findingOrigin`. So
  "finding → additional work" is what the platform enforces; "recommendation →
  additional work" is what the brief asked for and the schema cannot hold.

## Gates at the Wave 7 head

| Gate                                      | Result                                     |
| ----------------------------------------- | ------------------------------------------ |
| format, lint, typecheck                   | Pass                                       |
| `validate:module-boundaries`              | Pass, 313 files                            |
| `validate:authorization-coverage`         | Pass                                       |
| `validate:operation-coverage`             | **P1-19 45/45 operation depth, 0 pending** |
| `validate:openapi`                        | **131 paths / 155 operations**             |
| `validate:wo-tech-dia-qms-classification` | Pass, 657 columns                          |
| `validate:encoding`, `security:all`       | Pass                                       |
| `build`                                   | Pass                                       |
| Unit / Backend / Database                 | **843 / 1018 / 1610**                      |

60 backend tests in `p1-19-diagnostics.test.ts` and 6 DB tests in the new graph
reconciliation.

**One flake, recorded rather than hidden.** The first full `test:db` run failed two
cases in `shared event-outbox worker lifecycle`; both passed in isolation and on a
clean full re-run (1610/1610). Not attributable to this wave — nothing in the diff
touches the outbox worker, and the same pair flaked in Wave 3 for the same reason.

## Adversarial review at `f161c8d`

Five independent read-only reviewers — authorization, database contract, correctness,
API/registries, QA and evidence — each finding handed to an independent verifier
prompted to REFUTE it.

**29 raised, 3 confirmed, 26 refuted. 0 Critical, 0 High. 1 Medium, 2 Low, all fixed.**

| #   | Severity | What it was                                                                               |
| --- | -------- | ----------------------------------------------------------------------------------------- |
| 1   | Medium   | `dia.diagnostic-transition` was credited with five evidence flags no assertion backed     |
| 2   | Low      | Three comments claimed the database bounds a numeric item RESULT; nothing does            |
| 3   | Low      | An event-catalog comment said only `wo` publishes in P1-19, falsified by this same commit |

1. **The transition operation now has its own probes.** Its `COVERAGE-EVIDENCE` header
   declared cross-tenant, isolation, stale-version and idempotency while the suite
   asserted them only for COMPLETION — and the coverage gate could not catch it,
   because it checks that an operation id appears in executable code, not that an
   assertion backs each claimed flag. That is the same weakness that produced eight
   falsely credited operations in P1-17, and it produced this. Five cases now drive the
   transition endpoint itself: an unpermitted caller, both narrowed principals, a
   cross-tenant caller, a stale version, a missing `If-Match`, an idempotent replay
   proving one ledger row, and the reason read back out of the ledger.
2. **The three false comments are corrected and the real behaviour is pinned.** The
   claim was that a numeric answer is bounded in the database as `numeric`. It is not —
   the table is `text`, nothing reads `validation_rule` on that path, and there is no
   column to record a verdict in. Refusing an out-of-range answer would have been the
   wrong fix: it contradicts the module's own rule that an out-of-spec observation is
   recorded. So the comments now state the asymmetry, and a test proves both sides of
   it.
3. **The event-catalog comment is corrected.** P1-19 now publishes from two schemas,
   `wo` and `dia`, and the comment said one — in a file the same commit edited.

The 26 refutations included one plausible High — that `25.100001` does not distinguish
a SQL comparison from a JavaScript one — and several Mediums about the measurement
CASE, the completion route's body handling and the graph reconciliation's regexes.
Each was checked against the schema and the platform code and found misread, already
prevented, or a coverage observation about correct code. They are in the run journal
rather than here: a finding that did not survive verification is not evidence about the
code.
