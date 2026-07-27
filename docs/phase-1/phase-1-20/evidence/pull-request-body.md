# DRAFT — DO NOT MERGE

**This PR is incomplete and must not be merged until the full P1-20 Definition of
Done is proven.** It exists to secure the foundation commits on the remote and to
run hosted CI against every subsequent wave. All remaining P1-20 waves continue on
this same branch and this same PR.

## Prerequisite — P1-19 verified closed

| | |
| --- | --- |
| P1-19 final gate SHA | `0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0` |
| Verified containment | `d8278c7` (feature merge), `da0b8b2` (reviewed feature), `600ca9c` (reviewed gate) — all three are ancestors of `origin/develop` |
| `origin/develop` parents | `d8278c7` + `600ca9c` — unchanged since P1-19 closed |
| P1-19 decision | `Go — P1-19 Work Order, Diagnostics, and Technician Backend Gate Passed` |
| `origin/main` | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — untouched, and P1-20 will not touch it |

## Protected base

`P1_20_BASE_SHA = 0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0`

Recovery check found **no** existing P1-20 branch, PR, worktree, module or
documentation anywhere — Case A, no collision, no competing implementation.

## Present in this PR so far

| Commit | Contents |
| ------ | -------- |
| `84618ea` | Wave 0–1 evidence; exact `Decimal`/`Money`; `service-catalog` module |
| `e269d52` | `pricing` module — deterministic price resolution, discount authorization |
| `0b838e1` | `quotation` domain + repository (money computed in SQL) |
| `69d749e` | 3 read permissions (93 → 96); 8 `svc`/`quo` events (31 → 39) |
| `49bf130` | Execution checkpoint |

## Verified green on this head

`format:check` · `lint` · `tsc --noEmit` · `validate:module-boundaries`
(335 files) · `validate:seed-state` (exit 0, idempotent) ·
56/56 new P1-20 unit tests (32 exact-decimal + 24 discount-authorization).

Protected baseline re-measured, not inherited: unit **843**, database **1610**,
backend **1077**, OpenAPI **140 paths / 168 operations**, **119** migrations.

## Financial policy — derived from the schema, not invented

The CHECK constraints on `quo.quotation_items` already fix the policy, so nothing
here is a business decision we made:

```
captured_tax_amount = round(((unit * qty) - discount) * rate, 4)
captured_line_total = round(((unit * qty) - discount) + tax_amount, 4)
captured_grand_total = (subtotal - discount_total) + tax_total   -- exact, unrounded
```

Tax is **per line**, discount is applied **before** tax, tax is **exclusive**, and
rounding is `round(…, 4)`. PostgreSQL `numeric` is the calculation engine:
`insertItem` writes those exact expressions, with every parameter cast to its
column's own precision and scale, so the engine and the validator are the same
thing and cannot disagree. `Decimal`/`Money` only parse, compare and serialize —
`Money` exposes no `add`, `multiply` or `convert`, so silent FX is unexpressible.

## Schema reconciliations (phase prose vs the protected catalog)

The catalog was read live and disagrees with the prose in six places. The catalog
wins in every case:

1. **Decisions are per ITEM**, not per revision — `quo.record_item_decision` and
   `uq_approval_decisions_item` are item-keyed. Revision-level outcome is derived.
2. **`:action` paths cannot be registered** — the registry `PATH_PATTERN` accepts
   only lower-case literals and `{camelCase}`. Sub-resource nouns are used.
3. **`quo.quotations.work_order_id` is NOT NULL** — no standalone quotations.
4. **Branch availability has no effective-date columns** — accepted limitation
   `P1-20-A-01`, not fabricated.
5. **Labour time has no branch override** — accepted limitation `P1-20-A-02`.
6. **Event names carry no `.v1`** — the shipped catalog versions via
   `schemaVersion`.

Full detail: `docs/phase-1/phase-1-20/evidence/wave-1-contract-archaeology.md`.

## Database boundary

**No migration.** 119 migrations, no 120, none modified. `app_runtime` already
holds `INSERT/SELECT/UPDATE` on every `svc`/`quo` table it needs, so no change
request is required. The only `supabase/` change is the additive, idempotent
permission-catalog seed (93 → 96).

## Still to come on this branch

Quotation application services; all Route Handlers; audit actions; the P1-20
inventory CI gate; OpenAPI regeneration; the full API / isolation / concurrency /
rollback / abuse-case suites; SEC/QA/DO/DOC evidence for all 27 tasks; adversarial
reviews; the hostile 100/100 audit; full local reproof; and an exact-SHA clean-room
reproof.

Draft status will be removed only when every one of those is proven.
