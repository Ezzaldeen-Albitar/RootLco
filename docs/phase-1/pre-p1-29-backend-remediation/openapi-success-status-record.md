# Published success statuses (execution record, written after the fact)

Closes `RES-03`. Targets `BR-08-OPEN-01`.

|                                   |                                                    |
| --------------------------------- | -------------------------------------------------- |
| Branch                            | `remediation/p1-29-backend-openapi-success-status` |
| Base                              | `a19709c4` — `origin/develop` at the BR-09 merge   |
| Merge                             | `cf67d15e` (PR #278), protected reproof 19/19      |
| Ownership profile                 | `p1-29-backend`                                    |
| New migrations                    | **0**                                              |
| New operations / permission codes | **0**                                              |

> **This record is retrospective.** PR #278 changed 116 files and created the
> canonical residual register, but shipped **no execution record** — making it the
> second slice in this programme to land without one, the same defect the register
> carries as `RES-17` against BR-01. It is written here from the protected tree
> rather than left as a second instance of a recorded defect.

---

## 1. What was wrong

`document.ts` hard-coded `'200'` as the sole success response for every operation.
98 route handlers return `201` and one returns `202`, so the published contract
told every generated client and the frontend mirror the wrong success code for
**99 of 334 operations**.

Nothing could catch it. The OpenAPI document was generated from the operation
DECLARATION, and the declaration had no field capable of disagreeing with the
handler — so the document and the code could not be compared even in principle.

`BR-08-OPEN-01` recorded this as _"the 19 operations returning an undocumented
201"_. That figure is not reproducible from the protected tree and the real number
is 99; the contract that scoped the smaller one never landed on develop.

## 2. What was done

- `OperationDeclaration` gained `readonly successStatus?: 200 | 201 | 202 | 204`.
- `document.ts` publishes `operation.successStatus ?? 200` instead of a literal.
- 99 declarations were annotated with the status their handler actually returns.

## 3. Why a declared field is not enough on its own

`successStatus` can drift from the handler exactly as a hard-coded literal did. So
the slice also shipped `scripts/ci/check-openapi-success-status.mjs`, which does
not read the declaration: for each `handleOperation(CONST, …)` call it walks the
balanced parentheses of that call, takes the literal `status:` found inside, and
resolves `CONST` to the `defineOperation({ id })` that produced it in the same
file. It then compares that against the committed document.

The scanner is deliberately syntactic — `ts.createProgram` is absent from this
repository — and it **refuses** what it cannot resolve rather than defaulting. An
operation whose status cannot be determined is precisely the case where a silent
default would republish the original defect.

The gate is `validate:openapi-success-status`, inside `verify:contracts`.

## 4. Status

Merged and reproven. `RES-03` moves to **F** in the residual register.
