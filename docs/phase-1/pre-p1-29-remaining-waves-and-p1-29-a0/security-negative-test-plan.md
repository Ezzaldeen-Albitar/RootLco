# P1-29 A0 — design-time threat analysis and the negative tests owed before implementation

**Twelve threat classes against the ten Backend prerequisites, each with the negative tests that
must exist before the corresponding code is written.**

A negative test written after the feature tends to assert what the feature does. Written first, it
asserts what the feature must never do. Every test below is of the second kind.

## The structural fact that makes all of this load-bearing

**No RLS policy in `wo`, `dia`, `tech` or `qms` consults a permission code**, except
`iam.sensitive.view` on three restricted sidecars. The API operation declaration is the **sole**
enforcement point for permissions in this domain. There is no second line of defence, so a
permission mistake is a disclosure, not a lint finding.

A second fact narrows it further: a scope declaration is **inert without a target**, and
`app.branch_ids` is the _permission-blind_ union of every active grant. Omitting the company/branch
pair does not fail loudly — it silently downgrades the check.

---

## T-A0-01 — IDOR on every id-addressed prerequisite

**Applies to** `BE-2`, `BE-3`, `BE-4`, `BE-9`, `BE-10`.

An id in a path or body is a _claim_, never an authorisation. The repository's own rule, stated in
the intake-catalogue repository, is that a picker read may trust RLS alone **because it is not
id-addressed**, and every id-addressed statement carries an explicit dual-scope tenant predicate.

**Negative tests.** For each id-addressed operation: a caller submits an id belonging to another
tenant → refused; another company → refused; another branch within reach → refused unless the
operation is company-scoped by declaration; a soft-deleted row's id → refused, not 500.

## T-A0-02 — cross-tenant exposure

**Applies to** nine of the ten — every prerequisite except `BE-5`, which adds no read, no write and no table.

**Negative tests.** Two tenants, identical fixture data. Every new read returns only the caller's
rows. Every new write against the other tenant's id is refused. **The diagnostic template case is
the sharpest**: tenant A must not be able to open an inspection against tenant B's published
template version, and the template tables have no company/branch columns, so tenancy is the only
predicate protecting them.

## T-A0-03 — cross-branch exposure

**Applies to** `BE-10` above all, then `BE-1`, `BE-3`.

**Negative tests.** A caller holding `wo.work_order.read` in branch A **and any grant at all** in
branch B must not see branch B's jobs or QC records. That is the exact shape of `P1-18-A-01`, and
it is why the pair is mandatory. Additionally: a collection adapter called **without** the pair
must be impossible by construction, asserted by a test over the feature module, not by review.

## T-A0-04 — technician identity spoofing

**Applies to** `BE-2`, `BE-9`.

**Negative tests.** A caller cannot obtain another person's queue by supplying a profile id. A
caller with no profile receives empty or refused — never a fallback. **A grep-style test asserts
that no client-side identity resolution exists anywhere in `apps/web`**: no match on display name,
no match on email local-part, no iteration over profile ids. And for `BE-9`: a roster write cannot
create a profile bound to another person's user account, or in a branch the caller does not hold.

## T-A0-05 — unknown permission code

**Applies to** `BE-5`, and through it to `BE-4` and `BE-9`, the two that mint codes.

**Negative test — the red-proof.** Register an operation declaring a code absent from the
catalogue → **gate RED**. Restore → **gate GREEN**. Nothing less proves the gate works.

**A second negative test the gate itself needs**: feed it a file containing an `auditAction` whose
literal has the same three-segment shape as a permission code, and assert the gate does **not**
report it. A regex-based implementation fails this test, which is the point of writing it.

## T-A0-06 — dynamic workflow tampering

**Applies to** `BE-1`.

The state graphs are tenant-overridable data. Publishing them creates a new question: can a caller
influence _which_ catalogue they receive?

**Negative tests.** The catalogue read returns the caller's tenant's resolved graph and never
another tenant's; a tenant row shadows the platform row it overrides and the platform row does not
leak alongside it; an `inactive` row is excluded. And on the consuming side: the UI offering an
action for an edge the catalogue does not contain must be caught by a test, because the server will
refuse it with `ERR-TRN-001` and the user will have been lied to.

## T-A0-07 — customer projection over-read

**Applies to** `BE-3`.

The projection crosses from `wo` into `rec` and `crm`. The risk is that it returns the customer
_record_ where it should return the party _of that visit_.

**Negative tests.** The projection exposes only the fields the work-order surface needs, at the
party role it names — not the partner's full CRM record. A caller holding `wo.work_order.read`
alone succeeds; the projection does **not** silently require or leak data that
`rec.reception.read` would gate. Restricted CRM fields do not appear.

## T-A0-08 — template cross-tenant reuse

**Applies to** `BE-4`.

**Negative tests.** Opening an inspection against another tenant's `templateVersionId` is refused.
Authoring against another tenant's template is refused. A `draft` version cannot be selected for an
inspection. Changing an item on a `published` version is refused **by the existing guard**, and the
test must prove the guard fires rather than that the route declines — those are different controls
and only one of them survives a new caller.

## T-A0-09 — mass assignment

**Applies to** `BE-4`, `BE-9`, `BE-3`.

Every write body in this platform is a strict zod schema, which is the control. The threat is a
schema that is not strict, or one that accepts a server-owned field.

**Negative tests.** Each new body rejects an unknown property. Each rejects any attempt to set
`tenant_id`, `company_id`, `branch_id`, `created_by`, `record_version`, or a status the transition
function owns. For `BE-9` specifically: `user_id` must be validated as an account in the caller's
tenant, not merely accepted as a uuid.

## T-A0-10 — role-name authorization

**Applies to** all ten, as a prohibition.

P-5 is absolute: **authorization is by permission, never by role name.**

**Negative test.** **Negative test.** A gate over the SQL migrations and the whole `apps` TypeScript tree asserting that no IAM authorization decision reads a role code or display name — the same two-tree evidence base `rbac-effective-permission-model.md` §10 greps.

It cannot be folded into `BE-5`, and the two do not walk the same declarations. `BE-5`'s gate reads the `permissions` array of a parsed `defineOperation` call **and nothing else** (§7), `OperationDeclaration` has no role field (`apps/api/src/server/auth/operation-registry.ts:117-190`), and `grep -rnE "roleCode|role_code" apps/api/src/app/api/v1` returns exactly two hits — a zod body schema at `iam/roles/route.ts:32` and a prose comment at `iam/roles/[roleId]/route.ts:4` — neither of them an authorization decision. A P-5 gate walking the 305 parsed declarations would therefore pass vacuously, and be subsumed by `BE-5` besides: a role code is not a catalogue permission code, so `BE-5` already fails on one. That is the false-green failure mode this plan names for `BE-5` itself.

It is also new work rather than a rider. Today the only automated P-5 guard is the source scan at `apps/web/tests/security.test.ts:326-332`, scoped to the single file `apps/web/src/lib/permissions.ts`; there is no equivalent gate over `apps/api` or `supabase`.

The gate must carry one explicit, justified exemption or it goes red on shipped code: `rec.guard_authorization_authority` (`supabase/migrations/20260721105000_rec_authorization_custody.sql:85-105`) tests `r.relationship_role IN ('approving_party', 'service_requester', 'vehicle_owner', 'authorized_receiver')` — an authority decision by literal role name, but about an external business partner on a reception visit, not about an IAM principal. `is_system` in five RLS policies (`20260726090000:274`, `:280-282`, `:308`, `:327`, `:350`) is the second near-miss and is likewise not a violation: it protects the object being written and grants the subject nothing.

## T-A0-11 — frontend-only authorization

**Applies to** every frontend slice consuming these prerequisites.

**Negative tests.** For each new operation: the server refuses an unauthorised caller **even when
the client would have hidden the control**. Exercise the adapter directly, with the control hidden,
and assert the refusal. A screen test that only checks the button is absent proves nothing about
authority.

## T-A0-12 — audit actor forgery

**Applies to** `BE-3`, `BE-4`, `BE-9`, and any new write.

**Negative tests.** No new operation accepts an actor id from the request body — asserted by a
scan, not by review. The audit row's actor equals the authenticated principal. And a composed
action's two calls are recognised as two audit events: the test asserts what the trail actually
records, so that no document later claims one intent was recorded as one event.

---

## Coverage summary

| prerequisite                | threats that apply         |
| --------------------------- | -------------------------- |
| `BE-1` state catalogues     | 02, 03, 06                 |
| `BE-2` technician identity  | 01, 02, 04, 11             |
| `BE-3` customer projection  | 01, 02, 03, 07, 09, 12     |
| `BE-4` diagnostic templates | 01, 02, 05, 08, 09, 11, 12 |
| `BE-5` parity gate          | 05, 10                     |
| `BE-6` notifications        | 02, 12                     |
| `BE-7` departments          | 01, 02, 03                 |
| `BE-8` job log and evidence | 01, 02, 09, 12             |
| `BE-9` technician roster    | 01, 02, 04, 09, 12         |
| `BE-10` branch queues       | 01, 02, **03**, 11         |

**Nine of the ten prerequisites carry T-A0-02** — all but `BE-5`, which adds no read, no write
and no table. That is not padding: cross-tenant isolation is the one property whose failure is
unrecoverable, and it is a property a bare-Postgres CI tier **can** prove, so there is no excuse
for omitting it anywhere.
