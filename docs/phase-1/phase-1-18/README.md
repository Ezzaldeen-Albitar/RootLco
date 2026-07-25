# Phase 1-18 — Appointment and Reception Backend

**Status: in execution. The owner gate is `Decision: Pending` and stays Pending
until the evidence below exists.** Nothing in this document may be read as a
gate decision.

Product name: `[PRODUCT NAME — Pending Final Approval]`. Benzene remains the
configurable first tenant and pilot, and appears nowhere in product code,
database behaviour, permissions, workflows, routes, or shared defaults.

| Item          | Value                                         |
| ------------- | --------------------------------------------- |
| Phase         | P1-18 — Appointment and Reception Backend     |
| Exit gate     | P1-G18                                        |
| Base          | `origin/develop` = `9d685e3`                  |
| Branch        | `feature/p1-18-appointment-reception-backend` |
| Dependencies  | P1-8, P1-13, P1-14, P1-15, P1-16, P1-17       |
| Database work | **Not applicable** — no migration is added    |

## 1. Purpose

Build the backend for booking a service appointment and for receiving a vehicle
into a branch: the appointment lifecycle, walk-in and appointment-originated
check-in, the party and authorization contract that decides whose instruction
the workshop may act on, pre-service condition evidence, signatures and refusals,
reception approval, and conversion of an approved reception into exactly one work
order.

The phase consumes the frozen Phase 1-8 `apt`/`rec` schema and the Phase 1-9 `wo`
schema unchanged. It writes no DDL.

## 2. Database capability verdict

```
P1-18 DATABASE CAPABILITY AUDIT — NO BLOCKERS
```

Established before implementation began, by executing all 21 required capability
proofs plus two negative controls through the real `app_runtime` runtime role
under the transaction-scoped context contract — the same mechanism the backend
repositories use — inside a transaction that was rolled back.

Proven: appointment creation, reschedule, confirm, cancel and no-show; walk-in
representation; appointment-to-reception conversion; atomic accepted check-in via
`rec.accept_check_in`; party and vehicle linkage; authorization evidence;
complaint capture; visual inspection; condition items; damage maps and marks
bound to an exact document version; contents; signatures and refusals; the
approval transition; work-order creation; reception-to-work-order linkage; audit
and transactional outbox; idempotency persistence; and the stale-version guard.

Negative controls: a cross-tenant walk-in INSERT was refused (`42501`), and an
UPDATE of a recorded signature was refused (`42501`) — `rec.signatures` carries no
UPDATE grant for any application role.

**No database change request was required.** No migration was added or modified;
the baseline remains 119 migrations with no migration 120.

### Three frozen facts that shaped the design

1. **`apt.appointments.requested_from` / `requested_to` are immutable.** The
   `tg_appointments_immutable` trigger lists them, and the audit reproduced the
   refusal (`23514: column requested_from is immutable`). The requested window
   records what the customer asked for and is never rewritten. **Rescheduling
   therefore moves the confirmed window** — which is also the window the
   same-vehicle overlap `EXCLUDE` guards, so conflict detection (FR-APT-002) and
   rescheduling (FR-APT-004) act on the same column pair by design.

2. **Conversion is guarded twice, and the second guard was nearly missed.** The
   initial capability audit enumerated `pg_constraint` and concluded that
   `wo.work_orders` had no uniqueness on `reception_visit_id`, so exactly-once
   conversion would be an application guarantee alone. That was wrong, and the
   error was caught during implementation by reading the migration rather than the
   catalog: the guard is a partial unique **index**, which is not a constraint row
   and so never appeared in the audit's output —

   ```sql
   CREATE UNIQUE INDEX uq_work_orders_ordinary_origin
     ON wo.work_orders (tenant_id, company_id, branch_id, reception_visit_id)
     WHERE kind = 'ordinary' AND deleted_at IS NULL;
   ```

   Both layers are therefore real and both are kept. The application locks the
   reception row, verifies no work order exists, inserts one, and moves the
   reception to the terminal `converted` state in the same transaction; the index
   is the database backstop that turns a lost race into `23505` rather than a
   duplicate. Exactly-once is proved behaviourally regardless — two concurrent
   conversions must leave exactly one work-order row.

3. **One open visit per vehicle — and P1-18 provides no way to close one.**
   `uq_reception_visits_open_vehicle` is unique on `(tenant_id, vehicle_id)` while
   the status is `opened`, `inspecting`, `authorized` **or `converted`**. Custody
   cannot be in two places, so a second reception for the same vehicle is refused
   until the first reaches `closed_without_work` or `refused`. `converted` counts
   as open, which is deliberate: the vehicle is still in the workshop.

   **The consequence must be stated plainly, because it bounds what this phase
   delivers.** Field 23 allocates no endpoint that closes a reception, and none is
   invented here, so **no P1-18 operation can write `closed_without_work` or
   `refused`** — those two statuses appear only in the domain's transition table.
   A vehicle that has been received once therefore cannot be received again
   through this backend: the second attempt is refused `409 ERR-RES-002` forever,
   whether the first visit was completed to `converted` or stranded at `opened`.
   Closing a visit belongs with delivery and custody release, which is the `sal`
   schema's contract and has no backend yet. Until that exists, the
   appointment → reception → work-order flow is **single-use per vehicle**. This
   is a scope boundary, not a defect in the frozen schema, and it is recorded as a
   known limitation in §7.

## 3. Architecture decision — one module, two schemas

P1-18 is implemented as a single module, `src/modules/reception`, spanning both
the `apt` and `rec` schemas, rather than as two modules.

The reason is the frozen origin contract. A reception visit has exactly one
origin — an appointment XOR a walk-in — and `rec.accept_check_in()` takes the
appointment id directly, while `rec.guard_reception_visit_refs` reads
`apt.appointments` to enforce that the appointment's vehicle equals the visit's
vehicle. Converting an appointment and opening a reception is therefore **one
transaction that both reads and writes `apt.appointments` and `rec.*`**. Splitting
them into two modules would put one module's UPDATE of the other's tables inside
that transaction, and ADR-001 rule 3 prohibits exactly that — cross-module table
access — not the shared transaction itself. (A transaction handed across a public
module surface is ordinary here: `index.ts` passes `db` into the shared-services
numbering allocator, as the CRM module does.) The database already treats these
two schemas as one bounded context; the module boundary follows it.

Operation ids keep the `apt.` and `rec.` prefixes, matching the schema and route
domains, exactly as the `vehicle` module registers `veh.` ids.

**A third schema, named because it will matter.** `reception-conversion-repository`
also reads and writes `wo.work_orders`. No `wo` module exists, so ADR-001 rule 3
is not engaged today — but it will be the moment P1-19 creates one, and at that
point either conversion moves behind a `wo` public surface or the rule is broken.
Recording it here so the boundary is a decision P1-19 makes deliberately rather
than one it inherits by surprise.

## 4. Route mapping decision

Canonical Field 23 writes four of its paths with colon-action notation
(`:reschedule`, `:cancel`, `:approve`, `:convert-to-work-order`). The operation registry's
`PATH_PATTERN` accepts only lower-case literal segments and `{camelCase}`
parameters, and colon paths are not portable on Windows filesystems. They are
mapped to slash subresources with **no semantic change**:

| Canonical                                     | Implemented                                            |
| --------------------------------------------- | ------------------------------------------------------ |
| `POST /appointments/{id}:reschedule`          | `POST /appointments/{appointmentId}/reschedule`        |
| `POST /appointments/{id}:cancel`              | `POST /appointments/{appointmentId}/cancel`            |
| `POST /receptions/{id}:approve`               | `POST /receptions/{receptionId}/approve`               |
| `POST /receptions/{id}:convert-to-work-order` | `POST /receptions/{receptionId}/convert-to-work-order` |

Field 23 allocates seven paths and the registry holds twelve operations, so
**five** routes are added beyond it. Each is justified by a distinct business
fact. Three of the five also carry a permission of their own; the other two share
one with the sibling operation they are separated from, and that is deliberate
rather than an oversight — recording a no-show is the same authority as
cancelling, and capturing a refusal to sign is the same authority as capturing a
signature. What separates them is the fact recorded, not the right to record it:

| Route                                  | Why it is not folded into another operation                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /appointments/{id}/no-show`      | The frozen schema models no-show as a terminal state with its own set-once evidence columns and its own coherence CHECK, mutually exclusive with cancellation. Folding it into cancel would merge two distinct business facts. Shares `apt.appointment.lifecycle.manage` with cancel.                                                                     |
| `POST /receptions/{id}/party-roles`    | Party-role selection decides whose instruction the workshop may act on, and carries `rec.reception.party.manage`.                                                                                                                                                                                                                                         |
| `POST /receptions/{id}/authorizations` | Authorization is the gate for approval and carries the high-risk `rec.reception.authorization.verify`.                                                                                                                                                                                                                                                    |
| `POST /receptions/{id}/signatures`     | A signature records what a party personally acknowledged, bound to an exact immutable document version. It carries the high-risk `rec.reception.signature.manage`, so it must not be reachable by a caller who holds only evidence-capture authority.                                                                                                     |
| `POST /receptions/{id}/refusals`       | A refusal must never be reachable by the same command as a signature, and must never be readable as consent. Shares `rec.reception.signature.manage` with signatures: the same person capturing a signature is the natural recorder of a refusal to give one. See the note below — that shared permission is bounded by an authority check, not by trust. |

**The shared permission is bounded, not trusted.** The remediation that made an
`authorization` refusal part of the standing decision (below) changed what this
route can cause: a refusal can now block approval and conversion, which is the
effect the high-risk `rec.reception.authorization.verify` guards. Sharing
`rec.reception.signature.manage` would then have made the cheaper permission the
cheaper way to block a reception permanently — and, because
`fk_refusals_partner` is tenant-wide, to record append-only that an uninvolved
partner refused. The permission is still shared, and the reasoning above still
holds for the other four refusal types; what closes the gap is that an
`authorization` refusal must additionally name a party who holds an active
authorizing role (`assertMayAuthorize`) and must name a party at all
(`assertRefusalAttributable`). Both are asserted through the route in
`tests/backend/p1-18-reception-evidence.test.ts` and each was mutation-proved.

### A withdrawal of authorization is honoured through both channels

`rec.authorizations` is append-only and superseded by later rows, so a party who
approved and then withdrew has a STANDING decision of `declined`. The frozen
guards cannot see that — `rec.guard_reception_transition` and
`wo.guard_work_order_refs` both ask only whether SOME approved row exists, so a
withdrawn approval satisfies them permanently. `assertStandingAuthorization`
closes that: approval and conversion require at least one standing `approved` and
no standing `declined`.

The remediation extended what counts as a withdrawal. A customer can withdraw in
two ways — a `declined` row in `rec.authorizations`, or an `authorization`-type
refusal in `rec.refusals` — and reading only the first left the second inert,
which is exactly the "a refusal read as consent" outcome the module exists to
prevent. `ReceptionRepository.standingAuthorizations` therefore unions both
tables and takes the latest row per partner
(`occurred_at`, then `created_at`, then `id`). Two consequences worth stating:

- an authorization refusal now **blocks** approval (`409 ERR-TRN-001`) and
  conversion until a later approval supersedes it; and
- because supersession is per party and by time, a later approval from the same
  party lifts the block — the refusal is never erased, it is outranked by that
  party's own later word.

Same-instant ties are resolved by `created_at` then `id`, so the outcome is
deterministic but arbitrary between an approval and a refusal recorded in the
same instant; see `P1-18-TIE-001` in §7.1.

### Known contract drift, recorded openly

- **Path.** Chapter 4 allocates `API-REC-001 = POST /api/v1/reception-visits`;
  P1-18 Field 23 allocates `POST /api/v1/receptions`. Two canonical documents
  give the same allocated operation two different paths. The phase's own Field 23
  is followed. This is a documented conflict, not a silent choice.
- **New reserved event.** P1-18 mints one platform-wide event name that did not
  exist before: `EVT-REC-002 reception.approved`, registered in
  `src/server/events/envelope.ts` and in the binding event-catalog standard. It is
  the only name this phase adds; the other two facts it publishes reuse reserved
  entries. Recorded here because a new reserved name is a contract other phases
  inherit.
- **Event name.** Chapter 4 Table 4.5 and the P1-08 boundary record allocate
  `EVT-REC-001 vehicle.checked-in.v1`; P1-18 Field 24 calls the same fact
  `reception.vehicle-checked-in.v1`. The **reserved catalog entry wins** and no
  duplicate is minted — one fact must not carry two event names.
- **Error codes.** Chapter 4 names `ERR-APT-001` and `ERR-REC-001`. Neither
  exists in the platform error catalog, and both meanings are already covered:
  a stale record version is `ERR-CON-001` (409) and a refused lifecycle move is
  `ERR-TRN-001` (409). P1-16 and P1-17 likewise minted no domain-specific codes.
  The mapping is documented rather than duplicated.
- **Test reference.** Six backend tasks, SEC-003 and QA-003 cite `TC-INTG-001`,
  which is the CRM/vehicle integration case; the appointment/reception
  integration case is `TC-INTG-002`. Recorded as a canonical inconsistency.

## 5. Reuse boundaries

P1-18 duplicates nothing from P1-15, P1-16 or P1-17.

- **Numbering** comes from the shared allocator using the sequence codes
  `appointment`, `reception_visit` and — for the work order conversion creates —
  `work_order`, all three already registered in P1-15's `SEQUENCE_DEFINITIONS`. No
  new sequence code is minted.
- **Documents and media** go through the P1-15 attachment service.
  `LINKABLE_ENTITY_TYPES` already contains `apt.appointments` and
  `rec.reception_visits`. No second storage or media framework is built, and no
  media payload is stored in `rec` — evidence references `shared.documents`. The
  one `bytea` column this phase writes is `rec.signatures.signature_hash`, a
  digest of at most 64 bytes, never the drawn image.
- **Customer and vehicle resolution** is not re-implemented. Neither the CRM nor
  the vehicle module exposes a public by-id resolver, so P1-18 resolves through
  the frozen composite tenant-scoped foreign keys inside its own repositories
  rather than adding a resolver to another phase's public surface.
- **Audit, outbox, idempotency, transactions, problem details, correlation** are
  the P1-13 foundation, used unchanged.

## 6. Scope

Covered: appointment creation, rescheduling, cancellation, no-show; walk-in
handling; appointment conversion; reception creation, validation, party-role
selection, authorization verification; complaint capture; visual inspection;
damage records; contents; media; signatures; refusals; reception approval;
reception-to-work-order conversion.

Not covered, and deliberately not built: frontend; new visual design; production
deployment; Benzene legacy-data migration; Zoom services; unapproved
country/tax/currency/payment/retention defaults; product-name finalization;
P1-19 implementation. Also not built, because no approved requirement asks for
them: capacity planning, bay or technician scheduling, holiday rules,
overbooking policy, customer notifications, pricing, payment, and any automated
worker that marks a no-show from elapsed time.

## 7. Limitations

- **A vehicle can be received only once through this backend.** No P1-18
  operation writes `closed_without_work` or `refused`, and `converted` is inside
  the open-vehicle unique index, so the second reception for a vehicle is refused
  permanently. Closing a visit is delivery/custody-release work with no backend
  yet. See §2, frozen fact 3 — this is the most consequential boundary of the phase.
- **A confirmed window cannot be set at creation.** `apt.appointment-create`
  refuses `confirmedFrom`/`confirmedTo`; the confirmed window is set by
  `apt.appointment-reschedule`, which is the only path that also moves the status
  into the range the same-vehicle exclusion constraint guards. Accepting the
  window at creation would store a booking guarantee that reserves nothing.
- **Recording a complaint or vehicle contents needs `iam.sensitive.view` in
  addition to the operation's own permission.** Both write a `restricted`
  narrative row whose frozen INSERT policy demands it. A caller holding only
  `rec.reception.evidence.manage` is refused those two kinds with a denial
  (`403 ERR-IAM-001`) and can record the other six. The composition is deliberate:
  a damage mark carries no personal narrative and must not require a
  sensitive-data capability.
- **No read operations.** Canonical Field 23 allocates seven write endpoints and
  no read endpoint; none is added, so no `apt.*.read` or `rec.*.read` permission
  is registered either. An unused permission is configuration that cannot be
  tested.
- **Conversion emits no event.** The approved event catalog contains no
  work-order-created event and P1-18 does not invent one.
- **Reception-to-work-order conversion creates a minimal work order** — the
  frozen required columns only, letting `kind`, `state`, `parts_forward_state`
  and `opened_at` take their database defaults. Jobs, service lines, parts and
  assignments belong to P1-19, which owns work-order construction.
- **Signatures record acknowledgement, not certified identity.** No legal
  digital-signature certification, no biometric verification, no malware-scanner
  acceptance and no production object storage is claimed.
- **P1-18-BE-008 (reception validation) has no canonical definition.** It is
  implemented as deterministic validation inside reception creation and approval
  rather than as a separate endpoint, because Field 23 allocates none.

## 7.1 Open follow-ups carried forward

| ID                       | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-18-A-01**           | `scope: 'branch'` is inert for the ten id-addressed P1-18 operations, whose company and branch are not known until the row is read inside the transaction. The two creation commands name a target and are contained; the rest rely on forced RLS and on the union of a caller's grants. Remediation is a platform change, not a P1-18 one.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **P1-18-R-02**           | The strict comment-stripping rule in `scripts/check-operation-test-coverage.mjs` governs P1-18 only. Applying it to every phase fails 39 operations across P1-16, P1-17 and IAM whose suites genuinely drive their operations but never write the id outside a header comment. Bounded, named debt — not a claim that those phases meet the stricter rule.                                                                                                                                                                                                                                                                                                                                                                                                    |
| **REC-LIFECYCLE-001**    | No P1-18 operation writes `closed_without_work` or `refused`, so a vehicle can be received once only. See §2, frozen fact 3 and §7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **P1-18-QA-BARRIER**     | Three of the four concurrency barriers (`p1-18-reception-create`, `-conversion`, `p1-18-appointment-lifecycle`) count any ungranted lock in the database rather than one correlated to the contended row, as `p1-18-reception-approval` does. The race itself is genuinely forced in all four — a third connection holds the row `FOR UPDATE` and the barrier throws rather than continuing — and `vitest.config.backend.ts` sets `fileParallelism: false`, so nothing else runs against the database concurrently. Accepted rather than half-corrected: naming the wrong relation would make a passing test fail intermittently, and the correlated form belongs with a shared helper rather than three hand-copies.                                         |
| **P1-18-QA-COMPANYHALF** | The appointment-scope guard compares company AND branch. The branch half is proven by two tests; the company half is defence-in-depth behind RLS and is not independently observable with the current fixtures — a company-scoped principal cannot see an appointment in another company at all, so the request is refused 404 before the comparison runs. Reaching it needs a caller holding a company-wide grant in one company plus some grant in the other. Found by a mutation that disabled only the company comparison and passed the whole suite; recorded rather than claimed as proven.                                                                                                                                                             |
| **P1-18-TIE-001**        | `standingAuthorizations` orders by `occurred_at`, then `created_at`, then `id`. An approval and an authorization refusal bearing the SAME `occurred_at` and the same `created_at` therefore resolve by `id`, which is arbitrary. Fail-safe would prefer `declined`. Not changed here because `occurred_at` is caller-supplied and `created_at` is `clock_timestamp()`, so a genuine tie needs two writes in the same microsecond with an identical caller-supplied instant; encoding the preference means an ORDER BY on a synthesised precedence column, and the safer form should be designed with the withdrawal contract rather than bolted onto a repository query. Deterministic today, arbitrary in that one case, recorded rather than left implicit. |
| **P1-18-LEX-001**        | `stripComments` in `scripts/check-operation-test-coverage.mjs` is a single-pass lexer over string, template, regex and comment contexts. Two constructs are handled conservatively rather than exactly: a regex literal appearing where `canPrecedeRegex` reads the preceding token as a value (for example directly after `return` on the same line) and a `//` sequence inside a `${…}` expression within a template literal. Both would strip slightly more than a full parser, never less, so the gate can only become STRICTER — an operation cannot be credited on evidence the lexer hallucinated. Unreachable in the current suites; a real parser is the correct fix if the pattern ever appears.                                                    |
| **P1-18-UUID-001**       | Identifier comparisons in the reception service use exact string equality, so a caller sending a differently-cased but equal UUID (`ABC…` for `abc…`) is refused where PostgreSQL's `uuid` type would treat the two as identical. Over-refusal only, never over-acceptance, and it matches the existing `vehicleId` comparison convention in the same file. Normalising would mean canonicalising every id at the validation boundary — a platform decision, not a P1-18 one.                                                                                                                                                                                                                                                                                 |
| **P1-18-SEC-ROLEPROBE**  | `assertAuthorizingRoleHeld` refuses a role the partner does not hold with the same non-disclosing 409 as the authority guard, but the 201-versus-409 split still lets a caller holding `rec.reception.authorization.verify` learn which of the four authorizing roles a partner holds on a visit. A correct guess writes a real, attributable decision and the misses write nothing. Narrower than the alternative: accepting the claimed role would put a false role on an immutable, dispute-facing row. Closing the channel needs a read contract for party roles, which Field 23 does not allocate.                                                                                                                                                       |

## 8. P1-19

**Not started.** No P1-19 code, test, migration or branch exists.
