# P1-29 (Frontend) Data Contract

Phase 1-9 is database-only. This document records the read-model expectations P1-29
will render. **No frontend is implemented in this phase.**

## Read-model expectations only

- **Work-order board** per branch from `wo.work_orders` (state, kind, reception
  origin, Vehicle, display number) — indexed by `(tenant, company, branch, state)`.
- **Job / labor view:** jobs and their assignments, active and historical labor
  sessions per technician, resolved through `wo.jobs` / `wo.job_assignments` /
  `tech.labor_sessions`.
- **Technician view:** operational profile, held skills and certifications
  (eligibility/expiry from the `internal` certification record; the certificate
  number only with `iam.sensitive.view`), and availability windows.
- **Diagnostic report view:** the pinned published template version, item results,
  findings, measurements, DTC records, and recommendations — evidence resolved
  through the linked document, **never** by raw object id.
- **Quality / closure view:** QC records and per-check results, the closure-gate
  blocker state (B1..B6), rework links, and the append-only reopen-attempt log.
- **Timelines:** work-order status history, job status history, diagnostic report
  status history, and QC status history — each append-only and ordered by `seq`.

Restricted narratives (certificate number, additional-work description, rework cost)
render only with `iam.sensitive.view`; the metadata parents render in-scope. The
work-order surface a P1-29 read-model consumes is stable and documented in
[phase-1-9-contracts.md](phase-1-9-contracts.md).
