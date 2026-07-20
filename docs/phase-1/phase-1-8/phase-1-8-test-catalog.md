# Phase 1-8 — Test Catalog

**118 P1-08 database tests across 13 files**, green within the full
`npm run test:db` suite (85 files / 958 tests). All isolation assertions run on
the non-privileged `app_runtime` / `app_readonly` login roles; admin (BYPASSRLS)
is used only for fixtures and is never RLS evidence.

| File                                     | Tests | Covers                                                                                                                                                                                 |
| ---------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apt-catalogs.test.ts`                   | 15    | dual-scope catalogs: scope coherence, per-scope uniqueness, immutability, platform visibility, tenant isolation, readonly denial                                                       |
| `apt-appointments.test.ts`               | 13    | master creation, window validation, transition matrix, cancellation/no-show coherence, confirmed-overlap EXCLUDE, cross-tenant FKs, catalog visibility, display-number uniqueness, RLS |
| `apt-appointment-services.test.ts`       | 9     | descriptor rule, P1-10 placeholder (no FK), duplicate-active, orphan, immutability, RLS                                                                                                |
| `apt-appointment-status-history.test.ts` | 7     | emit-per-change, no-op safe, GUC reason/correlation, forged-insert rejection, append-only denial, isolation                                                                            |
| `rec-catalogs.test.ts`                   | 20    | four rec dual-scope catalogs (same contract as apt)                                                                                                                                    |
| `rec-reception-visits.test.ts`           | 12    | XOR origin, one-visit-per-origin, Vehicle coherence, odometer/SOC/fuel, one-open-visit + closed-then-new, state machine, cross-tenant, RLS                                             |
| `rec-party-roles-reasons.test.ts`        | 5     | role taxonomy, active-role uniqueness + dated history, cross-tenant partner, archived reason, orphan, RLS                                                                              |
| `rec-inspection-damage.test.ts`          | 7     | inspection finalize/lock, condition open-gate + correction exemption, version binding + template coexistence, coordinate bounds, orphan, archived warning-light, leak type, RLS        |
| `rec-complaints-contents.test.ts`        | 5     | restricted-payload gating (read/write), hidden-from-non-viewer, correction link + self-correction rejection, readonly denial                                                           |
| `rec-custody-authorization.test.ts`      | 8     | atomic check-in primitive, custody chain, authority + authorized activation contract, conversion-without-work-order, append-only denial, signature version binding, RLS                |
| `apt-rec-concurrency.test.ts`            | 3     | single-winner races ×5 reps: confirmed overlap (23P01), duplicate open visit (23505), duplicate custody accept (23505/23514)                                                           |
| `apt-rec-security.test.ts`               | 8     | auto-enumerated: RLS enabled+forced, policies present, no DELETE grant, readonly SELECT-only, restricted gate, append-only no-UPDATE, branch NOT NULL                                  |
| `apt-rec-classification-guard.test.ts`   | 6     | classification validator negative fixtures (searchable-restricted, missing, stale, bad-class, type-drift) + committed-registry pass                                                    |

Cross-cutting guards that also cover P1-08 (not counted above):
`foundation.test.ts` (table/routine/trigger/policy allow-lists, RLS-forced,
role posture), `org-security.test.ts` (FK-index coverage, no duplicate indexes,
data-dictionary coverage, tenant-column invariant, no DELETE grant),
`no-fake-data.test.ts`, `shared-hardening.test.ts`.
