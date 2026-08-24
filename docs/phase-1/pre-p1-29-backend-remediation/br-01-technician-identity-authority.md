# BR-01 — Technician Identity Authority

|                      |                                                                      |
| -------------------- | -------------------------------------------------------------------- |
| Closes               | `BE-2` · finding `INS-04` (**CRITICAL**) · threat `T-11`             |
| Depends on           | **`BR-03` (hard)** — no roster, nothing to resolve. `BR-08a` (soft). |
| Database change      | **none**                                                             |
| New permission codes | **none**                                                             |
| Complexity           | **S** — one repository method, one route                             |

---

## 1. Problem statement

A technician cannot open their own queue. `tech.technician-queue` is
`GET /technicians/{technicianProfileId}/queue`, and the profile id is a **path parameter** — it
comes from the client. `GET /auth/session` returns
`{userId, tenantId, email, displayName, companyIds, branchIds, permissions[]}` and no profile
reference, so a signed-in technician has no legitimate way to learn the id the endpoint demands.

This blocks the entire technician persona (P1-29 slices D and E) and degrades Owner requirement 7.
It is one of the phase's three Critical findings.

**The temptation this slice exists to remove** is client-side resolution — matching on
`displayName` or an email local-part, or iterating profile ids against the queue endpoint. That is
a correctness defect (names collide) and an enumeration oracle over staff assignments (`T-11`).
`execution-decision.md` §5 binding 3 forbids it outright.

## 2. Existing repository evidence

**The mapping already exists in the database.** This is the correction that makes the slice small;
the register's original wording ("nothing maps a signed-in user to their technician profile") was
wrong at the data layer.

| artefact                                     | evidence                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the column                                   | `tech.technician_profiles.user_id uuid NOT NULL` — `supabase/migrations/20260722094000_tech_profiles_skills_certs.sql:42`                                                                               |
| referential integrity                        | `fk_technician_profiles_user FOREIGN KEY (tenant_id, user_id) REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT` — `:59-60`                                                               |
| at most one live profile per user per tenant | `CREATE UNIQUE INDEX uq_technician_profiles_active_user ON tech.technician_profiles (tenant_id, user_id) WHERE deleted_at IS NULL` — `:67-68`                                                           |
| the read is already index-covered            | `ix_technician_profiles_user ON (tenant_id, user_id)` — `:70`                                                                                                                                           |
| **the edge is immutable**                    | `tg_technician_profiles_immutable` guards `user_id` (and `branch_id`) — `:74-76`. See [C-01](repository-corrections.md#c-01--a-technicians-branch-and-user-are-immutable-so-transfer-is-not-an-update). |
| branch containment is structural             | `company_id`, `branch_id` NOT NULL, composite FK to `org.branches` — `:40-41`, `:56-58`                                                                                                                 |
| the repository already selects it            | `technician-catalog-repository.ts:177`, `:221`; mapped to `userId` at `:186`, `:231`                                                                                                                    |
| the session identity function                | `iam.current_user_id()`, set per transaction by the request wrapper (`transaction.ts:92-105`)                                                                                                           |
| RLS on the table                             | `sel_technician_profiles_scope` — tenant + `iam.allowed_company_ids()` + `iam.allowed_branch_ids()` — `:79-82`                                                                                          |

**Nothing consumes the mapping.** A grep for `userId`/`user_id` across
`apps/api/src/modules/technician/application/` is empty, and neither technician route file mentions
it. The two published `tech` read operations are:

```
GET /technicians/available            tech.technician-available   tech.technician.read
GET /technicians/{profileId}/queue    tech.technician-queue       tech.technician.read
```

Verified: `find apps/api/src/app/api/v1/technicians -name route.ts` yields exactly two files, each
exporting `GET` and nothing else.

**The queue response shape** is an anonymous envelope built in the route handler, not in the
service: `{technicianProfileId: string, items: QueueEntry[]}` —
`technicians/[technicianProfileId]/queue/route.ts:53-61`; the service returns a bare
`readonly QueueEntry[]` (`job-assignment-service.ts:352`).

## 3. Gap

| gap                                                                | class                   |
| ------------------------------------------------------------------ | ----------------------- |
| no operation resolves a caller to their own technician profile     | **Contract**            |
| the only queue read accepts the subject's identity from the client | **Authorization**       |
| the session payload carries no technician reference                | **Contract**            |
| no test asserts that a non-technician caller cannot reach a queue  | **Test**                |
| the frontend has no sanctioned way to render "My jobs"             | **Frontend dependency** |

**Not a gap:** the domain model, the index, the uniqueness guarantee, the referential integrity, or
the branch scope. All present.

## 4. Proposed architecture

**Resolve server-side; never return the identifier.**

Add `GET /technicians/me/queue`, which resolves the caller's profile from `iam.current_user_id()`
inside the request transaction and serves the queue the existing service already produces. The
profile id never crosses the wire in either direction.

Rejected alternative — **adding `technicianProfileId` to the session payload.** It is smaller by
one route, and it is the wrong trade: it puts the identifier in the browser, where the next screen
is tempted to send it back, and it re-creates the client-asserted-identity shape this slice exists
to remove. The register's own sizing reached the same conclusion.

**Route-collision note.** `me` and `{technicianProfileId}` occupy the same path segment. Next.js
App Router resolves a static segment before a dynamic one, so `technicians/me/queue/route.ts` wins
over `technicians/[technicianProfileId]/queue/route.ts` without ambiguity — but `me` must also be
rejected as a UUID by the dynamic route's `Params` schema (it already is: `schemas.uuid`), so a
caller cannot reach the dynamic handler with the literal string.

**Containment is part of the requirement, not a refinement of it.** The resolution must be bounded
to `iam.current_tenant_id()` and must not widen the branch scope the caller already holds. A
contract that returns a profile without those bounds re-opens `T-11` from the other side — instead
of enumerating other people's queues, a caller would obtain a queue they hold no branch grant over.

## 5. Database impact

**None.** No migration, no column, no index, no function, no policy, no grant.

The lookup is `WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL`, guaranteed to return
at most one row by `uq_technician_profiles_active_user`, on an index that already exists.

**Rollback:** delete the route file and the repository method. No data is written by this slice, so
rollback has no data consequence and no ordering constraint.

## 6. API impact

### `tech.technician-me-queue`

| field                   | value                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| **method**              | `GET`                                                                                                           |
| **route**               | `/api/v1/technicians/me/queue`                                                                                  |
| **purpose**             | Return the signed-in caller's own assigned-job queue, resolving their technician profile server-side.           |
| **permission**          | `tech.technician.read` (existing, risk `low`)                                                                   |
| **scope**               | `branch`                                                                                                        |
| **path params**         | none                                                                                                            |
| **query params**        | `companyId` (uuid, **required**), `branchId` (uuid, **required**), `limit?` (1..100, clamped) — `.strict()`     |
| **request body**        | none                                                                                                            |
| **success**             | `200` · `{items: QueueEntry[]}`                                                                                 |
| **idempotency**         | not applicable (read)                                                                                           |
| **version guard**       | not applicable (read)                                                                                           |
| **pagination**          | none — matches `tech.technician-queue`, which is unpaged today. Do **not** add paging to one and not the other. |
| **filtering / sorting** | none, matching the existing queue                                                                               |

**Why the scope pair is required even though the subject is the caller.** `scope: 'branch'` is
inert without a target — `requiresScopedEvaluation` returns false on an empty one, so the check
degrades to scope-blind `iam.has_permission`, and RLS cannot compensate because `app.branch_ids` is
the permission-blind union of every active grant (`P1-18-A-01`, threat `T-02`). Omitting the pair
here because "it's only me" would reintroduce exactly the hole every other collection route closes.

**The response deliberately omits `technicianProfileId`.** The existing endpoint's envelope carries
it because the caller supplied it; here nobody did, and returning it would hand the client the
identifier this slice was built to withhold. `{items}` is the shared `ItemsOnly<T>` envelope
(`apps/web/src/lib/api/read-operation.ts:76`), so the mirror needs no new type.

### Error cases

| condition                                                           | status                              | code                          |
| ------------------------------------------------------------------- | ----------------------------------- | ----------------------------- |
| no session                                                          | 401                                 | `ERR-IAM-001` / `ERR-IAM-002` |
| caller lacks `tech.technician.read` in the named scope              | 403                                 | `ERR-IAM-001`                 |
| `companyId`/`branchId` absent, malformed, or an unknown key present | 422                                 | `ERR-VAL-001`                 |
| caller has **no** technician profile in this tenant                 | **200 with `{items: []}`** — see §8 |
| caller's profile exists but sits in a branch they did not name      | **200 with `{items: []}`** — see §8 |

## 7. Permission model

**Reuse `tech.technician.read`. Mint nothing.** Seeded at
`supabase/seeds/04_iam_permission_catalog.sql:230`, risk `low`, described as _"Read technician
profiles, eligibility and queues"_ — which is exactly this operation.

| actor                                                       | outcome                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Owner / company administrator holding the code company-wide | own queue if they have a profile; empty if not                                         |
| branch manager holding it for the branch                    | same                                                                                   |
| service advisor holding it                                  | same — the code is not technician-specific, and a non-technician simply has no profile |
| **technician**                                              | **the intended path**: their own queue, with no identifier to assert                   |
| technician in tenant B                                      | refused by tenant resolution; cannot reach tenant A's data at all                      |
| technician whose grant is branch X, naming branch Y         | 403 at `iam.has_permission_in_scope`                                                   |

**Self vs other.** This operation has no "other" case by construction — it cannot name a subject.
Reading another technician's queue remains `tech.technician-queue`, unchanged, under the same code.
That is deliberate: this slice adds a _safe_ path, it does not remove the supervisor path, and the
supervisor path is what `INS-04`'s interim form depends on.

**No new authority is created.** A caller who could not previously read any queue still cannot.

## 8. Security requirements

The design rule: **a caller must never be able to distinguish "you have no profile" from "your
profile is elsewhere", and must never receive another person's queue.**

| abuse case                            | required behaviour                                                                                                                 | why                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **client-supplied identity spoofing** | no request field, header, or body names a technician                                                                               | the operation accepts no subject; there is nothing to forge                                    |
| **IDOR**                              | not reachable — no id in the path                                                                                                  | structural, not a check                                                                        |
| **cross-tenant**                      | resolution bounded to `iam.current_tenant_id()`; a tenant-A identity resolves nothing in tenant B                                  | `fk_technician_profiles_user` is `(tenant_id, user_id)`, so a cross-tenant pair does not exist |
| **cross-branch**                      | the queue is filtered by the named `companyId`/`branchId`, and the permission is evaluated against that pair                       | prevents a caller with a profile in branch X reading it while naming branch Y                  |
| **privilege escalation**              | none available — reuses an existing low-risk read code                                                                             |                                                                                                |
| **enumeration (`T-11`)**              | the response carries no profile id and no count that varies with the roster                                                        | closes the oracle rather than moving it                                                        |
| **inactive technician**               | `is_active = false` → empty queue, **not** a distinct error                                                                        | a distinct error is an oracle for "this person is a technician"                                |
| **soft-deleted profile**              | `deleted_at IS NOT NULL` → excluded by the partial unique index and by the query predicate                                         |                                                                                                |
| **deleted / inactive user account**   | `iam.has_permission` already returns false for a non-`active` account; the request fails authorization before reaching the handler | `iam.user_accounts.status`                                                                     |
| **stale assignment access**           | queue content is the existing service's responsibility, unchanged by this slice                                                    |                                                                                                |
| **race**                              | none — the operation writes nothing                                                                                                |                                                                                                |

**The empty-result decision, stated explicitly because it is a security decision and not an
ergonomic one.** A caller with no profile receives `200 {items: []}`, not `404` and not a distinct
error code. `ERR-RES-001` would tell an unauthorised prober that some _other_ caller is a
technician, which is the same class of leak `ERR-CON-001` is deliberately shaped to avoid
(`security-threat-model.md` T-12: _"a stale version and an out-of-scope row indistinguishable,
because distinguishing them would leak existence"_). The frontend renders "you have no assigned
work" for the empty case, which is also the correct message for a technician with an empty queue.

## 9. Validation

Zod, at the route, `.strict()`, following the shipped precedent
`technicians/available/route.ts`:

```
Query = z.object({
  companyId: schemas.uuid,          // required
  branchId:  schemas.uuid,          // required
  limit:     schemas.limit.optional(),
}).strict()
```

| concern                  | rule                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| ids                      | `schemas.uuid` — both required; a non-uuid is `ERR-VAL-001`, never a lookup                                                     |
| enums                    | none in this contract                                                                                                           |
| lengths                  | none                                                                                                                            |
| timestamps               | none                                                                                                                            |
| state compatibility      | none — a read with no state precondition                                                                                        |
| duplicate prevention     | not applicable                                                                                                                  |
| relationship validation  | the profile↔user edge is enforced by `fk_technician_profiles_user`; the handler asserts nothing the database already guarantees |
| foreign ownership checks | the scope pair is validated by `requireScopedPermissions`, not by the handler                                                   |
| empty / partial update   | not applicable                                                                                                                  |
| unknown parameter        | `.strict()` → `ERR-VAL-001`. This matters: a client that sent `technicianProfileId` "helpfully" must be refused, not ignored    |

**`export` the `Query` const.** `BR-08`'s payload-parity gate can only read a schema that is
exported (`contract-mirror-plan.md`: _"Zero route files export their zod schemas … the single
mechanical blocker"_). Every route this plan proposes exports its schemas; that is a standing
requirement, recorded once here and referenced by the other slices.

## 10. Error contract

**No new error codes.** Every condition maps to a code already in
`apps/api/src/server/errors/catalog.ts`.

| condition                               | HTTP | code          | frontend behaviour                                                                                  |
| --------------------------------------- | ---- | ------------- | --------------------------------------------------------------------------------------------------- |
| unauthenticated                         | 401  | `ERR-IAM-002` | `ActionStatus: expired` → re-authenticate                                                           |
| not permitted in scope                  | 403  | `ERR-IAM-001` | `denied` — render the denial and the correlation ID; **never** name the missing permission (`T-12`) |
| malformed or unknown query              | 422  | `ERR-VAL-001` | `invalid` — field errors are keys, not prose                                                        |
| no profile / profile out of named scope | 200  | —             | render the empty state; it is not an error                                                          |
| rate limited                            | 429  | `ERR-RTE-001` | `throttled`, warning tone                                                                           |
| upstream unavailable                    | 503  | `ERR-DEP-001` | `unavailable`, retryable by transport                                                               |

## 11. Audit and history behaviour

`auditClass: none`. This is a read, and every P1-29 read declares `none`
(`security-threat-model.md` T-14).

**Nothing historical is owed by this slice.** It creates no record, changes no state, and adds no
row to any history table. The permanent RootLco history requirements — vehicle history, customer
aggregate history, work-order transactional history — are untouched: this operation projects
existing assignment rows and writes nothing.

One thing worth _not_ doing: do not log the resolved profile id at info level. It would reconstruct
in the log the identifier the contract withholds from the wire.

## 12. Tests

### Positive

| #   | case                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------- |
| P1  | a technician with an active profile and a matching branch grant receives their own queue                                      |
| P2  | the response body contains **no** `technicianProfileId` field                                                                 |
| P3  | the queue content is identical to `tech.technician-queue` called with that profile id by a supervisor — same rows, same order |
| P4  | a caller holding the code company-wide, with a profile, succeeds                                                              |

### Negative

| #   | case                                             | expected                                     |
| --- | ------------------------------------------------ | -------------------------------------------- |
| N1  | no session                                       | 401                                          |
| N2  | session without `tech.technician.read`           | 403 `ERR-IAM-001`                            |
| N3  | `companyId` omitted                              | 422 `ERR-VAL-001`                            |
| N4  | `branchId` omitted                               | 422                                          |
| N5  | `technicianProfileId` sent as a query parameter  | 422 (`.strict()`) — **not** silently ignored |
| N6  | `companyId` not a uuid                           | 422                                          |
| N7  | caller has no technician profile                 | **200 `{items: []}`**                        |
| N8  | caller's profile is `is_active = false`          | **200 `{items: []}`**                        |
| N9  | caller's profile is soft-deleted                 | **200 `{items: []}`**                        |
| N10 | caller's user account is `invited`, not `active` | 403 — refused before the handler             |

### Security

| #   | case                                                                                                                | expected                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| S1  | **cross-tenant**: identity in tenant A, profile id existing in tenant B                                             | 200 `{items: []}` — no leak, no error distinction                      |
| S2  | **cross-branch**: profile in branch X, request names branch Y where the caller holds a grant                        | 200 `{items: []}` — the queue is empty, not another branch's           |
| S3  | **cross-branch escalation**: caller holds `tech.technician.read` in branch X and _any_ grant in branch Y, names Y   | 403 — proves the scope pair is evaluated, not merely accepted (`T-02`) |
| S4  | **forged identity**: two technicians in one tenant; each call returns only the caller's rows                        | run as two distinct restricted users, not asserted                     |
| S5  | **enumeration**: responses for "no profile", "inactive profile", and "profile in another branch" are byte-identical | the oracle is closed only if they are indistinguishable                |
| S6  | **relationship hijack**: attempt to `UPDATE tech.technician_profiles SET user_id = …` as `app_runtime`              | refused by `tg_technician_profiles_immutable`                          |

**S1, S2 and S3 must be executed as a restricted user, not asserted.** `narrowScope` skips the
check for an unrestricted caller, so an isolation proof written against an unrestricted connection
proves nothing.

### Regression — must remain green

- `tech.technician-queue` — unchanged behaviour, unchanged shape, still accepts a path id.
- `tech.technician-available` — untouched.
- The authorization-coverage count equality (`check-authorization-coverage` registered ops ==
  `check-openapi` published ops) — this slice adds **one** to both sides.
- `tests/openapi-contract.test.ts` — its route import list is **hand-maintained** and is its own
  documented trap; the new route must be added to it or the operation is invisible to the contract
  test while both sides agree on the same incomplete registry.

## 13. Definition of Done

- [ ] `GET /api/v1/technicians/me/queue` is registered, published in `openapi.v1.json`, and appears in the operation register.
- [ ] The route file exports its `Query` schema.
- [ ] The operation declares `tech.technician.read`, `scope: 'branch'`, `auditClass: 'none'`.
- [ ] **Zero** migrations added by this slice.
- [ ] **Zero** permission codes added by this slice.
- [ ] The response type contains no `technicianProfileId` field, asserted by a test.
- [ ] Positive tests P1–P4 pass.
- [ ] Negative tests N1–N10 pass.
- [ ] Security tests S1–S6 pass, S1/S2/S3 executed as a restricted user.
- [ ] S5 asserts byte-identical responses across the three empty cases.
- [ ] The new route is present in the `tests/openapi-contract.test.ts` import list.
- [ ] `check-authorization-coverage` and `check-openapi` counts agree after the addition.
- [ ] No file under `apps/web` is changed by this slice.
- [ ] `grep -rn "technicianProfileId" apps/web/src` finds no client-side resolution of any kind.
- [ ] No unresolved Critical or High finding is open against this slice.
