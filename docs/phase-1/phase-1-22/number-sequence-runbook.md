# Operator runbook — provisioning invoice and receipt number sequences

**Audience:** a platform operator with owner-role database access.
**Applies to:** every tenant/company/branch that will issue an invoice or record a
payment. **This is a prerequisite, not a recovery procedure** — an unprovisioned
scope cannot issue its first invoice.

## Why this is an operator action and not a code path

`sal.issue_invoice` and `sal.record_receipt` both allocate their number through
`shared.next_display_number(sequence_code, company_id, branch_id)`, which looks up
one row in `shared.number_sequences` and raises when it is absent:

```
next_display_number: no sequence is configured for code % in this scope
  ERRCODE = 'no_data_found'      -- P0002
```

The application **cannot** create that row, and this is deliberate rather than an
oversight:

```sql
GRANT SELECT ON shared.number_sequences TO app_runtime, app_readonly;
GRANT UPDATE (next_value, current_period) ON shared.number_sequences TO app_runtime;
```

`app_runtime` holds a **column-restricted `UPDATE` and no `INSERT` at all**, and
there is no `INSERT` policy either — so the grant and the RLS policy both refuse it.
A backend that self-healed here would be minting a numbering run nobody reviewed,
and `supabase/seeds/` contains five files, **none of which inserts into
`shared.number_sequences`**.

## What the backend does instead

It refuses, precisely and actionably. `P0002` is translated into
`ERR-RES-001` (404) whose message names the exact missing tuple:

```
No number sequence is provisioned for "invoice" in company <id>, branch <id>
```

It specifically does **not**:

- invent a fallback number;
- use a timestamp, a counter, a random value or a UUID as an invoice or receipt number;
- fall back to a tenant-wide sequence when a branch-scoped one is missing;
- retry, cache, or degrade to a "provisional" document.

`sal.invoice-issue` additionally **pre-checks** provisioning before it does any
other work, so an unprovisioned tenant is refused before the transaction touches
the invoice. A failed issue therefore claims no number: the allocation and the
business write share one transaction, so a rollback takes the counter advance with
it.

## The two sequences P1-22 requires

| `sequence_code` | Consumed by                                                           | Target column                 | Scope required                                   |
| --------------- | --------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------ |
| `invoice`       | `sal.issue_invoice` (resolved via config, `COALESCE` to this literal) | `sal.invoices.invoice_number` | `(tenant, company, branch)` — see the trap below |
| `receipt`       | `sal.record_receipt` (**hard-coded** in the function)                 | `sal.receipts.receipt_number` | `(tenant, company, branch)`                      |

Both are already registered in the application's own allow-list
(`src/modules/shared-services/domain/sequence-registry.ts`), so no code change is
needed — only the rows.

### The trap: `org.provision_organization` provisions the wrong scope

`org.provision_organization` inserts sequence rows **tenant-wide** — it passes
neither `company_id` nor `branch_id`. `shared.next_display_number` matches with

```sql
AND ns.company_id IS NOT DISTINCT FROM p_company_id
AND ns.branch_id  IS NOT DISTINCT FROM p_branch_id
```

`IS NOT DISTINCT FROM` is exact-match-including-NULL, **not** a fallback. A
tenant-wide row has `company_id IS NULL` and therefore does **not** satisfy a lookup
for a named company and branch. So a tenant that was provisioned by
`org.provision_organization` and has never been touched since **will still fail
invoice issue**, and the failure will look like a bug in billing.

`sal.invoices` also enforces uniqueness **per branch**
(`uq_invoices_number` is `(tenant_id, company_id, branch_id, invoice_number)`), so a
branch-scoped sequence is the coherent choice: a company-wide sequence would work
but would waste the per-branch uniqueness, and two branches sharing a tenant-wide
sequence would still be unique-safe but would interleave their numbers.

**Provision one row per `(company, branch)` that will issue.**

## Procedure

Run as an owner role (not `app_runtime` — it has no `INSERT`). Substitute the real
ids; `<actor>` is the operator's user id, recorded in `created_by`.

```sql
-- One row per (company, branch, code). Repeat for every issuing branch.
INSERT INTO shared.number_sequences
  (tenant_id, company_id, branch_id, sequence_code,
   prefix_template, pad_width, period_reset_rule, next_value, created_by)
VALUES
  ('<tenant>', '<company>', '<branch>', 'invoice',
   'INV-{period}-', 6, 'yearly', 1, '<actor>'),
  ('<tenant>', '<company>', '<branch>', 'receipt',
   'RCP-{period}-', 6, 'yearly', 1, '<actor>');
```

**Every one of those values is a business decision, and none of them is a platform
default.** The platform ships no prefix, no pad width and no reset rule for these
codes, and the backend never constructs, parses, regex-validates or sorts by an
invoice number — it is opaque text. The values above are a _worked example_, not a
recommendation:

- `prefix_template` — free text; `{period}` is substituted with the period string,
  or with the empty string when `period_reset_rule` is `never`.
- `pad_width` — `0..18`. The rendered number is
  `lpad(value, greatest(pad_width, length(value)), '0')`, so the width is a
  minimum and a sequence that outgrows it simply gets longer rather than failing.
- `period_reset_rule` — `never | yearly | monthly | daily`. The counter restarts at
  1 when the period changes.
- `next_value` — start at `1` for a new run. **If the tenant has pre-existing
  documents from another system, set this above the highest existing number**, or
  the first issue will collide with `uq_invoices_number` and be refused.

## Verification

Confirm the row is visible in the scope the backend will ask for, using the exact
matching semantics the function uses:

```sql
SELECT sequence_code, company_id, branch_id, prefix_template, pad_width,
       period_reset_rule, next_value, current_period
FROM shared.number_sequences
WHERE tenant_id = '<tenant>'
  AND sequence_code IN ('invoice', 'receipt')
  AND company_id IS NOT DISTINCT FROM '<company>'
  AND branch_id  IS NOT DISTINCT FROM '<branch>';
```

Two rows means provisioned. **Zero or one row means invoice issue or payment
recording will fail** with `ERR-RES-001`, and the message will name which code is
missing.

Do **not** verify by calling `shared.next_display_number` directly: it is
`VOLATILE` and advances the counter, so a "test" allocation consumes a real number
that no document will carry.

## Gapping is real, and the `mode` column does not prevent it

`sal.invoice_numbering_configs.mode` admits `'gapless'` and `'gapped'` and has
**zero behavioural effect anywhere in the DDL** — nothing reads it, including
`shared.next_display_number`. P1-22 exposes it as read-only metadata and asserts
nothing about consecutiveness.

What the platform actually guarantees is narrower and worth stating plainly:
**gapless with respect to rollback only**. The counter advance and the business
insert share a transaction, so a rolled-back issue leaves no gap. A _committed_
business-level gap — an invoice voided after issue, which this schema does not even
permit, or a number consumed by a transaction that committed something else — is
described by the column comment as "tolerated and never renumbered". Do not promise
a customer or an auditor an unbroken sequence on the strength of the `mode` value.

## Cross-tenant safety

No tenant can consume another tenant's numbering run.
`shared.next_display_number` takes the tenant **exclusively** from
`iam.current_tenant_id()` — it is not a parameter — and additionally refuses a
company or branch outside the session's resolved scope with
`insufficient_privilege` (surfaced as `ERR-IAM-001`). The row lock is
`SELECT … FOR UPDATE` on the single matching row, so two concurrent issues in the
same scope serialise on it and receive different numbers.
