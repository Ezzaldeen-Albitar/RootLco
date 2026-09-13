# P1-31 — the audit-class review (SEC-004)

**What this file is.** The task matrix records SEC-004 as "Security audit-event coverage", and
[`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 4 states in its own words that the
declarations are **counted** and that a count is not a review. This file is the review the count is
not: one line per `auditClass: 'none'` declaration on the phase's own route surface, saying why
silence is correct there, and a re-verification that every `'privileged'` declaration carries an
`auditAction`.

**What this file is not.** It is not an acceptance record, it decides nothing, and it asks for no
change to any route. Where a declaration is a judgement that could reasonably have gone the other
way, § 4 says so and leaves it open rather than writing a justification over it.

## 1. The surface, and how it was measured

The surface is the phase's own route surface: **46 operations across 34 `route.ts` files** in the
eight namespaces under `apps/api/src/app/api/v1/` that P1-31 owns — `deliveries` (9 files, 13
operations), `delivery-checklist-templates` (5, 8), `delivery-readiness` (1, 1),
`report-configurations` (5, 7), `reports` (3, 3), `warranties` (3, 3), `warranty-policies` (5, 7)
and `org/employees` (3, 4).

Every figure below was taken twice and the two agree:

- from `docs/phase-1/phase-1-24/evidence/operation-register.json`, filtered to those eight
  namespaces; and
- from a TypeScript parse of the `defineOperation({ … })` object literal in each of the 33 route
  modules, reading the `auditClass` and `auditAction` properties directly.

| measured                                             | value                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| operations on the surface                            | 46                                                                                          |
| `auditClass: 'privileged'`                           | 24                                                                                          |
| `auditClass: 'none'`                                 | 22                                                                                          |
| writes (`POST`/`PATCH`/`PUT`/`DELETE`) · reads (GET) | 24 · 22                                                                                     |
| `'privileged'` declarations that are writes          | 24 of 24                                                                                    |
| `'none'` declarations that are reads                 | 22 of 22                                                                                    |
| `'none'` written EXPLICITLY rather than omitted      | 22 of 22                                                                                    |
| register and source parse disagreeing on any row     | 0                                                                                           |
| audit classes used, of the six the vocabulary admits | 2 — `'none'` and `'privileged'`; no `'financial'`, `'export'`, `'approval'` or `'security'` |

The class vocabulary is `'none' | 'privileged' | 'approval' | 'financial' | 'export' | 'security'`
(`apps/api/src/server/auth/operation-registry.ts`). **`auditClass` defaults to `'none'` when the
property is omitted**, so a `'none'` in the register can mean either a decision or an oversight. On
this surface it never does: all 21 are written out as literals, which is why they can be reviewed at
all.

The two figures carried into this task from outside were **21 `'none'` and 24 `'privileged'`**. Both
are confirmed.

_(This section read "**45 operations across 33 `route.ts` files**" with `warranties` (2, 2), and the
table read 45 operations with 21 `auditClass: 'none'` and 24 · 21 writes and reads. All of it was
true when written. **P-18** published `wty.warranty-status-history` on 2026-09-13 — change control
[§ 65 / **CC-55 (c)**](./change-control-2026-09-08.md) — and the figures are re-derived here on
**2026-09-14** from the same two sources, which still agree on every field: the surface is **46
operations across 34 files** with `warranties` (3, 3), and the new operation is a GET declaring
`auditClass: 'none'` as a literal with `auditAction: null`, so the class split is **22 `'none'` and
24 `'privileged'`** and the carried-in pair above becomes 22 and 24. **Section 2 below still reviews
the 21 that existed when it was written.** The twenty-second line —
`wty.warranty-status-history`, `wty.warranty.read`,
`apps/api/src/app/api/v1/warranties/[warrantyId]/status-history/route.ts` — is deliberately NOT
written here: a review line is a judgement about why silence is correct, and this correction is a
count. It is owed to the lane that re-derives this file.)_

## 2. The 21 `auditClass: 'none'` declarations, one line each

Every one is a GET. The rule applied is the registry's own: silence is correct when the request
neither changes state nor discloses something whose disclosure is itself the event worth recording.
Each row says which of those two clauses carries it.

### `deliveries` and `delivery-checklist-templates` (10)

| operation                              | permission(s)                                                   | why silence is correct                                                                                                                               | declared at                                                                        |
| -------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `sal.delivery-list`                    | `sal.delivery.view`                                             | a scoped index of handover records; changes nothing, and the rows it returns are the ones the caller's own grants already reach                      | `apps/api/src/app/api/v1/deliveries/route.ts:137`                                  |
| `sal.delivery-read`                    | `sal.delivery.view`                                             | one handover record by id; the same disclosure as the list, narrowed                                                                                 | `apps/api/src/app/api/v1/deliveries/[deliveryId]/route.ts:72`                      |
| `sal.delivery-status-history`          | `sal.delivery.view`                                             | replays the custody transitions that were THEMSELVES audited as `sal.delivery.*` events — auditing the reading of an audit trail records nothing new | `apps/api/src/app/api/v1/deliveries/[deliveryId]/status-history/route.ts:73`       |
| `sal.delivery-signature-list`          | `sal.delivery.view`                                             | lists signature records whose capture is audited as `sal.delivery.signature_recorded`; the read adds no fact                                         | `apps/api/src/app/api/v1/deliveries/[deliveryId]/signatures/route.ts:175`          |
| `sal.delivery-checklist-result-list`   | `sal.delivery.view`                                             | lists results whose recording is audited as `sal.delivery.checklist_recorded`                                                                        | `apps/api/src/app/api/v1/deliveries/[deliveryId]/checklist-results/route.ts:146`   |
| `sal.delivery-receiver-read`           | `sal.delivery.view`                                             | returns the authorized-receiver record for one handover; verification of that receiver IS audited, the read of it is not a state change              | `apps/api/src/app/api/v1/deliveries/[deliveryId]/authorized-receiver/route.ts:144` |
| `sal.delivery-checklist-template-list` | `sal.delivery.view`                                             | configuration, not a record: the templates an administrator maintains, every write to which is audited                                               | `apps/api/src/app/api/v1/delivery-checklist-templates/route.ts:83`                 |
| `sal.delivery-checklist-template-read` | `sal.delivery.view`                                             | one template by id; same clause as the list                                                                                                          | `apps/api/src/app/api/v1/delivery-checklist-templates/[templateId]/route.ts:48`    |
| `sal.delivery-eligibility-read`        | `sal.delivery.view` + `sal.finance.view`                        | a computed verdict over one handover — see § 4.1, this is a judgement rather than a settled case                                                     | `apps/api/src/app/api/v1/deliveries/[deliveryId]/eligibility/route.ts:71`          |
| `sal.delivery-readiness-list`          | `sal.delivery.view` + `wo.work_order.read` + `sal.finance.view` | the readiness queue, the same verdict across many rows — see § 4.1                                                                                   | `apps/api/src/app/api/v1/delivery-readiness/route.ts:102`                          |

### `warranties` and `warranty-policies` (4)

| operation                  | permission(s)       | why silence is correct                                                                                                     | declared at                                                        |
| -------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `wty.warranty-list`        | `wty.warranty.read` | a scoped index of warranty records; issuance is audited as `wty.warranty.issued`, reading the result of it is not an event | `apps/api/src/app/api/v1/warranties/route.ts:95`                   |
| `wty.warranty-detail`      | `wty.warranty.read` | one warranty record with its coverage terms; same clause, narrowed                                                         | `apps/api/src/app/api/v1/warranties/[warrantyId]/route.ts:53`      |
| `wty.warranty-policy-list` | `wty.warranty.read` | configuration the screens iterate to draw a control; every write to a plan is audited under `wty.warranty_policy.*`        | `apps/api/src/app/api/v1/warranty-policies/route.ts:109`           |
| `wty.warranty-policy-read` | `wty.warranty.read` | one plan and its coverage windows; same clause                                                                             | `apps/api/src/app/api/v1/warranty-policies/[policyId]/route.ts:57` |

### `reports` and `report-configurations` (5)

| operation                       | permission(s)          | why silence is correct                                                                                                           | declared at                                                                   |
| ------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `rpt.report-catalogue`          | `rpt.report.read`      | the list of report definitions the caller may run; discloses names and parameters, no data                                       | `apps/api/src/app/api/v1/reports/route.ts:40`                                 |
| `rpt.report-read`               | `rpt.report.read`      | one definition — its columns, filters and drill-through — with no rows attached                                                  | `apps/api/src/app/api/v1/reports/[reportCode]/route.ts:40`                    |
| `rpt.report-run`                | `rpt.report.read`      | returns result rows over the approved datasets — see § 4.2, this is the weakest of the 21 and is left open rather than justified | `apps/api/src/app/api/v1/reports/[reportCode]/rows/route.ts:101`              |
| `rpt.report-configuration-list` | `rpt.report.configure` | configuration records; every write to one is audited under `rpt.report_configuration.*`                                          | `apps/api/src/app/api/v1/report-configurations/route.ts:100`                  |
| `rpt.report-configuration-read` | `rpt.report.configure` | one configuration with its versions; same clause                                                                                 | `apps/api/src/app/api/v1/report-configurations/[configurationId]/route.ts:50` |

### `org/employees` (2)

| operation             | permission(s)       | why silence is correct                                                                                                                                            | declared at                                                      |
| --------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `org.employee-list`   | `org.employee.read` | the internal register a handover form picks a delivering employee from; a directory of colleagues to a colleague who already holds the read authority — see § 4.3 | `apps/api/src/app/api/v1/org/employees/route.ts:101`             |
| `org.employee-detail` | `org.employee.read` | one register entry by id; same clause, narrowed — see § 4.3                                                                                                       | `apps/api/src/app/api/v1/org/employees/[employeeId]/route.ts:42` |

**The shape of the set.** Read as a whole rather than row by row, the 21 fall into three groups and
nothing else, and they add to 21:

- **8 record reads** whose writing counterpart is audited — the six delivery record reads and the
  two warranty record reads.
- **8 configuration or definition reads** — the six whose every write is audited under
  `sal.delivery_checklist_template.*`, `wty.warranty_policy.*` and `rpt.report_configuration.*`,
  plus `rpt.report-catalogue` and `rpt.report-read`, which describe report definitions that no
  operation writes at all.
- **5 reads that disclose something no write of theirs ever touched** — the two eligibility
  verdicts, the report run, and the two employee-register reads.

The first two groups are settled by the registry's own rule. The third is § 4.

## 3. The 24 `auditClass: 'privileged'` declarations

Re-stated and re-verified rather than carried forward:

- **All 24 are writes**, and all 24 writes on the surface are `'privileged'`. No write on this
  surface is silent.
- **Every one carries an `auditAction`** — 24 of 24, each a string literal in the `defineOperation`
  object literal, none computed. **No declaration is missing one.**
- **Every one of the 24 action codes exists** in `apps/api/src/server/auth/audit-actions.ts`, and
  **each is declared there with `class: 'privileged'`**, matching the operation's own class. The
  registry refuses a mismatch at construction time (`operation-registry.ts`), so this is a
  re-verification of a rule the runtime already holds, not a new check.
- The actions span six families: `sal.delivery.*` (5), `sal.delivery_checklist_template.*` (6),
  `wty.warranty_policy.*` (5), `wty.warranty.issued` (1), `rpt.report_configuration.*` (5) and
  `org.employee.*` (2).

**Nothing was found missing here.** The finding, if there is one, is in § 4.

## 4. Open items — where silence is a judgement rather than a certainty

These are recorded as open. No Owner decision has been sought on any of them and none is claimed.

### 4.1 Two reads hold `sal.finance.view` and are silent

`sal.delivery-eligibility-read` and `sal.delivery-readiness-list` both require `sal.finance.view` in
addition to `sal.delivery.view`, which is the phase's own statement that they disclose settlement
figures. Field 26 of the chapter asks that **privileged reads be themselves audited**. The class
vocabulary has a `'financial'` member and neither operation uses it.

**Engineering assessment:** the argument for silence is that both are decision support over records
already visible to a holder of both authorities, and that a queue a screen polls would write an audit
row on every refresh. The argument against is that Field 26 does not distinguish a polled read from
any other. Auditing them is an API-source change on the Backend lane and is out of this record's
scope; the decision belongs to the Owner and to the phase that owns those routes.

### 4.2 `rpt.report-run` returns result sets and is silent

This is the weakest of the 21 and is stated as such rather than rounded into the paragraph above. A
run returns rows over the approved datasets, which is the nearest thing on this surface to a bulk
read. Owner decision D-6 withheld `rpt.export`, so no export operation exists to audit
([`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 2), and the class vocabulary's
`'export'` member is unused on this surface.

**Engineering assessment:** a withheld export is not the same as an audited one, and Field 26's
requirement that exports be themselves audited is not discharged by there being none. Whether a run
is a privileged read is a question this record raises and does not answer.

### 4.3 The employee register reads are silent

`org.employee-list` and `org.employee-detail` return identity records of staff to a caller holding
`org.employee.read`. The write side is audited (`org.employee.created`,
`org.employee.status_changed`); the read side is not.

**Engineering assessment:** the handover form needs the list on every render, so auditing it would
record a screen opening rather than a disclosure. That is a reasonable position and it is still a
position. Recorded here so that it is a decision on the record rather than an absence nobody looked
at.

### 4.4 What this review does not establish

- It is **documentary**. No acceptance ran, no hosted gate reported, and no operation was exercised
  to confirm that an audit row is actually written when a `'privileged'` operation succeeds. The
  declarations are verified; the emission is not.
- Four of the six audit classes are unused on this surface. That is a fact about the surface, not a
  defect, and it is stated so that the two that ARE used are not mistaken for the whole vocabulary.
- Nothing here closes § 4.1, § 4.2 or § 4.3.

## 5. Where the payload half of SEC-004 is recorded

The other half of the task — the write-shape gate the P1-28 definition of SEC-004 asks for — is the
gate `scripts/ci/check-p1-31-write-shape.mjs`, registered as `npm run validate:p1-31-write-shape`
and mutation-proved by `tests/ci/p1-31-write-shape.test.ts`. It holds the 11 `wty`/`rpt` writes that
`validate:p1-30-payload-parity` does not cover. Section 58 of
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) records what it measured.
