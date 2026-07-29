# P1-22 execution checkpoint

**Phase:** P1-22 — Billing, Payment, Delivery, and Warranty Backend
**Branch:** `feature/p1-22-billing-payment-delivery-warranty-backend`
**Status:** **Wave 1 in progress.** Coverage gate repaired and proven. Domain layers
and shared registrations landed. Module repositories/services/ports in flight.
Routes not yet written.

## Current position

| Field                 | Value                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------- |
| HEAD                  | `3b96af8a620e35365e31b48100d4e7e0df138832`                                            |
| `P1_22_BASE_SHA`      | `0a53e540d72329e9aef6b196b68627aeb40b4c79`                                            |
| Commits of P1-22 work | 5 (3 documentation from Wave 0, 2 executable)                                         |
| Working tree          | **dirty** — shared registrations + 2 docs staged for the next commit                  |
| Remote ref            | pushed to `a22c666`; `3b96af8` not yet pushed                                         |
| Migrations            | **119**, no `120`, none modified                                                      |
| Schema hash           | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`                    |
| `origin/develop`      | `0a53e540d72329e9aef6b196b68627aeb40b4c79`                                            |
| `origin/main`         | `9c2fea162e5a270c740bac8db3546ed695a6f58a` (promoted, untouched)                      |
| Local PostgreSQL      | available — `supabase_db_RootLco`, 119 migrations applied, 24 `sal`+`wty` tables      |
| GitHub API            | available — `gho_` token via `git credential fill`, scopes include `repo`, `workflow` |

## Wave 0 — complete (unchanged)

Baseline verified; archaeology committed (`contract-archaeology.md` plus
`evidence/archaeology.json`, 838 KB; nine lenses, 36 agents, **240 findings, 124
gaps, 10 blocker gaps that survived independent refutation**). **Determination: no
migration 120 is required.**

## Wave 1 — what is done, with the evidence

### 1. The coverage gate was blind, and is not any more — `a22c666`

SB7, measured before anything was touched:

```
isDerivedId('sal.invoice-issue')  = false
isDerivedId('wty.warranty-read')  = false
derivedRequirements(wty read)     = []            <- nothing required at all
derivedRequirements(sal mutation) = ['idempotency']
parseProvidedFlags(declaration)   = []            <- declarations INVISIBLE
```

Worse than the P1-20 defect it was compared to, and in **two opposite
directions**: hook 1 blind means evidence is provided but not required, so deleting
the assertions keeps the gate green; hook 2 blind means the one obligation that did
derive could not be satisfied by any declaration a test can write.

**Four** hooks extended, not two. The two extra ones are why the phase's own
acceptance criteria are not vacuous: without the structural opt-in, `metadata-only`
and `unit-only` compute as `false` for every row and the phase would report `0`
because nothing was measured.

Each hook mutation-tested **separately**, with disjoint failure signatures:

| Mutation                                           | Tests that fail |
| -------------------------------------------------- | --------------- |
| M1 remove `P1_22_PREFIXES` from `DERIVED_PREFIXES` | 14              |
| M2 remove `sal\|wty` from the alternation          | 4               |
| M3 remove them from the strict comment ratchet     | 1               |
| M4 remove them from the structural opt-in          | 3               |

Restored byte-identically each time, sha256
`063822694c6142c070e4b3be24356f77bd4e4bfb61f0edc41ee7401e40ac2970`.

`inv.` (P1-21) was opted into hooks 3 and 4 in the same commit, **after measuring
that it costs nothing** — 14 operations, 0 metadata-only, 0 unit-only, 0
invocation-only, 0 internal-without-reason, 0 failing the strict ratchet. Adding
the phase-count block without opting in would have printed an unmeasured
`P1-21 metadata-only: 0`.

**A defect this work introduced and then caught:** the first version of the new
fixture built its synthetic suites with no leading `/**`, so the header was not a
comment at all — `stripComments` is a lexical scanner and treats unopened lines as
code. Three cases passed for a reason unrelated to what they assert. The prose case
failed honestly and exposed it. Fixed; the reason is recorded in the fixture.

82/82 fixture tests pass. Real-repository gate green with P1-22 reporting **0
registered**, which is the honest figure.

### 2. Domain layers — `3b96af8`

Four files, no database reachable from any of them: `billing.ts` (246),
`delivery.ts` (227), `payments.ts` (205), `warranty.ts` (163).

Two money validators, not one, because the `sal` schema draws a line P1-20 did not
have to: `>= 0` on invoice/line/event amounts (**a zero-total issued invoice is
legal**) and `> 0` on every payment instrument.

No arithmetic in TypeScript. That is the repository's own recorded decision, not
caution added here: `Money` has no `add` and no `multiply` because PostgreSQL
`numeric` is the authoritative engine. The invoice preview will therefore be a
read-only `SELECT`, not a TypeScript computation.

Three places where the application is the **only** defence, each said so in code:
`assertCurrencyMatches` (SB1), `assertAllocationUsesPrimitive` (BR-SAL-002),
`composeEligibility` (the financial blocker `sal.complete_delivery` does not check).

### 3. The operation inventory — 20 operations, archaeology-driven

`operation-inventory.md`. §6 names sixteen capabilities; fifteen map one-to-one,
credit-note foundation needs two, and four more exist because the sixteen are
otherwise unreachable. Five things are deliberately absent, each with the
measurement behind it.

### 4. Shared registrations — staged, not yet committed

13 audit actions, 8 event catalogue entries (`EVT-SAL-001..007`, `EVT-WTY-001`), 20
route templates (169 → **189**, +20 insertions with no reordering), and the
`event-envelope` fixture's implemented list and `OWNERS_BY_PHASE` extended with
`'P1-22': ['billing', 'payments', 'delivery', 'warranty']`.

### 5. Blocker treatment and the operator runbook

`blocker-treatment.md` classifies **all ten** surviving blockers into one of the six
permitted treatments, and raises six change-control candidates it does not act on.
`number-sequence-runbook.md` is the SB3 provisioning procedure, including the trap
that `org.provision_organization` provisions **tenant-wide** rows which
`IS NOT DISTINCT FROM` will not match for a named company and branch — so a
provisioned-looking tenant still fails its first invoice.

## Known red, with a precise cause

`tests/foundation/route-templates.test.ts` — 2 failures. The registry now lists 20
templates that no route module declares yet; the reconciliation is bidirectional and
goes green in the commit that adds the routes. **This is not a stale green claim in
the other direction: nothing here reports those routes as working.**

## Tasks

**0 of 31 complete.** Backend 0/18 · Security 0/4 · QA 0/5 · DevOps 0/2 ·
Documentation 0/2. No task is claimed without executable evidence, and the two
documentation deliverables above are **written but not claimed** — their gate rows
require the endpoint-inventory script that does not exist yet.

## Operations

**0 of 20 registered.** Operation depth 0/0 — honest, because no route exists.
Pending 0, unit-only 0, metadata-only 0, all measured rather than assumed.

## Accepted limitations carried forward

`P1-22-L-01` warranty claim adjudication · `L-02` currency equality is
application-only · `L-03` numbering requires operator provisioning · `L-04`
signatures bind but cannot be retrieved · `L-05` no refund/partial
reversal/multi-invoice credit/ledger · `L-06`
`sal.partner_outstanding_balance` mixes currencies.

## Next exact action

Land the four module repositories/services/public ports, then write the 20 Route
Handlers and register each in all nine places (contract-test import, route
template, OpenAPI regeneration, audit catalogue, permission seed check, coverage
manifest, idempotency evidence, endpoint inventory, authorization coverage). The
route-templates reconciliation is the signal that the ninth is complete.
