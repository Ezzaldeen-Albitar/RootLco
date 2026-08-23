# Data migration and compatibility classification

**Every planned future schema change in PRE-P1-29 and P1-29, classified.** No migration is created
by this planning slice, and none may be.

## The classes

| class                                | meaning                                                            | what it costs                                                                 |
| ------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **NO DATA MIGRATION**                | new object, or a change to an object with no rows                  | a migration file and its gate cascade                                         |
| **BACKFILL REQUIRED**                | existing rows must acquire a value                                 | a migration plus a data step plus a verification                              |
| **ONLINE-COMPATIBLE**                | old and new code can run against the changed schema simultaneously | ordering discipline                                                           |
| **BREAKING**                         | old code cannot run against the changed schema                     | a coordinated deploy, or a transitional model                                 |
| **TRANSITIONAL DUAL MODEL REQUIRED** | both shapes must exist at once, with a defined end                 | the largest cost, and the one that must be planned before the first migration |

A change can be more than one. Where it is, the **most expensive** class governs the plan.

## The empty-database property that makes most of this cheap

The live catalogue holds **zero rows** in `iam.roles`, `iam.role_permissions`, `iam.role_grants`,
`iam.grant_scopes`, `iam.user_accounts` and `org.tenants`, and the diagnostics template tree and
`qms.qc_checks` are likewise empty. **A change to an empty table is NO DATA MIGRATION by
definition.** That is true today and it stops being true the moment a production tenant exists, so
every row below states the class **now** and the class **after first production data**.

---

## PRE-P1-29

| change                                                                    | wave / slice  | class now                            | class after production data                       | notes                                                                                                                                                           |
| ------------------------------------------------------------------------- | ------------- | ------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org.company_status_history` table                                        | B2            | **NO DATA MIGRATION**                | NO DATA MIGRATION                                 | a new append-only table; no existing row needs one                                                                                                              |
| `org.change_company_status(...)` function                                 | B2            | **NO DATA MIGRATION**                | NO DATA MIGRATION                                 | additive; the existing direct-`UPDATE` path continues to work, which is itself the risk — see below                                                             |
| `app_platform` role, platform authority relation, resolver                | B1 _(landed)_ | NO DATA MIGRATION                    | NO DATA MIGRATION                                 | frozen; recorded for completeness                                                                                                                               |
| `app_platform` privilege graph and policies                               | B1 / M2       | **NO DATA MIGRATION**                | NO DATA MIGRATION                                 | grants and policies only                                                                                                                                        |
| Wave C: permission predicates added to the three hierarchy write policies | C             | **NO DATA MIGRATION**                | **BREAKING**                                      | today nobody calls those policies; once a caller exists, adding a predicate can refuse writes that previously succeeded. **Do it before the caller, not after** |
| Wave C: one new department read permission code                           | C             | **NO DATA MIGRATION**                | NO DATA MIGRATION                                 | a seed row; moves the pinned catalogue count 112 → 113 in the same change                                                                                       |
| `department_id` on a work-domain table                                    | `BE-7`        | **NO DATA MIGRATION** (nullable)     | **BACKFILL REQUIRED** if it is ever made NOT NULL | keep it nullable. A nullable FK is ONLINE-COMPATIBLE; a NOT NULL one is not                                                                                     |
| **Wave D: global identity and membership**                                | D             | **TRANSITIONAL DUAL MODEL REQUIRED** | **TRANSITIONAL DUAL MODEL REQUIRED**              | see §2 — this is the only one of its class                                                                                                                      |

## P1-29

| change                                          | item    | class now             | class after production data | notes                                                                                                                                                        |
| ----------------------------------------------- | ------- | --------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| catalogue read route                            | `BE-1`  | **NO DATA MIGRATION** | NO DATA MIGRATION           | no schema change at all                                                                                                                                      |
| technician profile resolution                   | `BE-2`  | **NO DATA MIGRATION** | NO DATA MIGRATION           | reads a column that already exists                                                                                                                           |
| customer projection                             | `BE-3`  | **NO DATA MIGRATION** | NO DATA MIGRATION           | **provided option A is chosen.** Option B — a `wo.work_orders.customer_id` column — would be **BACKFILL REQUIRED** and would create a second source of truth |
| diagnostic template routes and permission       | `BE-4`  | **NO DATA MIGRATION** | NO DATA MIGRATION           | the tables exist and are empty; the seed adds a permission row                                                                                               |
| platform `dia.diagnostic_types` vocabulary seed | `BE-4`  | **NO DATA MIGRATION** | **ONLINE-COMPATIBLE**       | dual-scope table; platform rows are additive and shadowed by tenant rows                                                                                     |
| parity gate                                     | `BE-5`  | **NO DATA MIGRATION** | NO DATA MIGRATION           | CI only                                                                                                                                                      |
| `job.assigned` consumer                         | `BE-6`  | **NO DATA MIGRATION** | NO DATA MIGRATION           | reads the existing outbox                                                                                                                                    |
| technician roster writes                        | `BE-9`  | **NO DATA MIGRATION** | NO DATA MIGRATION           | the table exists and is empty                                                                                                                                |
| branch job / QC queue reads                     | `BE-10` | **NO DATA MIGRATION** | NO DATA MIGRATION           | reads only                                                                                                                                                   |
| job work log and job evidence                   | `BE-8`  | **NO DATA MIGRATION** | NO DATA MIGRATION           | new tables                                                                                                                                                   |

---

## 2. Wave D is the only TRANSITIONAL DUAL MODEL, and why

Today one live external identity resolves to **exactly one tenant, platform-wide**, because
`uq_user_accounts_provider_identity_active` is unique on `(identity_provider, provider_subject)`
with **no tenant in the key** — and the authentication service depends on that shape by
construction, while the bearer authenticator refuses a token carrying no tenant binding.

Changing that is not a refactor. It is a data-integrity decision with a migration attached, and the
initiative's own scope document says so and deliberately does not choose a remedy.

**Why a dual model is unavoidable.** Whichever remedy is chosen, there is a period in which:

- some sessions were issued under the old rule (tenant baked into the token) and some under the new
  one (tenant chosen from a membership);
- `iam.current_tenant_id()` must answer correctly for both;
- every foreign key targeting `iam.user_accounts` — the composite `(tenant_id, id)` ones especially
  — must keep resolving;
- the audit actor must remain a single stable identity across the change, or the trail forks.

**What can stay backward-compatible, and what cannot.**

| element                                                       | compatible during migration?                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| a membership table added alongside the existing account       | **yes** — purely additive                                                             |
| composite FKs `(tenant_id, id)` to `iam.user_accounts`        | **yes**, while the account row keeps its tenant                                       |
| `iam.current_tenant_id()` and the RLS helpers built on it     | **yes**, if the chosen tenant is still set per transaction from server-resolved state |
| the session payload gaining a membership list                 | **yes** — additive field                                                              |
| **the provider-identity uniqueness index**                    | **no.** Changing it is the breaking act, and it is the last step, not the first       |
| **the bearer authenticator's refusal of a tenant-less token** | **no** — it must be relaxed in the same coordinated change                            |
| audit actor identity                                          | **decided, not migrated** — see the open question below                               |

**The open question this classification cannot answer**: whether the audit actor becomes the global
identity or stays the per-tenant account. One canonical document rejects duplicated accounts partly
_because_ two accounts for one person means two actor identities with no join to reunite them —
which argues for the global identity — but nothing states the decision. It is recorded as an
ambiguity, and **it must be settled before the first Wave D migration**, because it determines
whether existing audit rows need a backfill.

---

## 3. Two ordering rules that follow

**Add the predicate before the caller.** Wave C's three hierarchy write policies gate on tenancy
and scope only. Adding a permission predicate is free today and BREAKING once an operation depends
on the current behaviour. The same is true of any policy tightening anywhere in this plan.

**Keep new foreign keys nullable until something writes them.** `department_id` is the live
example. A nullable column is ONLINE-COMPATIBLE and can be tightened later against real data; a
NOT NULL column demands a backfill for rows that have no correct value yet, and the usual
resolution is to invent one.
