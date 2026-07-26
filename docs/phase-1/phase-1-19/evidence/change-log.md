# P1-19 — Change log

Branch `feature/p1-19-module-foundation`, PR **#82**, base `develop` =
`f326e24c0340e2ce97a94a768868a26d0cfbb04f`.

**No migration, no grant and no role changed.** The `wo`/`tech`/`dia`/`qms` schema has
been frozen since Phase 1-12 and this phase is not authorised to change it. Every
enforcement described in the evidence is either a pre-existing protected database object
or an application rule that is identified as one.

**One seed file DID change**, and an earlier revision of this document said no seed
changed at all — which was simply false, and was caught by the clean-room reproof rather
than by review. `supabase/seeds/04_iam_permission_catalog.sql` gained **22 permission
codes** in Wave 3 (+61 / −1; the single deletion is the preceding row's missing trailing
comma). That is additive structural reference data — a permission code with no grant
attached authorises nothing until a tenant role maps it — and it is why the
`iam.permissions` census tests move from 71 to 93. No policy, function, trigger,
constraint or grant changed with it.

## What the phase delivers

**58 operations** across four new modules — `work-order`, `technician`, `diagnostics`
and `quality` — all at operation depth with zero pending. The full surface is generated
in [`endpoint-inventory.md`](endpoint-inventory.md).

| Surface                                    | Operations |
| ------------------------------------------ | ---------- |
| `wo` — work orders, jobs, lines, approvals | 26         |
| `dia` — diagnostic reports and entries     | 13         |
| `qms` — quality control, reopen, rework    | 13         |
| `tech` — labour and technician queues      | 6          |

Also seeded into the catalogs this phase consumes: **22 permission codes**, bringing
`iam.permissions` from 71 to 93; the audit actions the 37 audited operations write; and
ten event catalog entries moved from reserved to `implementedIn: 'P1-19'`.

## Waves

| Wave | Content                                             | Commit(s)                  |
| ---- | --------------------------------------------------- | -------------------------- |
| 0–2  | Protected ground truth, baseline, documentation dir | —                          |
| 3    | Four module skeletons, permission catalog, event CR | foundation commit          |
| 4    | Work-order core — transition, closure, jobs, reads  | Wave 4 chain               |
| 5    | Technician execution — assignment, labour, queues   | Wave 5 chain               |
| 6    | Additional work and customer approvals              | `4f0a347`, fixed `c4dd9f0` |
| 7    | Diagnostics                                         | `f161c8d`, fixed `e90c4f5` |
| 8    | Quality control, reopen refusal, rework             | `e18df4a`, fixed `ddc30b5` |
| 8    | Operational journey through the real routes         | `980d1a8`                  |
| 9    | Phase-wide hardening, evidence, CI gate             | this wave                  |

Each of Waves 6, 7 and 8 was reviewed adversarially before the next began, and each
review found real defects in that wave's own work. The corrections are in the `fixed`
commits above and are described in the wave evidence documents.

## The three findings that changed the design

1. **A rework work order had no creation path anywhere in the platform.** Reception's
   conversion writes seven columns and leaves `kind` to its `'ordinary'` default, and
   nothing else inserted `wo.work_orders` at all — so `qms.rework_links` was
   unreachable and closure blocker B6 could never fire. Wave 8 added `openRework` in
   the `work-order` module, called from `quality` through the module's public surface,
   so the order and its link commit in one transaction.

2. **The reopen endpoint destroyed the ledger it existed to write.** The first
   implementation threw after `qms.attempt_reopen` recorded the attempt, which rolled
   the attempt row back. It now returns 201 carrying the recorded attempt; the refusal
   is the successful outcome.

3. **A diagnostic report cannot be completed before a recommendation exists.** Found by
   the end-to-end journey test, not by any single-surface suite — which is the argument
   for having written it.

## Wave 9 specifically

_Delivers **P1-19-DOC-002** — operator/developer guidance and change-log update._

| Change                                            | Kind          |
| ------------------------------------------------- | ------------- |
| `scripts/p1-19-endpoint-inventory.mjs`            | New gate      |
| `npm run validate:p1-19-inventory`                | New script    |
| One CI step in the `quality` job                  | CI            |
| `evidence/endpoint-inventory.md`                  | Generated doc |
| `evidence/task-traceability.md`                   | Generated doc |
| `evidence/security-review.md`                     | Evidence      |
| `evidence/qa-evidence.md`                         | Evidence      |
| `evidence/devops-observability.md`                | Evidence      |
| `evidence/state-machines-and-closure-gate.md`     | Evidence      |
| `evidence/open-decisions.md`                      | Evidence      |
| `evidence/change-log.md`                          | This file     |
| `tests/backend/p1-19-closure-gate-matrix.test.ts` | New suite     |
| `tests/backend/p1-19-concurrency.test.ts`         | New suite     |
| `evidence/task-register.md`                       | Evidence      |
| `evidence/final-adversarial-review.md`            | Evidence      |
| `evidence/clean-room-validation.md`               | Evidence      |
| `evidence/errors-and-events.md`                   | Evidence      |
| `evidence/pre-merge-completeness-audit.md`        | Evidence      |

The new gate reconciles, on every build, that every declared permission is seeded, that
every declared audit action matches the controlled catalog **including its class**, that
the event catalog and the publishing modules agree in **both** directions, and that
neither generated document has been hand-edited.

Wave 9's slices A, B and C changed **no executable application code** — the inventory
gate, the two new suites and the eight evidence documents touch `scripts/`, `tests/`,
`.github/` and `docs/` only.

**Its fourth slice did**, and an earlier revision of this paragraph claimed otherwise
without qualification. The final adversarial review's remediation (`918347a`) changed
four executable files: the `tech.labor-session-list` scope fix in
`labor-sessions/route.ts` and `labor-session-service.ts`, the `recordLine` and
`closureEligibility` corrections in `work-order-service.ts`, the parent-first lock
reorder in `additional-work-service.ts`, and the removed `reason` field in
`assignments/route.ts`. Those are Wave 9 commits and pretending otherwise would make the
diff contradict this document.

Also added in Wave 9: [`task-register.md`](task-register.md), which exists because the
pre-merge audit found that 13 of the 33 task identifiers were not greppable anywhere.

## Inherited tests

Four files outside this phase changed, all **censuses** — permission, audit-action,
event and published-operation counts — which necessarily move when a phase seeds new
codes. No behavioural assertion anywhere in the repository was relaxed; the diff carries
no removed `toThrow`, status-code or policy expectation. Detail in
[`qa-evidence.md`](qa-evidence.md).

## Still open at close

Five accepted findings — `P1-19-A-01` through `P1-19-A-05`, one Medium and four Low —
are listed with their reasons in [`open-decisions.md`](open-decisions.md). Two of the
five could only be closed by a migration this phase is not authorised to write.

## Not done, deliberately

PR #82 is **not merged**, no gate-record PR exists, no owner gate has been written, and
P1-20 has not been started. `origin/develop` is unchanged at `f326e24` and
`origin/main` is untouched.
