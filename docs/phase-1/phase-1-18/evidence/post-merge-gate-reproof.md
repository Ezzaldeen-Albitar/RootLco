# P1-18 — Post-Merge Gate Reproof at `a13ff8b`

Everything below was executed against the **protected merge commit**, not a local
candidate. Where a number is quoted it was produced by the command named beside
it. Nothing here is carried over from the pre-merge candidate.

---

## 1. Protected merge

| Field         | Value                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| Merge SHA     | `a13ff8b8b1f4002ff60a9112ce8f21d7920f444d`                                 |
| Pull request  | #80 — `fix(p1-18): complete final gate evidence and audit scope`           |
| Parents       | `7caafbe` (develop) + `d1ea977` (branch head)                              |
| Merge tree    | `167fb6fa459fa7b8d1d74276dcdc0f654623ff1d` — identical to `d1ea977^{tree}` |
| Diff          | 15 files, +1179 / −305                                                     |
| `origin/main` | `3e2c44d` — unchanged; P1-18 is **not** on `main`                          |

The merge tree equalling the reviewed branch tree is the drift check: the merge
introduced nothing that was not reviewed.

## 2. Authoritative push CI

Run **#205**, id `30192246332` — event `push`, branch `develop`, SHA `a13ff8b`,
**Success**, 4m 54s. PR-head run #204 is not treated as protected-merge evidence.

| Job                               | Result | Duration |
| --------------------------------- | ------ | -------- |
| Lint, types, tests, build         | pass   | 2m 10s   |
| Docker build validation           | pass   | 3m 33s   |
| Database migrations and RLS tests | pass   | 4m 50s   |
| Secret and sensitive-file scan    | pass   | 12s      |

The only annotations are Node 20 deprecation notices on `actions/checkout@v4` and
`actions/setup-node@v4`, present on all four jobs and on earlier runs.

## 3. Phase span and schema invariance

Five merged pull requests: #75 → `83f1c76`, #76 → `addc39b`, #77 → `fb50ef4`,
#79 → `7caafbe`, #80 → `a13ff8b`. Across `9d685e3..a13ff8b`: 57 files,
+20242 / −60.

Migrations **119 → 119**. No migration added, none modified, no `120`. The only
change under `supabase/` in the entire phase is
`supabase/seeds/04_iam_permission_catalog.sql` (+37 / −1) — the nine `apt.`/`rec.`
permission codes appended to the structural reference catalog. This is recorded
explicitly because "P1-18 touches nothing under `supabase/`" would be false.

## 4. Serial battery at `a13ff8b`

Run one gate at a time on the fast-forwarded local `develop`.

| Gate                              | Result                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `format:check`                    | Prettier clean                                                                                                           |
| `lint`                            | clean                                                                                                                    |
| `typecheck`                       | clean                                                                                                                    |
| `test` (unit)                     | **39 files / 829 tests** passed                                                                                          |
| `build`                           | Compiled successfully                                                                                                    |
| `validate:module-boundaries`      | OK                                                                                                                       |
| `validate:authorization-coverage` | OK — every operation guarded, every route registered                                                                     |
| `validate:operation-coverage`     | P1-18: 12 registered, **12 operation-depth**, 0 invocation-only, 0 pending, 0 unit-only, 0 unreferenced, 0 metadata-only |
| `validate:openapi`                | 3.1.0 — **94 paths, 110 operations**, all guarded                                                                        |
| `validate:encoding`               | clean UTF-8, no BOM                                                                                                      |
| `validate:canonical-docs`         | 2 canonical documents verified, neither copied nor modified                                                              |
| `style:check`                     | clean                                                                                                                    |
| `validate:aptrec-classification`  | 454 apt/rec columns classified (4 restricted, 0 searchable); registry reconciles with live schema                        |
| `security:all`                    | 4 sub-scripts emitting **5** OK assertions over 1103 tracked files                                                       |
| `test:db`                         | **132 files / 1547 tests** passed                                                                                        |
| `test:backend`                    | **38 files / 771 tests** passed                                                                                          |
| P1-18 foundation subset           | 2 files / **136 tests** passed                                                                                           |
| P1-18 backend subset              | 3 files / **124 tests** passed                                                                                           |
| `validate:seed-state`             | fails on the developer database, passes in the clean room — see §8                                                       |

Totals: **Unit 829 / DB 1547 / Backend 771**.

`security:all` is four npm sub-scripts — `security:tracked-secrets`,
`security:browser-secrets`, `security:scope-exclusions`, `validate:no-fake-data` —
and emits five OK lines because `scope-exclusions` asserts two separate guards.
Both figures are stated so neither reads as a miscount.

## 5. Artifact stability

Each generator run twice on an unchanged tree and the outputs compared.

| Artifact                      | Result                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `validate:operation-coverage` | byte-identical, md5 `dfa986ed3e8574a8d929215b733cf089`                                                                                                                         |
| `validate:openapi`            | byte-identical, md5 `4b2090d0818635b847eda2af2a5aed59`                                                                                                                         |
| `validate:upgrade-matrix`     | differs **only** in `upgrade=<ms>` wall-clock fields; with timings normalised, byte-identical, md5 `4369a7520855040c0b0826a2dfa98b68`. 11 boundaries, all `hash_match=true ok` |

`scripts/check-operation-test-coverage.mjs` writes **five** operation-test
matrices, not one. All five were hashed before and after regeneration. An earlier
revision of the P1-18 evidence sampled two of the five and still concluded "zero
drift"; condition 16 covers all of them, so all of them are listed:

| Matrix       | md5 before and after regeneration  |
| ------------ | ---------------------------------- |
| `phase-1-14` | `179ef098150d9cdcc80ea91cfef362e9` |
| `phase-1-15` | `5ef653629a08c25a7a3f96de2e8f6f9e` |
| `phase-1-16` | `e5880ff0a112479041d1fe03b031cc0e` |
| `phase-1-17` | `e6f273d8c79c82ba7f2f6ec43a0b175c` |
| `phase-1-18` | `ad6123ae2ddebb3b283bdf5c42a5a1cc` |

All five byte-identical. No tracked file was modified by running any validator —
`git status` clean afterwards, including the four earlier phases' evidence
directories.

## 6. Independent route inventory

Counted from the filesystem, not from any manifest the gates also read.

- `find src/app/api -name route.ts` → **95**
- Under `src/app/api/v1/` → **94**, every one containing a `defineOperation`
  declaration; OpenAPI publishes **94 paths / 110 operations**
- Outside `v1` → exactly one, `src/app/api/health/route.ts`: the P1-01
  unauthenticated liveness probe behind the Docker `HEALTHCHECK`. It is outside
  the authorization gate's scan root (`src/app/api/v1/**`) **by construction**,
  not by an allow-list entry, and returns no tenant data
- apt/rec route files → **12**, carrying 12 distinct `apt.`/`rec.` operation ids

All twelve declare `scope: 'branch'`. Audit classes are **10 `privileged` + 2
`approval`**. Ten pass `authorizeScope`; the two collection creates
(`apt.appointment-create`, `rec.reception-create`) authorize pre-handler via
`scopeTargetOption(body)` because no row exists yet to lock.

## 7. Exact-SHA clean room — PostgreSQL 17.6

`postgres:17.6-alpine`, port 55490, built only from the tree at `a13ff8b`:
119 migrations applied in order, then the 7 declared seed files. Torn down after
evidence capture.

| Measure                       | Value                                                              |
| ----------------------------- | ------------------------------------------------------------------ |
| Migrations                    | **119**, no `120`                                                  |
| Seeds                         | **7** declared files                                               |
| `schema_hash`                 | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` |
| Baseline fingerprint          | `0ee203f2a6236ab8858f25ee9c30217943b491a215d2cf13b4eaed92f2ac05c1` |
| Schemas / tables / columns    | 17 / **242** / 3562                                                |
| Functions (non-extension)     | **212**                                                            |
| Triggers / policies / indexes | **541** / **631** / **999**                                        |
| Constraints / views           | 1845 / 0                                                           |
| `SECURITY DEFINER`            | **0**                                                              |
| RLS enabled but not forced    | **0**                                                              |
| apt/rec tables                | 29 — all RLS enabled **and** forced                                |

The `schema_hash` is byte-identical to the frozen P1-17 baseline, which is the
proof that P1-18 changed no schema object.

The function count is **212 excluding extension-owned functions**. A naive count
over all non-system schemas returns 514; the difference is entirely
`extensions`-owned. Stated because the raw number contradicts the baseline and
would otherwise look like drift.

### Catalogs

`iam.permissions` = **71**, of which **9** are `apt.`/`rec.`:
`apt.appointment.lifecycle.manage`, `apt.appointment.manage`,
`rec.reception.approve`, `rec.reception.authorization.verify`,
`rec.reception.convert`, `rec.reception.evidence.manage`, `rec.reception.manage`,
`rec.reception.party.manage`, `rec.reception.signature.manage`.

### Emptiness

Exact `count(*)` over every base table in apt, rec, crm, veh, wo, tech, dia, qms,
svc, quo, inv, sal, wty, rpt, org. The only non-empty tables are the six
structural reference catalogs: `inv.units_of_measure` 12, `sal.payment_methods` 3,
`wo.job_states` 6, `wo.job_transitions` 10, `wo.work_order_states` 9,
`wo.work_order_transitions` 15.

Every apt/rec table is **0**. Zero tenants, zero users, zero business rows —
consistent with the standing no-fake-data policy.

### Role grants

- `app_readonly` — **SELECT only**, 238 tables, zero non-SELECT privileges
- `app_runtime` on apt/rec — INSERT 29, SELECT 29, UPDATE 23, **DELETE 0**
- `app_runtime` DELETE anywhere — only `iam.grant_scopes`, `iam.role_permissions`
- apt/rec DELETE grants exist only for the `postgres` owner role, and **no apt/rec
  table has a DELETE policy at all**, so RLS refuses deletion independently

## 8. `validate:seed-state` — corrected attribution of `P1-05-SEEDRESIDUE`

In the clean room the gate **passes, exit 0**: _"7 declared files applied twice;
five exact retention classes; every business table empty; counts idempotent."_

On a developer database that has run the DB suite it **fails**. Earlier records
described this as row residue. That was imprecise; the mechanism is a **value
mutation**. `tests/db/shared-retention.test.ts:59-67` overrides the governed
retention periods —

```
ON CONFLICT (class_code) DO UPDATE
  SET min_retention_days = EXCLUDED.min_retention_days,
      allows_deletion    = EXCLUDED.allows_deletion
```

— setting `operational` → 0 and `evidence-audit` → 3650 where seed 05 leaves both
`NULL`, and never restores them. Observed local state after the DB suite:
`evidence-audit=3650`, `operational=0`, the rest `NULL` — exactly those writes.

Provenance: introduced 2026-07-18 by `684ad37`
("P1-05: clean-room fix — retention test robust to seed 05").
`git log 7caafbe..a13ff8b -- tests/db/shared-retention.test.ts` is empty, so the
P1-18 merge did not touch it. The test's own comment names `validate:seed-state`
as "the authority on the seed's own governed values" while overriding them.

Not a P1-18 defect and not a seed defect. Pre-existing test hygiene, Low.

### Tooling trap found while proving this

`scripts/db/validate-seed-state.mjs` reads `DB_HOST` / `DB_PORT` / `DB_NAME` /
`DB_USER` / `DB_PASSWORD` and **ignores `DATABASE_URL`**, defaulting to port 54322. Passing `DATABASE_URL` silently validates the local developer database
instead of the intended target. This produced a false "the clean room fails too"
reading during this reproof, corrected only by re-running with `DB_PORT=55490`.
Recorded so the same mistake does not become future evidence. Low.

## 9. Reproof of the blockers PR #80 closed

| Item                          | Verified at `a13ff8b`                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit scope stamping          | All **four** `appendAudit` calls in `appointment-service.ts` stamp company and branch — create at `155-156` (`plan.*`), reschedule `228-229`, cancel `259-260`, no-show `302-303` (`current.*`) |
| Create-path comment           | Now reads "caller-SUPPLIED, not server-resolved", naming the three things that pin the pair                                                                                                     |
| Measured coverage count       | `operation-coverage-gate.test.ts:551` asserts `toHaveLength(41)`; `:146` requires the gate text to match `/fails 41 of them/`                                                                   |
| Real resolver fixture         | **3** `resolveScopeFor(handleFor` call sites in the containment suite                                                                                                                           |
| Attribution wording           | Mutation proofs state "They prove attribution. They cannot prove exclusivity."                                                                                                                  |
| 19-task map                   | `BE-001` … `BE-019` all present in `task-traceability.md`                                                                                                                                       |
| Evidence files                | All present under `docs/phase-1/phase-1-18/evidence/`                                                                                                                                           |
| Gate state before this record | `Decision: **Pending**`                                                                                                                                                                         |

## 10. Post-merge review round

Four independent read-only reviews at `a13ff8b` — security, correctness/QA,
documentation/evidence, and DevOps/release-readiness. None ran tests, touched a
database, or edited a file.

**Outcome: 0 Critical. 1 High, resolved by this gate record.**

The High was **my own false evidence**: both `devops-observability.md` and
`security-review.md` asserted that persisting denials to `iam.security_events`
"requires a write privilege `app_runtime` does not hold". Verified false —
`af240f0` (P1-13) added both the `INSERT` grant and the policy
`ins_security_events_runtime`, and P1-13's own gate row `ADV-07` records the
capability as _proven_. Corrected in both files; the real cause (`noteDenial` has
no call site) is now stated and carried forward as `P1-18-R-03`.

The security review found **no cross-branch or cross-tenant write and no
fail-open through `authorizeScope`**, independently tracing all four locked-row
choke points, confirming the deferred target is always the locked row's own scope
inside the same transaction, and confirming idempotency keys are not replayable
across branches or tenants. The correctness review confirmed the containment
suite is load-bearing — removing `authorizeScope` from any of the ten turns 403
into 201/200 — and that `expectRefusal` discriminates 403 from 404 by error code,
F10's discovery is genuinely dynamic, and the 41 is measured rather than pinned.

New findings carried forward, none blocking: `P1-18-R-03` … `P1-18-R-10`,
catalogued in `security-review.md` and `devops-observability.md`.
