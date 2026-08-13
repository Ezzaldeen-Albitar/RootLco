# Phase 1-27 — open decisions

**Classification:** Confidential — Commercial Product and Pilot Planning

Decisions this phase could not make for itself, and engineering decisions it did
make that the Owner should ratify.

> **P1-27 is CLOSED — `OWNER ACCEPTANCE: PASS`, 2026-08-12**
> ([`closure-record.md`](closure-record.md)). The road there is preserved: the
> Product Owner manually tested the merged application —
> `develop` `8b9be4bc92a6349a6cb99d15ee282f5f463c63a5`, which
> [`deliverable-manifest.md`](deliverable-manifest.md) §4.1 records as the state
> after PR #199 — and returned `OWNER ACCEPTANCE: FAIL` with eleven confirmed
> defects, recorded on 2026-08-06. Remediation then merged through protected
> change control: `owner-acceptance-fail-remediation.md` records PR #200 →
> `11c07b1d` and PR #201 → `44e053ad`, both two-parent merge commits, and the
> manifest §4 records a third merge, **PR #202** — branch
> `docs/p1-27-installed-chrome-review`, head `4de51d9c`, `develop` afterwards
> `19f370b9` — whose scope §4.1 gives as **documentation only**. The rule
> **"P1-27 closes only when the Product Owner manually tests the application
> again and returns an explicit `OWNER ACCEPTANCE: PASS`; silence is not Pass"**
> was applied without exception, and on 2026-08-12 the Owner answered with
> exactly those words. `main` is not promoted and P1-28 has not started. The
> business decisions below are NOT closed by the phase closure: `P1-OD-017` and
> `P1-OD-025` remain open, exactly as recorded.
>
> The result and the disposition of each defect are in
> [`owner-acceptance-fail-remediation.md`](owner-acceptance-fail-remediation.md).

Nothing here was invented. Where a business decision was required and absent,
the implementation is **decision-neutral**: it provides a place for the answer
and supplies none. Where a capability is absent because a decision is open, the
affordance is **absent rather than disabled** — a disabled control asserts that
the capability exists and that this operator lacks permission, which is a
different and false statement.

---

## 0. How to read this document

### 0.1 The two identifier namespaces are not the same thing, and the difference matters

| namespace      | who issues it                                                                                                       | what an entry here means                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `P1-OD-###`    | The canonical Word documents that govern this repository (`docs/governance/canonical-documents.md`). **The Owner.** | The decision exists. This document records where it binds.                                                              |
| `P1-27-OD-###` | This phase, following the `P1-26-OD-###` precedent in `docs/phase-1/phase-1-26/open-decisions.md`.                  | A **request** for a decision, or an engineering decision awaiting ratification. It is **not** a `P1-OD-###` allocation. |

**This repository holds no `P1-OD-###` register to allocate from.**
`docs/phase-1/phase-1-1/open-decisions.md` — which `docs/product/README.md` §7
calls "the Owner-decision register the `P1-OD-` and `OIR-` references sit
alongside" — contains **zero** `P1-OD-` identifiers. Its register is ten rows:
`OIR-01`/`ASM-01` (product name), `OIR-06` (UI prototypes and brand colours) and
eight rows carrying no `P1-OD-` number at all — six identified only by topic, and
two by identifiers of other kinds (`ADR-002`, and `P1-01-SEC-003` / `P1-EC-016`).

`P1-OD-042` is the highest `P1-OD-` number that any document in `docs/` treats as
an **existing** decision — `docs/product/README.md` §4 records it as OPEN. It is
**not** the highest number _referenced_: `P1-OD-043` already appears, at
`docs/product/vehicle-catalogue/provider-evaluation.md:486`, labelled
"_suggested, not assigned_" (see `P1-27-OD-001` below). Neither fact is evidence
that `043` is free, and the suggestion is the strongest reason to say so: a
number a planning document has already written down is precisely the number a
later reader will mistake for an allocation.

Consequently **this document allocates no `P1-OD-###` number**. Issuing one is
the register owner's act, performed in the canonical Word documents outside this
repository.

### 0.2 The entries

| id             | subject                                              | type                                                     | status                                                                         |
| -------------- | ---------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `P1-OD-017`    | Duplicate and merge rules, customers and vehicles    | Business decision — external                             | **OPEN**                                                                       |
| `P1-OD-025`    | Vehicle document and media file policy               | Business decision — external                             | **OPEN**                                                                       |
| `P1-27-OD-001` | Vehicle reference-data source                        | Commercial decision reserved to the Owner                | **Proposed — not recorded, no number allocated**                               |
| `P1-27-OD-002` | The customer-creation section model (Owner defect 6) | Scope decision with a Backend prerequisite               | **Open — partly addressed**                                                    |
| `P1-27-OD-003` | A candidate count on either duplicate queue          | Engineering decision, ratification requested             | **Open — implemented decision-neutrally**                                      |
| `P1-27-OD-004` | Vehicle document creation                            | Capability gap with a scope decision behind it           | **Open — no create operation exists**                                          |
| `P1-27-OD-005` | Concurrency semantics for CRM and Vehicle writes     | Engineering decision, ratification requested             | **Decided — last-writer-wins, stated and gated**                               |
| `P1-27-OD-006` | Alert routing — what it means at the web tier        | Engineering decision, ratification requested             | **Decided — routing built, paging absent and gated**                           |
| `P1-27-OD-007` | What `DOC-001` is judged on — §6's eighteen paths    | Reading of the canonical wording, ratification requested | **Decided — synchronization, not coverage; paths stay undischarged and gated** |

### 0.3 What every entry states

**Type** · **Status** · what the interface does **today**, so the Owner can see
the consequence of leaving the decision open · what changes when the Owner
answers.

---

## `P1-OD-017` — duplicate and merge rules

**Type:** business decision, held outside this repository · **Status:** **OPEN**

### What the repository holds, and what it does not

`docs/` contains **no definition** of `P1-OD-017` — no statement, no
decision-maker, no date. It contains only dispositions, written by the phases the
decision binds:

| file                                                    | line | what it records                                                        |
| ------------------------------------------------------- | ---- | ---------------------------------------------------------------------- |
| `docs/phase-1/phase-1-27/canonical-plan.md`             | 229  | The disposition this phase built to: merge blocked, review not blocked |
| `docs/product/workshop/parts-and-procurement-flow.md`   | 718  | Disposition for the parts surface                                      |
| `docs/product/workshop/reception-media-checklist.md`    | 448  | Disposition for reception evidence                                     |
| `docs/product/vehicle-catalogue/manual-entry-policy.md` | 534  | Disposition for manually entered vehicles                              |

The definition lives in the canonical Word documents. Nothing in this repository
may be read as one.

### The capability exists in the platform and is deliberately not reached

| operation            | method | path                                   | permission                             |
| -------------------- | ------ | -------------------------------------- | -------------------------------------- |
| `crm.customer-merge` | POST   | `/api/v1/customers/{customerId}/merge` | `crm.customer.merge` (severity `high`) |
| `veh.vehicle-merge`  | POST   | `/api/v1/vehicles/{vehicleId}/merge`   | `veh.vehicle.merge` (severity `high`)  |

Both are published in `docs/api/openapi.v1.json`. Both permission codes are
seeded in `supabase/seeds/04_iam_permission_catalog.sql`. **No P1-27 web file
calls either.**

`scripts/check-operation-test-coverage.mjs` records what `veh.vehicle-merge`
actually does: one insert into `veh.vehicle_merges` redirects and freezes the
source vehicle through the frozen-apply trigger, and the merge record, the audit
record and the `vehicle.merged` event are one atomic statement. A self-merge is
`422`; an already-merged source and a merged survivor are both `409`. That is a
one-way operation, and it is the reason its governing rules are an Owner decision
rather than an engineering preference.

### What the interface does today

**Both review screens exist and are reachable. The merge affordance is absent.**

| surface                        | today                                                                                                                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar                        | `customer-duplicates` → `/crm/customer-duplicates` and `vehicle-duplicates` → `/vehicles/duplicates`, both `status: 'available'`, both with the `duplicate-review` icon rather than the list icon they used to share with the search screens |
| Sidebar gating                 | Each on its **own** `crm.customer.duplicate.review` / `veh.vehicle.duplicate.review` code — deciding whether two records are the same thing is a separate capability from being allowed to look at one                                       |
| Sidebar labels                 | "Review duplicate customers" · "Review duplicate vehicles"                                                                                                                                                                                   |
| Queue                          | A keyset-paginated table of candidate pairs with a status filter (`open` by default), the pair, the match percentage, the status and the detection time                                                                                      |
| Decision panel                 | The two records side by side, a confidence band and the match evidence as business sentences, and a dismissal form requiring a reason                                                                                                        |
| **Instead of a merge control** | One sentence naming the decision, with the identifier rendered beside it                                                                                                                                                                     |

The sentence on the customer screen (`crm.duplicates.mergePendingDecision`):

> Merging two customer records is not available yet. The rules for it are pending
> an Owner decision.

The sentence on the vehicle screen (`vehicles.duplicates.mergePendingDecision`):

> Merging two vehicle records is not available yet. The rules for it are pending
> an Owner decision.

Each is followed by the literal string `P1-OD-017`, rendered `dir="ltr"` so it
reads correctly in Arabic.

The queue introductions say the same thing before an operator opens a pair
(`crm.duplicates.intro`, and the vehicle equivalent):

> The system noticed these customer records look alike. Open a pair to see why.
> If they are genuinely different customers, say so and the pair is set aside.
> Joining two records into one is a separate decision that is not available yet.

**There is exactly one decision a reviewer can take: dismissal.**
`crm.duplicate-review` and `veh.vehicle-duplicate-review` accept `dismissed` and
nothing else. `merged` is a **status a candidate reaches** through the merge
operation, not a decision either review endpoint accepts —
`DUPLICATE_STATUSES` is `open | dismissed | merged` while
`VEHICLE_DUPLICATE_DECISIONS` is `['dismissed']`.

### Why absent and not disabled

A disabled button says "this capability exists and you are not allowed to use
it". That is a different and false statement: the capability's **rules** do not
exist, and no permission grant would change that. A permission grant is not a
decision record.

### This phase got it wrong once, and that is why it is enforced in six places

Wave 6 shipped a **working** merge form — a survivor selector, an
approval-reference field, a reason box and a submit button wired to
`mergeCustomerAction`. It passed review, typecheck, lint and 669 green tests,
because nothing in the pipeline knew `P1-OD-017` was open. The full account is in
[`findings.md`](findings.md).

The refusal is now load-bearing in six independent places, so it has to be argued
with in a diff rather than deleted around:

| #   | where                                                               | what it refuses                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `scripts/ci/check-p1-27-frontend.mjs`, rule `no-merge-caller`       | Any of `customer-merge`, `vehicle-merge`, a `"/merge"` path literal or a `merge*Action` export, across the **77** files the gate owns, in all three canonical trees                                             |
| 2   | `apps/web/tests/crm-duplicate-review.test.ts`                       | Describe block "the merge affordance is absent, not merely unused": `validateMerge`, `MergeInput` and `mergeCustomerAction` must all be absent                                                                  |
| 3   | `apps/web/tests/vehicle-duplicates.test.ts:73`                      | No export of the vehicle duplicates adapter whose name matches `/merge/i`                                                                                                                                       |
| 4   | `apps/web/tests/vehicle-screens.dom.test.tsx:264,236`               | Line 234 walks **every rendered button** and refuses any whose text matches `/merge/i`; line 236 refuses any button whose accessible name matches `/merge/i`                                                    |
| 5   | `apps/web/tests/e2e/authenticated/crm-and-vehicles.spec.ts:162-163` | Against the real stack, real database and a real session: zero merge buttons, zero merge links                                                                                                                  |
| 6   | `scripts/dev/owner-acceptance/context.mjs:184`                      | `WITHHELD_PERMISSIONS = ['crm.customer.merge', 'veh.vehicle.merge']` — the Owner-acceptance role is granted 30 codes and neither of these, so an acceptance run cannot pass while the affordance quietly exists |

### One piece of residue, recorded rather than tidied away

Seven message keys from the removed form survive in **both** catalogues
(`apps/web/src/i18n/messages/en.json` and `ar.json`) and are referenced by no
component:

`crm.duplicates.merge` · `crm.duplicates.mergeHeading` ·
`crm.duplicates.mergeHint` · `crm.duplicates.merged` ·
`crm.duplicates.survivorLegend` · `crm.duplicates.survivorSameAsMerged` ·
`crm.duplicates.willBeMerged`

`CRM_PERMISSIONS.merge` and `VEHICLE_PERMISSIONS.vehicleMerge` are likewise
declared in `apps/web/src/features/crm/permissions.ts` and read by no component.
Both are still exercised by tests: `apps/web/tests/crm-customer-search.test.ts`
iterates every entry of both objects and asserts each code is seeded in
`supabase/seeds/04_iam_permission_catalog.sql`, and
`apps/web/tests/crm-duplicate-review.test.ts:147-148` additionally asserts that
`CRM_PERMISSIONS.merge` is `crm.customer.merge` and differs from the review code.

None of this is reachable and none of it can call anything. Whether it should be
deleted or kept ready is **part of what the decision settles**, and removing it
now would destroy the shape of the answer if the answer is "build it". Recorded
here so it is a choice rather than an oversight.

### Where else `P1-OD-017` binds

| finding   | subject                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `VHM-19`  | `GET /vehicle-duplicates` is tenant-wide with no vehicle filter; adding one is constrained by this decision |
| `VCAT-12` | Catalogue-level duplicate detection: detection and reporting may proceed, **automatic merging may not**     |
| `WF-19`   | Cross-domain service history, where "the same customer" has to be settled first                             |

All three are document-local planning findings in `docs/product/README.md` §3.
None is an entry in the live `P1-27-INT-###` register.

### What is needed to close it

The rules themselves: who may merge, what survives, what happens to every record
that referenced the loser, whether an approval reference is required, whether the
act is reversible, and whether customers and vehicles are governed by one rule or
two. **None of that is P1-27's to decide, and no part of it may be inferred from
the operation's implementation** — the implementation is what the platform can
do, not what the business has agreed it should do.

### What changes when the Owner answers

| answer                             | consequence                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules supplied, merge in scope     | A Frontend wave builds the affordance against the published operations, the two merge permission codes are granted, the six refusals above are amended together with the tests that state them, and the seven catalogue keys are re-used |
| Rules supplied, merge out of scope | The refusals become permanent, the residue is deleted, and both screens keep the sentence with the wording changed from "pending" to the settled position                                                                                |
| No answer                          | The queues keep working. Duplicates are found, compared and dismissed. Nothing is joined, and the screens say so.                                                                                                                        |

---

## `P1-OD-025` — vehicle document and media file policy

**Type:** business decision, held outside this repository · **Status:** **OPEN**

### What the repository holds

As with `P1-OD-017`, `docs/` contains **no definition** — only dispositions, at
`docs/phase-1/phase-1-27/canonical-plan.md:245`,
`docs/product/workshop/reception-media-checklist.md:428`,
`docs/product/workshop/parts-and-procurement-flow.md:727` and
`docs/product/vehicle-catalogue/manual-entry-policy.md:555`.

### What is not claimed because of it

**No accepted file type, size limit, retention period or storage arrangement is
asserted anywhere in the product.** That is the whole of the refusal, and it is
deliberate in each of its parts:

| not claimed                | why not                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Accepted types             | Naming a set would pre-empt the decision, and an operator would take the list as policy                                       |
| A size ceiling             | Any number here would be invented; the repository holds none                                                                  |
| A retention period         | Retention is a legal position before it is a setting                                                                          |
| A storage arrangement      | `STORAGE_PROVIDER` in `apps/api/src/server/config/backend-config.ts` defaults to **`unconfigured`**, which refuses every call |
| That upload is coming soon | Nothing in the repository establishes when                                                                                    |

### What the interface does today

The vehicle profile carries a "Photos and media" section. It contains a heading,
one sentence, and the decision identifier — **and no control of any kind, not
even a disabled one**:

> Vehicle photos and media are not available yet. Accepted file types, size limits
> and storage are pending an Owner decision, and nothing is uploaded or stored
> until it is made.

The state is a single closed value rather than a boolean:

```
export const MEDIA_STATUS = 'blocked-on-p1-od-025' as const;
export const MEDIA_BLOCKING_DECISION = 'P1-OD-025';
```

A feature flag implies something to switch on. There is nothing behind this one.

Two mechanisms keep that true rather than merely stated:

| mechanism                                                                                   | what it refuses                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/ci/check-p1-27-frontend.mjs`, rules `no-upload-path` and `no-invented-media-limit` | Seven file-access constructs — `new FormData(` with or without an argument, `multipart/form-data`, a file input in any spelling, `FileReader`, an `input.files` list, an `onDrop=`/`onDragOver=` target and a `DataTransfer` — plus every invented limit: a `MAX_FILE_SIZE_`-style constant, byte arithmetic, an accepted-MIME list, an extension allow-list or an `accept=` attribute. Across all **77** files the gate scans |
| `apps/web/tests/vehicle-duplicates.test.ts:203`                                             | No export of `@/features/vehicles/documents-api` whose name matches `upload`, `media` or `attach`, case-insensitively                                                                                                                                                                                                                                                                                                          |

### The decision alone does not make upload reachable, and the difference is worth stating

The platform **does** publish generic attachment write operations:

| operation                              | method | path                                                                 |
| -------------------------------------- | ------ | -------------------------------------------------------------------- |
| `shared.attachment-upload-authorize`   | POST   | `/api/v1/attachments/upload-authorizations`                          |
| `shared.attachment-version-register`   | POST   | `/api/v1/attachments/versions`                                       |
| `shared.attachment-version-reject`     | POST   | `/api/v1/attachments/versions/{versionId}/rejection`                 |
| `shared.attachment-link-create`        | POST   | `/api/v1/attachments/documents/{documentId}/links`                   |
| `shared.attachment-link-withdraw`      | DELETE | `/api/v1/attachments/links/{linkId}`                                 |
| `shared.attachment-download-authorize` | POST   | `/api/v1/attachments/documents/{documentId}/download-authorizations` |
| `shared.document-retention-evaluate`   | POST   | `/api/v1/attachments/documents/{documentId}/retention-evaluations`   |

**None of them is vehicle-scoped, and none of them is reachable today.** Three
separate gaps sit between the decision and a working upload, and each is recorded
in `docs/product/README.md` §3:

| gap                                                                                                                                                                     | finding  | owner |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| No route accepts file bytes; `STORAGE_PROVIDER` is `unconfigured` and the only adapter signs against a non-resolvable host                                              | `RMC-02` | P1-15 |
| Version acceptance needs a `clean` row in `shared.file_scan_results`, granted to no role; no registered file can be downloaded                                          | `RMC-03` | P1-15 |
| No document category exists — `shared.document_categories` has no seed file in `supabase/seeds` (verified by search), so every upload authorisation fails `ERR-RES-001` | `RMC-05` | P1-15 |

So answering `P1-OD-025` unblocks the **policy**. It does not by itself produce a
capability, and no document in this phase says otherwise.

### Where else it binds

`RMC-02`, `RMC-05`, `INS-15`, `INS-18`, `PROC-07`, `DTA-16`, `VDP-04`,
`VCAT-08`, `VHM-08`, and the whole of
`docs/product/workshop/reception-media-checklist.md`. The consolidated statement
is in `docs/product/README.md` §4. `RMC-03` is not in that list; it sits with
`RMC-02` and `RMC-05` under the same decision in §2.1, where the three
unreachable-upload findings are grouped.

### What is needed to close it

The accepted document categories and file types, the size ceilings, the retention
position, and where files are stored. Then, in the controlled sequence in
`docs/product/README.md` §5: an object store is **evaluated** and provisioned
(`RMC-02`), the scanning component gets a role and a grant (`RMC-03`), the
category set is configured without violating the no-fake-data policy (`RMC-05`),
and only then is a screen buildable.

### What changes when the Owner answers

The media section stops being a statement and becomes a task with a contract in
front of it — in a Backend phase first, and a Frontend phase after that. Nothing
about the current screen is thrown away: it already names the decision it waits
on, so the change is one sentence and one component, not a rebuild.

---

## `P1-27-OD-001` — the vehicle reference-data source

**Type:** commercial decision reserved to the Product Owner · **Status:**
**Proposed — not recorded**

### The identifier, stated precisely

`P1-27-OD-001` is a **candidate identifier in this phase's own namespace**. It is
a request for a decision and it is **not** a `P1-OD-###` allocation.

`docs/product/vehicle-catalogue/provider-evaluation.md` §10 suggests
`P1-OD-043` and labels it "_suggested, not assigned_". This document does not
repeat that suggestion as though it were an allocation, for the reason given in
§0.1 above: **there is no `P1-OD-###` register in this repository to allocate
from**, `P1-OD-042` is only the highest number any document treats as an existing
decision, and issuing a number is the register owner's act performed in the
canonical Word documents. If the
Owner records the decision, the number the Owner assigns supersedes
`P1-27-OD-001` and this document is corrected.

`VDP-10` records the underlying governance gap in one sentence: the provider
question is recorded nowhere. A repository-wide search for every candidate name
matches only the evaluation document — no application code, configuration,
migration or seed mentions one.

### The exact question the Owner must answer

Eight questions, each written so it can be answered with a short, recordable
answer. Read from `provider-evaluation.md` §10.

| #     | question                                                                                                                                               | answer format                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| **1** | **Which markets must the vehicle catalogue cover for the pilot?** Name the countries.                                                                  | A list of countries                                       |
| **2** | **Is expenditure on a paid vehicle-data provider authorised in principle, or must the platform launch on a free source plus manual maintenance?**      | "Authorised in principle" / "Free source and manual only" |
| **3** | If expenditure is authorised in principle, **what is the approved evaluation budget and the maximum recurring cost** the Owner is willing to consider? | Decimal string + ISO 4217 code, or "no ceiling set"       |
| **4** | **Are manufacturer logos and vehicle images required for launch, or desirable later?**                                                                 | "Required at launch" / "Desirable later" / "Not wanted"   |
| **5** | **Must reference data be stored in the platform's own database and shown to tenants?**                                                                 | "Yes — storage and tenant display required" / "No"        |
| **6** | **Must the vehicle-selection screen work when the workshop's internet link is down?**                                                                  | "Yes" / "No"                                              |
| **7** | **Who owns the platform-scope catalogue** — is it curated centrally by RootLco for all tenants, or does each tenant build its own?                     | "Central platform catalogue" / "Per tenant" / "Both"      |
| **8** | Does any workshop in scope **already hold a manufacturer data entitlement** that could be used?                                                        | Yes (name the marques) / No / Unknown                     |

**Questions 1, 2 and 5 come first, and no vendor conversation should begin until
they are answered** — those three answers eliminate candidates for free.

Question 4 is where **`P1-OD-025`** binds, and it carries a trade-mark question
that is not a data-licensing question: a manufacturer logo is a trade mark
whoever supplies the file. `P1-OD-017` binds indirectly — a richer catalogue
changes what "the same vehicle" means to the duplicate detector.

### The axes, and what each one decides

The comparison in `provider-evaluation.md` §4 is built so that every row states
what it would change for this platform, and what evidence would settle it.

| axis                                    | what it decides for this platform                                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Country / market coverage               | Whether the vehicles the pilot workshop actually receives are in the source at all. A source that misses the local market is not a cheaper option, it is a wrong one                               |
| 2010-onward historical coverage         | Whether a 2011 vehicle can be recorded as precisely as a 2024 one                                                                                                                                  |
| VIN support                             | Whether VIN decode is possible, and whether `veh.vin_verifications` can ever record an `external` check honestly                                                                                   |
| Make / model / year / trim completeness | Whether the four-level narrowing the requirement describes (`VS-02`/`VS-03` of `provider-evaluation.md` §3) has anything to narrow. What is built today narrows three levels, not four — see below |
| Body type                               | Whether `veh.body_types` can be populated from the source or must be curated by hand                                                                                                               |
| Powertrain                              | Whether `veh.powertrain_types.category` can be derived — which gates the EV profile                                                                                                                |
| EV / hybrid fields                      | Whether usable capacity and charge-port type can be pre-filled or must be measured per vehicle                                                                                                     |
| Images                                  | Whether vehicle imagery is achievable, and at what storage and licensing cost                                                                                                                      |
| Logos                                   | The same, plus a trade-mark question                                                                                                                                                               |
| Licensing                               | Whether the platform may use the data at all                                                                                                                                                       |
| **Redistribution rights**               | **The single most architecture-changing axis.** Whether data may be stored in the platform's own tables and shown to tenants, or must be fetched per request                                       |
| API limits                              | Whether an import can complete, and whether a per-request architecture is viable at all                                                                                                            |
| Update frequency                        | How stale the catalogue is allowed to become                                                                                                                                                       |
| Cost                                    | Whether the option is affordable. **Reserved to the Product Owner**                                                                                                                                |
| SLA                                     | Whether the vehicle-selection screen may depend on the source being up                                                                                                                             |
| Data export                             | Whether a bulk snapshot exists, which decides whether the import is a job or a crawl                                                                                                               |
| Offline cache                           | Whether the workshop can work when the link is down — the normal state of a workshop network                                                                                                       |
| Vendor lock-in                          | What it costs to change one's mind later                                                                                                                                                           |

### This is a commercial decision, and nothing here recommends a purchase

`provider-evaluation.md` §9 states the boundary and this document repeats it
without softening: selecting, contracting, subscribing to or paying for a
vehicle-data provider is a **commercial and financial decision reserved entirely
to the Product Owner**.

| this document                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- |
| **recommends an evaluation** — the time-boxed technical spike in §13, which costs engineering time and no money |
| **recommends that a decision be taken and recorded**                                                            |
| **does not recommend a vendor**, and does not treat the free candidate as a default                             |
| **does not recommend a purchase** and quotes no price, rate limit, refresh interval or availability figure      |
| **does not authorise expenditure, a trial subscription, a sign-up, or acceptance of any vendor's terms**        |

No engineer may enter into a vendor agreement, accept vendor terms or begin a
paid trial. The spike is scoped so that it can be completed **without any account
that requires accepting commercial terms**; where a candidate cannot be evaluated
without one, that is reported to the Owner as a finding rather than resolved by
signing.

### There is no engineering blocker, and that is the point

**The provider port and the manual-entry fallback are specified independently of
any vendor.** Neither exists today — `VDP-07` and `VDP-01` record their absence —
and the claim is not that they are built. The claim is that **their design does
not depend on the answer**, so building them need not wait for it and choosing a
vendor later does not invalidate them.

The precedent is in the repository:
`apps/api/src/modules/shared-services/provider/storage-provider.ts` faces exactly
this situation for object storage. The phase delivered **the port** — the shape
every adapter must satisfy — plus a deterministic local adapter that reaches no
network, and recorded provider selection as an open decision. The port was built,
the decision stayed open, and nothing was blocked.

| track                        | depends on the vendor decision? | why                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend selection screens   | **No**                          | The five catalogue reads are published and stable. A picker built against `{ items, nextCursor, hasMore }` behaves identically whether the rows came from a vendor, an import, or an operator typing them |
| Manual catalogue maintenance | **No**                          | The dual-scope schema already supports tenant extensions. What is missing is a write route and a permission code (`VDP-01`) — Backend work no vendor decision affects                                     |
| Provider port and adapter    | **Only the adapter**            | The port would be written once; each vendor is then one adapter behind it                                                                                                                                 |

### What the interface does today

**Defect 11 — "Vehicle creation does not provide the required Make → Model →
Year → Trim/Body/Powertrain experience backed by an approved global catalogue
strategy" — is recorded as documented and NOT implemented, and nothing below
softens that.** What exists is the part the published reads support. Year is not
part of the cascade, no catalogue strategy is approved, and the catalogue itself
is empty.

| today                           | detail                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cascading picker                | The vehicle creation screen narrows Make → Model → Trim, plus body type and powertrain type, on the five catalogue reads merged as `P1-27-INT-007` in PR #197                                                                                                                                                                  |
| How the lists are fetched       | `apps/web/src/features/vehicles/catalogue-api.ts` walks each relation to the end, bounded at 20 pages × 100 rows. When the bound is reached it reports `truncated` and the screen says so — "Showing the first part of a long list. Some entries are not shown." — rather than presenting a partial catalogue as the whole one |
| **The catalogue is empty**      | No seed file in `supabase/seeds` writes `veh.makes`, `veh.models`, `veh.trims`, `veh.body_types` or `veh.powertrain_types` — verified by search. Business tables ship empty by standing policy                                                                                                                                 |
| What an operator therefore sees | "Nothing available yet." in each picker, and a form that says "Register a vehicle. Every field is optional."                                                                                                                                                                                                                   |
| Consequence                     | A vehicle can be created today with all five catalogue references null                                                                                                                                                                                                                                                         |
| Model year                      | A free integer bounded 1900–2100. `veh.models.first_model_year` and `last_model_year` are published by no read (`VDP-03`, `VCAT-02`), so no per-model year narrowing is offered and none is guessed                                                                                                                            |
| Names in search results         | `veh.vehicle-search` projects `make_id` and `model_id` and no names (`VDP-08`); only the detail read resolves them                                                                                                                                                                                                             |
| VIN                             | Format validation at the edge plus the server's uniqueness verdict. **No decode.** Nothing in the platform derives a make, model or year from a VIN                                                                                                                                                                            |
| Adding a missing make           | Not possible through the product. There is **no catalogue write operation and no catalogue-management permission code** (`VDP-01`, `VCAT-06`, `MVE-05`)                                                                                                                                                                        |

### What must not be done while the decision is open

| do not                                                            | because                                                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ship a bundled list of makes or models inside the web application | It is fabricated business data and the no-fake-data policy forbids it. The guard permits the discussion in `docs/`, never the data in the product |
| Show a placeholder catalogue "until the real one arrives"         | An operator cannot tell a placeholder from a thin catalogue, and will record vehicles against invented rows                                       |
| Assume the catalogue is non-empty                                 | It is empty in every environment today. The empty state is the **normal** state and must read as a real, explained state, not as an error         |
| Call any provider directly from the browser                       | It would put a vendor credential in a browser and bypass every tenant-scoping control the platform has                                            |

### What changes when the Owner answers

| step | what becomes possible                                                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Questions 1, 2 and 5 shrink the candidate list before any engineering time is spent                                                                                                                                                                   |
| 2    | The evaluation in `provider-evaluation.md` §13 runs: a real vehicle sample from the pilot workshop, coverage measured against it, vendor material requested in writing, vocabulary mapping costed on paper, and a decision paper — **not a purchase** |
| 3    | A Backend phase builds the port (`VDP-07`), the catalogue write surface with a **reviewed** permission code added to the seed (`VDP-01`), the external-reference storage an idempotent refresh needs (`VDP-06`), and retirement (`VDP-09`)            |
| 4    | Only then is a populated catalogue a Frontend obligation, and the pickers already built consume it unchanged                                                                                                                                          |

If the Owner takes a decision and it warrants an architecture record, the ADR is
numbered from the directory: the highest file present in `docs/adr/` is
**`ADR-021`**, so the next free number is **`ADR-022`**.

---

## `P1-27-OD-002` — the customer-creation section model

**Type:** scope decision with a Backend prerequisite, Owner ratification
requested · **Status:** **Open — partly addressed**

This is Owner-acceptance defect 6: "The system does not guide a normal
non-technical user through creating an Individual or Company Customer."

### What the interface does today — the half that is done

**Both creation paths are reachable and clearly labelled.** Before the
remediation they were reachable only by typing the URL, or by running a search
that found nothing.

| today                         | detail                                                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the actions are         | `CustomerCreateActions` renders in **two** places — the customer-search page header, where an operator looks for a primary action, and again beneath a search that returned nothing, where the thought "this customer is new" actually occurs |
| One component, two call sites | So the labels, the permission rule and the destinations cannot drift apart                                                                                                                                                                    |
| Labels                        | "Add an individual customer" · "Add a company customer"                                                                                                                                                                                       |
| Two buttons, not a chooser    | An individual and a company are different records with different fields, and the choice is made before any typing starts. A single "Add customer" opening a chooser adds a step to every creation to save one word                            |
| Destinations                  | `/{locale}/crm/customers/new/individual` and `/{locale}/crm/customers/new/company`                                                                                                                                                            |
| Permission                    | `crm.customer.create`, resolved from the session on the server. **Absent, not disabled** — verified in the installed browser against a read-only, branch-scoped account, where both controls did not render                                   |

### What the interface does today — the fields

**The individual form is four fields. The company form is three.** That is the
entire published request body of each operation, both `.strict()`:

| form           | fields                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| **Individual** | Given name · Family name · Preferred language _(optional)_ · Initial status |
| **Company**    | Legal name · Trading name _(optional)_ · Initial status                     |

Two details that are not obvious and are deliberate:

- **Initial status offers `prospect` or `active` only.** The search filter offers
  five lifecycle values, because a customer can _reach_ `inactive`, `blocked` or
  `merged`; it cannot be _born_ there. A form offering the search vocabulary
  would answer `422` on three of its five options.
- **The duplicate warning arrives after creation, and the screen says so up
  front**: "Search first — the customers that already share this name are shown
  after the record is created." There is no pre-submit duplicate check because
  there is no operation for one — `crm.duplicate-scan` is a privileged audited
  write that emits an audit record, and running it on a keystroke would fill the
  audit trail with scans nobody asked for. The creation response carries
  `possibleDuplicates`, and it is rendered with links and a plain statement that
  the record **was** created.

### What is not built

**The fourteen progressive sections per path.** They are not built, and this is
not claimed to be complete.

**The list itself is not in this repository.** The Owner's instruction §9 is
named once, at `owner-acceptance-fail-remediation.md:64`. The **count** —
fourteen sections per path — is repeated in four further P1-27 records
(`task-register.md:232`, `risk-register.md:213-218`,
`evidence/task-traceability.md:233` and `deliverable-manifest.md:608`), and **not
one of the five lists a single section**. The fourteen sections are therefore
**not established** here, and nothing in this phase should be read as knowing
what they are.

### Why it was not half-built

Most of the fourteen sections name fields whose backend contract this phase has
not audited, and this phase's own record contains four separate failures caused
by guessing a contract:

| guess                                                                     | what was true                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A `veh.vehicle.create` permission, by symmetry with `crm.customer.create` | It does not exist. `POST /vehicles` registers **`veh.vehicle.manage`** — the same code that gates editing. The catalogue check refused the whole bootstrap                                 |
| An `ADDRESS_TYPES` list of `billing / shipping / site / other`            | `ck_addresses_type` admits `billing / service / registered / other`. Two real values had no label and two labels named values the database cannot store — wrong in both directions at once |
| Six enum vocabularies in the Wave 5 message keys                          | **No `CHECK` constraint admitted any of them.** A key for a value the database cannot hold is dead weight; a key missing for one it can hold renders the raw key on screen                 |
| `vehicles.field.*` labels                                                 | Zero entries in either catalogue. All eleven codes the attribute-history trigger writes would have rendered raw, in both locales, the first time the Owner edited a vehicle                |

Building a fourteen-section wizard against unaudited contracts is how each of
those happened. The section model belongs in a controlled Frontend wave with
contract archaeology in front of it, and it is recorded as such rather than
half-built.

### What would unblock it

Four things, in order. None is a screen change.

**1. The Owner's §9 section list, brought into the repository.** Fourteen
sections cannot be built, audited or gated while the repository holds only the
number.

**2. Contract archaeology per section, against the route module's Zod schema —
not against the published OpenAPI document.** `docs/api/openapi.v1.json`
publishes **243 operations, 152 of them mutations, and a `requestBody` for zero
of them**; its entire `components.schemas` section holds three entries
(`ProblemDocument`, `Money`, `PageEnvelope`). That is `P1-27-INT-004`, it is
foundation-owned and open, and its practical consequence is that **the published
document cannot be used as the client contract for any write**.

**3. The write operations those sections would need. Most are missing or
unreachable.** Measured against the repository:

| what a section would need         | what exists                                                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a contact during creation     | `crm.contact-add` (`POST /customers/{id}/contacts`) is published and has **no web call site**. The profile lists contacts and offers no way to add one         |
| Add an address during creation    | `crm.address-add` (`POST /customers/{id}/addresses`) is published and has **no web call site**. Same                                                           |
| Correct a master field afterwards | **There is no `PATCH`, `PUT` or `DELETE` on `/api/v1/customers/{customerId}` at all** (`WF-03`). A customer's master fields cannot be corrected after creation |
| Two specific fields               | `crm.addresses.line3` and `crm.communication_preferences.quiet_hours_note` are columns **no write operation can set** (`P1-16-A-01`, open, owned by P1-16)     |

The third row is the one that changes the shape of the answer. A fourteen-section
creation wizard that captures a master field nothing can later correct is a worse
outcome than four fields an operator can be confident about in one screen. That
is a business trade-off, not an engineering preference, which is why it is here
rather than settled in a commit.

**4. A controlled Frontend wave** with its own task register, its own gate and
contract archaeology recorded before any form is written.

### What the Owner is asked to ratify

Whether **four fields plus a profile that fills in the rest** is acceptable for
the pilot, or whether **the fourteen-section model is a launch requirement**.
Both are legitimate positions and only the Owner can take one.

### What changes when the Owner answers

| answer                                   | consequence                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Four fields are acceptable for the pilot | The current screens stand; the section obligation is closed and `WF-03` is triaged on its own merits                                                                                                                                                                                         |
| The section model is required            | `WF-03` and `P1-16-A-01` become blocking Backend work in P1-16, `crm.contact-add` and `crm.address-add` gain call sites, and a Frontend wave becomes buildable with the §9 list as its input. Placing that wave in a sequence is a separate Owner act; nothing in this document schedules it |
| No answer                                | Both creation paths keep working and keep saying what they do. Nothing is guessed, and nothing claims to be the guided experience the Owner asked for                                                                                                                                        |

---

## `P1-27-OD-003` — a candidate count on either duplicate queue

**Type:** engineering decision, Owner ratification requested · **Status:** **Open
— implemented decision-neutrally**

The Owner's §10 permits a candidate count "when the contract safely supports it".
**It does not.**

### What the contract publishes

`crm.duplicate-list` and `veh.vehicle-duplicate-list` both answer
`{ items, nextCursor, hasMore }`. **There is no `total`.** That is the
platform-wide page shape: the platform fetches one extra row to detect `hasMore`
rather than running a second counting query, and no screen may show "page 3 of
47".

### What the interface does today

The shared `DataTable` has two pagination modes, and the duplicate queues use the
uncounted one because their adapters supply no count.

| mode                              | what renders                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Counted (`total` is a number)     | "Showing 1–20 of 57", first / previous / next / last, and a "1 / 3" page indicator                          |
| **Uncounted (`total` is `null`)** | **"Showing _n_"** where _n_ is the rows on this page, **previous and next only**, and the page number alone |

`total` is optional on `ServerPage`, and the duplicate adapters set none — so the
value is `null`, the first-page and last-page controls are not rendered at all,
and no "of N" appears anywhere.

The line carries `aria-live="polite"` so it is **read aloud after every page
change**. A count derived from a page would therefore not merely be printed; it
would be announced, as a fact, on every navigation.

### Why nothing derives one

A count derived from a page is correct on page one and wrong from page two,
invisibly. On a screen whose entire purpose is a careful decision about two real
records, a fabricated number is the worst possible decoration.

The refusal is enforced rather than intended: `scripts/ci/check-p1-27-frontend.mjs`
rule `no-invented-total` refuses `total: rows`, `total: items` and
`total: <anything>.length` across all **77** files the gate owns.

### A contrast worth keeping, because the rule is narrower than it sounds

The vehicle **documents** section _does_ print a count, and it is real.
`veh.vehicle-document-list` returns `{ vehicleId, documentIds }` — the whole
array, with no cursor and no limit — so `documentIds.length` is the complete
number, not a page of an unknown total. The section prints it and says so in a
comment on the line that prints it.

**The rule is not "never count". It is "never count what the operation did not
send".**

### What is needed to change it

A Backend change publishing a count on the two duplicate-candidate reads. That is
a decision about cost as much as about shape: the platform's keyset pagination
deliberately avoids a second counting query, and a count on every page would
reinstate one.

**Not established:** whether a count on these two screens is wanted enough to pay
for it. Nothing in the repository answers that, and no volume figure exists to
reason from — there is no operating data and none may be fabricated.

### What the Owner is asked to ratify

Either **ratify the current behaviour** — previous and next, no total, on both
queues — or **direct that a count is required**, in which case it becomes a
Backend obligation in P1-16 and P1-17 and reaches the screen through the
controlled sequence, never through a client-side derivation.

---

## `P1-27-OD-004` — vehicle document creation

**Type:** capability gap with a scope decision behind it · **Status:** **Open —
no create operation exists**

### The whole vehicle-side document surface is one read

| operation                   | method | path                                     | permission                   |
| --------------------------- | ------ | ---------------------------------------- | ---------------------------- |
| `veh.vehicle-document-list` | GET    | `/api/v1/vehicles/{vehicleId}/documents` | **`shared.document.manage`** |

Verified against `docs/api/openapi.v1.json`: there is **no POST, PUT, PATCH or
DELETE on that path**. Nothing in the platform creates, replaces or removes a
vehicle document.

Three further facts about that one operation, each recorded rather than worked
around:

| fact                                                                                                                                                                                                                                                                                                                                                                                    | finding                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| It is gated on a **manage** capability from a **different module**, inverted relative to every other vehicle sub-resource — ownership, plates, odometer, relationships and the EV profile all read on `veh.vehicle.read`. An operator who can see the whole vehicle may be unable to see its documents, and an operator who can see the documents may hold no vehicle permission at all | —                           |
| **`shared.document.read` is not seeded.** `supabase/seeds/04_iam_permission_catalog.sql` carries `shared.document.manage` and `shared.document.archive` and no read code, so both document reads are gated on a write code                                                                                                                                                              | `RMC-07`, `VHM-07`, `WF-07` |
| The response is `{ vehicleId, documentIds }` — a bare, unbounded array of identifiers with no name, type, date, size or uploader, and no cursor                                                                                                                                                                                                                                         | `RMC-08`, `VHM-08`          |

`RMC-04` sits on the same surface: the vehicle read asks for the entity token
`veh.vehicle` and the only link write accepts `veh.vehicles`.

### What the interface does today

| behaviour                    | detail                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permission checked **first** | The tab checks `shared.document.manage` before issuing the read, so a denied operator does not spend a read allowance discovering they cannot see it                                                                                                                                        |
| A named denial, not a blank  | "Viewing a vehicle's documents needs the document-management permission, which is separate from vehicle access."                                                                                                                                                                            |
| Empty state                  | "No documents are linked to this vehicle."                                                                                                                                                                                                                                                  |
| Non-empty state              | A real count and the references themselves, presented as references                                                                                                                                                                                                                         |
| The honest caveat            | "Only the document reference is available here. Names, types and dates are held by the document service and are not published to this screen." — said instead of rendering four empty columns that look like missing data                                                                   |
| No download control          | "Downloading a document is a separately audited action and is not started from this page." `shared.attachment-download-authorize` is `auditClass: 'security'`, so prefetching an authorisation to make a link feel fast would write a security audit record for a download nobody performed |
| **No create control**        | Of any kind, disabled or otherwise                                                                                                                                                                                                                                                          |

### Why this is separate from `P1-OD-025`, and why answering one does not answer the other

| decision       | what it settles                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `P1-OD-025`    | The **policy** — accepted types and categories, size limits, retention, storage placement           |
| `P1-27-OD-004` | The **contract** — that there is a vehicle-scoped create operation at all, and who owns building it |

Even with the policy answered there is nothing to call: the generic
`/api/v1/attachments` write operations are not vehicle-scoped, and they are
unreachable for the three reasons recorded under `P1-OD-025` above
(`STORAGE_PROVIDER` is `unconfigured`, no document category is seeded, and
version acceptance needs a scan result no role can produce).

### What is needed to close it

A scope decision naming the owning Backend phase. `RMC-08` and `VHM-08` name
P1-17 for the vehicle-side shape and P1-15 for the document service;
**`docs/product/README.md` §6 records that no repository record names a Frontend
phase for documents at all.**

After that, the controlled sequence in `docs/product/README.md` §5 applies
without exception, and its first rule governs this entry:

> **No finding in that register may be closed by editing a screen.**

Each of these is a missing or wrong Backend contract, and a Frontend phase that
worked around one would be building on a fact the platform does not hold.

### What changes when the Owner answers

| answer                                        | consequence                                                                                                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vehicle documents are in scope, phase named   | `RMC-08` (page shape), `VHM-08` (title and type on the projection), `RMC-04` (entity token) and a `shared.document.read` code are Backend work; the section then gains a create path and a real document table |
| Vehicle documents are read-only for the pilot | The current section stands unchanged; the caveat sentence becomes permanent rather than provisional                                                                                                            |
| No answer                                     | The section keeps listing what exists and keeps stating precisely what it cannot show. Nothing is implied that is not there                                                                                    |

---

## `P1-27-OD-005` — concurrency semantics for CRM and Vehicle writes

**Type:** engineering decision, ratification requested · **Status:** **Decided —
last-writer-wins, stated and gated**

**Owner:** Backend remediation, **P1-16** (customers) and **P1-17** (vehicles),
by the `P1-27-INT-###` route in [`canonical-plan.md`](canonical-plan.md) §4.
No Frontend phase can own it — see "Why this could not be built here".
· **Review by:** 2026-11-30

**The decision.** P1-27 ships **last-writer-wins** on every CRM and Vehicle
write, states it where an operator can see it, and claims no detection it does
not have. It does **not** add client-supplied optimistic concurrency, and it
does **not** send `If-Match` from any P1-27 adapter.

This follows the `P1-20-A-06` precedent ("No alert routing"): a capability is
deliberately not delivered, the reason is that delivering it here could only
produce an **unverifiable claim**, and the non-delivery is written down rather
than left for a reader to discover.

### The semantics, established against the API source

Five facts, each checked against `apps/api` rather than inferred from a
docblock. The first is the one a shorter summary gets wrong.

| fact                                                                                                                                                                                            | where                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| The platform **has** a complete optimistic-concurrency mechanism — a `record_version` column, `If-Match` parsing, `ERR-CON-001` (409) and `ERR-CON-002` (428) — and **40 route modules** use it | `apps/api/src/server/db/concurrency.ts`; `route-handler.ts:323`                        |
| **Not one** route under `customers/`, `customer-duplicates/`, `vehicles/` or `vehicle-duplicates/` declares `versionGuarded: true`                                                              | every route module under those four trees                                              |
| **Not one** of them reads `expectedVersion` either, so an `If-Match` sent from here would be parsed by `parseIfMatch(headers, false)` and then **discarded**                                    | `route-handler.ts:323`, `:351`                                                         |
| `ERR-CON-001` **is** genuinely raised on these writes — but the version guarding the UPDATE is one the **service itself read in the same transaction**, not one the caller supplied             | `vehicle-write-service.ts:115` → `:132`; `customer-governance-service.ts:159` → `:180` |
| So the mechanism catches a writer landing inside the server's own SELECT→UPDATE window, and cannot catch a lost update across an operator's read → edit → submit cycle                          | the same two call paths                                                                |

The fourth row is why "there is no concurrency detection at all" would be the
wrong summary, and the fifth is why "the record is protected" would also be
wrong. From the client's position the result is **last-writer-wins**.

### Why `P1-27-INT-009` is not a blocker under the exact canonical wording

`P1-27-INT-009` is correct and is not disputed. It is not a blocker because
nothing in the canonical wording asks this phase for the thing it records as
missing:

| canonical sentence                                                                                                                 | what it asks for                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §5.3 — `P1-27-QA-004` **"Concurrency and idempotency"**                                                                            | A task title. It names no mechanism. "Optimistic concurrency", "record version", "If-Match" and "ETag" appear nowhere in `canonical-plan.md` as a P1-27 deliverable                                    |
| §10 — what every Frontend task owes: "… **conflict where applicable** …"                                                           | Conflict handling, qualified. It is applicable and it is delivered: ten catalog codes answer 409 and the client selects its sentence from `problem.code`, not from the kind                            |
| §6 — each test id "will expand into the required path matrix (… conflict, duplicate, **stale version**, **concurrent update**, …)" | A per-task **test** path matrix. A test path cannot manufacture a server capability, and the same matrix lists `timeout` and `cancellation`, which are likewise conditions tested where they can occur |
| §4 — "**No new Backend feature development is allowed inside the P1-27 Frontend branch.**"                                         | The prohibition that decides it. See below                                                                                                                                                             |

### Why this could not be built here

Registering `veh.vehicle-update` or `crm.preference-set` `versionGuarded: true`
is a **Backend route declaration**, plus a repository predicate, plus a service
signature that accepts a caller version, plus an OpenAPI change. None of it
exists in `apps/web`, and §4 forbids putting it in this branch. §9 makes the
same point structurally: `apps/api/src/**` and `supabase/**` require
`APPS_API_EXECUTABLE_DIFF=0` at merge.

A Frontend-side version check would be worse than the honest absence. The server
does not apply it, so it would refuse saves the platform would have accepted
while still losing every update the platform actually loses — a check that
changes who is inconvenienced without changing what is lost.

This is the method `canonical-plan.md` §7 already uses for exactly this shape of
gap. `FE-020` is recorded there as: a dedicated VIN verification workflow "is
Backend feature work and is **out of P1-27 scope**", with the truthful subset
shipped instead. `P1-27-OD-005` is that ruling applied to concurrency.

### What the interface does today

| behaviour                           | detail                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `If-Match` is ever sent          | Zero CRM and zero Vehicle adapters pass `ifMatch`. The four P1-26 administration adapters that do send it call routes that **are** guarded                                                |
| `recordVersion` is shown, not spent | The customer and vehicle detail reads publish it and the handler emits an `ETag`. It is displayed as a record fact. Both contracts say in the type that it is **published and not used**  |
| One 409 claims a concurrent edit    | `ERR-CON-001` → "Someone else changed this", which is true when it is shown. The other nine 409 codes → "This change cannot be saved", which states the refusal without inventing a cause |
| A bare 409 fails safe               | A conflict carrying no `code` gets the sentence that claims nothing, not the concurrency one                                                                                              |
| Nothing promises detection          | No screen, label or help text says an edit is protected against another operator's save                                                                                                   |

### The gate that stops this sentence ageing

A statement about `apps/api` written in a `docs/` file is the exact shape this
phase has repeatedly shipped as false. So this entry is **bound to executable
checks** in `apps/web/tests/api-client.test.ts`, describe
_"P1-27-QA-004 — the concurrency semantics are stated, not overstated"_:

| the check                                                                                                          | what it would catch                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| At least 20 route modules declare `versionGuarded: true`                                                           | A platform-wide rename that would make every check below pass by finding nothing                    |
| No route module the P1-27 adapters write to declares `versionGuarded: true`                                        | A Backend phase closing the gap — at which point **this entry becomes false and must be retracted** |
| None of those modules reads `expectedVersion`                                                                      | A route honouring `If-Match` without declaring itself guarded                                       |
| No CRM or Vehicle adapter passes `ifMatch`                                                                         | A Frontend edit that starts sending a header the route discards                                     |
| Over the 409 set **derived from `catalog.ts`**, only `ERR-CON-001` reaches the concurrency copy                    | A newly defined 409 code inheriting "Someone else changed this"                                     |
| This document carries `P1-27-OD-005`, the words `last-writer-wins`, `P1-27-INT-009`, an owner and this review date | This entry being deleted, renamed or left without a review date while the code still relies on it   |

The route set those checks run over is **derived from the adapters' own source**,
so a screen that starts writing to a fifth route tree brings that tree into the
check without anyone remembering to add it.

### What is needed to close it

A Backend remediation on a **separate protected branch**, per `canonical-plan.md`
§4. Specified so the integrator does not have to re-derive it:

| step                 | exactly what                                                                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mechanism            | The one already in the repository. `versionGuardFragment` for the SET/WHERE, `assertVersionMatched` for the row count, `parseIfMatch` at the edge — **no new mechanism, and no new catalog code**: `ERR-CON-001` and `ERR-CON-002` already exist and are correct |
| Routes               | `PATCH /vehicles/{vehicleId}`, `PATCH /vehicles/{vehicleId}/status`, `PUT /customers/{customerId}/status`, `PUT /customers/{customerId}/preferences` — the writes that edit a long-lived record an operator reads first                                          |
| Not routes           | Append-only sub-resource POSTs (notes, alerts, tags, contacts, addresses, consents, restrictions, ownerships, plates, odometer readings). Appending a row has no prior version to be stale against, and guarding it would demand a version for nothing           |
| Service signatures   | `changeLifecycle` and `VehicleWriteService.update` take the caller's `expectedVersion` and pass **it** to the repository instead of the value they just read at `vehicle-write-service.ts:115` / `customer-governance-service.ts:159`                            |
| Backend tests        | For each route: a stale version → 409 `ERR-CON-001`; a missing header → 428 `ERR-CON-002`; a current version → success **and `record_version` incremented exactly once**; two concurrent writers with the same expected version → exactly one wins               |
| Contract             | `versionGuarded: true` on each operation, `openapi.v1.json` regenerated — `document.ts:197` adds the `IfMatch` parameter and the 428 automatically                                                                                                               |
| Frontend, afterwards | The detail reads already publish `recordVersion`; the edit forms carry it as a hidden field and pass `ifMatch`, exactly as the P1-26 administration forms already do. `ERR-CON-001` already maps to the correct sentence, so no copy changes                     |
| This entry           | Retracted. The two `versionGuarded` checks above fail on the same commit, which is what forces it                                                                                                                                                                |

### Three Backend docblocks that describe this differently, recorded not fixed

Found while establishing the facts above. Each is in a Backend-owned file, so
none is touched here; each overstates what the code does, and a reader trusting
any of them would conclude the guard is already wired.

| file                                              | the sentence                                                                                          | why it is wrong                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `customers/[customerId]/route.ts:11-13`           | "the write routes have always demanded `If-Match`, and no operation published the value to put in it" | True of the 40 guarded routes platform-wide; **false of every CRM write route**, none of which demands it                       |
| `customers/[customerId]/preferences/route.ts:6-9` | "That version is what a client puts in `If-Match` on the PUT below"                                   | `crm.preference-set` is declared `idempotent: true` and **not** `versionGuarded`, and the handler never reads `expectedVersion` |
| `customer-governance-service.ts:16`               | "The lifecycle update carries the `record_version` **the caller's read observed**"                    | It carries `current.recordVersion`, which the service read itself at `:159`. `changeLifecycle` takes no caller version          |

These belong to P1-16 and should be corrected by the same remediation that
closes this entry, or before it if that is sooner.

### What changes when the Owner answers

| answer                                                  | consequence                                                                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ratified — last-writer-wins is acceptable for the pilot | Nothing changes in P1-27. The review date stands, so the decision is re-examined rather than forgotten                                                     |
| Optimistic concurrency is required                      | The table above is the specification. It is Backend work on a separate protected branch; the Frontend change afterwards is a hidden field and one argument |
| No answer                                               | The current behaviour stands and keeps saying what it is. Nothing is implied that is not there                                                             |

---

## `P1-27-OD-006` — alert routing, and the line between routing and paging

**Type:** engineering decision, ratification requested · **Status:** **Decided —
the routing rule is built and tested; no destination is operated and nobody is
paged**

**Owner:** Frontend, **P1-27** for the routing rule (delivered); the absent half
— an operated collector and a recipient — belongs to whoever provisions an
environment beyond Local, which **ADR-012** records as not existing.
· **Review by:** 2026-11-30

### The decision

`P1-27-DO-002` is "structured logging, monitoring and **alert routing**". The
first two words were delivered and proven in earlier waves. This entry records
what was done about the third, in two halves, because only one of them was
buildable here and saying so is the point of this document.

| half                                                     | disposition                                                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Which events leave the browser, and at what severity** | **BUILT.** `NEXT_PUBLIC_CLIENT_MONITORING_LEVEL` — a severity threshold, validated by `apps/web/src/lib/env.ts`, applied by `routesToSink` in `apps/web/src/lib/observability/client-log.ts`                 |
| **Who is woken, through what channel, on what rotation** | **NOT DELIVERED**, and not deliverable here. There is no pager, no recipient, no notification channel and no operated collector. `ADR-012` records that no environment beyond Local exists to operate one in |

### Why the first half was built rather than deferred

The `P1-20-A-06` precedent ("No alert routing") deferred routing for one stated
reason: "there is no provisioned destination to route them to, so a routing rule
written now could not be tested and would be an unverifiable claim." That reason
is **specific, and it no longer holds at this tier.** A destination mechanism
already exists in `apps/web` and is exercised by tests: a validated env-declared
sink URL, a `connect-src` derived from it in `src/lib/security/csp.ts`, a
`navigator.sendBeacon` transport injectable as a `BeaconSender`, and a production
installer that runs at module load. A threshold over that transport is decidable
from the repository's own architecture and is observable end to end — an event
either reaches the beacon or it does not.

Deferring it would have been the unverifiable claim in the other direction: a
sink that is configured receives **everything** the boundary sees, including a
`debug` line every time an operator presses Cancel. A destination with no rule
about what reaches it is a firehose, not routing.

### The rule, and where each part of it lives

| property                         | where, and what it is                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The vocabulary and its **order** | `LOG_LEVELS = ['debug', 'info', 'warn', 'error']` in `lib/env.ts` — one tuple, because the environment schema and the threshold comparison must not be two lists                                                             |
| The comparison                   | `routesToSink(level, threshold)` — **at or above**, never merely above: "alert me on warnings" must include warnings                                                                                                         |
| The rank                         | `levelRank` is `LOG_LEVELS.indexOf(level)`. Derived, so there is no second table to fall out of step with the enum                                                                                                           |
| Where it is applied              | Inside `deliveringAdapter`, the one place an event leaves the device. **Not** in `report`: the console is not egress, and a deployment's remote threshold must not remove the only local diagnostic                          |
| Unset                            | `'error'` — the **narrowest** of the four. Every event that leaves is data leaving an operator's browser, so the default is the least of it, and it is exactly the set `lib/api/client.ts` classifies as _the system failed_ |
| Invalid                          | The deployment does not boot. `z.enum(LOG_LEVELS)` refuses it and `read()` throws naming the field and never the value                                                                                                       |
| Threshold set, no sink           | Routes nothing. The URL is what installs an adapter at all, so the pair fails closed together                                                                                                                                |
| Build time, not deploy time      | `NEXT_PUBLIC_*` is inlined by `next build`. Setting it on a running deployment changes nothing until the next build — the same sentence as the sink URL, for the same reason                                                 |

### What is still absent, stated plainly

Nothing in this repository pages anybody. No recipient, rotation, escalation
policy, notification channel or on-call schedule exists, none is named in any
file, and no vendor is mentioned in either module — asserted, not merely
promised, by the case _"never claims a monitoring or notification service
exists"_. The threshold decides what **leaves**; what happens after it arrives is
a property of a collector this repository does not operate.

This is the `P1-20-A-06` shape applied to what is genuinely still missing, rather
than to the whole task: the buildable half was built, and the half that could
only have been an unverifiable claim is written down with an owner and a date.

### The gate that stops this entry ageing

Bound to executable checks in `apps/web/tests/observability.test.ts`, describe
_"alert routing — the threshold decides what leaves the browser"_:

| the check                                                                                                                            | what it would catch                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| The 4×4 level matrix, derived from `LOG_LEVELS`                                                                                      | The comparison becoming exclusive, or the tuple being reordered                                   |
| A 500 delivers, a 403 and a cancellation do not, with no threshold configured                                                        | The default silently widening — the firehose returning                                            |
| The dropped 403 still reaches the console                                                                                            | The filter being moved into `report`, taking the only local diagnostic with it                    |
| At `warn` a refusal delivers; at `debug` a cancellation delivers                                                                     | The threshold being read but not applied                                                          |
| An invalid level fails at boot, naming the field and never the value                                                                 | A typo falling back to a default, routing too much or nothing at all with nothing to say so       |
| Widening the threshold does not weaken the redaction                                                                                 | A `debug`-level event carrying what an `error`-level one may not                                  |
| The source declares `z.enum(LOG_LEVELS)`, reads `env.…_LEVEL ?? DEFAULT_ROUTING_LEVEL`, and documents the variable in `.env.example` | The variable being retyped as a second list, or the installer quietly ceasing to read it          |
| This document carries `P1-27-OD-006`, `P1-20-A-06`, an owner and this review date                                                    | This entry being deleted, renamed or left without a review date while the code still relies on it |
| Neither module names a monitoring vendor                                                                                             | A capability being asserted in prose that the code does not have                                  |

### What changes when the Owner answers

| answer                                                   | consequence                                                                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ratified — routing without paging is right for the pilot | Nothing changes. The review date stands, so the second half is re-examined rather than forgotten                                                                        |
| A collector and an on-call destination are provisioned   | The threshold is already the switch: set the two variables for the build. What is then needed is the destination's own routing policy, which is not a `apps/web` change |
| No answer                                                | The rule stands at its closed default: faults leave if a sink is configured, and nothing at all leaves if one is not                                                    |

---

## `P1-27-OD-007` — what `DOC-001` is judged on, and what §6's eighteen paths oblige

**Type:** a reading of the canonical wording, ratification requested ·
**Status:** **Decided — `DOC-001` is judged on synchronization; the eighteen-path
matrix stays undischarged, gated, and owned elsewhere**

**Owner:** Frontend, **P1-27** for the reading and for keeping the path record
true; the outstanding paths themselves belong to the Frontend task ids that carry
them and, for the two absent ones, to the Backend remediation `P1-27-OD-005`
names. · **Review by:** 2026-11-30

### The decision

`P1-27-DOC-001` is judged on its canonical name — "Contract, catalogue and
traceability **synchronization**" — and **not** on whether
`canonical-plan.md` §6's eighteen-path matrix has been expanded for each of the
twenty-nine Frontend test ids.

**This decision changes no measurement.** `matrixDischarged` stays `false`, every
per-path status stays exactly as measured, and the outstanding paths stay visible
as findings. It settles which task those paths are charged to, and nothing else.

### The two readings, both stated

| reading                       | what it says                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per-id** — held until now   | §6's "each will expand into the required path matrix" is an obligation **per test id**. Twenty-nine ids × eighteen paths = **522** expansions. `DOC-001` cannot pass until they exist, and a surface-wide table of thirteen `PROVEN` rows is not twenty-nine expansions                                               |
| **Synchronization** — adopted | `DOC-001`'s requirement is its name in §5.3. Its three conjuncts are contract, catalogue and traceability, and each is satisfied when the **record matches the tree**. §6 is a test-id **numbering** rule; its closing sentence is the rationale for granular ids, and the obligation it describes is not `DOC-001`'s |

### Why the synchronization reading is adopted — four checks, and one that failed

Recorded with the check that failed included, because an entry that only lists
its supporting evidence is the shape this phase has repeatedly shipped as false.

| check                                                        | result                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **§6's subject**                                             | **Holds.** §6 is titled "Test references — correction F". It opens on the id-numbering defect ("The previous plan alternated `TC-CRM-001` and `TC-VEH-001` **mechanically**") and its corrected rule is three bullets about which catalogue an id comes from. The eighteen-path sentence is the section's closing rationale |
| **Whose obligation §6 states**                               | **Holds, and this is the load-bearing one.** "Each id above is **one per task**" — the ids in §6 are the **test ids of the twenty-nine Frontend tasks**. §5.3's table has two columns, id and canonical name, and assigns `DOC-001` **no test id at all**. An expansion of test ids cannot be `DOC-001`'s deliverable       |
| **Where the plan states per-task obligations**               | **Holds.** The plan has a dedicated section for that, §10 "What every Frontend task owes", and its list is **different and shorter** — and carries the qualifier "conflict **where applicable**". The eighteen-path list is not §10                                                                                         |
| **Any other canonical text binding the matrix to `DOC-001`** | **None.** `canonical-plan.md` names `DOC-001` exactly once, at `:192`, in §5.3's table, by name only. Every other occurrence of "path matrix" in this phase is in this phase's own derived records, which describe the judgement rather than set it                                                                         |
| **"§6 is not written as an acceptance criterion at all"**    | **FAILED, and the reading is narrowed rather than rescued.** `P1-27-OD-005` above already reads the same sentence as asking for "a per-task **test** path matrix". §6 may well be an acceptance criterion — **for the twenty-nine Frontend test ids**. What it is not is `DOC-001`'s                                        |

### The sibling precedent, which is the strongest evidence here

Three closed Backend phases carry the same task under the same name, and not one
was judged on path coverage.

| phase     | what discharged its `DOC-001`                                                                                                                                                                                                                         | verdict       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **P1-19** | `evidence/errors-and-events.md` plus the **generated** `endpoint-inventory.md` and `task-traceability.md`. Its owner gate item 14 uses the word "synchronized"                                                                                        | **Delivered** |
| **P1-20** | `docs/api/openapi.v1.json`, the live permission catalog, the **generated** inventories and registers. Its completeness audit's one `DOC-001` GAP was a record naming two paths that were never shipped — a record-versus-tree mismatch, rated **Low** | **PROVEN**    |
| **P1-24** | The **generated** `evidence/operation-register.md` and `task-traceability.md`                                                                                                                                                                         | **Complete**  |

And the converse: where a sibling phase did own a path-coverage obligation, it
filed it under **QA**, not documentation — `P1-20-QA-002` is recorded against
"§QA-002 — **error-path matrix**". In this phase the same paths are already
charged to the tasks that name them: `stale version`, `concurrent update` and
`idempotent replay` are `QA-004` "Concurrency and idempotency", `scope denial` is
`QA-003` "Tenant / company / branch isolation", `timeout` and `cancellation` are
`QA-002` "API contract and error-path coverage". Holding `DOC-001` for them
charges the same paths twice.

### The reductio, recorded as corroboration and not as the argument

Under the per-id reading `DOC-001` requires 522 expansions, and **58 of them are
forbidden by the plan that is said to require them**: `stale version` and
`concurrent update` are `ABSENT` for every one of the twenty-nine ids because no
route under `customers/`, `customer-duplicates/`, `vehicles/` or
`vehicle-duplicates/` is `versionGuarded` — and §4 states "**No new Backend
feature development is allowed inside the P1-27 Frontend branch.**" A further
twenty-nine turn on a cancel affordance no canonical document specifies.

This is corroboration, not the argument. A plan **may** contain an over-ambitious
task, and impossibility alone would not prove a misreading. What it adds is that
the per-id reading makes one section of the plan require what another section
forbids, which the synchronization reading does not.

### What is true of the path record, and stays true

Unchanged by this decision, and stated here so the entry cannot be read as
retiring it:

| fact                                                                                                                                         | where                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **13 `PROVEN` · 3 `PARTIAL` · 2 `ABSENT`**, measured across the whole CRM and Vehicle surface, not per id                                    | `evidence/test-catalogue-traceability.json` `pathMatrix`; §4 of the companion `.md`                                                                      |
| `matrixDischarged` is **`false`**, and `check-p1-27-doc-counts.mjs` fails on any other value                                                 | `scripts/ci/check-p1-27-doc-counts.mjs`                                                                                                                  |
| The three `PARTIAL` are `scope denial`, `idempotent replay` and `cancellation`; the two `ABSENT` are `stale version` and `concurrent update` | the same record, each with its reason, which the gate also requires                                                                                      |
| Nothing here establishes that eighteen paths exist for twenty-nine ids, and no document claims it does                                       | `evidence/test-catalogue-traceability.md` §4: "Building them is Frontend work with its own tasks; it is not something a documentation change may assert" |

`DOC-001` passing means **the records match the tree, including where the tree is
incomplete**. It does not mean the matrix is discharged, and any reader who takes
it that way is contradicted by the row's own figures.

### The gate that stops this entry ageing

A decision recorded only in prose is one edit away from being a decision nobody
made. Bound to executable checks in
`apps/web/tests/p1-27-doc-reconciliation.test.ts`, describe _"`P1-27-OD-007` —
what `DOC-001` is judged on"_:

| the check                                                                                                      | what it would catch                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This entry, **sliced from its own heading to the next**, carries `P1-27-OD-007`, an owner and this review date | The entry being deleted, renamed or left undated — scoped to the entry, because a file-scoped assertion passed when OD-006's own owner line was deleted and a sibling supplied the substring |
| The slice states **both** readings and names the check that failed                                             | The entry decaying into the conclusion alone, with the argument against it edited out                                                                                                        |
| `matrixDischarged` is still `false` in the catalogue record                                                    | The decision being read as licence to discharge the matrix                                                                                                                                   |
| The `pathMatrix` still measures **13 / 3 / 2**, and the five non-`PROVEN` rows are still the five named here   | The paths being quietly upgraded to make the row tidier                                                                                                                                      |
| `DOC-001`'s matrix row cites `P1-27-OD-007` and carries the true figures                                       | A `PASS` that reads as a discharged matrix                                                                                                                                                   |
| `canonical-plan.md` §5.3 still assigns `DOC-001` no test id                                                    | The premise of the load-bearing check changing under the decision without the decision being revisited                                                                                       |

### What is needed to close it

The Owner or the register owner ratifies the reading, or rejects it. If it is
rejected, `DOC-001` returns to `PARTIAL` with the per-id reading as its binding
reason, and the 522 expansions become scheduled Frontend work with the fifty-eight
Backend-blocked cells routed by `P1-27-OD-005`.

### What changes when the Owner answers

| answer                                          | consequence                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ratified — synchronization is the right reading | Nothing changes. The review date stands, so the outstanding paths are re-examined rather than forgotten, and they remain charged to `QA-002`, `QA-003` and `QA-004` |
| Rejected — the obligation is per id             | `DOC-001` returns to `PARTIAL`. The path record does not move either way, because it was never what this decision was about                                         |
| No answer                                       | The reading stands as recorded, held by the checks above, and the path record stays exactly as measured — `matrixDischarged` `false` and five paths not `PROVEN`    |

---

## What this document does not establish

| not established                                                                                                           | what would establish it                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any definition — statement, owner, decision-maker or date — for `P1-OD-017` or `P1-OD-025`                                | The canonical Word documents outside this repository. `docs/` holds dispositions only, at the four locations named under each entry                                                                                                                                        |
| Which `P1-OD-###` number is free, and therefore what the vehicle reference-data decision will be called                   | The register owner, in the canonical Word documents. `P1-OD-042` is only the highest number `docs/` treats as an existing decision, and `P1-OD-043` is already _referenced_ as a suggestion at `provider-evaluation.md:486`                                                |
| The contents of the Owner's §9 fourteen-section list                                                                      | The Owner's instruction document. Five P1-27 records repeat the count and not one of them lists a single section                                                                                                                                                           |
| Whether the seven orphaned merge message keys and the two merge permission constants should be deleted or kept ready      | `P1-OD-017`. Deleting them now would destroy the shape of the answer if the answer is "build it"                                                                                                                                                                           |
| Whether a candidate count is wanted enough to pay for a counting query on every page                                      | An Owner direction. No volume figure exists in this repository to reason from, and none may be fabricated                                                                                                                                                                  |
| Which Frontend phase owns documents                                                                                       | A Product Owner scope decision. `docs/product/README.md` §6 records that no repository record names one                                                                                                                                                                    |
| Any price, recurring cost, evaluation budget, rate limit, service level or coverage figure for any vehicle-data candidate | A written vendor quotation, and the spike in `provider-evaluation.md` §13. Nothing in this repository supplies one, and a number heard in a call is not evidence                                                                                                           |
| Whether any of the 176 planning findings in `docs/product/README.md` §3 is in Phase 1 scope                               | A Product Owner scope decision against the canonical Phase 1 plan. None of them is an entry in the live `P1-27-INT-###` register                                                                                                                                           |
| The hosted-CI result of **PR #202**, and whether the current `develop` head is its merge commit                           | The GitHub pull-request record. `deliverable-manifest.md` §4 names its branch, head and resulting `develop` SHA, and §4.1 gives its scope as documentation only; `risk-register.md` §10 records the remainder as not established. No decision in this document rests on it |

---

## Where this document sits

| record                                                                         | what it is for                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [`canonical-plan.md`](canonical-plan.md) §7                                    | The disposition of `P1-OD-017` and `P1-OD-025` that this phase built to                    |
| [`owner-acceptance-fail-remediation.md`](owner-acceptance-fail-remediation.md) | The Owner's `FAIL`, the eleven defects, and what is deliberately still absent              |
| [`findings.md`](findings.md)                                                   | The live `P1-27-INT-###` register                                                          |
| [`task-register.md`](task-register.md)                                         | What each task delivered, and what each wave refused to build                              |
| [`deliverable-manifest.md`](deliverable-manifest.md) §4, §4.1                  | The five merges, their branches, heads and resulting `develop` SHAs, and what each carried |
| [`risk-register.md`](risk-register.md) §9, §10                                 | Where this phase's own records disagree with the repository, and what is not established   |
| `docs/product/README.md`                                                       | 176 planning findings, all document-local, none scheduled, none in the register            |
| `docs/product/vehicle-catalogue/provider-evaluation.md`                        | The evaluation axes, the candidates, and the proposed decision this document requests      |
| `docs/phase-1/phase-1-1/open-decisions.md`                                     | The Phase 1-1 closure register, which holds `OIR-` identifiers and no `P1-OD-` numbers     |
| `docs/governance/canonical-documents.md`                                       | Why the canonical Word documents, not this repository, are the source of truth             |

**P1-27 closes only when the Product Owner manually tests the application and
returns `OWNER ACCEPTANCE: PASS`. Silence is not Pass.**

<!-- The gate-owned file count in this document is DERIVED. It read 40 while the
     gate reported 43 (`E-05`), in three places, after the fix that corrected the
     sentence directly above the first of them. `validate:p1-27-doc-counts`
     recomputes it from the gate's own scan roots, so the day a third tree is
     added this document follows it. The markers live here, outside every table:
     an earlier revision put them in a label column and broke two other gates
     whose regexes read the label and the number as adjacent cells. -->

<!-- derived: files p1-27-frontend-gate = 122 -->
<!-- derived: files p1-27-frontend-gate:trees = 5 -->
