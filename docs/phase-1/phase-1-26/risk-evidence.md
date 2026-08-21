# Phase 1-26 — risk disposition

**Classification:** Confidential — Commercial Product and Pilot Planning

Three risks were named for review at this gate. **None of them belongs to P1-26**,
and this record says so rather than claiming credit for controls it did not
build.

---

## RSK-20

**Status at this gate: not applicable to P1-26 · no register entry found.**

`RSK-20` is not defined in any risk register in this repository. Grepping
`docs/**` returns it only in the P1-24 gate record's _heading list_, not as an
entry with a trigger, a mitigation or an owner.

**Disposition.** P1-26 does not fabricate a definition in order to disposition
it. If `RSK-20` exists in a canonical document outside the repository, it needs
to be brought into `docs/` before any gate can honestly assess it. Recorded here
as an open governance item, not as "mitigated".

## RSK-27 — an issued quotation changing after presentation

**Owner: P1-20. Status: Mitigated, and untouched by P1-26.**

|                 |                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Trigger         | a quotation's captured totals move after the client has seen them                                                                    |
| Control         | `quo.guard_quotation_item` refuses item writes on a non-draft parent; `quo.guard_quotation_revision_freeze` freezes captured totals  |
| Proof           | P1-20 republished the price list at five times the amount after issue and asserted the stored columns for that revision did not move |
| P1-26 relevance | **none.** This phase builds no quotation screen and calls no quotation operation.                                                    |
| Residual        | as recorded by P1-20                                                                                                                 |

## RSK-31

**Status at this gate: not applicable to P1-26 · no register entry found.**

As `RSK-20`. The highest-numbered risk with a definition in `docs/` is `RSK-27`,
in `docs/phase-1/phase-1-20/evidence/open-decisions.md`.

**Disposition.** Not fabricated. Recorded as an open governance item.

---

## What P1-26 does own

The risks this phase actually created, and what holds each one:

| Risk this phase introduced                                         | Control                                                                         | Where it is proven                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A session credential reachable by page script                      | `httpOnly` cookie; one authority; a gate rule                                   | `authentication.test.ts`; `check-p1-26-frontend.mjs`          |
| A recovery token persisting in the address bar                     | erased with `history.replaceState` on first read, usable or not                 | `RecoveryTokenBridge`; browser suite                          |
| The interface undoing the backend's uniform authentication failure | one message for every credential verdict                                        | `login.ts`; `authentication-workflows.md` §1                  |
| A client permission check mistaken for access control              | denial rendered **instead of** content; the Permissions screen says so in words | `permission-and-scope-standard.md`                            |
| A fabricated total making a pager lie from page two                | `total: number \| null`; no count is invented                                   | `administration.test.ts`; `P1-26-F-001`                       |
| Money rounded by a JavaScript number                               | decimal strings end to end; `inputMode="decimal"`, never `type="number"`        | gate rule `float-money`; `administration.test.ts`             |
| A business default acquired because a form needed filling          | five screens ship empty slots and say so on the page                            | `open-decisions.md` `OD-002`…`OD-005`                         |
| An open redirect on a credential-completion page                   | no `next`/`returnTo`/`redirect` anywhere in the flow; a gate rule               | `authentication.test.ts`; gate rule `auth-redirect-parameter` |

## A note on how these were dispositioned

A risk register is only useful if "mitigated" means something. Two of the three
risks named for this gate have **no definition anywhere in the repository**, and
the honest answer to "is it mitigated" is "there is nothing here to assess".

Writing a plausible mitigation for an undefined risk would produce a gate record
that reads as complete and proves nothing — which is the exact failure mode this
repository's gates exist to prevent.
