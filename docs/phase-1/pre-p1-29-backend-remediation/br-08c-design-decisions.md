# BR-08c — decisions taken before transcription

The contract requires three things to be decided **before** the mirror is written rather than during
it: the layout, the keying rule, and whether length and pattern facets participate. This document
takes those decisions and records the measurements they rest on. It is written first on purpose — a
layout chosen while transcribing is a layout chosen by whichever file was written first.

---

## 1. The contract's constants are stale, in seven places

Every figure in the `BR-08c` contract was measured against `develop c081a019` at **305 operations**.
`BR-01`…`BR-07` have since landed, and all of them add to exactly the four domains P1-29 covers.
Measured against `a30e81e3` at **334 operations**:

| fact                          | contract                    | live                                                                                   |
| ----------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| P1-29 operations              | 58                          | **87**                                                                                 |
| writes                        | 35                          | **51**                                                                                 |
| writes carrying a body        | **34**                      | **48**                                                                                 |
| bodyless writes               | `{tech.labor-session-stop}` | **3** — plus `tech.technician-availability-withdraw`, `tech.technician-skill-withdraw` |
| state-vocabulary regex fields | 3                           | **4** state vocabularies, of **6** fields carrying the regex — see §7                  |
| closed enums named            | 4                           | **17**                                                                                 |
| the evidence-body collision   | "three-way after `BR-07`"   | **three-way** — the contract was right; see §1.2                                       |

**This matters more than a refreshed table, because `C2` is the anti-vacuity assertion.** It is the
thing standing between this gate and §2.4's trap, where a gate pointed at the wrong files passes
every operation with no mirror written at all. Hard-coding `34` would fail on the first run; and the
tempting repair — relaxing the assertion until it passes — deletes the protection entirely. So the
gate **computes** the counts from the register and the tree, and asserts a relationship rather than a
number:

> every P1-29 write either carries an extracted body, or appears in a hand-frozen bodyless allow-list
> **with a reason** — and the extracted count is non-zero.

A gate pointed at an empty or wrong directory extracts zero and fails on the non-zero clause. A gate
pointed at the right directory cannot be quietly satisfied by a shrinking mirror, because every
absence must be named.

### 1.1 The two new bodyless writes are correct, and the third is unchanged

`tech.technician-availability-withdraw` and `tech.technician-skill-withdraw` are both `DELETE`, both
added by `BR-03`, and a `DELETE` that carries no body is ordinary rather than a defect.
`tech.labor-session-stop` remains what the contract said it was: the only bodyless **POST** in the
surface.

### 1.2 The evidence collision is three-way — the contract was right and this document was wrong

This section first claimed the `{documentVersionId, evidenceType, note?}` collision was **two-way**,
correcting the contract's "three-way". **That correction was itself wrong, and it is recorded rather
than silently replaced**, because the way it was wrong is the thing this slice is about.

The census behind it walked **top-level request bodies only**. Two of the three instances are
top-level — `dia.diagnostic-evidence-record` (`note` `maxLength` 500) and `wo.job-evidence-record`
(1000). The third is **nested**: `wo.additional-work-approval.evidence[]` is an array whose element
carries the identical field triple, with `note` `maxLength` **500** — matching `dia`'s limit rather
than its own domain's. A census that only looks at the outermost object cannot see it.

The `BR-07` reasoning in the first draft was sound as far as it went: `BR-07` shipped three
operations and only `wo.job-evidence-record` is a write with that body, because job evidence rolls up
to the work order for **reading** while being recorded at the **job**. It simply was not the whole
question.

**Consequence for §4, and it is not cosmetic:** the one-type-per-operation rule must cover **nested
element types too**. The nested instance is the most tempting share in the entire surface — it is
field-for-field identical to `dia.diagnostic-evidence-record`, including the limit — and a mirror
author reaching for a shared `EvidenceRef` would be reusing a type across a domain boundary on the
strength of a coincidence.

---

## 2. The extraction mechanism, proven rather than assumed

`BR-08b` exported the schemas so that "`BR-08c` may read them as values". That is now demonstrated
end to end rather than taken on faith: a `vitest` run globs every route module under
`apps/api/src/app/api/v1/**/route.ts` and converts each operation's body with `z.toJSONSchema`.

269 route modules are globbed and all **48 / 48** P1-29 bodies convert. (An earlier draft of this
document showed those two figures as a `GLOBBED … EXTRACTED …` console transcript. They were real
measurements from a scratch version of the extractor, but the shipped one prints nothing, so a reader
could not reproduce the lines by running anything. Quoting output no code emits is the same defect as
quoting a file inaccurately, and it is worth more to say the numbers plainly.)

`import.meta.glob` is what makes this need no generated import list, and `vitest` is what makes `@/`
resolve. A plain `.mjs` script cannot import TypeScript route modules, so the extraction runs there
and the comparison runs over its output.

What the extractor recovers, checked against a real body:

```json
"wo.job-create": {
  "type": "object",
  "properties": {
    "title":              { "type": "string",  "minLength": 1, "maxLength": 200 },
    "jobType":            { "type": "string",  "minLength": 1, "maxLength": 64  },
    "state":              { "type": "string",  "pattern": "^[a-z][a-z0-9_]{1,62}$" },
    "requiresDiagnostic": { "type": "boolean" }
  },
  "required": ["title"],
  "additionalProperties": false
}
```

Field names, the required/optional split, primitive types, enum members, nesting, and
`additionalProperties: false` from `.strict()` all survive. `.refine` predicates do not — the known
ceiling the contract already records.

---

## 3. Decision: the mirror lives in `lib/`, not in `features/`

The obvious layout is one file per feature under `apps/web/src/features/`. **It is the wrong one
here, and the repository has already written down why.** There is no `work-orders`, `technicians`,
`diagnostics` or `quality` feature: P1-29's frontend does not exist yet, and
`features/receptions/work-order-contract.ts` argues against inventing one:

> _"A `features/work-orders` module would be that boundary's opposite: a home for a surface P1-29
> owns, built one wave early and half-shaped, which the next phase would then have to argue with."_

Creating four such feature directories to hold nothing but DTOs would commit the frontend lane to a
decomposition it has not made.

**The mirror therefore lives under `apps/web/src/lib/contracts/`**, one module per domain. This
satisfies _a feature may never import another feature_ — the rule
`features/receptions/work-order-contract.ts:23`, `support-api.ts:29` and `catalogue-api.ts:29` each
state in their own docblocks — **by construction rather than by discipline**, because `lib/` is not a
feature and every feature may already import it, exactly as they import `CursorPage<T>` from
`lib/api/read-operation.ts` today.

**Two corrections to the first draft of this section, both found by review.** It attributed that rule
to `INS-14`, which is a different finding entirely — _"reviewer separation compares the report's
creator only"_ (`docs/product/README.md:201`). The rule is a repository convention carried in
docblocks; it has no finding id, and inventing a citation for it made a real constraint look like a
tracked defect.

It also promised **a shared module for the types more than one domain needs**, justified by
`QueueEntry` — and no such module ships, because none is needed. `QueueEntry` is an element of
`tech.technician-queue`'s **response**, and this mirror is REQUEST-only. Nothing in the 48 request
bodies crosses a domain. The four modules import nothing, from each other or from anywhere: the
shared module was a solution to a problem this slice's scope does not have, and it is removed rather
than built empty.

---

## 4. Decision: key on the operation id — never on the shape

Field-name-and-optionality keying collapses the surface to **43** distinct shapes; full-schema keying
gives **45**. The difference is two collision groups:

| group                                     | operations | differ by                            |
| ----------------------------------------- | ---------- | ------------------------------------ |
| `{documentVersionId, evidenceType, note}` | 2          | `note` `maxLength` — 500 vs **1000** |
| `{reason}`                                | 3          | `maxLength` — 500, 500, **1000**     |
| `{reason, toState}`                       | 3          | nothing — byte-identical             |

**Each operation gets its own named type, and no type is ever shared between two operations — nor
between two nested element positions**, even where the schemas are byte-identical. The reason is the `{reason}` group: a mirror that declared one
`ReasonBody` for all three would tell a caller that a 900-character reason is acceptable to
`wo.additional-work-withdraw`, where the limit is 500 and the request will be refused. The types are
indistinguishable in TypeScript, so nothing would catch it.

Sharing a type between two operations is safe **only** while their schemas stay identical, and
nothing enforces that they will. `{reason, toState}` is identical today and would be the tempting
place to share; it is also three transition operations on three different aggregates, which is
precisely the kind of thing that diverges.

---

## 5. Decision: facets do NOT participate in the comparison — and that is why types are never shared

The contract requires this to be settled explicitly. It is settled against participation, for a
structural reason rather than a preference: **a TypeScript interface cannot express `minLength`,
`maxLength` or `pattern`.** A mirror made of interfaces has nowhere to put them, so a gate comparing
them would be comparing a value against nothing.

So the gate compares what a type can actually carry:

| compared                                  | not compared                     |
| ----------------------------------------- | -------------------------------- |
| field names                               | `minLength` / `maxLength`        |
| required vs optional                      | `pattern`                        |
| primitive type (`string`/`number`/`bool`) | **`maxItems`**                   |
| enum membership, as a union of literals   | `.refine` predicates             |
| nesting, to arbitrary depth               | `.trim()`, `z.coerce` input side |

`maxItems` was missing from the first draft of this table and is here because the transcription found
it: five fields carry array cardinality — `wo.additional-work-approval.evidence` (10), and
`requiredSkills` / `requiredCertificationCodes` on both `wo.job-assignment-create` and
`wo.job-reassignment` (20 each). An interface can no more express "at most ten" than "at most 500
characters". Leaving it off the list would have made the gate's own stated ceiling **overstate what
it checks**, which is the one thing a gate's output must never do.

**And the left column was false when this table was written, in exactly that way.** The gate's
pattern branch `return`ed after checking only for an enum, which silently skipped the primitive-type
comparison for every field carrying a `pattern` — 50 of the surface's 140 field positions, including
27 uuids, 8 ISO date-times, 3 decimal strings and a currency code, all exempted to protect the four
state vocabularies the branch was written for. `toState: string` could be changed to `number`,
`boolean`, `string[]`, or a reference to an interface nothing declares, and the gate printed
`0 problem(s)`.

Nothing disclosed it. Not comparing `pattern` **as a facet** is what the ceiling says, and that is
true and fine; skipping the type comparison of every field that happens to carry one is a different
thing entirely. The rule stated two paragraphs above is the rule it broke.

Found by adversarial review, fixed at `check-p1-29-payload-parity.mjs`, and now held by six
mutations in `tests/ci/p1-29-payload-parity.test.ts` — four wrong primitives on a `toState`, a uuid
declared as a number, and the enum direction that `C10` already covered.

**The two decisions are linked, and that is the point.** Facets are excluded from the comparison
precisely _because_ they cannot be compared — which is exactly why §4 forbids sharing a type across
operations. If facets were comparable, sharing would be caught the moment two operations diverged.
Since they are not, the mirror must not create the opportunity in the first place.

This ceiling is stated in the gate's own output, not left to be inferred.

---

## 6. Decision: the declaration form

A field present on both sides is `REACHABLE` **by construction** — the mirror declaring it is the
declaration. Only absences need words:

| backend | mirror  | verdict                                                                                                     |
| ------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| present | present | `REACHABLE` — nothing to declare                                                                            |
| present | absent  | must appear in `DISPOSITIONS` as `PENDING` or `DELIBERATELY_ABSENT`, **with a reason** — otherwise **FAIL** |
| absent  | present | **FAIL**, always — an unexpected field is drift in the dangerous direction                                  |

This is what makes `C8` and `C9` work at field granularity, and both are proved by mutating a real
field out of the mirror: undeclared, it fails; declared with a reason, it passes; declared with a
blank reason or a state outside the vocabulary, it fails again.

It also keeps the mirror small — **54 interfaces** (48 request bodies plus 6 nested element types)
and a disposition table listing only what is missing, rather than a 48-entry restatement of every
field that is present. `DISPOSITIONS` is **empty today**, which is the honest state: this mirror
omits nothing.

**A correction to the first draft.** It said "`work-order-contract.ts`'s eight deliberate omissions
pass because each is declared with a reason". That was wrong twice over. The eight omissions belong
to `apps/web/src/features/receptions/work-order-contract.ts` — the P1-28 precedent, a **different
file that happens to share a basename** with this mirror's work-order module — and they are described
in the `BR-08` contract's prose, not declared anywhere in that file, which contains zero disposition
markers. Nothing in this repository declares an omission the way §6 requires; this slice is the first
thing that could, and it currently has none to declare.

---

## 7. Decision: no enum for a tenant-extensible vocabulary

**Six** fields carry `^[a-z][a-z0-9_]{1,62}$` rather than an enum — not four, as the first draft of
this section and its §1 table both said. Four are state vocabularies owned by a live tenant
catalogue: `wo.job-transition.toState`, `wo.work-order-closure.toState`,
`wo.work-order-transition.toState`, and — the one the contract missed — `wo.job-create.state`. The
other two are tenant-**authored** slugs being created rather than selected:
`dia.template-create.code` and `dia.template-item-create.itemCode`.

The distinction matters for the reason, not the outcome: all six are `string` in the mirror, but only
the first four are members of a catalogue, so only those four are what the rule below is _about_.
Counting six as state vocabularies would be as wrong as counting four.

For all six the mirror declares `string`, and **the gate fails if it declares a union of literals.**
The repository already reached this conclusion once, in the precedent this mirror follows:

> _"`wo.work_order_states` is a live catalogue and the response's `state` is a row of it. There is no
> frozen vocabulary to translate against… a translation table keyed on a code the catalogue owns
> would be a second, rotting copy of a tenant's own configuration."_

The other **17** enum fields are genuinely closed — `ck_` check constraints, not catalogue tables —
and are compared as unions.

---

## 8. The open record, and why zero fields is a correct answer

`dia.template-item-create.validationRule` is the surface's only open record —
`z.record(z.string(), z.unknown())`, which renders as
`{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{}}` with **no named
properties at all**. The mirror declares it as a named interface carrying a readonly index signature
rather than inlining `Record<string, unknown>`, so the nested type still exists for the gate to walk
and there is somewhere to put its docblock.

**The gate must not read "zero fields" as "the mirror forgot the fields".** For a schema whose
`properties` is empty and whose `additionalProperties` is open, the correct check is that the mirror
declares an index signature — not that the field lists match, which they trivially do at length zero.
This is the one place where the §6 table's "present/absent" reasoning has nothing to reason about,
and a gate that did not special-case it would either pass vacuously or fail an honest mirror.

## 9. What this slice still does not gate

**Responses.** No machine-readable response source exists: routes return service values, the only
statement of a response shape is a TypeScript interface, and `ts.createProgram` appears nowhere in
this repository. `BR-08b` gave eight of those interfaces names; it did not make them comparable. The
gate says so in its own output rather than letting a green run imply coverage it does not have.
