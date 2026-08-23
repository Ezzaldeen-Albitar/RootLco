# P1-29 — preparation-level threat model

Scope: the threats a **Frontend** phase over this Backend can introduce or fail
to contain. Each threat names the control that must exist, where that control
lives today, and what P1-29 owes it.

This is a preparation artefact. It is not a penetration test and it does not
claim completeness against the platform as a whole.

---

## 0. The structural fact that shapes every threat below

From [contract-archaeology.md](contract-archaeology.md) section 10.3 and
[permission-matrix.md](permission-matrix.md) section 1:

> **124 RLS policies exist across `wo`, `tech`, `dia` and `qms`, and not one
> consults a permission code.** RLS enforces tenancy and scope. The API
> operation declaration is the _sole_ enforcement point for permissions.

There is no defence in depth for authorization in this domain. Every threat
that ends in "…and the permission check is wrong" ends in data disclosure, not
in a second line of defence catching it.

The corollary is the phase's governing security rule:

> **P1-29 must never introduce a data path that does not go through a declared
> API operation.** No direct database access, no service-role key in the web
> tier, no server-side join that skips `requirePermissions`.

`apps/web/scripts/check-api-boundary.mjs` already enforces part of this —
`src/lib/api` is the only module in `apps/web` allowed to perform network I/O,
and importing `apps/api` source or supabase from `apps/web` is forbidden.

---

## T-01 — Client-asserted scope

**Threat.** A caller submits a `companyId`/`branchId` pair they do not hold, and
reads or writes another branch's work.

**Control.** The server resolves the caller's own scope from the session and
**refuses a client-asserted one** (`P1-27-SEC-001`). The pair in the request is
a _resource selector_ — "which branch's board" — carried as the
`authorizationTarget`, never a scope assertion.

**Status.** Shipped and enforced in the API.

**P1-29 owes.** Send the pair as a selector, and understand that it is not a
privilege claim. Do not build any UI that implies the user is choosing their own
authority.

---

## T-02 — Cross-branch exposure through an _omitted_ scope target

**Threat.** A collection call omits `companyId`/`branchId`. The declaration says
`scope: 'branch'`, so it _looks_ protected.

**Why it is real.** From the route's own header:
`requiresScopedEvaluation` returns **false** on an empty target whatever the
declaration says, so the check degrades to scope-blind `iam.has_permission` —
and **RLS cannot compensate, because `app.branch_ids` is the permission-blind
union of every active grant** (`P1-18-A-01`). A caller holding
`wo.work_order.read` in branch A and _any grant at all_ in branch B would see
B's board.

**Control.** The query schemas make the pair **required** on every collection
endpoint, and the parse is `.strict()`.

**Status.** Shipped, but it is a _convention held by each route's schema_, not a
single central invariant.

**P1-29 owes.** Every collection adapter names the pair. A P1-29-owned test
should assert that no work-order-domain list adapter can be called without one —
this is cheap and it protects the phase's largest read surface. See
[test-and-acceptance-plan.md](test-and-acceptance-plan.md).

---

## T-03 — A permission code that is declared but wrong, or not declared at all

**Threat.** A new P1-29-consumed operation, or an edited declaration, carries a
misspelt or absent code. The database will not catch it (section 0).

**Why it is real today.** `defineOperation` rejects an empty `permissions` array
and **nothing else**. It never checks a code against `iam.permissions` — the
registry's own test registers the fictitious code `a.b.c` and it passes. **No CI
gate asserts declaration-to-catalogue parity.** (`INS-11`)

**Status.** **Uncontrolled.**

**P1-29 owes.** The phase's own Backend prerequisites are the largest source of
new declarations here — `BE-4` alone introduces diagnostic-template permission
codes that do not exist yet — and its Frontend then reads those declarations to
build `features/work-orders/permissions.ts`, so a divergence between the two
produces a UI that hides the wrong things. Build the parity gate (a small script
over the registry and the seeded catalogue) as `BE-5`, in the Backend
prerequisite slice and before the declarations it must police are written; it is
the cheapest control in this document. See
[implementation-slices.md](implementation-slices.md). Propose the parity gate
(a small script over the registry and the seeded catalogue) as phase work even
though the defect is Backend-side; it is the cheapest control in this document.

---

## T-04 — Restricted sidecars leaking through a shared projection

**Threat.** The three restricted tables —
`wo.additional_work_request_details` (the sensitive additional-work
description), `tech.technician_certification_details` (certificate numbers),
`qms.rework_link_details` (rework cost) — are surfaced to a caller without
`iam.sensitive.view`.

**Control.** These are the **only** three tables in the domain whose RLS
policies carry a permission literal, and it is `iam.sensitive.view`. The API
also declares the conjunction on the three operations that touch them.

**Status.** Defence in depth exists _here specifically_, and nowhere else in the
domain.

**P1-29 owes.**

- Fetch restricted detail through its **own** adapter, gated on its **own**
  permission check — never fold it into the parent read's response type.
- Render the restricted region as a distinct, absent-by-default block, so that a
  caller without the code sees _nothing there_, not an empty field that hints at
  content.
- The rework **cost** is money and is restricted: `MoneyField` and the cost
  display both belong behind the conjunction.

---

## T-05 — Over-exposure of staff data

**Threat.** A service advisor with `wo.work_order.read` sees who worked on what,
for how long — a timesheet — because the UI folded assignments and labour
sessions into the work-order detail.

**Why it is real.** The Backend already made this decision deliberately:
`wo.job-assignment-list` and `tech.labor-session-list` require
**`tech.technician.read`**, not `wo.work_order.read`, _because both name a
member of staff_. A UI that fetches them on every work-order detail render
either fails noisily for the advisor (good) or, if it uses a privileged
server-side path, quietly undoes the control (bad).

**Status.** Controlled at the API. **P1-29 can defeat it.**

**P1-29 owes.** Per-panel permission gating inside the work-order detail, with
graceful absence. The Jobs tab must render for a caller who cannot see
assignments.

---

## T-06 — Silent overwrite through version adoption

**Threat.** The UI catches `ERR-CON-001`, re-reads in the background, adopts the
new `record_version`, and re-submits the user's original intent — overwriting a
change the user never saw.

**Why it is real.** It is the most natural "helpful" implementation of a 409
handler, and the code is marked `retryable: true`, which invites it.

**Control.** None. Optimistic concurrency protects the _row_, not the _user's
understanding_.

**P1-29 owes.** The rule in
[exception-and-concurrency-model.md](exception-and-concurrency-model.md)
section 3.1: **re-read, re-render, let the user decide.** Never auto-retry a 409. `retryable` describes the request shape, not the intent.

---

## T-07 — Idempotency key misuse

**Threats.**

1. Reusing a key across _different_ intents — the second caller receives the
   first caller's response. (`ERR-INT-001` catches a payload mismatch; it does
   not catch two intents that happen to serialise identically.)
2. Minting a new key per HTTP attempt — a "retry" opens a second labour session
   or creates a second job.
3. Putting secret or personal material in the key — the platform explicitly
   defends against this with `ERR-INT-003`, _"Idempotent request carries secret
   material"_.

**Control.** `ERR-INT-001`/`002`/`003` at the API; `PUBLISHED_OPERATIONS` on the
client carries each operation's posture.

**P1-29 owes.** One key per user intent, held across retries of that intent,
derived from nothing sensitive (a random v4 UUID, not an email, a VIN, or a
composite of business fields).

---

## T-08 — Free-text fields

The domain has a lot of them, and several reach places where they matter:

| field                                   | where it lands                                                   |
| --------------------------------------- | ---------------------------------------------------------------- |
| transition `reason`                     | `app.status_reason` → the history tables → the activity timeline |
| `dia.findings.description`              | the diagnostic report and, by reference, additional work         |
| `evidenceType`                          | free text, 1..64, **no vocabulary, no CHECK**                    |
| `job_type`                              | free text on `wo.jobs`                                           |
| rework `rootCause` / `correctiveAction` | the rework record                                                |
| labour-correction reason                | the audit trail                                                  |

**Threats.** (a) Stored XSS if any of these is ever rendered as HTML.
(b) PII entered into a reason field and then surfaced to a wider audience than
the customer record would be. (c) Log injection through newline-bearing reasons.

**Controls.** React escapes by default, and `dangerouslySetInnerHTML` is
forbidden across `apps/web` by the `unsafe-html` rule in
`scripts/ci/check-p1-26-frontend.mjs` — a rule with **no `scope` field**, so it
applies to the whole scanned tree rather than only to P1-26's files (unlike the
`auth-redirect-parameter` rule beside it, which is scoped). Length caps are
enforced server-side.

**P1-29 owes.** Never introduce `dangerouslySetInnerHTML`, never render a
free-text field into a `title`/`aria-label` without escaping, and treat reason
fields as _operational_ text — the UI should not invite a user to type a
customer's phone number into a transition reason. Prefer a picker with an
"other" escape for `evidenceType` (see
[technician-and-diagnostics-design.md](technician-and-diagnostics-design.md)
B3.1).

---

## T-09 — Evidence and document access

**Threat.** A `documentVersionId` is a capability-looking reference. If the UI
renders a document URL derived from it without an authorization check, evidence
becomes readable by reference.

**Control.** Both evidence tables FK to `shared.document_versions(tenant_id, id)`
with `RESTRICT`, so a cross-tenant binding is structurally impossible; the
attachments module owns read authorization.

**P1-29 owes.** Fetch documents only through the attachments API. Never
construct a storage URL. Never cache a document body in client state beyond the
view that needs it.

---

## T-10 — The orphan permission as a misleading grant

**Threat.** `wo.work_order.create` is seeded with risk `high` and the
description _"Convert a reception visit into a work order"_, and is **consulted
by nothing**. A tenant administrator reading the catalogue grants it, believes
they have granted the ability to open work orders, and has granted nothing —
or, worse, withholds it believing they have _denied_ the ability, while the
actual authority (`rec.reception.convert`) sits elsewhere.

**Status.** Live. It is a governance defect with a security consequence.

**P1-29 owes.** Do not gate on it. Record it (`INS-05`). Any P1-29 documentation
of "who can open a work order" must name `rec.reception.convert`.

---

## T-11 — Technician profile enumeration

**Threat.** Because nothing maps a user to their `technicianProfileId`
(`INS-04`), an implementer is tempted to find it by matching `displayName` or
the email local-part against some listing, or by iterating profile ids against
`GET /technicians/{profileId}/queue`.

**Why it matters.** The queue endpoint returns another person's workload. A
guess-and-check loop under a single legitimate `tech.technician.read` grant is
an enumeration oracle over staff assignments.

**Control.** Scope (`branch`) limits the blast radius. Nothing else.

**P1-29 owes.** **Do not implement any client-side identity resolution.** The
supervisor-navigates form is the sanctioned pattern until a Backend mapping
exists. This is stated as a hard rule, not a preference.

---

## T-12 — Denial responses that explain too much

**Threat.** A helpful error message tells an unauthorized caller which
permission they lack, or whether a resource exists.

**Control, already shipped.** `ERR-IAM-001` is _"Not permitted"_ and the backend
**never explains what was missing**. `ERR-CON-001` on a version-guarded item
route makes _"a stale version and an out-of-scope row indistinguishable, because
distinguishing them would leak existence"_. `ERR-RES-001` is the same shape.
Entitlement runs **after** authorization so an unauthorized caller cannot learn
which features a tenant has bought.

**P1-29 owes.** Do not undo this on the client. Do not infer or display "you
need permission X". Render the denial and the correlation ID.

---

## T-13 — Correlation IDs

**Assessment: not a threat, and a required feature.** The `ActionState`
docblock states it plainly: the correlation ID is _"the one diagnostic that is
safe to show — an opaque token that finds the server-side log without telling
the browser anything."_

**P1-29 owes.** Render it on every failure surface. A phase this large without
correlation IDs on screen is unsupportable in production.

---

## T-14 — Audit completeness

Every P1-29 write declares an `auditClass`; reads declare `none`. The notable
ones: `wo.additional-work-approval` is class **APPROVAL** (the customer
decision), and every transition, closure, assignment, labour event and
diagnostic write is **privileged**.

**Threat.** A UI that composes an action out of two calls (start, pause) produces
**two** audit records with no shared identity, so the audit trail records two
unrelated events rather than one intent.

**Control.** `correlation_id` is carried on the history rows and set from the
request context.

**P1-29 owes.** Where the platform allows a correlation to be propagated across
the two calls of a composed action, propagate it. Where it does not, record that
the audit trail sees two events — do not claim otherwise in the acceptance
evidence.

---

## T-15 — Tenant-defined vocabulary rendered unsafely

**Threat.** Work-order and job state codes are **tenant-authored data**. A UI
that looks up a translation key by interpolating the code, or renders the code
into a `class` attribute or a CSS selector, is letting tenant data reach a
context it was not validated for.

**Control.** The code format CHECK is `^[a-z][a-z0-9_]{1,62}$` — lower snake,
bounded. That is a strong constraint and it makes this a low-severity threat.

**P1-29 owes.** Even so: look codes up in a map, never interpolate them into a
key path that could reach a dynamic `import`, and never build a CSS class by
concatenation. Humanise unknown codes for display rather than failing.

---

## T-16 — The `gate-before-read` rule is not pointed at P1-29

**Threat.** A P1-29 route page performs its authorized read _before_ its
permission check, so an unauthorized caller's request reaches the backend (which
refuses it) — leaking timing and load, and, if the page ever renders partial
data before the guard, more than that.

**Control.** `scripts/ci/check-p1-28-access.mjs` rule `gate-before-read`
requires every phase route page to deny-and-return on a permission before its
first awaited read. **It is scoped to P1-28's routes.**

**Status.** The control exists and does not cover P1-29's routes.

**P1-29 owes.** Extend the rule (or add the P1-29 equivalent) **in the first
slice**, not the last. A gate added after the screens exist is a gate that
ratifies whatever was built. `INS-12`.

---

## Summary — what P1-29 must carry into implementation

| #   | control                                                  | who builds it                                                |
| --- | -------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | never a data path outside a declared operation           | P1-29 discipline + `apps/web/scripts/check-api-boundary.mjs` |
| 2   | scope pair on every collection adapter, test-asserted    | **P1-29**                                                    |
| 3   | per-panel permission gating in the work-order detail     | **P1-29**                                                    |
| 4   | restricted sidecars behind their own adapter and check   | **P1-29**                                                    |
| 5   | no auto-retry of `ERR-CON-001`                           | **P1-29**                                                    |
| 6   | one idempotency key per intent, from nothing sensitive   | **P1-29**                                                    |
| 7   | no client-side technician identity resolution            | **P1-29 (hard rule)**                                        |
| 8   | correlation ID on every failure surface                  | **P1-29**                                                    |
| 9   | `gate-before-read` extended to P1-29 routes, first slice | **P1-29**                                                    |
| 10  | declaration-to-catalogue parity gate                     | proposed by P1-29, Backend-side defect                       |
| 11  | retire or re-point `wo.work_order.create`                | governance, not P1-29                                        |
| 12  | subscription gating, if wanted, via `featureFlag`        | Backend                                                      |
