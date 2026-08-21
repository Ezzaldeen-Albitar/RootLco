# P1-27 — independent 42-task audit

Derived from implementation truth at branch head `8daf8e9`, by 30 independent
agents reading the real tree, with every PASS put through an adversarial
recheck instructed to refute it. Not copied from any prior status file.

```
TASKS_AUDITED  = 42
PASS           = 20
FAIL           = 22
PASS_REFUTED   = 11
```

**P1-27 is not at 42/42.** `FE-019` is fixed in `8daf8e9`; the rest stand.

> **SUPERSEDED — read `final-task-adjudication.md` first (`A42-08`).**
>
> "The rest stand" was true when this file was written and has not been true for
> a long time. Thirty-two of the entries below have since been adjudicated and
> closed, each with its own commit and its own discriminating mutation.
>
> This audit's own headline is also weaker than it looks in the other direction:
> `PASS_REFUTED = 11` means eleven of the twenty PASS verdicts did not survive
> the recheck run against them, so the real result was **9 true pass / 33 true
> fail** rather than 20 / 22. Both corrections are in
> `final-task-adjudication.md`, which is the record of adjudication; this file is
> the record of the audit, and it is kept unedited below that line for the same
> reason a superseded measurement is kept: an audit rewritten to agree with its
> own follow-up stops being evidence of what was found.
>
> The conclusion in bold is the one thing here that later work confirmed. P1-27
> is still not at 42 of 42, for reasons this audit did not know: `DO-002` and
> `QA-004` are conjunctions delivered in part.

## Failing tasks

### P1-27-FE-002

The zero-result state makes a false claim about the tenant's data, and contradicts the screen's own correct sentence on the same screen. DataTable.tsx:279-299 chooses between `NoResultsState` ('No matches — no records match the current filters') and `EmptyState` ('Nothing here yet — Once records exist they will be listed here') by `isNarrowed(request)`, which is defined at apps/web/src/components/data-table/table-state.ts:296-298 as `request.filters.length > 0 || request.search.trim().length > 0`. `CustomerSearchResults` deliberately keeps the search criteria OUTSIDE `TableRequest` (they are closed over in the loader, CustomerSearchScreen.tsx:137-140) and mounts the hook with `INITIAL_REQUEST` (CustomerSearchScreen.tsx:142), whose `filters` is `[]` and `search` is `''` (table-state.ts:84-90). `isNarrowed` is therefore ALWAYS false on this screen, so a search for a name that matches n …

### P1-27-FE-003

NEITHER canonical operation for FE-003 has a call site on FE-003's surface. (a) `crm.duplicate-scan` (POST /api/v1/customers/{customerId}/duplicate-scans, apps/api/src/app/api/v1/customers/[customerId]/duplicate-scans/route.ts:23-37, `idempotent: true`, `auditClass: 'privileged'`) has ZERO production call sites anywhere in apps/web/src. A repository-wide grep for `duplicate-scans` returns only: the generated manifest apps/web/src/lib/api/idempotent-operations.ts:253 (explicitly excluded from reachability by docs/phase-1/phase-1-27/canonical-write-reachability.json lines 11-14), a NEGATIVE test at apps/web/tests/crm-customer-create.dom.test.tsx:294, backend routes, and documentation. (b) `crm.duplicate-list` (GET /api/v1/customer-duplicates, apps/api/src/app/api/v1/customer-duplicates/route.ts:44) DOES have a production call site — `listDuplicates` at apps/web/src/features/crm/customers …

### P1-27-FE-004

A reachable input on this form renders untranslated English library prose as a field error, in Arabic as well as English. apps/web/src/features/crm/customers/creation-actions.ts:49 declares `preferredLocale: z.string().trim().min(2).max(10).nullable()` — the `.min(2)` carries NO translation key (contrast `.min(1, 'field.required')` on the two name fields at :47-48). The `optional()` helper at creation-actions.ts:60-63 converts only an EMPTY value to `null`, so a single character survives to the schema, fails `.min(2)`, and `fieldErrorsFrom` at :65-77 stores Zod's own default English sentence as the field error. CustomerCreateScreen.tsx:351-353 renders that value through `translateDynamic`, and apps/web/src/i18n/get-messages.ts:41-43 returns the string unchanged when it is not a catalogue key. Net effect: an Arabic operator who types one character in the preferred-language box is shown …

### P1-27-FE-007

ROUTE/PAGE: rendered inside apps/web/src/app/[locale]/(dashboard)/crm/customers/[customerId]/page.tsx:35; section component `ContactsSection` at apps/web/src/features/crm/customers/components/CustomerProfileScreen.tsx:469. READ: `crm.contact-list` via `listContacts` (profile-api.ts:85-91 -> `GET /api/v1/customers/{id}/contacts`), bound at CustomerProfileScreen.tsx:478-481. Backend: apps/api/src/app/api/v1/customers/[customerId]/contacts/route.ts:40-51, `permissions: ['crm.customer.read']` at :46. WRITE — A REAL PRODUCTION CALL SITE DOES EXIST: CustomerProfileScreen.tsx:536 `action={addContactAction.bind(null, customerId)}` -> profile-actions.ts:48 `addContactAction`, POST to `${base(customerId)}/contacts` at profile-actions.ts:72-73 through `write()`/`client.send` (action-support.ts:72). Backend `crm.contact-add` at contacts/route.ts:53-66, `permissions: ['crm.customer.profile.write']` …

### P1-27-FE-008

ROUTE/PAGE: apps/web/src/app/[locale]/(dashboard)/crm/customers/[customerId]/page.tsx:35; section `AddressesSection` at apps/web/src/features/crm/customers/components/CustomerProfileScreen.tsx:571. READ: `crm.address-list` via `listAddresses` (profile-api.ts:93-99), bound at CustomerProfileScreen.tsx:580-583. Backend apps/api/src/app/api/v1/customers/[customerId]/addresses/route.ts:49, `permissions: ['crm.customer.read']` :52. WRITE — A REAL PRODUCTION CALL SITE DOES EXIST: CustomerProfileScreen.tsx:632 `action={addAddressAction.bind(null, customerId)}` -> profile-actions.ts:106 `addAddressAction`, POST to `${base(customerId)}/addresses` at :129-130 via `write()`/`client.send` (action-support.ts:72). Backend `crm.address-add` at addresses/route.ts:62, `permissions: ['crm.customer.profile.write']` :65, `idempotent: true` :69. STATES: DataTable.tsx:108/121/131/138/142/245/279-299 for the …

### P1-27-FE-009

ROUTE/PAGE: apps/web/src/app/[locale]/(dashboard)/crm/customers/[customerId]/page.tsx:35; section `PreferencesSection` at apps/web/src/features/crm/customers/components/CustomerProfileScreen.tsx:780. READ: `crm.preference-list` via `listPreferences` (profile-api.ts:101-107), bound at CustomerProfileScreen.tsx:789-792. Backend apps/api/src/app/api/v1/customers/[customerId]/preferences/route.ts:50, `permissions: ['crm.customer.read']` :56. WRITE — A REAL PRODUCTION CALL SITE DOES EXIST: CustomerProfileScreen.tsx:851 `action={setPreferenceAction.bind(null, customerId)}` -> governance-actions.ts:267 `setPreferenceAction`, method `'PUT'` to `${base(customerId)}/preferences` at :290-291 via `write()`/`client.send` (action-support.ts:72). Backend `crm.preference-set` at preferences/route.ts:66 (`method: 'PUT'`), `permissions: ['crm.customer.profile.write']` :69, `idempotent: true` :73. The FE …

### P1-27-FE-010

ROUTE/PAGE: apps/web/src/app/[locale]/(dashboard)/crm/customers/[customerId]/page.tsx:35; section `ConsentsSection` at apps/web/src/features/crm/customers/components/CustomerProfileScreen.tsx:889. READ: `crm.consent-list` via `listConsents` (profile-api.ts:109-115), bound at CustomerProfileScreen.tsx:898-901. Backend apps/api/src/app/api/v1/customers/[customerId]/consents/route.ts:59, `permissions: ['crm.customer.read']` :65. WRITE — A REAL PRODUCTION CALL SITE DOES EXIST: CustomerProfileScreen.tsx:962 `action={recordConsentAction.bind(null, customerId)}` -> governance-actions.ts:311 `recordConsentAction`, POST to `${base(customerId)}/consents` at :333-334 via `write()`/`client.send` (action-support.ts:72). Backend `crm.consent-record` at consents/route.ts:75, `permissions: ['crm.customer.consent.write']` :78, `idempotent: true` :82. FE body (governance-actions.ts:296-308) matches the …

### P1-27-FE-019

The vehicle profile route is UNREACHABLE from the product. A repository-wide grep of apps/web/src for a link or push to `/{locale}/vehicles/{id}` returns exactly two hits, both in VehicleDuplicateReviewScreen.tsx (:78 and :291) — a screen gated on `veh.vehicle.duplicate.review` (config/navigation.ts:216) that only lists existing duplicate candidates. Specifically: (a) VehicleSearchScreen.tsx:336-347 passes NO `rowActions` to DataTable, so a found vehicle cannot be opened — CustomerSearchScreen.tsx:195-203 does exactly this for customers, so the omission is an asymmetry, not a convention; (b) VehicleCreateScreen.tsx:449-519 discards `created.vehicleId` and offers only 'Add another vehicle' (:509-515) while its own copy promises the profile; (c) config/navigation.ts:200-219 exposes only `/vehicles` and `/vehicles/duplicates`; (d) the successful render of the page omits the PageHeader e …

### P1-27-FE-020

The canonical row (canonical-plan.md:166) names `veh.vehicle-create` FIRST, and the creation path has none of this. A grep for `VinField` across apps/web returns exactly one mount: VehicleProfileScreen.tsx:484 — the `veh.vehicle-update` panel. The creation form renders the VIN as a plain `TextField` (VehicleCreateScreen.tsx:172-183) with no availability check, no `validateVinFormat` and no `isNonStandardLength`; `validateVehicleCreate` (features/vehicles/contract.ts:261-302) tests only `vin.length > MAX_VIN_INPUT` -> `field.tooLong` (:264-265). Consequently on the create path (1) there is no edge format validation beyond a length ceiling, and (2) the server's uniqueness verdict — the `409 ERR-RES-002` the canonical scope note (canonical-plan.md:266) says this task delivers — reaches the operator only as the generic `state.conflict.title` = 'Someone else changed this' (client.ts:369 …

### P1-27-FE-021

The write has a production call site but is not REACHABLE by an operator. The transfer form only exists inside the vehicle profile route, and that route has no in-app entry point: a grep of all of apps/web/src for a link/push to `/{locale}/vehicles/{id}` yields only VehicleDuplicateReviewScreen.tsx:78 and :291, a screen gated on `veh.vehicle.duplicate.review` (config/navigation.ts:216) that lists only duplicate candidates. Vehicle search renders no row action (VehicleSearchScreen.tsx:336-347 passes no `rowActions`, unlike CustomerSearchScreen.tsx:195-203); vehicle creation discards `created.vehicleId` (VehicleCreateScreen.tsx:449-519); the sidebar offers only `/vehicles` and `/vehicles/duplicates` (config/navigation.ts:200-219); and the profile page's success branch omits the PageHeader/breadcrumbs entirely (page.tsx:106-129 vs the header built at :44-51). So an operator holding `veh.veh …

### P1-27-FE-022

(1) PERMISSION GATING IS ABSENT ON THE WRITE. veh.vehicle-plate-assign requires 'veh.vehicle.manage' (apps/api/src/app/api/v1/vehicles/[vehicleId]/plates/route.ts:56), but PlateSection takes no capability prop at all (VehicleHistorySections.tsx:251 destructures only {locale, messages, vehicleId, today} from SectionProps, VehicleHistorySections.tsx:48-54), and VehicleProfileScreen.tsx:170 passes none — unlike OwnershipSection (line 166: canManageRelationships && !frozen) and RelationshipsSection (lines 197-198). The form is rendered for every caller whose LIST read succeeded (VehicleHistorySections.tsx:546 `{table.response ? form?.(table.refresh) : null}`), and that list needs only 'veh.vehicle.read' — the same code that gates the whole page (page.tsx:53). So an operator holding only veh.vehicle.read is offered 'Assign plate' and gets a 403. The screen's own comment at VehicleHistoryS …

### P1-27-FE-023

(1) PERMISSION GATING IS ABSENT ON THE WRITE, and the constant that would do it is dead. veh.vehicle-odometer-record requires 'veh.vehicle.odometer.record' (apps/api/src/app/api/v1/vehicles/[vehicleId]/odometer-readings/route.ts:65). apps/web/src/features/crm/permissions.ts:45 declares `odometerRecord: 'veh.vehicle.odometer.record'` and a repository-wide grep of apps/web/src finds it referenced by ZERO call sites (only its own declaration). OdometerSection takes no capability prop (VehicleHistorySections.tsx:354) and VehicleProfileScreen.tsx:175 passes none, so the 'Record reading' form is rendered to every holder of veh.vehicle.read once the list read succeeds (VehicleHistorySections.tsx:546). The permission that governs recording mileage is strictly stronger than the one that governs reading it, and the screen does not distinguish them. (2) ZERO TEST COVERAGE OF THE WRITE: recordOdomet …

### P1-27-FE-024

(1) THE WRITE HAS NO TEST OF ANY KIND. setEvProfileAction appears in the whole test tree only as a discarded stub (apps/web/tests/vehicle-relationship-writes.dom.test.tsx:47 `setEvProfileAction: vi.fn()`, apps/web/tests/vehicle-party-identity.dom.test.tsx:42), and grepping apps/web/tests for 'EvProfileSection' returns ZERO hits. No test renders the section, so nothing proves the form appears for a veh.vehicle.manage holder, that it is withheld from everyone else, that it is withheld on an ICE vehicle, that it is seeded from the current profile (the whole point of a create-or-REPLACE operation — a blank form silently clears capacity and port), or that clearOnSuccess={false} holds. vehicle-relations.test.ts covers only the read. (2) A CLIENT BOUND CONTRADICTS THE SERVER AND SURFACES AS UNTRANSLATED TEXT. relations-api.ts:93 declares `usableCapacityKwh: z.number().positive()`, but the rou …

### P1-27-FE-026

(1) TEST COVERAGE — criterion 8 is unmet for the shipped behaviour. `listVehicleDocuments` is NOT in the 18-entry LIST_ADAPTERS table at apps/web/tests/p1-27-qa.test.ts:44-87, which asserts 'drives eighteen list adapters, not a sample of them' (:97-101) — so the phase's own error-path sweep never touches it. A repo-wide grep for `listVehicleDocuments` returns only page.tsx:8, page.tsx:103 and documents-api.ts:27 — zero tests. A grep for `DocumentsSection` returns only VehicleProfileScreen.tsx:21/:202 and the component file — the component is rendered by no test (vehicle-screens.dom.test.tsx imports only VehicleSearchScreen, VehicleDuplicateReviewScreen and VehicleAttributeHistorySection, lines 45-49). The only FE-026 tests are three constant assertions at apps/web/tests/vehicle-duplicates.test.ts:186-204 which never call the adapter or render the section. Untested as a result: th …

### P1-27-FE-029

(1) `actorName` IS NEVER PUBLISHED BY THE API, so the 'Changed by' column can never name anybody. The API projection is `VehicleHistoryHit` = { id, fieldCode, oldValue, newValue, occurredAt, actorId } (apps/api/src/modules/vehicle/domain/vehicle-history.ts:36-46) and the repository maps exactly those six fields (apps/api/src/modules/vehicle/data/vehicle-history-repository.ts:65 SELECT, :73-84 mapping) — no name, no join, no directory lookup. A repo-wide grep for `actorName|actor_name` returns matches ONLY in apps/web: duplicates-contract.ts:105, VehicleAttributeHistorySection.tsx:132 and :137, and three test mocks. There is no actor-resolution helper in the vehicle module (apps/api/src/modules/vehicle/application/ contains partner-identity.ts, which resolves ownership/relationship PARTNERS, and nothing for actors). Consequence: VehicleAttributeHistorySection.tsx:131-138 takes the `row. …

### P1-27-SEC-001

No permission gate on ten P1-27 write surfaces. `WRITE_PERMISSIONS` (apps/web/src/features/crm/customers/governance-contract.ts:142-150) has zero consumers, and `crm.customer.profile.write`, `crm.customer.consent.write`, `crm.customer.note.write`, `crm.customer.restriction.manage` and `veh.vehicle.odometer.record` (permissions.ts:25,27,28,32,45) appear in no `holds()` call anywhere in apps/web/src. Eight CRM forms (CustomerProfileScreen.tsx:530,626,845,956,1095,1218,1324,1433) render on read success alone (:774), and the plate (VehicleHistorySections.tsx:306) and odometer (:442) forms render with no permission prop at all.

### P1-27-SEC-004

apps/web/tests/p1-27-security.test.ts:314-320 fails on any POSIX runner (CI is ubuntu-latest) because apps/web/src/features/crm/customers/api.ts is matched by the `\/api\.ts$` adapter pattern yet contains no `correlationId` and does not import `./action-support`. Additionally the sweep's roots (:20,53) and the DO-001 gate's SCAN_ROOTS (scripts/ci/check-p1-27-frontend.mjs:59-62) exclude apps/web/src/components/forms/RecordForm.tsx and apps/web/src/lib/customers/directory.ts — the files that now render and carry the correlation reference — and exclude apps/web/src/features/vehicles/write-support.ts on every platform.

### P1-27-QA-001

Component/DOM tests for VehicleCreateScreen.tsx, VehicleProfileScreen.tsx, VinField.tsx, VehicleDocumentsSection.tsx, PlateSection and OdometerSection (VehicleHistorySections.tsx:251,354), and CRM DuplicateReviewScreen.tsx + DuplicateDecisionPanel.tsx. No test file in apps/web/tests imports any of them.

### P1-27-QA-002

listVehicleDocuments (documents-api.ts:27) is absent from LIST_ADAPTERS and untested against every failure kind despite carrying its own mapping at documents-api.ts:38-45; the five catalogue-api.ts adapters are covered for 1 of 11 kinds (vehicle-api.test.ts:188-196); identity-api.ts:53 listHistory has no coverage at all.

### P1-27-QA-005

No clean-room or hosted-CI evidence for HEAD d0a6008 (or PRs #200/#201/#202); clean-room-evidence.md:18,27 still pins e14984e and 763/38 while the tree is 47 commits and 5 test files further on. No test reconciles the recorded SHA or counts against the repository, no assertion covers the 13 non-FE task ids, and no checksum/digest manifest exists under docs/phase-1/phase-1-27/evidence/.

### DOC-001

THREE concrete, verified desynchronizations at head d0a6008: (1) The gate DOC-001 names as its own proof is RED right now. I ran `npx vitest run tests/ci/documented-counts.test.ts` -> "Test Files 1 failed | Tests 1 failed | 3 passed". Exact failure: `the record must state: **41 scripts in \`scripts/ci\`**: expected ... to contain '**41 scripts in `scripts/ci`**'`. Confirmed by hand: `(Get-ChildItem scripts/ci -Filter *.mjs).Count`= 41, while docs/engineering/ci-automation/pull-request-body.md:63 still reads "**1 composite action**, **40 scripts in`scripts/ci`**". This test is in the root unit tier (`verify:repository`), so a required aggregate is red on the branch under audit. findings.md:554-557 cites this exact test as "`DOC-001` working as designed"; it is currently failing and the record was not updated. (2) evidence/task-traceability.md:247-273 — the table headed "Operations att …

### DOC-002

FOUR items, each verified against files: (1) THE CHANGE LOG DOES NOT EXIST. The task is "Operator / developer guidance AND change-log update". A recursive search of docs/ for `*change-log*` returns ten files, none of them under phase-1-27: phase-1-19/evidence/change-log.md, phase-1-20/evidence/change-log.md, phase-1-21/evidence/change-log.md, phase-1-6/7/8/9/10/11 and phase-1-15. docs/phase-1/phase-1-27/evidence/ contains exactly one file, task-traceability.md. There is no root CHANGELOG. The sibling phases prove the convention: scripts/p1-20-endpoint-inventory.mjs:463-464 and scripts/p1-21-endpoint-inventory.mjs:697-699 bind the identically-titled task to `evidence/change-log.md`. P1-27 shipped no such artefact and no document records a decision to drop it. (2) NO AUTOMATED PROOF, AND THE REGISTER CLAIMS OTHERWISE. task-register.md:142 lists DOC-002's evidence as "`p1-27-qa.test.ts` — …

## Passes that did not survive the adversarial recheck

- **P1-27-FE-001** — REFUTED. Most of the prior evidence checks out (route, read operation, backend contract, permission gating, i18n, cursor/race handling), but two of its load-bearing claims do not survive the files, and one of them is a real production defect the prior audit never inspected. FINDING 1 — the post-search EMPTY state is rendered with the wrong message, and the correct state is structurally unreachable. The prior evidence enumerates loading/denied/unavailable/expired/not-found/error plus the _idle_ empty, and never establishes what the screen shows when a search returns zero rows. It shows this: …
- **P1-27-FE-013** — REFUTED on criterion 8 (test coverage). The cited test exercises a function no production code calls, and would pass with the write feature deleted. FALSE CLAIM: "TESTS: crm-governance-writes.test.ts:164-173 (two-character floor on segmentCode; display name optional)". Those tests call validateTag (apps/web/src/features/crm/customers/governance-contract.ts:252-263). A repository-wide grep for `validateTag` returns exactly TWO files: its own definition (governance-contract.ts:252) and the test (crm-governance-writes.test.ts:14,166,167,171). Neither production importer of governance-contract pul …
- **P1-27-FE-015** — REFUTED — FAIL. (Audited on branch remediation/p1-27-final-canonical-blockers, clean tree, but HEAD is 2ff4820, NOT d0a6008 as the briefing states; the branch has advanced.) Most of the prior evidence is TRUE and I confirmed it: route/mount (CustomerProfileScreen.tsx:217-219, 1481-1544; 'timeline' in BUILT :121-132); read via listTimeline (identity-api.ts:28-51) to the backend GET (customers/[customerId]/timeline/route.ts:29-40, permissions ['crm.customer.read'] :35); no write is correct (canonical-plan.md:156 lists only crm.customer-timeline, and ComponentSection is called with no `form` pr …
- **P1-27-FE-016** — REFUTED — criterion 8 fails, and it fails in the exact way the brief warns about ("a test that would pass without the feature working"). Most of the prior evidence is TRUE; the test claim is not. WHAT I CONFIRMED AS TRUE (so the refutation is narrow and honest): - Route/page exists: apps/web/src/app/[locale]/(dashboard)/crm/customer-duplicates/page.tsx:23-64; denial rendered BEFORE the first read at :34-48 via PermissionDeniedState; crm.customer.merge deliberately unchecked (:14-21). - READ crm.duplicate-list: listDuplicates, identity-api.ts:85-106 -> GET /api/v1/customer-duplicates. - WRITE …
- **P1-27-FE-017** — REFUTED — the PASS rests on deferring a defect that belongs to FE-017, on a justification that is factually false on this branch. MOST OF THE PRIOR EVIDENCE IS TRUE. I verified independently: route + docblock (apps/web/src/app/[locale]/(dashboard)/vehicles/page.tsx:13, 26-77); read wiring searchVehicles -> GET /api/v1/vehicles (apps/web/src/features/vehicles/api.ts:39-68, path :53-54, retries: 0 at :56) matching veh.vehicle-search with permissions ['veh.vehicle.read'] + rateLimitPolicy 'expensive-read' (apps/api/src/app/api/v1/vehicles/route.ts:57-68); route-level denial rendered instead of …
- **P1-27-FE-018** — REFUTED. The mechanical half of the evidence checks out — I confirmed it — but two of the seven required items do not, and one of the auditor's own stated facts is false. WHAT I CONFIRMED (so this is not a blanket refutation): - Route: apps/web/src/app/[locale]/(dashboard)/vehicles/new/page.tsx:25-81, docblock names `P1-27-FE-018` at :13. - Permission: page.tsx:36-50 gates on VEHICLE_PERMISSIONS.vehicleManage = 'veh.vehicle.manage' (apps/web/src/features/crm/permissions.ts:41), rendering PermissionDeniedState (States.tsx:159-178) instead of the form. Backend agrees: apps/api/src/app/api/v1 …
- **P1-27-FE-028** — FAIL. Working tree is `remediation/p1-27-final-canonical-blockers` at `f38fd274` (d0a6008 is three commits back, in history). Most of the prior evidence is accurate — I confirmed the route, the two backend `defineOperation` blocks, `permissions: ['veh.vehicle.duplicate.review']` / `idempotent: true`, the manifestâ†’`requiresIdempotencyKey`â†’`client.ts:226` idempotency chain, the absent merge/scan callers, and every i18n key (I parsed both flat catalogues; all keys used by the screen, panel, MatchExplanation and explanations.ts resolve in en.json AND ar.json, including the two the auditor om …
- **P1-27-SEC-002** — REFUTED. The PASS rests on "TWO-POLICY SPLIT IS REAL AND ENFORCED". The split is documented; the browser half is enforced by nothing, and the test that is supposed to prove it passes with the whole phase deleted. 1) THE BROWSER-URL CONTROL IS DEAD CODE. `FORBIDDEN_URL_KEYS` (apps/web/src/components/data-table/table-state.ts:107-133), `isForbiddenUrlKey` (:135-137), `toSearchParams` (:180-200) and `fromSearchParams` (:203-229) have ZERO production call sites in apps/web/src. Exhaustive grep for those four identifiers over apps/web returns only the definitions plus three test files (tests/table- …
- **P1-27-SEC-003** — REFUTED. Audited at the actual branch head f38fd274 (two commits past the d0a6008 the prior auditor cites; the defect below predates both). DECISIVE: two P1-27 write affordances are rendered with NO permission gate at all, which is precisely the abuse-case / privilege-escalation control SEC-003 owns. 1. Plate assignment. apps/web/src/features/vehicles/components/VehicleHistorySections.tsx:251 `export function PlateSection({ locale, messages, vehicleId, today }: SectionProps)` — `SectionProps` (:48-54) carries no capability field. It renders the write form unconditionally at :306-339, `action …
- **P1-27-QA-003** — REFUTED. Three of the auditor's four evidence pillars survive; the fourth — the only one that observes real traffic — is structurally vacuous, and the coverage claim is overstated. Note first that the tree I audited is NOT the stated head: `git rev-parse HEAD` = f38fd2741d5d6e731c0a582d9beeb2dfd656f094, two commits past d0a6008 (2ff4820 "a gate that asks whether a person can reach a write", f38fd27 docs). WHAT I CONFIRMED (no dispute): - apps/web/src/lib/api/read-operation.ts:89-108 throws on a scope key, SCOPE_KEYS at :126-133 holds all six forms; reasoning at :93-99. Asserted at apps/web …
- **DO-002** — REFUTED — verdict should be FAIL. Most of the prior evidence is TRUE, but the load-bearing claim is not. WHAT I CONFIRMED (so the failure is narrow and real, not a documentation quibble): - apps/web/src/lib/observability/client-log.ts exists as described: FORBIDDEN_KEYS 48-73, looksLikeCredential 88-94, redact 97-124, safeRoute 127-130, report 160-180, currentAdapter 147-149 returning the module-level `adapter` which nothing sets in production. - The single production call site is real: apps/web/src/app/[locale]/(dashboard)/error.tsx:8 and :49-54. My own grep of apps/web/src for `report(`/`@ …
