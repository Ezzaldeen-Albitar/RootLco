# P1-25 — brand-mechanism findings

Found by adversarial review of the brand-replacement architecture while preparing the
Owner-input package. All three were latent: the suite was green, the gates passed, and
none would have surfaced until the moment the final brand was applied — which is the
worst moment to discover them.

## `P1-25-F-026` (High, fixed) — the provisional notice ignored brand state

`AppShell.tsx` rendered "Provisional appearance — final brand pending" in the header, and
the overview page rendered a "Provisional identity" card. **Neither was guarded.** They
had no reference to `brand.isProvisional` at all.

So the phase's central claim — that replacing the brand "changes configuration and tokens
only" — was **false in effect**. Setting `isProvisional: false` and shipping an approved
identity would have produced a product that still announced itself as provisional, in
both languages, on the first screen an Owner opens.

The rehearsal did not catch it because it asserted on the _diff_ (no component file
changes) rather than on the _rendered result_. A file-level check cannot see that a
component reads a flag it never consulted.

Both surfaces now render only while `brandIsProvisional` is true, read through
`components/brand/theme.ts` so the shell does not become a second consumer of the brand
config. Three tests in `apps/web/tests/brand-replacement.test.ts` pin the guard, the
indirection, and the flag's export.

## `P1-25-F-027` (Medium, fixed) — the brand gate could not see brand copy

`apps/web/scripts/check-brand-isolation.mjs` scanned `.ts`, `.tsx` and `.scss`. The
user-facing brand strings live in `.json` — `src/i18n/messages/en.json` and `ar.json` —
so the gate that exists to keep product identity out of components **never opened the
files where that identity would actually be written**.

Extended to `.json`, and given a `product-name-placeholder` rule so a hard-coded
`[SYSTEM NAME]`, `[SN]` or `[PRODUCT NAME — Pending Final Approval]` outside the brand
configuration is a failure rather than a habit. Inspected files rose 61 → 64; violations
remain 0, so nothing was hiding — but the gate now measures what it claims to.

`tests/ci/brand-isolation-gate.test.ts` (12 tests) proves each rule fires per file type,
including the JSON case that was previously invisible, plus four negative cases so the
gate does not start flagging provisional-state copy that names no product.

## `P1-25-F-028` (Medium, fixed) — `dev:stop` reported success without stopping anything

The launcher's stop script killed recorded PIDs and cleared its state file whenever
`process.kill` did not throw. When a launcher parent died while its Next children kept
the ports — which is exactly what had happened to the stack left running for Owner
review — the recorded PIDs were gone, `dev:stop` printed "already gone", cleared the
state, and **exited 0 while both servers went on serving**.

It now reports one of three honest outcomes per process, and then checks the ports. If a
recorded port still answers it names it, prints the `netstat` command to find the owner,
leaves the state file in place, and exits non-zero — because it cannot prove an unknown
process is one of ours, and killing by name is how an editor gets taken down with the
dev server.

## Dispositions

| ID            | Severity | State                                                         |
| ------------- | -------- | ------------------------------------------------------------- |
| `P1-25-F-026` | High     | Fixed — both provisional surfaces guarded, 3 tests            |
| `P1-25-F-027` | Medium   | Fixed — gate extended to `.json` + placeholder rule, 12 tests |
| `P1-25-F-028` | Medium   | Fixed — stop verifies rather than assumes                     |

No Critical finding. None of the three required Owner input to fix, which is why they
were fixed now rather than deferred into the branding change: applying a final brand is
hard enough without discovering mid-flight that the mechanism was not what the record
said it was.
