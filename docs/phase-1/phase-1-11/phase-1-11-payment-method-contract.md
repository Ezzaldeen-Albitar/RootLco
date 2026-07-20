# Phase 1-11 — Payment-Method Contract

**Requirement:** P1-11-DB-005, ASM-14, CON-04 (cash / card-terminal / bank-transfer only; no
online gateway). Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the
Solo Developer Review Policy and the Standing Technical Authorization Policy — not an
independent third-party review.

## Dual-scope reference

`sal.payment_methods` is a dual-scope reference: platform structural rows plus
tenant-configurable rows. Columns: `scope` CHECK IN `('platform','tenant')`, `tenant_id`
(NULL for platform, NOT NULL for tenant — `ck_payment_methods_scope_tenant`), `method_code`
(`^[a-z][a-z0-9_]{1,62}$`), `kind`, `display_name`, `status` CHECK IN `('active','inactive')`.

- **Platform rows** (structural, tenant-neutral, idempotent seed): `cash`, `card_terminal`,
  `bank_transfer`. `uq_payment_methods_platform_code` (partial unique on `method_code WHERE
scope='platform'`).
- **Tenant rows** add tenant-specific methods within the three kinds:
  `uq_payment_methods_tenant_code (tenant_id, method_code) WHERE scope='tenant'`.

## No gateway / settlement kinds

`kind` CHECK IN `('cash','card_terminal','bank_transfer')` — **no** online-payment-gateway,
settlement, or wallet kinds (ASM-14, CON-04). Online payment settlement (FR-SAL-005) is
Future and out of scope.

## RLS and immutability

SELECT is visible for `scope='platform' OR tenant_id = iam.current_tenant_id()`; INSERT/UPDATE
only for `scope='tenant' AND tenant_id = current`. There is **no DELETE grant** — a tenant can
never claim, alter, or delete a platform row. `scope` and `tenant_id` are immutable
(`org.guard_immutable_columns`). `sal.receipts.payment_method_id` is a composite FK →
`sal.payment_methods(tenant_id, id)` RESTRICT.

**Tests:** `sal-payment`, `p1-11-isolation`.
