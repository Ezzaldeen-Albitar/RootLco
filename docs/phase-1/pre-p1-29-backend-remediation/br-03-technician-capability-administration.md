# BR-03 — Technician Profile and Capability Administration

|                      |                                                                                |
| -------------------- | ------------------------------------------------------------------------------ |
| Closes               | `BE-9` · `DEP-B2` · finding `INS-24` (**BLOCKER**) · Owner requirement 5       |
| Depends on           | `BR-08a` (soft-strong) — the parity gate should police the code decision below |
| **Blocks**           | **`BR-01` (hard)** — with no roster there is no profile to resolve             |
| Database change      | **none**                                                                       |
| New permission codes | **one, and the decision is forced — see §7**                                   |
| Complexity           | **M**                                                                          |

---

## 1. Problem statement

> _A production tenant has zero technicians and no supported means of acquiring any._

Six `tech` operations ship. All six are reads or labour-session state changes. There is **no `POST`
or `PATCH` anywhere under `apps/api/src/app/api/v1/technicians/`**, and the only code that inserts a
technician profile is test scaffolding.

Two consequences, and the second is the one the frozen gate missed:

1. Owner requirement 5 — _"assign named employees and technicians"_ — cannot be met, because the
   availability picker returns candidates from a roster nothing can populate.
2. **`BR-01` is useless without this slice.** It resolves a caller to _their_ technician profile. If
   no profile can be created, it resolves nothing, and the technician persona stays exactly as
   blocked as before. `BE-9` is a hard prerequisite of `BE-2`, and the P1-29 backend prerequisite
   gate does not say so.

## 2. Existing repository evidence

All in `supabase/migrations/20260722094000_tech_profiles_skills_certs.sql` unless noted.

### The five tables, and what they already guarantee

| table                                   | shape                                                                                                  | line       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------- |
| `tech.technician_profiles`              | `id, tenant_id, company_id, branch_id, user_id, trade?, is_active, employment_ref?, record_version, …` | `:37-62`   |
| `tech.technician_skills`                | `…scope key, technician_profile_id, skill_id, skill_level_id`                                          | `:99-120`  |
| `tech.technician_certifications`        | `…scope key, technician_profile_id, certification_id, issued_on, expires_on?`                          | `:158-177` |
| `tech.technician_certification_details` | the restricted sidecar — `certificate_number`, `CHECK (classification = 'restricted')`                 | `:221-241` |
| `tech.technician_availability`          | `…scope key, technician_profile_id, …interval`                                                         | `:280-299` |

Catalogues they reference are **dual-scope** (`scope text NOT NULL`, platform or tenant):
`tech.skills`, `tech.skill_levels` (carrying `rank integer NOT NULL`), `tech.certifications` —
`20260722092000_tech_catalogs.sql:31, :81-85, :131`.

Note the FK asymmetry, which matters for validation: `fk_technician_skills_skill FOREIGN KEY
(skill_id) REFERENCES tech.skills (id)` is **single-column** (`:119-120`), because a platform
catalogue row has a NULL `tenant_id` and cannot participate in the composite. So the database
cannot prove a tenant is referencing a catalogue row it is entitled to; **the service must.**

### What the write path already permits

```
GRANT SELECT, INSERT, UPDATE ON tech.technician_profiles          TO app_runtime;   -- :92
GRANT SELECT, INSERT, UPDATE ON tech.technician_skills            TO app_runtime;   -- :151
GRANT SELECT, INSERT, UPDATE ON tech.technician_certifications    TO app_runtime;   -- :214
GRANT SELECT, INSERT, UPDATE ON tech.technician_certification_details TO app_runtime; -- :273
GRANT SELECT, INSERT, UPDATE ON tech.technician_availability      TO app_runtime;   -- :339
```

and `ins_technician_profiles_scope` / `upd_technician_profiles_scope` (`:83-91`) already admit the
insert and the update under tenant + `iam.allowed_company_ids()` + `iam.allowed_branch_ids()`.

**The row layer is ready. Only the contract is absent.**

### The constraint that shapes the whole slice

```
CREATE TRIGGER tg_technician_profiles_immutable BEFORE UPDATE ON tech.technician_profiles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'user_id', 'created_at', 'created_by');   -- :74-76
```

plus `uq_technician_profiles_active_user (tenant_id, user_id) WHERE deleted_at IS NULL` (`:67-68`).

See [C-01](repository-corrections.md#c-01--a-technicians-branch-and-user-are-immutable-so-transfer-is-not-an-update).
**A technician profile has exactly three writable columns: `trade`, `is_active`, `employment_ref`.**

### What the table deliberately does not hold

> _"NEVER duplicates salary/government-id/contact/medical/payroll data. `employment_ref` is an
> opaque non-PII operational link."_ — the table's own `COMMENT`, `:63-65`.

This is binding on the API surface. A roster contract that accepted a name, a phone number or an
employee record is contradicting the schema's stated purpose.

## 3. Gap

| gap                                                                                                     | class                                                    |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| no operation creates a technician profile                                                               | **API**                                                  |
| no operation updates or deactivates one                                                                 | **API**                                                  |
| no operation reads one — an assignment names a `technicianProfileId` and nothing resolves it (`INS-24`) | **API**                                                  |
| no operation attaches a skill, a certification or an availability interval                              | **API**                                                  |
| the profile↔catalogue reference cannot be scope-validated by the database                               | **Validation**                                           |
| no permission code governs a roster write                                                               | **Authorization**                                        |
| a branch transfer has no supported expression                                                           | **Domain model** — and the answer is "by design", see §4 |
| `BR-01` has no subject                                                                                  | **Frontend dependency**                                  |

**Not a gap:** every table, index, RLS policy, grant, and the uniqueness and immutability
guarantees. This slice writes no SQL.

## 4. Proposed architecture

**A roster service over the five existing tables, with a profile read that closes `INS-24`.**

Four design positions, each forced by evidence rather than chosen:

### 4.1 A branch transfer is deactivate-then-create, and the API says so

`branch_id` is immutable, and the partial unique index permits one live profile per user per
tenant. So moving a technician between branches is:

1. `PATCH` the old profile to `is_active = false`, **and soft-delete it**;
2. `POST` a new profile in the target branch.

The ordering is forced — inserting first raises `23505` on
`uq_technician_profiles_active_user`.

**Do not expose a `transfer` operation that hides this.** It would be a two-call composition with
no shared transaction, i.e. exactly the partial-failure shape `A3.2` catalogues for start/pause,
and its failure mode is worse: a technician with no live profile in either branch. The honest
surface is the two operations, and the frontend owns the sequence and its recovery.

### 4.2 Deactivation and deletion are different, and both are needed

| act            | mechanism           | meaning                                                                                                        |
| -------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| **deactivate** | `is_active = false` | still on the roster, not eligible for assignment. Reversible.                                                  |
| **retire**     | `deleted_at` set    | off the roster; frees the `uq_technician_profiles_active_user` slot so the person can be re-profiled elsewhere |

`ERR-TECH-001`'s catalogue description already names _"an inactive profile"_ as an eligibility
failure, so `is_active` is consumed by the assignment path today and needs no new plumbing.

### 4.3 The profile read closes `INS-24` and is not optional

`INS-24` — _"a technician has no name"_ — is a **BLOCKER** against Owner requirement 5, and it is
closed by a read, not by the roster writes. An assignment names a `technicianProfileId`; without a
profile read the supervisor's screen renders a UUID. That read belongs here because it is the same
service and the same permission decision.

**It must not return a name the platform does not hold.** `tech.technician_profiles` holds no name
— by design (§2). The resolvable attributes are `trade`, `is_active`, `employment_ref` and
`user_id`. A display name would have to come from `iam.user_accounts`, which is a different module
and a different authority. **This slice returns the operational profile and `userId`, and records
that resolving `userId` to a human name has no contract** (`admin.contractGap.noDirectory`) — the
same position appointments and approval-limits already ship.

### 4.4 No department on the profile

[`BR-02`](br-02-department-domain-surface.md) §4 places `department_id` on `wo.jobs`. A technician's
department is therefore not a roster attribute, and this slice adds none. Putting it on the profile
would make a job's department depend on who was assigned, and — because `branch_id` is immutable
and `department_id` would sit beside it — would be near-impossible to correct.

## 5. Database impact

**None.** No migration, no column, no index, no function, no policy, no grant.

**Rollback:** delete the routes and the service. Rows already written remain, and remain valid —
they are ordinary roster rows that the availability and queue reads already understand. There is no
schema state to unwind and no ordering constraint.

## 6. API impact

Eight operations. All under `/api/v1/technicians`.

| #   | id                                            | method  | route                                                                        |
| --- | --------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| 1   | `tech.technician-create`                      | `POST`  | `/technicians`                                                               |
| 2   | `tech.technician-update`                      | `PATCH` | `/technicians/{technicianProfileId}`                                         |
| 3   | `tech.technician-list`                        | `GET`   | `/technicians`                                                               |
| 4   | `tech.technician-detail`                      | `GET`   | `/technicians/{technicianProfileId}`                                         |
| 5   | `tech.technician-skill-set`                   | `PUT`   | `/technicians/{technicianProfileId}/skills/{skillId}`                        |
| 6   | `tech.technician-certification-record`        | `POST`  | `/technicians/{technicianProfileId}/certifications`                          |
| 7   | `tech.technician-availability-record`         | `POST`  | `/technicians/{technicianProfileId}/availability`                            |
| 8   | `tech.technician-certification-detail-record` | `PUT`   | `/technicians/{technicianProfileId}/certifications/{certificationId}/detail` |

### 1 · `tech.technician-create`

| field         | value                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| purpose       | Put a user on a branch's technician roster.                                                                                                              |
| permission    | **`tech.technician.manage`** (new — §7)                                                                                                                  |
| scope         | `branch`                                                                                                                                                 |
| body          | `{userId: uuid, companyId: uuid, branchId: uuid, trade?: string(1..64), employmentRef?: string(1..64)}` `.strict()`                                      |
| success       | `201` · `TechnicianProfileView`                                                                                                                          |
| idempotency   | **yes** — `Idempotency-Key` required. A retried create must not produce a second profile; the unique index would refuse it with a raw `23505` otherwise. |
| version guard | no (create)                                                                                                                                              |
| errors        | 409 `ERR-RES-002` if a live profile already exists for the user; 422 `ERR-VAL-001` for an unknown or out-of-scope `userId`                               |

`is_active` is **not** in the body — a created profile is active. Offering it would let a caller
create a profile that is inert on arrival for no stated reason.

### 2 · `tech.technician-update`

| field         | value                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| purpose       | Change trade, employment reference, or active state. Retire the profile.                                  |
| permission    | `tech.technician.manage`                                                                                  |
| body          | `{trade?: string \| null, employmentRef?: string \| null, isActive?: boolean, retire?: true}` `.strict()` |
| success       | `200` · `TechnicianProfileView`                                                                           |
| version guard | **yes** — `If-Match`; absent is 428                                                                       |
| idempotency   | no — version-guarded, matching `wo.job-update`                                                            |
| errors        | 422 if the body is empty; 422 if `retire: true` is combined with any other field                          |

**`branchId` and `userId` are absent from the body and must be rejected if sent** — they are
immutable at the database layer, and a request that names them is asking for something the platform
will not do. Silently ignoring them is the worse failure: the caller believes the transfer happened.

### 3 · `tech.technician-list`

| field      | value                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| purpose    | The branch roster — the read `INS-24` needs, and the picker `BR-01` does not replace.                        |
| permission | `tech.technician.read`                                                                                       |
| scope      | `branch`                                                                                                     |
| query      | `companyId` (**required**), `branchId` (**required**), `isActive?: boolean`, `cursor?`, `limit?` `.strict()` |
| success    | `200` · `Page<TechnicianProfileView>` — **keyset-paged**, unlike the queue                                   |
| sorting    | server-fixed, stable, keyset-compatible                                                                      |

Paged because a roster is unbounded, unlike a picker. A conclusion drawn from page one is the
P1-28 round-two defect.

### 4 · `tech.technician-detail`

`GET /technicians/{technicianProfileId}` · `tech.technician.read` · `200` ·
`TechnicianProfileDetail` = `{profile, skills[], certifications[], availability[]}`.

One read, one screen, no fan-out — following `GET /inspections/{id}`, the precedent aggregate read
in this domain.

**`certifications[]` carries no certificate number.** That is
`tech.technician_certification_details`, restricted behind `iam.sensitive.view` in RLS _and_ in the
declaration (operation 8), and it must be fetched by its own adapter under its own check —
never folded into this response (`T-04`).

### 5 · `tech.technician-skill-set`

`PUT /technicians/{id}/skills/{skillId}` · `tech.technician.manage` · body `{skillLevelId: uuid}`
· `200`.

`PUT` because the relation is one level per (technician, skill): re-sending sets, it does not
accumulate. This is the `dia.diagnostic-item-result` shape — a `PUT` that records **or replaces** —
and reusing it keeps one idiom in the domain.

### 6 · `tech.technician-certification-record`

`POST /technicians/{id}/certifications` · `tech.technician.manage` · idempotent ·
body `{certificationId: uuid, issuedOn: date, expiresOn?: date}` · `201`.

Validation: `expiresOn > issuedOn`; `issuedOn` not in the future.

### 7 · `tech.technician-availability-record`

`POST /technicians/{id}/availability` · `tech.technician.manage` · idempotent ·
body `{from: datetime(offset), to: datetime(offset)}` · `201`.

`from < to`, and the wire format is `z.string().datetime({offset: true})` — matching
`tech.technician-available`'s window, which is the read this feeds.

### 8 · `tech.technician-certification-detail-record`

`PUT /technicians/{id}/certifications/{certificationId}/detail` ·
**`tech.technician.manage` AND `iam.sensitive.view`** · body `{certificateNumber: string(1..128)}`
· `200`.

The conjunction matches the three shipped restricted-sidecar operations exactly
(`wo.additional-work-detail-record`, `qms` rework cost, and this one's read side).

## 7. Permission model

**One new code: `tech.technician.manage`, risk `medium`.**

`BE-9` left this "undecided, and it must be decided rather than assumed". Here is the decision and
why the alternative fails.

Four `tech` codes are seeded (`supabase/seeds/04_iam_permission_catalog.sql:221-230`):

| code                     | risk   | description                                      |
| ------------------------ | ------ | ------------------------------------------------ |
| `tech.assignment.manage` | medium | Assign and reassign technicians to jobs          |
| `tech.labor.record`      | low    | Start, pause, resume and stop labor sessions     |
| `tech.labor.correct`     | high   | Record a linked correction to a labor session    |
| `tech.technician.read`   | low    | Read technician profiles, eligibility and queues |

**Reusing `tech.assignment.manage` is rejected.** It is the closest manage-shaped code, and it is
the wrong authority: assignment decides _who touches a vehicle today_; a roster write creates the
**subject of every labour record**, the entity certifications hang off, and the row a person's
recorded time is attributed to. Reusing it would silently widen every existing assignment grant into
a roster-administration grant — a privilege escalation delivered by a naming convenience, and one
that no gate would report.

**The derivation supports minting.** The seed states its own rule at `:309-311` — _"One code per
schema, not per catalogue"_ — and `tech.technician.read` already exists as the read half of exactly
this subject. `tech.technician.manage` is its write counterpart, in the same schema, on the same
noun. This is the narrowest possible addition: one code, matching an existing code's noun.

**Risk `medium`, not `high`.** `high` in this catalogue marks authorities that alter recorded facts
or approve money — `tech.labor.correct`, `wo.additional_work.approve`, `qms.rework.sign_off`.
Roster administration creates operational records; it does not rewrite history. `medium` matches
`tech.assignment.manage` and `org.department.manage`, its nearest neighbours in kind.

| actor                       | roster write                                                | roster read    | certificate number             |
| --------------------------- | ----------------------------------------------------------- | -------------- | ------------------------------ |
| Owner / company admin       | yes                                                         | yes            | only with `iam.sensitive.view` |
| branch manager              | yes, in their branches                                      | yes            | only with `iam.sensitive.view` |
| workshop supervisor         | typically read-only; grantable                              | yes            | no                             |
| service advisor             | no                                                          | yes if granted | no                             |
| technician (self)           | **no** — a technician does not edit their own roster record | yes            | no                             |
| cross-tenant / cross-branch | refused at `iam.has_permission_in_scope` and by RLS         | refused        | refused                        |

**Self-service is deliberately absent.** There is no "edit my own profile" path. A technician who
could set their own `trade` or attach their own certification could make themselves eligible for
work `ERR-TECH-001` should refuse them. Eligibility must be administered, not self-asserted — the
same principle that makes `BR-01` resolve identity server-side.

## 8. Security requirements

| abuse case                            | required behaviour                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **client-supplied identity spoofing** | creating a profile for another person's `userId` is the _normal_ case for an administrator and must be gated by `tech.technician.manage` in the target branch — never by "is this me"                                                                                                                 |
| **cross-tenant**                      | `fk_technician_profiles_user (tenant_id, user_id)` makes a cross-tenant pair non-existent; a foreign `userId` is 422, not 500                                                                                                                                                                         |
| **cross-branch**                      | the create body names `companyId`/`branchId`; the permission is evaluated against that pair, and `ins_technician_profiles_scope` is the backstop                                                                                                                                                      |
| **privilege escalation**              | the new code is minted rather than reused precisely to avoid widening `tech.assignment.manage`; a test must assert a holder of assignment-manage alone **cannot** create a profile                                                                                                                    |
| **forged foreign ids**                | `skillId`, `skillLevelId`, `certificationId` FK to **dual-scope catalogues by single-column FK**, so the database cannot prove tenancy — **the service must validate `scope = 'platform' OR tenant_id = current tenant`**. This is the one place in the slice where the database is not the backstop. |
| **mass assignment**                   | every body `.strict()`; `isActive` absent from create; `branchId`/`userId` rejected on update                                                                                                                                                                                                         |
| **hidden ownership bypass**           | `technicianProfileId` in a path resolves under RLS; out of scope is 404                                                                                                                                                                                                                               |
| **inactive / retired subject**        | writes against a soft-deleted profile are 404; writes against an inactive one succeed (deactivation is not a freeze)                                                                                                                                                                                  |
| **deleted / inactive employee**       | a `userId` whose `iam.user_accounts.status` is not `active` may still be profiled — the roster is an operational record, and `iam.has_permission` already refuses that account at request time. **Do not** add an application check that duplicates it.                                               |
| **restricted data leak**              | `certificateNumber` never appears in `TechnicianProfileDetail`; only operation 8's read returns it, under the conjunction                                                                                                                                                                             |
| **race**                              | two concurrent creates for one user — the second gets `23505`, which the service must translate to `ERR-RES-002`, never surface raw                                                                                                                                                                   |
| **enumeration**                       | `tech.technician-list` is branch-scoped and requires the pair; it is not a tenant-wide directory                                                                                                                                                                                                      |

## 9. Validation

| concern                       | rule                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ids                           | all `schemas.uuid`                                                                                                                                                         |
| **catalogue scope**           | `skillId`, `skillLevelId`, `certificationId` must resolve to a row with `scope = 'platform'` **or** `tenant_id = iam.current_tenant_id()`. Not enforceable by FK — see §8. |
| enums                         | none minted; `isActive` is boolean                                                                                                                                         |
| lengths                       | `trade` 1..64, `employmentRef` 1..64, `certificateNumber` 1..128; all non-blank, matching `ck_technician_profiles_trade_not_blank` and its siblings                        |
| timestamps                    | availability `from`/`to`: `z.string().datetime({offset: true})`, `from < to`; certification `issuedOn` a date, not in the future; `expiresOn > issuedOn`                   |
| state compatibility           | `retire: true` may not be combined with any other field                                                                                                                    |
| duplicate prevention          | create is idempotent; a live profile for the user is `ERR-RES-002`                                                                                                         |
| relationship validation       | the profile's `(tenant, company, branch)` is resolved from the profile row, never from the request, on operations 5–8                                                      |
| foreign ownership             | as above                                                                                                                                                                   |
| empty / partial update        | an update body with no field is 422, not a silent no-op                                                                                                                    |
| **`employmentRef` is opaque** | reject nothing on format, but the field description must state it is non-PII; the schema comment is the authority                                                          |

Export every `Body`, `Params` and `Query` (standing requirement).

## 10. Error contract

**No new error codes.**

| condition                                  | HTTP      | code                          | frontend behaviour                                          |
| ------------------------------------------ | --------- | ----------------------------- | ----------------------------------------------------------- |
| a live profile already exists for the user | 409       | `ERR-RES-002`                 | conflict, warning tone — offer to open the existing profile |
| unknown / cross-tenant `userId`            | 422       | `ERR-VAL-001`                 | field error on the user control                             |
| catalogue id out of scope                  | 422       | `ERR-VAL-001`                 | field error                                                 |
| profile not found or out of scope          | 404       | `ERR-RES-001`                 | existence not disclosed                                     |
| `If-Match` stale / absent                  | 409 / 428 | `ERR-CON-001` / `ERR-CON-002` | re-read, re-render; never auto-retry                        |
| lacks `tech.technician.manage`             | 403       | `ERR-IAM-001`                 | denial + correlation id, no permission named                |
| lacks `iam.sensitive.view` on operation 8  | 403       | `ERR-IAM-001`                 | the restricted region renders **absent**, not empty         |
| `Idempotency-Key` absent on create         | 400       | `ERR-INT-002`                 | client defect                                               |
| key reused with a different payload        | 409       | `ERR-INT-001`                 | one key per intent                                          |

## 11. Audit and history behaviour

`auditClass: privileged` on all seven write operations; `none` on the two reads. Operation 8 is
also privileged and touches restricted data.

**What must be historically visible:**

- Roster changes are attributable — `created_by`/`updated_by` and `deleted_by` are stamped by the
  shared row-metadata trigger, and `correlation_id` and `actor_id` come from the request context.
- **There is no roster history table**, and this slice does not add one. A profile's `trade` and
  `is_active` are last-write-wins with attribution, not a timeline.
- **The branch-transfer trail is preserved by construction**, and this is worth stating as a
  benefit of §4.1: because a transfer is a retire plus a create, the old branch's profile row
  survives soft-deleted with its `deleted_at`/`deleted_by`, and every labour session and assignment
  that referenced it still resolves. A mutable `branch_id` would have silently rewritten the branch
  attribution of every historical labour record. The immutability guard is not an obstacle here; it
  is the thing that makes labour history honest.

## 12. Tests

### Positive

| #   | case                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------- |
| P1  | an administrator creates a profile; it appears in `tech.technician-list` and in `tech.technician-available` for a covering window |
| P2  | **the `BR-01` handshake**: after P1, the profiled user calls `GET /technicians/me/queue` and resolves                             |
| P3  | trade and employment reference update; `recordVersion` increments                                                                 |
| P4  | `isActive: false` removes the technician from `tech.technician-available`                                                         |
| P5  | a skill is set, then re-set to a different level — one row, not two                                                               |
| P6  | a certification with an `expiresOn` is recorded and appears in the detail read                                                    |
| P7  | availability is recorded and the technician becomes available for that window                                                     |
| P8  | a holder of `iam.sensitive.view` reads the certificate number; the detail read still omits it                                     |
| P9  | **branch transfer**: retire in branch X, create in branch Y — both succeed in that order                                          |

### Negative

| #   | case                                                                   | expected                               |
| --- | ---------------------------------------------------------------------- | -------------------------------------- |
| N1  | no auth                                                                | 401                                    |
| N2  | caller holds `tech.assignment.manage` but not `tech.technician.manage` | **403** — the escalation test          |
| N3  | create for a user who already has a live profile                       | 409 `ERR-RES-002`                      |
| N4  | create with a `userId` from another tenant                             | 422                                    |
| N5  | update sending `branchId`                                              | 422 (`.strict()`) — **not** ignored    |
| N6  | update sending `userId`                                                | 422                                    |
| N7  | update with an empty body                                              | 422                                    |
| N8  | `retire: true` combined with `trade`                                   | 422                                    |
| N9  | skill set with a `skillId` belonging to another tenant                 | 422                                    |
| N10 | certification with `expiresOn` before `issuedOn`                       | 422                                    |
| N11 | availability with `to` before `from`                                   | 422                                    |
| N12 | create without `Idempotency-Key`                                       | 400 `ERR-INT-002`                      |
| N13 | update without `If-Match`                                              | 428                                    |
| N14 | writes against a soft-deleted profile                                  | 404                                    |
| N15 | **branch transfer in the wrong order** — create before retire          | 409 `ERR-RES-002`, never a raw `23505` |

### Security

| #   | case                                                                                                                                          | expected                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| S1  | **cross-tenant create**: administrator in tenant A names a tenant-B `userId`                                                                  | 422; no row written                                    |
| S2  | **cross-branch create**: caller holds manage in branch X, body names branch Y                                                                 | 403                                                    |
| S3  | **IDOR**: `PATCH` a profile in an unheld branch                                                                                               | 404                                                    |
| S4  | **self-service escalation**: a technician attempts to set their own skill level                                                               | 403                                                    |
| S5  | **restricted leak**: `TechnicianProfileDetail` contains no `certificateNumber` for **any** caller, including one holding `iam.sensitive.view` | asserted on the type and the response                  |
| S6  | **forged catalogue id**: a `skillId` that exists but belongs to another tenant                                                                | 422 — proves the service check, since the FK cannot    |
| S7  | **race**: two concurrent creates for one user                                                                                                 | one 201, one 409; never two rows, never a raw SQLSTATE |
| S8  | **immutability backstop**: direct `UPDATE … SET branch_id` as `app_runtime`                                                                   | refused by `tg_technician_profiles_immutable`          |

S1–S4 and S6 must run as restricted users. `narrowScope` skips the check for an unrestricted
caller, so an isolation proof on an unrestricted connection proves nothing.

### Regression — must remain green

- `tech.technician-available` and `tech.technician-queue` — behaviour unchanged; both now have data to return.
- `ERR-TECH-001` eligibility paths — a newly deactivated technician must produce it, which is the first time that branch has been reachable with real data.
- `check-authorization-coverage` / `check-openapi` count equality — **+8** on both sides.
- The permission-catalogue baseline `.github/ci-baselines/schema-baseline.json` `permissionCount` moves **112 → 113**. Take the figure from a CI run: a local count against the shared container reports 115 because three belong to the unmerged B1 branch (`INS-42`).
- `tests/openapi-contract.test.ts` import list — eight new route modules.

## 13. Definition of Done

- [ ] Eight operations registered, published, and present in the operation register.
- [ ] **Zero** migrations added.
- [ ] Exactly **one** permission code added: `tech.technician.manage`, domain `tech`, risk `medium`.
- [ ] `permissionCount` baseline updated 112 → 113, from a CI measurement.
- [ ] `BR-08a`'s parity gate is green on the new code (or, if `BR-08a` has not landed, the code is verified against the seed by hand and the slice records that it was).
- [ ] N2 passes — an assignment-manage holder cannot write the roster.
- [ ] S5 passes — no certificate number in the aggregate read, for any caller.
- [ ] S6 passes — cross-tenant catalogue reference refused by the **service**, since the FK cannot.
- [ ] P2 passes — the `BR-01` handshake works end to end.
- [ ] P9 and N15 pass — branch transfer succeeds in the correct order and fails cleanly in the wrong one, with `ERR-RES-002` rather than a raw `23505`.
- [ ] Every route file exports its schemas.
- [ ] No file under `apps/web` is changed.
- [ ] No self-service write path exists: `grep` finds no route resolving the subject from `iam.current_user_id()` in this slice.
- [ ] No unresolved Critical or High finding open against this slice.
