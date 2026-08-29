# Named wire shapes (execution record)

Closes `RES-04`. Targets `BR-08b-OPEN-01`.

|                                   |                                                 |
| --------------------------------- | ----------------------------------------------- |
| Branch                            | `remediation/p1-29-backend-named-wire-shapes`   |
| Base                              | `cf67d15e` — `origin/develop` at the #278 merge |
| Ownership profile                 | `p1-29-backend`                                 |
| New migrations                    | **0**                                           |
| New operations / permission codes | **0**                                           |
| New CI gates                      | **1** — `validate:named-wire-shapes`            |

---

## 1. What was wrong

Route handlers returned `Promise<{ … }>` declared inline, so the shape a client
receives had no name anywhere in the tree: it could not be imported, referenced by
a contract, or changed in one place.

`BR-08b` named six response envelopes because its contract enumerated six, and
defended the remainder with a claim it had not measured — that the other anonymous
`Promise<{…}>` return types never reach the wire. **Thirteen** did.

## 2. The count was eight, then twelve, and both were wrong

`RES-04` recorded **eight**, honestly flagged as a lower bound because the census
behind it left 47 call sites UNRESOLVED. This slice first closed those 47 by
patching the text scanner and reported **twelve**. An adversarial review of that
work found a thirteenth — and, more importantly, found that the scanner was
reporting `0 anonymous, 0 unresolved` while a live anonymous shape shipped on
`/notifications/{id}/deliveries`.

The text scanner was wrong four separate ways:

| what it could not read                          | consequence                                       |
| ----------------------------------------------- | ------------------------------------------------- |
| a signature short enough to fit on one line     | the bulk of the 47, and 1 hidden shape            |
| a barrel binding a service to a `const` first   | 7 call sites, 5 of them attachments, 3 hidden shapes |
| a `body:` that is not the first token on a line | **11 call sites silently dropped**, 1 hidden shape |
| a wrapped `): Promise<{`                        | parsed as the string `"Promise<"` and filed NAMED |

Each figure above is reproducible against this tree: the original census is
`git show cf67d15e:scripts/p1-29-anonymous-wire-census.mjs` and reports 47
unresolved at that commit; the 11 are the response bodies whose initializer is a
direct module call not beginning its own line, counted from the AST.

The third is the serious one. Those sites landed in **no** bucket — not named, not
anonymous, not unresolved — so `unresolved: 0` was not a measurement, it was an
artefact of not looking.

### 2.1 The one-line defect was self-inflicted, and it is what exposed the rest

`StatusTransitionService.describe` had a wrapped signature. Naming its return type
made it short enough for prettier to collapse onto one line — at which point the
scanner stopped resolving it, and a gate that had just gone green went red. The
fix for a defect moved a call site into the scanner's blind spot.

## 3. So the gate reads the AST

Each regex was correct about the case it was written for and wrong about the next.
That is, verbatim, the failure `scripts/lib/typescript-source.mjs` was extracted to
end, and it sits in this tree with three gates already using it.

The text version justified itself with a claim that is false:
`ts.createProgram` is absent, but that governs **type awareness**, not **parsing** —
and parsing was all this ever needed. The same over-broad sentence in
`check-openapi-success-status.mjs` has been corrected here; converting that gate to
the AST is follow-up, not done in this slice.

`scripts/ci/check-named-wire-shapes.mjs` now parses each route with
`parseModule`, finds every `body:` property of a **returned** object literal, and
resolves it along the chain the code writes. A type is anonymous when a
`TypeLiteral` node appears anywhere inside the declared return type — which covers
`Promise<{…}>`, a bare `{…}` on a synchronous method, and anything wrapped such as
`Promise<Readonly<{…}>>`. The text form missed all but the first.

### 3.1 What it covers, stated so the number cannot be mistaken for more

| bucket         | count   | judged                                             |
| -------------- | ------- | -------------------------------------------------- |
| **named**      | **288** | pass                                               |
| **anonymous**  | **0**   | fail — always a defect                             |
| **composed**   | **46**  | not judged: the route assembles the literal itself |
| **unresolved** | **0**   | fail — where a silent default would hide a shape   |
| total bodies   | **334** | every `body:` in every route file                  |

`composed` is a stated scope limit, not a blind spot: nothing lands there without
being counted and named, and a body that is a CALL is never filed there — that
would let a broken resolver reclassify every service call as "the route authored
it" and pass while blind. The test cross-checks the 334 against an independent
text count taken a different way.

## 4. The thirteen, and the eight interfaces that replaced them

| interface             | module                            | call sites |
| --------------------- | --------------------------------- | ---------- |
| `AccessRecordCreated` | `iam` — access administration     | 4          |
| `HoldingWithdrawn`    | `technician` — roster             | 2          |
| `DocumentLinkRef`     | `shared-services` — attachments   | 2          |
| `StatusDescription`   | `shared-services` — transitions   | 1          |
| `RenderedPreview`     | `shared-services` — templates     | 1          |
| `TemplateCreated`     | `shared-services` — templates     | 1          |
| `VersionRejected`     | `shared-services` — attachments   | 1          |
| `DeliveryHistory`     | `shared-services` — notifications | 1          |

All eight are exported, so a client can import the shape it receives.

## 5. Proven by mutation, in both directions

The baseline is asserted green before each mutation, so a gate that was already
failing could not masquerade as a proof.

| mutation                                                     | expected | result                                |
| ------------------------------------------------------------ | -------- | ------------------------------------- |
| the thirteenth shape reverted to anonymous                   | red      | exit 1, names the route               |
| resolver blinded so no `body:` reaches a service             | red      | exit 1, unresolved reported           |
| barrel const-binding path removed                            | red      | exit 1, unresolved reported           |
| type-literal detector blinded, **with** an anonymous present | green    | exit 0 — the detector is load-bearing |

The last is the one worth keeping: it shows the detector, not the plumbing, is
what catches an anonymous shape.

## 6. Scope note recorded alongside this slice

An earlier revision of the residual register named **PC-04** as this slice's
successor. That is withdrawn. PC-04 needs fifteen new operations and a permission
code, and `pre-p1-29-multi-tenant-admin-rbac-workflow/scope.md:31` says this
programme may change who may do a thing but may not add a new thing that can be
done. The register already excluded its twin PC-05 on exactly that ground.

## 7. Status

`RES-04` moves to **F** on merge and protected reproof. No operation, permission
code, migration or runtime behaviour changed: every edit is a type name or a gate,
and `docs/api/openapi.v1.json` is byte-identical.
