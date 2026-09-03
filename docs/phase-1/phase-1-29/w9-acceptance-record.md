# P1-29 W9 — Owner acceptance record (production build, local stack, 2026-09-02/03)

The hand-driven acceptance the Owner's directive of 2026-09-02 asked for (STEP 11–15): a real
platform operator, a real organization provisioned through the product, real humans invited and
signed in through the shipped credential paths, and the W1–W8 journey walked in the browser on the
production build (`npm run acceptance:serve`) by separate personas. No privileged shortcut touched
the flow after the sanctioned genesis; where a screen could not be driven by the in-app browser
(file inputs), the same shipped route the screen calls was used and is named as such. Every line
below is a shipped route or screen; correlation ids are the API's own. No secret, token or password
appears here.

## Verdict

**PASSED for W1, W2, W3, W4, W6, W7 and W8 on the production build with real persona boundaries.** (W7
was present but not exercisable by a real organization when this record was first taken — see the
W9-R4 section at the end: resolved on 2026-09-03 and exercised on a fresh tenant.) The diagnostics experience is shipped and
mechanically proved on real responses (W7's own suites), and every job carries its Diagnostics link
— but a fresh organization holds **no `dia.diagnostic_types` vocabulary** (no seed ships, no route
creates one; recorded OPEN since BR-04 and named as W5's residual in the canonical plan §3), so no
template, report, completion or review can exist for a real workshop. The canonical closure
condition (§3: "a working diagnostics experience", "not negotiable down") therefore cannot be met
by any Backend or Frontend change: it needs the Owner's diagnostic-type content, which the
no-fake-data policy forbids inventing. That is residual **W9-R4**, and it blocks the P1-29 phase
gate until the Owner supplies the vocabulary (as a seed migration or an administration route).

Defects found by this run were fixed on the same branch (seven), and the tenant administrator's
finite set moved 44 → 48 by three refuted derivation theories and one omission; each is stated with
its evidence in `w9-owner-bootstrap.md` §5. Residuals for Owner disposition: W9-R1 (provider access
token lifetime), W9-R2 (organisation settings writes not held), W9-R3 (no job-state control on the
W3 job panel — transitions reachable through the shipped route only), W9-R4 (diagnostic-type
vocabulary). Frontend observations O1–O6 are listed at the end.

## Evidence

Every line is a shipped route or screen; correlation ids are the API's own. No secret, token or password appears here.

## Genesis and operator (STEP 11)

- Genesis: operator `platform.operator@rootlco.local`, account `a717ce48-6c94-4b6b-b453-a66a30505c6b`, home tenant `platform_operators` `0800bd81-8d34-4d8e-bd04-7961797ce34d`, audit `platform.operator.genesis`; rerun → `already-established`, `identityBoundToHomeTenant: true`.
- Operator credential through the shipped reset → mailbox → completion → login sequence (completion 200 after the adapter fix).
- Bearer before the identity was bound to its home tenant: `GET /platform/organizations` 401 ERR-IAM-002 corr `4405766c-7fe5-45e3-8c8b-4a80bd80a52c` (defect → genesis binds).
- After binding: login without a caller tenant 200 corr `debe47c6-574c-40a0-b6fb-81a295871413` (tenant resolved from the binding); `GET /platform/organizations` 200 corr `6754cdf3-e02d-4f14-8a3a-13187300c16b`; `GET /auth/session` 403 ERR-IAM-001 (`iam.user.read` — the operator holds platform codes only) corr `5e0e3953-1446-42c2-b7a1-0804870d3be9`.

## Provisioning contract (STEP 12)

- First tenant `w9_acceptance`: 201 corr `6c095018-a4be-4ce3-97b0-9bab2d09b62e` (tenant `06084ad0…`, owner `b97cb6f8…`, first_owner `2370fa46…`, tenant_administrator `beb74859…`, activated true). Destroyed later by a local backend suite's prefix cleanup (`LIKE 'w9%'`) — environment incident, recorded in memory; nothing about the product.
- Replay same key + same body: 200, byte-identical ids, corr `7873b54b-479e-430b-9092-c9d75273f691`.
- Same key + different body: 409 ERR-INT-001 corr `310f6249-9c40-4c3a-8e12-f548db61a901`.
- New key + same tenant code: 500 ERR-SYS-001 corr `795ba12c-f715-4033-96c7-3ffaa6d38089` → DEFECT fixed (409 ERR-RES-002, W9-B11). Re-proof after rebuild: see below.
- Body carrying `permissions: ["*"]`: 422 ERR-VAL-001 corr `95270254-2603-4d4e-8164-b11fe8516fef` (strict body; no caller-selected codes).

## Owner credential and sign-in (STEP 13–14)

- Invitation mail present in the mailbox (`You've been invited`, `type=invite`).
- Shipped activation page with the invitation token, first build: "This link has expired or has already been used", completion 401 corr `226a4106-cbd8-4cc7-befe-d79326d42caf` → DEFECT fixed (invite type asked second).
- Web sign-in as `owner.acceptance@…` after the tenant was destroyed: 401 `no-account` corr `987998ed-5f1e-4f95-a8a3-b5d28c4dd780` / `5851061a-88ee-49bd-8903-3ca3ecbe654c` → surfaced the bound-elsewhere DEFECT (fixed, W9-B12 + B7 rebinding).
- Second tenant `acceptance_workshop` (owner `owner.workshop@…`): 201 corr `aee13ca4-bbd0-445c-aaeb-55ad03e81351` (tenant `a5c506f0-f543-40a5-a668-4e291b66929f`, owner `67d34e30…`, first_owner `bd77ad45…`, tenant_administrator `18294954…`).
- Activation page: "Your password is set." → web sign-in → Overview (screenshot). API login 200 corr `49cd70d6-7e07-4fdf-99e4-a59b151a0e11`; `GET /auth/session` 200 corr `846af4a8-fa6c-47d3-8f20-a8fad3bd9925` listing the union of both roles (44 codes at that build; `companyIds: []`, `branchIds: []` → the derivation gap, fixed: 46).

## Final tenant on the final build (`rootlco_workshop`)

(to be appended)

- Operator restored through the genesis itself after the local genesis suite emptied `iam.platform_grants`: outcome `completed`, audit `4d0eb486-bf76-4bba-bb01-36e67038d737` (script change + G6).
- Operator login 200 corr `74968c59-4505-4172-b99c-9b159f2296e4`.
- `rootlco_workshop` provisioned: 201 corr `a9530b17-63e3-43b3-bd8d-b2fd1751c4de` — tenant `80106c3d-e857-4ddf-9b3f-0bcb66092500`, owner account `86986095-7bce-472d-9b96-f3039ffbd362`, first_owner `e408676f-db4a-4cfd-969e-270aac1863fa`, tenant_administrator `428d0a1a-0f43-41a4-820b-098c3ca69ca7`, activated true.
- Duplicate tenant code, new key, other owner: 409 ERR-RES-002 corr `f34f2537-578d-4917-9ad7-9d2c9bdd4b01` (was 500).
- Owner address bound to a live organization: 409 ERR-RES-002 corr `19ab192c-e83d-4add-ba2c-66835b4b5ec9`; no tenant created (org.tenants: platform_operators, acceptance_workshop, rootlco_workshop).
- Owner web sign-in → Overview; `GET /auth/session` 200 corr `66cf8539-7610-4505-b772-01dd4671ceb3`: 46 codes including `org.company.read`, `org.branch.read` (that build); Administration › Organization: company/branch cards render, Workspace card refused `org.tenant.read` corr `b8a2ee6d-b49c-478e-a283-2e5759a206a3` → bundle 47 (commit), W9-R2 residual for the settings writes.

## Personas (STEP 14), all as the Owner through shipped routes

- Roles created (`iam.role-create`) and mapped (`iam.role-permission-add`): receptionist 14, coordinator 12, technician 9, timekeeper 4, reviewer 4, qc_inspector 8, rework_signoff 4 codes — every code inside the administrator's set; `iam.user.read` added to each after the first sessions answered 403 (the session route declares it). Roles screen shows all nine roles (screenshot).
- Invitations (`iam.invitation-create`, 201 each): receptionist `93e47069…`, coordinator `9f52c657…`, technician `e275e51b…`, technician2 `e54e990b…`, timekeeper `1dddedf2…`, reviewer `2cb28a53…`, qc `db2b464b…`, signoff `cf4e3e46…`.
- Each invitee's credential through the shipped completion route with the invitation token (200 `password-updated` ×8, e.g. corr `86cc6bd9-9528-458b-9540-de57f431fdfe`); activation by the Owner (`iam.invitation-activate`, e.g. corr `725eb10f-89c3-4a18-9035-5273ac7475a7`) ×8.
- Company `3c4ea414-ddeb-4718-b248-08334fcb5dad`, branch `c065c47d-e67f-4fb9-a694-7687c7bc2abe` read through `org.company-list` / `org.branch-list`; departments mechanical `03ccf579…`, diagnostics `d5fbe382…` (`org.department-create` 201); technician profiles `f97c5c59…` and `2e24fe75…` with availability (201 each).
- Persona sessions 200: receptionist 14, coordinator 12, technician 9, technician2 9, timekeeper 4, reviewer 4, qc 8, signoff 4 permissions (e.g. corr `3d4a6277-a8ff-4b5f-bca4-1d8c91990d01`).

## P1-28 creation path as the receptionist (browser, production build)

- Customer "Layla Haddad" created on the New individual customer screen (`78aa3cc5-5649-4302-9d4b-606b9ea7901e`); vehicle VIN `WVWZZZ1KZ8W000001` / reference `LAYLA-01` created on Add a vehicle (`0b0460c9-fd35-4b78-965c-b8b42018e48b`); linked as Owner on the vehicle's People tab.
- Vehicle check-in: company/branch identifiers typed (unrestricted grant → the screen asks for them), walk-in origin, requester Layla, vehicle LAYLA-01, note → "The visit is open" (reception `9c6d8fe2-c0cb-4b8f-804a-f52573a50d23`).
- Check-in wizard: authorization decision approved, in person, by the service requester (a `vehicle_owner` authorizing role was refused with 409 ERR-TRN-001 corr `9473b6d4-79ac-448c-a30c-0f7a66a6048b` because that party role was not on the visit — correct); "Approve the visit" → Authorized; "Create the work order" → "Converted to a work order".

## P1-29 journey (browser, production build)

- W1 queue as the coordinator: company/branch identifiers typed, "Show work orders" → the converted order listed (`draft`, Ordinary, customer Layla Haddad "Service requester", opened 3 Sept 2026 00:58). Work order `1594b5d1-5a96-461d-b6a2-0c1d3f8cfa49` (list corr `e1166b60-0652-437b-af3f-d1c03517fcc5`).
- W3 detail: facts card (number, state, kind, parts, opened, customer, vehicle, version), Lifecycle "Move to" offering exactly the graph's states from draft (`cancelled`, `open`); moved to `open` → History `work_order_status draft → open · 3 Sept 2026, 01:01`; QC status line honestly withheld ("needs qms.quality_control.read").
- Job created as the coordinator through `wo.job-create` (no creation form on the detail — jobs are created by the route; routing and assignment are on the detail's job panel): `dec6b612-4f91-43b6-af3b-9e239b264e56` "Brake inspection and pad replacement", `planned`, requiresDiagnostic true, corr `6b93a641-8a8b-43c0-98d8-ad44197f434d`.
- W3 job panel: routed to Mechanical (`wo.job-update`, "Done"); assignment with a window starting in the past refused 422 ERR-TECH-001 corr `e19d2ff0-2ec9-4d28-bd74-f040f47b099c` (the web showed "The form could not be saved." without the reference — Frontend observation W9-O1); assignment 2026-09-03 02:00 → 09-05 18:00 (Asia/Amman) accepted: `f97c5c59…` Primary, "still assigned". `tech.technician-available` 200 corr `c6d23558-3277-42de-b41b-598b53ffdae2`.
- **W4-F1 on the production build (STEP 15):** technician2 (own profile `2e24fe75…`) starting a labour session on technician1's assignment naming technician1's profile `f97c5c59…` → 403 ERR-IAM-001 `body.technicianProfileId: not-own-profile`, corr `3a8d8a76-f068-43da-a5f2-a34873ae38cd`. Server-side authorization is the control; the earlier "MEASURED tripwire" is now a refusal. technician2 naming its own profile on a job it is not assigned to → 409 ERR-TRN-001 corr `5e363c84-cfe7-41cd-83b4-01fe0b71101b`.
- W4 workspace as the technician: with the invitation's UNRESTRICTED grant the "My work" screen offered empty Company/Branch choices (it derives them from the session scope and has no identifier fallback — Frontend observation W9-O2; technicians are branch staff, so the intended model is a scoped grant). As the Owner, through shipped routes: `iam.grant-issue` with a branch scope (technician `76af3c69…` corr `1b061236-4b25-4a58-8d93-7c339839b4f8`; technician2 `06e135b1…` corr `cb4f95b6-e5b6-4e9a-9de8-2d21fc8b78e3`), `iam.grant-revoke` of the unrestricted grants with `If-Match` (200 `revoked` ×2; a revoke without the version answered 428 ERR-CON-002 corr `a906a5ad-6209-4e8a-95b4-1d93ff849773`). Sessions now carry the company and branch. "My work" then lists "Brake inspection and pad replacement · Job state planned · Your role primary · Assigned since 3 Sept 2026, 01:03".
- W4 job workspace as the technician: "Start my clock" → 409 ERR-TRN-001 corr `7f29570a-2fc7-4106-b58c-0e05f63a0212` on a `planned` job (the workspace showed "This record changed since you loaded it. Reload and try again." — W9-O4). Root cause: a job accepts labour only after `wo.job-transition`, which no screen calls and which the administrator's set did not hold → nobody in the organization could start work. Bundle 47 → 48 (`wo.job.transition`, commit `9810655d`); Frontend residual W9-R3 (no job-state control on the W3 job panel). Work note recorded on the same screen: "Inspected front brakes: pads at 2 mm…" (When the work happened 3 Sept 2026, 01:09 · Recorded 01:09).
- Evidence binding on the workspace: the document category list offers only the reception categories (no work-evidence category in the baseline — W9-O3); the in-app browser used for this run cannot set a file input programmatically, so the binding is proved through the same shipped routes the panel calls (below).
- This tenant (`rootlco_workshop`, 47-code set) cannot receive `wo.job.transition` after the fact (delegation is bounded by the administrator's own authority, by design) — the journey continues on a tenant provisioned on the final build.

## Final tenant on the final build (48-code set)

- Operator login 200 corr `7f7b6890-bcfd-4ae7-b562-560547c2a8cd`; `rootlco_final` provisioned 201 corr `1e4af834-cad0-4f4c-8438-e438e5dc862e` — tenant `dc274f05-84cb-4088-b176-189c3d5ca98b`, owner `433a2b4c-841c-45ea-9944-3b253ccc44d5`, first_owner `7262651b…`, tenant_administrator `b5782666…`, activated.
- Owner credential through the shipped completion route with the invitation token (200 corr `5bfdd860-5988-42ec-8597-468e584461d1`); login 200 corr `aad395a0-edd5-4639-993f-8984ef81314d`; session 200 corr `4c79b270-bfcb-4c37-a484-0f09a8c4eb36` with 48 permissions including `wo.job.transition` and `org.tenant.read`.
- Personas (all as the Owner through shipped routes): 7 roles mapped (receptionist 16, coordinator 13, technician 9, timekeeper 4, reviewer 4, qc_inspector 8, rework_signoff 4), 8 invitations, 8 completions (200), 8 activations; company `a86e9dbc-de32-45ab-9c6e-a38880f98f69`, branch `c58286cf-e3ef-4919-8361-aeff9d217195`, departments mechanical/diagnostics, technician profiles `41653410…` / `9bd636e7…` with availability; technicians re-granted branch-scoped (`f71c8d6c…` corr `51171cd7-1069-4eab-9e56-4050b32fdaaa`, `80fcbf50…` corr `50a1ef52-3e49-48b4-8887-711cc49a9b83`) and their unrestricted grants revoked (200 ×2). Sessions: 8/8 at 200.
- Owner web sign-in on the final build → Administration › Organization: the Workspace card now renders (`rootlco_final`, active, en, Asia/Amman, "You can view this, but not change it" — W9-R2 stated on screen).
- P1-28 creation path on the final tenant, as the receptionist through the shipped routes (the same screens were driven by hand on the previous tenant, same build family): customer `ec917765-8b3e-475f-ac60-d119802619c4`, vehicle `643e525a-c58e-4c5f-90dc-4f0f3b3e436c`, link 201 corr `5eed9476-33d2-449f-bab6-89a9122514ea`, reception `d7dfe94f-d743-44d7-b6b6-778d279d243c` (201 corr `d4d461c1-4bcd-4825-ad55-1f08c0ab47c6`), authorization 201 corr `774b33ad-44f5-47ec-9935-287af808a498`, approve 200 corr `2cf18fbb-2280-44ea-aa53-6c831fa191af` (a version-less approve answered 428 ERR-CON-002 corr `0f76c657-1de4-41da-9abe-bfd0ebf1348e`), conversion 200 corr `91272aa6-5d7b-4f32-987f-4a7bbe01fe90` → work order `57270803-9d8e-40d5-baf5-565209bb17ec` (draft).
- W3 on the final tenant (coordinator, browser): detail → Move to `open` (version 2, History `draft → open · 3 Sept 2026, 01:19`); job `b4a97466-f808-479a-8bff-75135664944a` created through `wo.job-create` (201 corr `365ce670-98ff-4847-a6f5-3eef4eae5c42`); job panel: routed to Mechanical ("Done"), technician `41653410…` assigned Primary 2026-09-03 02:00 → 09-05 18:00 ("still assigned"). Job moved `planned → assigned` through the shipped `wo.job-transition` route with `If-Match` (200 corr `6cb1c289-fde6-4d47-a081-aa001db13f44`) — the coordinator persona holds the delegated `wo.job.transition`.
- W4 on the final tenant (technician, browser): "My work" lists the job (`assigned`, primary); job workspace → "Start my clock" → "Running since 3 Sept 2026, 01:22 · elapsed 0h 0m", session "You · 01:22 → running"; "Stop my clock" → session `01:22 → 01:22` ("Done"). W4-F1 re-proved: technician2 naming technician1's profile → 403 ERR-IAM-001 `not-own-profile` corr `088ce0f6-5096-4e7c-a989-d3447883446b`.
- W6 work evidence on the final tenant, through the same shipped routes the workspace calls, as the technician: `shared.document-category-list` 200 corr `9ed8c6ff-bb1e-4e86-890c-afc88c40ab44`; `shared.attachment-upload-authorize` 201 corr `72f88ecc-d94c-4d8a-af6c-86351617716c`; upload to the provider's storage 200; `shared.attachment-version-register` 201 corr `74ddc49b-c005-48f7-8016-2165f3f32be8` (version `62243cfc-9bf7-4b66-a892-8a94dc2c28d4`, status `accepted`, scanner available; a register without `capturedAt` answered 422 corr `b16aa83b-badc-416d-87ce-a642757366b2`); `shared.document-link-create` 201 corr `3fc198d1-fda4-4c22-b582-68bda3516e89`; `wo.job-evidence-record` 201 corr `d19935a8-0312-4d12-accd-e8570f0e6e2a` → evidence `fbcb3d45-dfa9-4074-9f99-e940cd5d847c` (type `before`).
- W4 correction on the final tenant: timekeeper `tech.labor-session-correct` 201 corr `f2651567-7bc5-495a-a242-2f614c7010ff` (correction `12efa1a0…` of session `ba32a57d…`, 22:20 → 22:35Z, source `correction`); the technician's own attempt → 403 ERR-IAM-001 `tech.labor.correct` corr `3070c7a7-b1fc-4d24-a88a-f6869a926e00`.
- **W7 on a fresh tenant — BLOCKED by an open Owner decision (residual W9-R4):** `dia.diagnostic-type-list` answers 200 with 0 items (corr `909c4655-f44b-4ac8-9f86-b199893ebc5b`); no seed ships and no route creates a diagnostic type (BR-04 DoD item recorded OPEN since 2026-08), so no template, no report and no review can exist for a real organization. The diagnostics experience is present (Diagnostics link on every job, `/work-orders/diagnostics`, publishable-version list 200 with 0 items) and states its emptiness; the content vocabulary needs the Owner's approval and a shipped seed or administration route.
- W4 workspace after reload (technician, browser): session listed as "You · 01:20 → 01:35 · correction"; work note "Inspected front brakes…" (When the work happened 3 Sept 2026, 01:23 · Recorded 01:23); Work evidence "before — Front left brake pads before replacement · Recorded 3 Sept 2026, 01:23 · Document version 62243cfc-…".
- W8 on the final tenant (QC inspector, browser `/work-orders/{id}/closure`): closure gate rendered with the backend's blockers by code — `B1 A job on this work order is not in a terminal state · enforced by wo.guard_work_order_closure`, `B4 A job requiring diagnostics has no completed diagnostic report` (`wo.work-order-closure-eligibility` 200 corr `5d46fa35-cc1d-4a0a-ba23-e5b51d5a7ccf`, deferred P1-21 conditions stated). B4 cannot be satisfied on a fresh tenant (W9-R4), so the coordinator corrected the job (`wo.job-update` 200 corr `90aed384-0ecf-4387-ace8-1ccc22436376`, requiresDiagnostic false; an update without the title answered 422 corr `c0fe46ee-9cf3-45d7-96f8-4be8f62385ae` — the update body is a full replacement) → gate shows B1 only. Job `assigned → in_progress` (`wo.job-transition` 200 corr `554405fc-3277-4df9-b24a-3a683da6dfb0`); `qc_pending` refused from in_progress (409 corr `4954942d-209f-43bf-a265-6bf94de5d22d`; the job graph offers completed/paused/cancelled).
- QC record opened from the closure screen ("Open quality control", notes "Final inspection after brake work"); the record row renders the raw key `quality.result.pending` instead of a label — Frontend observation W9-O5.
- Job `in_progress → completed` (`wo.job-transition` 200 corr `cb86a2e7-0ede-456a-b9d5-707b35c9116c`).
- QC finalized on the closure screen ("Passed · Finalized 3 Sept 2026, 01:27", note recorded; no mandatory checks exist in the fresh tenant's vocabulary — `qms.qc-check-list` 200 with 0 items, corr `479297cd-09d6-4a04-9959-fe05e15f0087`, observation W9-O6: the QC check vocabulary is also unseeded). Work order `open → in_progress` (200 corr `95454671-aa06-4915-9ed8-5b7827423a05`) `→ qc_pending` (200 corr `514e5267-ef3d-4ae5-b29e-79364c8571a4`; next states in_progress/ready_to_close). Additional-work request while `qc_pending` refused 409 ERR-TRN-001 corr `9c949a28-b09f-47ec-a664-20bd7264962c` (correct: requests belong to an order in progress). QC lead role given `wo.work_order.transition` by the Owner (closure declares transition AND close).
- Additional work on the final tenant: order back to `in_progress` (200 corr `e1193f51-722e-41ab-8075-bb8d5b018214`), request `wo.additional-work-request` 201 corr `f5e420b0-81e8-40cd-94de-6b55b3dc7556` (`343e502f…`, pending, required); approval by the customer's service-requester party role (`44d4447d…`) by phone: `wo.additional-work-approval` 201 corr `a63ed9a6-2b4b-4563-a144-05eb0f049082` (a version-less approval answered 428 ERR-CON-002 corr `5db5b50c-206a-43ff-a5b6-001f11acf9f4`). Order `in_progress → qc_pending → ready_to_close` (200 corr `47528855-8ab5-4630-ba7f-80cfbe9729f3`, `ef9b9b68-d56f-456a-845b-7f3b4d18dca5`); closure gate now names `B3 A required additional-work request is still unresolved` (corr `8523f236-4699-4220-9475-fcd0531f8be6`) — the closure screen shows the same, plus the additional-work row "pending · unfulfilled · Required".
- Additional work fulfilled by the coordinator (`wo.additional-work-fulfillment` 200 corr `79b0b883-261b-41af-8268-70322287891a`, approved → fulfilled); closure gate: **eligible true, no blockers** (corr `b5b00296-bea9-4ff9-ad75-eca10867788e`).
- **Closure (QC lead, browser):** closure screen "This work order can be closed." → Close to `closed`, reason "Brake work completed, QC passed, customer collected the car" → gate reads `closed · This work order is already in a final state`; the Rework section now offers "Open rework" (root cause, corrective action, responsibility, lead technician, safety-critical). Additional-work row reads "approved · fulfilled · Required · Customer approval: Approved · Phone · 3 Sept 2026, 01:29".
- Reopen attempt on the closed order (QC lead, closure screen): "Customer returned the next morning with the same squeal — Refused · 3 Sept 2026, 01:31" (recorded, refused). Rework raised from the same screen: "Pads fitted on the wrong axle; rear pads still worn · Corrective action: Refit the correct pads front and rear and road-test again · Not signed off" (link `a7a59675-180b-481b-be95-d153be749333`). Close control reads "No closing state is reachable from where this work order stands."
- Rework sign-off: the QC lead who raised it → 403 ERR-IAM-001 `qms.rework.sign_off` corr `8a6b751f-5c56-4126-980e-40684c3450df` (separation of duty holds); the sign-off persona naming a user id → 404 ERR-RES-001 corr `ce90f8eb-9557-452e-b681-d84af83044ac` (`signOffBy` is an independent technician PROFILE, by contract); the QC lead reading the rework cost without `iam.sensitive.view` → 403 corr `d6abc25f-f874-4929-90a5-0af57a1fadea`.
- Rework signed off by the separate sign-off persona naming the independent technician's profile (`9bd636e7…`): `qms.rework-sign-off` 200 corr `d2ff2281-f89d-435b-90e1-89270836264f`, signed 2026-09-02T22:32:22Z; the raiser's second attempt still 403 (corr `cbb99db8-2899-4168-a194-e5501345ff5f`).

- Diagnostics screen as the coordinator on the final tenant: `/work-orders/diagnostics` renders "No inspection templates yet — A template appears here once someone with catalogue rights creates it"; the job’s Diagnostics link is present on every job row (W7 present, empty by vocabulary).

## Frontend observations (not blockers)

- **W9-O1** — the W3 job panel reports a refused assignment as "The form could not be saved." with no reference (the API answered 422 ERR-TECH-001 with a correlation id).
- **W9-O2** — the technician workspace ("My work") builds its company/branch choices from the session scope only; an unrestricted technician sees empty choices with no identifier fallback (the queue and check-in screens have one). Technicians are branch staff, so a scoped grant is the intended model; the screen should say so.
- **W9-O3** — the document-category list offered for work evidence holds only the reception categories; no work-evidence category ships in the baseline.
- **W9-O4** — the technician workspace reports every 409 as "This record changed since you loaded it. Reload and try again." — including ERR-TRN-001 (the job does not accept labour yet).
- **W9-O5** — the QC record row on the closure screen renders the raw key `quality.result.pending` before finalization.
- **W9-O6** — the QC check vocabulary (`qms.qc-check-list`) is also unseeded on a fresh tenant; finalization works with zero mandatory checks, which is honest but empty.

## W9-R4 — RESOLVED: the platform diagnostic vocabulary, seeded and exercised on a real tenant (2026-09-03)

Owner decision of 2026-09-03: the missing vocabulary was a missed P1-09 seed deliverable, repaired by one
additive idempotent migration (`supabase/migrations/20260903090000_dia_diagnostic_types_platform_vocabulary.sql`,
ten tenant-neutral platform rows, no OBD type, no template, no tenant). Database proofs D1–D8 are in
`tests/db/p1-29-w9-r4-diagnostic-type-vocabulary.test.ts` and the W5 list suite. The real W7 experience
was then run on a FRESH organization provisioned through the product — `rootlco_w7`
(`ee2e53cf-6022-48af-ba27-3a5061c5a8d4`, provisioned 201 corr `1868ac65-3925-487f-93ac-decb99e4b509`),
its Owner and eight personas through the shipped credential paths, the P1-28 creation path and a job
assigned through the shipped routes — with no SQL and no fixture in the journey:

- `dia.diagnostic-type-list` as the Owner: 200 corr `00e86877-dbc6-4f7e-9982-b1b3cb68867a`, ten platform
  types; the Diagnostics screen (`/work-orders/diagnostics`) offers all ten in its "Diagnostic type"
  select on the production build, and a second template ("General inspection" on General Diagnostic)
  was created by hand on that screen.
- Authoring (Owner, `dia.catalogue.manage`): template `brake_inspection` on **Brakes** (201 corr
  `f3906589-02f2-4d9c-aacf-99e5bd4ac104`), version (201 corr `6317698d-2532-48d9-9256-dd5308b14298`),
  items `pad_depth` (numeric, mm, mandatory, 2..12), `pad_condition` (select good/worn/replace,
  mandatory), `road_test` (boolean, optional); publish without `If-Match` → 428 ERR-CON-002; publish → 200
  corr `35f843b5-2d51-4cdc-991c-4dc6b14eb3d6`; an item on the published version → 409 ERR-TRN-001.
- Execution (technician, `dia.diagnostic.record` and `.complete`): publishable set for the assigned job
  (200 corr `2f89008d-0f39-4209-8c19-c9ba0d2b7434`, one version); report created (201 corr
  `356094be-ef73-4b91-821f-ebab8edd2d3f`), detail lists outstanding mandatory `pad_depth, pad_condition`;
  `draft → in_progress` (200); **completion with mandatory items unanswered → 409 ERR-DIA-001** naming the
  items (corr `272d1d6a-cc7d-41c4-9e55-a5331f101fc7`); `pad_condition = "shiny"` → 422 `not_an_option`;
  `pad_depth = "abc"` → 422 `not_a_decimal`; answers 3.5 / worn / true → 200; measurement in "inch" →
  422 `unit_mismatch` (corr `0eb3c524-3b3c-43e6-87b2-014c59ff5129`); 3.5 mm → 201 `withinRange: true`;
  1.2 mm → 201 `withinRange: false` (recorded, not refused); finding high / repair_required 201; DTC
  P0300 201, DTC "ABC" → 422; recommendation high 201; completion with a stale version → 409 ERR-CON-001;
  completion → 200 `completed` (corr `c6ad6bdc-7ab4-46c2-9ce9-22799fe61c54`); a DTC after completion → 409.
- The technician’s job diagnostics screen (`/work-orders/{workOrderId}/jobs/{jobId}/diagnostics`) renders the report on the production build: checklist with answers (3.5 · worn · true), measurements with their range verdicts (3.5 mm within range, 1.2 mm out of range), fault code P0300, the finding, the recommendation, status `completed` with the summary, the approval with its reviewer, and the history `draft → in_progress → completed`; the "Start a diagnostic" form offers the published template.
- Review: the technician who created the report → 403 (`dia.diagnostic.review` not held — the persona
  boundary); the reviewer → 201 corr `fb82fe77-4494-4ffa-8d92-8848bd620054`; final detail: completed, 3
  item results, 2 measurements, 1 finding, 1 DTC, 1 recommendation, 1 review, 0 outstanding.

**W9-R4 — RESOLVED: initial platform diagnostic vocabulary seeded and exercised on a real tenant.** The
canonical closure condition (§3 of the plan) is satisfied by a real experience, not by a suite alone.
Verdict for W7: **PASSED**. STEP 7 of the decision: no default template is seeded — the current
repository requires none, the historical P1-09 wording asked for Benzene-valued tenant examples the seed
standard forbids, and the real experience creates its templates through the shipped operations.
