# P1-29 — permission matrix and dependency map

Every P1-29 action mapped to a real, seeded permission code; where each code is
enforced; what is orphaned; and what P1-29 needs from PRE-P1-29 in particular
rather than in general.

---

## 1. Where permissions are enforced — one place, not two

`handleOperation` calls `requirePermissions` before the handler body.
`evaluatePermissions` loops the operation declaration's `permissions[]` and asks
the database `iam.has_permission_in_scope(code, companyId, branchId)` for each.
All codes in a declaration must pass — the array is a **conjunction**.

Against that, the fact from
[contract-archaeology.md](contract-archaeology.md) section 10.3, restated
because it governs everything below:

> **124 RLS policies exist across `wo`, `tech`, `dia` and `qms`, and not one of
> them consults a permission code.** Every policy is pure tenant / company /
> branch isolation. The only permission literal anywhere in those schemas is
> `iam.sensitive.view`, on the three restricted sidecars.

So there is exactly **one** enforcement point per action, and it is the
operation declaration. There is no defence in depth for permissions in this
domain. Two consequences P1-29 must internalise:

1. **A missing or wrong code in a declaration is a live authorization hole**, not
   a cosmetic defect. It will not be caught by the database.
2. **`defineOperation` never checks a code against `iam.permissions`.** It
   rejects an empty array and nothing else — the registry's own test registers
   the fictitious code `a.b.c` and it passes. There is **no declaration-to-
   catalogue parity gate** in CI. Tracked as `INS-11`, and specified as `BE-5`
   in [backend-prerequisite-gate.md](backend-prerequisite-gate.md) — including
   why it must parse the `defineOperation` call rather than grep for a dotted
   string, since permission codes and **audit action** codes are
   indistinguishable by shape.

### 1.1 Client-side permission evaluation is usability-only, and fails closed

`apps/web/src/lib/permissions.ts`: `hasPermission` is an exact-match
`includes()` over the server-issued code list. There is no wildcard, no role
shortcut, no hierarchy; an unknown code means hidden; `NO_CAPABILITIES` is the
default. P1-29 must keep that posture — the client hides, the server refuses,
and the client never assumes.

---

## 2. The 22 domain codes

**The shipping catalogue on `develop` carries 112 codes, not 115**, and the
difference matters because it is `INS-42` biting a figure in this very document.

`supabase/seeds/04_iam_permission_catalog.sql:15` is the only
`INSERT INTO iam.permissions` in the tree — no migration writes the table — and
it carries **112 tuples, 112 unique codes, 17 domain prefixes**, pinned by
`.github/ci-baselines/schema-baseline.json:14` (`permissionCount: 112`).

The shared local container reports **115 across 18 domains**. The three extra
are `platform.organization.*` control-plane codes belonging to the **unmerged**
PRE-P1-29 B1 branch, which the shared Supabase instance has had applied to it.
**112 is the figure for `develop`; 115 describes a contaminated container.** Any
count taken from that container must say so.

By domain on `develop`: `apt` 4, `crm` 10, `dia` 4, `iam` 10, `inv` 9, `org` 9,
`qms` 5, `quo` 3, `rec` 12, `rpt` 3, `sal` 10, `shared` 6, `svc` 5, `tech` 4,
`veh` 7, `wo` 9, `wty` 2. Twenty-two belong to this domain: `wo` 9, `tech` 4,
`dia` 4, `qms` 5.

**Twenty-one are load-bearing. One is an orphan.**

| code                           | risk   | operations | notes                                                                                          |
| ------------------------------ | ------ | ---------: | ---------------------------------------------------------------------------------------------- |
| `wo.work_order.read`           | low    |         11 | the widest read code in the domain; also covers job history and the line/additional-work lists |
| `wo.work_order.create`         | high   |      **0** | **ORPHAN** — see section 3                                                                     |
| `wo.work_order.transition`     | medium |          3 | includes `qms.reopen-attempt`                                                                  |
| `wo.work_order.close`          | high   |          1 | only ever as a conjunction with `…transition`                                                  |
| `wo.work_order.line.manage`    | medium |          2 | service lines and required parts                                                               |
| `wo.job.manage`                | medium |          2 | create and update a job                                                                        |
| `wo.job.transition`            | medium |          1 | the only job state change                                                                      |
| `wo.additional_work.request`   | medium |          4 | request, withdraw, fulfilment, restricted detail                                               |
| `wo.additional_work.approve`   | high   |          1 | the customer decision, audit class APPROVAL                                                    |
| `tech.technician.read`         | low    |          4 | queue, availability, assignment list, labour list                                              |
| `tech.assignment.manage`       | medium |          3 | assign, reassign, end                                                                          |
| `tech.labor.record`            | low    |          2 | start and stop only                                                                            |
| `tech.labor.correct`           | high   |          1 | a linked correction                                                                            |
| `dia.diagnostic.read`          | low    |          3 | detail, history, list                                                                          |
| `dia.diagnostic.record`        | medium |      **8** | the widest single write code in the domain                                                     |
| `dia.diagnostic.complete`      | medium |          1 | separate from `record`                                                                         |
| `dia.diagnostic.review`        | high   |          1 | records an opinion only (see `INS-08`)                                                         |
| `qms.quality_control.read`     | low    |          6 | QC records and rework links                                                                    |
| `qms.quality_control.record`   | medium |          2 | open a record, write a check result                                                            |
| `qms.quality_control.finalize` | high   |          1 | pass or fail the record                                                                        |
| `qms.rework.manage`            | high   |          2 | create; cost (with `iam.sensitive.view`)                                                       |
| `qms.rework.sign_off`          | high   |          1 | deliberately separate from `manage`, for safety-critical rework                                |

### 2.1 Adjacent codes P1-29 must hold or handle

| code                      | why P1-29 touches it                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `rec.reception.convert`   | the only way an **ordinary** work order is created — the one other insert is A38, under `qms.rework.manage`                 |
| `iam.sensitive.view`      | required _in conjunction_ for the restricted additional-work detail, the technician certificate number, and the rework cost |
| `sal.*` (invoice preview) | the downstream boundary — see [integration-handoffs.md](integration-handoffs.md)                                            |

---

## 3. The orphan: `wo.work_order.create`

Seeded in `iam.permissions` with risk `high` and the description _"Convert a
reception visit into a work order"_. **Consulted by nothing**: zero
`defineOperation` declarations, zero RLS policies, zero `pg_proc` bodies. The
action it describes is gated on `rec.reception.convert` instead.

This is not a defect P1-29 should fix by wiring the code in — doing so would
change who can convert a reception, which is a P1-28 decision. It is recorded
so that:

- no P1-29 screen gates on it (it would render for nobody, or for the wrong
  body of people if a tenant granted it on the strength of its description); and
- the decision to retire it, re-point it, or leave it documented belongs to a
  governance step, not to this phase.

`INS-05`.

---

## 4. Action matrix

The question each row answers: _a user wants to do X — what code, what call, and
does it exist?_

| #   | action                                                                         | permission(s)                                                               | call                                                                                      | status                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | view the branch work-order board                                               | `wo.work_order.read`                                                        | `GET /work-orders` + mandatory `companyId`/`branchId`                                     | exists                                                                                                                                                  |
| A2  | open a work order (create)                                                     | `rec.reception.convert`                                                     | `POST /receptions/{id}/convert-to-work-order`                                             | exists, **not** in `wo`                                                                                                                                 |
| A3  | view a work order                                                              | `wo.work_order.read`                                                        | `GET /work-orders/{id}`                                                                   | exists                                                                                                                                                  |
| A4  | **edit the work-order header**                                                 | —                                                                           | —                                                                                         | **does not exist**: the item route exports GET only. What is editable is the order's _content_ (jobs, lines, parts, additional work), never its header. |
| A5  | move a work order between states                                               | `wo.work_order.transition`                                                  | `POST /work-orders/{id}/transition`                                                       | exists                                                                                                                                                  |
| A6  | cancel a work order                                                            | `wo.work_order.transition`                                                  | same endpoint, a `…→cancelled` edge, reason mandatory                                     | exists — **no separate cancel authority**                                                                                                               |
| A7  | close a work order                                                             | `wo.work_order.transition` **AND** `wo.work_order.close`                    | `POST /work-orders/{id}/closure`                                                          | exists                                                                                                                                                  |
| A8  | see why closure is refused                                                     | `wo.work_order.read`                                                        | `GET /work-orders/{id}/closure-eligibility`                                               | exists, reports all blockers at once                                                                                                                    |
| A9  | request a reopen                                                               | `wo.work_order.transition`                                                  | `POST /work-orders/{id}/reopen-attempts`                                                  | exists — **always refuses**, and records the attempt                                                                                                    |
| A10 | add a job                                                                      | `wo.job.manage`                                                             | `POST /work-orders/{id}/jobs`                                                             | exists                                                                                                                                                  |
| A11 | edit a job                                                                     | `wo.job.manage`                                                             | `PATCH /jobs/{jobId}`                                                                     | exists                                                                                                                                                  |
| A12 | **read one job**                                                               | —                                                                           | —                                                                                         | **does not exist** (`INS-03`) — only via the parent's `jobs[]`                                                                                          |
| A13 | move a job between states                                                      | `wo.job.transition`                                                         | `POST /jobs/{jobId}/transition`                                                           | exists                                                                                                                                                  |
| A14 | assign a technician                                                            | `tech.assignment.manage`                                                    | `POST /jobs/{jobId}/assignments`                                                          | exists                                                                                                                                                  |
| A15 | pick a candidate technician                                                    | `tech.technician.read`                                                      | `GET /technicians/available` (`companyId`,`branchId`,`from`,`to` all required)            | exists                                                                                                                                                  |
| A16 | reassign                                                                       | `tech.assignment.manage`                                                    | `POST /jobs/{jobId}/reassignments`                                                        | exists — a distinct operation, same code                                                                                                                |
| A17 | end an assignment without replacing                                            | `tech.assignment.manage`                                                    | `POST /assignments/{assignmentId}/end`                                                    | exists                                                                                                                                                  |
| A18 | **start work**                                                                 | `wo.job.transition` **+** `tech.labor.record`                               | **two calls**: transition `assigned→in_progress`, and `POST /jobs/{jobId}/labor-sessions` | composed                                                                                                                                                |
| A19 | **pause work**                                                                 | `tech.labor.record` **+** `wo.job.transition`                               | **two calls**: stop the open session, transition `in_progress→paused` (reason mandatory)  | composed; no pause endpoint and no pause column                                                                                                         |
| A20 | **resume work**                                                                | `wo.job.transition` **+** `tech.labor.record`                               | transition `paused→in_progress`, start a new session                                      | composed                                                                                                                                                |
| A21 | complete an operation                                                          | `wo.job.transition`                                                         | transition `in_progress→completed`                                                        | exists; ending the assignment is a separate call under `tech.assignment.manage`                                                                         |
| A22 | correct a labour session                                                       | `tech.labor.correct`                                                        | `POST /labor-sessions/{id}/corrections`                                                   | exists; soft-deletes the original, reason mandatory                                                                                                     |
| A23 | see my own queue                                                               | `tech.technician.read`                                                      | `GET /technicians/{profileId}/queue`                                                      | exists — but **the caller cannot learn their own `profileId`** (`INS-04`)                                                                               |
| A24 | open a diagnostic report                                                       | `dia.diagnostic.record`                                                     | `POST /jobs/{jobId}/inspections`                                                          | exists — **requires a `templateVersionId`, and there are no templates** (`INS-09`)                                                                      |
| A25 | record a finding / DTC / measurement / recommendation / item result / evidence | `dia.diagnostic.record`                                                     | six routes under `/inspections/{id}`                                                      | exists                                                                                                                                                  |
| A26 | **edit or delete a recorded finding**                                          | —                                                                           | —                                                                                         | **does not exist**: the findings route exports POST only. A mistake is permanent.                                                                       |
| A27 | complete a diagnostic report                                                   | `dia.diagnostic.complete`                                                   | `POST /inspections/{id}/completion`                                                       | exists                                                                                                                                                  |
| A28 | review a diagnostic report                                                     | `dia.diagnostic.review`                                                     | `POST /inspections/{id}/reviews`                                                          | exists — records an opinion, changes no state (`INS-08`)                                                                                                |
| A29 | request parts                                                                  | `wo.work_order.line.manage`                                                 | `POST /work-orders/{id}/required-parts`                                                   | exists; read back under `wo.work_order.read`                                                                                                            |
| A30 | record a service line                                                          | `wo.work_order.line.manage`                                                 | `POST /work-orders/{id}/service-lines`                                                    | exists                                                                                                                                                  |
| A31 | raise additional work                                                          | `wo.additional_work.request`                                                | `POST /work-orders/{id}/additional-work`                                                  | exists                                                                                                                                                  |
| A32 | record the customer's decision                                                 | `wo.additional_work.approve`                                                | `POST /additional-work/{id}/approval`                                                     | exists, audit class APPROVAL                                                                                                                            |
| A33 | read the restricted additional-work detail                                     | `wo.additional_work.request` **AND** `iam.sensitive.view`                   | `GET /additional-work/{id}/detail`                                                        | exists                                                                                                                                                  |
| A34 | mark ready for QC                                                              | `wo.work_order.transition`                                                  | transition `in_progress→qc_pending`                                                       | exists — **freezes scope**                                                                                                                              |
| A35 | open a QC record                                                               | `qms.quality_control.record`                                                | `POST /work-orders/{id}/quality-controls`                                                 | exists                                                                                                                                                  |
| A36 | record a QC check result                                                       | `qms.quality_control.record`                                                | `PUT /quality-controls/{id}/checks/{checkId}`                                             | exists — **but `qms.qc_checks` has zero rows**                                                                                                          |
| A37 | finalize QC                                                                    | `qms.quality_control.finalize`                                              | `POST /quality-controls/{id}/finalization`                                                | exists                                                                                                                                                  |
| A38 | create a rework case                                                           | `qms.rework.manage`                                                         | `POST /work-orders/{id}/rework`                                                           | exists                                                                                                                                                  |
| A39 | record rework cost                                                             | `qms.rework.manage` **AND** `iam.sensitive.view`                            | `PUT /rework-links/{id}/cost`                                                             | exists                                                                                                                                                  |
| A40 | sign off safety-critical rework                                                | `qms.rework.sign_off`                                                       | `POST /rework-links/{id}/sign-off`                                                        | exists, separate authority                                                                                                                              |
| A41 | view history (work order / job / diagnostic)                                   | `wo.work_order.read` for the first two, `dia.diagnostic.read` for the third | three history endpoints                                                                   | exists — note the job history uses the **work-order** code                                                                                              |
| A42 | **see the customer on a work order**                                           | —                                                                           | —                                                                                         | **does not exist** (`INS-10`): three joins, none exposed                                                                                                |
| A43 | attach a document to a job or an assignment                                    | —                                                                           | —                                                                                         | **does not exist**: evidence binding exists only for diagnostics (report-level) and customer approval                                                   |
| A44 | record a blocker or escalation                                                 | —                                                                           | —                                                                                         | **does not exist** as an entity; expressible only as a work-order transition to `awaiting_parts` / `awaiting_customer` with a reason                    |

Rows A4, A12, A26, A42, A43 and A44 are the honest scope boundary of a
Frontend-only P1-29: they cannot be built, and no amount of client work changes
that.

---

## 5. Separation-of-duty pairs the UI must respect

These are deliberate splits in the catalogue. A UI that renders them as one
control destroys the control.

| pair                                                          | what it separates                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `wo.work_order.transition` / `wo.work_order.close`            | driving the order / ending it                                      |
| `wo.job.manage` / `wo.job.transition`                         | editing a job / moving it                                          |
| `wo.additional_work.request` / `wo.additional_work.approve`   | proposing extra work / recording the customer's answer             |
| `tech.labor.record` / `tech.labor.correct`                    | recording your own time / altering a recorded time                 |
| `qms.quality_control.record` / `qms.quality_control.finalize` | performing checks / declaring the outcome                          |
| `qms.rework.manage` / `qms.rework.sign_off`                   | handling rework / independently signing off safety-critical rework |
| `dia.diagnostic.record` / `.complete` / `.review`             | filling in / finishing / judging                                   |
| anything / `iam.sensitive.view`                               | the operational fact / the restricted detail beside it             |

**Design rule for P1-29:** every screen that composes an action out of two calls
(A18–A21) must check **both** codes before offering it, and must degrade
gracefully — not silently — when the caller holds one and not the other.

---

## 6. What exists in `apps/web` today

Only **four** of the 22 codes appear anywhere in `apps/web`, all as navigation
gates in `apps/web/src/config/navigation.ts:177-198` with `status: 'planned'`
and no page behind them:

| route                      | code                       |
| -------------------------- | -------------------------- |
| `/work-orders`             | `wo.work_order.read`       |
| `/work-orders/diagnostics` | `dia.diagnostic.read`      |
| `/work-orders/quality`     | `qms.quality_control.read` |
| `/technicians`             | `tech.technician.read`     |

Those declarations are pinned by a test, so P1-29 changing `status` from
`planned` to live is a deliberate, gated act — see
[information-architecture.md](information-architecture.md).

---

## 7. `iam.roles` and `iam.role_permissions` are EMPTY

**0 rows in both, in the live database.** No actor holds _any_ `wo`/`tech`/`dia`/
`qms` code today. Role-to-permission mapping is _tenant provisioning_, not
platform seed, and nothing has provisioned a tenant in this environment.

This has three consequences, and they are the practical reason P1-29 preparation
must name PRE-P1-29 precisely rather than vaguely:

1. **No P1-29 screen can be manually verified until roles exist**, because every
   operation will refuse. Owner acceptance therefore has a provisioning
   precondition, spelled out in
   [test-and-acceptance-plan.md](test-and-acceptance-plan.md).
2. **Automated tests must provision their own roles** — which existing DB and
   backend suites already do, so this is a known pattern, not new work.
3. The persona-to-role mapping in [canonical-plan.md](canonical-plan.md) is a
   _proposal_, not a description of anything that exists.

---

## 8. PRE-P1-29 dependency map — nine dimensions, named exactly

"Depends on PRE-P1-29" is not an acceptable answer anywhere in this phase.
Treating the initiative as one dependency would block all of P1-29 on things
that are not in its way, and would hide the two that genuinely are.

**State of the initiative.** Wave A landed (#255–#258). Wave B is design-only
under PR #259 and its own design gate holds all nine of its slices:
_"Implementation slices, once the gate passes … Not started, and not startable
until the refuter reports zero confirmed critical and zero confirmed high
findings"_ (`wave-b-control-plane-design-v2.md:948-950`). Slice B1 additionally
carries `B1-PGNET-BLOCKER`, an external provider-owned `net` schema ACL; note
that **the B1 documents live on the unmerged branch
`feature/pre-p1-29-backend-b1-platform-authority-foundation`, not on `develop`**,
so a reader of `develop` alone cannot see that blocker at all.

### 8.1 The nine dimensions

| #   | dimension                        | today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | P1-29 needs                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Tenant resolution**            | **Shipped.** `iam.current_tenant_id()` (`0002_base_schemas.sql:108-116`), set per transaction by the request wrapper (`transaction.ts:92-105`) from the resolved context.                                                                                                                                                                                                                                                                                                                                                                                                                | Nothing new. Every P1-29 read inherits it.                                                                                                                                                                                                                                                                    |
| 2   | **Multi-membership**             | **Absent across tenants; shipped within one.** `iam.user_accounts.tenant_id` is `NOT NULL` and immutable, and `uq_user_accounts_provider_identity_active` is unique on `(identity_provider, provider_subject)` with **no tenant in the key** — so one live external identity resolves to exactly one tenant, platform-wide. No membership relation exists under any spelling. Multi-**company** and multi-**branch** within a tenant _are_ shipped: `resolve-context.ts:74-104` aggregates `company_ids`/`branch_ids` across every active grant.                                         | Only the within-tenant form, which exists. **Not a blocker.**                                                                                                                                                                                                                                                 |
| 3   | **Company Owner administration** | **Absent.** No Company Owner principal and no Superadmin exist — `grep -rniE "company[ _-]?owner"` over api, web, migrations and seeds returns one unrelated hit; `super[ _-]?admin` returns zero. No roles are seeded. The only platform path, `org.provision_organization()`, has EXECUTE revoked from PUBLIC and is called by no route.                                                                                                                                                                                                                                               | **Only for acceptance** — see dimension 5. No P1-29 screen consumes it.                                                                                                                                                                                                                                       |
| 4   | **Employee membership**          | **Split.** For a **technician** the relationship is stored and unique (`tech.technician_profiles.user_id`) and is exposed by nothing — that is `INS-04` / `BE-2`. For **anyone else** there is no record at all: `iam.user_accounts` has no `company_id`/`branch_id`, no employee master exists, and `iam.user_employee_links` is an **FK-less placeholder** referenced only by two docblocks. The only company/branch attachment that is both stored and published is authorization narrowing (`iam.role_grants` + `iam.grant_scopes`).                                                 | The technician half, via `BE-2`. The general half is **not** a P1-29 dependency — no P1-29 screen needs to know where a non-technician works.                                                                                                                                                                 |
| 5   | **Role / grant authority**       | **Shipped and empty.** Thirteen operations cover role create/list/update, permission mapping, grants and scopes, with delegation enforced both in the application (`delegation-policy.ts`, 19 call sites) and in the database (`ins_role_permissions_delegable`, `ins_role_grants_delegable`, plus deferred constraint triggers). But **`iam.roles`, `iam.role_permissions`, `iam.role_grants`, `iam.grant_scopes`, `iam.user_accounts` and `org.tenants` all hold 0 rows**; six seed files create no role and no mapping.                                                               | **The one hard dependency, and it is for acceptance only.** P1-29 needs 22 codes mapped to roles and granted to a user before any screen can be exercised by hand. The mechanism exists; the data does not. Automated tests provision their own.                                                              |
| 6   | **Company / branch scope**       | **Shipped, with a documented sharp edge.** 305 `defineOperation` bodies: tenant 167, branch 132, company 2, absent 4 (all `public: true`). `iam.has_permission_in_scope` resolves company, branch **and department**. The sharp edge: a scope declaration is **inert without a target** — `requiresScopedEvaluation` returns false on an empty one — and `app.branch_ids` is the _permission-blind_ union of every active grant (`P1-18-A-01`), so RLS cannot compensate. `requireScopedPermissions` can force scoped evaluation regardless of the declaration (`authorization.ts:376`). | Nothing new — but **every P1-29 collection call must name the company/branch pair**, and a P1-29 test must assert it (`T-02`).                                                                                                                                                                                |
| 7   | **Workflow authority**           | **Partly used.** There is no generic workflow engine: the shared transition engine registers exactly one aggregate (`org.branch`). What exists is monetary ceilings — `iam.approval_limits`, effective-dated per (company, role XOR user, limit_type), three HTTP operations, **and a full administration Frontend that ships and is reachable from the nav** (`ApprovalLimitsScreen.tsx`, 474 lines). What is single-consumer is the **read** side: `callerApprovalCeiling` (`authorization.ts:276-310`).                                                                               | **Nothing.** P1-29's approvals are the customer's decision on additional work (`wo.additional_work.approve`) and rework sign-off (`qms.rework.sign_off`) — neither consults an approval limit. If the Owner later wants a monetary ceiling on additional work, that is a new dependency, not an existing one. |
| 8   | **Subscription enforcement**     | **Complete and dead from the HTTP boundary.** `org.resolve_feature_enabled` implements override → plan → platform default and raises on an unregistered flag; `requireFeature` throws `ERR-TEN-001`. But **zero of the 305 operations declare a `featureFlag`** — the only three `featureFlag` mentions in `apps/api/src` are infrastructure (`operation-registry.ts:69`, `route-handler.ts:343`, `openapi/document.ts:229`) — so `ERR-TEN-001` is unreachable in production. `org.feature_flags` is unseeded; the only write path is a test fixture running as the admin pool.          | **Nothing, and P1-29 must not build a client-side substitute** (`INS-22`). If subscription-gated workshop features are wanted, the work is declaring `featureFlag` on operations — Backend.                                                                                                                   |
| 9   | **Audit attribution**            | **Shipped.** Every P1-29 write declares an `auditClass`; the customer decision is class **APPROVAL**; `correlation_id` and `actor_id` are stamped from the request context via `iam.current_user_id()`.                                                                                                                                                                                                                                                                                                                                                                                  | Nothing new — except that a **composed** action (start/pause) produces **two** audit records. Propagate the correlation where the platform allows it, and do not claim one intent was recorded as one event.                                                                                                  |

### 8.2 What this leaves

| P1-29 needs                                                         | supplied by                                                                             | status                                      | if unavailable                                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Roles carrying the 22 domain codes                                  | dimension 5 — tenant provisioning                                                       | **absent**                                  | **Owner acceptance cannot run.** Automated tests provision their own.                                                         |
| A signed-in session resolving `tenantId`, `companyIds`, `branchIds` | dimensions 1, 2, 6 — shipped, consumed by P1-28 screens                                 | **available**                               | —                                                                                                                             |
| Company/branch selection in a screen                                | `BranchTargetFields` (P1-28 Wave C)                                                     | **available**                               | —                                                                                                                             |
| A company/branch **directory** (ids → names)                        | nothing publishes one — `admin.contractGap.noDirectory`                                 | **absent, and not a PRE-P1-29 deliverable** | P1-29 shows typed references, as approval-limits and appointments already do. **Not a blocker.**                              |
| A user → `technicianProfileId` contract                             | dimension 4 — **`BE-2`, a P1-29 prerequisite**                                          | **absent**                                  | "My jobs" cannot exist. Supervisor-navigates does.                                                                            |
| Platform authority / tenant lifecycle                               | PRE-P1-29 slice B1                                                                      | frozen                                      | **P1-29 does not use it.**                                                                                                    |
| The Wave B control plane                                            | PRE-P1-29 Wave B                                                                        | design only, behind its own gate            | **P1-29 does not use it.**                                                                                                    |
| A department management surface                                     | PRE-P1-29 organisation administration — the same gap that covers companies and branches | **absent**                                  | Owner requirements 3 and 4 unmet. See `BE-7`, whose management half is PRE-P1-29's and whose `department_id` half is P1-29's. |

**Conclusion: PRE-P1-29 blocks P1-29 acceptance, not P1-29 construction.** The
part that blocks acceptance is role provisioning — dimension 5, the least novel
part of the initiative. The frozen B1 slice and the Wave B control plane are on
a different path and no P1-29 behaviour touches either.

A caution that belongs here: the **live database is ahead of this worktree** —
127 applied migrations (max `20260822092000`) against 124 files here (max
`20260819090000`). The three extra are PRE-P1-29 B1's, and they are why the
shared container reports 115 permissions where `develop` ships 112 (§2). Any
P1-29 measurement taken against that container must say which tree it describes.

---

## 9. Codes P1-29 must **not** invent

The catalogue is complete for this domain and no P1-29 Frontend slice may add
to it. If a designed behaviour has no code in section 2, that behaviour is not
buildable until a Backend slice — one of P1-29's own prerequisites, as `BE-4`
is, or a later phase's — adds both the code and the operation. In particular:

- there is no _cancel-work-order_ code (A6 uses `transition`);
- there is no _return-from-QC_ code (that edge uses `transition`);
- there is no _pause_ code (A19 composes two existing ones);
- there is no _view-customer_ code, because there is no view.
