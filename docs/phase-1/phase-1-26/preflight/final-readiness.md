# P1-26 — final readiness

Generated from live repository state by `npm run validate:p1-26-readiness`. The
machine-readable twin is [final-readiness.json](final-readiness.json).

**Status: NOT READY.** Five of nine conditions are met. The four that are not are Owner
inputs, and no amount of engineering closes them.

## The checklist

| #   | Condition                  | State | Detail                                  |
| --- | -------------------------- | ----- | --------------------------------------- |
| 1   | P1-14 gate record          | ✅    | `phase-1-14-owner-gate.md`              |
| 2   | P1-15 gate record          | ✅    | `phase-1-15-owner-gate.md`              |
| 3   | P1-24 gate record          | ✅    | `gate-record.md`                        |
| 4   | **P1-25 gate record**      | ❌    | none under any convention               |
| 5   | **OIR-01 product name**    | ❌    | `systemName` is still a placeholder     |
| 6   | **OIR-06 visual identity** | ❌    | `brand.isProvisional` is `true`         |
| 7   | **Approved logo asset**    | ❌    | `apps/web/public/brand/` holds no asset |
| 8   | No premature P1-26 branch  | ✅    | none exists                             |
| 9   | Migration baseline         | ✅    | 119 migrations                          |

## Why this is derived rather than written down

A dependency status recorded once decays into a stale yes that nobody re-reads. Every
item above is read from the **tree**, not from prose:

- A gate record is a **file that exists**, checked under all three filename conventions
  this repository actually uses — `phase-1-N-owner-gate.md` (phases 1-1…1-20),
  `gate-record.md` (1-21…1-24), and the governance template's `phase-1-N-gate.md`, which
  no phase has adopted. Accepting only one would report a missing record for a phase that
  has one.
- OIR-01 is closed when `systemName` holds a real value, not when a register says so.
- OIR-06 is closed when `isProvisional` is `false` in the shipped configuration. A
  document asserting the brand was approved proves nothing; that flag proves it was not.
- The logo is an **asset on disk**, not a promise.

An unreadable brand config counts as **not approved**. Failing open there would report
READY because a file could not be read, which is the failure mode this whole class of
check exists to prevent.

## How it is used

It is a **reporter**, and exits 0 whether or not P1-26 is ready — because "not ready" is
the correct state today, and a repository-wide gate that fails on the correct state is a
gate people learn to ignore.

```bash
npm run validate:p1-26-readiness          # reports; always exits 0
node scripts/ci/check-p1-26-readiness.mjs --assert-ready   # exits 1 unless ready
```

The `--assert-ready` form is what the P1-26 branch-creation step calls. Today it exits 1,
which is correct.

`tests/ci/p1-26-readiness.test.ts` (10 tests) proves each condition blocks on its own,
that a premature P1-26 branch is noticed rather than assumed away, and that an unreadable
config never reads as approved.

## What closes the remaining four

Items 5, 6 and 7 are answered by the input package in
[`docs/phase-1/phase-1-25/owner-input-required.md`](../../phase-1-25/owner-input-required.md):
final product name, final logo, final colour palette, approved prototypes, and the
fidelity decision.

Item 4 follows from them — the P1-25 gate record cannot honestly be written until the
brand is applied and the fidelity decision is recorded, because that decision is what the
record exists to state.

The order is therefore fixed and short: inputs → apply → review → decide → gate record →
P1-26. Nothing in that chain is waiting on engineering.
