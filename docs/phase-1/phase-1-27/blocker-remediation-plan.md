# P1-27 blocker remediation plan — D1, D2, D3

**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Status:** PLANNED, NOT EXECUTED · **Read at:** `develop` `131f9664` ·
**Recorded:** 2026-08-08

Three of the four Class A P1-27 blockers. The fourth — a customer-search cursor
that lost rows at a page boundary inside one millisecond — is closed and merged
(`P1-27-INT-006`, PR #209).

## The question this plan existed to answer

**Was each uncalled write a deliberate omission, or an oversight?** It decides
whether the fix is _wire the form_ or _delete the copy that promises a capability
we chose not to ship_. Getting it backwards either ships an unauthorised feature
or leaves a lie in the product, so it was not guessed.

**The answer is: wire them.** The evidence is a distinction the repository draws
itself. `evidence/task-traceability.md:262-273` records `crm.customer-merge` and
`veh.vehicle-merge` as _"Deliberately absent — P1-OD-017"_ and classifies these
seven as _"simply not built"_. `canonical-plan.md:168-171` names each of them in
the column headed "primary Backend operation(s)". None appears in the phase's only
exclusion table (`canonical-plan.md:259-268`, headed "Not an open decision — a
capability gap"), none carries an in-code refusal marker, and none has a gate rule
in `check-p1-27-frontend.mjs` — in contrast to the six rules that gate the
genuinely withheld capabilities.

So the repository does record its deliberate absences, and these are not among
them. The copy stays; the forms get built.

## Four constraints the investigation found, each of which would have broken the fix

Recorded here because the obvious implementation violates all four.

1. **No feature may import another feature.** `RecordForm` — the proven write-form
   pattern, six working instances in `CustomerProfileScreen` — lives under
   `features/crm/customers/components/`. The vehicles feature must not import it.
   The rule is written at `lib/api/read-operation.ts:12-18`, and verified: no
   cross-feature import exists anywhere in `apps/web/src/features`. So the
   component must be **relocated** to `components/forms/`, not reused in place.
2. **`new FormData()` is a gate failure inside all three scanned trees.**
   `check-p1-27-frontend.mjs:302-307` rule `no-upload-path` matches it across
   `features/crm`, `features/vehicles` and `app/[locale]/(dashboard)`. Every new
   form must use `<form action={submit}>` with `useActionState`, never a
   constructed `FormData`.
3. **No action may set `Idempotency-Key`.** The client derives it from the
   operation contract; `governance-actions.ts:40-44` records that setting one in
   an action would create a second idempotency authority. All six writes are
   `idempotent: true`.
4. **Every new label is scanned by the plain-language gate.** No visible string
   may contain `uuid`, `enum`, `null`, `boolean`, `object`, `tenant`, a permission
   code, an operation id, snake_case or camelCase. So no label may read
   "partnerId", "actorId" or `veh.vehicle.manage`.

`RecordForm` also cannot express three of the five forms as it stands — its
`FieldKind` has no number, no date, and no repeated checkbox group, and
`RecordForm.tsx:76` builds its input id without `useId`, so two instances on one
screen would collide.

## One latent defect the investigation found on the way

`CustomerProfileScreen.tsx:509-532` records that a form slot must be gated on
`table.response`, **never** on `status === 'ok'` — because `TableStatus` has no
`'ok'` member, so that comparison is always false while reading exactly like a
working fail-closed guard. The new vehicle form slots follow the same rule for the
same reason.

## How far to trust this document

Four parallel investigations — deliberateness, the vehicle UI and its existing
form pattern, the partner-name resolution, the actor-name resolution — each
followed by an **adversarial checker** briefed to refute rather than agree, and
told specifically to be hardest on any recommendation to **delete user-facing
copy**, since "no recorded decision" is not evidence of deliberate withholding.

The deliberateness verdict and the four constraints above were re-checked by hand
against the cited files. The remainder is the subagents' work: precise enough to
check, and to be checked as each step is executed, because a citation that no
longer says what it is claimed to say is the failure mode this project keeps
meeting.

Where an investigation reported "not established", the plan carries it forward as
a decision rather than inventing an answer.

---

Every path below is verified against the tree at `C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco`. Where I assert something does not exist, the proving grep is given inline.

---

## 0. Scope, branch profile, and four constraints that shape every step

**All of D1 and D3 are `apps/web`-only. D2's executable option is `apps/web`-only too.** No route file, no migration, no `docs/api/openapi.v1.json` change.

**Branch profile.** `scripts/ci/check-phase-ownership.mjs` has **no `p1-27-frontend` profile** — `:57` defines `p1-26-frontend`, `:68` `api-boundary`, `:76` `backend-login-contract`, and `:150` defaults to `p1-26-frontend`. Run under `p1-26-frontend`: its allowed buckets `['web','docs','tooling','tests','rootConfig']` (`:59`) cover everything here, and its `forbidden.apiSource` (`:61-62`) is exactly the guard that keeps a Backend change out of this branch. Adding a `p1-27-frontend` profile is optional and is itself a `tooling` file, therefore permitted.

**Constraint 1 — no feature may import another feature.** Verified: `Grep "@/features/vehicles|@/features/administration"` over `apps/web/src/features` returns **no matches**, and `Grep "@/features/crm"` over `apps/web/src` returns only `app/**` page files (`vehicles/[vehicleId]/page.tsx:10` and four siblings importing `@/features/crm/permissions`). The rule is written down at `apps/web/src/lib/api/read-operation.ts:12-18`: the three options are "import across features (which says CRM depends on Administration, and it does not), copy it … or move it here." **Consequence:** `RecordForm` lives at `apps/web/src/features/crm/customers/components/RecordForm.tsx` and the vehicles feature must not import it. It must be relocated (§1.0).

**Constraint 2 — `new FormData()` is a gate failure inside all three scanned trees.** `scripts/ci/check-p1-27-frontend.mjs:302-307` rule `no-upload-path` matches `/new FormData\(\)|multipart\/form-data|type="file"/` across `apps/web/src/features/crm`, `apps/web/src/features/vehicles` **and** `apps/web/src/app/[locale]/(dashboard)` (`SCAN_ROOTS`, `:84-88`). This paragraph said two trees and cited `:59-62` and `:92-96`; the gate was corrected to scan the third tree the canonical plan always named (`canonical-plan.md:303-305`), and every line number in it moved. It now reports `69 file(s) across 3 tree(s), 0 failure(s)`. Every new form must use `<form action={submit}>` with `useActionState` — the `RecordForm.tsx:55-69` shape — and must never construct a `FormData`. Comments are stripped first (`stripComments`, `:340-342`, applied at `:435`), so docblocks naming the operations are safe.

**Constraint 3 — no action sets `Idempotency-Key`.** `apps/web/src/lib/api/client.ts` derives it from the operation contract; `governance-actions.ts:40-44` records that adding one in an action would be a second idempotency authority. All six writes are `idempotent: true` (each route's `defineOperation`).

**Constraint 4 — new copy is scanned.** `scripts/ci/check-plain-language.mjs` (in `verify:policies`, `package.json:122`) scans every value in `en.json` and `ar.json`. Banned words that this work could reach for: `uuid` (`:57`), `enum` (`:58`), `null` (`:60`), `boolean` (`:61`), `object` (`:62`), `tenant` (`:80`), any permission code (`:83-86`), any operation id (`:89-92`), snake_case (`:97`), camelCase (`:108`), a raw key (`:116`). So no label may say "UUID", "partnerId", "actorId", "effectiveDate", or `veh.vehicle.manage`.

---

## 1. D1 — per operation

### 1.0 Prerequisite: three shared moves, done once

**(a) Relocate `RecordForm`.** Move `apps/web/src/features/crm/customers/components/RecordForm.tsx` → `apps/web/src/components/forms/RecordForm.tsx` (that directory exists: `Field.tsx`, `MoneyField.tsx`), and leave a re-export at the old path so no CRM screen changes — byte-for-byte the pattern `read-operation.ts:12-18` describes and `apps/web/src/components/duplicates/MatchExplanation.tsx` already demonstrates. Do **not** import it across features.

**(b) Extend `RecordForm`'s `FieldKind`.** Today it is `'text' | 'textarea' | 'select' | 'checkbox'` (`RecordForm.tsx:26`). Three of the five forms cannot be expressed:

- odometer needs a **number** (`odometer-readings/route.ts:37` — `value: z.number()`) and a 16–40-character timestamp (`:39`);
- plate and ownership need a `YYYY-MM-DD` **date** (`plates/route.ts:33`, `ownerships/route.ts:34`);
- `authorizePartyAction` reads a repeated group — `form.getAll('allowedActions')` (`relations-api.ts:186`) — which `RecordForm`'s single named checkbox (`:115-127`, `checked={values[name] === 'on'}`) cannot produce.

Add `'number'`, `'date'`, `'checkbox-group'`. Keep the controlled-value contract (`:54`, `:65-66`) and the clear-on-success-only rule (`:57-61`) untouched — that behaviour is the whole reason the component exists (`:8-24`).

**(c) Give `RecordForm` per-instance ids.** `RecordForm.tsx:76` is `const id = \`record-${field.name}\``with no`useId`. The relationships section needs an add form and a per-row retire control on screen at once, so two instances would collide. Use `useId()`as`VehicleProfileScreen.tsx:411` already does (`const formId = useId()`).

**(d) Give `HistorySection` a form slot.** In `apps/web/src/features/vehicles/components/VehicleHistorySections.tsx`, add to `HistorySection` (`:298-341`) the prop `readonly form?: (onRecorded: () => void) => React.ReactNode;` and render it after the footnote (`:336-338`) as `{table.response ? form?.(table.refresh) : null}` — copied from `CustomerProfileScreen.tsx:533`, including the reason recorded at `:509-532`: gate on `response`, **never** on `status === 'ok'`, because `TableStatus` has no `'ok'` member and that comparison is always false while reading exactly like a working fail-closed guard.

**(e) Thread the missing props into the three history sections.** `SectionProps` (`VehicleHistorySections.tsx:33-39`) and `OdometerProps` (`:203`) carry no permission and no frozen flag. Add them, and pass from `VehicleProfileScreen.tsx:146-161`. `frozen` is computed at `VehicleProfileScreen.tsx:101` and today reaches only `VehicleOverviewSection` (`:234-248`); every new form must be withdrawn when frozen, for the reason stated at `:237-242`.

**(f) In `apps/web/src/app/[locale]/(dashboard)/vehicles/[vehicleId]/page.tsx:109-122`, add** `canRecordOdometer={holds(session.permissions, VEHICLE_PERMISSIONS.odometerRecord)}`. The constant exists at `apps/web/src/features/crm/permissions.ts:45` and is referenced by nothing else — `Grep "veh.vehicle.odometer.record"` over `apps/web/src` returns only `permissions.ts:45` and `history-contract.ts:12`.

---

### 1.1 `veh.vehicle-plate-assign` (FE-022) — **WIRE**

**Reason.** `canonical-plan.md:168` names it in the column headed "primary Backend operation(s)". It is not in the phase's only exclusion table (`canonical-plan.md:259-268`, headed "Not an open decision — a capability gap"), it has no in-code refusal marker, and it has no gate rule (`Grep "plate-assign|ownership-transfer|odometer-record|EvProfile|authorizeParty|retireParty" scripts/ci/check-p1-27-frontend.mjs` → no matches; contrast the six live rules at `:250/:256/:279/:297/:303/:309`). `docs/phase-1/phase-1-27/evidence/task-traceability.md:262-273` classifies it as "simply not built" while recording `crm.customer-merge`/`veh.vehicle-merge` as "Deliberately absent — P1-OD-017". `owner-workflow-requirements.md:87` row 22 reads "Blocked (P1-27) — write not called", i.e. still owed.

**No adapter exists.** `apps/web/src/features/vehicles/history-api.ts` is 93 lines: one private `listHistory` (`:44-69`) and three exports (`:71`, `:79`, `:87`). No `client.send`, no `ActionState` import.

**Create — an adapter in `history-api.ts`.** Add a private `write()` and `base()` copied from `apps/web/src/features/crm/customers/governance-actions.ts:86-115` (validate → session → send → map, in that order, with the reason at `:78-85`), then:

```
assignPlateAction(vehicleId, previous, form)
  POST /api/v1/vehicles/{id}/plates
  body { countryCode, plateRaw, effectiveDate? }   // plates/route.ts:29-35
  permission veh.vehicle.manage                    // plates/route.ts:56
  successKey  vehicles.plate.assigned              // NEW key
```

`countryCode` is 2–3 characters (`route.ts:31`) and `COUNTRY_CODE_PATTERN` already exists, unused, at `history-contract.ts:58`. `effectiveDate` is a `YYYY-MM-DD` **string**, never derived from a `Date` (`history-contract.ts:19-25`).

**Edit — `PlateSection`** (`VehicleHistorySections.tsx:136-193`): pass `form={...}` to `HistorySection`, rendered only when `canEdit && !frozen`.

**Pattern copied:** `CustomerProfileScreen.tsx:604-642` (the preferences call site) — `form={(onRecorded) => <RecordForm … action={assignPlateAction.bind(null, vehicleId)} fields={[…]} />}`.

**New i18n (en + ar):** `vehicles.plate.assign` (form title/submit), `vehicles.plate.assigned` (success), `vehicles.plate.raw` (the plate field label), and a hint. The plate subject has **zero** write-side copy today: `en.json:940-943` are the four read keys.

---

### 1.2 `veh.vehicle-ownership-transfer` (FE-021) — **WIRE**

**Reason.** Same evidence class as §1.1: `canonical-plan.md:167`, `task-traceability.md:262`, `owner-workflow-requirements.md:86`.

**Create — adapter in `history-api.ts`:**

```
transferOwnershipAction(vehicleId, previous, form)
  POST /api/v1/vehicles/{id}/ownerships
  body { partnerId (uuid), ownershipKind?, effectiveDate?, transferReason? }   // ownerships/route.ts:30-37
  permission veh.vehicle.relationship.manage                                   // ownerships/route.ts:58
  successKey vehicles.ownership.transferred                                    // NEW key
```

**Gate this on `canManageRelationships`, not on `canEdit`.** `ownerships/route.ts:58` declares `veh.vehicle.relationship.manage`; `history-contract.ts:8` already writes that mapping out. Using `canEdit` would render a control for an operator guaranteed to be refused.

`OWNERSHIP_KINDS` is already declared at `history-contract.ts:39` and its three labels already exist at `en.json:937-939`, so the `select` needs no new option copy.

**Edit — `OwnershipSection`** (`VehicleHistorySections.tsx:73-134`).

**New i18n:** `vehicles.ownership.transfer`, `vehicles.ownership.transferred`, `vehicles.ownership.newOwner`, `vehicles.ownership.reason`.

---

### 1.3 `veh.vehicle-odometer-record` (FE-023) — **WIRE**

**Reason.** `canonical-plan.md:169`, `task-traceability.md:264`, `owner-workflow-requirements.md:88`. Its permission is the one the product consults nowhere (§1.0f).

**Create — adapter in `history-api.ts`:**

```
recordOdometerAction(vehicleId, previous, form)
  POST /api/v1/vehicles/{id}/odometer-readings
  body { value: NUMBER, unit, observedAt, captureMethod?, correctionOf?, correctionReason? }
  permission veh.vehicle.odometer.record          // odometer-readings/route.ts:65
  successKey vehicles.odometer.recorded           // NEW key
```

**`value` must be coerced to a number inside the action.** `odometer-readings/route.ts:37` is `z.number().min(0).max(MAX_ODOMETER_VALUE)`; a form string is a 422. Copy the coercion at `relations-api.ts:129` (`capacityRaw === '' ? null : Number(capacityRaw)`). This is the one place in this plan where a value leaves the string domain — `history-contract.ts:26-30` forbids arithmetic on **displayed** `numeric` values, and this is an input, not a display.

`ODOMETER_UNITS` (`history-contract.ts:43`), `ODOMETER_CAPTURE_METHODS` (`:47`) and `ODOMETER_ANOMALY_REASONS` (`:50-55`) all exist and are referenced only by the contract and the tests. Their labels exist at `en.json:802-805` and `:798-801`.

**Edit — `OdometerSection`** (`VehicleHistorySections.tsx:205-295`), gated on `canRecordOdometer && !frozen`.

**New i18n:** `vehicles.odometer.record`, `vehicles.odometer.recorded`, `vehicles.odometer.value`, `vehicles.odometer.unit`.

Two shape questions go to the Owner (§6.9, §6.10): whether the form offers the correction path at all, and what `observedAt` defaults to.

---

### 1.4 `veh.vehicle-ev-profile-set` / `setEvProfileAction` (FE-024) — **WIRE**

**Reason.** `canonical-plan.md:170` names it as an FE-024 primary operation. `owner-workflow-requirements.md:89` row 24: "Blocked (P1-27) — write not called". The action already exists at `apps/web/src/features/vehicles/relations-api.ts:115-151` with a `.strict()` schema at `:87-96`; `en.json:884` / `ar.json:884` `vehicles.ev.saved` "Electric-drive details saved." is referenced only from inside it (`:147`), so a success message is translated twice for a path nothing can reach. `en.json:875` `vehicles.ev.canRecord` "You can record them from this vehicle." is rendered live at `VehicleRelationsSections.tsx:58` and is false.

**Correction to the source investigation:** it is **not** true that this action is already unit-tested. `Grep "setEvProfileAction|authorizePartyAction|retirePartyAction"` over the repository returns `relations-api.ts:115/176/215` and four doc rows in `finding-phase-disposition.md` — **no test file**. `apps/web/tests/vehicle-relations.test.ts:30` imports only `readEvProfile` from `relations-api`; its cases at `:50-86` exercise `resolveOperation`/`requiresIdempotencyKey`, and the schema-shaped cases exercise `canHaveEvProfile` and `validateScope`, both pure helpers in `relations-contract.ts`. So FE-024 needs a form **and** the first tests this action has ever had.

**Edit only — `EvProfileSection`** (`VehicleRelationsSections.tsx:30-146`). It already receives `canEdit` (`:41`), and `:56-60` is that prop's **only** use in the file.

- In the `'none'` branch (`:43-62`): replace the bare `vehicles.ev.canRecord` sentence at `:56-60` with the form itself, still gated on `canEdit && canHaveEvProfile(powertrainCategory)`.
- In the `'ok'` branch (`:84-145`): render the same form **pre-filled from `state.profile`**. This is not a nicety: `relations-api.ts:107-114` records that the operation is a replace, so an omitted field is cleared and a blank form would silently erase capacity and charge port.
- Do **not** render it in the `'error'` branch (`:65-80`) — a failed read is not "no profile" (`:69-70`).
- Withdraw it when `frozen`; `EvProfileSection` does not receive `frozen` today, so add the prop and pass it from `VehicleProfileScreen.tsx:162-170`.

`EV_KINDS` (`relations-contract.ts:37`) has labels at `en.json:886-888`. `suggestedEvKind` (`relations-contract.ts:168-173`) exists, is referenced by no source file, and is the correct default for the `evKind` select — it maps the vehicle's `ev` category to the `bev` the enum actually contains (`:161-167`).

**New i18n:** a form title/submit key. `vehicles.ev.saved` becomes reachable; do not delete it.

---

### 1.5 `veh.vehicle-authorized-party-add` / `authorizePartyAction` (FE-025) — **ASK THE OWNER, then wire**

**Reason for asking.** This is the one operation of the six with **no canonical binding**. `canonical-plan.md:171` names FE-025's primary operations as `veh.vehicle-relationship-list` and `crm.vehicle-link` — not the authorized-party pair. `docs/phase-1/phase-1-27/task-register.md:128` credits FE-025 with the glob `veh.vehicle-relationship-*`, which does not match `veh.vehicle-authorized-party-*`. `owner-workflow-requirements.md:90` row 25 reads "Blocked (P1-27) — write not called; partner UUID" without naming which write — and the only write canonically bound to FE-025 is `crm.vehicle-link`. So wiring this pair is the single place in D1 where the fix could ship something unasked-for.

**Everything else points at wiring it.** The action exists (`relations-api.ts:176-207`) with a `.strict()` schema (`:153-164`). Its success and validation copy is translated in both languages and unreachable: `en.json:974` / `ar.json:974` `vehicles.relationships.authorized`, `en.json:982` / `ar.json:982` `vehicles.relationships.scopeEmpty`. `VehicleRelationsSections.tsx:265-272` threads `canManage` — resolved from `VEHICLE_PERMISSIONS.relationshipManage` at `page.tsx:115-118` — for the sole purpose of printing `vehicles.relationships.manageNote` (`en.json:977`), a sentence about who may _add_ one. `scripts/dev/owner-acceptance/context.mjs` grants the exact permission and withholds only the two merge codes.

**If the Owner says yes — edit only, `RelationshipsSection`** (`VehicleRelationsSections.tsx:149-275`): add the add-form after the scope explainer (`:261-263`), gated on `canManage && !frozen`. It needs the `checkbox-group` kind from §1.0b for `allowedActions` (`relations-api.ts:186`). `AUTHORIZED_ACTIONS` is at `relations-contract.ts:60-67` with labels at `en.json:792-797`; `validateScope` (`relations-contract.ts:124-131`) exists and is referenced by no source file — use it to complain beside the control rather than let a 422 come back.

**If the Owner says no**, delete these exact keys from **both** catalogues and apply the phase's full refusal pattern (§6, note at end): `vehicles.relationships.authorized` (`en.json:974` / `ar.json:974`), `vehicles.relationships.scopeEmpty` (`:982` / `:982`), `vehicles.relationships.manageNote` (`:977` / `:977`).

---

### 1.6 `veh.vehicle-authorized-party-retire` / `retirePartyAction` (FE-025) — **ASK THE OWNER, then wire**

Same binding gap as §1.5 and the same answer. The action is at `relations-api.ts:215-244`. **Correction to the source investigation:** it has **no** Zod schema — it validates `effectiveDate` with an inline regex at `:224` — so it is not one of the "`.strict()` schemas already covered by tests"; it has neither.

**If yes — edit `RelationshipsSection`.** This is a **row-scoped** write, so copy `VehicleDuplicateReviewScreen.tsx`: a `'retire'` column whose cell is a `<button type="button" onClick={() => setSelected(row)}>` (the shape at `:124-149`), a panel rendered `{selected ? … : null}` whose `onDecided` does `setSelected(null); table.refresh();` (`:209-220`), and a `useActionState` that clears and calls `onDecided()` only on success (`:241-248`). Offer it only for rows where `scopeState(row).kind !== 'not-applicable'` — `SCOPED_ROLE` is `'authorized_person'` (`relations-contract.ts:78`) and the schema forbids a scope on the other six roles.

**If no — delete** `vehicles.relationships.retired` (`en.json:979` / `ar.json:979`).

---

### 1.7 Raised, not in the brief's six: `crm.vehicle-link` (FE-025)

`canonical-plan.md:171` names it as an FE-025 **primary** operation and it has no adapter and no caller at all. Proof: `Grep "vehicle-link|customers/\$\{[^}]*\}/vehicles|linkVehicle"` over `apps/web` returns exactly one line — `apps/web/src/lib/api/idempotent-operations.ts:333`, the generated manifest. The contract exists: `POST /api/v1/customers/{customerId}/vehicles`, body `{ vehicleId, relationshipRole }` `.strict()`, permission `crm.customer.vehicle.manage` (`apps/api/src/app/api/v1/customers/[customerId]/vehicles/route.ts:21-41`), and `CRM_PERMISSIONS.vehicleManage` is already declared at `apps/web/src/features/crm/permissions.ts:36`. **FE-025 cannot meet its Definition of Done while its own canonically-bound write has no call site.** This is Owner decision §6.2. Note that `owner-workflow-requirements.md:130-138` defers the Customer→Vehicles **read** to P1-28 as `P1-27-INT-012`; it defers nothing about the write.

---

## 2. D2 — a partner UUID under a person-named column

### 2.1 The requirement is to resolve the name, not to relabel

`docs/product/owner-workflow-requirements.md:126-128`: "Within P1-27 the Vehicle profile shows its approved customer relationships with **human-readable customer information** and the relationship role." Relabelling satisfies row 112 ("No … UUID as a normal label") and does not satisfy `:126-128`. `finding-phase-disposition.md:368` reaches the same conclusion and treats relabelling as the cost fallback only.

### 2.2 Why the Frontend composition is the right one, and needs no authority ruling

`docs/database/veh-ownership-visibility-matrix.md` is the governing privacy authority behind FR-VEH-004 / BR-VEH-002 (`docs/phase-1/phase-1-7/phase-1-7-traceability.md:15,17`). Its rule is `:5-6` "Service history follows the Vehicle. Private party data remains governed by the CRM/Party domain." Its matrix row for a tenant employee with Vehicle read (`:49`) grants "Ownership partner UUID ✔ (opaque UUID)" and denies prior-owner CRM contact/address with the reason "**(CRM RLS + CRM permission model)**". `:36-37` assigns the narrowing job to the API layer: it "narrows further but can never widen what RLS denies."

Resolving the name **through `crm.customer-read`, on the caller's own session**, keeps the CRM permission model as the decider — exactly what `:49`'s reason column says should decide it. It widens nothing and copies nothing into `veh`, so invariant 4 (`:70`, "no prior-owner PII is copied into `veh`") is untouched. `business_partners.display_name` is classified `internal`, `searchable: true` (`docs/database/crm-personal-data-classification.json:99-101`) and appears in none of the matrix's denied columns.

By contrast, **adding `partnerName` to the vehicle projection would widen**: a caller holding only `veh.vehicle.read` would receive a CRM name. That is a genuine Owner decision against `:36-37` and is carried forward as §6.3, not decided here.

### 2.3 Exact changes

**New file — `apps/web/src/lib/api/customer-names.ts`.** It goes in `lib/api` because `read-operation.ts:20-21` establishes that as the home of the shared read helpers and the only place that may reach `authorizedClient()`; a copy in the vehicles feature would be the duplicate authority `read-operation.ts:12-18` refuses.

```
Signature:
  export async function resolveCustomerNames(
    ids: readonly string[]
  ): Promise<ReadonlyMap<string, string>>
```

Body: de-duplicate `ids`; `Promise.all` one `readOperation<{ displayName: string }>('/api/v1/customers/' + encodeURIComponent(id))` per distinct id (`readOperation` is exported at `read-operation.ts:52`); include an entry **only** for `status === 'ok'`. Never throw, never surface a failure — an id missing from the map is the only signal, and the caller renders that as unresolved.

**Edit — `apps/web/src/features/vehicles/history-api.ts:71-77` (`listOwnerships`).** After `listHistory` returns, if `status === 'ok'`, call `resolveCustomerNames(rows.map((r) => r.partnerId))` and decorate each row with `partnerName: names.get(row.partnerId) ?? null`. Return the page's own `correlationId` unchanged — do not overwrite it with a name read's.

**Edit — `apps/web/src/features/vehicles/relations-api.ts:62-85` (`listRelationships`).** Identical decoration.

**Published field name — `partnerName`, declared as Frontend-resolved.** Do **not** add it to `OwnershipHistoryEntry` (`history-contract.ts:73-81`) or `VehicleRelationship` (`relations-contract.ts:80-92`): those types document the Backend projection, and adding a field the operation does not publish would make the contract lie. Add two derived types beside them, each with a docblock saying the field is resolved by the Frontend from `crm.customer-read` and is not on the wire:

```
history-contract.ts:    export interface OwnershipHistoryRow  extends OwnershipHistoryEntry { readonly partnerName: string | null }
relations-contract.ts:  export interface VehicleRelationshipRow extends VehicleRelationship  { readonly partnerName: string | null }
```

**Edit — the two cells.** `VehicleHistorySections.tsx:87-99` and `VehicleRelationsSections.tsx:175-186`. Delete the `<code className="font-mono text-caption" dir="ltr">{row.partnerId}</code>` element **entirely** — the uuid is not kept as a fallback. Render:

```
row.partnerName ?? <span className="text-text-muted">{translate(messages, 'crm.duplicates.nameUnavailable')}</span>
```

That key already exists in both catalogues — `en.json:350` "Name unavailable", `ar.json:350` "الاسم غير متاح" — and is already used this way at `DuplicateReviewScreen.tsx:69-76` (with the reason written at `:70-72`: "an internal identifier in a name slot reads as a customer reference") and `DuplicateDecisionPanel.tsx:104`. Replace the now-false comments at `VehicleHistorySections.tsx:90-93` and `VehicleRelationsSections.tsx:178-180`.

**Edit — the two headers, because "reference" is wrong once a name is shown.** `en.json:936` `vehicles.ownership.owner` "Owner reference" → "Owner"; `en.json:978` `vehicles.relationships.person` "Customer reference" → "Customer". Both Arabic twins at `ar.json:936` and `ar.json:978`.

### 2.4 What happens when the name cannot be resolved

`partnerName` is `null` and the labelled fallback renders. **Three distinct causes collapse into one null** and this must be stated in a comment rather than papered over: the caller lacks `crm.customer.read`; the partner is soft-deleted or merged away (`customer-read-repository.ts` carries `AND p.deleted_at IS NULL AND p.merged_into_id IS NULL`, so `crm.customer-read` 404s a merged prior owner, which the ownership schema explicitly anticipates — `supabase/migrations/20260720099000_veh_ownership_history.sql:112` resolves `veh.owner_at` through `crm.resolve_partner_survivor`); or the read failed transiently. This is the same ambiguity `apps/api/src/modules/crm/data/customer-identity-repository.ts:243-248` tolerates deliberately for the duplicate queue — "a null name beside a live id, which is the honest state". Never fall back to the uuid, and never hide the row.

### 2.5 Does the operation's permission list change? **No.**

No route file is touched. `veh.vehicle-ownership-history` keeps `['veh.vehicle.read']` (`ownerships/route.ts:45`) and `veh.vehicle-relationship-list` keeps `['veh.vehicle.read']` (`relationships/route.ts`). The extra authority required is the **caller's own** `crm.customer.read`, evaluated by the CRM operation on its own request. Therefore `docs/api/openapi.v1.json` `x-required-permissions` (`:12704`) and the P1-24 register are untouched.

### 2.6 The cost, stated honestly

`crm.customer-read` declares `rateLimitPolicy: 'expensive-read'` (`apps/api/src/app/api/v1/customers/[customerId]/route.ts:39`), whose comment at `:35-38` records the intent: 30 requests per minute per operation per tenant per user. The default page size is 25 (`apps/web/src/components/data-table/table-state.ts:82-86`, `DEFAULT_PAGE_SIZE = 25`), so one page costs **one request per distinct partner on that page** — worst case 25 of a 30-per-minute bucket, and a second page in the same minute would 429. A 429 maps to `unavailable` (`read-operation.ts:43`) and, inside the resolver, simply to an absent map entry, so the page still renders with the labelled fallback. De-duplicating distinct ids is what keeps this bounded; nothing in the repository can tell us how many distinct partners a real vehicle has, because no business data ships. **The durable answer is the Backend projection** — `docs/product/workshop/vehicle-history-model.md:995` (`VHM-13`) prescribes exactly this shape, "Publish a bounded batch read, or include a display name on history projections" — and it must not ride this branch (§6.3, §6.4).

---

## 3. D3 — an actor UUID under "Recorded by" / "Changed by"

### 3.1 A name source IS reachable, and the record's stated reason for refusing it is false

`finding-phase-disposition.md:374` says "a CRM or Vehicle operator need not hold `iam.user.read`, so it would produce a denial, not a name." That premise is false as the product is built: `iam.auth-session` itself declares `permissions: ['iam.user.read']` (`apps/api/src/app/api/v1/auth/session/route.ts:31`), and `requireSession()` is "the only entry point protected pages use, so no page can accidentally render without one" (`apps/web/src/features/authentication/api/session.ts:101-107`), with the 403 lockout recorded as `P1-26-F-022` at `:57-71`. `scripts/dev/owner-acceptance/context.mjs:111-112` states the consequence outright: "`iam.user.read` is not optional: `GET /api/v1/auth/session` declares it, and without it every screen renders as though the caller were signed out." So every operator who can _see_ these two columns already holds the permission. **This sentence must be corrected in the record as part of the change**, so nobody re-derives the wrong reason.

### 3.2 The honest resolution inside P1-27 is nevertheless to stop asserting a person

Three reasons, each checkable:

1. **No Owner requirement demands a human-readable actor.** `Grep -i "actor|human-readable|readable" docs/product/owner-workflow-requirements.md` returns `:80` and `:94` (both merely stating the defect), `:110`, `:127`, `:162`, `:256`, `:259`, `:325`. Only `:127` demands human-readable information, and it is about the **customer** on the vehicle. The asymmetry with D2 is in the record, so treating them differently is faithfulness, not inconsistency.
2. **The canonical record assigns the fix to the Backend.** `docs/product/workshop/vehicle-history-model.md:995`, `VHM-13`: owning Backend phase **P1-14**; Frontend owner "Cross-cutting … No single owner is established, and none should be invented — **the fix belongs on the Backend projection**"; required action "Publish a bounded batch read, or include a display name on history projections." `:584-586` records that no batch resolution operation exists.
3. **The client-side resolution has three real costs, none of them the permission.** (a) `iam.user-list` publishes `email` for every user in the tenant — `UserView.email` at `apps/api/src/modules/iam/application/user-administration-service.ts:40`, and that column is commented "Restricted classification" at `supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:102`. Resolving names that way pulls the tenant's whole email list into a render that needs only names. (b) The only existing web adapter, `listUsers`, sits at `apps/web/src/features/administration/users/api.ts` and using it would be the **first** breach of the no-cross-feature-import rule (§0, Constraint 1). (c) `iam.user-detail` is one request per distinct actor.

### 3.3 Exact changes

**`apps/web/src/features/vehicles/components/VehicleAttributeHistorySection.tsx`.** The cell at `:125-129` is already correct — a de-emphasised `<code className="font-mono text-caption text-text-secondary" dir="ltr">` — and the comment at `:123-124` already reasons the position out. Only the header lies. Change `en.json:900` `vehicles.history.actor` from "Changed by" to a labelled reference in the shape the vehicle sections already use ("Owner reference" / "Customer reference"), e.g. **"Staff reference"**, and the Arabic twin at `ar.json:900`. Extend the comment at `:123-124` to say the label now matches and that the name is owed by `VHM-13` (P1-14).

**`apps/web/src/features/crm/customers/components/CustomerProfileScreen.tsx:1273-1284`.** Two changes, because this one is worse than the vehicle one: (a) change `en.json:320` `crm.customers.timeline.actor` from "Recorded by" to the same labelled reference, plus `ar.json:320`; (b) the non-null branch at `:1279` renders `row.actorId` as **bare text** — wrap it in the same de-emphasised `<code className="font-mono text-caption text-text-secondary" dir="ltr">`. **Keep the null branch exactly as it is** (`:1279-1283`, `crm.customers.timeline.system` at `en.json:325`): `crm.timeline_events.actor_id` is nullable and "the system expired this consent" is genuinely not "somebody withdrew it" (`:1276-1277`). `veh.vehicle_attribute_history.actor_id` is NOT NULL, so the vehicle side has no such case.

**Correct the record.** Rewrite `finding-phase-disposition.md:374`'s permission premise per §3.1, keeping its cost objection (an N+1 is still an N+1) and adding the two costs it missed (tenant-wide email; the feature-boundary breach).

**Raise, do not close, `VHM-13`.** It stays open against P1-14 (`vehicle-history-model.md:995`), now with the fact that the permission is already universally held — which removes the only stated obstacle and makes it cheaper than the record implies.

### 3.4 My reading on the Administration audit log

**It is not part of D3, but it is in scope for closing Owner requirement row 112 — and that is a scheduling question, not a technical one.**

Not part of D3: different screen, different permission (`iam.audit.view`, checked at `apps/web/src/app/[locale]/(dashboard)/administration/audit-log/page.tsx:35`), different phase (P1-26), and its own contract forbids the enrichment D3 would otherwise imply — `AuditLogScreen.tsx:23-26`: "this screen renders exactly what the operation returned — it does not reconstruct, join or enrich", with the matching no-export refusal at `:28-33`. Its neighbouring columns are deliberately technical identifiers in `<code>` (`action` `:83`, `entity`/`entityId` `:88-95`, `correlationId` `:100-105`), so a raw actor id is coherent there in a way it is not under "Recorded by".

In scope for row 112: that row sits in the "Shared UX the Owner corrected" table, which `owner-workflow-requirements.md:101-102` says is "P1-26/P1-27 **shared foundations** … re-verified at every P1-27 acceptance." Its status is "Blocked (P1-27) — three surfaces show a raw UUID". `audit.column.actor` is **"Who"** (`en.json:80`; `ar.json:80` "المنفّذ", "the performer") — the most person-named header in the product — over a raw uuid at `AuditLogScreen.tsx:77-79`. And the table ignores an `actorKind` its own detail drawer already uses: `:174` renders `detail.actorId ?? detail.actorKind`, and `actorKind` is on the wire (`apps/web/src/features/administration/audit/types.ts:28`). So the fix is two lines of copy plus surfacing a field already published — `apps/web`-only, no Backend change, and therefore able to ride this branch if the Owner wants row 112 closeable. **Recommendation: fix it here, file it as a low-severity P1-26 finding, and do not let it gate D3.**

**Also flag the arithmetic.** Row 112 says "three surfaces"; the files actually rendering a raw uuid under a person-named header are four — `VehicleHistorySections.tsx:96`, `VehicleRelationsSections.tsx:183`, `CustomerProfileScreen.tsx:1279`, `VehicleAttributeHistorySection.tsx:127` — plus the audit log at `AuditLogScreen.tsx:78`. Reconcile the count before the gate record is written (§6.7).

---

## 4. Registry and gate obligations

### 4.1 What does NOT change, and the proof

Every artefact below is derived from `apps/api/src` route registrations, and no step in §1–§3 touches a route file.

| artefact                                                        | why untouched                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/api/openapi.v1.json`                                      | Regenerated from the operation registry and compared (`scripts/ci/check-route-registry-parity.mjs:5-6`). No `defineOperation` changes. For reference, `veh.vehicle-relationship-list`'s 200 schema is `{"type":"object"}` (`:12734-12738`), so even a Backend field addition would not change the document — but a **permission** change would change `x-required-permissions` at `:12704`. |
| `docs/phase-1/phase-1-24/evidence/operation-register.{json,md}` | Emitted from the registry by `scripts/p1-24-operation-register.mjs`; `validate:p1-24-register` is in `verify:contracts` (`package.json:120`).                                                                                                                                                                                                                                               |
| `apps/web/src/lib/api/idempotent-operations.ts`                 | **Generated** — `validate:idempotent-operations` is `generate-idempotent-operations.mjs --check`. Never hand-edit. All six operations are already present (the three `veh` history writes at `:1220/:1232/:1244`; `crm.vehicle-link` at `:333`).                                                                                                                                            |
| coverage manifest                                               | `scripts/check-operation-test-coverage.mjs:19-27` derives obligations from each operation's own `defineOperation`. No registration changes ⇒ no new obligation.                                                                                                                                                                                                                             |
| the six classification JSONs                                    | `verify:classifications` (`package.json:119`) inspects database columns; `scripts/check-veh-classification.mjs` queries `information_schema.columns`. It cannot see a response payload.                                                                                                                                                                                                     |
| any pinned count                                                | The `scripts/ci` directory holds 40 `.mjs` files today. No new script is added, and `Grep "scripts/ci                                                                                                                                                                                                                                                                                       | readdirSync" apps/web/tests/vehicle-contract.test.ts`returns no matches — no web test pins the count.`validate:command-coverage` only fires if a new npm script is added; none is. |

### 4.2 What DOES apply

| gate                                                                 | obligation created by this change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate:p1-27-frontend` (`verify:web`, `package.json:124`)         | Rule `no-upload-path` (`:302-307`) — no `new FormData()` in any of the three scanned trees. Rule `no-client-asserted-scope` (`:278-295`) — no new field named `tenantId`/`companyId`/`branchId` or their snake forms, judged positionally by `assertedScopes()` (`:224-246`), so displaying a server-resolved scope is not a failure. Rule `no-invented-total` (`:296-301`) — the decorated rows add no count. Comments are stripped (`stripComments`, `:340-342`, applied at `:435`), so the docblocks in §1 and §2.3 are safe. Every rule fails if it inspects zero files (`:440-442`), so the scan roots must keep matching. Every line number in this cell moved when the third scan root was added. |
| `validate:plain-language` (`verify:policies`, `package.json:122`)    | Every new `en`/`ar` value is scanned against the 20 rules at `check-plain-language.mjs:55-119`. Field labels must be plain English: no "UUID", no `effectiveDate`, no `partner_id`, no permission code, no operation id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/tests/i18n.test.ts`                                        | Every new key needs an `ar` twin (`:72-77`) containing Arabic script (`:91-109`), non-empty (`:79-89`), with a dotted namespace (`:112-116`). Every **deleted** key must be deleted from both.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `validate:web-tokens` / `-theme` / `-brand` (`package.json:112-114`) | New markup must reuse existing token classes verbatim. Copy the class strings from `RecordForm.tsx:106/126/139/152/175` and the existing sections; introduce no new colour name (the P1-27 trap where seven Tailwind colour names were used in 14 components and registered in none).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `validate:notification-authority` (`package.json:86`)                | Do **not** add a toast. Success is inline (`RecordForm.tsx:180-184`). `notifyActionResult` (`apps/web/src/components/notifications/action-notifications.ts:40`) has exactly one caller today; adding a second here would be a new authority question.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `validate:phase-ownership`                                           | Run under `p1-26-frontend` (§0). Its `forbidden.apiSource` is the guard that keeps a Backend change out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `verify:web` end-to-end                                              | `typecheck:web`, `lint:web`, `style:check:web`, `format:check:web` — and note the recorded trap that root `format:check` structurally cannot see `apps/web`; use `format:check:all` (`package.json:125`) or `format:check:web`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### 4.3 If the Owner chooses a Backend option (D2 §6.3 or D3 §3.2)

It is a **separate remediation branch**, as `#192`–`#195`, B1 and B2 were. It cannot ride this one: `p1-26-frontend` forbids `apiSource`, and `api-boundary` permits `web` (`check-phase-ownership.mjs:70`), which would defeat the split — a new profile is needed. It changes the route projection(s), regenerates `docs/api/openapi.v1.json`, regenerates both P1-24 evidence artefacts, and — if a permission is added — changes `x-required-permissions` and requires the ruling at §6.3.

---

## 5. Test plan — each item with the mutation that makes it fail

No test below is listed without its failure mode. All web tests live in `apps/web/tests/`.

### 5.1 D1 — the write adapters (`vehicle-history.test.ts`, extended)

| #   | test                                                                                                        | mutation that makes it fail                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | `assignPlateAction` POSTs to `/api/v1/vehicles/{id}/plates` with `{countryCode, plateRaw}` and no extra key | change the path segment to `plate`; add a stray key (the route Body is `.strict()`, `plates/route.ts:35`)                                                                                            |
| T2  | `transferOwnershipAction` POSTs `{partnerId, ownershipKind?, effectiveDate?, transferReason?}`              | send `ownerId` instead of `partnerId`                                                                                                                                                                |
| T3  | `recordOdometerAction` sends `value` as a **number**, not a string                                          | drop the `Number(...)` coercion — the assertion `typeof body.value === 'number'` fails, and the mutation is exactly the 422 the route's `z.number()` (`odometer-readings/route.ts:37`) would produce |
| T4  | each action returns `invalid(...)` **before** calling the client on a bad input                             | move the `parse()` call after `authorizedClient()` — `client.send` is then called and the spy count assertion fails (the ordering rule at `governance-actions.ts:78-85`)                             |
| T5  | each action returns `{status:'expired'}` when `authorizedClient()` yields null                              | make it fall through and send anyway                                                                                                                                                                 |
| T6  | `effectiveDate` is passed through as the operator's `YYYY-MM-DD` string and is **absent** when empty        | replace with `new Date(v).toISOString().slice(0,10)` — the assertion on the exact string fails for a date whose local and UTC day differ (`history-contract.ts:19-25`)                               |
| T7  | no action sets an `idempotency-key`; `requiresIdempotencyKey('POST', path)` is true for all three           | pass `{ idempotencyKey: … }` in the options — the assertion that the options object carries no such field fails                                                                                      |
| T8  | the vehicle id is `encodeURIComponent`-ed                                                                   | interpolate it raw and pass `a/b` — the path assertion fails                                                                                                                                         |

### 5.2 D1 — the three previously untested actions (new cases in `vehicle-relations.test.ts`)

These are the first tests `setEvProfileAction`, `authorizePartyAction` and `retirePartyAction` have ever had (`Grep` over the repository returns only `relations-api.ts:115/176/215` and four doc rows).

| #   | test                                                                                                                   | mutation                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T9  | `setEvProfileAction` sends `usableCapacityKwh` as `null` for an empty field and as a **number** otherwise              | change `:129` to send `''` — a `.strict()` `.positive().nullable()` field then fails and the assertion catches it                                                                          |
| T10 | `setEvProfileAction` sends `highVoltageWarning: false` when the box is absent                                          | change `:131` to `form.get(...) === 'on'` on a missing key — still false; instead mutate to `!== undefined`, which is `true` for a missing FormData key and flips a safety flag nobody set |
| T11 | `authorizePartyAction` sends **every** checked action, not just the first                                              | replace `form.getAll('allowedActions')` (`:186`) with `form.get(...)` — a two-action scope arrives as one                                                                                  |
| T12 | `authorizePartyAction` returns `fieldErrors.allowedActions === 'vehicles.relationships.scopeEmpty'` for an empty scope | drop `.min(1, …)` from `:158` — an empty array is sent and the constraint refuses it server-side instead                                                                                   |
| T13 | `retirePartyAction` encodes **both** ids and posts to `…/authorized-parties/{relationshipId}/retirement`               | drop the second `encodeURIComponent` at `:233`                                                                                                                                             |
| T14 | `retirePartyAction` sends `{}` — not `{effectiveDate: null}` — when the field is empty                                 | change `:234` to always send the key; the route's `.strict()` accepts `null`, but the DB-server-calendar behaviour documented at `:170-174` changes, and the body assertion catches it     |

### 5.3 D1 — the forms (new `vehicle-profile.dom.test.tsx`, or extend `vehicle-screens.dom.test.tsx`)

`vehicle-screens.dom.test.tsx` mocks only `@/features/vehicles/api` (`:33-35`) and `@/features/vehicles/duplicates-api` (`:36-40`) — neither `history-api` nor `relations-api` — because nothing under test calls them. Both must be mocked for these cases.

| #   | test                                                                                                                                                                                                                                                              | mutation                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T15 | **for each of the five sections:** the form is absent when the read was **denied**                                                                                                                                                                                | change the gate to `{form?.(table.refresh)}` (unconditional)                                                                                                                                    |
| T16 | **for each of the five:** the form is **present** when the read succeeded — the inverse, copied from `crm-customer-components.dom.test.tsx:210-218` and its stated reason ("Without it, a screen that never rendered any form would satisfy the assertion above") | write the gate as `status === 'ok'`, which is always false (`:526-531`) — T15 still passes and only T16 fails. **This pair is the only thing that catches the defect the CRM comment records.** |
| T17 | the plate form is absent without `canEdit`; the ownership form is absent without `canManageRelationships`; the odometer form is absent without `canRecordOdometer`                                                                                                | gate all three on `canEdit` — the ownership and odometer cases fail, which is exactly the `ownerships/route.ts:58` mismatch                                                                     |
| T18 | all five forms are absent when `isFrozen(vehicle)`                                                                                                                                                                                                                | stop threading `frozen` into the sections                                                                                                                                                       |
| T19 | the EV form is pre-filled from the current profile in the `'ok'` branch                                                                                                                                                                                           | render it blank — the assertion on the capacity input's value fails, and the mutation is the silent-erase at `relations-api.ts:107-114`                                                         |
| T20 | the EV form is absent in the `'error'` branch                                                                                                                                                                                                                     | collapse `'error'` into `'none'`                                                                                                                                                                |
| T21 | the EV form is absent for an `ice` vehicle                                                                                                                                                                                                                        | drop `canHaveEvProfile(powertrainCategory)` from the gate                                                                                                                                       |
| T22 | after a successful write the list re-reads: the `load` spy is called a second time                                                                                                                                                                                | pass a no-op instead of `table.refresh` to `form(...)`                                                                                                                                          |
| T23 | on a **failed** write the typed values survive                                                                                                                                                                                                                    | make `RecordForm` uncontrolled — the reason the component exists (`RecordForm.tsx:8-24`)                                                                                                        |
| T24 | two `RecordForm`s on screen produce **distinct** input ids                                                                                                                                                                                                        | remove the `useId` from §1.0c — `getByLabelText` then resolves ambiguously, which is the recorded `getByLabel`-matches-a-substring trap                                                         |
| T25 | the retire control is offered only for `authorized_person` rows                                                                                                                                                                                                   | drop the `scopeState` check — a retire button appears beside an owner                                                                                                                           |

### 5.4 D2

| #   | test                                                                                                                                                                   | mutation                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T26 | `resolveCustomerNames` issues **one** request per **distinct** id, given a page with a repeated partner                                                                | drop the de-duplication — the request-count assertion fails, and this is the rate-limit ceiling at §2.6                                                                                                                                                                                        |
| T27 | a name read that returns `denied` / `not-found` / `unavailable` leaves that id **out of the map**, and the page still returns `status:'ok'`                            | let a failure reject or propagate — the page becomes an error and the whole section disappears over one missing name                                                                                                                                                                           |
| T28 | `listOwnerships` and `listRelationships` return the page's **own** `correlationId`                                                                                     | assign a name read's correlationId — the assertion catches the substituted reference an operator would quote to support                                                                                                                                                                        |
| T29 | the cell renders `partnerName` when present                                                                                                                            | render `partnerId` — the assertion `queryByText(uuid) === null` fails                                                                                                                                                                                                                          |
| T30 | the cell renders `crm.duplicates.nameUnavailable` when `partnerName` is null, **and the uuid appears nowhere in the section**                                          | reintroduce the uuid as a fallback (`partnerName ?? partnerId`) — T30's negative half fails. Scope the negative to the section element, as `crm-customer-components.dom.test.tsx:189-191` does, or the profile header's own identifiers match instead and the test passes for the wrong reason |
| T31 | the two headers no longer read "reference"                                                                                                                             | revert `en.json:936` / `:978`                                                                                                                                                                                                                                                                  |
| T32 | neither vehicle route's declared permissions changed: `veh.vehicle-ownership-history` and `veh.vehicle-relationship-list` still resolve to `['veh.vehicle.read']` only | add `crm.customer.read` to either `defineOperation`                                                                                                                                                                                                                                            |

### 5.5 D3

| #   | test                                                                                                                                                                                                   | mutation                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T33 | `en.json` / `ar.json` contain no person-named header over an actor identifier: `vehicles.history.actor`, `crm.customers.timeline.actor` and `audit.column.actor` all match the labelled-reference form | revert any one of the three strings                                                                                                                                                                                                  |
| T34 | the customer timeline renders a non-null `actorId` inside a `<code>` with the muted class                                                                                                              | revert `CustomerProfileScreen.tsx:1279` to bare text                                                                                                                                                                                 |
| T35 | a **null** `actorId` still renders `crm.customers.timeline.system` and not the reference styling                                                                                                       | collapse the null branch — "the system expired this consent" becomes "somebody withdrew it" (`:1276-1277`)                                                                                                                           |
| T36 | the audit log table renders `actorKind` when `actorId` is absent, matching its own drawer at `:174`                                                                                                    | leave the `'—'` at `:78`                                                                                                                                                                                                             |
| T37 | no screen in `features/crm`, `features/vehicles` or `features/administration/audit` calls `iam.user-list` or `iam.user-detail`                                                                         | add the client-side resolution — this test is what stops the tenant-wide email exposure (§3.2 (a)) from being reintroduced quietly, and it belongs in `p1-27-security.test.ts` beside the existing duplicate-scan absence assertions |

### 5.6 Cross-cutting

| #   | test                                                                                                                                                         | mutation                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| T38 | no source file under `apps/web/src/features/*` imports `@/features/<other>`                                                                                  | import `RecordForm` from `@/features/crm/...` inside `features/vehicles` — the boundary breach `read-operation.ts:12-18` refuses |
| T39 | `evaluate()` of `check-p1-27-frontend.mjs` reports zero failures over the post-change tree, and reports a failure over a fixture containing `new FormData()` | remove the `no-upload-path` rule, or hand-roll a form that constructs FormData                                                   |
| T40 | the `en`/`ar` key sets are identical and every new Arabic value contains Arabic script (already `i18n.test.ts:72-109` — it fires automatically)              | add an English-only key, or paste the English string into `ar.json`                                                              |

---

## 6. Open decisions for the Product Owner

Each is a question the repository does not answer. None is decided above.

1. **FE-025 scope — the authorized-party pair.** Do `veh.vehicle-authorized-party-add` and `-retire` belong to FE-025? `canonical-plan.md:171` names only `veh.vehicle-relationship-list` and `crm.vehicle-link`; `task-register.md:128`'s glob `veh.vehicle-relationship-*` does not match `veh.vehicle-authorized-party-*`; `owner-workflow-requirements.md:90` row 25 says "write not called" without naming which write. This is the only point in D1 where wiring could exceed the canonical binding. §1.5–§1.6 are blocked on this answer.

2. **`crm.vehicle-link`.** It is a canonical FE-025 primary write (`canonical-plan.md:171`) with no adapter and no caller — only the generated manifest at `lib/api/idempotent-operations.ts:333`. Is FE-025 closeable without it, or is it a seventh operation in this fix? The contract and the permission constant both already exist (§1.7).

3. **D2 authority.** Frontend resolution (§2.2–§2.3: the CRM permission model still decides, nothing widens, nothing is copied into `veh`) or a Backend `partnerName` on the vehicle projection (which **would** hand a `veh.vehicle.read`-only caller a CRM name, and needs a ruling against `veh-ownership-visibility-matrix.md:5-6`, `:36-37` and `:49`)?

4. **D2 cost ceiling.** Accept one `crm.customer-read` per distinct partner per page against a 30-per-minute bucket, with the labelled fallback on a 429 (§2.6)? Or hold D2 for the Backend projection `VHM-13` already prescribes (`vehicle-history-model.md:995`)?

5. **FR-VEH-004 / BR-VEH-002 on a prior owner's name.** I read the governing matrix: `display_name` appears in **no** denied column, is classified `internal` (`crm-personal-data-classification.json:99-101`), and invariant 4 (`:70`) is untouched by read-time resolution. Confirm that naming a **prior** owner on the ownership history is intended, since a prior owner is the explicit subject of that contract.

6. **D3 acceptance.** Is a labelled staff reference sufficient for rows 15 and 29, given that no Owner requirement demands a human-readable actor and `VHM-13` assigns the name to P1-14 (§3.2)? Or must the name be resolved now, accepting the tenant-wide email exposure of `iam.user-list` (`user-administration-service.ts:40`)?

7. **Row 112's arithmetic, and the audit log.** `owner-workflow-requirements.md:112` says "three surfaces show a raw UUID"; five files do (§3.4). Which surfaces does the row count, and is `audit.column.actor` = "Who" (`en.json:80`) fixed on this branch — it is `apps/web`-only and two lines of copy plus a field already on the wire — or on a P1-26 remediation?

8. **Plate `effectiveDate`.** Expose it? `history-contract.ts:32-35` records that `active` means "not yet closed", not "in effect today", so a future-dated plate reports active before it is in force. If the form carries the field, `INT-032` requires `vehicles.search.plateHint` (`en.json:1004`) corrected in the same change.

9. **Odometer correction path.** Offer `correctionOf` and `correctionReason` (`odometer-readings/route.ts:41-42`)? Doing so means letting the operator pick a prior row — a second control FE-023 may not intend.

10. **`observedAt` default.** The route wants a 16–40 character string (`odometer-readings/route.ts:39`). Default to "now", and in whose clock? `OdometerSection` deliberately takes no `today` (`VehicleHistorySections.tsx:195-203`), and `history-contract.ts` legislates for `date` columns but is silent on `timestamptz`.

11. **EV form on a mis-categorised vehicle.** `canHaveEvProfile` (`relations-contract.ts:155-159`) hides it for `ice`, and the write would be refused anyway. An operator whose vehicle is mis-categorised has no path except editing the vehicle first, and nothing on the screen says so. Say it, or stay silent?

12. **Register identifiers.** Three of these blockers carry derived labels with no register number (`P1-27-D-CV-01`, `TRACE-09-PLATE-ASSIGN`, `HIST-NEW-01`), and `finding-phase-disposition.md:416` records that the `P1-27-INT-###` register is partly uncommitted — `findings.md` allocates only `INT-001`…`INT-009` while merged documents use `INT-010`+. Allocate real ids before the branch opens?

---

### Standing note on the delete branch

If the Owner rules any capability out of scope, the deletion must carry the phase's **own** refusal pattern in full — never a quiet removal of copy. The pattern, as actually built for the two withheld capabilities: an in-code constant naming the decision (`documents-contract.ts:75` `MEDIA_STATUS = 'blocked-on-p1-od-025'`, `:78` `MEDIA_BLOCKING_DECISION`; `duplicates-api.ts:26`); a shipped sentence telling the operator (`en.json:348`, and `VehicleDocumentsSection.tsx:110-112` "No control at all — not a disabled one"); an absent affordance, not a disabled one (`VehicleDuplicateReviewScreen.tsx:388`, and `canonical-plan.md:241-243` on why a disabled button is a false statement); a dedicated rule in `check-p1-27-frontend.mjs`; tests asserting the absence; and a new entry in `docs/phase-1/phase-1-27/open-decisions.md`. Note that two of the four genuinely deliberate refusals (`crm.duplicate-scan`, `veh.vehicle-duplicate-scan`) have **no** open-decisions entry — their deliberateness is recorded at `canonical-plan.md:268` instead — so "no entry in that register" is not by itself evidence of anything.
