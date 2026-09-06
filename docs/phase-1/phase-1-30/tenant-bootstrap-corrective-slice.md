# P1-30 — the tenant-bootstrap corrective slice

**A tenant created by the shipped provisioning operation could not trade.** Three things the
product requires were never given to it, each independently fatal, none visible to any gate. This
record states what was measured, what was repaired, what was proved, and what is still blocked.

Measured on the local stack at protected develop `029fc20d`, before any code was written.

---

## 1. What was wrong

| #   | what a provisioned tenant did not get           | measured at `029fc20d`                                | why it is fatal                                                                                                                                                                |
| --- | ----------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | a tenant-scope row in `sal.payment_methods`     | six tenants on the stack, **0** rows between them     | `fk_receipts_method` is `(tenant_id, payment_method_id) → sal.payment_methods (tenant_id, id)`; a platform row's `tenant_id` is NULL and both referencing columns are NOT NULL |
| 2   | any row in `shared.number_sequences`            | six tenants, **0** rows                               | `shared.next_display_number` matches `(company_id, branch_id)` exactly with no fallback; invoice issue, receipt record and quotation create refuse rather than degrade         |
| 3   | any commercial permission (A0 finding **F-01**) | roles across all six tenants held **0** `sal.*` codes | `ins_role_permissions_delegable` admits a mapping only when the acting administrator already holds the code, so no principal could ever be granted one                         |

Each was confirmed executably rather than read off the code:

- **(1)** a direct INSERT of a receipt for the real, active tenant `rootlco_w7b`, citing the
  platform `cash` row, answered
  `insert or update on table "receipts" violates foreign key constraint "fk_receipts_method" …
Key (tenant_id, payment_method_id)=(985028aa-…, 3a30e300-…) is not present in table "payment_methods"`.
  `has_schema_privilege('app_platform','sal','USAGE')` returned **false**: the control plane held no
  privilege anywhere in `sal`, so the write was impossible rather than merely unwritten.
- **(2)** `SELECT count(*) FROM shared.number_sequences` returned 0 for every tenant. The
  provisioning function does write sequence rows, from `p_spec -> 'sequences'` and with company and
  branch NULL — but the shipped provisioning body is `.strict()` and publishes no `sequences`
  member, and a tenant-wide row is not matched by an allocator that passes a concrete company and
  branch. Both halves of that path were dead.
- **(3)** already recorded by this phase's own A0 preflight as F-01, with the 403 it produced on the
  production build. The re-measurement agreed.

**This is not new product scope.** P1-11 required the ASM-14 payment-method seed and it shipped;
what was missing was the tenant-local realisation of it. `assertPaymentMethodIsTenantScoped` has
said since P1-22 that "the tenant must be provisioned with its own method row". Nothing did.

---

## 2. What was repaired, and where

All three writes happen inside the §6.3 platform-on-target window `withPlatformTarget` already
opens — the same transaction that creates the tenant, as `app_platform`, with `app.tenant_id`
naming the tenant just created. Nothing new was invented to hold them.

| half             | owner module      | migration                                                |
| ---------------- | ----------------- | -------------------------------------------------------- |
| payment methods  | `payments`        | `20260906090000_sal_payment_method_tenant_bootstrap.sql` |
| number sequences | `shared-services` | **none needed** — see below                              |
| the code bundle  | `iam`             | none — a server-owned constant                           |

### Payment methods

`GRANT USAGE ON SCHEMA sal`, `GRANT SELECT, INSERT ON sal.payment_methods`, and two policies. The
SELECT policy admits **platform rows only**, so the control plane can read the canonical catalogue
it copies from and can see no tenant's methods — not even the ones it has just written, which is
why the bootstrap asserts on an affected-row count instead of reading back. The set is the
server-owned `TENANT_BOOTSTRAP_METHOD_CODES`; the `kind` and `display_name` of each row are the
seed's own values, copied, so the vocabulary keeps one owner.

Every policy term was built on the live server before it was written into the migration, and each
of five containment negatives was observed refusing: a tenant that is not `provisioning`, a
`platform`-scope row, a different provisioning tenant than the session's, an actor without
`platform.organization.provision`, and any read of a tenant's own methods.

### Number sequences

**No migration.** `ins_number_sequences_platform` and the INSERT privilege have existed since the
control plane shipped (`20260831093000`) and had never been used. The slice adds only the writer
and the scope each run needs, transcribed onto the P1-15 registry as `provisioningScope` from the
shipped allocator call sites: `invoice`, `receipt` and `quotation` are branch-scoped and unguarded;
the other five are tenant-wide and guarded by `isProvisioned`.

### The commercial code bundle

`TENANT_ADMINISTRATOR_ROLE` grows 48 → 65 here (→ 67 with the inventory codes the commercial-setup
slice adds). The seventeen added codes are derived, not chosen: each
is declared by a shipped P1-30 screen's contract or gates one of its navigation entries, and each
already exists in the 118-code catalogue. **No permission is minted** (RES-05). They are held so
they can be delegated — a cashier or service advisor is a role the Owner creates, and an
administrator can create none out of codes it does not hold.

---

## 3. What was proved

`tests/backend/p1-30-tenant-bootstrap-reachability.test.ts` — twelve cases, all through the shipped
routes.

| case      | what it proves                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------ |
| PM-B1     | a fresh tenant receives exactly the canonical ASM-14 methods                                     |
| PM-B2     | every row is tenant-local, and its kind and label are the seed's own, copied row for row         |
| PM-B3     | the shipped method list returns all three as `recordable`, and the platform rows as not          |
| **PM-B4** | **a receipt is recorded end to end on a fresh tenant** — the whole slice in one assertion        |
| PM-B5/B6  | another tenant's method id and a platform method id are both refused, as refusals not crashes    |
| PM-B7     | an idempotent replay duplicates neither a method nor a sequence                                  |
| PM-B8     | withdrawing one canonical row makes provisioning REFUSE — no half-provisioned tenant commits     |
| PM-B9     | a later provisioning does not rewrite an existing tenant's methods, and no UPDATE grant exists   |
| PM-N      | the containment negatives of the new policy pair                                                 |
| NS-B1/B2  | one sequence per registered run, each at its registry scope, with the created company and branch |
| F01-B1    | the administrator can now MAP a commercial code — the exact call the A0 matrix recorded as 403   |

**Each half was proved falsifiable**, by removing it and watching the right cases turn red:

| removed                            | result                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| the payment-method bootstrap call  | 8 of 11 cases red, including PM-B4                              |
| the number-sequence bootstrap call | 4 red — PM-B4, PM-B5/B6, PM-B7, NS-B1                           |
| one code from the bundle           | F01-B1 red with **403**, the same status the A0 matrix recorded |

The migration replays cleanly from empty. Measured in a fresh database created inside the running
container, twice: the 136-migration tree reproduced the recorded baseline `0598d8af…` and
`254/533/693/560/0` digit for digit, and the 137-migration tree gives `f9151e88…` and
`254/533/695/560/0` — the two policies, and nothing else.

The sibling suites are green and were corrected where this slice legitimately moved them:
`p1-29-w9-owner-bootstrap` (15) and `pre-p1-29-platform-control-plane`. The W9 audit-detail
assertion is exhaustive and reported the two new count fields rather than letting them pass
unnoticed, which is what an exhaustive assertion is for.

---

## 4. What was still blocked after this slice — F-02, re-measured

> **Corrected 2026-09-06, after this record was first written.** The paragraph below repeated
> the A0 preflight's eleven-table count without re-measuring it. The Owner pointed out that A1
> (PR #311) had already delivered the price-list-assignment writer — and it had, together with the
> category and service-version writers, all with screens in W1–W2. The re-measurement is
> `f02-remeasurement.md`; its verdict is kept here so this record does not mislead a later reader.

What actually remained after this slice, measured on the fresh tenant `p30_acceptance_ac0zif`:

| chain link                               | reachable after THIS slice?                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| customer, vehicle, reception, work order | **yes** — the P1-29 journey, unchanged                                                                                                                          |
| service catalogue, pricing               | **yes** — A1 + W1/W2 writers and screens (the A0 claim was stale)                                                                                               |
| quotation, issue, decision               | **yes** — W3, given a sellable priced service                                                                                                                   |
| **payment: method → receipt → print**    | **yes** — this slice, proved by PM-B4                                                                                                                           |
| inventory                                | **no** — `inv.item_categories`, `inv.item_master`, `inv.stock_locations` had no writer, and `inv.item.manage` / `inv.adjustment.approve` were not in the bundle |
| invoice, allocation, outstanding balance | **yes** once a quotation exists — the invoice is built from an accepted quotation                                                                               |

The inventory gap is closed by the follow-on slice `remediation/p1-30-backend-commercial-setup`
(five operations, two bundle codes, no migration, no permission minted) and its Frontend half.
Tax classes and rates, the invoice numbering mode, discount rules and approval policies are
**valid-but-unconfigured**: the chain tolerates their absence and they are product gaps for the
Owner's register, not acceptance blockers.

## 5. Residuals this slice leaves open

| id    | residual                                                                                                                  | disposition                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TB-R1 | the bundle is written ONCE at provisioning; the six organisations created before this slice keep their old set            | **deferred** — a backfill needs an Owner decision about mutating live tenants' authority                                                                                  |
| TB-R2 | the same is true of payment methods and sequences for those six tenants                                                   | **deferred**, with TB-R1                                                                                                                                                  |
| TB-R3 | eight of the twelve unreachable navigation gates remain unheld (two deliberate, one W9-R2, two RES-05, four undocumented) | **accepted residual** for this slice; recorded in the A0 matrix                                                                                                           |
| TB-R4 | the genesis CLI and the P1-03 pilot runner call `org.provision_organization` directly and get no methods or sequences     | **accepted** — the genesis tenant is reserved for platform operators and holds no business data (§5.4); the pilot runner writes no IAM either and is not the shipped path |
| TB-R5 | prefix, pad width and reset rule are left at their column defaults and no route configures them                           | **accepted residual** — no P1-30 capability depends on a prefix; an operator sets the row                                                                                 |
