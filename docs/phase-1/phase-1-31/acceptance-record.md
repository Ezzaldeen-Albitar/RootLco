# P1-31 — fresh-organisation acceptance (production build, local stack, 2026-09-13)

The acceptance [`acceptance-plan.md`](./acceptance-plan.md) describes, taken the way the P1-30 W9
record was: a real platform operator, two organisations provisioned through
`platform.organization-provision`, every credential established through the product's own reset or
invitation-completion route with the link read out of the local mailbox as a person would, and every
business row made by an authenticated HTTP call to a published operation holding ordinary
application permissions — then the delivery, warranty, reporting and audit screens opened in a real
browser, signed in through the product's own login form. **No SQL fixture, no privileged insert and
no invented seed touched the flow after the sanctioned genesis.** Every line below is a shipped route
or screen; correlation ids are the API's own. No secret, token or password appears here.

**Build:** `npm run acceptance:serve` (production `next build` + `next start`) from protected
`develop` **`6005cfa4ca3db4dbf45a2cb6ea5edff1dc70f821`**; API `http://localhost:3000`, web
`http://localhost:3100`, Playwright's own server `http://localhost:3210`, mailbox `:54324`, database
`127.0.0.1:54322`. Organisations **`p31_journey_a_mtz2geo1`** and **`p31_journey_b_mtz2geo1`**, the
run stamp **`mtz2geo1`** being the harness's own.

**Environment confirmed read-only before the run**, against the four figures §1.2 of the plan
requires: `supabase_migrations.schema_migrations` **141** rows against **141**
`supabase/migrations/*.sql` files; `iam.permissions` **121** codes; **24** `tenant_administrator`
roles each holding exactly **78** permission codes; `org.tenants` **25** rows. Nothing was migrated,
reset, pushed or seeded by this run.

## 1. Verdict

**Engineering verdict: PASS for the P1-31 acceptance set** — **194** HTTP steps with **0** findings,
**40 of 40** committed P1-31 browser cases, **28 of 28** screens, on run **`mtzmvemj`** of
2026-09-13. That run is recorded in [§8](#8-corrected-re-run-2026-09-13-run-mtzmvemj) and its
evidence is cited there by path. **The Owner verdict has not been given.** Plan §6.3 makes an
explicit Owner Pass on the production build one of the three conditions of a phase PASS, so this
record does not close the phase and does not stand in for that verdict.

The bullets below record run **`mtz2geo1`** as it happened, and they are kept in the tense they
belong to rather than rewritten. They are how the set got from nine passing browser cases to forty.

- **The HTTP journey PASSED: 176 steps, 0 findings.** The whole chain runs end to end on an
  organisation that had nothing but its provisioning — service catalogue, published price list,
  inventory with approved opening stock, customer, vehicle, reception, work order, jobs and labour,
  quality control passed, an accepted quotation, an invoice issued for `45.0000` JOD, a receipt, an
  allocation, an outstanding of `0.0000`, work-order closure, an active checklist template, a
  warranty policy, the readiness queue, the handover from `ready` to `delivered` with the final
  odometer captured as a decimal string, a warranty generated and read, all four reports run, and
  the audit log carrying both declared actions. Every refusal, concurrency and isolation case in §4
  answered what the plan said it should.
- **The browser half did not pass on run `mtz2geo1`: 9 of the 34 committed P1-31 cases passed, 25
  failed.** Not one of the 25 is an assertion about the product that the product failed. Seventeen
  are **strict-mode locator ambiguities in the committed specs**, six assert a permission
  **withheld** that a fresh tenant administrator legitimately **holds**, and two assert a translated
  report title over a label the tenant itself supplied. Each is named with its file, line and cause
  in §3.1.
- **Those three classes were corrected and the browser half was re-run: 32 of the 34 cases now
  pass, 2 fail.** The correction pass is run **`mtz5ppq8`** and is recorded in §7.1 — a second fresh
  pair of organisations, the same 176-step HTTP journey with zero findings, and the four
  `*-p1-31.spec.ts` files repaired. The two that still fail are one case in two locales, and its
  cause was measured rather than assumed: the screen renders **exactly** what the server answers,
  and the figure the case compares against was recorded by the harness before the journey's own
  later writes. That is a fourth defect of the instrument, stated in §7.1 and not repaired here.
- **Every screen was nevertheless reached and rendered.** Nine screens × two locales were opened as
  the signed-in first administrator, all answered `200` with the correct document direction, and the
  five that idle until a target is submitted were captured again with the server's answer beside
  them (§3.2).
- **No Owner verdict has been given.** §6.3 of the plan makes an explicit Owner Pass on the
  production build one of the three conditions of a phase PASS, and this record does not stand in
  for it.

Plan §6 admits a PASS only on the conjunction of zero HTTP findings, every browser case passing with
no unexplained skip, and an Owner verdict. The first has now held on three separate runs. The
second held for 9 of 34 cases when §3.1 was written and for 32 of 34 after the correction pass;
**it holds for all 40 cases the set now carries**, measured on run `mtzmvemj` in §8. The third has
not happened. So the engineering answer is **PASS** and the phase answer is not this record's to
give — the residue is one verdict, and it belongs to the Owner. Twelve tasks are
now moved in [`task-matrix.md`](./task-matrix.md): the six this run's HTTP half established (§6) and
the six the correction pass's browser half established (§7.1). The rest keep their state, and §6 and
§7.1 say which and why.

## 2. The journey, step by step (HTTP, production build)

Run `mtz2geo1`, started **2026-09-13T00:18:58.754Z**, finished **2026-09-13T00:19:10.596Z**, against
the production build of `develop` `6005cfa4`. **176 steps, 0 findings.** The evidence the harness
wrote — `summary.json`, `steps.json`, `steps.md`, `handoff.json` — is held outside the repository at
the path §5 names; nothing of it is committed.

The blocks, in order: the platform operator and the two organisations, every credential through the
mailbox (1–15); the session and the branch (16–17 — the first administrator holds the whole
**78**-code bundle and the branch list answers one branch); the service catalogue and pricing to a
server-resolved price (18–28); inventory, opening stock, the maker–checker refusal and the second
person (29–49); the customer, vehicle, reception and work order (50–58); the people and the work,
including the work-order and job state hops (59–73); quality control (74–77); the quotation that is
the invoice's commercial source, then the invoice, receipt and allocation (78–88); work-order
closure (89–94); the handover configuration (95–99); the readiness queue and the handover itself,
with three inline refusals (100–119); warranty (120–123); the report configuration and the four runs
(124–133); the audit trail (134–135); and the refusal, concurrency and isolation cases (136–176).

`detail` is the harness's own record of what the response carried, truncated at 150 characters for
this table; the untruncated value is in `steps.json`.

| #   | step                                                                                                                          | operation                                    | status       | correlation id                         | detail                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | platform operator: password reset requested                                                                                   | `iam.auth-password-reset`                    | 202          | `5f0bc4ed-2d36-456e-80a3-5585e5b63753` | `{}`                                                                                                                                                      |
| 2   | platform operator: recovery link read out of the local mailbox                                                                | `(local mailbox)`                            | found        | -                                      | `{"messageId":"3aH5PXhPPe2l1adM7uBYup"}`                                                                                                                  |
| 3   | platform operator: credential set through the shipped completion route                                                        | `iam.auth-password-reset-completion`         | 200          | `1d1e5901-f862-489a-8f06-ee09d02d858e` | `{}`                                                                                                                                                      |
| 4   | platform operator: login                                                                                                      | `iam.auth-login`                             | 200          | `c8782c50-2a3b-4060-a437-2ecead7c168a` | `{}`                                                                                                                                                      |
| 5   | organisation A provisioned through platform.organization-provision                                                            | `platform.organization-provision`            | 201          | `0ad6fb00-09da-45c8-a531-26acbf973906` | `{"tenantId":"300757fe-cb10-44b0-aef3-b134817ff1bb","activated":true}`                                                                                    |
| 6   | organisation B provisioned through platform.organization-provision                                                            | `platform.organization-provision`            | 201          | `b7b4f5d8-854a-42e9-b42a-bf60083f36f6` | `{"tenantId":"496b77f6-3aff-40fb-8b5b-653c22f2014c","activated":true}`                                                                                    |
| 7   | owner A: password reset requested                                                                                             | `iam.auth-password-reset`                    | 202          | `d118801d-8d4f-4a59-9b72-8f8cd36e4463` | `{}`                                                                                                                                                      |
| 8   | owner A: recovery link read out of the local mailbox                                                                          | `(local mailbox)`                            | found        | -                                      | `{"messageId":"01wXrqF0Uq2hH97Ca4L0nl"}`                                                                                                                  |
| 9   | owner A: credential set through the shipped completion route                                                                  | `iam.auth-password-reset-completion`         | 200          | `1be741f2-1e4a-40cd-9091-68dc76d5a8cf` | `{}`                                                                                                                                                      |
| 10  | owner A: login                                                                                                                | `iam.auth-login`                             | 200          | `b18ec50d-732f-4a21-9499-06ed4c8eb8d4` | `{}`                                                                                                                                                      |
| 11  | owner B: password reset requested                                                                                             | `iam.auth-password-reset`                    | 202          | `c2b6a3b8-8683-4d3d-b28d-9d6c5acb339f` | `{}`                                                                                                                                                      |
| 12  | owner B: recovery link read out of the local mailbox                                                                          | `(local mailbox)`                            | found        | -                                      | `{"messageId":"1CJs29bVKcF7hOAJtnUs6x"}`                                                                                                                  |
| 13  | owner B: credential set through the shipped completion route                                                                  | `iam.auth-password-reset-completion`         | 200          | `f6311c63-2b84-4cfd-b7e1-3c3ee4bd6a9b` | `{}`                                                                                                                                                      |
| 14  | owner B: login                                                                                                                | `iam.auth-login`                             | 200          | `0d95af56-0001-4e72-bd8c-74d8e88ef989` | `{}`                                                                                                                                                      |
| 15  | owner A session (permission count must be 78)                                                                                 | `iam.auth-session`                           | 200          | `68379e17-c1ac-4d88-be42-5e9822cacb95` | `{"permissions":78}`                                                                                                                                      |
| 16  | the first administrator holds the whole tenant-administrator bundle                                                           | `(assertion)`                                | 78           | -                                      | `{"held":78,"expected":78}`                                                                                                                               |
| 17  | owner A: branch list                                                                                                          | `org.branch-list`                            | 200          | `3b9617ca-c357-4468-92cd-7b3103ade3c3` | `{"count":1}`                                                                                                                                             |
| 18  | service category created                                                                                                      | `svc.service-category-create`                | 201          | `492eadae-1af7-41a6-a55f-4003d09fb235` | `{"id":"8e155471-62ee-4830-a4f6-ba092b8a4294"}`                                                                                                           |
| 19  | service created                                                                                                               | `svc.service-create`                         | 201          | `d73d1265-6ec3-4913-b792-7a5867f75ec1` | `{"id":"f5937c13-531a-48a6-954b-4c3cccdccf8d","recordVersion":1}`                                                                                         |
| 20  | service version created                                                                                                       | `svc.service-version-create`                 | 201          | `ce95ae6a-d047-474e-888c-5250b61137f6` | `{"id":"62e8486d-444a-462c-999a-58e6fd036537","state":null}`                                                                                              |
| 21  | service version published                                                                                                     | `svc.service-version-publish`                | 200          | `7879255c-13dd-4cba-a1b5-3c4362b59f84` | `{"state":null}`                                                                                                                                          |
| 22  | service made available at the branch                                                                                          | `svc.branch-availability-set`                | 200          | `cb11ec58-11c5-48d4-8b6a-3bc50904aff4` | `{}`                                                                                                                                                      |
| 23  | price list created                                                                                                            | `svc.price-list-create`                      | 201          | `446cfc7c-82bc-4813-9704-d196d1c5f4ba` | `{"id":"78679f92-d23c-48a3-92c0-03ea9cc5924d","recordVersion":1}`                                                                                         |
| 24  | price list version created (If-Match = the LIST record version)                                                               | `svc.price-list-version-create`              | 201          | `f2459500-1e1a-45e9-b6da-2db72f5f8977` | `{"id":"ddcc033c-6527-4d2b-b6de-f046da566bb4"}`                                                                                                           |
| 25  | price rule recorded (amount as a decimal string)                                                                              | `svc.price-rule-record`                      | 201          | `75e4c367-ba95-41c6-93b4-9aef1c5e078e` | `{"amount":"45.0000"}`                                                                                                                                    |
| 26  | price list version published (If-Match = the LIST record version)                                                             | `svc.price-list-version-publish`             | 200          | `45450c49-b48d-414d-a260-ed724e565a7a` | `{}`                                                                                                                                                      |
| 27  | price list assigned to the branch                                                                                             | `svc.price-list-assignment-create`           | 201          | `2d2a1be5-1ffc-44c7-bc10-f2da9de74e70` | `{"id":"49ab44f7-165b-4931-82bb-c128c6fd0549"}`                                                                                                           |
| 28  | price RESOLVED by the server                                                                                                  | `svc.price-resolve`                          | 200          | `a44b712c-fb4a-49a5-9819-75dea0ef6f9c` | `{"amount":null,"currency":"JOD"}`                                                                                                                        |
| 29  | item category created                                                                                                         | `inv.item-category-create`                   | 201          | `fdd0aa47-1c17-46e3-a8de-d3c26c4a81aa` | `{"id":"304f4a3e-15d7-4506-815f-1d7eef2a46ae"}`                                                                                                           |
| 30  | unit list (the 'each' platform code must be offered)                                                                          | `inv.uom-list`                               | 200          | `ac52469e-5ffe-475d-bab6-da27a2895b9d` | `{"count":12}`                                                                                                                                            |
| 31  | item created (catalogue row, no cost, no stock)                                                                               | `inv.item-create`                            | 201          | `96108823-04fe-4851-83c6-fa239384d3ba` | `{"id":"53a93989-ef91-4c21-bbb9-43b91c2ddec4"}`                                                                                                           |
| 32  | warehouse created                                                                                                             | `inv.stock-location-create`                  | 201          | `b08f16f0-d5e0-4edc-9765-fbd09eaa2d1d` | `{"id":"3a314ce9-3e3f-4249-bb55-f1b1757bf1b0"}`                                                                                                           |
| 33  | storage place created inside the warehouse                                                                                    | `inv.stock-location-create`                  | 201          | `b51be791-eb5b-45bc-97a8-1ac8485060c6` | `{"id":"8823091b-23fc-49e3-a5c7-c636d3d304d8"}`                                                                                                           |
| 34  | opening batch opened                                                                                                          | `inv.opening-batch-create`                   | 201          | `36a1963b-8cb6-414e-a691-28d6f92df028` | `{"id":"c6f94282-26fa-4a40-a6c8-abac39325b6c","state":null}`                                                                                              |
| 35  | opening line added (quantity as a decimal string)                                                                             | `inv.opening-batch-line-create`              | 201          | `1ef34d05-ea3b-462e-97a0-ff529706d440` | `{"quantity":"12.000"}`                                                                                                                                   |
| 36  | CASE: the counter approving their own batch is REFUSED (maker != checker)                                                     | `inv.opening-batch-approve`                  | 409          | `9a23e8c8-21b4-4345-9ac9-72db6302ea00` | `{"code":"ERR-TRN-001"}`                                                                                                                                  |
| 37  | second person: role list, to find the administrator role                                                                      | `iam.role-list`                              | 200          | `8c897a58-1694-4f14-972a-e049a2585c9d` | `{"count":2}`                                                                                                                                             |
| 38  | second person invited with the administrator role                                                                             | `iam.invitation-create`                      | 201          | `582e09f6-3de6-4f54-bccf-69a9eb9ed874` | `{"state":"invited"}`                                                                                                                                     |
| 39  | second person: password reset requested                                                                                       | `iam.auth-password-reset`                    | 202          | `3fd0bd29-df2e-4285-b079-5598acf07054` | `{}`                                                                                                                                                      |
| 40  | second person: recovery link read out of the local mailbox                                                                    | `(local mailbox)`                            | found        | -                                      | `{"messageId":"5IMTJlITBQyQaVrylv8Sd7"}`                                                                                                                  |
| 41  | second person: credential set through the shipped completion route                                                            | `iam.auth-password-reset-completion`         | 200          | `741366b7-313a-4e37-9eca-56870da6dfa9` | `{}`                                                                                                                                                      |
| 42  | second person BEFORE activation: login                                                                                        | `iam.auth-login`                             | 401          | `7b80facb-76ea-4d40-a73b-85bc6ec74999` | `{}`                                                                                                                                                      |
| 43  | second person activated by the administrator                                                                                  | `iam.invitation-activate`                    | 200          | `83bc58ec-7b5c-4cf2-8cf6-f9fb28dac654` | `{"state":"active"}`                                                                                                                                      |
| 44  | second person granted the administrator role at the branch                                                                    | `iam.grant-issue`                            | 201          | `d487d9f5-ece5-4337-a240-54215b15f61f` | `{"id":"0f6fc15a-ec3c-4aff-9295-951fd4f0cbd6"}`                                                                                                           |
| 45  | second person (after activation): login                                                                                       | `iam.auth-login`                             | 200          | `36b17296-e14a-428d-99cb-99bb92f19578` | `{}`                                                                                                                                                      |
| 46  | batch APPROVED by the second person                                                                                           | `inv.opening-batch-approve`                  | 200          | `eb372038-36ed-4b48-bb6c-b044c89356de` | `{"state":null}`                                                                                                                                          |
| 47  | CASE: the same approval replayed under the same key is not a second approval                                                  | `inv.opening-batch-approve`                  | 200          | `af2188d8-567d-4958-87c5-a333cb0ca0ba` | `{"state":null,"replayed":null}`                                                                                                                          |
| 48  | ON HAND after approval, as the server publishes it                                                                            | `inv.stock-availability-read`                | 200          | `ee807635-37fe-4b8f-b82c-fe2091132f84` | `{"cells":[{"onHand":"12.000","available":"12.000"}]}`                                                                                                    |
| 49  | movement ledger shows the opening row                                                                                         | `inv.stock-movement-list`                    | 200          | `937cf4ff-2315-4486-87a0-9c4f807d45ad` | `{"count":1,"types":["opening"]}`                                                                                                                         |
| 50  | first journey: customer created                                                                                               | `crm.individual-create`                      | 201          | `4f7b8d55-42d3-4057-9332-0f153fda5dbb` | `{"customerId":"6fc109a0-0e29-4dd9-b741-b016ae876369","displayNumber":"000001"}`                                                                          |
| 51  | first journey: vehicle created                                                                                                | `veh.vehicle-create`                         | 201          | `716ab935-a6c2-4950-bb3d-c6205f96265b` | `{"vehicleId":"6c4f3d29-a978-4ebf-9ab1-5798272ba7b1","lifecycle":"draft"}`                                                                                |
| 52  | first journey: vehicle linked to the customer                                                                                 | `crm.vehicle-link`                           | 201          | `8df49cdf-94d2-4eaf-aad2-869fe428fb33` | `{}`                                                                                                                                                      |
| 53  | first journey: reception created (walk-in)                                                                                    | `rec.reception-create`                       | 201          | `e9f42fb2-f595-4ed2-9d8c-a52cbd43e024` | `{"receptionVisitId":"6e30b9dd-56f3-4942-a494-80cb0d26be2b","receptionStatus":"opened","recordVersion":1}`                                                |
| 54  | first journey: the customer recorded on the visit as the authorized receiver                                                  | `rec.reception-party-role`                   | 201          | `aa4c3fa8-011d-4892-bf82-cc6fa7cda905` | `{"role":"authorized_receiver"}`                                                                                                                          |
| 55  | first journey: the customer AUTHORIZES the work                                                                               | `rec.reception-authorization`                | 201          | `5c7db594-170d-4fc5-b51d-4ed813d658d1` | `{"decision":"approved"}`                                                                                                                                 |
| 56  | first journey: reception detail, for its record version                                                                       | `rec.reception-detail`                       | 200          | `35b0f026-32e0-4429-a1de-3b43bc09e550` | `{"receptionStatus":"opened","recordVersion":1}`                                                                                                          |
| 57  | first journey: reception approved                                                                                             | `rec.reception-approve`                      | 200          | `a6ec00bd-b884-4802-9167-6c5202173f06` | `{"receptionStatus":"authorized","recordVersion":3}`                                                                                                      |
| 58  | first journey: reception converted to a WORK ORDER                                                                            | `rec.reception-convert-to-work-order`        | 200          | `10309941-be49-476a-9072-e307f07fa11f` | `{"workOrderId":"27559ecf-62a4-45d8-ba59-16ff98883115"}`                                                                                                  |
| 59  | employee added to the branch register (active)                                                                                | `org.employee-create`                        | 201          | `79579037-90dc-4cb3-9b7d-0698594b2eb8` | `{"id":"af721ef6-3af3-4219-bbd2-0c2e0c015c27","status":"active"}`                                                                                         |
| 60  | technician profile created for the signed-in account                                                                          | `tech.technician-create`                     | 201          | `6de2de99-0f05-4b46-92ad-3caf0bbf61b8` | `{"id":"07fd3673-6878-4945-b4e5-1b3aa548a89e"}`                                                                                                           |
| 61  | work order detail, for the If-Match the open transition needs                                                                 | `wo.work-order-detail`                       | 200          | `78cb1eef-b4f5-4f42-af2d-119c3e7d7446` | `{"state":"draft","recordVersion":1,"nextStates":["cancelled","open"]}`                                                                                   |
| 62  | work order transitioned to open                                                                                               | `wo.work-order-transition`                   | 200          | `1dd7f9df-b461-4c73-8d7e-0ed2e83ef3a2` | `{"state":"open","from":"draft","offered":["cancelled","open"]}`                                                                                          |
| 63  | work order detail, for the If-Match the in_progress transition needs                                                          | `wo.work-order-detail`                       | 200          | `0d9196b3-f591-4a52-8ea1-ac50d2a0fc3b` | `{"state":"open","recordVersion":2,"nextStates":["cancelled","in_progress"]}`                                                                             |
| 64  | work order transitioned to in_progress                                                                                        | `wo.work-order-transition`                   | 200          | `635f93eb-8f36-4346-90bc-8c5992af19f0` | `{"state":"in_progress","from":"open","offered":["cancelled","in_progress"]}`                                                                             |
| 65  | job created on the work order                                                                                                 | `wo.job-create`                              | 201          | `6f90db61-52fc-4f80-95e9-350b4bb1ed8a` | `{"id":"4787d254-5c74-4321-a6e8-e06bafdea38d","state":"planned","recordVersion":1}`                                                                       |
| 66  | technician availability recorded, so the assignment has a window to sit in                                                    | `tech.technician-availability-record`        | 201          | `2c32ce1c-c58f-41d9-8423-e508b2bbad7c` | `{"id":"688204a7-bc84-4fd9-a089-efcbb5d2ffda","kind":"available"}`                                                                                        |
| 67  | job assigned to the technician                                                                                                | `wo.job-assignment-create`                   | 201          | `35b112a7-4d65-48b3-a6fe-ab1626a3eb8f` | `{"id":"5e445923-ffb1-407e-a90b-42accfaa3e7d"}`                                                                                                           |
| 68  | job transitioned to assigned, which is the first state that permits labour                                                    | `wo.job-transition`                          | 200          | `32717756-933e-4b60-9187-c713e42100e0` | `{"state":"assigned"}`                                                                                                                                    |
| 69  | labour session started                                                                                                        | `tech.labor-session-start`                   | 201          | `d2ca26f6-e96e-413c-872e-2d0c3db0ffbc` | `{"id":"01f3784a-7a46-4a2b-b372-01c3457a6844","recordVersion":1}`                                                                                         |
| 70  | labour session STOPPED, so the recorded time is a closed interval                                                             | `tech.labor-session-stop`                    | 200          | `193740e9-540f-427e-9fcb-74f424b543d6` | `{"endedAt":"2026-09-13T00:19:04.692Z"}`                                                                                                                  |
| 71  | work log recorded against the job                                                                                             | `wo.job-work-log-record`                     | 201          | `85865631-e561-4dc9-bdc5-ec17055037a5` | `{"id":"d76c66e0-d619-406e-b3ab-65fe9d39f6fe"}`                                                                                                           |
| 72  | job transitioned to in_progress                                                                                               | `wo.job-transition`                          | 200          | `ab72a904-26fb-4ffb-9104-64cb3cdf6d8d` | `{"state":"in_progress"}`                                                                                                                                 |
| 73  | job transitioned to completed, which is terminal                                                                              | `wo.job-transition`                          | 200          | `9174eee3-fb69-47b2-ae1b-0603b2375765` | `{"state":"completed"}`                                                                                                                                   |
| 74  | quality-control record opened                                                                                                 | `qms.qc-record-open`                         | 201          | `4fa5db05-1dbd-4c4c-8808-a8b8113aa9e7` | `{"id":"6316f576-b753-4f93-a41b-7c6b197926bf","overallResult":"pending"}`                                                                                 |
| 75  | quality-control record read, for its checks and record version                                                                | `qms.qc-record-detail`                       | 200          | `d0adc14b-1cee-4e21-96a6-c3c7e0db4a2b` | `{"checks":0,"recordVersion":null}`                                                                                                                       |
| 76  | quality-control record re-read, for the If-Match the finalisation needs                                                       | `qms.qc-record-detail`                       | 200          | `87e18018-cdee-4434-ba47-07506d74bed8` | `{"recordVersion":null}`                                                                                                                                  |
| 77  | quality control FINALISED passed                                                                                              | `qms.qc-record-finalize`                     | 200          | `87d8d9da-ea3e-4fcd-8c54-58c46f272ef0` | `{"overallResult":"passed"}`                                                                                                                              |
| 78  | quotation raised on the work order, priced from the published price list                                                      | `quo.quotation-create`                       | 201          | `e45c7e50-1579-4f46-a50d-fed33455bcf9` | `{"id":"5ffffc1c-6fe4-475c-9408-99263c735fca","quotationNumber":"000001","revisionId":"a5e0678c-2e1c-4deb-9e21-4d981f8fbdca","grandTotal":"0.0000","rec…` |
| 79  | quotation ISSUED to the customer (If-Match = the QUOTATION version)                                                           | `quo.quotation-issue`                        | 200          | `fdf7471e-070d-4f7d-a1d5-95518ee2b546` | `{"status":"issued","recordVersion":2}`                                                                                                                   |
| 80  | the customer APPROVES the revision, in person — the invoice’s commercial source                                               | `quo.quotation-revision-decide`              | 201          | `39b94a2f-67fc-4ced-991d-be23bce5092c` | `{"decided":1,"rollUp":null}`                                                                                                                             |
| 81  | invoice preview (the server figures, not ours)                                                                                | `sal.invoice-preview`                        | 200          | `15dadf1e-a28a-47aa-9f1a-dcec9f0fc785` | `{"lines":1}`                                                                                                                                             |
| 82  | invoice created (draft), naming the payer explicitly                                                                          | `sal.invoice-create`                         | 201          | `16626ccf-bb9e-453c-b53f-5e39cc297189` | `{"id":"6c93d006-b670-4f14-bc95-0a732adf168f","status":"draft","recordVersion":1}`                                                                        |
| 83  | invoice ISSUED with a number from the branch sequence (If-Match = the INVOICE version)                                        | `sal.invoice-issue`                          | 200          | `fb44b6c6-547f-47fe-b217-06c00876f129` | `{"invoiceNumber":"000001","status":"issued"}`                                                                                                            |
| 84  | invoice detail after issue                                                                                                    | `sal.invoice-detail`                         | 200          | `eeaf9358-102c-40bd-970e-7813a50a97f8` | `{"status":"issued","invoiceNumber":"000001","gross":"45.0000","currency":"JOD"}`                                                                         |
| 85  | payment methods (the tenant cash method must be present)                                                                      | `sal.payment-method-list`                    | 200          | `d84ee847-eeb2-4fc6-b35e-0cb547b7be74` | `{"codes":["bank_transfer","card_terminal","cash","bank_transfer","card_terminal","cash"]}`                                                               |
| 86  | receipt recorded for the issued amount                                                                                        | `sal.payment-record`                         | 201          | `b1ddc12b-36f8-4e08-a26f-bbf6c90d7f2d` | `{"id":"ee9ebd93-a57b-40e0-b5b9-5ed2c4f642a0","reference":"000001"}`                                                                                      |
| 87  | receipt ALLOCATED to the invoice                                                                                              | `sal.payment-allocate`                       | 201          | `9f724845-e016-4651-b46d-4e96ee46ffff` | `{"id":"547a6a42-6f1a-486a-9922-51eb2486c08a"}`                                                                                                           |
| 88  | OUTSTANDING after allocation, as the server publishes it                                                                      | `sal.invoice-outstanding-read`               | 200          | `85aa5f8b-0019-4af1-8f30-90f0c580b7c4` | `{"outstanding":"0.0000","isSettled":true}`                                                                                                               |
| 89  | closure eligibility read                                                                                                      | `wo.work-order-closure-eligibility`          | 200          | `95cb1b46-92f0-4c37-b12a-51abcfdce98e` | `{"eligible":true,"blockers":[]}`                                                                                                                         |
| 90  | work order detail, for the If-Match the qc_pending transition needs                                                           | `wo.work-order-detail`                       | 200          | `acd1b8bf-dc59-4d57-be40-2a6b0f82c172` | `{"state":"in_progress","recordVersion":3,"nextStates":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                  |
| 91  | work order transitioned to qc_pending                                                                                         | `wo.work-order-transition`                   | 200          | `5a81cb47-5fb0-48c1-89fa-e1b50e728ab5` | `{"state":"qc_pending","from":"in_progress","offered":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                   |
| 92  | work order detail, for the If-Match the ready_to_close transition needs                                                       | `wo.work-order-detail`                       | 200          | `0c5528d6-420e-4e3a-96da-36bd58a4cc7c` | `{"state":"qc_pending","recordVersion":4,"nextStates":["in_progress","ready_to_close"]}`                                                                  |
| 93  | work order transitioned to ready_to_close                                                                                     | `wo.work-order-transition`                   | 200          | `93dbe633-bc69-4bc3-ba3b-f369ebef3f09` | `{"state":"ready_to_close","from":"qc_pending","offered":["in_progress","ready_to_close"]}`                                                               |
| 94  | work order CLOSED with If-Match                                                                                               | `wo.work-order-closure`                      | 200          | `87d80875-c917-42b1-aacd-0aceee60961d` | `{"state":"closed"}`                                                                                                                                      |
| 95  | handover checklist template created with two mandatory items                                                                  | `sal.delivery-checklist-template-create`     | 201          | `324781c7-61f7-4fe3-9013-0e87a3a8352c` | `{"id":"0b22d22d-3c7d-47a8-b846-a87823bca0a9","items":2,"recordVersion":1}`                                                                               |
| 96  | checklist template read, for its items and record version                                                                     | `sal.delivery-checklist-template-read`       | 200          | `7a84e5e1-0c91-493d-9697-e0c7c8700834` | `{"items":2,"status":"active","recordVersion":1}`                                                                                                         |
| 97  | checklist template status set ACTIVE                                                                                          | `sal.delivery-checklist-template-status-set` | 200          | `5a3fdc84-9631-4435-8c10-13184fd638b4` | `{"status":"active"}`                                                                                                                                     |
| 98  | warranty policy created with one coverage window                                                                              | `wty.warranty-policy-create`                 | 201          | `95374a02-b449-48e7-a692-b1807283ac88` | `{"id":"f2c1dfbb-e9fa-471a-8de3-8a06453822bb","coverage":1,"recordVersion":1}`                                                                            |
| 99  | a second, service-only coverage window added to the policy                                                                    | `wty.warranty-coverage-create`               | 201          | `0d8f383d-ce92-4eee-b414-c149ff29f73c` | `{"id":"79632084-a845-4023-8554-8ec683e14e62","coveredScope":"service"}`                                                                                  |
| 100 | readiness queue: the closed work order is present with its four facts                                                         | `sal.delivery-readiness-list`                | 200          | `5bffa545-64d6-4b98-bd92-fe4095fa2aa4` | `{"count":1,"present":true,"facts":[{"blocker":"work_order_not_complete","established":true},{"blocker":"quality_control_not_passed","established":true…` |
| 101 | all four work-order facts were ESTABLISHED, not assumed blocking                                                              | `(assertion)`                                | 4            | -                                      | `{"facts":[{"blocker":"work_order_not_complete","established":true,"source":"@/modules/work-order — wo.work_orders.state against wo.work_order_states"}…` |
| 102 | delivery opened for the work order                                                                                            | `sal.delivery-create`                        | 201          | `e77da340-d322-4c81-9860-97c1c588f1dc` | `{"id":"8abc490b-dd2f-49b1-868b-c986d0106451","status":"ready","recordVersion":1}`                                                                        |
| 103 | CASE: the same body under the SAME key is a replay, not a second delivery                                                     | `sal.delivery-create`                        | 200          | `1e6d590a-98d9-4824-9e9f-6fe419674041` | `{"id":"8abc490b-dd2f-49b1-868b-c986d0106451","replayed":false}`                                                                                          |
| 104 | the replay answered the SAME delivery id                                                                                      | `(assertion)`                                | same row     | -                                      | `{"first":"8abc490b-dd2f-49b1-868b-c986d0106451","replayed":"8abc490b-dd2f-49b1-868b-c986d0106451"}`                                                      |
| 105 | CASE: a SECOND key for the same work order is refused (one live delivery only)                                                | `sal.delivery-create`                        | 409          | `5701af1f-ba14-4e63-abaa-a4cb5deb3cf0` | `{"code":"ERR-RES-002"}`                                                                                                                                  |
| 106 | eligibility read before any handover evidence                                                                                 | `sal.delivery-eligibility-read`              | 200          | `e176598f-01e8-444f-a1c8-a88f084bdfad` | `{"eligible":false,"blockers":["checklist_incomplete","receiver_not_verified","signature_missing"],"recordVersion":1}`                                    |
| 107 | authorized receiver verified against the visit roles                                                                          | `sal.delivery-receiver-verify`               | 201          | `bd76ae94-b563-470f-9aa7-ff52b0d20d54` | `{"id":"1d8203ba-dd93-4a6e-afe6-cf9cb3f5a3d7","deliveryStatus":"receiver_verified"}`                                                                      |
| 108 | signature document: upload authorized against the reception visit                                                             | `shared.attachment-upload-authorize`         | 201          | `b11067e5-fa06-44e4-884a-0004c531acf3` | `{"documentId":"74780867-b3e1-48f6-aaa9-aeee3f091e84","method":"PUT"}`                                                                                    |
| 109 | signature document: bytes stored at the presigned destination                                                                 | `(object store)`                             | 200          | -                                      | `{"bytes":67}`                                                                                                                                            |
| 110 | signature document: version registered and scanned                                                                            | `shared.attachment-version-register`         | 201          | `57ea9828-0ebb-4d39-a7c0-758ecd018b36` | `{"versionId":"3c2b7654-085e-4db3-a88a-614f22058a09","status":"accepted","scanStatus":"clean"}`                                                           |
| 111 | signature document: linked to the reception visit, which is its provenance                                                    | `shared.attachment-link-create`              | 201          | `bb381328-d5e2-42a6-b4a1-f301c32c3d24` | `{"linkId":"55a2818f-0a24-409c-944e-63bc6654d834"}`                                                                                                       |
| 112 | the receiver's signature bound to the delivery by reference                                                                   | `sal.delivery-signature-attach`              | 201          | `be4f8b99-d3f9-4c69-863d-14137959c2bc` | `{"id":"71faa3d7-e59c-48fd-8bb8-5aaf697f5178"}`                                                                                                           |
| 113 | checklist item recorded as passed: keys_returned                                                                              | `sal.delivery-checklist-record`              | 201          | `27b5927c-a5f9-498b-ae49-91594bcee5de` | `{"outcome":"passed"}`                                                                                                                                    |
| 114 | checklist item recorded as passed: documents_returned                                                                         | `sal.delivery-checklist-record`              | 201          | `f2253603-38f1-4dbf-822e-a0a36f095d2c` | `{"outcome":"passed"}`                                                                                                                                    |
| 115 | eligibility read again: every fact established, no blocker, and the version to use                                            | `sal.delivery-eligibility-read`              | 200          | `01dd0f50-5267-4dc0-8dbb-6c644f13a07b` | `{"eligible":true,"blockers":[],"facts":[{"blocker":"delivery_state_invalid","established":true},{"blocker":"work_order_not_complete","established":tru…` |
| 116 | CASE: a STALE If-Match on completion is refused                                                                               | `sal.delivery-complete`                      | 409          | `0c0216e9-92e0-45ee-90c5-2e91e1d7d718` | `{"code":"ERR-CON-001"}`                                                                                                                                  |
| 117 | delivery COMPLETED: custody released and the final odometer captured                                                          | `sal.delivery-complete`                      | 200          | `d4af1be6-17cf-4608-8260-a4c80f416d7c` | `{"status":"delivered","deliveredAt":"2026-09-13T00:19:07.234Z"}`                                                                                         |
| 118 | delivery read: the record is delivered                                                                                        | `sal.delivery-read`                          | 200          | `e590fcb5-b976-4fb9-bca1-a1fdaef1a6a2` | `{"status":"delivered","finalOdometerReadingId":"080edcb1-1841-4425-8341-d3808a0964d8"}`                                                                  |
| 119 | status history: every stage the handover passed through                                                                       | `sal.delivery-status-history`                | 200          | `c784a123-3366-4606-a1e6-cb1022f25e60` | `{"stages":["delivered","signed","receiver_verified","ready"]}`                                                                                           |
| 120 | warranty generated from the delivered handover under the named policy                                                         | `wty.warranty-generate`                      | 201          | `b8ebf4c9-d56d-40c8-a26b-0b1621dd56b8` | `{"id":"68f87c20-984a-49de-896d-6a6343482884","status":"issued","expiryDate":"2027-09-13"}`                                                               |
| 121 | warranty list for the branch contains the vehicle's new warranty                                                              | `wty.warranty-list`                          | 200          | `9111635b-958c-4f36-a145-dfa805fc66e4` | `{"count":1,"present":true}`                                                                                                                              |
| 122 | warranty detail: its terms and what it covers                                                                                 | `wty.warranty-detail`                        | 200          | `79ad1db1-1e9f-4c6c-860b-2c6cb71eaee1` | `{"status":"issued","startDate":"2026-09-13","expiryDate":"2027-09-13","odometerLimit":"32346","policyCode":"p31_mtz2geo1_wty","coveredScope":"all"}`     |
| 123 | warranty plans list, as the plans screen reads it                                                                             | `wty.warranty-policy-list`                   | 200          | `bb1471d1-d4cb-47c9-80aa-5d83653011ac` | `{"count":1,"codes":["p31_mtz2geo1_wty"]}`                                                                                                                |
| 124 | report configuration created for work_orders_by_status                                                                        | `rpt.report-configuration-create`            | 201          | `56e7c921-3e07-4ded-bbab-8e4bc25f2b18` | `{"id":"4c33b486-bbb0-449f-8b46-401c57d3c508","recordVersion":1}`                                                                                         |
| 125 | configuration version created (parameterSchema omitted, not empty)                                                            | `rpt.report-configuration-version-create`    | 201          | `3a8b8336-49af-4fa8-a422-a5afbc673506` | `{"id":"fa2baf10-5d96-4091-9a91-e4dc01ce8c62","versionNumber":1}`                                                                                         |
| 126 | configuration read, for the If-Match the publish needs                                                                        | `rpt.report-configuration-read`              | 200          | `f1074847-9fd7-42ea-a2c2-f554eb53e7e6` | `{"status":"draft","recordVersion":1}`                                                                                                                    |
| 127 | configuration version PUBLISHED                                                                                               | `rpt.report-configuration-version-publish`   | 200          | `597b04ce-20bd-4623-bbc3-af80c42530a7` | `{"publishedAt":"2026-09-13T00:19:07.756Z","recordVersion":2}`                                                                                            |
| 128 | configuration status set published                                                                                            | `rpt.report-configuration-status-set`        | 200          | `203308fe-7883-4dbe-b725-cab1a11b27fa` | `{"status":"published"}`                                                                                                                                  |
| 129 | report catalogue offers all four dataset codes                                                                                | `rpt.report-catalogue`                       | 200          | `e2b92279-03f8-4255-8edf-ec88946c4a08` | `{"count":4,"missing":[],"executable":[{"reportCode":"technician_labor_time","executable":true},{"reportCode":"inventory_movements","executable":true},…` |
| 130 | report run: work_orders_by_status over a half-open day period                                                                 | `rpt.report-run`                             | 200          | `13dc20e2-f79b-4024-8fa2-a3a36de53ea1` | `{"timezone":"Asia/Amman","rows":1,"groups":9,"freshness":"live"}`                                                                                        |
| 131 | report run: technician_labor_time over a half-open day period                                                                 | `rpt.report-run`                             | 200          | `82719447-2b08-4ba1-bd5c-69ed92223cb0` | `{"timezone":"Asia/Amman","rows":1,"groups":1,"freshness":"live"}`                                                                                        |
| 132 | report run: inventory_movements over a half-open day period                                                                   | `rpt.report-run`                             | 200          | `85401e61-54a8-4f2a-90ee-ef529de34fc8` | `{"timezone":"Asia/Amman","rows":1,"groups":1,"freshness":"live"}`                                                                                        |
| 133 | report run: invoice_payment_summary over a half-open day period                                                               | `rpt.report-run`                             | 200          | `e2e961a1-434e-41d1-bed4-a944c44b90f8` | `{"timezone":"Asia/Amman","rows":2,"groups":2,"freshness":"live"}`                                                                                        |
| 134 | audit log for the branch carries the completion and the warranty issue                                                        | `iam.audit-event-list`                       | 200          | `9efdb73f-aba6-48bb-8a3a-8c50c019db72` | `{"count":44,"missing":[]}`                                                                                                                               |
| 135 | both declared audit actions were really written                                                                               | `(assertion)`                                | both present | -                                      | `{"missing":[]}`                                                                                                                                          |
| 136 | refusal journey: customer created                                                                                             | `crm.individual-create`                      | 201          | `78d1397e-eee5-41cb-86a6-98257d9565da` | `{"customerId":"671a05ad-e0b2-4f94-8bae-42f36a6969e3","displayNumber":"000002"}`                                                                          |
| 137 | refusal journey: vehicle created                                                                                              | `veh.vehicle-create`                         | 201          | `64136b64-b95a-4bd2-ab42-56b6ac19b5f0` | `{"vehicleId":"af7c275d-43be-488e-96c1-c3d24972d76f","lifecycle":"draft"}`                                                                                |
| 138 | refusal journey: vehicle linked to the customer                                                                               | `crm.vehicle-link`                           | 201          | `c238925e-a309-40a0-8a8b-f3d39d30de03` | `{}`                                                                                                                                                      |
| 139 | refusal journey: reception created (walk-in)                                                                                  | `rec.reception-create`                       | 201          | `bc573711-ecb6-4dbc-b2cd-c10b0d86ee4b` | `{"receptionVisitId":"6fc96e4d-a7cc-4f23-8ece-e79e8b70181b","receptionStatus":"opened","recordVersion":1}`                                                |
| 140 | refusal journey: the customer recorded on the visit as the authorized receiver                                                | `rec.reception-party-role`                   | 201          | `0ccbc827-d60e-4236-892f-5ada0d899803` | `{"role":"authorized_receiver"}`                                                                                                                          |
| 141 | refusal journey: the customer AUTHORIZES the work                                                                             | `rec.reception-authorization`                | 201          | `0ddfa4f4-3e27-4584-a50f-fa8db1d081d3` | `{"decision":"approved"}`                                                                                                                                 |
| 142 | refusal journey: reception detail, for its record version                                                                     | `rec.reception-detail`                       | 200          | `4121a793-93d5-4279-8e00-3bfeaa867d9c` | `{"receptionStatus":"opened","recordVersion":1}`                                                                                                          |
| 143 | refusal journey: reception approved                                                                                           | `rec.reception-approve`                      | 200          | `f9a41cd6-04cd-49a9-94b5-5786f46a8359` | `{"receptionStatus":"authorized","recordVersion":3}`                                                                                                      |
| 144 | refusal journey: reception converted to a WORK ORDER                                                                          | `rec.reception-convert-to-work-order`        | 200          | `4719e008-859e-4feb-b464-57c69b6f3806` | `{"workOrderId":"bd385d11-51f6-4da5-b12b-96ade5144f7a"}`                                                                                                  |
| 145 | a second employee added to the register, to be retired                                                                        | `org.employee-create`                        | 201          | `f1d63ca6-4fb6-447b-92d5-719aa04cc55b` | `{"id":"ea807c11-ada6-4b76-bfa9-efe94a70f325","status":"active","recordVersion":1}`                                                                       |
| 146 | that employee set inactive                                                                                                    | `org.employee-status-set`                    | 200          | `db4942a2-b925-43c1-99ad-57c4dedb8e50` | `{"status":"inactive"}`                                                                                                                                   |
| 147 | CASE: a RETIRED employee named as the person handing over is refused at Start                                                 | `sal.delivery-create`                        | 422          | `863837ae-da53-474a-9380-2265d07091d3` | `{"code":"ERR-VAL-001","rules":["inactive_employee"]}`                                                                                                    |
| 148 | a second handover opened with the ACTIVE employee                                                                             | `sal.delivery-create`                        | 201          | `11c56778-b884-4134-bf92-02c5832eb104` | `{"id":"b9b4e55f-c335-49c9-80e7-c576d062dd28","recordVersion":1}`                                                                                         |
| 149 | second handover: receiver verified                                                                                            | `sal.delivery-receiver-verify`               | 201          | `c90f94b8-89c5-406c-9f6d-3a29116dabd1` | `{"id":"6ce5d6f0-ec99-4bda-b1be-2ba77c2edf4f"}`                                                                                                           |
| 150 | signature document: upload authorized against the reception visit                                                             | `shared.attachment-upload-authorize`         | 201          | `a4377a4f-33d4-4bba-b57a-c376126ef140` | `{"documentId":"a19c7c96-3e47-477e-9d7d-5e288ced2022","method":"PUT"}`                                                                                    |
| 151 | signature document: bytes stored at the presigned destination                                                                 | `(object store)`                             | 200          | -                                      | `{"bytes":67}`                                                                                                                                            |
| 152 | signature document: version registered and scanned                                                                            | `shared.attachment-version-register`         | 201          | `45ecd47b-143d-49ca-ae3e-6893721ea4d5` | `{"versionId":"6cbbcf9e-3683-4758-be07-8616a5e4116a","status":"accepted","scanStatus":"clean"}`                                                           |
| 153 | signature document: linked to the reception visit, which is its provenance                                                    | `shared.attachment-link-create`              | 201          | `625e55c5-7a7a-4e78-9309-a034f6f2bb08` | `{"linkId":"986b5c01-9035-43a0-afb6-86b01ca98c96"}`                                                                                                       |
| 154 | second handover: signature bound                                                                                              | `sal.delivery-signature-attach`              | 201          | `7ef4885d-bdc9-4a29-a449-5dce0802a56f` | `{}`                                                                                                                                                      |
| 155 | second handover: eligibility names the unanswered checklist                                                                   | `sal.delivery-eligibility-read`              | 200          | `deb5b9fb-ddeb-4feb-8a8f-09c3b48c436c` | `{"eligible":false,"blockers":["work_order_not_complete","financial_balance_outstanding","checklist_incomplete"],"checklistGaps":2}`                      |
| 156 | CASE: completion with the active template's mandatory items unanswered is refused                                             | `sal.delivery-complete`                      | 409          | `f82fa187-578d-4a4c-bb93-1c1f7c7cfb69` | `{"code":"ERR-TRN-001"}`                                                                                                                                  |
| 157 | ISOLATION: organisation B cannot read organisation A's delivery                                                               | `sal.delivery-read`                          | 404          | `6321f980-1a09-4e53-859d-fd0f8adfe2e7` | `{"code":"ERR-RES-001"}`                                                                                                                                  |
| 158 | ISOLATION: organisation B cannot read organisation A's warranty                                                               | `wty.warranty-detail`                        | 404          | `519fd4ae-35eb-4026-bab5-ce1c8960aac0` | `{"code":"ERR-RES-001"}`                                                                                                                                  |
| 159 | ISOLATION: organisation B naming organisation A's branch sees no row                                                          | `sal.delivery-readiness-list`                | 403          | `20a033d9-7a4a-4e13-b4a4-0223f8c432d5` | `{"rows":0}`                                                                                                                                              |
| 160 | ISOLATION: organisation B's readiness queue carried NO row of organisation A's — refused before any row, so the count is moot | `sal.delivery-readiness-list`                | 403          | `20a033d9-7a4a-4e13-b4a4-0223f8c432d5` | `{"rows":null}`                                                                                                                                           |
| 161 | ISOLATION: organisation B cannot run a report over organisation A's branch                                                    | `rpt.report-run`                             | 403          | `d63a5b16-7545-4f15-a4a8-894596592de4` | `{"rows":0}`                                                                                                                                              |
| 162 | ISOLATION: organisation B's report carried NO row of organisation A's — refused before any row, so the count is moot          | `rpt.report-run`                             | 403          | `d63a5b16-7545-4f15-a4a8-894596592de4` | `{"rows":null}`                                                                                                                                           |
| 163 | a role WITHOUT sal.finance.view created                                                                                       | `iam.role-create`                            | 201          | `980ec807-1137-453e-bb34-f4d19bc0dba3` | `{"id":"c585fc99-2cfd-48ab-8534-ff607482fea7"}`                                                                                                           |
| 164 | restricted role granted sal.delivery.view                                                                                     | `iam.role-permission-add`                    | 201          | `99569047-ae56-4844-8e51-25f9b4892f2c` | `{}`                                                                                                                                                      |
| 165 | restricted role granted wo.work_order.read                                                                                    | `iam.role-permission-add`                    | 201          | `02640b52-126d-48df-9a47-63cfb4ae3bbe` | `{}`                                                                                                                                                      |
| 166 | restricted role granted rpt.report.read                                                                                       | `iam.role-permission-add`                    | 201          | `fed4a805-f828-42b9-bbf2-e080d300aefd` | `{}`                                                                                                                                                      |
| 167 | a third person invited with the restricted role                                                                               | `iam.invitation-create`                      | 201          | `8dd8a69e-ec5b-43f5-9da7-a20be1d9ef3b` | `{"state":"invited"}`                                                                                                                                     |
| 168 | third person: password reset requested                                                                                        | `iam.auth-password-reset`                    | 202          | `6f347e91-aa27-4727-b329-e79903330ec4` | `{}`                                                                                                                                                      |
| 169 | third person: recovery link read out of the local mailbox                                                                     | `(local mailbox)`                            | found        | -                                      | `{"messageId":"6UvLDV1MiWtrPUkw0zPVVn"}`                                                                                                                  |
| 170 | third person: credential set through the shipped completion route                                                             | `iam.auth-password-reset-completion`         | 200          | `efb63430-e783-4359-a85b-89305e6adc30` | `{}`                                                                                                                                                      |
| 171 | third person activated                                                                                                        | `iam.invitation-activate`                    | 200          | `7552a33d-3cd6-4914-9dbf-c6fdf66a5631` | `{}`                                                                                                                                                      |
| 172 | third person granted the restricted role at the branch                                                                        | `iam.grant-issue`                            | 201          | `7d240a8b-3c6b-4af5-bafa-d3db4b86b7f7` | `{}`                                                                                                                                                      |
| 173 | third person: login                                                                                                           | `iam.auth-login`                             | 200          | `772f96d6-12ac-4245-b3a2-3fdf7f246bb6` | `{}`                                                                                                                                                      |
| 174 | CASE: without sal.finance.view the readiness queue is REFUSED, not blanked                                                    | `sal.delivery-readiness-list`                | 403          | `d2a71b15-0370-40dc-b975-1d10fe44888f` | `{"code":"ERR-IAM-001"}`                                                                                                                                  |
| 175 | CASE: without sal.finance.view the invoice and payment report is REFUSED                                                      | `rpt.report-run`                             | 403          | `de4d2c40-7eac-4f43-b0b7-f608ad409c7d` | `{"code":"ERR-IAM-001"}`                                                                                                                                  |
| 176 | the same person CAN run the report whose permission they do hold                                                              | `rpt.report-run`                             | 200          | `108d6ab5-1dbb-47dd-9f50-4957e71bc414` | `{"rows":2}`                                                                                                                                              |

## 3. The screens, in a real browser

### 3.1 The committed authenticated specs

Driven through the repository's own Playwright projects, signing in through the product's own login
form, against the production build on `:3210`:

```
set ROOTLCO_E2E_AUTH=1
set ROOTLCO_P131_HANDOFF=<the handoff.json the journey printed>
npm run test:web-e2e-authenticated
```

The handoff was present, so no P1-31 case skipped for want of a world: all seventeen cases per
project executed in both `authenticated-en` and `authenticated-ar`. **Nine passed and twenty-five
failed.**

| spec                      | case                                                         | `authenticated-en` | `authenticated-ar` | cause when it failed            |
| ------------------------- | ------------------------------------------------------------ | ------------------ | ------------------ | ------------------------------- |
| `delivery-p1-31.spec.ts`  | the readiness queue is reachable, and idles with its reason  | pass               | pass               | —                               |
| `delivery-p1-31.spec.ts`  | the readiness queue answers for every row it shows           | FAIL               | FAIL               | A — `:59`, the branch field     |
| `delivery-p1-31.spec.ts`  | the handover record shows its own facts                      | pass               | pass               | —                               |
| `delivery-p1-31.spec.ts`  | the printable copy is produced and prints exactly once       | FAIL               | FAIL               | A — `:248`, the Print control   |
| `warranty-p1-31.spec.ts`  | both warranty reads are reachable, plan creation withheld    | FAIL               | FAIL               | B — `wty.policy.manage` is held |
| `warranty-p1-31.spec.ts`  | the branch's warranty list carries the generated warranty    | FAIL               | FAIL               | A — `:100`, the branch field    |
| `warranty-p1-31.spec.ts`  | the warranty record shows its terms and what it covers       | pass               | pass               | —                               |
| `warranty-p1-31.spec.ts`  | the warranty plans screen lists the plan the journey created | FAIL               | FAIL               | A — `:194`, the `Plan` column   |
| `reports-p1-31.spec.ts`   | the catalogue refuses a caller without the report read code  | FAIL               | FAIL               | B — `rpt.report.read` is held   |
| `reports-p1-31.spec.ts`   | the run screen refuses a caller without the report read code | FAIL               | FAIL               | B — `rpt.report.read` is held   |
| `reports-p1-31.spec.ts`   | the catalogue offers all four datasets                       | pass               | FAIL               | C — the tenant's own label      |
| `reports-p1-31.spec.ts`   | `work_orders_by_status` renders exactly the rows answered    | FAIL               | FAIL               | A `:188` (en) / C then A (ar)   |
| `reports-p1-31.spec.ts`   | `technician_labor_time` renders exactly the rows answered    | FAIL               | FAIL               | A — `:188`, the time-zone label |
| `reports-p1-31.spec.ts`   | `inventory_movements` renders exactly the rows answered      | FAIL               | FAIL               | A — `:188`, the time-zone label |
| `reports-p1-31.spec.ts`   | `invoice_payment_summary` renders exactly the rows answered  | FAIL               | FAIL               | A — `:188`, the time-zone label |
| `audit-log-p1-31.spec.ts` | the log records the completion and the warranty issue        | FAIL               | FAIL               | A — `:68` (en) / `:53` (ar)     |
| `audit-log-p1-31.spec.ts` | the log offers no export, and says why                       | pass               | pass               | —                               |

**Cause A — a locator in the spec matches more than one node, and Playwright's strict mode refuses
the ambiguity.** Seventeen of the twenty-five failures. Each is a defect in the test, not in the
screen, and each names both nodes it matched:

- `delivery-p1-31.spec.ts:59` — `getByLabel('Branch')` matches the form's own
  `aria-label` (“Choose a branch to review delivery readiness”) as well as the `Branch *` select.
- `delivery-p1-31.spec.ts:248` — `getByRole('button', { name: 'Print' })` matches
  “Hide the printable document” too, because an accessible-name match is a substring match.
- `warranty-p1-31.spec.ts:100` — `getByLabel('Branch')` matches three nodes: the section, the form
  and the control.
- `warranty-p1-31.spec.ts:194` — the `Plan` column header also matches `Plan reference`.
- `reports-p1-31.spec.ts:188` — `getByText('Time zone')` also matches the sentence beneath it.
- `audit-log-p1-31.spec.ts:68` — the `Action` column header also matches `Row actions`; and at
  `:53` in Arabic the `from` date label also matches a second field.

Every one of these would fail the same way on the governed job the moment a handoff existed, so they
are recorded here as defects of the committed suite and left for the lane that owns it. **Nothing was
edited to make this record greener**: the specs are exactly as `develop` `6005cfa4` has them.

**Cause B — the case asserts that a permission is WITHHELD, and this caller holds it.** Six failures.
Plan §3.0 designed those cases for the governed job's `acceptance:create-owner` account, whose
permission set is `OWNER_PERMISSIONS`; this acceptance signs in as a freshly provisioned
organisation's **first administrator**, who holds the whole 78-code tenant-administrator bundle —
including `rpt.report.read` and `wty.policy.manage`. So the report screens render instead of
refusing, and the warranty plans screen offers its create panel. The screens behaved correctly for
the caller in front of them; the cases cannot hold for both callers at once, and the plan did not
foresee that.

**Cause C — a tenant's own label is not translated.** Two failures, both Arabic. The journey creates
and publishes a tenant report configuration for `work_orders_by_status` and names it, in English,
“Work orders by status”. `reportTitle` prefers the definition's `titleKey` and falls back to the
tenant's `name`, and a tenant configuration carries no key — so both locales show the operator's own
label. The English case passed only because the label the harness chose happens to equal the English
catalogue string, which makes that pass weaker than it looks and is recorded as such. This is the
same class as the P1-30 record's observation that a tenant-created payment method stays “Cash” in
Arabic.

### 3.2 The screens, opened and captured

Because twenty-five assertions did not run to completion, the screens themselves were opened
directly, as the same signed-in first administrator, in both locales, and photographed. Nine screens
× two locales; every one answered `200`, every one carried the right document direction, and the
five that idle until a target is submitted were captured a second time with the server's answer.

| screen                   | path                                 | en                                  | ar                                  |
| ------------------------ | ------------------------------------ | ----------------------------------- | ----------------------------------- |
| delivery readiness queue | `/{locale}/delivery`                 | `ltr`, “Delivery readiness”, 1 row  | `rtl`, “تسليم المركبة”, 1 row       |
| the handover record      | `/{locale}/delivery/{id}`            | `ltr`, “Vehicle handover”           | `rtl`, “تسليم المركبة”              |
| warranties               | `/{locale}/warranty`                 | `ltr`, “Warranties”, 1 row          | `rtl`, “الضمانات”, 1 row            |
| the warranty record      | `/{locale}/warranty/{id}`            | `ltr`, “Warranty record”            | `rtl`, “سجل الضمان”                 |
| the warranty plans       | `/{locale}/warranty/policies`        | `ltr`, “Warranty plans”             | `rtl`, “خطط الضمان”                 |
| the report catalogue     | `/{locale}/reports`                  | `ltr`, “Reports”                    | `rtl`, “التقارير”                   |
| `work_orders_by_status`  | `/{locale}/reports/{reportCode}`     | `ltr`, 11 rows over the same period | `rtl`, 11 rows over the same period |
| the operational overview | `/{locale}/reports/overview`         | `ltr`, “Operational overview”, 13   | `rtl`, “لمحة تشغيلية عامة”, 13      |
| the audit log            | `/{locale}/administration/audit-log` | `ltr`, “Audit log”, 25 rows         | `rtl`, “سجل التدقيق”, 25 rows       |

What the images show, stated rather than assumed:

- **The readiness queue answers for the row it shows.** One row: work order `000001`, state `closed`,
  the customer and the opening date, and a verdict — “Not ready. Review the handover status; no
  work-order blocker was reported.” beside a `Handed over` link into the handover. That is the
  documented rule and not a defect: `readyToStartDelivery` is false once a delivery is `delivered`,
  while the four work-order blockers stay empty. No verdict cell was blank, which is what FE-001 is
  for.
- **The handover record carries its own facts.** Stage `Handed over`, the date, a link to the work
  order, the vehicle, visit, delivering-employee and final-odometer references, and “Ready to
  release? Everything required is done. This vehicle can be released.” with every check and how it
  went listed beneath.
- **Arabic renders right to left throughout**, with the internal references isolated left-to-right,
  and the tenant's own strings — the delivering employee's name, the report configuration's name —
  shown as the tenant wrote them.

The images and `screens.json` are held with the rest of the evidence outside the repository (§5).

## 4. Failure, concurrency and isolation cases

Every case the plan's §4 names, with the step that recorded it. All of them answered as the plan
said they should; none is a finding.

| case                                                                  | expected                   | answered                                    | step |
| --------------------------------------------------------------------- | -------------------------- | ------------------------------------------- | ---- |
| the counter approving their own opening batch                         | 409                        | 409 `ERR-TRN-001`                           | 36   |
| the same approval replayed under the same key                         | 200, no second approval    | 200                                         | 47   |
| an invited person signing in **before** activation                    | 401                        | 401                                         | 42   |
| the same delivery-create body under the **same** `Idempotency-Key`    | 201 then 200, the same row | 200, the same delivery id                   | 103  |
| a **second** key for a work order that already has a live delivery    | 409 `ERR-RES-002`          | 409 `ERR-RES-002`                           | 105  |
| a **stale** `If-Match` on completion                                  | 409                        | 409 `ERR-CON-001`                           | 116  |
| a **retired** employee named as the person handing over               | 422 `inactive_employee`    | 422 `ERR-VAL-001`, rule `inactive_employee` | 147  |
| completion while the active template's mandatory items have no result | refused                    | 409 `ERR-TRN-001`                           | 156  |
| organisation B reading organisation A's delivery                      | 403 or 404                 | 404 `ERR-RES-001`                           | 157  |
| organisation B reading organisation A's warranty                      | 403 or 404                 | 404 `ERR-RES-001`                           | 158  |
| organisation B naming organisation A's branch on the readiness queue  | 403, or 200 with no row    | 403, no row                                 | 159  |
| organisation B running a report over organisation A's branch          | 403, or 200 with no row    | 403, no row                                 | 161  |
| a third person **without** `sal.finance.view` on the readiness queue  | 403 — refused, not blanked | 403 `ERR-IAM-001`                           | 174  |
| the same person on the invoice-and-payment report                     | 403                        | 403 `ERR-IAM-001`                           | 175  |
| the same person on the work-order report, whose code they **do** hold | 200                        | 200                                         | 176  |

The two isolation probes that answered **403 rather than an empty 200** are the shape P1-30's
observation **CC-14** predicted: the application scope check refuses a foreign company/branch pair
before RLS is reached. What is never acceptable is a row, and no probe returned one.

## 5. How it was driven

- **The HTTP harness is NOT in the repository.** It is
  `1millions/orchestration/acceptance/p1-31-journey.mjs`, beside the phase evidence and outside any
  git working tree, for the reason §1.7 of the plan gives. It was invoked as the plan states:

  ```
  set ROOTLCO_ENV=local-acceptance
  set ROOTLCO_ACCEPTANCE_CONFIRM=p1-31
  set GENESIS_OPERATOR_EMAIL=<the genesis platform operator>
  set ROOTLCO_REPO=C:\Users\Ezzaldeen\wt-p10
  node ..\..\orchestration\acceptance\p1-31-journey.mjs
  ```

- **The screenshots were taken by a companion script held in the same place**,
  `orchestration/acceptance/p1-31-screens.mjs`. It asserts nothing: it signs in through the login
  form with the handoff's credentials, opens each screen in each locale, submits the scope form where
  a screen has one, and writes the images and `screens.json`. It exists because §3.1's twenty-five
  failures would otherwise have left this record with no picture of the screens at all.
- **The evidence directory is outside the repository**, at
  `%LOCALAPPDATA%\Temp\p1-31-acceptance-mtz2geo1-VPYlmk\` — the unguessable directory the harness
  creates for itself. It holds `summary.json`, `steps.json`, `steps.md`, `step-table.md`, the
  `screens/` images and `screens.json`. **`handoff.json` was removed** with
  `--remove-handoff` once the browser half was done, as §5.1 of the plan requires.
- **The exclusivity window** ran from **2026-09-12T23:45Z**, when `npm run acceptance:serve` began
  the production build, to **2026-09-13T01:05:04Z**, when `npm run dev:stop` freed ports 3000 and
  3100 and reported both servers stopped. Inside it: six runs
  of the harness (§7), one full `test:web-e2e-authenticated` pass and two screenshot passes. **No
  `test:db`, no `test:backend`, no mutation matrix and no other tier ran in any worktree**, and no
  `supabase db reset`, `db push` or migration script touched `:54322`. No foreign `node` process was
  holding the stack when the window opened; the only ones running belonged to the editor tooling.
- **Human-only, and not claimed here:** the Owner's explicit verdict on the production build, and any
  judgement of the screens' wording and layout beyond what this record states.

## 6. Observations, and what each task can claim

**Moved to `end-to-end verified` in [`task-matrix.md`](./task-matrix.md), citing this record.** Six
tasks, each with both an HTTP chain that ran and a browser case that passed in both locales:
**FE-002** (eligibility answered before and after the evidence, and the blockers it named are the
ones the completion enforced), **FE-003** (a receiver verified against the visit's party roles, and
the isolation probe), **FE-004** (both mandatory items recorded, and a completion refused on a second
handover while they were not), **FE-005** (the odometer sent as the decimal string `12345.6` and the
reading reachable from the record), **FE-006** (a document authorized, stored, registered, linked and
bound, with the provenance check passing) and **FE-008** (a warranty generated from a delivered
handover, its terms on screen in both languages).

_**Correction, made by the closure re-measure of 2026-09-13 (change control § 62, CC-52 (c)); the
paragraph above is left exactly as written.** "Six tasks, each with both an HTTP chain that ran and a
browser case that passed in both locales" does not hold for **three** of the six.
**FE-004, FE-005 and FE-006 have no committed browser case for their own surfaces.** The delivery
case that runs against the handed-over record — "the handover record shows its own facts" in
`apps/web/tests/e2e/authenticated/delivery-p1-31.spec.ts` — asserts the summary panel (status,
handover time, vehicle, delivering employee, and the absence of the not-handed-over statement), the
eligibility panel and the receiver panel. It asserts **nothing** about a recorded checklist item, the
final odometer reading, or the signature evidence, and a search of the five `*-p1-31.spec.ts` files
for those three subjects returns only the warranty screen's odometer-limit column. What those three
tasks have is their HTTP half — steps 113, 114 and 156 for FE-004, 117 and 118 for FE-005, and 108 to
112 for FE-006 — which is the same evidence this section's own "Not moved, and why" list holds to be
insufficient one paragraph below: "A screenshot is not the assertion the matrix's rightmost state is
about", and neither is an HTTP step alone. **FE-003 and FE-002 are unaffected** — the receiver and
eligibility panels are asserted by name — **and FE-008 is unaffected**, its record screen being
asserted in both locales by `warranty-p1-31.spec.ts`. The three rows are lowered to
`merged (write path)` in [`task-matrix.md`](./task-matrix.md) and the three owed browser cases are
recorded as **CC-52 (c)**. **This note moves no figure of the run itself**: every step, case and
count in this record stands as measured._

**Not moved, and why.** This list is what THIS run could establish and it is left as it stood; six of
the rows below — FE-001, FE-007, FE-012, FE-013, FE-014 and FE-015 — moved afterwards on the
correction pass recorded in [§7.1](#71-amendment--the-correction-pass-of-2026-09-13-run-mtz5ppq8),
which is where the evidence for each of them is.

- **FE-001, ready-for-delivery list.** The queue was captured answering with one row and a verdict in
  both locales (§3.2) and the HTTP step established all four facts — but its own committed case did
  not run to completion (cause A). A screenshot is not the assertion the matrix's rightmost state is
  about.
- **FE-007, delivery document.** The printable copy's case failed in both locales before it reached
  the print counter (cause A), so the one thing only a browser can establish — that the control calls
  `window.print` exactly once inside the production bundle — was not established.
- **FE-009, warranty history.** Unchanged. `CC-31` records that no history reader exists; this run
  confirms the statement and cannot confirm a ledger that is not published.
- **FE-010 and FE-016, the operational overview.** The screen was reached at
  `/{locale}/reports/overview` and rendered thirteen rows in both locales, but it carries no
  committed browser case and no HTTP step: the acceptance plan was written before #376 merged and
  does not cover it. Reached is not verified.
- **FE-011 … FE-014, the four report screens.** All four ran over the same half-open period the HTTP
  half recorded, and `work_orders_by_status` was captured rendering eleven rows — but every one of the
  eight row-count cases failed on cause A, so the equality the plan asks for (the screen's row count
  equals the server's) was never evaluated.
- **FE-015, audit report.** The log rendered twenty-five rows for the branch and the HTTP read found
  both declared actions — but the case that filters for each action separately failed on cause A.

**Observations for the lanes that own them.**

- **O-1 (Backend `iam`, the bootstrap bundle).** `wo.work_order.line.manage` is in the permission
  catalogue and is declared by a shipped operation, and it is **not** in the 78-code
  tenant-administrator bundle: `wo.service-line-record` answered `403 ERR-IAM-001` to the first
  administrator during the rehearsal runs of §7. It blocked nothing here, because an invoice is
  derived from an accepted quotation revision and not from work-order service lines — but a fresh
  organisation's administrator cannot record a service line or required-part demand at all, which is
  the same shape as the inventory gap P1-30's F-02 remeasurement found.
- **O-2 (Frontend, the P1-31 browser suite).** The seventeen strict-mode ambiguities of §3.1. They
  are invisible on the governed job today because every journey-dependent case skips there for want
  of a handoff; the first hosted run with a world will surface all of them at once.
- **O-3 (Frontend, the P1-31 browser suite).** The six permission cases of cause B assert against a
  permission set no acceptance caller has. A case that is true for the governed job's owner and false
  for a real first administrator is a case about the environment rather than about the screen.
- **O-4 (Frontend `reports`).** A published tenant report configuration replaces the platform's
  translated title with the tenant's own label, in both locales (cause C). That is defensible — it is
  the operator's name for their own configuration — but it means the Arabic screens can show English
  text without anything being broken, and nothing on the screen says so.
- **O-5 (Backend `reporting`, recorded because it surprised this run).** A tenant configuration in
  `draft` **removes its dataset from the catalogue** and makes `rpt.report-run` answer
  `404 ERR-RES-001` for that code: `listPublished` suppresses the baseline as soon as any
  configuration row exists, and the by-code read refuses an unpublished one. Measured in the
  rehearsal runs of §7, before the configuration was published. The behaviour is documented in the
  service; the consequence — that creating a configuration and not publishing it withdraws a report
  the tenant had — is not stated anywhere a screen could show it.
- **O-6 (Backend `work-order`).** `wo.work-order-closure-eligibility` answered
  `eligible: true, blockers: []` at a moment when the closure command refused with
  `ERR-TRN-001`, because the eligibility read answers for the closure CONDITIONS and not for the
  state graph: the order was not yet in `ready_to_close`. Both answers are correct and together they
  are misleading to a caller.
- **O-7 (Frontend `warranty`).** Submitting the warranty list with no branch chosen shows
  “Enter the identifier exactly as it was given.” beneath a `select` of named branches. The sentence
  is about an identifier field the screen no longer has.
- **O-8 (recorded for the mirror's reader).** The delivery status history published four stages for
  this handover — `ready`, `receiver_verified`, `signed`, `delivered` — under
  `{ deliveryId, transitions: { items: [...] } }`, not a bare list.

## 7. The six runs, and what the earlier five were

The harness had never been executed against a running system: §8 of the plan says so in terms, and
records that the first person to run it should expect to find defects in the harness as well as in
the product. That is what happened. Six runs were made inside the exclusivity window; **run six,
`mtz2geo1`, is the run this record is of**, and the other five are stated here rather than dropped,
because a list of runs that keeps only the green one is not a record.

| run | stamp      | steps | findings | what it established                                                                                                                                |
| --- | ---------- | ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `mtz1l0fg` | 86    | 17       | five response shapes the harness read under the wrong name, two request bodies it sent in the wrong shape, and the `If-Match` on the report status |
| 2   | `mtz1z1gr` | 138   | 18       | the work-order state graph has no `completed`; an invoice needs an accepted quotation; the signature category `signature` does not exist           |
| 3   | `mtz29l47` | 149   | 13       | an assignment needs a recorded availability window; the signature category requires a device capture timestamp                                     |
| 4   | `mtz2c45u` | 170   | 10       | a job must be `assigned` before labour and reaches `completed`, not `done`; a 14-byte “PNG” is quarantined by the scanner and cannot be bound      |
| 5   | `mtz2en58` | 176   | 0        | the chain complete; three evidence fields still read under the wrong name, so three cells said `null` or `0` about records that existed            |
| 6   | `mtz2geo1` | 176   | 0        | **the recorded run** — the same chain with those three fields read correctly                                                                       |

Every correction was made in the harness, outside the repository, and every one was justified against
the shipped contract it had misread — a strict `zod` body, a view's field name, a seeded state graph,
a category row. **No product code, test, gate, allow-list or fixture was changed to make a step
pass**, and no step's expectation was weakened: the step counts rose because the journey grew the
hops the product actually requires.

Each run provisioned its own pair of organisations, so twelve organisations named
`p31_journey_{a,b}_<stamp>` for the six stamps above are left in the shared local database, which
went from **25** `org.tenants` rows before the window to **37** after it. **None was deleted**, on
the P1-30 precedent: the codes match no backend-suite prefix, so no routine test run will remove them
and none of them will remove anything else. The handoff each run wrote was removed — the recorded
run's with the harness's own `--remove-handoff`, the other five by hand — so no credential is left on
disk.

### 7.1 Amendment — the correction pass of 2026-09-13, run `mtz5ppq8`

**What this amendment is.** §3.1 recorded twenty-five browser failures and said in terms that none of
them was an assertion about the product that the product failed: seventeen were locator ambiguities
in the committed specs, six asserted a permission withheld that the caller holds, and two asserted a
translated report title over a label the tenant supplied. Those three classes have now been corrected
in the four `*-p1-31.spec.ts` files and the browser half has been run again, against a **second**
fresh pair of organisations. Nothing above this line is rewritten except §1's verdict: §2 to §6
remain the record of run `mtz2geo1` as it happened, and this section records what changed, what the
change measured, and what it did not repair.

**The run.** Stamp **`mtz5ppq8`**, organisations `p31_journey_a_mtz5ppq8` and
`p31_journey_b_mtz5ppq8`, against a production build (`npm run acceptance:serve`) of
`feature/p1-31-acceptance-record` `cfc8574b`, which is `develop` `6005cfa4` plus this record. The
handoff from `mtz2geo1` had already been removed with `--remove-handoff` as §5 records, so it could
not be reused and a fresh one was minted. **The HTTP journey answered 176 steps with 0 findings
again** — started 2026-09-13T01:50:11.840Z, finished 2026-09-13T01:50:24.186Z — on an organisation
provisioned minutes earlier. That is the second independent pass of the same chain, on a second
organisation, nine minutes after the build landed.

**Environment, measured before and after.** `supabase_migrations.schema_migrations` **141** rows
against **141** migration files; `iam.permissions` **121** codes; every `tenant_administrator` role
holding exactly **78** codes, **38** such roles now; `org.tenants` **37** rows before this pass and
**39** after, the two this run provisioned. Nothing was migrated, reset, pushed or seeded, no tenant
was deleted, and no `test:db`, `test:backend` or mutation-matrix run took place inside the window.

**Before and after, by spec and by locale.** All thirty-four committed P1-31 cases executed in both
`authenticated-en` and `authenticated-ar`; none skipped for want of a world.

| spec                      | cases x locales | before (`mtz2geo1`) | after (`mtz5ppq8`)  |
| ------------------------- | --------------- | ------------------- | ------------------- |
| `delivery-p1-31.spec.ts`  | 4 x 2 = 8       | 4 pass, 4 FAIL      | **8 pass**          |
| `warranty-p1-31.spec.ts`  | 4 x 2 = 8       | 2 pass, 6 FAIL      | **8 pass**          |
| `reports-p1-31.spec.ts`   | 7 x 2 = 14      | 1 pass, 13 FAIL     | **12 pass, 2 FAIL** |
| `audit-log-p1-31.spec.ts` | 2 x 2 = 4       | 2 pass, 2 FAIL      | **4 pass**          |
| **total**                 | **34**          | **9 pass, 25 FAIL** | **32 pass, 2 FAIL** |

The two remaining failures are one case — `work_orders_by_status renders exactly the rows the server
answered` — in each locale. They are a fourth defect of the instrument, measured below and left
standing.

**Class A — the seventeen locator ambiguities. Fixed.** Each was a query that matched more than one
node, and in every case both nodes were the product's own and neither was a duplicate the screen
should not have had. They are fixed the way the seven pre-existing authenticated specs fix the same
trap: by naming the ROLE and matching the WHOLE accessible name, or by narrowing to the region the
text is stated in. Nothing was relaxed, no `.first()` was introduced, and strict mode is untouched.

- `delivery-p1-31.spec.ts` — the readiness form's company and branch are addressed as `combobox`
  controls inside the form that names them, so the form's own `aria-label` ("Choose a branch to
  review delivery readiness") is no longer a second match; the Print control is matched whole, so
  "Hide the printable document" is no longer a second match; every column header is matched whole.
- `warranty-p1-31.spec.ts` — the branch control is addressed as a `combobox`, which removes three
  matches at once (the section, the form and the control) and also removes a race the ambiguity was
  hiding: this screen renders identifier fields until the branch directory answers, so the loose
  query had resolved against a textbox that was never going to be a `select`. Both tables' headers
  are matched whole, which closes a further latent ambiguity the run never reached — "Cover ends" is
  inside "Odometer reading at which cover ends".
- `reports-p1-31.spec.ts` — the three period facts are asserted inside the definition list that
  states them, matching the whole label, so the sentence printed beneath the list is no longer a
  second match.
- `audit-log-p1-31.spec.ts` — the date range, the company, the branch, the action filter and the
  apply control are addressed by role with whole names, which closes the Arabic collision between the
  "from" field and the actor field; the column headers are matched whole, which closes "Action"
  against the row-actions column.

One further defect of the same family surfaced once the ambiguities were gone, and is fixed in the
same pass: the readiness case read each row's text with a single non-retrying `innerText()`, which
raced the table's own loading rows and reported a blank verdict the screen goes on to fill. The
predicate is unchanged; it is now asserted with Playwright's own waiting.

**Class B — the six permission cases. Rewritten, and the negative was looked for and is not there.**
Verified against `apps/api/src/modules/iam/domain/bootstrap-roles.ts`: the tenant-administrator
bundle holds `rpt.report.read` (prerequisite P-1), `wty.policy.manage` (P-10) and `wty.warranty.read`
(P-7). The withheld assertions were therefore about the governed job's `acceptance:create-owner`
account and about no caller an acceptance has. The three cases now assert what is true of the caller
they are about — both reporting screens render for a holder, and the warranty plans screen offers its
create panel to the holder of the code that gates it — and each is now gated on the handoff, because
a permission case must know which caller it has.

The only reporting code the bundle is denied is `rpt.export`, excluded by explicit Owner decision on
least-privilege grounds (CC-04). It gates nothing an operator can see on any of these screens,
because no export operation for a report or for an audit record is published at all. So **no
permission negative is asserted here and none was invented.** What the cases keep instead is the
screens' own standing statement that no download is offered, recorded as the contract it is rather
than as evidence about a withheld code.

_(2026-09-15: "no export operation for a report or for an audit record is published at all" was true
when written and is no longer true for reports. A report export is published at protected `develop`
`c1a2f9fc`, and § 10.5 records the closing run's four exports and the default administrator's
refusal of each. No export for an audit record is published. The paragraph above is left as
written.)_

**Class C — the two Arabic report-title cases. Rewritten.** A published tenant report configuration
carries no translation key, so `reportTitle` shows the operator's own label as written, in both
languages. That is §6's observation **O-4** and it is correct behaviour. The catalogue case now finds
each dataset by its row's link TARGET — the report's identity, the same string in both locales — and
then requires the right KIND of name for whoever provides the row: the platform's own translated
title where the row says the system provides it, the workshop's own label where the row says the
workshop does. The four run cases read the name off the catalogue and require the run screen to be
headed with the same one, which is a stronger assertion than the typed title was: it fails if the two
screens disagree about what a report is called. Both Arabic cases now pass, around Arabic chrome —
`dir="rtl"`, the Arabic catalogue title, the Arabic period labels and the Arabic row caption.

**Class D — newly exposed, and NOT repaired: a recorded figure compared against a live read.** With
the ambiguities gone, the `work_orders_by_status` case reached its row count for the first time and
failed in both locales — the handoff records **1** row and the screen renders **2**. The cause was
measured, not inferred: the same read was issued over HTTP with the same credentials, the same branch
and the same half-open period immediately after the browser run, and **the server answered 2 rows**,
which is exactly what the screen showed. The handoff's **1** was recorded when the harness ran the
report, which is before the journey creates the second work order its second-handover case needs. The
dataset publishes its freshness as `live`, so a figure recorded at one moment does not describe it at
another. The assertion is right and was left exactly as it is: relaxing an equality that is the whole
value of the case would be the opposite of what this pass is for. The repair belongs to the harness —
record the four datasets after the journey has finished writing — and the harness is held outside
this repository (§5).

**What was captured.** The per-spec, per-locale results above, and the screens themselves: nine
screens x two locales, photographed again for this run by the companion script §5 names, into the
run's own evidence directory beside `steps.json`, `steps.md` and `summary.json`. All eighteen
answered `200` with the right document direction, and the five that idle until a target is submitted
were captured a second time with the server's answer. One correction to §3.2 while the images are in
hand: the "11 rows" recorded there for `work_orders_by_status` is the count of every `tbody` row on
the page, which is the report's rows plus the group totals beneath them — the report's own table
carried two.

**What this pass moves in [`task-matrix.md`](./task-matrix.md).** Six further rows, each with a
browser case that passed in both locales over this run's records: **FE-001** (the queue answered for
every row it showed, with a verdict in each), **FE-007** (the printable copy was produced inside the
production bundle, carried its disclaimer, and its Print control called `window.print` exactly once),
**FE-012**, **FE-013** and **FE-014** (each dataset rendered exactly the rows the server answered,
over the branch and the half-open period the HTTP half used), and **FE-015** (the log carried both
declared actions, each filtered for on its own, and offered no export). Twelve rows are now
`end-to-end verified`.

**What it does not move, and why.** **FE-011** stays where it is: its own dataset's case is the one
that still fails (class D), and a case that did not run to completion is not evidence, however well
the screen behaved. **FE-009**, **FE-010** and **FE-016** are unchanged for the reasons §6 gives;
nothing about them changed here.

**What this pass did NOT change.** No product code, no route, no permission, no migration, no gate,
no allow-list and no fixture. Four test files, this record, the task matrix and the change-control
register. §6's observations stand exactly as written, including **O-1**: the
`wo.work_order.line.manage` gap outside the tenant-administrator bundle is a finding about the
product and is untouched by anything here. **O-2** and **O-3** describe the suite defects this pass
closes, and they stay in place as the record of how they were found.

**One consequence for the governed job, stated rather than left to be discovered.** Three cases that
used to run without a handoff now skip without one — the two reporting permission cases and the
warranty one — because each is a statement about a caller, and the handoff is what names the caller.
On the governed job they will skip with that reason stated, where before they asserted a refusal that
was true only of that job's own account.

**The exclusivity window** for this pass is bounded by two measured moments: the production build of
the web tier landed at 2026-09-13T01:40:39Z, and `npm run dev:stop` reported ports 3000 and 3100 free
at 2026-09-13T01:58:28Z. Inside it: one harness run, two runs of the four P1-31 specs in both
locales, one screenshot pass and one read-only HTTP probe of the four report datasets. The handoff
was removed with `--remove-handoff` when the browser half was done, so no credential is left on disk.
The two organisations this run provisioned were **not** deleted, on the same precedent §7 states.

### 7.2 Amendment — the governed job refused the correction pass, and why it was right to

**What this amendment is.** §7.1 ends with a paragraph headed "One consequence for the governed job",
which states that three cases would begin to skip there and calls that a narrowing. It was not a
narrowing. It was a failure, and the governed job said so at the first opportunity: the
`authenticated-browser` check on this branch's head `65e27dbb` ended red at its last step, "A run that
collected nothing is a failure, not a pass", with

```
These authenticated specs contributed no executed test: reports-p1-31.spec.ts, warranty-p1-31.spec.ts
```

over a table in which nine of the eleven authenticated spec files reported a count and those two
reported `0`, for **368** executed cases in total. This section records what that step actually
requires, why §7.1's rewrite could not meet it, and what was changed so that it does.

**What the step requires, read from the workflow rather than inferred.** The guard in
`.github/workflows/_reusable-authenticated-browser.yml` walks `apps/web/tests/e2e/authenticated`,
counts per FILE the results in `playwright-report.json` whose status is not `skipped`, and fails when
any file's count is zero — separately from, and in addition to, failing when the total is zero. The
file comment says why in terms: a green run that ran nothing is the failure mode the job exists to
catch. A committed spec file is therefore obliged to contribute at least one case that executes with
what the job itself provides, and the job provides no acceptance handoff: nothing in the repository
sets `ROOTLCO_P131_HANDOFF`.

§7.1 gated on that variable the only two cases in `reports-p1-31.spec.ts` and the only case in
`warranty-p1-31.spec.ts` that did not already depend on a journey record. Both files went silent.
`delivery-p1-31.spec.ts` and `audit-log-p1-31.spec.ts` each kept one ungated case, each contributed
two executed results — one per locale project — and neither was named by the guard.

**The mistake underneath it, which is about the caller and not about the gate.** §7.1 rewrote the
three permission cases around "the acceptance signs the browser in as the first administrator of the
organisation the journey provisioned". That is true of the run §7.1 records and of no other run.
`apps/web/tests/e2e/authenticated/auth.setup.ts` takes `ROOTLCO_E2E_EMAIL` / `ROOTLCO_E2E_PASSWORD`
when they are set and otherwise reads `.local/owner-acceptance-account.json`, which
`acceptance:create-owner` wrote. The governed job sets neither variable, so it signs in as that
account, whose set is `OWNER_PERMISSIONS` in `scripts/dev/owner-acceptance/context.mjs`: **60** codes,
derived from the Administration, CRM, Vehicle and P1-28 screen surfaces. Measured against it:

| code                | held by the acceptance owner | held by a tenant administrator | what turns on it                               |
| ------------------- | ---------------------------- | ------------------------------ | ---------------------------------------------- |
| `wty.warranty.read` | yes                          | yes                            | both warranty pages' own gate                  |
| `sal.delivery.view` | yes                          | yes                            | the readiness queue, with two further codes    |
| `iam.audit.view`    | yes                          | yes                            | the audit log                                  |
| `wty.policy.manage` | **no**                       | yes                            | whether the plans screen offers a create panel |
| `rpt.report.read`   | **no**                       | yes                            | both reporting screens' own gate               |

So two callers reach these screens and they disagree about two codes. The version before §7.1 pinned
the refusal and was false for the acceptance run; §7.1 pinned the render and was false for the
governed job. Each was a case about an environment wearing the clothes of a case about a screen.

**What changed in this pass, and only this.** Two files, three cases, no handoff gate on any of them:

- `reports-p1-31.spec.ts` — the two cases that were "renders for a caller who holds the report read
  code" are now "the catalogue / the run screen answers with its surface or with a complete refusal".
  Each asserts, for either caller: the page's own heading inside `main` — scoped there because the
  sidebar renders group headings too — the document direction for its locale, and that no reporting
  screen offers a download. Then, whichever outcome is in front of it, in full. A refusal must carry
  its explanation as well as its title, must leave nothing of the surface behind the gate on the page,
  must not be dressed as an emptiness, and on the run screen must show nothing the report definition
  carries — which is what "the gate answered before `readReport` was called" looks like from a
  browser. Anything that is not a refusal must be the whole surface: the catalogue's table and its
  no-download sentence, or the run screen's run control and its "nothing has been run yet". A screen
  that answers with neither — a heading over a blank region — fails.
- `warranty-p1-31.spec.ts` — "both warranty reads are reachable, and plan creation is offered to its
  holder" is now "both warranty screens answer for the caller in front of them". The list must state
  that a branch has to be named before anything is read, and must not have read anything before one
  was. The plans screen must let the holder of `wty.warranty.read` through to its filter form, and its
  plan-creation panel must be WHOLE or ABSENT — a heading with no control offers something that
  cannot be done, and a control with no heading is a write with nothing saying what it writes. That
  assertion binds both callers, where §7.1's bound only one. Whether each screen was reached is read
  off its own surface rather than off the denial words, because the plans screen's results region
  renders the same shared refusal when the list read is turned down, and a page that was refused must
  not be confused with a page whose list was.

The plans half of the warranty case is conditional on the message catalogue, as §7.1's was, but with
an `if` and not a skip: the list half needs no slice, so it is always asserted and the plans screen is
asserted whenever it is on the checkout. The reporting cases keep the existing catalogue-key skip,
which is the pre-existing guard for a checkout without the reporting slice; the keys are present on
this branch, so both cases execute.

**What this makes the governed job measure.** Four executed cases in `reports-p1-31.spec.ts` (two
cases x two locale projects) and two in `warranty-p1-31.spec.ts`, against zero for each before, with
`delivery-p1-31.spec.ts` and `audit-log-p1-31.spec.ts` unchanged at two apiece. Every one of the
eleven committed authenticated spec files now carries at least one case that executes with what the
job provides. **The guard was not relaxed, no `.skip` was added, nothing was registered in
`.github/ci-baselines/unrun-test-tiers.json`, and no assertion was weakened**: each rewritten case
asserts strictly more than the one it replaces, because it asserts the shared contract AND the whole
of whichever branch it lands in, where its predecessor asserted one branch and was wrong about the
other half of the time.

**What is still true and still gated.** The journey-dependent cases are untouched and stay behind the
handoff: the catalogue's four datasets, the four per-dataset row counts, the warranty list, record and
plans rows. Class D of §7.1 — a figure the harness records mid-journey against a dataset declared
live — is untouched and still open.

**A finding this pass exposes and does not repair.** The handoff-gated reporting cases assert on
screens that gate on `rpt.report.read`, which the acceptance owner does not hold. They can therefore
pass only on a run whose credentials are overridden with a caller who does — which is how §7.1's run
was driven, and which nothing in the repository states or arranges. That is recorded here as a
property of the instrument, not repaired: arranging it would change how the tier signs in, which is
outside this pass.

**What was run for this pass, and what is not claimed.** Locally and without the stack:
`npx vitest run tests/ci tests/openapi-contract.test.ts` (69 files, 1991 cases), `typecheck:web`,
`lint:web` (0 errors), `format:check:web`, `validate:web-boundary`, `validate:web-topology`, the
changed-file ownership gate in both its forms — the context resolver, which resolves this branch to
the `p1-31-frontend` profile against `origin/develop`, and the check itself under that profile — and
`verify:policies`. Both recorded tiers were re-run and re-recorded, because a committed spec is an
executable path. **No hosted result is claimed by this section.** Whether the `authenticated-browser`
job goes green at the head this pass produces is a fact only that job can establish, and it is not
asserted here.

## 8. Corrected re-run 2026-09-13 (run `mtzmvemj`)

**What this section is.** The re-run the earlier sections' residue asked for, executed end to end on
a corrected harness and a corrected browser half. It supersedes nothing above it: §2 to §6 remain
the record of run `mtz2geo1`, §7.1 remains the record of the correction pass `mtz5ppq8`, and both
are left in place because a list of runs that keeps only the green one is not a record. What this
section adds is a run in which every P1-31 case passed, and the reason the last failing case was
repaired by construction rather than by a weaker assertion.

Every figure below is cited to the evidence the run wrote. The evidence directory is
`orchestration\evidence\p1-31\acceptance-20260913-1247\`, outside every git working tree; it holds
`summary.json`, `steps.json`, `steps.md`, `screens\` (28 images and `screens.json`) and
`RUN-NOTES.md`. The refused first attempt kept its own directory beside it,
`acceptance-20260913-1241-preflight\`. Nothing of either is committed.

### 8.1 The environment, confirmed read-only before and after

| fact                          | value                                                                                            | cited to          |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ----------------- |
| checkout and branch           | `wt-p12`, `feature/p1-31-acceptance-rerun` at `75157eb77195184949e93ccc8433764acd8ff82c`         | `RUN-NOTES.md` §1 |
| working tree                  | `git status --porcelain` empty before and after                                                  | `RUN-NOTES.md` §1 |
| build                         | `npm run acceptance:serve` — production `next build` + `next start`; api 35.7s, web 24.9s        | `RUN-NOTES.md` §3 |
| ports                         | API `:3000`, web `:3100`, Playwright's own `:3210`, mailbox `:54324`, database `127.0.0.1:54322` | `RUN-NOTES.md` §3 |
| window                        | 2026-09-13T09:47:23Z to 2026-09-13T10:17:46Z, when `dev:stop` reported both ports free           | `RUN-NOTES.md` §2 |
| migrations applied            | **141** before, **141** after, against 141 `supabase/migrations/*.sql`                           | `RUN-NOTES.md` §4 |
| `iam.permissions`             | **121** before, **121** after                                                                    | `RUN-NOTES.md` §4 |
| `tenant_administrator` bundle | **78** codes, uniformly across all **38** such roles                                             | `RUN-NOTES.md` §4 |
| `org.tenants`                 | **39** before, **41** after — the two this run provisioned. Never decreased; nothing deleted     | `RUN-NOTES.md` §4 |
| organisations                 | `p31_journey_a_mtzmvemj` and `p31_journey_b_mtzmvemj`                                            | `summary.json`    |

The build times, the ports and the window are the operator's own record of the session
(`RUN-NOTES.md` §2 and §3); the four environment figures are read-only SQL on 54322, recorded in
§4 of the same file with a before and an after value.

No `supabase db reset`, no `dev:reset`, no `test:db`, no `test:backend`, no mutation script and no
tenant-prefix cleanup was issued at any point in any worktree
(`…\acceptance-20260913-1247\RUN-NOTES.md` §2). The counts are read-only SQL on 54322, recorded in
that file's §4.

### 8.2 The observation point, and why class D is repaired by construction

§7.1 named a fourth defect of the instrument, class **D**: the harness recorded the report figures
in the middle of the journey and the browser compared a screen against them afterwards. Between the
two, the journey's own refusal section opens a **second** work order and a second delivery in the
same company and branch, and `work_orders_by_status` counts every non-deleted work order opened in
the period with **no state filter**. The screen was right and the figure was stale.

The repair is a rule, not an adjustment: **every figure the handoff publishes is read after the last
write of the journey.** The harness keeps its section-13 report run with its step labels unchanged —
so the narrative of "the reports answered at this point in the chain" is unbroken — and a final pass
at the end re-reads all four datasets over the same period with the same token and **overwrites**
what the handoff carries. Only the overwritten value reaches the browser.

Two consequences a reader of the two records needs:

- the final pass appends **eighteen** steps, so **176 became 194** and every step number after the
  refusal cases is shifted by **+18** relative to §2's table. **Compare the two runs by step LABEL,
  never by number.**
- the case that failed in §7.1 now passes, and **the figure that repaired it is the ROW count**.
  The assertion is `reports-p1-31.spec.ts:462`, `toHaveCount(echoed.rows)`, against
  `reportRuns.<code>.rows` from the handoff. For `work_orders_by_status` the mid-journey run
  answered **1** row — step **130**, `report run: work_orders_by_status over a half-open day
period`, `{"rows":1,"groups":9}` (`steps.md:132`) — and the final pass answered **2** — step
  **177**, `report run (after the last write): work_orders_by_status`, `{"rows":2,"groups":9}`
  (`steps.md:179`). The second work order is the difference, and 2 is what the handoff published
  and what the screen rendered. The GROUP count is **9** in both runs and is not what changed:
  the nine groups are the nine states of the graph, counted whether or not any order is in them.
  The case passed in `authenticated-en` and in `authenticated-ar`.

The traffic is one-way and stays so: nothing a browser observed is written back into the handoff.
The handoff is what the server answered.

### 8.3 The journey, step by step

Run `mtzmvemj`, started **2026-09-13T09:50:30.859Z**, finished **2026-09-13T09:50:46.827Z**, exit
code **0**, verdict **PASS**, **194 steps, 0 findings**, `auditActionsPresent` **true**
(`…\acceptance-20260913-1247\summary.json`). The harness's own notes, verbatim from that file:

- organisation A was provisioned already active; the status route was not called
- organisation B was provisioned already active; the status route was not called
- work order left in in_progress: the platform state graph has no completed state, and the
  remaining hops are taken at closure time
- the opened quality-control record carries no checks, so no per-check result was recorded; the
  finalisation below is what the release gate reads
- the preview reported 1 line(s); every amount below is the string the server published

The four datasets answered, every measure a decimal string, currency JOD, timezone `Asia/Amman`,
freshness live: `work_orders_by_status` **9** groups with `closed` 1 and `draft` 1;
`technician_labor_time` **1** group; `inventory_movements` **1** group, `12.000` in and `0.000` out;
`invoice_payment_summary` invoiced `45.0000`, outstanding `0.0000`, receipts `45.0000` fully
allocated.

The table below is `…\acceptance-20260913-1247\steps.md` as the harness wrote it. `detail` is the
harness's own record of what the response carried; the untruncated value is in `steps.json`.

| #   | step                                                                                                                          | status       | correlation id                         | detail                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | platform operator: password reset requested                                                                                   | 202          | `eef5b975-7c7e-41e0-847b-b5b22310d53f` | `{}`                                                                                                                                                                                   |
| 2   | platform operator: recovery link read out of the local mailbox                                                                | found        | -                                      | `{"messageId":"37t7sN3XNSeCQceyeQXJqg"}`                                                                                                                                               |
| 3   | platform operator: credential set through the shipped completion route                                                        | 200          | `a0c43807-ecb0-48af-aa4f-9d92a3ae429a` | `{}`                                                                                                                                                                                   |
| 4   | platform operator: login                                                                                                      | 200          | `43fbeed7-1c2f-4c49-a03d-1878ab410df2` | `{}`                                                                                                                                                                                   |
| 5   | organisation A provisioned through platform.organization-provision                                                            | 201          | `5b0f5055-1f02-44bc-a664-1aae55c7a500` | `{"tenantId":"92aaa8f3-366f-44b9-baf7-cf4ebcd357fb","activated":true}`                                                                                                                 |
| 6   | organisation B provisioned through platform.organization-provision                                                            | 201          | `e8fb3f9d-67b7-4573-a64c-b4cb09f9da4c` | `{"tenantId":"42d9b45d-a3b1-4b36-9260-cdfb46ea53fc","activated":true}`                                                                                                                 |
| 7   | owner A: password reset requested                                                                                             | 202          | `88709eea-3193-4e23-b37e-cde98bfff6be` | `{}`                                                                                                                                                                                   |
| 8   | owner A: recovery link read out of the local mailbox                                                                          | found        | -                                      | `{"messageId":"3AMPIymiqyVMUXxVzQLvJX"}`                                                                                                                                               |
| 9   | owner A: credential set through the shipped completion route                                                                  | 200          | `14530dae-e382-4a43-85cb-70460dfb8fd9` | `{}`                                                                                                                                                                                   |
| 10  | owner A: login                                                                                                                | 200          | `909c8610-6dc8-41ef-bd84-43580511581a` | `{}`                                                                                                                                                                                   |
| 11  | owner B: password reset requested                                                                                             | 202          | `d996cbbd-ab2e-4548-a917-294d11905c30` | `{}`                                                                                                                                                                                   |
| 12  | owner B: recovery link read out of the local mailbox                                                                          | found        | -                                      | `{"messageId":"2QE0FM04hhRoCwWjJIWcw0"}`                                                                                                                                               |
| 13  | owner B: credential set through the shipped completion route                                                                  | 200          | `df016166-8ad8-4361-a31b-0e6be83008c0` | `{}`                                                                                                                                                                                   |
| 14  | owner B: login                                                                                                                | 200          | `813c3277-41fd-49de-b3bc-084d3de1a9b2` | `{}`                                                                                                                                                                                   |
| 15  | owner A session (permission count must be 78)                                                                                 | 200          | `1916fb47-95cf-4d76-8539-cfc5066462a7` | `{"permissions":78}`                                                                                                                                                                   |
| 16  | the first administrator holds the whole tenant-administrator bundle                                                           | 78           | -                                      | `{"held":78,"expected":78}`                                                                                                                                                            |
| 17  | owner A: branch list                                                                                                          | 200          | `0ca1f96b-dcef-4d29-9c67-fc9651ae2177` | `{"count":1}`                                                                                                                                                                          |
| 18  | service category created                                                                                                      | 201          | `253f6c27-3f56-47a6-bc71-5f0835324628` | `{"id":"e9b3ee42-8310-43ea-b03c-d4999a9d17ad"}`                                                                                                                                        |
| 19  | service created                                                                                                               | 201          | `45ea7b01-c18d-44f7-9401-2a9762c1014e` | `{"id":"621a5fab-3eab-41c8-8bad-5cff56a282a4","recordVersion":1}`                                                                                                                      |
| 20  | service version created                                                                                                       | 201          | `44a5f9c2-5951-4dff-b588-ef8ed4a8f709` | `{"id":"8800312f-0878-4c35-9199-3c054798c45f","state":null}`                                                                                                                           |
| 21  | service version published                                                                                                     | 200          | `eb85964f-d89a-4eaa-860e-63d35526aa9e` | `{"state":null}`                                                                                                                                                                       |
| 22  | service made available at the branch                                                                                          | 200          | `e56292b1-ba95-416c-aba7-1928af514ecd` | `{}`                                                                                                                                                                                   |
| 23  | price list created                                                                                                            | 201          | `b2e6965d-6044-4ee7-97bf-7374837e2062` | `{"id":"5cf62c2a-995b-42b7-bd46-e44338603642","recordVersion":1}`                                                                                                                      |
| 24  | price list version created (If-Match = the LIST record version)                                                               | 201          | `51d5b0d7-f0a7-4865-8ee4-436fb01589ac` | `{"id":"29cbe0bf-c73a-411d-a9a9-b0de3687ee91"}`                                                                                                                                        |
| 25  | price rule recorded (amount as a decimal string)                                                                              | 201          | `9f9e70b3-806f-4cb1-aa86-452d45927587` | `{"amount":"45.0000"}`                                                                                                                                                                 |
| 26  | price list version published (If-Match = the LIST record version)                                                             | 200          | `302abca2-19bf-4880-8deb-e46ff50c1249` | `{}`                                                                                                                                                                                   |
| 27  | price list assigned to the branch                                                                                             | 201          | `a44db126-d295-49eb-a373-db9ce492954f` | `{"id":"9ed1d56d-2b72-42fa-9d6d-072dba6d5153"}`                                                                                                                                        |
| 28  | price RESOLVED by the server                                                                                                  | 200          | `2ae9d5ff-ee04-4c34-a065-91a930f6bb34` | `{"amount":null,"currency":"JOD"}`                                                                                                                                                     |
| 29  | item category created                                                                                                         | 201          | `a3913e58-22e2-48a0-b5f0-228890422783` | `{"id":"171cb5f0-d290-4957-8b1e-aea45d254aa3"}`                                                                                                                                        |
| 30  | unit list (the 'each' platform code must be offered)                                                                          | 200          | `8e1f4b26-2ecd-452a-930e-285714923e95` | `{"count":12}`                                                                                                                                                                         |
| 31  | item created (catalogue row, no cost, no stock)                                                                               | 201          | `2c478178-0cb9-4fd5-a9fb-b998ef755a09` | `{"id":"1bf16f77-1e95-4e68-8b84-4fa09abdcf37"}`                                                                                                                                        |
| 32  | warehouse created                                                                                                             | 201          | `d40b516f-ff60-495c-8ca3-c58e6430e013` | `{"id":"3083bffa-60a3-47f0-8b68-24ea055b03e4"}`                                                                                                                                        |
| 33  | storage place created inside the warehouse                                                                                    | 201          | `91d6e8a6-60fb-4d25-a7dc-74f1a2b4ad53` | `{"id":"52428c97-be20-4ead-b7d8-1becc2f2b7cc"}`                                                                                                                                        |
| 34  | opening batch opened                                                                                                          | 201          | `4e36c01f-3f37-4bb2-96b6-a29b8f76cf14` | `{"id":"2514c224-8423-47c6-bcd1-cfd5e04e4622","state":null}`                                                                                                                           |
| 35  | opening line added (quantity as a decimal string)                                                                             | 201          | `c014a995-b192-4dd4-b4a7-f67c424a32f0` | `{"quantity":"12.000"}`                                                                                                                                                                |
| 36  | CASE: the counter approving their own batch is REFUSED (maker != checker)                                                     | 409          | `995b9d88-19c6-4d45-8774-e09c17d82a3c` | `{"code":"ERR-TRN-001"}`                                                                                                                                                               |
| 37  | second person: role list, to find the administrator role                                                                      | 200          | `a164d268-228f-436a-a01b-456c162d71e6` | `{"count":2}`                                                                                                                                                                          |
| 38  | second person invited with the administrator role                                                                             | 201          | `bd882f2c-eb72-4bb4-aeca-81f92d41d80c` | `{"state":"invited"}`                                                                                                                                                                  |
| 39  | second person: password reset requested                                                                                       | 202          | `0f3f9f1e-b4be-47f7-9e79-7d419ff946bd` | `{}`                                                                                                                                                                                   |
| 40  | second person: recovery link read out of the local mailbox                                                                    | found        | -                                      | `{"messageId":"7BCCJn0uh505gfdi1Jg3OY"}`                                                                                                                                               |
| 41  | second person: credential set through the shipped completion route                                                            | 200          | `852364bd-b0e4-4b5f-baa6-48f78c24c557` | `{}`                                                                                                                                                                                   |
| 42  | second person BEFORE activation: login                                                                                        | 401          | `d53c84e7-9053-434b-ae08-751b2bddcee5` | `{}`                                                                                                                                                                                   |
| 43  | second person activated by the administrator                                                                                  | 200          | `6ed59c92-9223-4f8f-ba2d-be95884ddc55` | `{"state":"active"}`                                                                                                                                                                   |
| 44  | second person granted the administrator role at the branch                                                                    | 201          | `743fff53-862d-44a6-a4ca-896cf06a2716` | `{"id":"8c996c84-2b5a-440b-8916-f509d74c2b05"}`                                                                                                                                        |
| 45  | second person (after activation): login                                                                                       | 200          | `9368dea6-6100-4de0-9ee2-8fc4e4990fc2` | `{}`                                                                                                                                                                                   |
| 46  | batch APPROVED by the second person                                                                                           | 200          | `06872693-ce02-40f5-b9f4-21c96d76975d` | `{"state":null}`                                                                                                                                                                       |
| 47  | CASE: the same approval replayed under the same key is not a second approval                                                  | 200          | `98d94492-6bc6-4600-9cf7-a4792a0a6dc5` | `{"state":null,"replayed":null}`                                                                                                                                                       |
| 48  | ON HAND after approval, as the server publishes it                                                                            | 200          | `df29c833-48a7-4a65-93be-b2b8371524de` | `{"cells":[{"onHand":"12.000","available":"12.000"}]}`                                                                                                                                 |
| 49  | movement ledger shows the opening row                                                                                         | 200          | `6a27b522-68ee-4ca8-9855-e5c6a889e76d` | `{"count":1,"types":["opening"]}`                                                                                                                                                      |
| 50  | first journey: customer created                                                                                               | 201          | `5750b352-7ff0-4f61-a9b5-c451b8e41acf` | `{"customerId":"3b1f6d85-6dbe-4dd1-9de6-7af88be7fbf0","displayNumber":"000001"}`                                                                                                       |
| 51  | first journey: vehicle created                                                                                                | 201          | `e8767502-6ee9-4f50-865f-ef272ed1b41d` | `{"vehicleId":"234f0515-dd5b-41c6-8491-8b62a9562e0a","lifecycle":"draft"}`                                                                                                             |
| 52  | first journey: vehicle linked to the customer                                                                                 | 201          | `b8d890cc-c0fd-4df7-ac29-6ca856ca035f` | `{}`                                                                                                                                                                                   |
| 53  | first journey: reception created (walk-in)                                                                                    | 201          | `b91c8e0f-ccdc-4311-8117-b4e31076ee82` | `{"receptionVisitId":"7c11575a-92fb-4bed-bfa7-e839a816c4d9","receptionStatus":"opened","recordVersion":1}`                                                                             |
| 54  | first journey: the customer recorded on the visit as the authorized receiver                                                  | 201          | `3e3eba05-a1c8-40d7-8b7b-5d77ed5348f7` | `{"role":"authorized_receiver"}`                                                                                                                                                       |
| 55  | first journey: the customer AUTHORIZES the work                                                                               | 201          | `13f0fb44-4055-4582-b534-033e8794c1a7` | `{"decision":"approved"}`                                                                                                                                                              |
| 56  | first journey: reception detail, for its record version                                                                       | 200          | `f1650895-f371-413c-8f5f-05fad1af9b7c` | `{"receptionStatus":"opened","recordVersion":1}`                                                                                                                                       |
| 57  | first journey: reception approved                                                                                             | 200          | `78393f9c-39bd-4ca9-acbb-76dae3024a76` | `{"receptionStatus":"authorized","recordVersion":3}`                                                                                                                                   |
| 58  | first journey: reception converted to a WORK ORDER                                                                            | 200          | `7e4a988e-8c0d-454b-8e56-a94ad6be8d23` | `{"workOrderId":"950c3fb5-c27e-4924-bc6b-97e3eb9f2d46"}`                                                                                                                               |
| 59  | employee added to the branch register (active)                                                                                | 201          | `f5b6623d-9df4-49ec-9daa-03ecdfd55e31` | `{"id":"e83c67df-6e04-4227-9ce5-b8af086a6663","status":"active"}`                                                                                                                      |
| 60  | technician profile created for the signed-in account                                                                          | 201          | `1fbe57ba-27a7-4863-a638-a3e812990a20` | `{"id":"cf7eb9e4-980b-416d-8cb8-3f251742e43b"}`                                                                                                                                        |
| 61  | work order detail, for the If-Match the open transition needs                                                                 | 200          | `f2c188f2-88eb-4311-946c-50d6c82e1f68` | `{"state":"draft","recordVersion":1,"nextStates":["cancelled","open"]}`                                                                                                                |
| 62  | work order transitioned to open                                                                                               | 200          | `7b4e8b16-1122-46b0-8c4c-3c8a44e33348` | `{"state":"open","from":"draft","offered":["cancelled","open"]}`                                                                                                                       |
| 63  | work order detail, for the If-Match the in_progress transition needs                                                          | 200          | `45eeabc4-3b00-42ea-ba88-0ef3fca00cc3` | `{"state":"open","recordVersion":2,"nextStates":["cancelled","in_progress"]}`                                                                                                          |
| 64  | work order transitioned to in_progress                                                                                        | 200          | `e794eb87-c365-428c-936f-2a6d8ce62aac` | `{"state":"in_progress","from":"open","offered":["cancelled","in_progress"]}`                                                                                                          |
| 65  | job created on the work order                                                                                                 | 201          | `d0b308f0-44c7-41d9-a35d-c3b9170c4fd5` | `{"id":"d8998310-2b33-404f-b630-d824808028cc","state":"planned","recordVersion":1}`                                                                                                    |
| 66  | technician availability recorded, so the assignment has a window to sit in                                                    | 201          | `389a4cb5-c3f4-4bca-8e23-0291c7069aea` | `{"id":"26c2a05a-f559-4bb6-87c7-972d06d9cdf3","kind":"available"}`                                                                                                                     |
| 67  | job assigned to the technician                                                                                                | 201          | `831fc053-bc09-4945-a00f-09d46471b669` | `{"id":"81fd4cf2-4a0b-48df-a9fe-933c285c3439"}`                                                                                                                                        |
| 68  | job transitioned to assigned, which is the first state that permits labour                                                    | 200          | `aa730063-1980-4318-8091-2021a1b7c94a` | `{"state":"assigned"}`                                                                                                                                                                 |
| 69  | labour session started                                                                                                        | 201          | `3e9b2aee-63b3-4afe-b000-ba750d743999` | `{"id":"460d157c-077c-46f1-8b72-626aff031793","recordVersion":1}`                                                                                                                      |
| 70  | labour session STOPPED, so the recorded time is a closed interval                                                             | 200          | `fed6f689-4b7f-45eb-9800-0276a910a0c3` | `{"endedAt":"2026-09-13T09:50:38.686Z"}`                                                                                                                                               |
| 71  | work log recorded against the job                                                                                             | 201          | `84311d80-dc01-4524-b99c-fa62d07eb0f7` | `{"id":"c93adaf8-cd36-48e4-8270-da6694cf7ec2"}`                                                                                                                                        |
| 72  | job transitioned to in_progress                                                                                               | 200          | `8ff24e27-5878-4814-87f0-d437b44013e5` | `{"state":"in_progress"}`                                                                                                                                                              |
| 73  | job transitioned to completed, which is terminal                                                                              | 200          | `0524c11d-8767-4187-aa23-10b54a2837ee` | `{"state":"completed"}`                                                                                                                                                                |
| 74  | quality-control record opened                                                                                                 | 201          | `a1b97adb-3ba7-4f9a-9fe4-c808fd373b3a` | `{"id":"f35a0c66-4395-42d9-8f84-0131660a6b07","overallResult":"pending"}`                                                                                                              |
| 75  | quality-control record read, for its checks and record version                                                                | 200          | `d9c9855a-fa80-473f-8b5c-bba9f4124d6b` | `{"checks":0,"recordVersion":null}`                                                                                                                                                    |
| 76  | quality-control record re-read, for the If-Match the finalisation needs                                                       | 200          | `152ddf50-8aab-440f-a22f-f93a9866e380` | `{"recordVersion":null}`                                                                                                                                                               |
| 77  | quality control FINALISED passed                                                                                              | 200          | `dea71a0d-7a10-43d3-9310-a8e26380dbdf` | `{"overallResult":"passed"}`                                                                                                                                                           |
| 78  | quotation raised on the work order, priced from the published price list                                                      | 201          | `0b63b5b4-66a2-4a87-91cd-f3f38c07055d` | `{"id":"4e1dceba-ff14-41a2-800b-058963f6c33a","quotationNumber":"000001","revisionId":"a4ca6e39-30ed-4151-b4c1-197d690e84b8","grandTotal":"0.0000","recordVersion":1}`                 |
| 79  | quotation ISSUED to the customer (If-Match = the QUOTATION version)                                                           | 200          | `3b408ee4-f044-455e-ab0f-f9f9be5f693c` | `{"status":"issued","recordVersion":2}`                                                                                                                                                |
| 80  | the customer APPROVES the revision, in person — the invoice’s commercial source                                               | 201          | `6e79e638-e119-48a0-871c-7d1b593ed5fc` | `{"decided":1,"rollUp":null}`                                                                                                                                                          |
| 81  | invoice preview (the server figures, not ours)                                                                                | 200          | `a98fda2c-cfce-4ce8-98a8-f76ceeaaa48c` | `{"lines":1}`                                                                                                                                                                          |
| 82  | invoice created (draft), naming the payer explicitly                                                                          | 201          | `42de0bec-882e-45be-bf88-d320f9d64dac` | `{"id":"e96acf42-aa74-4afd-9738-0c7c33f9180b","status":"draft","recordVersion":1}`                                                                                                     |
| 83  | invoice ISSUED with a number from the branch sequence (If-Match = the INVOICE version)                                        | 200          | `25c14d66-5c9e-416e-8ad5-de0cda6bb8a3` | `{"invoiceNumber":"000001","status":"issued"}`                                                                                                                                         |
| 84  | invoice detail after issue                                                                                                    | 200          | `03bd5d2d-e709-4dd5-8efe-ec15487085bb` | `{"status":"issued","invoiceNumber":"000001","gross":"45.0000","currency":"JOD"}`                                                                                                      |
| 85  | payment methods (the tenant cash method must be present)                                                                      | 200          | `9674c1fa-2405-4363-a2af-acb755e36683` | `{"codes":["bank_transfer","card_terminal","cash","bank_transfer","card_terminal","cash"]}`                                                                                            |
| 86  | receipt recorded for the issued amount                                                                                        | 201          | `5d8898bd-c7e8-46ad-8536-786c34911b91` | `{"id":"bcfaac29-04a2-48f7-bac4-b5c442bab600","reference":"000001"}`                                                                                                                   |
| 87  | receipt ALLOCATED to the invoice                                                                                              | 201          | `fe61bce2-fe22-40a6-92ea-0cf2db39a500` | `{"id":"9c692fc9-5c6d-4fb7-8ad7-08800f55b688"}`                                                                                                                                        |
| 88  | OUTSTANDING after allocation, as the server publishes it                                                                      | 200          | `28d4b371-934a-4a12-8a93-a572bcd88265` | `{"outstanding":"0.0000","isSettled":true}`                                                                                                                                            |
| 89  | closure eligibility read                                                                                                      | 200          | `d9e0a0ab-468e-48e2-a459-4965ba3bd06a` | `{"eligible":true,"blockers":[]}`                                                                                                                                                      |
| 90  | work order detail, for the If-Match the qc_pending transition needs                                                           | 200          | `d52bc046-15e9-47c1-a2c2-e143dd478f66` | `{"state":"in_progress","recordVersion":3,"nextStates":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                               |
| 91  | work order transitioned to qc_pending                                                                                         | 200          | `39167d25-d441-440f-931e-5c798bde9de3` | `{"state":"qc_pending","from":"in_progress","offered":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                                |
| 92  | work order detail, for the If-Match the ready_to_close transition needs                                                       | 200          | `4e3faa6e-58bb-4903-9823-8b16113b8114` | `{"state":"qc_pending","recordVersion":4,"nextStates":["in_progress","ready_to_close"]}`                                                                                               |
| 93  | work order transitioned to ready_to_close                                                                                     | 200          | `4194dc30-1bb7-4af6-9866-6abff397ce71` | `{"state":"ready_to_close","from":"qc_pending","offered":["in_progress","ready_to_close"]}`                                                                                            |
| 94  | work order CLOSED with If-Match                                                                                               | 200          | `2090d5d9-d7d6-40f4-bf29-162913febf5d` | `{"state":"closed"}`                                                                                                                                                                   |
| 95  | handover checklist template created with two mandatory items                                                                  | 201          | `2f0271b8-fcdc-4201-a3f7-ccf3bf582053` | `{"id":"fdccafa1-0890-4b0d-81f6-23c951b4fa0f","items":2,"recordVersion":1}`                                                                                                            |
| 96  | checklist template read, for its items and record version                                                                     | 200          | `89088762-7176-4f1a-abb4-816fffaac6da` | `{"items":2,"status":"active","recordVersion":1}`                                                                                                                                      |
| 97  | checklist template status set ACTIVE                                                                                          | 200          | `fafc021f-1909-4c53-a1f9-229d7a9a171b` | `{"status":"active"}`                                                                                                                                                                  |
| 98  | warranty policy created with one coverage window                                                                              | 201          | `6ad1e4ea-4f20-46a8-a49d-5c750afc8066` | `{"id":"2800823b-bbd3-4727-b9e2-58a23a00acfd","coverage":1,"recordVersion":1}`                                                                                                         |
| 99  | a second, service-only coverage window added to the policy                                                                    | 201          | `79e7f797-6d9d-45e2-996e-ea846bfe3ead` | `{"id":"e9ecf6b9-e10f-4c95-a1b9-9a6750269bf6","coveredScope":"service"}`                                                                                                               |
| 100 | readiness queue: the closed work order is present with its four facts                                                         | 200          | `6329bd57-f5d2-4e90-95b0-2aacf47f43a6` | `{"count":1,"present":true,"facts":[{"blocker":"work_order_not_complete","established":true},{"blocker":"quality_control_not_passed","established":true},{"blocker":"financial_bal...` |
| 101 | all four work-order facts were ESTABLISHED, not assumed blocking                                                              | 4            | -                                      | `{"facts":[{"blocker":"work_order_not_complete","established":true,"source":"@/modules/work-order — wo.work_orders.state against wo.work_order_states"},{"blocker":"quality_contro...` |
| 102 | delivery opened for the work order                                                                                            | 201          | `87d61e13-6b68-462a-a662-abc3bd6a11c9` | `{"id":"05977542-b780-4872-bb74-c3c15f918149","status":"ready","recordVersion":1}`                                                                                                     |
| 103 | CASE: the same body under the SAME key is a replay, not a second delivery                                                     | 200          | `5a3fb8f0-46e7-4e3f-9629-31e5f3f0fb7d` | `{"id":"05977542-b780-4872-bb74-c3c15f918149","replayed":false}`                                                                                                                       |
| 104 | the replay answered the SAME delivery id                                                                                      | same row     | -                                      | `{"first":"05977542-b780-4872-bb74-c3c15f918149","replayed":"05977542-b780-4872-bb74-c3c15f918149"}`                                                                                   |
| 105 | CASE: a SECOND key for the same work order is refused (one live delivery only)                                                | 409          | `2e2e99e5-d43a-4496-b403-7ddb7e3510c0` | `{"code":"ERR-RES-002"}`                                                                                                                                                               |
| 106 | eligibility read before any handover evidence                                                                                 | 200          | `9b3d34fb-60ec-4c46-aebb-6c88a985e8e3` | `{"eligible":false,"blockers":["checklist_incomplete","receiver_not_verified","signature_missing"],"recordVersion":1}`                                                                 |
| 107 | authorized receiver verified against the visit roles                                                                          | 201          | `4584147c-c4ef-4ba0-bf7f-bf4ee6781da8` | `{"id":"eb353250-c3ad-427f-bcec-21e70eb81006","deliveryStatus":"receiver_verified"}`                                                                                                   |
| 108 | signature document: upload authorized against the reception visit                                                             | 201          | `2966c5fb-4cdc-4088-9f05-d07322d01c49` | `{"documentId":"bf19d3b7-855a-43d6-ab79-507d77264164","method":"PUT"}`                                                                                                                 |
| 109 | signature document: bytes stored at the presigned destination                                                                 | 200          | -                                      | `{"bytes":67}`                                                                                                                                                                         |
| 110 | signature document: version registered and scanned                                                                            | 201          | `91a8099a-fdbc-4768-a013-f50f34a1d03f` | `{"versionId":"6bf5a8d8-d51f-4778-aafe-61142fbc99fa","status":"accepted","scanStatus":"clean"}`                                                                                        |
| 111 | signature document: linked to the reception visit, which is its provenance                                                    | 201          | `ac95b77b-a15e-4dd9-9570-e0a7539b4160` | `{"linkId":"2b3784ad-ff83-4264-ae77-e270ce5b3dfb"}`                                                                                                                                    |
| 112 | the receiver's signature bound to the delivery by reference                                                                   | 201          | `1be5fbbe-0c3f-4fc5-8d86-b40be2f1f1f3` | `{"id":"d5219a99-f1b1-4dba-84cd-25ed1cfacae2"}`                                                                                                                                        |
| 113 | checklist item recorded as passed: keys_returned                                                                              | 201          | `92745bd8-b2e4-42ff-8058-8b219b9497da` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 114 | checklist item recorded as passed: documents_returned                                                                         | 201          | `24381b46-4b65-44f5-97e0-2cba00cd2bbe` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 115 | eligibility read again: every fact established, no blocker, and the version to use                                            | 200          | `042bcd06-2a4a-4f97-a042-adf03ae9f2a5` | `{"eligible":true,"blockers":[],"facts":[{"blocker":"delivery_state_invalid","established":true},{"blocker":"work_order_not_complete","established":true},{"blocker":"quality_cont...` |
| 116 | CASE: a STALE If-Match on completion is refused                                                                               | 409          | `127660e9-a616-4b0b-9ff0-8b7d941c459c` | `{"code":"ERR-CON-001"}`                                                                                                                                                               |
| 117 | delivery COMPLETED: custody released and the final odometer captured                                                          | 200          | `1e5c4f18-157c-4f33-a787-2ce15f69fec5` | `{"status":"delivered","deliveredAt":"2026-09-13T09:50:41.831Z"}`                                                                                                                      |
| 118 | delivery read: the record is delivered                                                                                        | 200          | `40f49776-5678-4c19-b72c-4e9770d3bc3f` | `{"status":"delivered","finalOdometerReadingId":"0bc45868-48de-43e4-9e8c-c5536a6fc4c5"}`                                                                                               |
| 119 | status history: every stage the handover passed through                                                                       | 200          | `6f48bfc5-8a2d-4886-9f1d-c861ffc5295d` | `{"stages":["delivered","signed","receiver_verified","ready"]}`                                                                                                                        |
| 120 | warranty generated from the delivered handover under the named policy                                                         | 201          | `e260797e-0c59-4f36-b774-f5b519c54ddf` | `{"id":"59b5adc0-19bf-42c8-9c19-998fc88e4787","status":"issued","expiryDate":"2027-09-13"}`                                                                                            |
| 121 | warranty list for the branch contains the vehicle's new warranty                                                              | 200          | `dccdbe84-a60e-4095-8d84-df12ada6e4ce` | `{"count":1,"present":true}`                                                                                                                                                           |
| 122 | warranty detail: its terms and what it covers                                                                                 | 200          | `044056af-453b-4e96-b2eb-661c1fde1c0c` | `{"status":"issued","startDate":"2026-09-13","expiryDate":"2027-09-13","odometerLimit":"32346","policyCode":"p31_mtzmvemj_wty","coveredScope":"all"}`                                  |
| 123 | warranty plans list, as the plans screen reads it                                                                             | 200          | `333cbd1f-6ef8-4b79-a617-4129b24c5e2b` | `{"count":1,"codes":["p31_mtzmvemj_wty"]}`                                                                                                                                             |
| 124 | report configuration created for work_orders_by_status                                                                        | 201          | `a5e82e5f-58a9-4e95-8e9b-1ebc8a64ecc1` | `{"id":"316dd9ac-f9e3-4ec4-b826-1074241b9fc9","recordVersion":1}`                                                                                                                      |
| 125 | configuration version created (parameterSchema omitted, not empty)                                                            | 201          | `19a15b66-a42d-4377-8719-b81f3692f203` | `{"id":"ca08d196-6771-4052-b2c1-a7374cb0a4f4","versionNumber":1}`                                                                                                                      |
| 126 | configuration read, for the If-Match the publish needs                                                                        | 200          | `678f0c64-8d9f-499e-933e-c3a5dc10a982` | `{"status":"draft","recordVersion":1}`                                                                                                                                                 |
| 127 | configuration version PUBLISHED                                                                                               | 200          | `6c256b8d-4aec-4276-a78c-9125e2bdd539` | `{"publishedAt":"2026-09-13T09:50:42.527Z","recordVersion":2}`                                                                                                                         |
| 128 | configuration status set published                                                                                            | 200          | `9c436781-423f-42e1-9dee-614634db5a3f` | `{"status":"published"}`                                                                                                                                                               |
| 129 | report catalogue offers all four dataset codes                                                                                | 200          | `7a89cfff-eb56-42fb-9733-0914de3fd7d5` | `{"count":4,"missing":[],"executable":[{"reportCode":"technician_labor_time","executable":true},{"reportCode":"inventory_movements","executable":true},{"reportCode":"invoice_paym...` |
| 130 | report run: work_orders_by_status over a half-open day period                                                                 | 200          | `aafef9a5-fbc6-4bfe-b068-c1d124718e6f` | `{"timezone":"Asia/Amman","rows":1,"groups":9,"freshness":"live"}`                                                                                                                     |
| 131 | report run: technician_labor_time over a half-open day period                                                                 | 200          | `371294e6-5d65-4c8f-8a41-5d061e2f4cf7` | `{"timezone":"Asia/Amman","rows":1,"groups":1,"freshness":"live"}`                                                                                                                     |
| 132 | report run: inventory_movements over a half-open day period                                                                   | 200          | `3fdacb87-e02c-45ad-a085-10511c80ace4` | `{"timezone":"Asia/Amman","rows":1,"groups":1,"freshness":"live"}`                                                                                                                     |
| 133 | report run: invoice_payment_summary over a half-open day period                                                               | 200          | `fe15499a-0ec8-425f-862f-e4f81aece336` | `{"timezone":"Asia/Amman","rows":2,"groups":2,"freshness":"live"}`                                                                                                                     |
| 134 | audit log for the branch carries the completion and the warranty issue                                                        | 200          | `b7de7fc7-bc58-44b0-8f40-5d2be86ea7a6` | `{"count":44,"missing":[]}`                                                                                                                                                            |
| 135 | both declared audit actions were really written                                                                               | both present | -                                      | `{"missing":[]}`                                                                                                                                                                       |
| 136 | refusal journey: customer created                                                                                             | 201          | `c2d22813-2e20-480b-a545-5e08035f32f8` | `{"customerId":"fe43d687-578e-4e24-9e39-26e853c434a9","displayNumber":"000002"}`                                                                                                       |
| 137 | refusal journey: vehicle created                                                                                              | 201          | `9b1c1b17-dae3-4dfd-9202-2f4453357af1` | `{"vehicleId":"ee3c9734-27c9-4ecf-a527-ece285a5a027","lifecycle":"draft"}`                                                                                                             |
| 138 | refusal journey: vehicle linked to the customer                                                                               | 201          | `2893feea-2402-4d26-bf26-dc794ad5e3d5` | `{}`                                                                                                                                                                                   |
| 139 | refusal journey: reception created (walk-in)                                                                                  | 201          | `f9835a2f-99d8-4fce-9ddf-9938324b4c4b` | `{"receptionVisitId":"c99354f2-b9cb-49e1-bde8-dcc64638a62b","receptionStatus":"opened","recordVersion":1}`                                                                             |
| 140 | refusal journey: the customer recorded on the visit as the authorized receiver                                                | 201          | `b2084b99-ef57-4497-8de9-fc4b28e98739` | `{"role":"authorized_receiver"}`                                                                                                                                                       |
| 141 | refusal journey: the customer AUTHORIZES the work                                                                             | 201          | `07497d32-fbff-48b7-92ef-b00d99790216` | `{"decision":"approved"}`                                                                                                                                                              |
| 142 | refusal journey: reception detail, for its record version                                                                     | 200          | `a85d3bf5-0a99-42f1-9544-10ef845c2e4f` | `{"receptionStatus":"opened","recordVersion":1}`                                                                                                                                       |
| 143 | refusal journey: reception approved                                                                                           | 200          | `60c9b274-2573-4cb3-a2e8-24488da3b600` | `{"receptionStatus":"authorized","recordVersion":3}`                                                                                                                                   |
| 144 | refusal journey: reception converted to a WORK ORDER                                                                          | 200          | `daf36e0b-dc93-4ef9-8f1d-1aa2c45a1d4c` | `{"workOrderId":"b1a46a46-2445-43b9-999c-02ae7c777199"}`                                                                                                                               |
| 145 | a second employee added to the register, to be retired                                                                        | 201          | `a8b091a0-df1a-427e-bc94-5318ec04f151` | `{"id":"b9fa866d-8c6d-4887-b772-383b1dc76b54","status":"active","recordVersion":1}`                                                                                                    |
| 146 | that employee set inactive                                                                                                    | 200          | `a7af0bc5-8b55-43bd-861e-3416a4f93331` | `{"status":"inactive"}`                                                                                                                                                                |
| 147 | CASE: a RETIRED employee named as the person handing over is refused at Start                                                 | 422          | `7f54ab55-d3f9-4c97-80b0-6d18de11de85` | `{"code":"ERR-VAL-001","rules":["inactive_employee"]}`                                                                                                                                 |
| 148 | a second handover opened with the ACTIVE employee                                                                             | 201          | `77642fef-2c70-4846-9373-da798687ce61` | `{"id":"5d4732c6-58ab-41da-aa7d-2465d4c0256e","recordVersion":1}`                                                                                                                      |
| 149 | second handover: receiver verified                                                                                            | 201          | `96e3cad1-9f52-4515-a3a1-4dbb89bac0b3` | `{"id":"7a969f47-c694-4363-8a7a-e63bd9b50848"}`                                                                                                                                        |
| 150 | signature document: upload authorized against the reception visit                                                             | 201          | `826194df-5d98-43e9-9a9a-bb7607faffbe` | `{"documentId":"519ec457-7f9e-44bd-b3a1-3e86cf361ce0","method":"PUT"}`                                                                                                                 |
| 151 | signature document: bytes stored at the presigned destination                                                                 | 200          | -                                      | `{"bytes":67}`                                                                                                                                                                         |
| 152 | signature document: version registered and scanned                                                                            | 201          | `253f2714-7bab-4b28-8a51-0f8ad9d6d932` | `{"versionId":"20e70415-36d0-4753-97ff-4a97212f43b5","status":"accepted","scanStatus":"clean"}`                                                                                        |
| 153 | signature document: linked to the reception visit, which is its provenance                                                    | 201          | `f63f87c9-d7e3-42ec-9611-147e161a3b82` | `{"linkId":"e70acf34-4abe-4a65-b852-eae83d5502ea"}`                                                                                                                                    |
| 154 | second handover: signature bound                                                                                              | 201          | `ee1d018f-f8ef-48e5-b7b8-64190a968432` | `{}`                                                                                                                                                                                   |
| 155 | second handover: eligibility names the unanswered checklist                                                                   | 200          | `e7e4060e-c91b-4907-858e-6cac05e336d2` | `{"eligible":false,"blockers":["work_order_not_complete","financial_balance_outstanding","checklist_incomplete"],"checklistGaps":2}`                                                   |
| 156 | CASE: completion with the active template's mandatory items unanswered is refused                                             | 409          | `ffae2009-3f59-4209-96cd-7301be19ba14` | `{"code":"ERR-TRN-001"}`                                                                                                                                                               |
| 157 | ISOLATION: organisation B cannot read organisation A's delivery                                                               | 404          | `6bc2db87-cbe3-4eb7-ad41-7dfbc04aae04` | `{"code":"ERR-RES-001"}`                                                                                                                                                               |
| 158 | ISOLATION: organisation B cannot read organisation A's warranty                                                               | 404          | `d421e465-c693-4d8d-b304-bec50956b994` | `{"code":"ERR-RES-001"}`                                                                                                                                                               |
| 159 | ISOLATION: organisation B naming organisation A's branch sees no row                                                          | 403          | `d944ff6a-f40d-4f35-ba54-1b266de4c7a8` | `{"rows":0}`                                                                                                                                                                           |
| 160 | ISOLATION: organisation B's readiness queue carried NO row of organisation A's — refused before any row, so the count is moot | 403          | `d944ff6a-f40d-4f35-ba54-1b266de4c7a8` | `{"rows":null}`                                                                                                                                                                        |
| 161 | ISOLATION: organisation B cannot run a report over organisation A's branch                                                    | 403          | `8e1bb947-f740-4f50-8c2e-80ec33f377cb` | `{"rows":0}`                                                                                                                                                                           |
| 162 | ISOLATION: organisation B's report carried NO row of organisation A's — refused before any row, so the count is moot          | 403          | `8e1bb947-f740-4f50-8c2e-80ec33f377cb` | `{"rows":null}`                                                                                                                                                                        |
| 163 | a role WITHOUT sal.finance.view created                                                                                       | 201          | `d16f5148-6c61-4aa5-a893-5b1ed565e335` | `{"id":"3f64f51b-4924-411d-94ae-fc422c88abd0"}`                                                                                                                                        |
| 164 | restricted role granted sal.delivery.view                                                                                     | 201          | `f357770a-0277-48b4-a0be-0fb56bbd003e` | `{}`                                                                                                                                                                                   |
| 165 | restricted role granted wo.work_order.read                                                                                    | 201          | `b0e330ad-0bc0-4cd8-a18a-48883e0ed618` | `{}`                                                                                                                                                                                   |
| 166 | restricted role granted rpt.report.read                                                                                       | 201          | `9e3cccb8-55de-4a8b-aec1-3cd00be3cc46` | `{}`                                                                                                                                                                                   |
| 167 | a third person invited with the restricted role                                                                               | 201          | `a96470ec-085b-4817-ab3a-8f3f251ed114` | `{"state":"invited"}`                                                                                                                                                                  |
| 168 | third person: password reset requested                                                                                        | 202          | `0f9d701e-fbec-4e06-b04f-4fa6ec681b9c` | `{}`                                                                                                                                                                                   |
| 169 | third person: recovery link read out of the local mailbox                                                                     | found        | -                                      | `{"messageId":"3mQfLxhi8tsxrM0rIc6EGQ"}`                                                                                                                                               |
| 170 | third person: credential set through the shipped completion route                                                             | 200          | `7b0ad85d-9f66-4514-a17b-aa4024fc3bb7` | `{}`                                                                                                                                                                                   |
| 171 | third person activated                                                                                                        | 200          | `ba2264aa-bc4f-41c4-8512-08f890884f4f` | `{}`                                                                                                                                                                                   |
| 172 | third person granted the restricted role at the branch                                                                        | 201          | `04f3b62e-1ba1-487e-81d2-de39942e4bad` | `{}`                                                                                                                                                                                   |
| 173 | third person: login                                                                                                           | 200          | `d2987607-536f-4ae0-88a8-f73ae72eedb5` | `{}`                                                                                                                                                                                   |
| 174 | CASE: without sal.finance.view the readiness queue is REFUSED, not blanked                                                    | 403          | `4c8e44f8-9826-48db-8c60-5e6d9517d78a` | `{"code":"ERR-IAM-001"}`                                                                                                                                                               |
| 175 | CASE: without sal.finance.view the invoice and payment report is REFUSED                                                      | 403          | `22ac089e-44bc-4f1e-af01-862c5ac0ffcf` | `{"code":"ERR-IAM-001"}`                                                                                                                                                               |
| 176 | the same person CAN run the report whose permission they do hold                                                              | 200          | `6c39edb9-3c3d-4f29-81db-243056c04afe` | `{"rows":2}`                                                                                                                                                                           |
| 177 | report run (after the last write): work_orders_by_status                                                                      | 200          | `67e4ab49-c07e-4ce7-84da-e351abe5d225` | `{"timezone":"Asia/Amman","rows":2,"groups":9,"freshness":"live"}`                                                                                                                     |
| 178 | report run (after the last write): technician_labor_time                                                                      | 200          | `bec7da88-c85c-4df2-9c11-f94613640e77` | `{"timezone":"Asia/Amman","rows":1,"groups":1,"freshness":"live"}`                                                                                                                     |
| 179 | report run (after the last write): inventory_movements                                                                        | 200          | `9ff6e065-a114-4d52-b926-bb98fddbd2b8` | `{"timezone":"Asia/Amman","rows":1,"groups":1,"freshness":"live"}`                                                                                                                     |
| 180 | report run (after the last write): invoice_payment_summary                                                                    | 200          | `1fd35f9c-4149-4a06-be6a-b16a6d15cd4e` | `{"timezone":"Asia/Amman","rows":2,"groups":2,"freshness":"live"}`                                                                                                                     |
| 181 | report catalogue (after the last write): who provides each report, and its name                                               | 200          | `0e1f6dec-9415-48b3-94ba-e4f8ed2629ab` | `{"count":4,"missing":[]}`                                                                                                                                                             |
| 182 | the catalogue names each of the four datasets and says who provides it                                                        | named        | -                                      | `{"unusable":[],"provenance":{"work_orders_by_status":{"source":"tenant","titleKey":null,"name":"Work orders by status","executable":true},"technician_labor_time":{"source":"plat...` |
| 183 | FE-010 (after the last write): the authorized company directory the overview resolves against                                 | 200          | `ef5578d2-0314-40fe-b6f6-89a1fe082ec6` | `{"count":1}`                                                                                                                                                                          |
| 184 | FE-010 (after the last write): the authorized branch directory the overview resolves against                                  | 200          | `4a8f9a7b-b26c-4e7d-9626-aca0129835c7` | `{"count":1}`                                                                                                                                                                          |
| 185 | FE-016: the branch the address names resolves in the authorized directory                                                     | resolved     | -                                      | `{"branchId":"0305f216-2188-4a57-b58d-d5b2e3367187","directoryBranches":1}`                                                                                                            |
| 186 | FE-010 overview section (after the last write): work_orders_by_status                                                         | 200          | `82cd42d2-67d4-47ca-b30e-4a77fb63f729` | `{"rows":1,"groups":9,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 187 | FE-016 overview section for the branch named in the address (after the last write): work_orders_by_status                     | 200          | `d3aff321-72ba-4b9a-9e65-2d3aa196555d` | `{"rows":1,"groups":9,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 188 | FE-010 overview section (after the last write): technician_labor_time                                                         | 200          | `1ddf1903-5034-4b8b-840d-87a558fead7b` | `{"rows":1,"groups":1,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 189 | FE-016 overview section for the branch named in the address (after the last write): technician_labor_time                     | 200          | `1d5bb56e-568d-4d56-a97b-b6d4e6f02c81` | `{"rows":1,"groups":1,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 190 | FE-010 overview section (after the last write): inventory_movements                                                           | 200          | `54ee0fa1-db09-4710-98ed-15b12aa2bcf7` | `{"rows":1,"groups":1,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 191 | FE-016 overview section for the branch named in the address (after the last write): inventory_movements                       | 200          | `3dc82bae-d0a5-4eef-ba11-337d084b67b4` | `{"rows":1,"groups":1,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 192 | FE-010 overview section (after the last write): invoice_payment_summary                                                       | 200          | `73164782-daa1-4c1d-863f-740b43d2426c` | `{"rows":1,"groups":2,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 193 | FE-016 overview section for the branch named in the address (after the last write): invoice_payment_summary                   | 200          | `7adb771d-2b6d-4259-a854-1e25a70e3988` | `{"rows":1,"groups":2,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 194 | FE-016 reads the same overview as FE-010 for the same branch                                                                  | agree        | -                                      | `{"disagreed":[]}`                                                                                                                                                                     |

### 8.4 The browser half

`ROOTLCO_E2E_AUTH=1` with the handoff, run from the checkout under test.
`.local\e2e\account-kind.json` read `{"kind":"org-administrator","source":"p1-31-handoff"}`, which
is the identity the P1-31 cases require (`RUN-NOTES.md` §6).

**What is machine-readable here, and what is not.** `apps/web/playwright.config.ts:131` emits a
JSON report only when `CI` is set, and this run was driven locally, so **no reporter document was
produced** and there is no HTML report either. What the run did leave is one directory per FAILED
test under `apps/web/test-results/`, and the runner's own `.last-run.json`. Those are retained at
`…\acceptance-20260913-1247\browser\` as `last-run.json` (the runner's ledger, 125 opaque test
ids), `failed-tests.txt` (the 125 directory names) and `summary-from-report.json` (counts derived
from them by the `derive.py` beside it). **The trace archives and failure screenshots were
deliberately not copied**: a trace records request headers, which on this tier carry the session
cookie, and this run removed its handoff precisely so that no credential is left on disk.

So the two kinds of figure below are cited differently, and the difference is not cosmetic:

- **failures** are evidenced by the retained artefact. `browser/summary-from-report.json` reports
  125 failed-test directories against 125 ids in `last-run.json`, and **zero** of them belong to
  any `*-p1-31.spec.ts`.
- **passes and skips** leave no artefact, because a passing test writes nothing. The reporter
  totals — **270 passed, 125 failed, 6 skipped**, 22.2 minutes — are operator-recorded from the
  console reporter (`RUN-NOTES.md` §6), and so are the per-spec pass counts in the table below and
  the two per-locale timings of the previously failing case.

| spec                      | passed | failed |
| ------------------------- | ------ | ------ |
| `audit-log-p1-31.spec.ts` | 4      | 0      |
| `delivery-p1-31.spec.ts`  | 8      | 0      |
| `overview-p1-31.spec.ts`  | 6      | 0      |
| `reports-p1-31.spec.ts`   | 14     | 0      |
| `warranty-p1-31.spec.ts`  | 8      | 0      |
| **total**                 | **40** | **0**  |

The **failed** column is the artefact's: no P1-31 directory exists among the 125. The **passed**
column is the operator's record, and it is consistent with two facts that can be checked without
it — the tier collects exactly forty P1-31 cases across the two locale projects
(`ROOTLCO_E2E_AUTH=1 npx playwright test --list`), and none of them failed.

Twenty cases in `authenticated-en` and twenty in `authenticated-ar`, which is exactly what §3 of the
plan says the set owes; none is added to `authenticated-tablet`, whose `testMatch` names two other
files.

**A note for the next run.** Nothing in this branch changes the reporter. `CI=1` would produce
`apps/web/playwright-report.json` — the artefact this section would rather have cited — but it also
turns on `forbidOnly` and turns OFF `reuseExistingServer`, so an acceptance operator should set it
deliberately rather than incidentally, and record that they did.

### 8.5 FE-010 and FE-016, no longer only reached

Both requirements were carried as **reached but not verified**: no HTTP step called what the
operational overview calls, and no browser case opened it. Both halves now exist.

The harness's final pass reads the authorized company and branch directory the screen resolves
against, and then one `rpt.report-run` per approved domain at the overview's own page size of one
row — **twice**, once for the branch an operator chooses and once for the branch an address fixes —
with an assertion step requiring the two readings to agree. They agreed
(`summary.json` `overview.directory` = 1 company, 1 branch, branch resolved).

`overview-p1-31.spec.ts` carries three cases in each locale project: FE-010's gate, asserted for
whichever account signed in; FE-010's figures, each section rendering exactly the summary rows the
server published; and FE-016, where the branch comes from `?branchId=`, resolves in the caller's own
directory, is shown fixed and is **stated** to be fixed. All six passed.

### 8.6 Which account is signed in, and what that did to the legacy specs

**How the kind is derived.** `auth.setup.ts` takes credentials from the environment first (the
documented `ROOTLCO_E2E_EMAIL` / `ROOTLCO_E2E_PASSWORD` override), then from the P1-31 handoff, then
from the bootstrap's own account file; after signing in it matches the address it actually used
against the same two sources and writes `{ kind, email, source }` to `account-kind.json` beside the
storage state. An address it cannot place is a hard failure there — no case defaults a kind. What
each kind holds is generated from `OWNER_PERMISSIONS` and `TENANT_ADMINISTRATOR_ROLE` into
`apps/web/tests/e2e/authenticated/account-manifest.json` and checked against both authorities by
`tests/ci/p1-31-account-manifest.test.ts`. This run signed in as `org-administrator`, from the
handoff.

**The measured effect on the seven legacy specs.** The full authenticated tier reported **270
passed, 125 failed, 6 skipped**. Every one of the 125 is in a spec that predates this phase:
`appointments-and-receptions` 81, `isolation` 32, `administration` 6, `accessibility` 4,
`crm-and-vehicles` 2 (`RUN-NOTES.md` §6.2). **Not one is a P1-31 case and not one is a product
regression.** The cause was measured rather than assumed: none of the seven consults the account
manifest, while `apps/web/playwright.config.ts:204` and `:215` give both locale projects a
directory-wide `testMatch`, so a handoff-driven run signs those specs in as the journey's freshly
provisioned administrator and they assert against rows only the seeded Owner-acceptance organisation
has. The clearest instance is `administration.spec.ts:119`, which waits for a role named literally
`acceptance_administrator`. The shape across the set is the same: 42 `ERR-RES-001` not-found and 12
`ERR-IAM-001` forbidden answers behind visibility expectations, plus six timeouts.

**No expectation was changed and no spec was skipped to obtain the P1-31 result.** The remedy was
applied **after** this run and is therefore not part of it: each of the seven legacy specs now reads
the account kind in a `test.beforeEach` and skips with the account named — "requires the
owner-acceptance account; signed in as `<kind>`" — when it is not `owner-acceptance`. Not one legacy
assertion was altered.

**Seven specs were gated, and only five of them failed.** `drawer-and-restore.spec.ts` and
`shared-ux.spec.ts` contributed **zero** failures to the 125
(`browser/summary-from-report.json` `failuresBySpec`), and they are gated for the same STRUCTURAL
reason as the other five rather than for a measured one: they assume the owner-acceptance account,
and a case that happens not to touch a row that is missing is still a case asserting about the
wrong world. Gating them on the measurement alone would have left two files that fail the next
time they reach for one.

**Where the gating is verified, and where it is not.** Statically here: the hosted job sets only
`ROOTLCO_E2E_AUTH` and signs in the owner-acceptance account created at
`.github/workflows/_reusable-authenticated-browser.yml:295`, so the guard's condition is false
there and every legacy case still executes. Dynamically, only by this pull request's own hosted
`authenticated-browser` job — no run in this record establishes it, and none is claimed to.

**What changes for a local run.** A handoff-driven run now reports those seven specs as named
skips, including the **32** `isolation.spec.ts` cases, which the hosted job continues to execute
under the account they were written for. This section is where a reader of such a run learns why
its isolation proof is a skip and not a silence.

### 8.7 The screens

Twenty-eight screenshots and `screens.json` in `…\acceptance-20260913-1247\screens\`: nine screens
in two locales, plus the five that idle until a target is submitted captured again with the server's
answer beside them. **30 `ok` shot records in `screens.json`, 28 of them with image files — the two
without are the file-less signed-in navigation checks, one per locale — and 0 failures.** Taken
against the human-facing origin on `:3100`, each asserting the document direction (`dir=rtl` for
Arabic).

### 8.8 Evidence, the handoff, and the harness under test

`handoff.json` **was removed** with the harness's own `--remove-handoff` once the browser and
screenshot halves were done, as §5.1 of the plan requires; the harness reported the removal and the
file is gone. No credential is left on disk.

| file                                         | sha256                                                             | bytes  |
| -------------------------------------------- | ------------------------------------------------------------------ | ------ |
| `orchestration/acceptance/p1-31-journey.mjs` | `345beb5358954bea1fa9e373286f936f3bc577641a495761095dadf291e399d9` | 162055 |
| `orchestration/acceptance/p1-31-screens.mjs` | `d91f213afba9bf1cdf319421e447e6076043999e54e94c3304c8fd98667055cc` | 9235   |

The journey's digest was recomputed after the run and matches the value the run was briefed with
(`RUN-NOTES.md` §9). Its only destructive call is a single `rmSync`, targeting `handoff.json` under
`--remove-handoff`.

### 8.9 The runs before this one

`mtz2geo1` (§2 to §6) and `mtz5ppq8` (§7.1) are left exactly as they were, with the six that preceded
them in §7's table. Each run provisions its own pair of organisations and deletes nothing, which is
why `org.tenants` stands at 41 and why fourteen `p31_journey_*` organisations from earlier runs are
still present. Their codes match no backend-suite prefix, so no routine test run will remove them and
none of them will remove anything else.

### 8.10 What this section does not claim

The Owner's own verdict on the production build. Any judgement of the screens' wording or layout
beyond the fact that twenty-eight were captured with the asserted document direction. And any hosted
result: whether the `authenticated-browser` job goes green at the head this branch produces is a fact
only that job can establish.

## 9. The delivery WRITE proofs, 2026-09-14 (runs `mu0diepc` and `mu0g1b1a`)

**What this section is.** Two runs, both kept. §8 closed the read half of this phase's acceptance;
the three handover acts that WRITE — FE-004's checklist result, FE-005's final odometer and
FE-006's signature — had no committed browser case in either locale, which is why the closure
re-measure lowered those three rows to `merged (write path)` and recorded the owed cases as
CC-52 (c). This section is those cases, executed.

It supersedes nothing above it. §2 to §6 remain the record of run `mtz2geo1`, §7.1 that of
`mtz5ppq8`, §8 that of `mtzmvemj`. §9.1 is the record of `mu0diepc`, which found three defects and
is kept for exactly that reason; §9.2 is the record of `mu0g1b1a`, in which the corrections were
observed. A list of runs that keeps only the green one is not a record.

Both evidence directories are outside every git working tree and nothing of either is committed:

- `orchestration\evidence\p1-31\acceptance-20260914-0105\` — run `mu0diepc`
- `orchestration\evidence\p1-31\acceptance-20260914-0216\` — run `mu0g1b1a`

Each holds `summary.json`, `steps.json`, `steps.md`, `RUN-NOTES.md`, `browser\` and `screens\`.
**In both runs `handoff.json` was removed** by the harness's own `--remove-handoff` once the
browser and screenshot halves were done, as §5.1 of the plan requires; the harness reported the
removal in each case and neither directory holds a credential.

### 9.1 Run `mu0diepc` — the run that found the defects

Driven from `wt-p12`, branch `feature/p1-31-delivery-browser-proofs` at
`e2ccab439dd9f50908fb2c8c6adbd01e80625a16`, against a production build on the local stack. Window
2026-09-13T22:05:09Z to 2026-09-13T22:26:23Z (`RUN-NOTES.md` §2).

| fact                | value                                                       |
| ------------------- | ----------------------------------------------------------- |
| HTTP journey        | exit 0, verdict PASS, **413 steps, 0 findings**             |
| `org.tenants`       | 41 before, 43 after — the pair `p31_journey_{a,b}_mu0diepc` |
| browser tier        | exit 1 — 48 passed, 4 failed, 357 skipped, 9 did not run    |
| P1-31 browser cases | **48 executed, 47 passed, 1 failed**                        |
| screens             | 28 captured, 0 failures                                     |

Three defects were found. **None is a product defect**, and each is stated with the evidence that
decides it.

**(a) An Arabic locator collision, in the spec.** `delivery-writes-p1-31.spec.ts:143` — _the
handover screen answers for a record that does not exist, and offers no write_ — passed in
`authenticated-en` and failed in `authenticated-ar` at line 165 with
`expect(locator).toBeVisible()` refused for a **strict mode violation — resolved to 2 elements**,
locator `getByText('غير موجود')` (`RUN-NOTES.md` §6.2; error context in
`browser\p1-31-ar-delivery-writes-error-context.md`). The screen was right: `NotFoundState`
(`apps/web/src/components/states/States.tsx:181-190`) draws `state.notFound.title` in the state
shell's `<h2>` and `state.notFound.description` under it, and in Arabic the description
("هذه الصفحة غير موجودة…") contains the title ("غير موجود") as a substring while the English pair
does not. A substring text locator therefore matched twice in one language and once in the other.
The observation point was wrong, not the expectation.

**(b) A gate that fired after the hook it was meant to gate.** The legacy
`appointments-and-receptions.spec.ts` contributed **3 failures and 9 cases that did not run**
instead of twelve skips. Its account-kind gate, added by `72f34d01`, is a file-level
`test.beforeEach`; the second-workspace section's `test.beforeAll` runs before the first case
reaches that hook, so under the org-administrator handoff it shelled out to the owner-acceptance
provisioning command for a session that was about to skip every case that command provisions for.
Four cases in each of three projects: one failure per project where the hook ran, three per
project that never started.

**(c) The four report datasets answered empty — a date boundary, and the product is correct.** For
the period `2026-09-12` to `2026-09-14`, timezone `Asia/Amman`, `work_orders_by_status` published
its nine groups with every count the string `0` and the other three published no groups at all
(`RUN-NOTES.md` §5.1). The run executed at **01:16 Asia/Amman on 2026-09-14** and a read-only query
confirmed all eight of the journey's work orders carried the Amman-local date **`2026-09-14`** —
which is the period's `to` value.

The `to` bound is an **exclusive** upper bound bucketed in the branch's own
`org.branches.timezone_name`, and it is declared and Owner-approved (**D-17**):
`apps/api/src/server/db/period.ts:31` and `:78-79`, `report-run-service.ts:68-75`, and the route
docblock at `apps/api/src/app/api/v1/reports/[reportCode]/rows/route.ts:42`. The harness, however,
derived `from` and `to` from `toISOString().slice(0, 10)` — **UTC** days — so at 22:16Z it sent a
window whose excluded upper bound was the very Amman day its records carried. The run of
2026-09-13, executed at 09:47Z, produced the identical period string and got rows. **The product
behaved as documented; the instrument asked the wrong question.** Nothing in `apps/api` or
`apps/web` was changed for it.

The report proofs obtained in `mu0diepc` are therefore proofs over empty result sets, and are
recorded as such rather than counted.

### 9.2 Run `mu0g1b1a` — the proof run

Driven from `wt-p12`, branch `feature/p1-31-delivery-browser-proofs` at
`171693a846eedb569c10dd640625addab1f3b760`, `git status --porcelain` empty before and after.

| moment                                          | UTC                            |
| ----------------------------------------------- | ------------------------------ |
| preflight began                                 | 2026-09-13T23:15:40Z           |
| stack ready, api and web both HTTP 200          | 2026-09-13T23:26:36Z           |
| HTTP journey                                    | 23:26:50.433Z to 23:27:22.096Z |
| browser tier                                    | 23:27:45.307Z to 23:29:59.899Z |
| screenshot pass                                 | 23:31:05Z to 23:32:12Z         |
| `--remove-handoff`                              | ≈23:32:2xZ                     |
| window end, `dev:stop` reported both ports free | 2026-09-13T23:32:33Z           |

Inside the window: one production build of both tiers (api **7.9s**, web **4.1s**), one HTTP
journey, one authenticated browser tier, one screenshot pass, one `--remove-handoff`. Ports 3000,
3100 and 3210 were free before and are free after. No `supabase db reset`, no `dev:reset`, no
`test:db`, no `test:backend`, no mutation script and no tenant-prefix cleanup was issued at any
point in any worktree (`RUN-NOTES.md` §2). One earlier attempt to start the journey failed closed
in 0.2s on a mangled `ROOTLCO_REPO` path before any HTTP call was made; it wrote nothing.

**The environment, read-only SQL on 54322** (`RUN-NOTES.md` §4):

| figure                        | before                                       | after  |
| ----------------------------- | -------------------------------------------- | ------ |
| migrations applied            | 141                                          | 141    |
| `iam.permissions`             | 121                                          | 121    |
| `tenant_administrator` bundle | 78 codes, uniformly across all 42 such roles | —      |
| `org.tenants`                 | **43**                                       | **45** |

The two new rows are `p31_journey_a_mu0g1b1a` and `p31_journey_b_mu0g1b1a`, both `active`; the
count never decreased and nothing was removed. **Why a new organisation pair was provisioned:** the
previous run's handoff is single-use and was removed by that run's `--remove-handoff`, the harness
has no re-issue mode, and the three corrected cases need an authenticated session against records
the journey itself created.

**`SHOW timezone` on the acceptance database answered `UTC`**, read at 2026-09-13T23:15:23Z with
`current_date` = `2026-09-13` (`RUN-NOTES.md` §4). This is recorded because the harness's `today()`
— the value it sends as `effectiveFrom` and `asOf` on catalogue, pricing and inventory records — is
a UTC calendar day precisely so that it agrees with the server's business date, which is the
database session's `current_date`. Had the session been anything other than UTC, that reasoning
would not have held and the run would not have been taken. See §9.6 (a).

**The journey.** Started 2026-09-13T23:26:55.007Z, finished 23:27:21.981Z, exit code **0**, verdict
**PASS**, **413 steps, 0 findings**, `auditActionsPresent` **true**, **0 steps recorded not-ok**
(`summary.json`). The harness's own notes, verbatim from that file:

- organisation A was provisioned already active; the status route was not called
- organisation B was provisioned already active; the status route was not called
- work order left in in_progress: the platform state graph has no completed state, and the
  remaining hops are taken at closure time
- the opened quality-control record carries no checks, so no per-check result was recorded; the
  finalisation below is what the release gate reads
- the preview reported 1 line(s); every amount below is the string the server published

**The four datasets carry rows again.** Period `from` **`2026-09-13`**, `to` **`2026-09-15`**,
timezone `Asia/Amman`, freshness live:

| dataset                   | rows | groups | step |
| ------------------------- | ---- | ------ | ---- |
| `work_orders_by_status`   | 8    | 9      | 396  |
| `technician_labor_time`   | 1    | 1      | 397  |
| `inventory_movements`     | 1    | 1      | 398  |
| `invoice_payment_summary` | 2    | 2      | 399  |

The run executed at 02:26 Asia/Amman on 2026-09-14, so its records carry the Amman-local date
`2026-09-14`, which now falls strictly inside the half-open interval instead of on its excluded
upper bound. The difference from §9.1 (c) is the anchor, which is taken in the branch's own zone;
the window was not widened.

**The browser half.** `ROOTLCO_E2E_AUTH=1` with the handoff, run from the checkout under test,
exit code **0**. `ROOTLCO_E2E_EMAIL` and `ROOTLCO_E2E_PASSWORD` were deliberately not set;
`.local\e2e\account-kind.json` read `"kind": "org-administrator"`, `"source": "p1-31-handoff"`,
which is the identity the P1-31 cases require. Reporter totals across the three authenticated
projects: **418 collected, 49 passed, 0 failed, 369 skipped, 0 did not run**, 2.2 minutes, one
worker. The forty-ninth pass is the sign-in setup; the other forty-eight are the P1-31 cases.
`test-results\.last-run.json` reads `"status": "passed"` with an empty `failedTests`, and **no
`error-context.md` was produced anywhere**.

| spec                            | `authenticated-en` | `authenticated-ar` | executed | failed |
| ------------------------------- | ------------------ | ------------------ | -------- | ------ |
| `audit-log-p1-31.spec.ts`       | 2 ok               | 2 ok               | 4        | 0      |
| `delivery-p1-31.spec.ts`        | 4 ok               | 4 ok               | 8        | 0      |
| `delivery-writes-p1-31.spec.ts` | 4 ok               | 4 ok               | 8        | 0      |
| `overview-p1-31.spec.ts`        | 3 ok               | 3 ok               | 6        | 0      |
| `reports-p1-31.spec.ts`         | 7 ok               | 7 ok               | 14       | 0      |
| `warranty-p1-31.spec.ts`        | 4 ok               | 4 ok               | 8        | 0      |
| **total**                       | **24**             | **24**             | **48**   | **0**  |

None were added to `authenticated-tablet`. The forty cases §8 recorded are the first four rows'
predecessors and were **re-executed in this run as well**, so both stamps stand: `mtzmvemj`'s 40 of
40 and this run's 48 of 48.

`delivery-writes-p1-31.spec.ts:143` — the case that failed in §9.1 (a) — **passed in
`authenticated-en` (999ms) and in `authenticated-ar` (867ms)**. It now observes the not-found
heading by its accessible name matched whole and asserts the description under it as its own exact
string, the same way in both locales.

`appointments-and-receptions.spec.ts` contributed **141 skipped cases across the three projects and
nothing else** — no failure, no case that did not run. The twelve cases of its second-workspace
section, four in each project, are among those skips.

**The screens.** `screens.json` in `screens\` carries **30 shot records, all `ok`, of which 28
wrote a PNG file**; the two without a file are the signed-in navigation checks, one per locale,
exactly as in §8.7. The manifest's failure list is empty and the script's exit code was 0.
_(This paragraph read "Twenty-eight PNG files … the script reported `ok` for every capture": both
halves are true and read together they suggest twenty-eight records rather than thirty.)_

**Exit codes:** journey 0, browser tier 0, screenshot pass 0, `--remove-handoff` 0, `dev:stop` 0.

**Artefacts in `acceptance-20260914-0216\`:** `RUN-NOTES.md`, `summary.json`, `steps.json`,
`steps.md`, `serve.log`, `browser\browser-tier.log`, `browser\last-run.json`, `screens\` (28 images
and `screens.json`). No trace and no session material was copied.

| file           | sha256                                                             | bytes  |
| -------------- | ------------------------------------------------------------------ | ------ |
| `summary.json` | `c992ee63fb4b80b731e0ed7e0c90ca006c157522db5d14bba81fa0aa64d5d5dc` | 10474  |
| `steps.json`   | `3c706d02487920e6225ce996a8575fcf47c944215f19fbd4b2963741eef7b323` | 196117 |

### 9.3 The harness under test, and its digest history

The journey driver is held outside this repository, at
`orchestration/acceptance/p1-31-journey.mjs`. Four digests exist and each is stated with the reason
it exists, because two of the four were executed and two were not:

| #   | sha256                                                             | bytes  | what it is                                                                                                                     |
| --- | ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `f6adab3cb1b6292c7a1bd757e847e9461499e4b963e25ac6afb915a284804640` | 189529 | **executed as `mu0diepc`.** UTC report period; twelve either-outcome expectations                                              |
| 2   | `52c497d5c3ec027ae49df51c69f96a988c648d3bc2fca1e3ca1f2397f13b04ac` | 191599 | **never executed.** The first timezone fix, which also anchored `today()` in Asia/Amman. Superseded before any run — see below |
| 3   | `b3cc196ed55b284838894ac18371068147eb07d6672f73ad6ebdfd8dd47ccc35` | 196902 | **never executed.** `today()` returned to the UTC day; the twelve expectations pinned; `expectedCode` added to the call helper |
| 4   | `652af24fb3eae4fb9172a616042e738448a2fbcb3d0270a65e678c5ede69aa3a` | 196886 | **executed as `mu0g1b1a`.** Four provenance strings corrected; they had named a script path that does not exist                |

Digest 2 was withdrawn without being run. Anchoring `today()` in the branch's zone would have
published an `effectiveFrom` a day ahead of the server's own business date for any run between
21:00Z and midnight, and that date is the database session's `current_date` — read by
`apps/api/src/modules/quotation/data/quotation-repository.ts:361-364` and priced against at
`quotation-service.ts:332`, while
`apps/api/src/modules/service-catalog/data/service-catalog-repository.ts:911` admits a version only
while `v.effective_from <= $5::date`. A version not yet effective is not sellable, and
`quo.quotation-create` would have refused. _True when written:_ **this is inference from the source
and from the observed `SHOW timezone` = `UTC`, not an observed failure** — digest 2 was never
executed, so no run demonstrates the refusal it was withdrawn to avoid.

Digests 2 and 3 are kept beside the file as `p1-31-journey.mjs.52c497d5` and
`p1-31-journey.mjs.b3cc196e`, so every later change is diffable. `p1-31-screens.mjs` is unchanged
at `d91f213afba9bf1cdf319421e447e6076043999e54e94c3304c8fd98667055cc`, 9235 bytes.

### 9.4 Twelve either-outcome expectations, replaced

The Owner's rule, verbatim:

> Do not weaken assertions, add blanket skips, or allow arbitrary “either permitted or refused”
> outcomes.

The harness carried twelve expectations that named two acceptable statuses. Each was resolved
before `mu0g1b1a` by reading what the two prior runs actually observed and what the product
documents, and pinning the single documented value. Where the documentation also names a catalogue
code, the code is asserted too, through a new optional `expectedCode` on the harness's call helper
that folds into the same pass/fail decision. **All twelve answered as pinned in `mu0g1b1a`, and the
three code assertions matched.**

| step                                                            | operation                       | `mtzmvemj`        | `mu0diepc`        | documented outcome                                                                                                                                                                                       | pinned            |
| --------------------------------------------------------------- | ------------------------------- | ----------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| service made available at the branch                            | `svc.branch-availability-set`   | 200               | 200               | 200 — `docs/api/openapi.v1.json` publishes one success status for this route                                                                                                                             | 200               |
| second person granted the administrator role at the branch      | `iam.grant-issue`               | 201               | 201               | 201 create / 409 conflict (`openapi.v1.json`); the person is invited by the run, so it always creates                                                                                                    | 201               |
| journey: vehicle linked to the customer (×8)                    | `crm.vehicle-link`              | 201               | 201               | 201 (`openapi.v1.json`)                                                                                                                                                                                  | 201               |
| journey: authorized receiver recorded on the visit (×8)         | `rec.reception-party-role`      | 201               | 201               | 201 (`openapi.v1.json`)                                                                                                                                                                                  | 201               |
| signature document linked to the reception visit (×6)           | `shared.attachment-link-create` | 201               | 201               | 201 (`openapi.v1.json`)                                                                                                                                                                                  | 201               |
| restricted role granted a permission code (×3)                  | `iam.role-permission-add`       | 201               | 201               | 201 (`openapi.v1.json`)                                                                                                                                                                                  | 201               |
| third person granted the restricted role at the branch          | `iam.grant-issue`               | 201               | 201               | as above; the role and the person are both made by the run                                                                                                                                               | 201               |
| CASE: completion with mandatory items unanswered is refused     | `sal.delivery-complete`         | 409 `ERR-TRN-001` | 409 `ERR-TRN-001` | 409 — `apps/api/src/server/errors/catalog.ts:296-299` publishes `ERR-TRN-001` as 409                                                                                                                     | 409 `ERR-TRN-001` |
| ISOLATION: organisation B cannot read organisation A's delivery | `sal.delivery-read`             | 404 `ERR-RES-001` | 404 `ERR-RES-001` | 404 — `apps/api/src/app/api/v1/deliveries/[deliveryId]/route.ts:19-26`: absent and out-of-scope become ONE `ERR-RES-001` before any scope decision                                                       | 404 `ERR-RES-001` |
| ISOLATION: organisation B cannot read organisation A's warranty | `wty.warranty-detail`           | 404 `ERR-RES-001` | 404 `ERR-RES-001` | 404 — `apps/api/src/modules/warranty/application/warranty-service.ts:509-522`                                                                                                                            | 404 `ERR-RES-001` |
| ISOLATION: organisation B naming organisation A's branch        | `sal.delivery-readiness-list`   | 403               | 403               | 403 `ERR-IAM-001` — P1-30 **CC-14 is closed**: `requireScopeTargetInTenant` refuses a foreign-tenant target identically to a nonexistent one (`docs/phase-1/phase-1-30/change-control-2026-09-06.md:38`) | 403               |
| ISOLATION: organisation B running a report over A's branch      | `rpt.report-run`                | 403               | 403               | the same closed CC-14 rule, the read being query-scoped in the same way                                                                                                                                  | 403               |

The two query-scoped rows pin the status only: their `detail` records the row count rather than a
code, and nothing was added to them, so the `ERR-IAM-001` code is documented here and not asserted
by the harness.

**Run `mtzmvemj`, recorded in §8, executed with the soft expectations in place.** That is a
limitation of that evidence and not a retraction of it: every one of the twelve answered the value
now pinned, and §8's substantive claim — that the isolation probes carried **no row** — rests on
`assertNoRow`, which is a separate assertion and was never soft. The refusal SHAPE §8's harness
declined to demand is the thing now demanded.

### 9.5 The 413 steps, decomposed

Derived from `acceptance-20260914-0105\steps.json` by boundary label; the section boundaries are
the calls in the harness's `runJourney`. The sum is 413.

| section                           | steps | section                    | steps |
| --------------------------------- | ----- | -------------------------- | ----- |
| S1 operator and two organisations | 14    | S9 work-order closure      | 6     |
| S2 session and branch             | 3     | S10 handover configuration | 5     |
| S3 commercial setup               | 11    | S11 the handover itself    | 20    |
| S4 inventory                      | 21    | S12 warranty               | 4     |
| S5 customer, vehicle, work order  | 9     | S13 reports                | 10    |
| S6 the people and the work        | 15    | S14 the audit trail        | 11    |
| S7 quality control                | 4     | S15 refusal cases          | 32    |
| S8 invoice, receipt, allocation   | 11    | S15b browser fixtures      | 219   |
|                                   |       | S16 the observation point  | 18    |

**S1 to S16 without S15b is exactly 194** — the same total run `mtzmvemj` recorded in §8, and the
reason nothing outside the fixture section needs re-reading against that record. **S15b is 219**: 3
template steps, 48 work-order state transitions (8 for each of six work orders), 16 signature
document steps (4 for each of the four fixtures that bind a signature), and 152 per-fixture steps
(25 for each checklist and signature fixture, 26 for each release fixture, in two locales).
_(That third addend read **24**, which made the four addends sum to 227 rather than 219 and
contradicted its own parenthetical. **24 is the count of `signature document:` steps across the
WHOLE run**; eight of them belong to §11 and the refusal cases, and **16** are inside S15b. The
total 219 is measured off `steps.json` rows 177 to 395 and is unchanged — it is the addend that
was wrong, not the sum.)_

The brief for this run anticipated **407**. The six beyond it are all inside S15b, since the rest
is identical to `mtzmvemj`'s 194. Four one-per-fixture assertion families each contribute exactly
six steps, and the fixture eligibility guard added by `P1-31-FE-004-002` (`e2ccab43`) — _the
handover carries exactly the reasons its browser case is about_ — is the arithmetic match. _True
when written:_ **the 407 estimate has no published per-section decomposition, so this attribution
is arithmetic, not evidence.**

### 9.6 Product observations — recorded, not fixed

**(a) The business date and the report bucket are in different zones.** Pricing and the service
catalogue decide effectiveness against the database session's `current_date`, which on this
acceptance database is **UTC** (`quotation-repository.ts:361-364`, `quotation-service.ts:332`,
`service-catalog-repository.ts:911`). Reporting buckets its day boundaries in the branch's
`org.branches.timezone_name` (`period.ts:31`, `:78-79`). Both are defensible on their own and
neither is wrong against its own documentation, but a workshop whose branch is not in UTC has two
different ideas of "today" inside one product. **Raise as a follow-up item outside P1-31.** Nothing
was changed in `apps/api` or `apps/web` for this record.

**(b) The published contract understates two reads.** `docs/api/openapi.v1.json` publishes
`200, 401, 403, 422, 429, 500` for `sal.delivery-read` and for `wty.warranty-detail` and **no
404**, although both answer `404 ERR-RES-001` to a foreign tenant — which is the documented and
observed behaviour (§9.4) and the behaviour their route and service docblocks describe. The
contract is narrower than the product. **Product record item.**

**(c) No published text declares the report `to` semantics.** The exclusive upper bound bucketed in
the branch timezone is stated in the route docblock at
`apps/api/src/app/api/v1/reports/[reportCode]/rows/route.ts:42` and in
`docs/phase-1/phase-1-31/report-engine-seam.md:157` and `:392`; no OpenAPI text carries it. A
caller reading only the published contract cannot learn the rule that made §9.1 (c) happen.

### 9.7 FE-004, FE-005 and FE-006 against the Owner's proof requirement

The requirement, verbatim:

> Exercise the actual UI in Arabic and English, including the applicable successful write and
> meaningful negative or recovery path. Verify the resulting persisted state and re-read behavior.

Every case below ran in **both** `authenticated-en` and `authenticated-ar` in run `mu0g1b1a`, each
locale against its own handover, and all eight cases in the file passed. The HTTP half is S15b: six
handovers, one per act per locale, each carrying exactly one gap, with the harness asserting the
standing reasons before the browser arrives (`browser fixture … the handover carries exactly the
reasons its browser case is about`, steps 214, 247, 285 and their Arabic counterparts; the six
identifiers are in `summary.json` under `subjects.browserFixtureDeliveries`).

| task       | successful write                                                                                                                                 | negative or recovery                                                                                                                                                                                                                                                                                       | persisted state and re-read                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **FE-004** | `delivery-writes-p1-31.spec.ts:255` — the mandatory item's outcome is set to `passed` in the row's own control and recorded                      | the same case: a waiver with **no reason** is refused beside the field with `form.required`, where the operator can correct it. The disabled release control is asserted on both sides — unusable while the item stands, usable once it is answered                                                        | **yes.** After the refusal, `page.reload()` and the outcome control is still drawn, which is the server saying nothing was recorded, and the eligibility fact still reads blocking. After the success, `page.reload()` again: the control is gone, the row carries the recorded outcome, the eligibility fact reads satisfied and the unsatisfied-item list no longer names the item — a verdict composed by the eligibility operation, a different reader from the panel that wrote |
| **FE-005** | `delivery-writes-p1-31.spec.ts:635` — the final odometer is entered and the vehicle released under the documented financial override, in writing | two, and one of them is the **server's**: the form refuses a two-decimal reading the column cannot hold; then a release taken without the override is refused by `sal.complete_delivery` itself, the panel naming the financial reason the server refused on, with the summary still reading not delivered | **yes.** After the release, `page.reload()`: the summary's `[data-status]` reads `delivered`, the not-delivered sentence is gone, and the reading itself is on the page in the stored one-decimal shape beside its unit — asserted as the value, not as the reference, so a record that fell back to the identifier fails                                                                                                                                                            |
| **FE-006** | `delivery-writes-p1-31.spec.ts:469` — a decodable PNG, the bytes the harness publishes, captured through the panel's own Server Action           | a file the signature category does not accept: the panel states the refusal and the catalogue's `form.violation.invalid` is rendered against the control, and the form is reset once the action settles                                                                                                    | **yes.** After the refusal, `page.reload()` and the ledger is still empty with the blocker still reported as blocking. After the capture, `page.reload()`: the ledger holds exactly one row, it says a signature is on file under the receiver role, the eligibility fact reads satisfied, and no identifier-shaped string appears anywhere in the panel                                                                                                                             |

**Verdict: all three tasks meet the requirement.** Each has a successful write through the real
interface in both locales, at least one meaningful negative in each — FE-005's being the server's
own refusal and not a state a test set — and each re-reads the screen from a fresh server read
after the write and asserts the persisted value there. On that basis FE-004, FE-005 and FE-006 move
to `end-to-end verified` in the task matrix under rule 2.

What is **not** claimed: that a signature image is any particular person's mark; that a released
vehicle was paid for — the release case deliberately exercises the documented override and asserts
that the override was REQUIRED; and any hosted result.

### 9.8 The journey, step by step (run `mu0g1b1a`)

The table below is `…\acceptance-20260914-0216\steps.md` as the harness wrote it. `detail` is the
harness's own record of what the response carried; the untruncated value is in `steps.json`. Step
numbers are this run's; **compare runs by step LABEL, never by number.**

| #   | step                                                                                                                          | status                                              | correlation id                         | detail                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | platform operator: password reset requested                                                                                   | 202                                                 | `aa4aae0a-ec7f-4c5d-acd6-09f7abca3842` | `{}`                                                                                                                                                                                   |
| 2   | platform operator: recovery link read out of the local mailbox                                                                | found                                               | -                                      | `{"messageId":"7aYH3D9CvfO7EX8VL6tj8d"}`                                                                                                                                               |
| 3   | platform operator: credential set through the shipped completion route                                                        | 200                                                 | `8d0a3909-3dfd-4990-acca-e64f17874445` | `{}`                                                                                                                                                                                   |
| 4   | platform operator: login                                                                                                      | 200                                                 | `fd905928-fe7f-49f9-ad85-63dd6d965ef0` | `{}`                                                                                                                                                                                   |
| 5   | organisation A provisioned through platform.organization-provision                                                            | 201                                                 | `c9c6fe69-097f-46ec-8202-c12f311fa773` | `{"tenantId":"b0e89c29-b93d-4456-ae70-4d56ff637eec","activated":true}`                                                                                                                 |
| 6   | organisation B provisioned through platform.organization-provision                                                            | 201                                                 | `c1dccd8a-0f91-4d70-94c2-c9420b4468ce` | `{"tenantId":"b8683c3f-62a8-4cb2-a0b4-6c7aada0c69c","activated":true}`                                                                                                                 |
| 7   | owner A: password reset requested                                                                                             | 202                                                 | `339f4378-6535-47d3-9250-87e9932b60c2` | `{}`                                                                                                                                                                                   |
| 8   | owner A: recovery link read out of the local mailbox                                                                          | found                                               | -                                      | `{"messageId":"5VqTNf0ZfwuEyST7XoE2x8"}`                                                                                                                                               |
| 9   | owner A: credential set through the shipped completion route                                                                  | 200                                                 | `8a679c00-dc4c-4a0c-86b4-94a1922e97e3` | `{}`                                                                                                                                                                                   |
| 10  | owner A: login                                                                                                                | 200                                                 | `04b20ca6-da2f-4ce7-a854-a64dbf9db1db` | `{}`                                                                                                                                                                                   |
| 11  | owner B: password reset requested                                                                                             | 202                                                 | `cce5276d-2e65-40b2-bd11-f202dbf4691d` | `{}`                                                                                                                                                                                   |
| 12  | owner B: recovery link read out of the local mailbox                                                                          | found                                               | -                                      | `{"messageId":"267mZ6ngchCYtIQuNXccCi"}`                                                                                                                                               |
| 13  | owner B: credential set through the shipped completion route                                                                  | 200                                                 | `f1b46de8-5ca7-47cd-bccd-028cd268d514` | `{}`                                                                                                                                                                                   |
| 14  | owner B: login                                                                                                                | 200                                                 | `9dd8c0c1-33f0-496b-b735-d7f4e4147fe3` | `{}`                                                                                                                                                                                   |
| 15  | owner A session (permission count must be 78)                                                                                 | 200                                                 | `ad1d2e68-d118-4c2d-8acc-d463816c08f1` | `{"permissions":78}`                                                                                                                                                                   |
| 16  | the first administrator holds the whole tenant-administrator bundle                                                           | 78                                                  | -                                      | `{"held":78,"expected":78}`                                                                                                                                                            |
| 17  | owner A: branch list                                                                                                          | 200                                                 | `15f75c26-f3ff-4331-9371-0b368def9f96` | `{"count":1}`                                                                                                                                                                          |
| 18  | service category created                                                                                                      | 201                                                 | `5a6f319e-e78d-4ff8-a926-bfe83e9e9f93` | `{"id":"048755ca-c55e-49c5-a9ad-424e6c12b1a5"}`                                                                                                                                        |
| 19  | service created                                                                                                               | 201                                                 | `b8800126-6f3a-4fc3-9fb4-1451b86e4dd9` | `{"id":"524bb0d1-f097-485d-8fca-815d269012f2","recordVersion":1}`                                                                                                                      |
| 20  | service version created                                                                                                       | 201                                                 | `43bbcac1-aa8a-4f85-b650-4bad11f7e563` | `{"id":"599f99bb-3d8a-4c13-af0b-abc087dd0623","state":null}`                                                                                                                           |
| 21  | service version published                                                                                                     | 200                                                 | `0f09e22a-db8f-4731-ae99-aa63742e8080` | `{"state":null}`                                                                                                                                                                       |
| 22  | service made available at the branch                                                                                          | 200                                                 | `ad0f35f7-d19b-4c2d-bbe2-73d10f2af381` | `{}`                                                                                                                                                                                   |
| 23  | price list created                                                                                                            | 201                                                 | `cbfb84a0-c2d3-40dd-b2ef-0953aa58b84b` | `{"id":"9a947512-14f3-496c-8845-fe7560485f79","recordVersion":1}`                                                                                                                      |
| 24  | price list version created (If-Match = the LIST record version)                                                               | 201                                                 | `8b567144-8d3b-4bce-8384-e71843fb2bb0` | `{"id":"5a9bc911-ac6e-45f8-a525-598a892c0be9"}`                                                                                                                                        |
| 25  | price rule recorded (amount as a decimal string)                                                                              | 201                                                 | `9b36b302-665e-4881-9d4c-7ed7abca2aaf` | `{"amount":"45.0000"}`                                                                                                                                                                 |
| 26  | price list version published (If-Match = the LIST record version)                                                             | 200                                                 | `be5d9ac5-5858-4556-a28a-c015adf376ed` | `{}`                                                                                                                                                                                   |
| 27  | price list assigned to the branch                                                                                             | 201                                                 | `cc25e1d1-3939-4ac0-9067-4f902a0b86b8` | `{"id":"c169171c-b810-4e44-9e86-9b22c13c9e66"}`                                                                                                                                        |
| 28  | price RESOLVED by the server                                                                                                  | 200                                                 | `12c00a98-04e6-43a9-9c4b-27afbbf4b81d` | `{"amount":null,"currency":"JOD"}`                                                                                                                                                     |
| 29  | item category created                                                                                                         | 201                                                 | `1db439cf-7bfa-45e8-94b7-870c398e19c1` | `{"id":"d1c104ce-8826-4a66-96bb-004932a50777"}`                                                                                                                                        |
| 30  | unit list (the 'each' platform code must be offered)                                                                          | 200                                                 | `e3d6c2e1-0be5-4b8b-9484-1f3b1edbb4bd` | `{"count":12}`                                                                                                                                                                         |
| 31  | item created (catalogue row, no cost, no stock)                                                                               | 201                                                 | `64a4faf6-2b16-44ac-996b-a656718a93c0` | `{"id":"f3bad89d-cd51-471f-90af-e1099da220e5"}`                                                                                                                                        |
| 32  | warehouse created                                                                                                             | 201                                                 | `470ab6ed-2bfc-4607-9f1b-02f7581cc25b` | `{"id":"93b857be-5221-44df-aff3-28a2eaaf03d8"}`                                                                                                                                        |
| 33  | storage place created inside the warehouse                                                                                    | 201                                                 | `96d96569-6bf5-495a-8bdf-20e63a9d75cd` | `{"id":"d530be71-c8f2-43cd-ac43-3b37474b9409"}`                                                                                                                                        |
| 34  | opening batch opened                                                                                                          | 201                                                 | `594f1bd2-1bd8-4a3c-9169-65f5f660a9ae` | `{"id":"ee27e68a-8018-420b-9659-2ef8be37a3a5","state":null}`                                                                                                                           |
| 35  | opening line added (quantity as a decimal string)                                                                             | 201                                                 | `0bc801ba-4840-4c74-a4e9-845dffc55274` | `{"quantity":"12.000"}`                                                                                                                                                                |
| 36  | CASE: the counter approving their own batch is REFUSED (maker != checker)                                                     | 409                                                 | `2084a113-f8cf-420b-a5c2-6a98db52577c` | `{"code":"ERR-TRN-001"}`                                                                                                                                                               |
| 37  | second person: role list, to find the administrator role                                                                      | 200                                                 | `0b5827f8-d89c-4c74-b570-366eba52f4d9` | `{"count":2}`                                                                                                                                                                          |
| 38  | second person invited with the administrator role                                                                             | 201                                                 | `502d33a4-15c9-4445-b373-e5e2ec6e8272` | `{"state":"invited"}`                                                                                                                                                                  |
| 39  | second person: password reset requested                                                                                       | 202                                                 | `44e204db-eb01-46ae-99a2-c7bfe5967a91` | `{}`                                                                                                                                                                                   |
| 40  | second person: recovery link read out of the local mailbox                                                                    | found                                               | -                                      | `{"messageId":"3cCp7RQRnE2b537lNnQ7yq"}`                                                                                                                                               |
| 41  | second person: credential set through the shipped completion route                                                            | 200                                                 | `947b1576-c6f0-4e6a-996c-b5ece7ca2159` | `{}`                                                                                                                                                                                   |
| 42  | second person BEFORE activation: login                                                                                        | 401                                                 | `66331ba6-008a-47bb-9e17-e441cb580ec5` | `{}`                                                                                                                                                                                   |
| 43  | second person activated by the administrator                                                                                  | 200                                                 | `043d6774-a197-49f4-a82b-1cd3f50fc437` | `{"state":"active"}`                                                                                                                                                                   |
| 44  | second person granted the administrator role at the branch                                                                    | 201                                                 | `66bf827c-76ba-4e25-9904-9b976924f041` | `{"id":"ea27026b-5bc7-4ba4-b610-94a52ee47490"}`                                                                                                                                        |
| 45  | second person (after activation): login                                                                                       | 200                                                 | `ce72d3b2-d5d9-4207-95d1-925ea24bdb65` | `{}`                                                                                                                                                                                   |
| 46  | batch APPROVED by the second person                                                                                           | 200                                                 | `61307813-9075-4d63-806d-f51c4f1d0811` | `{"state":null}`                                                                                                                                                                       |
| 47  | CASE: the same approval replayed under the same key is not a second approval                                                  | 200                                                 | `e5d1246f-16fb-4d87-9b71-5b72656e40f5` | `{"state":null,"replayed":null}`                                                                                                                                                       |
| 48  | ON HAND after approval, as the server publishes it                                                                            | 200                                                 | `a3bc5fd3-427a-47cd-9d2b-a7c1704dc61d` | `{"cells":[{"onHand":"12.000","available":"12.000"}]}`                                                                                                                                 |
| 49  | movement ledger shows the opening row                                                                                         | 200                                                 | `290b1004-1ae6-4001-8351-7c274fdcee81` | `{"count":1,"types":["opening"]}`                                                                                                                                                      |
| 50  | first journey: customer created                                                                                               | 201                                                 | `5f7618dd-3508-47bd-a742-53ac609504b9` | `{"customerId":"df87130f-b08e-4a50-9437-26dd867bf790","displayNumber":"000001"}`                                                                                                       |
| 51  | first journey: vehicle created                                                                                                | 201                                                 | `6f3d8215-600c-4500-b8e4-79bdbd9e1374` | `{"vehicleId":"df33a103-d3f9-4d75-a8a5-5243a52ea6e6","lifecycle":"draft"}`                                                                                                             |
| 52  | first journey: vehicle linked to the customer                                                                                 | 201                                                 | `0290afff-f95c-4e0d-9a39-e3fc04072acd` | `{}`                                                                                                                                                                                   |
| 53  | first journey: reception created (walk-in)                                                                                    | 201                                                 | `303df159-cf88-44b7-998e-1118ab22ced5` | `{"receptionVisitId":"5bbca195-0bfb-4089-a580-a11bd52ea4c9","receptionStatus":"opened","recordVersion":1}`                                                                             |
| 54  | first journey: the customer recorded on the visit as the authorized receiver                                                  | 201                                                 | `614cc2c2-a025-4a94-8361-ffdb06b12549` | `{"role":"authorized_receiver"}`                                                                                                                                                       |
| 55  | first journey: the customer AUTHORIZES the work                                                                               | 201                                                 | `88930b59-2131-4927-a9a9-4642cccb29d8` | `{"decision":"approved"}`                                                                                                                                                              |
| 56  | first journey: reception detail, for its record version                                                                       | 200                                                 | `7147f90e-b4df-4678-86e1-f26a0951f629` | `{"receptionStatus":"opened","recordVersion":1}`                                                                                                                                       |
| 57  | first journey: reception approved                                                                                             | 200                                                 | `28c6396e-28e3-4164-b731-98b0fc8bde09` | `{"receptionStatus":"authorized","recordVersion":3}`                                                                                                                                   |
| 58  | first journey: reception converted to a WORK ORDER                                                                            | 200                                                 | `6c34772d-1ec0-4851-bf82-962d79bbcd86` | `{"workOrderId":"02329854-a4ca-484c-abe2-e632281df34d"}`                                                                                                                               |
| 59  | employee added to the branch register (active)                                                                                | 201                                                 | `1f6a217d-5b45-46c8-94b7-7fc80429b729` | `{"id":"1b9a2c81-0da5-40dd-9698-b927519118ea","status":"active"}`                                                                                                                      |
| 60  | technician profile created for the signed-in account                                                                          | 201                                                 | `7ff97dbc-87bd-49c7-ae1b-b47d098a568d` | `{"id":"803e5e5f-3058-451d-8214-6fcaf050af44"}`                                                                                                                                        |
| 61  | work order detail, for the If-Match the open transition needs                                                                 | 200                                                 | `36b59b1a-624c-45ae-8dfa-dd5b3d9fbaff` | `{"state":"draft","recordVersion":1,"nextStates":["cancelled","open"]}`                                                                                                                |
| 62  | work order transitioned to open                                                                                               | 200                                                 | `aa9d2392-6110-4e1b-bd77-83ec552d4c12` | `{"state":"open","from":"draft","offered":["cancelled","open"]}`                                                                                                                       |
| 63  | work order detail, for the If-Match the in_progress transition needs                                                          | 200                                                 | `ec0dbe4d-5622-44d6-8514-daf8f2b3b10f` | `{"state":"open","recordVersion":2,"nextStates":["cancelled","in_progress"]}`                                                                                                          |
| 64  | work order transitioned to in_progress                                                                                        | 200                                                 | `60ef6586-42e7-4c18-923c-bb4ed7c936ff` | `{"state":"in_progress","from":"open","offered":["cancelled","in_progress"]}`                                                                                                          |
| 65  | job created on the work order                                                                                                 | 201                                                 | `8cb73bb7-82c6-4ad7-a737-902abb1f747c` | `{"id":"2cbfe119-5f2e-4afb-abeb-3fe93e440049","state":"planned","recordVersion":1}`                                                                                                    |
| 66  | technician availability recorded, so the assignment has a window to sit in                                                    | 201                                                 | `3fe38445-8cde-46eb-b918-9f53ab24aa67` | `{"id":"e1ffacee-7997-43b5-9798-2cf2e06e3699","kind":"available"}`                                                                                                                     |
| 67  | job assigned to the technician                                                                                                | 201                                                 | `8db48534-b8da-4b86-b3f4-72e634def37f` | `{"id":"5a0772c3-fa66-4991-bc78-5a1cab35093d"}`                                                                                                                                        |
| 68  | job transitioned to assigned, which is the first state that permits labour                                                    | 200                                                 | `eef042c0-62fb-4f06-ba98-68511f7b2882` | `{"state":"assigned"}`                                                                                                                                                                 |
| 69  | labour session started                                                                                                        | 201                                                 | `fdf48ba6-329d-4422-a6c0-79b4b5aa83a5` | `{"id":"cd97e5fe-6172-49d5-b913-d229d4b047e9","recordVersion":1}`                                                                                                                      |
| 70  | labour session STOPPED, so the recorded time is a closed interval                                                             | 200                                                 | `b4eea54f-f54a-4d22-b82c-d27373b275ec` | `{"endedAt":"2026-09-13T23:27:02.248Z"}`                                                                                                                                               |
| 71  | work log recorded against the job                                                                                             | 201                                                 | `256b2f40-dc40-4399-b22a-03dbb763df83` | `{"id":"f57ee824-977e-4cb9-aea4-f9d5d16beaf2"}`                                                                                                                                        |
| 72  | job transitioned to in_progress                                                                                               | 200                                                 | `11ef1186-ea70-455b-9fdf-2af92f76b605` | `{"state":"in_progress"}`                                                                                                                                                              |
| 73  | job transitioned to completed, which is terminal                                                                              | 200                                                 | `3606644d-a1cc-42a0-8430-66eec33d96a2` | `{"state":"completed"}`                                                                                                                                                                |
| 74  | quality-control record opened                                                                                                 | 201                                                 | `d8538789-7fef-4395-87cb-3a30c384f3e5` | `{"id":"1256ca69-1eab-4552-ab41-9b349c92f110","overallResult":"pending"}`                                                                                                              |
| 75  | quality-control record read, for its checks and record version                                                                | 200                                                 | `23f9565b-8823-45ef-b0e0-ff39cdd1003d` | `{"checks":0,"recordVersion":null}`                                                                                                                                                    |
| 76  | quality-control record re-read, for the If-Match the finalisation needs                                                       | 200                                                 | `bef50c4d-0861-4cee-ad2b-58cd0fd19063` | `{"recordVersion":null}`                                                                                                                                                               |
| 77  | quality control FINALISED passed                                                                                              | 200                                                 | `a1b08b15-8422-4683-a9b8-4c2940ecb5bf` | `{"overallResult":"passed"}`                                                                                                                                                           |
| 78  | quotation raised on the work order, priced from the published price list                                                      | 201                                                 | `a3c4d0a7-1e8b-4433-aad9-9ad2bc7fba6b` | `{"id":"f5242ecb-a807-4df4-a3ad-38ee65731e97","quotationNumber":"000001","revisionId":"a24ad5ac-d872-4f47-8e8f-41c878b806ad","grandTotal":"0.0000","recordVersion":1}`                 |
| 79  | quotation ISSUED to the customer (If-Match = the QUOTATION version)                                                           | 200                                                 | `a2845d1f-8921-4f10-9934-528750800881` | `{"status":"issued","recordVersion":2}`                                                                                                                                                |
| 80  | the customer APPROVES the revision, in person — the invoice’s commercial source                                               | 201                                                 | `a3b79519-4780-45ee-b369-674abea7349a` | `{"decided":1,"rollUp":null}`                                                                                                                                                          |
| 81  | invoice preview (the server figures, not ours)                                                                                | 200                                                 | `10bcfff0-d058-464c-938b-4782d0389b1c` | `{"lines":1}`                                                                                                                                                                          |
| 82  | invoice created (draft), naming the payer explicitly                                                                          | 201                                                 | `75d0c065-e041-4364-8e54-5edc679015af` | `{"id":"e8687425-e12c-45de-8e19-1aaf67b17928","status":"draft","recordVersion":1}`                                                                                                     |
| 83  | invoice ISSUED with a number from the branch sequence (If-Match = the INVOICE version)                                        | 200                                                 | `6f8c0ece-012a-4d0b-8af1-49494922ea24` | `{"invoiceNumber":"000001","status":"issued"}`                                                                                                                                         |
| 84  | invoice detail after issue                                                                                                    | 200                                                 | `332945dd-2bab-4c4b-be63-c856a6c5c6aa` | `{"status":"issued","invoiceNumber":"000001","gross":"45.0000","currency":"JOD"}`                                                                                                      |
| 85  | payment methods (the tenant cash method must be present)                                                                      | 200                                                 | `905926e9-59db-438d-8c31-ca5f37569efb` | `{"codes":["bank_transfer","card_terminal","cash","bank_transfer","card_terminal","cash"]}`                                                                                            |
| 86  | receipt recorded for the issued amount                                                                                        | 201                                                 | `cee5f39e-ab12-4808-84f3-3161ab7b4b1c` | `{"id":"e6b2bbd0-e28b-40f1-b3a5-296e25bf9793","reference":"000001"}`                                                                                                                   |
| 87  | receipt ALLOCATED to the invoice                                                                                              | 201                                                 | `8395e69c-2906-4907-ac1d-e2504ddb4041` | `{"id":"a442a6c8-46cb-4fa9-9ad7-535b87403f3e"}`                                                                                                                                        |
| 88  | OUTSTANDING after allocation, as the server publishes it                                                                      | 200                                                 | `099c5fbb-871a-4180-bfe8-a57513ae5a15` | `{"outstanding":"0.0000","isSettled":true}`                                                                                                                                            |
| 89  | closure eligibility read                                                                                                      | 200                                                 | `1c660009-4e65-40d0-bf0a-8f50eda146bc` | `{"eligible":true,"blockers":[]}`                                                                                                                                                      |
| 90  | work order detail, for the If-Match the qc_pending transition needs                                                           | 200                                                 | `9259fded-9d96-4add-acdf-c417458e65c8` | `{"state":"in_progress","recordVersion":3,"nextStates":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                               |
| 91  | work order transitioned to qc_pending                                                                                         | 200                                                 | `283291ec-52b8-491b-a54d-147513da0833` | `{"state":"qc_pending","from":"in_progress","offered":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                                |
| 92  | work order detail, for the If-Match the ready_to_close transition needs                                                       | 200                                                 | `4402b193-86fd-4b88-9516-56e79d1a659a` | `{"state":"qc_pending","recordVersion":4,"nextStates":["in_progress","ready_to_close"]}`                                                                                               |
| 93  | work order transitioned to ready_to_close                                                                                     | 200                                                 | `ffae72e8-7b3c-4e87-aee9-56f995e87c55` | `{"state":"ready_to_close","from":"qc_pending","offered":["in_progress","ready_to_close"]}`                                                                                            |
| 94  | work order CLOSED with If-Match                                                                                               | 200                                                 | `9e23aac1-9d65-4347-953c-a14aea7fdd37` | `{"state":"closed"}`                                                                                                                                                                   |
| 95  | handover checklist template created with two mandatory items                                                                  | 201                                                 | `8efea73b-1840-4656-8e37-044ef904e64e` | `{"id":"26c53c12-ddd0-4c47-9ec2-094bcdb6e97c","items":2,"recordVersion":1}`                                                                                                            |
| 96  | checklist template read, for its items and record version                                                                     | 200                                                 | `dc1c4d34-c760-4602-a146-b0729a956b7a` | `{"items":2,"status":"active","recordVersion":1}`                                                                                                                                      |
| 97  | checklist template status set ACTIVE                                                                                          | 200                                                 | `efa329ca-54ae-45ec-af46-56dbebf2e4c2` | `{"status":"active"}`                                                                                                                                                                  |
| 98  | warranty policy created with one coverage window                                                                              | 201                                                 | `3e5785a0-50bc-4ded-bd9e-45e6ea5c3746` | `{"id":"6750a912-ec47-4406-849e-04671b2aa9c0","coverage":1,"recordVersion":1}`                                                                                                         |
| 99  | a second, service-only coverage window added to the policy                                                                    | 201                                                 | `358f11b0-ee4e-471f-9928-979522027277` | `{"id":"b939e2c4-c60a-49b1-9b01-13ff048a62a5","coveredScope":"service"}`                                                                                                               |
| 100 | readiness queue: the closed work order is present with its four facts                                                         | 200                                                 | `cff18424-57f3-4b9c-8a2c-b9898bed8cd6` | `{"count":1,"present":true,"facts":[{"blocker":"work_order_not_complete","established":true},{"blocker":"quality_control_not_passed","established":true},{"blocker":"financial_bal...` |
| 101 | all four work-order facts were ESTABLISHED, not assumed blocking                                                              | 4                                                   | -                                      | `{"facts":[{"blocker":"work_order_not_complete","established":true,"source":"@/modules/work-order — wo.work_orders.state against wo.work_order_states"},{"blocker":"quality_contro...` |
| 102 | delivery opened for the work order                                                                                            | 201                                                 | `9ff42ee8-9b5c-4ff4-a87c-59a0da9e6dcc` | `{"id":"a5a277d7-7a02-47ea-968a-321c790edfd9","status":"ready","recordVersion":1}`                                                                                                     |
| 103 | CASE: the same body under the SAME key is a replay, not a second delivery                                                     | 200                                                 | `310d6665-2bb3-4bfc-8789-99cd9311f896` | `{"id":"a5a277d7-7a02-47ea-968a-321c790edfd9","replayed":false}`                                                                                                                       |
| 104 | the replay answered the SAME delivery id                                                                                      | same row                                            | -                                      | `{"first":"a5a277d7-7a02-47ea-968a-321c790edfd9","replayed":"a5a277d7-7a02-47ea-968a-321c790edfd9"}`                                                                                   |
| 105 | CASE: a SECOND key for the same work order is refused (one live delivery only)                                                | 409                                                 | `9e038144-1443-49d9-bfc0-668c922b0d1e` | `{"code":"ERR-RES-002"}`                                                                                                                                                               |
| 106 | eligibility read before any handover evidence                                                                                 | 200                                                 | `fc3b353e-2c86-482a-8bad-ec7d4b5ebaa8` | `{"eligible":false,"blockers":["checklist_incomplete","receiver_not_verified","signature_missing"],"recordVersion":1}`                                                                 |
| 107 | authorized receiver verified against the visit roles                                                                          | 201                                                 | `a1515431-748a-4826-afb3-d50fbbdddcb1` | `{"id":"cdd6c498-2e05-4dff-9423-09caf4e76b04","deliveryStatus":"receiver_verified"}`                                                                                                   |
| 108 | signature document: upload authorized against the reception visit                                                             | 201                                                 | `15f20634-ddfd-424b-b6dc-23ea351b9333` | `{"documentId":"f52ef743-5735-4af2-8bfa-ee4531e41a86","method":"PUT"}`                                                                                                                 |
| 109 | signature document: bytes stored at the presigned destination                                                                 | 200                                                 | -                                      | `{"bytes":67}`                                                                                                                                                                         |
| 110 | signature document: version registered and scanned                                                                            | 201                                                 | `5b5b3796-f677-4272-baec-5143f72176ac` | `{"versionId":"76258634-f713-462b-a0d4-c2880045d36c","status":"accepted","scanStatus":"clean"}`                                                                                        |
| 111 | signature document: linked to the reception visit, which is its provenance                                                    | 201                                                 | `5f2c58ed-2e56-4d84-b3bb-3262ce30a784` | `{"linkId":"77c3821b-317e-4be1-853a-1324ff85b11c"}`                                                                                                                                    |
| 112 | the receiver's signature bound to the delivery by reference                                                                   | 201                                                 | `be6abd21-c9f7-4852-8144-746dc6d4cac3` | `{"id":"cf05c2e4-4e31-4d3d-b671-2424c3089948"}`                                                                                                                                        |
| 113 | checklist item recorded as passed: keys_returned                                                                              | 201                                                 | `0758b872-ddd0-4b7b-9971-7cbd4b89198d` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 114 | checklist item recorded as passed: documents_returned                                                                         | 201                                                 | `cec04657-1e39-4ec2-9997-45f355055d79` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 115 | eligibility read again: every fact established, no blocker, and the version to use                                            | 200                                                 | `34a86003-7b75-403d-9f42-85af099f5259` | `{"eligible":true,"blockers":[],"facts":[{"blocker":"delivery_state_invalid","established":true},{"blocker":"work_order_not_complete","established":true},{"blocker":"quality_cont...` |
| 116 | CASE: a STALE If-Match on completion is refused                                                                               | 409                                                 | `b93344db-db00-443b-b0db-ee9a4a6a3d02` | `{"code":"ERR-CON-001"}`                                                                                                                                                               |
| 117 | delivery COMPLETED: custody released and the final odometer captured                                                          | 200                                                 | `27495a28-f4b7-4c62-8aa8-82b8546f299c` | `{"status":"delivered","deliveredAt":"2026-09-13T23:27:05.111Z"}`                                                                                                                      |
| 118 | delivery read: the record is delivered                                                                                        | 200                                                 | `728f98f0-c1ef-4f1c-9311-df2891d700c9` | `{"status":"delivered","finalOdometerReadingId":"22285176-1841-4c62-a6b8-0cb088c69d36"}`                                                                                               |
| 119 | status history: every stage the handover passed through                                                                       | 200                                                 | `5fe61198-8971-4529-9b76-1d916c82dfe0` | `{"stages":["delivered","signed","receiver_verified","ready"]}`                                                                                                                        |
| 120 | warranty generated from the delivered handover under the named policy                                                         | 201                                                 | `c9924ba3-cfe2-43de-a46d-5dadae1267f7` | `{"id":"a62e2367-c563-44a2-a31d-176d2634b377","status":"issued","expiryDate":"2027-09-13"}`                                                                                            |
| 121 | warranty list for the branch contains the vehicle's new warranty                                                              | 200                                                 | `e087832c-0b9a-4edc-897b-e2b36251c0e7` | `{"count":1,"present":true}`                                                                                                                                                           |
| 122 | warranty detail: its terms and what it covers                                                                                 | 200                                                 | `7b5651b1-e1ac-4eac-975d-df3035ef5938` | `{"status":"issued","startDate":"2026-09-13","expiryDate":"2027-09-13","odometerLimit":"32346","policyCode":"p31_mu0g1b1a_wty","coveredScope":"all"}`                                  |
| 123 | warranty plans list, as the plans screen reads it                                                                             | 200                                                 | `2014b439-fcff-47c9-91dc-92cc6120c0b1` | `{"count":1,"codes":["p31_mu0g1b1a_wty"]}`                                                                                                                                             |
| 124 | report configuration created for work_orders_by_status                                                                        | 201                                                 | `9de3e1f2-1eba-4fc4-afe3-434d2886bb99` | `{"id":"813e0132-f143-4be4-b92a-ae1dbe796a93","recordVersion":1}`                                                                                                                      |
| 125 | configuration version created (parameterSchema omitted, not empty)                                                            | 201                                                 | `05729ab4-3bc7-4813-9de6-55b8b4a72e2e` | `{"id":"d5d0ce9f-73da-4564-8e78-a1255b3c2e6b","versionNumber":1}`                                                                                                                      |
| 126 | configuration read, for the If-Match the publish needs                                                                        | 200                                                 | `343d3d6f-7a68-4b8e-a8fd-41d3d241e3b3` | `{"status":"draft","recordVersion":1}`                                                                                                                                                 |
| 127 | configuration version PUBLISHED                                                                                               | 200                                                 | `9c3306dc-c473-479c-8b12-2a8381577df5` | `{"publishedAt":"2026-09-13T23:27:05.738Z","recordVersion":2}`                                                                                                                         |
| 128 | configuration status set published                                                                                            | 200                                                 | `47cd4f52-939a-4524-b3ee-258d0203c897` | `{"status":"published"}`                                                                                                                                                               |
| 129 | report catalogue offers all four dataset codes                                                                                | 200                                                 | `f596763d-4896-46c7-9880-87637d54df34` | `{"count":4,"missing":[],"executable":[{"reportCode":"technician_labor_time","executable":true},{"reportCode":"inventory_movements","executable":true},{"reportCode":"invoice_paym...` |
| 130 | report run: work_orders_by_status over a half-open day period                                                                 | 200                                                 | `9d48defc-738b-4b5e-a00b-c0ad3a3ac677` | `{"timezone":"Asia/Amman","rows":1,"groups":9,"freshness":"live"}`                                                                                                                     |
| 131 | report run: technician_labor_time over a half-open day period                                                                 | 200                                                 | `ada6f1ab-8032-4105-adea-4568fc8a11a3` | `{"timezone":"Asia/Amman","rows":1,"groups":1,"freshness":"live"}`                                                                                                                     |
| 132 | report run: inventory_movements over a half-open day period                                                                   | 200                                                 | `30a97323-a34a-4401-838d-44d4e7012bc4` | `{"timezone":"Asia/Amman","rows":1,"groups":1,"freshness":"live"}`                                                                                                                     |
| 133 | report run: invoice_payment_summary over a half-open day period                                                               | 200                                                 | `986f8356-8b8a-4bf0-bff9-cc242618ee76` | `{"timezone":"Asia/Amman","rows":2,"groups":2,"freshness":"live"}`                                                                                                                     |
| 134 | audit log for the branch carries the completion and the warranty issue                                                        | 200                                                 | `8939a584-0d93-4417-8d1b-f0eb67a23249` | `{"count":44,"missing":[]}`                                                                                                                                                            |
| 135 | both declared audit actions were really written                                                                               | both present                                        | -                                      | `{"missing":[]}`                                                                                                                                                                       |
| 136 | refusal journey: customer created                                                                                             | 201                                                 | `4f92fb83-fe42-4f99-ba4f-63c38dafc2d5` | `{"customerId":"3ea348a5-0a66-48a7-b0e1-549dd47a5162","displayNumber":"000002"}`                                                                                                       |
| 137 | refusal journey: vehicle created                                                                                              | 201                                                 | `6ffa54ca-daa8-4cb8-88db-211ada721323` | `{"vehicleId":"1b1a5ca8-4e15-4bca-b811-ac1009e308c2","lifecycle":"draft"}`                                                                                                             |
| 138 | refusal journey: vehicle linked to the customer                                                                               | 201                                                 | `6ecadea9-eec6-4046-976e-5841ab978e51` | `{}`                                                                                                                                                                                   |
| 139 | refusal journey: reception created (walk-in)                                                                                  | 201                                                 | `4db328a3-31e0-479c-818b-d9e5e1d828a4` | `{"receptionVisitId":"6aa5e81a-f8a9-4e77-9640-d78e73bc96bc","receptionStatus":"opened","recordVersion":1}`                                                                             |
| 140 | refusal journey: the customer recorded on the visit as the authorized receiver                                                | 201                                                 | `3b46e308-b115-4118-9f06-699a66333f77` | `{"role":"authorized_receiver"}`                                                                                                                                                       |
| 141 | refusal journey: the customer AUTHORIZES the work                                                                             | 201                                                 | `5edcc519-ccc9-44c5-b9cb-96348a4ef56d` | `{"decision":"approved"}`                                                                                                                                                              |
| 142 | refusal journey: reception detail, for its record version                                                                     | 200                                                 | `db7b0a88-0642-4579-b5da-e1f27bd2f489` | `{"receptionStatus":"opened","recordVersion":1}`                                                                                                                                       |
| 143 | refusal journey: reception approved                                                                                           | 200                                                 | `9d1d863c-3786-43ed-a8f0-1f3840281d32` | `{"receptionStatus":"authorized","recordVersion":3}`                                                                                                                                   |
| 144 | refusal journey: reception converted to a WORK ORDER                                                                          | 200                                                 | `315781f4-1b07-4a4f-a62f-365308441029` | `{"workOrderId":"c21173d4-6507-41c5-a81f-4153f8ad4bc8"}`                                                                                                                               |
| 145 | a second employee added to the register, to be retired                                                                        | 201                                                 | `87fb1ead-4530-4901-8a9e-56a64d9766fa` | `{"id":"5b138ddd-46c8-4ac1-b425-32eb2e1dc073","status":"active","recordVersion":1}`                                                                                                    |
| 146 | that employee set inactive                                                                                                    | 200                                                 | `b7ed50a3-124e-4511-a992-50d1374e537a` | `{"status":"inactive"}`                                                                                                                                                                |
| 147 | CASE: a RETIRED employee named as the person handing over is refused at Start                                                 | 422                                                 | `20e0e7e8-b6e5-40a3-91a1-401d13ccea96` | `{"code":"ERR-VAL-001","rules":["inactive_employee"]}`                                                                                                                                 |
| 148 | a second handover opened with the ACTIVE employee                                                                             | 201                                                 | `d0abdd43-18bb-4f1c-9897-41a57d18ea1b` | `{"id":"3bdd563e-2108-46ee-8ebf-dfcab342d92f","recordVersion":1}`                                                                                                                      |
| 149 | second handover: receiver verified                                                                                            | 201                                                 | `d3cfbf70-b2c7-41e5-8420-325dd5e08ba9` | `{"id":"2babbd5f-1e5c-471f-ad3f-47473a4b2a75"}`                                                                                                                                        |
| 150 | signature document: upload authorized against the reception visit                                                             | 201                                                 | `87c5384b-439f-434c-a49a-ec736eadb168` | `{"documentId":"41283abb-fbb7-496d-815d-c90ce974c008","method":"PUT"}`                                                                                                                 |
| 151 | signature document: bytes stored at the presigned destination                                                                 | 200                                                 | -                                      | `{"bytes":67}`                                                                                                                                                                         |
| 152 | signature document: version registered and scanned                                                                            | 201                                                 | `7fa78f8e-d82c-4a2e-8392-8090e775b2af` | `{"versionId":"bf7b5bee-972f-4dcb-908d-3bb0741b4c06","status":"accepted","scanStatus":"clean"}`                                                                                        |
| 153 | signature document: linked to the reception visit, which is its provenance                                                    | 201                                                 | `51fa92a5-01df-4cca-80f7-2911104e07b3` | `{"linkId":"01a9db6b-7ff7-47aa-b10b-01952dbd5665"}`                                                                                                                                    |
| 154 | second handover: signature bound                                                                                              | 201                                                 | `d44c7952-2a6d-47be-891d-9820ee1eb106` | `{}`                                                                                                                                                                                   |
| 155 | second handover: eligibility names the unanswered checklist                                                                   | 200                                                 | `68f455e1-4e25-4d82-9214-d066b08fd4ea` | `{"eligible":false,"blockers":["work_order_not_complete","financial_balance_outstanding","checklist_incomplete"],"checklistGaps":2}`                                                   |
| 156 | CASE: completion with the active template's mandatory items unanswered is refused                                             | 409                                                 | `d2ba42c7-9266-4f59-a417-15e9023db4c9` | `{"code":"ERR-TRN-001"}`                                                                                                                                                               |
| 157 | ISOLATION: organisation B cannot read organisation A's delivery                                                               | 404                                                 | `3b7d1bcb-19a0-4f5b-8019-3ff167869ff0` | `{"code":"ERR-RES-001"}`                                                                                                                                                               |
| 158 | ISOLATION: organisation B cannot read organisation A's warranty                                                               | 404                                                 | `d5fc9012-bb55-40c4-b261-91f756ca55d2` | `{"code":"ERR-RES-001"}`                                                                                                                                                               |
| 159 | ISOLATION: organisation B naming organisation A's branch sees no row                                                          | 403                                                 | `831978ff-4ba3-41b1-89fe-29c8c1d90bf8` | `{"rows":0}`                                                                                                                                                                           |
| 160 | ISOLATION: organisation B's readiness queue carried NO row of organisation A's — refused before any row, so the count is moot | 403                                                 | `831978ff-4ba3-41b1-89fe-29c8c1d90bf8` | `{"rows":null}`                                                                                                                                                                        |
| 161 | ISOLATION: organisation B cannot run a report over organisation A's branch                                                    | 403                                                 | `519e533d-7e71-47dd-905b-8920edfe2eed` | `{"rows":0}`                                                                                                                                                                           |
| 162 | ISOLATION: organisation B's report carried NO row of organisation A's — refused before any row, so the count is moot          | 403                                                 | `519e533d-7e71-47dd-905b-8920edfe2eed` | `{"rows":null}`                                                                                                                                                                        |
| 163 | a role WITHOUT sal.finance.view created                                                                                       | 201                                                 | `d3a1297e-b7bf-4afe-a40f-49d5a18df068` | `{"id":"171945ed-f471-49e3-8575-c7abf8f2d050"}`                                                                                                                                        |
| 164 | restricted role granted sal.delivery.view                                                                                     | 201                                                 | `c9bf9be4-ba6b-4b5c-b865-6321b570a2d1` | `{}`                                                                                                                                                                                   |
| 165 | restricted role granted wo.work_order.read                                                                                    | 201                                                 | `8a3a1df2-0529-4ef0-85c7-5726a82e3750` | `{}`                                                                                                                                                                                   |
| 166 | restricted role granted rpt.report.read                                                                                       | 201                                                 | `e399d754-29a9-44d0-b67c-2761a416bad6` | `{}`                                                                                                                                                                                   |
| 167 | a third person invited with the restricted role                                                                               | 201                                                 | `a3cd7936-acc9-4984-9f35-a43509882ecb` | `{"state":"invited"}`                                                                                                                                                                  |
| 168 | third person: password reset requested                                                                                        | 202                                                 | `4479e32a-cfbe-470a-8368-d398604a3972` | `{}`                                                                                                                                                                                   |
| 169 | third person: recovery link read out of the local mailbox                                                                     | found                                               | -                                      | `{"messageId":"3fbcBOHvFSUqgg3vabPwIo"}`                                                                                                                                               |
| 170 | third person: credential set through the shipped completion route                                                             | 200                                                 | `5489467f-ad89-4da1-ad58-383c8f9a447d` | `{}`                                                                                                                                                                                   |
| 171 | third person activated                                                                                                        | 200                                                 | `2f535b08-8b5c-487f-bb46-d77c3a6e3ebe` | `{}`                                                                                                                                                                                   |
| 172 | third person granted the restricted role at the branch                                                                        | 201                                                 | `a57e3be4-8467-4c98-956e-24381b71a0f3` | `{}`                                                                                                                                                                                   |
| 173 | third person: login                                                                                                           | 200                                                 | `2a565b2b-3a77-40a2-b95e-fbfe1787035a` | `{}`                                                                                                                                                                                   |
| 174 | CASE: without sal.finance.view the readiness queue is REFUSED, not blanked                                                    | 403                                                 | `8ae8d17b-b146-4994-bbb8-a4833e504328` | `{"code":"ERR-IAM-001"}`                                                                                                                                                               |
| 175 | CASE: without sal.finance.view the invoice and payment report is REFUSED                                                      | 403                                                 | `3886a7e0-e449-48f8-aea3-23ba78c18235` | `{"code":"ERR-IAM-001"}`                                                                                                                                                               |
| 176 | the same person CAN run the report whose permission they do hold                                                              | 200                                                 | `5088a8f0-d3d6-4a3c-a223-b155b18e2f3d` | `{"rows":2}`                                                                                                                                                                           |
| 177 | browser fixture: a checklist template with one mandatory item per locale                                                      | 201                                                 | `e4667d77-b76e-47d6-a117-95fe815adf7d` | `{"id":"2d3b26da-9048-46bd-9562-a05f88593321","items":3,"recordVersion":1}`                                                                                                            |
| 178 | browser fixture: template read, for its item ids and record version                                                           | 200                                                 | `aedb5b58-a3d6-4525-b85b-8630539bb476` | `{"items":3,"status":"active","recordVersion":1}`                                                                                                                                      |
| 179 | browser fixture: template status set ACTIVE                                                                                   | 200                                                 | `54d145a9-4f0e-4d99-9f95-37aef8856e6d` | `{"status":"active"}`                                                                                                                                                                  |
| 180 | browser fixture en checklist journey: customer created                                                                        | 201                                                 | `db6953b4-913d-413e-af08-8d7cdd064f7f` | `{"customerId":"d9a94b9f-42de-4985-8364-62c2c3b38e91","displayNumber":"000003"}`                                                                                                       |
| 181 | browser fixture en checklist journey: vehicle created                                                                         | 201                                                 | `2d01241d-d6de-497d-8b0f-3c003722bef6` | `{"vehicleId":"1ea13af8-114a-44b6-904e-fa6641c3299b","lifecycle":"draft"}`                                                                                                             |
| 182 | browser fixture en checklist journey: vehicle linked to the customer                                                          | 201                                                 | `0277abeb-f950-4854-9748-badf826befa8` | `{}`                                                                                                                                                                                   |
| 183 | browser fixture en checklist journey: reception created (walk-in)                                                             | 201                                                 | `638f6412-95e4-48ff-bba3-ec07da954921` | `{"receptionVisitId":"4c2f1eb6-023f-440a-bc4f-552d8195b50e","receptionStatus":"opened","recordVersion":1}`                                                                             |
| 184 | browser fixture en checklist journey: the customer recorded on the visit as the authorized receiver                           | 201                                                 | `61b4d659-23f6-4000-9694-22686d3e2370` | `{"role":"authorized_receiver"}`                                                                                                                                                       |
| 185 | browser fixture en checklist journey: the customer AUTHORIZES the work                                                        | 201                                                 | `34e85340-de77-4173-ac3b-7690cd9de753` | `{"decision":"approved"}`                                                                                                                                                              |
| 186 | browser fixture en checklist journey: reception detail, for its record version                                                | 200                                                 | `f421f246-87b6-42ff-a92b-41b21c7be22a` | `{"receptionStatus":"opened","recordVersion":1}`                                                                                                                                       |
| 187 | browser fixture en checklist journey: reception approved                                                                      | 200                                                 | `f5bafc0b-4d29-47e8-9dba-9a4301a49351` | `{"receptionStatus":"authorized","recordVersion":3}`                                                                                                                                   |
| 188 | browser fixture en checklist journey: reception converted to a WORK ORDER                                                     | 200                                                 | `16e77d94-58d1-4551-b058-bfcbc90a457f` | `{"workOrderId":"904bd37a-4696-453f-b0ed-3f00bdf0b6c3"}`                                                                                                                               |
| 189 | browser fixture en checklist: quality-control record opened                                                                   | 201                                                 | `5b504617-e90f-4e81-a725-94f958517d7e` | `{"id":"598bb10b-a56a-4001-908c-d160e176bd2a","overallResult":"pending"}`                                                                                                              |
| 190 | browser fixture en checklist: quality-control record read, for its checks and record version                                  | 200                                                 | `8c2b4cc5-cb88-4dec-9c79-79a74cdf3f2d` | `{"checks":0,"recordVersion":null}`                                                                                                                                                    |
| 191 | browser fixture en checklist: quality-control record re-read, for the If-Match the finalisation needs                         | 200                                                 | `0a6d1f1d-f2ef-40c4-b373-6854abc3ab94` | `{"recordVersion":null}`                                                                                                                                                               |
| 192 | browser fixture en checklist: quality control FINALISED passed                                                                | 200                                                 | `ba28d18a-4b23-4fad-9494-e9468f106cfe` | `{"overallResult":"passed"}`                                                                                                                                                           |
| 193 | browser fixture en checklist: closure eligibility read                                                                        | 200                                                 | `6fdd97a4-726d-4a0d-9f5e-671fd67d98ed` | `{"eligible":true,"blockers":[]}`                                                                                                                                                      |
| 194 | work order detail, for the If-Match the open transition needs                                                                 | 200                                                 | `1b482412-5342-43e8-9bc6-408d009429d8` | `{"state":"draft","recordVersion":1,"nextStates":["cancelled","open"]}`                                                                                                                |
| 195 | work order transitioned to open                                                                                               | 200                                                 | `29d1a4e2-93e4-4dbd-8aaf-83abb457701b` | `{"state":"open","from":"draft","offered":["cancelled","open"]}`                                                                                                                       |
| 196 | work order detail, for the If-Match the in_progress transition needs                                                          | 200                                                 | `37509d95-22d8-4d6c-895c-32684131858b` | `{"state":"open","recordVersion":2,"nextStates":["cancelled","in_progress"]}`                                                                                                          |
| 197 | work order transitioned to in_progress                                                                                        | 200                                                 | `3abb0440-601e-4302-b122-5e4a45d39de1` | `{"state":"in_progress","from":"open","offered":["cancelled","in_progress"]}`                                                                                                          |
| 198 | work order detail, for the If-Match the qc_pending transition needs                                                           | 200                                                 | `2f81a922-dafe-459e-9366-82e88d6b120f` | `{"state":"in_progress","recordVersion":3,"nextStates":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                               |
| 199 | work order transitioned to qc_pending                                                                                         | 200                                                 | `cb548ce5-90d2-4a73-b18d-aa0e1ab28592` | `{"state":"qc_pending","from":"in_progress","offered":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                                |
| 200 | work order detail, for the If-Match the ready_to_close transition needs                                                       | 200                                                 | `b624c45a-3f33-49d7-a2c7-e2ef4fed1cce` | `{"state":"qc_pending","recordVersion":4,"nextStates":["in_progress","ready_to_close"]}`                                                                                               |
| 201 | work order transitioned to ready_to_close                                                                                     | 200                                                 | `f57ccf6f-3b79-4dd8-ad54-150128cba343` | `{"state":"ready_to_close","from":"qc_pending","offered":["in_progress","ready_to_close"]}`                                                                                            |
| 202 | browser fixture en checklist: work order CLOSED, so the handover is not held by the work itself                               | 200                                                 | `4acc7830-1331-4103-b22a-4cc365732da9` | `{"state":"closed"}`                                                                                                                                                                   |
| 203 | browser fixture en checklist: handover opened                                                                                 | 201                                                 | `f34f6135-c9cb-492d-be5b-a80a5884e7e2` | `{"id":"cb7ad439-3ab5-457b-a269-18943f52ad1f","status":"ready"}`                                                                                                                       |
| 204 | browser fixture en checklist: authorized receiver verified                                                                    | 201                                                 | `386c9b99-38c0-4db9-aaaa-f5a29d29b7e9` | `{"id":"94bb48d4-c82a-4a66-947a-4ac13e5c08e9"}`                                                                                                                                        |
| 205 | signature document: upload authorized against the reception visit                                                             | 201                                                 | `ca5b0650-aafb-4c86-851d-0a16428fdb8f` | `{"documentId":"7d94018f-57f3-42b2-98b5-b5546df83c60","method":"PUT"}`                                                                                                                 |
| 206 | signature document: bytes stored at the presigned destination                                                                 | 200                                                 | -                                      | `{"bytes":67}`                                                                                                                                                                         |
| 207 | signature document: version registered and scanned                                                                            | 201                                                 | `fe9934c0-1929-49df-8c69-b885293f2fd2` | `{"versionId":"6ee46d24-8912-4fc0-81e2-f7b04d62a7ff","status":"accepted","scanStatus":"clean"}`                                                                                        |
| 208 | signature document: linked to the reception visit, which is its provenance                                                    | 201                                                 | `4da19cec-d10f-4119-9985-e823fa596c92` | `{"linkId":"4b7e1375-7788-4de3-a03d-9c38db5a8f19"}`                                                                                                                                    |
| 209 | browser fixture en checklist: signature bound ahead of the browser                                                            | 201                                                 | `539d8467-c2aa-46db-89f4-5980807e3362` | `{"id":"7efc7e6f-a4b2-4784-803f-036900c9fcd4"}`                                                                                                                                        |
| 210 | browser fixture en checklist: checklist item answered ahead of the browser: keys_returned                                     | 201                                                 | `f877536a-7869-48be-938b-850bcdb46221` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 211 | browser fixture en checklist: checklist item answered ahead of the browser: documents_returned                                | 201                                                 | `8a777464-3b81-4b60-8d49-12a600e09a34` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 212 | browser fixture en checklist: checklist item answered ahead of the browser: browser_ar_release_check                          | 201                                                 | `dfbfef78-9967-4c86-a473-c42d2103c3a7` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 213 | browser fixture en checklist: the reasons standing when the browser arrives                                                   | 200                                                 | `ea774ab1-16eb-469c-9f19-71b6aa60df41` | `{"eligible":false,"blockers":["financial_balance_outstanding","checklist_incomplete"],"checklistGaps":1,"recordVersion":3}`                                                           |
| 214 | browser fixture en checklist: the handover carries exactly the reasons its browser case is about                              | checklist_incomplete, financial_balance_outstanding | -                                      | `{"deliveryId":"cb7ad439-3ab5-457b-a269-18943f52ad1f","blockers":["checklist_incomplete","financial_balance_outstanding"],"expected":["checklist_incomplete","financial_balance_ou...` |
| 215 | browser fixture en checklist: the vehicle's recorded odometer readings, before the handover                                   | 200                                                 | `bf3bc325-2858-43f0-851e-6acb4ae3e5fa` | `{"readings":0}`                                                                                                                                                                       |
| 216 | browser fixture en checklist: the vehicle has no odometer reading, so the value the case sends is above it                    | 0                                                   | -                                      | `{"readings":[],"sending":"34567.8"}`                                                                                                                                                  |
| 217 | browser fixture en signature journey: customer created                                                                        | 201                                                 | `d0f5347d-5154-4ede-b37b-9008b4fb54a1` | `{"customerId":"016c635d-09d3-4de7-8e91-46f3b0b49066","displayNumber":"000004"}`                                                                                                       |
| 218 | browser fixture en signature journey: vehicle created                                                                         | 201                                                 | `6f8382a4-3803-4b26-a68e-d920dc39b5d4` | `{"vehicleId":"b6b04c39-258c-4a74-a473-4168ef8fa911","lifecycle":"draft"}`                                                                                                             |
| 219 | browser fixture en signature journey: vehicle linked to the customer                                                          | 201                                                 | `6591b0f5-db27-46ed-80dc-68c73a70a470` | `{}`                                                                                                                                                                                   |
| 220 | browser fixture en signature journey: reception created (walk-in)                                                             | 201                                                 | `303b5c10-e168-4d12-bb08-2a6e90475b5f` | `{"receptionVisitId":"57fbe773-77e8-44c3-be99-46458c49f826","receptionStatus":"opened","recordVersion":1}`                                                                             |
| 221 | browser fixture en signature journey: the customer recorded on the visit as the authorized receiver                           | 201                                                 | `6a9fe667-08b9-4956-8c08-6320df512b5c` | `{"role":"authorized_receiver"}`                                                                                                                                                       |
| 222 | browser fixture en signature journey: the customer AUTHORIZES the work                                                        | 201                                                 | `e95c1c15-36a9-41bc-9d6d-aff918932165` | `{"decision":"approved"}`                                                                                                                                                              |
| 223 | browser fixture en signature journey: reception detail, for its record version                                                | 200                                                 | `159148b1-4b2b-468e-8df5-bee92ffae8a9` | `{"receptionStatus":"opened","recordVersion":1}`                                                                                                                                       |
| 224 | browser fixture en signature journey: reception approved                                                                      | 200                                                 | `15e72d7f-1664-4803-89bd-9c597bc5834e` | `{"receptionStatus":"authorized","recordVersion":3}`                                                                                                                                   |
| 225 | browser fixture en signature journey: reception converted to a WORK ORDER                                                     | 200                                                 | `d3f1a052-d803-4e6a-85bd-17b73eaf326b` | `{"workOrderId":"90ad64be-7d28-4200-8844-3db259cdf1c1"}`                                                                                                                               |
| 226 | browser fixture en signature: quality-control record opened                                                                   | 201                                                 | `2bea82e3-dcf5-4ab3-b160-488c8a1279d0` | `{"id":"d8c50152-739b-4858-a1cb-1060bd64ec14","overallResult":"pending"}`                                                                                                              |
| 227 | browser fixture en signature: quality-control record read, for its checks and record version                                  | 200                                                 | `4baf5d68-6650-4e81-90dc-feb867503da9` | `{"checks":0,"recordVersion":null}`                                                                                                                                                    |
| 228 | browser fixture en signature: quality-control record re-read, for the If-Match the finalisation needs                         | 200                                                 | `d4fa639e-12f8-4cbd-9327-5187eb1c08c6` | `{"recordVersion":null}`                                                                                                                                                               |
| 229 | browser fixture en signature: quality control FINALISED passed                                                                | 200                                                 | `8a9a7f98-878a-4ba9-a76f-417e567b7e35` | `{"overallResult":"passed"}`                                                                                                                                                           |
| 230 | browser fixture en signature: closure eligibility read                                                                        | 200                                                 | `d04a3f3d-1cd0-43a9-97e4-c1ab4c987481` | `{"eligible":true,"blockers":[]}`                                                                                                                                                      |
| 231 | work order detail, for the If-Match the open transition needs                                                                 | 200                                                 | `18782892-42f0-4910-b54b-547468ce3cec` | `{"state":"draft","recordVersion":1,"nextStates":["cancelled","open"]}`                                                                                                                |
| 232 | work order transitioned to open                                                                                               | 200                                                 | `a4475a62-cdd1-4982-8e51-40d07bb647fa` | `{"state":"open","from":"draft","offered":["cancelled","open"]}`                                                                                                                       |
| 233 | work order detail, for the If-Match the in_progress transition needs                                                          | 200                                                 | `39e00a8e-a3f5-4e8c-9c60-0aa195f827ff` | `{"state":"open","recordVersion":2,"nextStates":["cancelled","in_progress"]}`                                                                                                          |
| 234 | work order transitioned to in_progress                                                                                        | 200                                                 | `10ce0ccc-c26b-41ba-9c9f-eaef12e7e8ff` | `{"state":"in_progress","from":"open","offered":["cancelled","in_progress"]}`                                                                                                          |
| 235 | work order detail, for the If-Match the qc_pending transition needs                                                           | 200                                                 | `6c693812-2555-4cce-b696-fa56dd267155` | `{"state":"in_progress","recordVersion":3,"nextStates":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                               |
| 236 | work order transitioned to qc_pending                                                                                         | 200                                                 | `c95546a1-b6dd-4df6-9eb7-54b8e282296f` | `{"state":"qc_pending","from":"in_progress","offered":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                                |
| 237 | work order detail, for the If-Match the ready_to_close transition needs                                                       | 200                                                 | `b69fba40-2c04-46cf-83c1-e9d30c04d012` | `{"state":"qc_pending","recordVersion":4,"nextStates":["in_progress","ready_to_close"]}`                                                                                               |
| 238 | work order transitioned to ready_to_close                                                                                     | 200                                                 | `43781d7e-0b7e-4ecd-987b-be19e46882d7` | `{"state":"ready_to_close","from":"qc_pending","offered":["in_progress","ready_to_close"]}`                                                                                            |
| 239 | browser fixture en signature: work order CLOSED, so the handover is not held by the work itself                               | 200                                                 | `94ceae5f-3147-475c-966d-9b8bd45c5ef3` | `{"state":"closed"}`                                                                                                                                                                   |
| 240 | browser fixture en signature: handover opened                                                                                 | 201                                                 | `a8264504-3780-408d-862f-2eed14b1270f` | `{"id":"8a73bb54-34ea-4fb1-a952-2d76b61714c1","status":"ready"}`                                                                                                                       |
| 241 | browser fixture en signature: authorized receiver verified                                                                    | 201                                                 | `7227e780-61db-4b25-870f-ea51e586c2ca` | `{"id":"6b53d47d-5951-47bd-a80b-8245d43be5f0"}`                                                                                                                                        |
| 242 | browser fixture en signature: checklist item answered ahead of the browser: keys_returned                                     | 201                                                 | `fc5abc04-1562-4735-8bea-95e2f4ceb4a3` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 243 | browser fixture en signature: checklist item answered ahead of the browser: documents_returned                                | 201                                                 | `d08ad3ec-7021-44dc-82e2-650b06b303ee` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 244 | browser fixture en signature: checklist item answered ahead of the browser: browser_en_release_check                          | 201                                                 | `2b719510-1a88-458c-9d8f-5ec1268e8c81` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 245 | browser fixture en signature: checklist item answered ahead of the browser: browser_ar_release_check                          | 201                                                 | `254400a4-ba2b-4e0a-8635-7f8fe1f55277` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 246 | browser fixture en signature: the reasons standing when the browser arrives                                                   | 200                                                 | `a0c62818-8cc5-462a-837d-f2b860e00e84` | `{"eligible":false,"blockers":["financial_balance_outstanding","signature_missing"],"checklistGaps":0,"recordVersion":2}`                                                              |
| 247 | browser fixture en signature: the handover carries exactly the reasons its browser case is about                              | financial_balance_outstanding, signature_missing    | -                                      | `{"deliveryId":"8a73bb54-34ea-4fb1-a952-2d76b61714c1","blockers":["financial_balance_outstanding","signature_missing"],"expected":["financial_balance_outstanding","signature_miss...` |
| 248 | browser fixture en signature: the vehicle's recorded odometer readings, before the handover                                   | 200                                                 | `de349c0d-e964-4d22-8016-ba5c5050df98` | `{"readings":0}`                                                                                                                                                                       |
| 249 | browser fixture en signature: the vehicle has no odometer reading, so the value the case sends is above it                    | 0                                                   | -                                      | `{"readings":[],"sending":"34567.8"}`                                                                                                                                                  |
| 250 | browser fixture en release journey: customer created                                                                          | 201                                                 | `29b42871-da73-4f88-8637-d1d081f56d60` | `{"customerId":"ac34cf73-d69d-4e6c-844f-2ae85a4d0688","displayNumber":"000005"}`                                                                                                       |
| 251 | browser fixture en release journey: vehicle created                                                                           | 201                                                 | `00ee46d0-8c0f-46a4-a53a-f338952298fb` | `{"vehicleId":"5d5fa73f-7b1e-443b-8a60-5962ee633c01","lifecycle":"draft"}`                                                                                                             |
| 252 | browser fixture en release journey: vehicle linked to the customer                                                            | 201                                                 | `de0b1c20-aa32-43fc-b70b-ebd4d4aecf90` | `{}`                                                                                                                                                                                   |
| 253 | browser fixture en release journey: reception created (walk-in)                                                               | 201                                                 | `91499a7a-23df-47df-b5de-d1f6e8e58c5b` | `{"receptionVisitId":"5ccea262-e1e4-4923-818c-7fde7b5e1a9c","receptionStatus":"opened","recordVersion":1}`                                                                             |
| 254 | browser fixture en release journey: the customer recorded on the visit as the authorized receiver                             | 201                                                 | `3d84f4a4-6b6b-4374-8aa9-ffeb59faedf8` | `{"role":"authorized_receiver"}`                                                                                                                                                       |
| 255 | browser fixture en release journey: the customer AUTHORIZES the work                                                          | 201                                                 | `336e8909-8ee5-4a20-8a01-08a4c15bb47c` | `{"decision":"approved"}`                                                                                                                                                              |
| 256 | browser fixture en release journey: reception detail, for its record version                                                  | 200                                                 | `372a4953-d0d2-4bbb-9338-734128c18ae7` | `{"receptionStatus":"opened","recordVersion":1}`                                                                                                                                       |
| 257 | browser fixture en release journey: reception approved                                                                        | 200                                                 | `81080b55-994a-4037-8e29-d5cd64449c04` | `{"receptionStatus":"authorized","recordVersion":3}`                                                                                                                                   |
| 258 | browser fixture en release journey: reception converted to a WORK ORDER                                                       | 200                                                 | `f2acc5f8-a05c-446a-82ef-d480fa63fdf4` | `{"workOrderId":"b4cbb8e7-9fbb-426f-b774-09c14df2bb0e"}`                                                                                                                               |
| 259 | browser fixture en release: quality-control record opened                                                                     | 201                                                 | `17d7cb4c-68ba-4739-8d27-dd525d8dea71` | `{"id":"83a1d5b6-3e12-40e2-9ff8-ded60ecef69f","overallResult":"pending"}`                                                                                                              |
| 260 | browser fixture en release: quality-control record read, for its checks and record version                                    | 200                                                 | `e5b67539-2425-4f31-b217-747188cd1d42` | `{"checks":0,"recordVersion":null}`                                                                                                                                                    |
| 261 | browser fixture en release: quality-control record re-read, for the If-Match the finalisation needs                           | 200                                                 | `dc759099-f1f5-4e31-b2db-f6dbd7cdc49f` | `{"recordVersion":null}`                                                                                                                                                               |
| 262 | browser fixture en release: quality control FINALISED passed                                                                  | 200                                                 | `e2ffd9d7-8d3c-4a63-b46e-f0d7cfd1f94d` | `{"overallResult":"passed"}`                                                                                                                                                           |
| 263 | browser fixture en release: closure eligibility read                                                                          | 200                                                 | `a3f662e6-2824-4f0f-a126-e4bfb8466c24` | `{"eligible":true,"blockers":[]}`                                                                                                                                                      |
| 264 | work order detail, for the If-Match the open transition needs                                                                 | 200                                                 | `c5b5789c-0032-4c3d-aa76-18b2e42976f4` | `{"state":"draft","recordVersion":1,"nextStates":["cancelled","open"]}`                                                                                                                |
| 265 | work order transitioned to open                                                                                               | 200                                                 | `90f3bc4b-009b-4017-b5ad-dff343a9238e` | `{"state":"open","from":"draft","offered":["cancelled","open"]}`                                                                                                                       |
| 266 | work order detail, for the If-Match the in_progress transition needs                                                          | 200                                                 | `c89317b5-2e05-4a1b-a06d-6e560d831dee` | `{"state":"open","recordVersion":2,"nextStates":["cancelled","in_progress"]}`                                                                                                          |
| 267 | work order transitioned to in_progress                                                                                        | 200                                                 | `6a18f91a-0e05-4c98-9d52-7f1fdc61deed` | `{"state":"in_progress","from":"open","offered":["cancelled","in_progress"]}`                                                                                                          |
| 268 | work order detail, for the If-Match the qc_pending transition needs                                                           | 200                                                 | `27eda908-cb33-47b8-8675-84c3eb438ce4` | `{"state":"in_progress","recordVersion":3,"nextStates":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                               |
| 269 | work order transitioned to qc_pending                                                                                         | 200                                                 | `90f349f1-68a3-48e4-ab8a-5f3be75d8ce0` | `{"state":"qc_pending","from":"in_progress","offered":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                                |
| 270 | work order detail, for the If-Match the ready_to_close transition needs                                                       | 200                                                 | `d4167c54-2913-4f72-8c52-d3429aaad89c` | `{"state":"qc_pending","recordVersion":4,"nextStates":["in_progress","ready_to_close"]}`                                                                                               |
| 271 | work order transitioned to ready_to_close                                                                                     | 200                                                 | `43c107f1-3f17-4694-bbae-ebef3d3f2f91` | `{"state":"ready_to_close","from":"qc_pending","offered":["in_progress","ready_to_close"]}`                                                                                            |
| 272 | browser fixture en release: work order CLOSED, so the handover is not held by the work itself                                 | 200                                                 | `be172be6-011c-4499-9d6d-801c8b070dc9` | `{"state":"closed"}`                                                                                                                                                                   |
| 273 | browser fixture en release: handover opened                                                                                   | 201                                                 | `b1d8df5e-5757-46b5-ba60-fadde614627c` | `{"id":"15ffafd5-5e35-4f9d-8fb1-2a7f12469d9a","status":"ready"}`                                                                                                                       |
| 274 | browser fixture en release: authorized receiver verified                                                                      | 201                                                 | `e1f80c8c-0d5f-448b-bb05-90ae5ec6729b` | `{"id":"1f359c4a-f320-4dec-bf57-bb10938d5a4b"}`                                                                                                                                        |
| 275 | signature document: upload authorized against the reception visit                                                             | 201                                                 | `426be381-ce48-4ec5-82a0-6ea489ed13b3` | `{"documentId":"4bf7d1b5-72e4-40e7-b30a-8ec52351bba4","method":"PUT"}`                                                                                                                 |
| 276 | signature document: bytes stored at the presigned destination                                                                 | 200                                                 | -                                      | `{"bytes":67}`                                                                                                                                                                         |
| 277 | signature document: version registered and scanned                                                                            | 201                                                 | `a2b10c78-2df4-40c5-9847-cc429d0456a8` | `{"versionId":"acb83113-9315-4158-8929-cf3b827171b3","status":"accepted","scanStatus":"clean"}`                                                                                        |
| 278 | signature document: linked to the reception visit, which is its provenance                                                    | 201                                                 | `da7b2b63-b364-4fc4-9a94-63a835760c8e` | `{"linkId":"54fbcf4a-224f-4b59-bacd-caff2f04cf34"}`                                                                                                                                    |
| 279 | browser fixture en release: signature bound ahead of the browser                                                              | 201                                                 | `c30e3659-51e9-45fb-957b-9b3d2bc5799f` | `{"id":"406eb3d4-67a0-4ddd-90f8-916ee69fb235"}`                                                                                                                                        |
| 280 | browser fixture en release: checklist item answered ahead of the browser: keys_returned                                       | 201                                                 | `a083027a-4962-41e9-98a2-32392a05a2e3` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 281 | browser fixture en release: checklist item answered ahead of the browser: documents_returned                                  | 201                                                 | `0588e10d-4327-49a8-968a-271d7b061fda` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 282 | browser fixture en release: checklist item answered ahead of the browser: browser_en_release_check                            | 201                                                 | `4f61715c-b012-416c-8765-ab9c1c1be1a3` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 283 | browser fixture en release: checklist item answered ahead of the browser: browser_ar_release_check                            | 201                                                 | `5f09a08e-b80b-465e-ad5c-76b36496ab08` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 284 | browser fixture en release: the reasons standing when the browser arrives                                                     | 200                                                 | `8325c5f2-8bf0-430d-83ed-dce9cadbd5cf` | `{"eligible":false,"blockers":["financial_balance_outstanding"],"checklistGaps":0,"recordVersion":3}`                                                                                  |
| 285 | browser fixture en release: the handover carries exactly the reasons its browser case is about                                | financial_balance_outstanding                       | -                                      | `{"deliveryId":"15ffafd5-5e35-4f9d-8fb1-2a7f12469d9a","blockers":["financial_balance_outstanding"],"expected":["financial_balance_outstanding"]}`                                      |
| 286 | browser fixture en release: the vehicle's recorded odometer readings, before the handover                                     | 200                                                 | `e356f244-8a76-4609-bf97-942d401a74fc` | `{"readings":0}`                                                                                                                                                                       |
| 287 | browser fixture en release: the vehicle has no odometer reading, so the value the case sends is above it                      | 0                                                   | -                                      | `{"readings":[],"sending":"34567.8"}`                                                                                                                                                  |
| 288 | browser fixture ar checklist journey: customer created                                                                        | 201                                                 | `9c4f05e0-aa42-44d4-b51a-8c51a40b9837` | `{"customerId":"4f5d11a3-e029-4d52-bb5a-19dd6f8c6a0e","displayNumber":"000006"}`                                                                                                       |
| 289 | browser fixture ar checklist journey: vehicle created                                                                         | 201                                                 | `5642c804-47a0-42b4-9af8-4e8df02937d5` | `{"vehicleId":"217d014f-8df2-421f-a4a8-204c2e1bb7a8","lifecycle":"draft"}`                                                                                                             |
| 290 | browser fixture ar checklist journey: vehicle linked to the customer                                                          | 201                                                 | `aa1a7d1f-aaeb-41d0-8cb9-c72bee983128` | `{}`                                                                                                                                                                                   |
| 291 | browser fixture ar checklist journey: reception created (walk-in)                                                             | 201                                                 | `bf1a43be-8896-4b98-9ace-2700f6908d33` | `{"receptionVisitId":"4776ea3a-43bb-4c79-adce-570a00b1d2be","receptionStatus":"opened","recordVersion":1}`                                                                             |
| 292 | browser fixture ar checklist journey: the customer recorded on the visit as the authorized receiver                           | 201                                                 | `29483966-7dbe-40d8-807f-73e3b69c7857` | `{"role":"authorized_receiver"}`                                                                                                                                                       |
| 293 | browser fixture ar checklist journey: the customer AUTHORIZES the work                                                        | 201                                                 | `3664ba7d-6a1d-4cb2-be4e-4f25f5256cf9` | `{"decision":"approved"}`                                                                                                                                                              |
| 294 | browser fixture ar checklist journey: reception detail, for its record version                                                | 200                                                 | `a54b7530-f5c7-4852-a39d-68eee3a4cdbb` | `{"receptionStatus":"opened","recordVersion":1}`                                                                                                                                       |
| 295 | browser fixture ar checklist journey: reception approved                                                                      | 200                                                 | `508ad5c9-a9e8-4c6d-9ed1-edc8542d9766` | `{"receptionStatus":"authorized","recordVersion":3}`                                                                                                                                   |
| 296 | browser fixture ar checklist journey: reception converted to a WORK ORDER                                                     | 200                                                 | `de34e675-3d0f-418f-9819-fd07fa6d5216` | `{"workOrderId":"a16d56ff-6feb-4137-b806-a7f230888b27"}`                                                                                                                               |
| 297 | browser fixture ar checklist: quality-control record opened                                                                   | 201                                                 | `6ead67e1-cb9d-4323-aa1c-75ae7e59a766` | `{"id":"a324b55f-5a88-43f4-b358-95b3f721db7c","overallResult":"pending"}`                                                                                                              |
| 298 | browser fixture ar checklist: quality-control record read, for its checks and record version                                  | 200                                                 | `80ab5555-582f-4251-b382-725abe5a49f6` | `{"checks":0,"recordVersion":null}`                                                                                                                                                    |
| 299 | browser fixture ar checklist: quality-control record re-read, for the If-Match the finalisation needs                         | 200                                                 | `2609c23f-24de-4900-8ff8-7fc79139af0e` | `{"recordVersion":null}`                                                                                                                                                               |
| 300 | browser fixture ar checklist: quality control FINALISED passed                                                                | 200                                                 | `4b4afc00-7852-4281-a6c7-4f6d5152a746` | `{"overallResult":"passed"}`                                                                                                                                                           |
| 301 | browser fixture ar checklist: closure eligibility read                                                                        | 200                                                 | `9be23252-b0b0-4181-af6e-8fe07e6ef0d6` | `{"eligible":true,"blockers":[]}`                                                                                                                                                      |
| 302 | work order detail, for the If-Match the open transition needs                                                                 | 200                                                 | `a0778967-db55-48af-8485-e964b1c754ce` | `{"state":"draft","recordVersion":1,"nextStates":["cancelled","open"]}`                                                                                                                |
| 303 | work order transitioned to open                                                                                               | 200                                                 | `279f5322-33b5-488d-a7d4-90a3950731dd` | `{"state":"open","from":"draft","offered":["cancelled","open"]}`                                                                                                                       |
| 304 | work order detail, for the If-Match the in_progress transition needs                                                          | 200                                                 | `ec9c0924-a13a-4a3f-88ff-c29b710e114f` | `{"state":"open","recordVersion":2,"nextStates":["cancelled","in_progress"]}`                                                                                                          |
| 305 | work order transitioned to in_progress                                                                                        | 200                                                 | `bda95297-632a-4363-b596-7d0e2503cdab` | `{"state":"in_progress","from":"open","offered":["cancelled","in_progress"]}`                                                                                                          |
| 306 | work order detail, for the If-Match the qc_pending transition needs                                                           | 200                                                 | `becf769f-9f93-4621-b639-8b7ee5874698` | `{"state":"in_progress","recordVersion":3,"nextStates":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                               |
| 307 | work order transitioned to qc_pending                                                                                         | 200                                                 | `cb81808a-e471-499f-a88a-dc0c5efabe67` | `{"state":"qc_pending","from":"in_progress","offered":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                                |
| 308 | work order detail, for the If-Match the ready_to_close transition needs                                                       | 200                                                 | `9ab2e93a-13fe-452c-b337-69c199272d77` | `{"state":"qc_pending","recordVersion":4,"nextStates":["in_progress","ready_to_close"]}`                                                                                               |
| 309 | work order transitioned to ready_to_close                                                                                     | 200                                                 | `551a0ec9-6a8f-4e2c-86df-093436bd058a` | `{"state":"ready_to_close","from":"qc_pending","offered":["in_progress","ready_to_close"]}`                                                                                            |
| 310 | browser fixture ar checklist: work order CLOSED, so the handover is not held by the work itself                               | 200                                                 | `758ff449-4c86-4a9c-885c-6a43981b75a6` | `{"state":"closed"}`                                                                                                                                                                   |
| 311 | browser fixture ar checklist: handover opened                                                                                 | 201                                                 | `5599f6f3-ab1c-4967-b735-e94f7afbf39c` | `{"id":"e71b1a56-1811-46b5-b0b6-e3ab9778f4ea","status":"ready"}`                                                                                                                       |
| 312 | browser fixture ar checklist: authorized receiver verified                                                                    | 201                                                 | `2ed4b446-9a1b-4d15-8977-629a6a4a39c2` | `{"id":"7ecb2e73-12ee-4b24-adf0-7a8b75538956"}`                                                                                                                                        |
| 313 | signature document: upload authorized against the reception visit                                                             | 201                                                 | `24afd850-c7ab-4c89-94f1-d4ef91990bbd` | `{"documentId":"d5845728-3b1c-4009-8f34-7dfd8e1a228f","method":"PUT"}`                                                                                                                 |
| 314 | signature document: bytes stored at the presigned destination                                                                 | 200                                                 | -                                      | `{"bytes":67}`                                                                                                                                                                         |
| 315 | signature document: version registered and scanned                                                                            | 201                                                 | `dfedf694-4f8d-4b83-9d3e-4add63a1b403` | `{"versionId":"17a8e236-8466-4a76-9302-e184290db61a","status":"accepted","scanStatus":"clean"}`                                                                                        |
| 316 | signature document: linked to the reception visit, which is its provenance                                                    | 201                                                 | `80b48ff3-7971-48f3-bed1-082951291d10` | `{"linkId":"9fe35129-dc39-40e9-8e6c-fe173da7d932"}`                                                                                                                                    |
| 317 | browser fixture ar checklist: signature bound ahead of the browser                                                            | 201                                                 | `1d47fe3e-1c88-402f-a814-8b6d0c4f0ed0` | `{"id":"fdf32b39-6c3f-40c4-846d-0f96fec83820"}`                                                                                                                                        |
| 318 | browser fixture ar checklist: checklist item answered ahead of the browser: keys_returned                                     | 201                                                 | `64789c11-d31e-40cc-891a-63329c1757d4` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 319 | browser fixture ar checklist: checklist item answered ahead of the browser: documents_returned                                | 201                                                 | `22a0bed8-948f-47a3-be05-fa7aa080f98d` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 320 | browser fixture ar checklist: checklist item answered ahead of the browser: browser_en_release_check                          | 201                                                 | `0a084c1a-54af-46af-9067-b48dc3a68b2c` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 321 | browser fixture ar checklist: the reasons standing when the browser arrives                                                   | 200                                                 | `1a29f6c9-0527-4a0f-ba12-3b51abeecf4e` | `{"eligible":false,"blockers":["financial_balance_outstanding","checklist_incomplete"],"checklistGaps":1,"recordVersion":3}`                                                           |
| 322 | browser fixture ar checklist: the handover carries exactly the reasons its browser case is about                              | checklist_incomplete, financial_balance_outstanding | -                                      | `{"deliveryId":"e71b1a56-1811-46b5-b0b6-e3ab9778f4ea","blockers":["checklist_incomplete","financial_balance_outstanding"],"expected":["checklist_incomplete","financial_balance_ou...` |
| 323 | browser fixture ar checklist: the vehicle's recorded odometer readings, before the handover                                   | 200                                                 | `c767bb28-bc6e-466e-898d-1ab83e93e4db` | `{"readings":0}`                                                                                                                                                                       |
| 324 | browser fixture ar checklist: the vehicle has no odometer reading, so the value the case sends is above it                    | 0                                                   | -                                      | `{"readings":[],"sending":"34567.8"}`                                                                                                                                                  |
| 325 | browser fixture ar signature journey: customer created                                                                        | 201                                                 | `4361b7c2-2c0f-4cda-b8cf-e2204d369d6f` | `{"customerId":"4be9515f-0e73-4d98-9606-c4b45551b2e3","displayNumber":"000007"}`                                                                                                       |
| 326 | browser fixture ar signature journey: vehicle created                                                                         | 201                                                 | `b84cf5d4-33d4-4b4c-b87c-c993f9a7bdc1` | `{"vehicleId":"96913f82-75aa-4a2e-8e97-116e6edc97af","lifecycle":"draft"}`                                                                                                             |
| 327 | browser fixture ar signature journey: vehicle linked to the customer                                                          | 201                                                 | `6612dd69-9412-4230-87df-1a1bb96d8172` | `{}`                                                                                                                                                                                   |
| 328 | browser fixture ar signature journey: reception created (walk-in)                                                             | 201                                                 | `530db64d-ffca-4ee9-b98c-db175a9680f2` | `{"receptionVisitId":"07e053cf-c36d-4363-8e65-c50ea21b9361","receptionStatus":"opened","recordVersion":1}`                                                                             |
| 329 | browser fixture ar signature journey: the customer recorded on the visit as the authorized receiver                           | 201                                                 | `c1e5e4a0-fd25-4a2c-88da-9329d9cc7d3b` | `{"role":"authorized_receiver"}`                                                                                                                                                       |
| 330 | browser fixture ar signature journey: the customer AUTHORIZES the work                                                        | 201                                                 | `86702f73-ee50-44f7-ad5d-7e2fc47e1da1` | `{"decision":"approved"}`                                                                                                                                                              |
| 331 | browser fixture ar signature journey: reception detail, for its record version                                                | 200                                                 | `ae08c598-eec9-4cdd-ba31-0638348c0cc2` | `{"receptionStatus":"opened","recordVersion":1}`                                                                                                                                       |
| 332 | browser fixture ar signature journey: reception approved                                                                      | 200                                                 | `cb0007eb-cbfc-41a4-9f19-32de9b2d7667` | `{"receptionStatus":"authorized","recordVersion":3}`                                                                                                                                   |
| 333 | browser fixture ar signature journey: reception converted to a WORK ORDER                                                     | 200                                                 | `39c2924a-3069-4618-862d-41940cc8eb0c` | `{"workOrderId":"6b41e841-9d8e-4d15-abc2-040427f3c52b"}`                                                                                                                               |
| 334 | browser fixture ar signature: quality-control record opened                                                                   | 201                                                 | `e9f09406-bb7a-4f2c-88d3-37bc9b90273c` | `{"id":"d5a533b0-dc8e-4cc0-b646-1590b3f887ff","overallResult":"pending"}`                                                                                                              |
| 335 | browser fixture ar signature: quality-control record read, for its checks and record version                                  | 200                                                 | `6042b3eb-9a80-49fa-ac3c-77825ea56619` | `{"checks":0,"recordVersion":null}`                                                                                                                                                    |
| 336 | browser fixture ar signature: quality-control record re-read, for the If-Match the finalisation needs                         | 200                                                 | `1cf16e4b-921a-4f89-aa78-ccee53af4b71` | `{"recordVersion":null}`                                                                                                                                                               |
| 337 | browser fixture ar signature: quality control FINALISED passed                                                                | 200                                                 | `7ff4170d-cb05-4c97-9c9b-20d2c19364d5` | `{"overallResult":"passed"}`                                                                                                                                                           |
| 338 | browser fixture ar signature: closure eligibility read                                                                        | 200                                                 | `a88d679f-efaf-429b-ac09-1e4f9f92e962` | `{"eligible":true,"blockers":[]}`                                                                                                                                                      |
| 339 | work order detail, for the If-Match the open transition needs                                                                 | 200                                                 | `7494420c-940c-47d8-b490-6b4123ea2026` | `{"state":"draft","recordVersion":1,"nextStates":["cancelled","open"]}`                                                                                                                |
| 340 | work order transitioned to open                                                                                               | 200                                                 | `895012b4-b27a-4d48-b04a-b58831c8014f` | `{"state":"open","from":"draft","offered":["cancelled","open"]}`                                                                                                                       |
| 341 | work order detail, for the If-Match the in_progress transition needs                                                          | 200                                                 | `aaf9ac2d-c774-41f0-93e8-9eee962e846c` | `{"state":"open","recordVersion":2,"nextStates":["cancelled","in_progress"]}`                                                                                                          |
| 342 | work order transitioned to in_progress                                                                                        | 200                                                 | `bc5887f8-f305-4171-aa8a-29f965714c29` | `{"state":"in_progress","from":"open","offered":["cancelled","in_progress"]}`                                                                                                          |
| 343 | work order detail, for the If-Match the qc_pending transition needs                                                           | 200                                                 | `d865ecac-65f9-4e01-85f0-88e8d8f502b7` | `{"state":"in_progress","recordVersion":3,"nextStates":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                               |
| 344 | work order transitioned to qc_pending                                                                                         | 200                                                 | `fa74541b-607d-4526-bf89-871355543615` | `{"state":"qc_pending","from":"in_progress","offered":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                                |
| 345 | work order detail, for the If-Match the ready_to_close transition needs                                                       | 200                                                 | `62467a51-1ae4-41ef-b260-2aaedfbbeba4` | `{"state":"qc_pending","recordVersion":4,"nextStates":["in_progress","ready_to_close"]}`                                                                                               |
| 346 | work order transitioned to ready_to_close                                                                                     | 200                                                 | `7268c0b1-c174-464c-b0be-89ebb5237a3a` | `{"state":"ready_to_close","from":"qc_pending","offered":["in_progress","ready_to_close"]}`                                                                                            |
| 347 | browser fixture ar signature: work order CLOSED, so the handover is not held by the work itself                               | 200                                                 | `bccb6698-07f3-49a1-81b8-eb170e855a7c` | `{"state":"closed"}`                                                                                                                                                                   |
| 348 | browser fixture ar signature: handover opened                                                                                 | 201                                                 | `35898f91-363d-42ee-b0be-c7e26b95d1fa` | `{"id":"d7c318dd-7cb9-4cb0-86c2-77422fa8396b","status":"ready"}`                                                                                                                       |
| 349 | browser fixture ar signature: authorized receiver verified                                                                    | 201                                                 | `dc2cac81-c21e-42ee-8a1c-9f02a31ef0fa` | `{"id":"6656ec7b-da72-4b1e-a897-25f7f3797516"}`                                                                                                                                        |
| 350 | browser fixture ar signature: checklist item answered ahead of the browser: keys_returned                                     | 201                                                 | `479fc2e7-3407-4fe3-bb41-b7bc7d837e71` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 351 | browser fixture ar signature: checklist item answered ahead of the browser: documents_returned                                | 201                                                 | `7e621d94-a3d3-4613-bb60-4f8984c2ea33` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 352 | browser fixture ar signature: checklist item answered ahead of the browser: browser_en_release_check                          | 201                                                 | `9a4c2830-b3da-4bd1-aa69-3fa362c5731e` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 353 | browser fixture ar signature: checklist item answered ahead of the browser: browser_ar_release_check                          | 201                                                 | `6aed7600-f2c3-4a05-8329-6fa5a54e6f6f` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 354 | browser fixture ar signature: the reasons standing when the browser arrives                                                   | 200                                                 | `113183c8-823e-4b0d-8345-011a03a9c791` | `{"eligible":false,"blockers":["financial_balance_outstanding","signature_missing"],"checklistGaps":0,"recordVersion":2}`                                                              |
| 355 | browser fixture ar signature: the handover carries exactly the reasons its browser case is about                              | financial_balance_outstanding, signature_missing    | -                                      | `{"deliveryId":"d7c318dd-7cb9-4cb0-86c2-77422fa8396b","blockers":["financial_balance_outstanding","signature_missing"],"expected":["financial_balance_outstanding","signature_miss...` |
| 356 | browser fixture ar signature: the vehicle's recorded odometer readings, before the handover                                   | 200                                                 | `9dca7815-d491-47c8-a69e-6b90cd112497` | `{"readings":0}`                                                                                                                                                                       |
| 357 | browser fixture ar signature: the vehicle has no odometer reading, so the value the case sends is above it                    | 0                                                   | -                                      | `{"readings":[],"sending":"34567.8"}`                                                                                                                                                  |
| 358 | browser fixture ar release journey: customer created                                                                          | 201                                                 | `eb1724e4-738e-4af2-8abf-d9b6344c3a05` | `{"customerId":"2bf258f5-0a59-4b6a-b0d8-1f0d4ca45a4f","displayNumber":"000008"}`                                                                                                       |
| 359 | browser fixture ar release journey: vehicle created                                                                           | 201                                                 | `fc93c67b-911d-41cf-a3b6-3216181229e5` | `{"vehicleId":"3c2417ad-cafe-4867-ac03-f050da338b1c","lifecycle":"draft"}`                                                                                                             |
| 360 | browser fixture ar release journey: vehicle linked to the customer                                                            | 201                                                 | `b4348372-f70c-4f11-8ef3-54c377283863` | `{}`                                                                                                                                                                                   |
| 361 | browser fixture ar release journey: reception created (walk-in)                                                               | 201                                                 | `067d9b2c-5e69-4511-9b2b-bd5ea70f196c` | `{"receptionVisitId":"6b86e949-7f01-4e5f-a27e-9565206723cd","receptionStatus":"opened","recordVersion":1}`                                                                             |
| 362 | browser fixture ar release journey: the customer recorded on the visit as the authorized receiver                             | 201                                                 | `dca84037-14ec-40b2-8197-8e1861ba86ee` | `{"role":"authorized_receiver"}`                                                                                                                                                       |
| 363 | browser fixture ar release journey: the customer AUTHORIZES the work                                                          | 201                                                 | `1aeb784b-01d9-4e63-9876-356dad63aefb` | `{"decision":"approved"}`                                                                                                                                                              |
| 364 | browser fixture ar release journey: reception detail, for its record version                                                  | 200                                                 | `c7d6ed62-eb28-40a1-8661-3a44459ae4c2` | `{"receptionStatus":"opened","recordVersion":1}`                                                                                                                                       |
| 365 | browser fixture ar release journey: reception approved                                                                        | 200                                                 | `e6e30421-5f2b-48d9-8e64-e6e7c2e0845b` | `{"receptionStatus":"authorized","recordVersion":3}`                                                                                                                                   |
| 366 | browser fixture ar release journey: reception converted to a WORK ORDER                                                       | 200                                                 | `f2c3a02e-158e-44e1-90de-c80b4a1253ac` | `{"workOrderId":"6e9baee3-221f-4826-aef1-24ae9e891d2f"}`                                                                                                                               |
| 367 | browser fixture ar release: quality-control record opened                                                                     | 201                                                 | `be312836-9e8c-4b56-bae2-44d279d93b77` | `{"id":"f38af838-fbdb-4136-b3ee-6ea93d911447","overallResult":"pending"}`                                                                                                              |
| 368 | browser fixture ar release: quality-control record read, for its checks and record version                                    | 200                                                 | `d88d794a-1c88-4c01-a91c-0dcbcf0755a0` | `{"checks":0,"recordVersion":null}`                                                                                                                                                    |
| 369 | browser fixture ar release: quality-control record re-read, for the If-Match the finalisation needs                           | 200                                                 | `28f6d7df-6c58-4eb4-a2d2-1ed63fd118cc` | `{"recordVersion":null}`                                                                                                                                                               |
| 370 | browser fixture ar release: quality control FINALISED passed                                                                  | 200                                                 | `77d75d75-dabb-49da-aa57-abcd96ef47c7` | `{"overallResult":"passed"}`                                                                                                                                                           |
| 371 | browser fixture ar release: closure eligibility read                                                                          | 200                                                 | `ff2a07e1-5053-4ed6-8446-94059405e959` | `{"eligible":true,"blockers":[]}`                                                                                                                                                      |
| 372 | work order detail, for the If-Match the open transition needs                                                                 | 200                                                 | `abe6d065-5e0f-4cb9-bbee-d09592d0db48` | `{"state":"draft","recordVersion":1,"nextStates":["cancelled","open"]}`                                                                                                                |
| 373 | work order transitioned to open                                                                                               | 200                                                 | `2aa9068f-6fb0-423e-b710-31511475bd71` | `{"state":"open","from":"draft","offered":["cancelled","open"]}`                                                                                                                       |
| 374 | work order detail, for the If-Match the in_progress transition needs                                                          | 200                                                 | `56f1d84a-ec5f-4e1b-b968-94c64c9539b7` | `{"state":"open","recordVersion":2,"nextStates":["cancelled","in_progress"]}`                                                                                                          |
| 375 | work order transitioned to in_progress                                                                                        | 200                                                 | `2fb7540a-4b1b-41d9-aefb-8e6c5deed6b1` | `{"state":"in_progress","from":"open","offered":["cancelled","in_progress"]}`                                                                                                          |
| 376 | work order detail, for the If-Match the qc_pending transition needs                                                           | 200                                                 | `8a97b94d-e0f9-4e2b-90c4-238c3573d448` | `{"state":"in_progress","recordVersion":3,"nextStates":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                               |
| 377 | work order transitioned to qc_pending                                                                                         | 200                                                 | `ac3d13c8-698c-42bf-b495-c569f77b5a7a` | `{"state":"qc_pending","from":"in_progress","offered":["awaiting_customer","awaiting_parts","cancelled","qc_pending"]}`                                                                |
| 378 | work order detail, for the If-Match the ready_to_close transition needs                                                       | 200                                                 | `a4b8957c-8de4-4bae-8a58-040c003d5135` | `{"state":"qc_pending","recordVersion":4,"nextStates":["in_progress","ready_to_close"]}`                                                                                               |
| 379 | work order transitioned to ready_to_close                                                                                     | 200                                                 | `1d2cc0ed-2706-4857-8817-3f022d1cb357` | `{"state":"ready_to_close","from":"qc_pending","offered":["in_progress","ready_to_close"]}`                                                                                            |
| 380 | browser fixture ar release: work order CLOSED, so the handover is not held by the work itself                                 | 200                                                 | `0d08bf84-955c-48f7-b584-e2d5bdee9d3a` | `{"state":"closed"}`                                                                                                                                                                   |
| 381 | browser fixture ar release: handover opened                                                                                   | 201                                                 | `9743754c-baab-478a-b847-e4fc43ac97d6` | `{"id":"47451360-1636-4818-8a0b-bd014a9587c1","status":"ready"}`                                                                                                                       |
| 382 | browser fixture ar release: authorized receiver verified                                                                      | 201                                                 | `507ba9d6-cfc2-4639-9ed2-865914693744` | `{"id":"d64ebd31-48f1-43fc-9754-f9dd8a9b3977"}`                                                                                                                                        |
| 383 | signature document: upload authorized against the reception visit                                                             | 201                                                 | `a08e5f0b-f793-47ed-963d-86f740175927` | `{"documentId":"7a6ac495-5590-4e5c-8457-f5a356428ef2","method":"PUT"}`                                                                                                                 |
| 384 | signature document: bytes stored at the presigned destination                                                                 | 200                                                 | -                                      | `{"bytes":67}`                                                                                                                                                                         |
| 385 | signature document: version registered and scanned                                                                            | 201                                                 | `1af00484-5ea4-4553-b20d-f091240f3733` | `{"versionId":"3b8a1199-ee11-47f8-a1e8-261b28b6b382","status":"accepted","scanStatus":"clean"}`                                                                                        |
| 386 | signature document: linked to the reception visit, which is its provenance                                                    | 201                                                 | `a8e21439-28f9-4d91-9dcf-3821daeaf6c9` | `{"linkId":"4e49e2fb-1136-482b-ae79-8a9bdd52a3cc"}`                                                                                                                                    |
| 387 | browser fixture ar release: signature bound ahead of the browser                                                              | 201                                                 | `6dd8ae7c-e0a8-4416-8b83-3670d5d52199` | `{"id":"6baa0f14-a568-427b-919c-94c4c57361aa"}`                                                                                                                                        |
| 388 | browser fixture ar release: checklist item answered ahead of the browser: keys_returned                                       | 201                                                 | `0f7a6bf8-2716-4aac-9b47-b56eb89d7077` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 389 | browser fixture ar release: checklist item answered ahead of the browser: documents_returned                                  | 201                                                 | `4ca63d4a-c9a4-4020-aebd-824e8d90367b` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 390 | browser fixture ar release: checklist item answered ahead of the browser: browser_en_release_check                            | 201                                                 | `5e93e627-1db1-4efa-9bca-c08a187de8c3` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 391 | browser fixture ar release: checklist item answered ahead of the browser: browser_ar_release_check                            | 201                                                 | `4a642f25-d956-4e04-8c8a-440a248e0365` | `{"outcome":"passed"}`                                                                                                                                                                 |
| 392 | browser fixture ar release: the reasons standing when the browser arrives                                                     | 200                                                 | `883cb80b-58cf-4140-ba86-e3a37273d103` | `{"eligible":false,"blockers":["financial_balance_outstanding"],"checklistGaps":0,"recordVersion":3}`                                                                                  |
| 393 | browser fixture ar release: the handover carries exactly the reasons its browser case is about                                | financial_balance_outstanding                       | -                                      | `{"deliveryId":"47451360-1636-4818-8a0b-bd014a9587c1","blockers":["financial_balance_outstanding"],"expected":["financial_balance_outstanding"]}`                                      |
| 394 | browser fixture ar release: the vehicle's recorded odometer readings, before the handover                                     | 200                                                 | `49a50b41-1c9a-4a5f-bc52-d0c31f50c6ec` | `{"readings":0}`                                                                                                                                                                       |
| 395 | browser fixture ar release: the vehicle has no odometer reading, so the value the case sends is above it                      | 0                                                   | -                                      | `{"readings":[],"sending":"34567.8"}`                                                                                                                                                  |
| 396 | report run (after the last write): work_orders_by_status                                                                      | 200                                                 | `3a4deac3-6d55-40ba-9a7e-c0c671467ef3` | `{"timezone":"Asia/Amman","rows":8,"groups":9,"freshness":"live"}`                                                                                                                     |
| 397 | report run (after the last write): technician_labor_time                                                                      | 200                                                 | `3b9651e3-f2d8-4094-ac81-ff628fd5ab2d` | `{"timezone":"Asia/Amman","rows":1,"groups":1,"freshness":"live"}`                                                                                                                     |
| 398 | report run (after the last write): inventory_movements                                                                        | 200                                                 | `e89b837a-6b8b-463c-b05a-8b9d8602970f` | `{"timezone":"Asia/Amman","rows":1,"groups":1,"freshness":"live"}`                                                                                                                     |
| 399 | report run (after the last write): invoice_payment_summary                                                                    | 200                                                 | `929d7759-6a81-4413-be90-83181b854646` | `{"timezone":"Asia/Amman","rows":2,"groups":2,"freshness":"live"}`                                                                                                                     |
| 400 | report catalogue (after the last write): who provides each report, and its name                                               | 200                                                 | `f838f0ed-3508-4619-a73b-fd9d31550219` | `{"count":4,"missing":[]}`                                                                                                                                                             |
| 401 | the catalogue names each of the four datasets and says who provides it                                                        | named                                               | -                                      | `{"unusable":[],"provenance":{"work_orders_by_status":{"source":"tenant","titleKey":null,"name":"Work orders by status","executable":true},"technician_labor_time":{"source":"plat...` |
| 402 | FE-010 (after the last write): the authorized company directory the overview resolves against                                 | 200                                                 | `990e648e-8a61-4c61-9a03-dc50c11efeba` | `{"count":1}`                                                                                                                                                                          |
| 403 | FE-010 (after the last write): the authorized branch directory the overview resolves against                                  | 200                                                 | `285098cd-91a8-4190-95a7-d5c6f5949c7a` | `{"count":1}`                                                                                                                                                                          |
| 404 | FE-016: the branch the address names resolves in the authorized directory                                                     | resolved                                            | -                                      | `{"branchId":"5f5c3974-ced2-40fc-ac58-7e26d767f288","directoryBranches":1}`                                                                                                            |
| 405 | FE-010 overview section (after the last write): work_orders_by_status                                                         | 200                                                 | `883d94ba-63d2-4d51-a489-20fc1ff0afab` | `{"rows":1,"groups":9,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 406 | FE-016 overview section for the branch named in the address (after the last write): work_orders_by_status                     | 200                                                 | `3dc4aa15-0e3e-47be-af81-87ca2e5cb3fa` | `{"rows":1,"groups":9,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 407 | FE-010 overview section (after the last write): technician_labor_time                                                         | 200                                                 | `67cf6075-7716-4518-a217-695cc06813fa` | `{"rows":1,"groups":1,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 408 | FE-016 overview section for the branch named in the address (after the last write): technician_labor_time                     | 200                                                 | `b4502047-22de-469f-a2b1-2c59a46e64b5` | `{"rows":1,"groups":1,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 409 | FE-010 overview section (after the last write): inventory_movements                                                           | 200                                                 | `83697b56-6fc6-4db7-8ba1-b33c060c8779` | `{"rows":1,"groups":1,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 410 | FE-016 overview section for the branch named in the address (after the last write): inventory_movements                       | 200                                                 | `c70a51eb-dad9-4b1b-935e-b1e529da0243` | `{"rows":1,"groups":1,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 411 | FE-010 overview section (after the last write): invoice_payment_summary                                                       | 200                                                 | `a0dcaa15-53b0-4d37-9999-1ed4bf0a77c1` | `{"rows":1,"groups":2,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 412 | FE-016 overview section for the branch named in the address (after the last write): invoice_payment_summary                   | 200                                                 | `6068c0f4-20ba-4d04-8296-e8507a212920` | `{"rows":1,"groups":2,"timezone":"Asia/Amman","freshness":"live"}`                                                                                                                     |
| 413 | FE-016 reads the same overview as FE-010 for the same branch                                                                  | agree                                               | -                                      | `{"disagreed":[]}`                                                                                                                                                                     |

### 9.9 What this section does not claim

The Owner's own verdict on the production build. Any judgement of the screens' wording or layout
beyond the fact that thirty shot records were taken and twenty-eight of them wrote an image. Any hosted result: whether the
`authenticated-browser` job goes green at the head this branch produces is a fact only that job can
establish, and none of the ledger tiers was re-recorded in the turn that wrote this section. And
any claim about the two runs' report figures beyond what §9.1 (c) and §9.2 state — `mu0diepc`'s are
readings of empty result sets and are not counted as report proofs.

## 10. The closing acceptance run, 2026-09-15 (run `mu2ihptd`)

**What this section is.** The closing acceptance run of this phase, taken against protected
`develop` after the report-export and monitoring integration merged, performed by one invocation of
a runner script, and recorded here as the run of record of the closing run's third attempt. § 8 and
§ 9 were taken at branch heads (§ 8.1, § 9.1, § 9.2); this run is taken at protected `develop`
`c1a2f9fc`, carries a separately labelled report-export companion, and runs the tablet project
beside the two locale projects. **It records measurements. It is not an Owner verdict, not a phase
Pass, not a promotion and not a human certification, and it does not say the phase is complete**
(§ 10.14).

**It supersedes nothing above it.** §§ 2–6 remain the record of `mtz2geo1`, § 7.1 of `mtz5ppq8`,
§ 8 of `mtzmvemj`, § 9.1 of `mu0diepc` and § 9.2 of `mu0g1b1a`. Those runs stand for their own
recorded scope and none of them was repeated to produce this one. The two earlier attempts of this
closing run are kept in § 10.11.

Evidence directory, outside every git working tree, nothing of it committed:

- `orchestration\evidence\p1-31\acceptance-20260915-1009\` — 68 files, run `mu2ihptd`

Every figure below is read from that directory, or from the closure facts compiled and re-derived
from it on 2026-09-15
(`orchestration/evidence/p1-31/closeout-drafts/queue3/closure-facts-20260915.md`, also outside the
repository). A file this section names without a directory is in the evidence directory.

### 10.1 The head under test, and the proof it was that head

| fact                  | value                                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| protected `develop`   | `c1a2f9fc5d43799a4ca4beca9fe4927a777a2632`, tree `1a0cd7fc0a1e75a131b548dee0a63eccb7371f45`                                                                                                                                        |
| its merge             | PR #398, `feature/p1-31-export-monitoring-integration`; first parent `9729b2b5341a9f193305955b81608753e6bb271f`, second parent `e855ef0a8651afbf072c9d8334b3c2f4c85c8ae1`                                                          |
| the merge before it   | `9729b2b5`, PR #397, `remediation/p1-31-backend-report-export`; first parent `32c797546f39bc9033dda95181571ce38b2f11cc`, second parent `5a75322009bc05af248b34c85c8abb3f26df21ec`, tree `2e11c3797fd0bebfaec18ec827a3064b915a5f6d` |
| hosted checks of #398 | 21 of 21 `success` on `e855ef0a`, the five required contexts of the `Protect develop` ruleset among them; the post-merge protected run on `c1a2f9fc` 19 of 19 `success`, latest `completed_at` 2026-09-15T06:32:13Z                |
| hosted checks of #397 | 21 of 21 `success` on `5a753220`; the post-merge protected run on `9729b2b5` 19 of 19 `success`                                                                                                                                    |
| `main`                | `1262de74560e57a2874596c210a49fda10a3795b`, unchanged; P1-31 is not promoted                                                                                                                                                       |
| checkout              | `wt-p12`; the runner's identity step read `HEAD` `c1a2f9fc…`, matching its pin, and a clean tracked tree (`runner.log`)                                                                                                            |
| run                   | `mu2ihptd`; organisations `p31_journey_a_mu2ihptd` and `p31_journey_b_mu2ihptd` (`summary.json`)                                                                                                                                   |
| window                | reserved 2026-09-15T10:09:46Z, released 10:19:56Z; the runner's first step began 10:10:12.700Z and its last ended 10:17:30.208Z (`run-steps.tsv`)                                                                                  |

The required contexts of `Protect develop`, read from the API, are: Docker build validation; Secret
and sensitive-file scan; Lint, types, tests, build; Database migrations and RLS tests; ci-gate. **The
hosted checks are a read of the check-run lists of the SHAs named above and are evidence about the
source. None of them executed this acceptance, and none is claimed to.**

### 10.2 The instruments, and their provenance

Every instrument the run used lives outside this repository, in `orchestration/acceptance/`, and is
unversioned. **Its identity is established only by the digests recorded below.** A file outside the
repository is not reviewed by CODEOWNERS, not covered by the repository gates and not versioned with
the code it drives.

| instrument                                                        | sha256                                                             | bytes  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| journey `p1-31-journey.mjs`                                       | `a9d4ca0ef7f9be8a619c33581260fa06291e2b65e5c491668e69b81f2296b8b8` | 210687 |
| export companion `p1-31-export-companion.mjs`                     | `09d75d886def13ed193710c4120e2f92e91e997163b2f753d685ffec8ff56d7b` | 108070 |
| screens `p1-31-screens.mjs`                                       | `d91f213afba9bf1cdf319421e447e6076043999e54e94c3304c8fd98667055cc` | 9235   |
| runner `p1-31-closing-run.sh`                                     | `4441a67b7f33ae532008f85fc85482fc9a385aa05ac1930bf21bb03bbe4ae84a` | 57172  |
| plan `closing-run-plan-20260914.md`, as the run of record used it | `c1f8c2c28419e156082436311d1ee10abee2f44a991882ca7c0ccaf735536f7f` | 111201 |

The runner's identity step compared the journey, the companion, the screens script and the checkout
with their pins before anything else ran, and all four matched (`runner.log`); the runner's own
digest is recorded in `runner.sha256`. The journey digest is not one of the four § 9.3 records. The
companion that attempt 1 used is kept beside the current one as `p1-31-export-companion.mjs.fcc4ce77`
(§ 10.11). The export fixture's result contract is in the repository at the SHA under test; its
digest `478c93f8…` is carried from the closure facts and was not re-derived for this section.

**The plan was corrected after the run.** Its interpretation paragraph attributed two Owner
sentences to 2026-09-15; they come from the Owner's instruction of 2026-09-14 (§ 10.3). A dated
correction was added beside that paragraph on 2026-09-15, which moved the plan to sha256
`3ad698b38458da07e375d766fc240da9dc98a4ecab46b2b08ed334f4b200e6fc`, 111672 bytes. **The run of
record used `c1f8c2c2…`**, and the correction changes nothing the plan governs.

### 10.3 How it was driven

**One runner invocation**, which exited 0 with all 28 recorded steps exiting 0 (`run-steps.tsv`,
`runner.log`). Times are 2026-09-15, UTC.

| #   | step                       | start         | end           | exit |
| --- | -------------------------- | ------------- | ------------- | ---- |
| 1   | `identity`                 | 10:10:12.700Z | 10:10:13.825Z | 0    |
| 2   | `ports-free`               | 10:10:13.940Z | 10:10:14.386Z | 0    |
| 3   | `launcher-lock-free`       | 10:10:14.464Z | 10:10:14.850Z | 0    |
| 4   | `stack-start`              | 10:10:14.939Z | 10:10:15.189Z | 0    |
| 5   | `stack-ready`              | 10:10:15.284Z | 10:11:06.075Z | 0    |
| 6   | `stack-ownership`          | 10:11:06.161Z | 10:11:07.084Z | 0    |
| 7   | `journey`                  | 10:11:07.167Z | 10:11:43.583Z | 0    |
| 8   | `prepare-tier1`            | 10:11:43.676Z | 10:11:43.980Z | 0    |
| 9   | `browser-tier1`            | 10:11:44.066Z | 10:14:28.491Z | 0    |
| 10  | `account-kind-tier1`       | 10:14:28.619Z | 10:14:29.188Z | 0    |
| 11  | `results-tier1`            | 10:14:29.297Z | 10:14:30.593Z | 0    |
| 12  | `screens`                  | 10:14:30.707Z | 10:15:37.004Z | 0    |
| 13  | `companion-a1`             | 10:15:37.080Z | 10:15:46.745Z | 0    |
| 14  | `login-window-pause`       | 10:15:46.827Z | 10:16:52.005Z | 0    |
| 15  | `export-handoff-present`   | 10:16:52.112Z | 10:16:52.307Z | 0    |
| 16  | `prepare-tier2`            | 10:16:52.427Z | 10:16:52.750Z | 0    |
| 17  | `browser-tier2`            | 10:16:52.836Z | 10:17:15.025Z | 0    |
| 18  | `account-kind-tier2`       | 10:17:15.127Z | 10:17:15.581Z | 0    |
| 19  | `results-tier2`            | 10:17:15.692Z | 10:17:16.740Z | 0    |
| 20  | `monitoring-extract`       | 10:17:16.848Z | 10:17:17.663Z | 0    |
| 21  | `monitoring-command`       | 10:17:17.758Z | 10:17:18.450Z | 0    |
| 22  | `dev-stop`                 | 10:17:18.535Z | 10:17:24.148Z | 0    |
| 23  | `serve-exit`               | 10:17:24.249Z | 10:17:24.399Z | 0    |
| 24  | `credential-scan`          | 10:17:24.515Z | 10:17:25.027Z | 0    |
| 25  | `remove-handoff-companion` | 10:17:25.111Z | 10:17:27.003Z | 0    |
| 26  | `remove-handoff-journey`   | 10:17:27.094Z | 10:17:29.086Z | 0    |
| 27  | `handoff-check`            | 10:17:29.177Z | 10:17:29.495Z | 0    |
| 28  | `ports-after-stop`         | 10:17:29.590Z | 10:17:30.208Z | 0    |

Step 23's `0` is the runner's own recording and not the stack's exit; § 10.13 item 10 states that
limitation.

**Why the browser tier is split around the companion.** In attempt 2 (§ 10.11) the catalogue case
compared its rows against the provenance the journey captured before the companion published
workshop configurations for three report codes. The product displayed the truth; the expectation
had been captured before a later write. The catalogue observation and the export observation need
opposite states of the same tenant, so the browser tier is split: **tier 1** runs before any
companion write, with the export handoff absent, and **tier 2** runs after the companion, with both
handoffs, and executes only the export case.

**The interpretation applied — recorded as the interpretation, not as an Owner decision.** The
Owner's instruction of **2026-09-14** to the coordinating session lists, among what must be
preserved, "report observations after the relevant fixture writes" (a partial quotation: one item
of that list, without its list marker and closing semicolon). The same instruction says, in a
partial quotation that is the second sentence of its paragraph:

> Run the distinct export companion with real HTTP, browser download and audit evidence, while
> retaining the default administrator's refusal.

The closing run applies the first rule **per observation**. The catalogue observation is taken
after every fixture write relevant to it — the journey's, after which the journey captured the
catalogue expectation. The companion's later writes are relevant only to the export observation,
which runs after them. The alternative would have been to re-capture the catalogue expectation after
the companion, which is an instrument change. **This reading is the closing-run plan's. It is not an
Owner decision and is not recorded as one.**

**Runner design.**

- A case-insensitive scrub of project-relevant environment variables at start — it removed none on
  this run (`environment-scrub.txt`) — and every launch sets its variables by exact name after
  removing letter-case variants.
- Stack ownership from the launcher's own lock and state files plus a recorded start instant. That
  was proven once on a real stack before this run (ready after 53 seconds, ownership confirmed, stop
  clean), and on this run every ownership check read `ok` (`stack-ownership.txt`).
- An in-runner credential scan and redaction before handoff removal on every exit path; an
  in-progress marker; fail-closed port checks, which found nothing listening on 3000, 3100 and 3210
  before the stack started (`runner.log`); a selection guard on tier 2; and a tier 2 re-run only on a
  detected sign-in rate-limit refusal, at most once. **No re-run was taken**
  (`browser/test-results-tier2-rerun` is empty).

### 10.4 The HTTP journey

**532 steps, 532 ok, 0 not ok, 0 findings.** The harness's own summary field `verdict` reads `PASS`;
that is an output of the instrument and not a verdict of this record. `steps.json` is numbered 1 to
532 without a gap and every `ok` is `true`. Started 2026-09-15T10:11:12.241Z, finished
10:11:43.507Z (`summary.json`, sha256 `afc5284a…`). Report period `2026-09-14` to `2026-09-16`, time
zone `Asia/Amman`. The harness's five notes are the five § 9.2 quotes, word for word.

The journey's step-by-step table is `steps.md` in the evidence directory; it is not reproduced in
this section.

### 10.5 The export companion — separately labelled

**A separate instrument with its own ledger**: 45 steps, 45 ok, 0 findings, and its own summary
field `verdict` reads `PASS`. Started 10:15:41.527Z, finished 10:15:46.670Z
(`export-companion.a1.json`, sha256 `cf6989ce…`). Its steps are not part of the journey's 532 and
are never added to them.

**The principal.** Invited over HTTP by the journey's administrator with **no roles**, its
credential set through the product's own recovery link read out of the local mailbox, and activated
by the administrator (companion ledger steps 2–6).

**Configurations.** `work_orders_by_status` already carried the journey's published configuration
and was reused; the companion created and published workshop configurations for the other three
report codes (steps 7–23), because an export is refused without a published configuration. Those
three publications are the writes § 10.3's split exists for.

**The privileged fixture — limited, and an operator act.** A rehearsal inside a transaction that was
rolled back, then the real pass; both exited 0 (steps 24–25). The fixture recorded
(`export-companion.a1.json`, `setup.fixture`): the lease acquired; a privileged `postgres`
connection to the local database on `127.0.0.1:54322`; a role carrying **nine permissions**; one
grant at **branch** scope; `validTo` exactly **two hours** after it was written; `approvalRef`
`null`; the audit action `iam.grant.issued`. **The fixture is limited to the single synthetic
principal the companion created, one branch, that fixed permission set and the two-hour expiry.**
It is not an HTTP delegation of `rpt.export`, not a change to any role bundle and not a human
approval. The Owner's instruction of **2026-09-15**:

> Keep the privileged setup limited to the approved synthetic principal, branch, permission set and
> expiry.

**The four exports and the empty selection** (steps 26–36), over the journey's period `2026-09-14` to
`2026-09-16` unless the row names another:

| report code                                                            | status | media type | filename                                            | rows | content sha256 | context record | correlated `rpt.report.exported` rows |
| ---------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------- | ---- | -------------- | -------------- | ------------------------------------- |
| `work_orders_by_status`                                                | 200    | `text/csv` | `work_orders_by_status-2026-09-14-2026-09-16.csv`   | 11   | `d82687e9…`    | first record   | exactly 1                             |
| `technician_labor_time`                                                | 200    | `text/csv` | `technician_labor_time-2026-09-14-2026-09-16.csv`   | 1    | `89666a98…`    | first record   | exactly 1                             |
| `inventory_movements`                                                  | 200    | `text/csv` | `inventory_movements-2026-09-14-2026-09-16.csv`     | 1    | `0a070b02…`    | first record   | exactly 1                             |
| `invoice_payment_summary`                                              | 200    | `text/csv` | `invoice_payment_summary-2026-09-14-2026-09-16.csv` | 2    | `9ea22a9b…`    | first record   | exactly 1                             |
| `work_orders_by_status`, empty selection, `2000-01-01` to `2000-01-02` | 200    | `text/csv` | `work_orders_by_status-2000-01-01-2000-01-02.csv`   | 0    | `2a0bbcf0…`    | present, first | exactly 1                             |

Statuses, media types and filenames are the companion ledger's (steps 27–36); row counts and content
digests are its `exports` block and ledger.

**Audit correlation.** The companion read the audit log for `rpt.report.exported` and found five
events in its window, **exactly one for each export's correlation id** (steps 37–41). A read-only
database query confirmed it independently: exactly one `rpt.report.exported` row per correlation id
for the run's tenant.

**The default administrator's refusal, retained.** The journey's administrator, who holds the
tenant-administrator bundle and therefore not `rpt.export` (CC-04), was refused the export of all
four report codes with **403 `ERR-IAM-001`** (steps 42–45).

### 10.6 The grant anomaly, resolved

The companion's setup summary records `committed: false` beside `exitCode: 0` and a fixture status
of `applied`. **The field name misleads.** Read from the source, it means "committed and then failed
after commit" — the exit-11 path the fixture writer's docblock describes
(`scripts/dev/owner-acceptance/export-fixture-setup.mjs:157-158`) — and it is `false` on every
successful pass. Read-only database queries confirmed that the grant was installed: the fixture
role, its nine permissions, the branch-scoped grant, its scope row and its `iam.grant.issued` audit
row exist, and the rehearsal's rows do not. It is carried as an instrument labelling minor
(§ 10.13).

### 10.7 The browser half, in two tiers

**Tier 1 — before the companion, with the export handoff absent.** Runner step `browser-tier1`.
Report `browser/playwright-report.tier1.json`, sha256 `979beb9f…`:

| project                | collected | passed | skipped | failed | P1-31 cases executed |
| ---------------------- | --------- | ------ | ------- | ------ | -------------------- |
| sign-in setup          | 1         | 1      | 0       | 0      | —                    |
| `authenticated-en`     | 178       | 25     | 153     | 0      | 25 of 26 collected   |
| `authenticated-ar`     | 178       | 25     | 153     | 0      | 25 of 26 collected   |
| `authenticated-tablet` | 91        | 25     | 66      | 0      | 25 of 26 collected   |

0 flaky and 0 retried. The skips have **exactly two reasons**, read from the report's own
annotations:

- **369** in specifications that predate this phase, every one "requires the owner-acceptance
  account; signed in as org-administrator": `accessibility` 54, `administration` 54,
  `appointments-and-receptions` 141, `crm-and-vehicles` 24, `drawer-and-restore` 14, `isolation` 36,
  `shared-ux` 46. They did not run here; they are outside P1-31 and are not P1-31 failures. § 8.6
  records why a handoff-driven run skips them.
- **3** of the P1-31 export case, `reports-p1-31.spec.ts:586`, one per project, because the export
  companion's handoff was absent at tier 1 by design. **These three skips are not a result.** They
  are neither a pass nor a failure of the export case; the export case's result is its tier 2
  execution.

Per project, tier 1 executed `audit-log` 2, `delivery` 4, `delivery-writes` 4, `overview` 3,
`reports` 7 and `warranty` 5 P1-31 cases, and skipped the eighth `reports` case, which is the export
case.

**Tier 2 — after the companion, with both handoffs, the export case only.** Runner step
`browser-tier2`, after the runner's sign-in window pause. The selection guard found the export case
in all three projects (`browser/tier2-selection.tier2.txt`). Report
`browser/playwright-report.tier2.json`, sha256 `b62a0f1b…`: **4 selected, 4 passed** — the sign-in
setup, and the export case in `authenticated-en`, `authenticated-ar` and `authenticated-tablet`, each
on its first try. No re-run.

**Which account.** Both tiers signed in as `org-administrator`, from the journey handoff, and each
tier's account-kind file was written after that tier started (`browser/account-kind.tier1.json`,
`browser/account-kind.tier2.json`, `browser/tier-starts.txt`).

**The P1-31 case total, derived from both reports together.** Each project collects **26** P1-31
cases: `audit-log` 2, `delivery` 4, `delivery-writes` 4, `overview` 3, `reports` 8, `warranty` 5.
Tier 1 executed 25 per project, 75 in all; tier 2 executed the one remaining case, the export case,
once per project, 3 in all. **75 + 3 = 78 executed, 0 failed.** Each case is counted once, in the
tier that executed it, and tier 1's three skipped entries are not counted. **Neither report alone
carries 78.** The collection figure across the three projects is also 78; the two coincide only
because every collected case executed in exactly one tier, and **a collection count is not an
execution count**.

**The browser download** exercised `work_orders_by_status` in all three projects. The other three
report codes were proven by real HTTP export (§ 10.5), **not** by browser download.

**Traces.** For each tier the runner found no `trace.zip` to delete, and none remains in the
checkout or in the evidence (`runner.log`).

### 10.8 Screens

**30 shot records, all `ok`; 28 PNG files** (`screens/screens.json`). The two sign-in shots produce
no image. The keys and file names are the same 30 and 28 as attempt 2's. The pass ran between
tier 1 and the companion.

### 10.9 Monitoring

The run's API log was captured and read by the repository's local monitoring command,
`scripts/ops/p1-31-monitor-alerts.mjs`:

| figure                                    | value                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| input                                     | 697581 bytes of captured API application log (`monitoring/api-application.jsonl`) |
| read / ignored / routed / malformed / dup | 1799 / 1799 / 0 / 0 / 0, `complete: true` (`monitoring/monitor.log`)              |
| alert queue                               | `monitoring/alerts-local.jsonl`, empty                                            |

No failure record at error or fatal severity existed in the capture, so nothing was routed. **What
this measures is the command completing over this run's real log; it does not show an alert being
routed.** **Monitoring here is a local sanitized alert queue. No external delivery exists or is
claimed, and D-10 is unresolved.** The Owner's instruction of **2026-09-15**:

> Verify monitoring according to its actual implementation: a local sanitized alert queue. Do not
> claim external delivery or resolution of D-10.

### 10.10 Credential hygiene, and the shared database

- **The in-runner scan**, before the handoffs were removed: 3 handoffs read, 3 distinct credential
  values searched for, 66 files scanned with the handoffs excluded, 0 redactions, result complete
  (`credential-scan.txt`).
- **An independent credential-shape scan** of the evidence found no authorization header, bearer
  token, cookie, JWT or password value.
- **Both instruments removed their handoffs**, and the check afterwards found none remaining
  (`remove-handoff.log`, `handoff-check.txt`). No trace and no in-progress marker remains, and
  Playwright's saved sign-in state was deleted after the run.

The shared acceptance database, read-only:

| figure             | before | after                                 |
| ------------------ | ------ | ------------------------------------- |
| `org.tenants`      | 49     | 51 — this run's pair of organisations |
| `iam.permissions`  | 121    | 121                                   |
| migrations applied | 141    | 141                                   |

The disposable databases were not touched by this run.

### 10.11 Run history — attempts 1 and 2

Two attempts preceded this run. **Both are preserved in their own evidence directories, and neither
is the run of record.** Each cause was fixed before the next attempt.

| attempt | evidence                   | outcome                                                                                                                                                      | cause                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | `acceptance-20260915-0638` | PARTIAL. Journey 532/532; browser 25 passed and 1 failed per authenticated project; screens 28 images; export witness **UNMET**                              | INSTRUMENT: the companion read the configuration list from a flat field while the API answers `{configurations: {items}}`, treated the unrecognised shape as an empty list, and stopped on a 409. A full inventory then found two more read mismatches, in invitation creation and activation; all were fixed and a fail-closed shape guard added (companion `fcc4ce77` → `09d75d88`) |
| 2       | `acceptance-20260915-0730` | PARTIAL. Journey 532/532; companion 45/45 with all four exports, audit rows and administrator refusals; browser export download passed in all three projects | INSTRUMENT (ordering): the catalogue case compared rows against provenance the journey captured before the companion published workshop configurations for three codes; the product displayed the truth. Fixed procedurally by splitting the browser tier around the companion                                                                                                        |

Both directories are under `orchestration\evidence\p1-31\`. Their outcomes are recorded as they
happened and are not counted toward this run's figures.

### 10.12 The dedicated privileged-fixture database proof

Not part of run `mu2ihptd`, and recorded here because the export companion's fixture rests on it.

- The committed suite `tests/db/p1-31-export-fixture.test.ts`, run through its own configuration
  `vitest.config.db-fixture.ts` via `npm run test:db-fixture`, at source `e855ef0a` (contained in
  protected `develop` `c1a2f9fc`), against the disposable database `rootlco_p131_fixture_20260914`
  on `127.0.0.1:54322` (141 migrations, seven seeds, empty before and after): **12 of 12 passed**,
  2026-09-15T06:09:33Z to 06:09:49Z. Evidence
  `orchestration/evidence/p1-31/fixture-db-proofs-20260915/`.
- Per-case pass is inferred from totals: the reporter printed totals only, the file declares
  exactly twelve cases with no skip or `only` marker, and the run reported 12 passed, 0 skipped.
- **No hosted job executes it.** It is excluded by name from the shared database runner, declared in
  `.github/ci-baselines/unrun-test-tiers.json` under `unrunNonBrowser`, and recorded as CC-62.
- **The falsifiability control for its deferred-constraint case** — restoring the scope row makes the
  negative fail — **was taken once, by hand, on 2026-09-14, in an uncommitted scratch copy.** It is
  not an automated regression carried by the suite.

### 10.13 Limitations carried with this run

Each is carried as it stands. **This record turns none of them into a blocker and accepts none of
them.** The Owner's instruction of **2026-09-15**, quoted partially (the first sentence of its
paragraph):

> Do not automatically turn every limitation into a phase blocker, and do not automatically accept
> it.

1. The privileged-fixture proof is absent from hosted execution (§ 10.12).
2. Its deferred-constraint falsifiability control is an uncommitted, hand-taken measurement
   (§ 10.12).
3. The runner, plan, journey, companion and screens instruments live outside the repository,
   unversioned, identified only by digests (§ 10.2).
4. The P1-24 operation register credits only one suite for the export operation, because it matches
   references by raw substring and three further database-backed suites spell the report code and
   the action instead. The register undercounts rather than overclaims
   ([`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 1).
5. The continuous-integration job summary renders only one of the two unrun registers (CC-62 (c)).
6. The export audit records selection and counts, not a byte length or content digest, so it cannot
   later identify the exact bytes disclosed; the export uses the existing `expensive-read` rate
   policy with an 8 MiB response bound and no daily allowance
   ([`report-export-seam.md`](./report-export-seam.md)).
7. Monitoring is a local sanitized alert queue only; no external notification exists; the
   polling-versus-push decision D-10 is unresolved (§ 10.9).
8. The browser download was exercised for one report code; the other three were proven over real
   HTTP (§ 10.7).
9. 369 browser cases in earlier-phase specifications require the owner-acceptance account and did
   not run in this acceptance; they are outside P1-31's scope and are not P1-31 failures (§ 10.7).
10. Instrument labelling and recording minors: the companion's `committed` field name misleads
    (§ 10.6); the runner records the stack's own exit as 0 whatever it was — on this run
    `runner.log` reads `acceptance:serve exited 1` beside step 23's `0`; the companion's reuse rule
    is stricter than the export's own checks; an unexpected mailbox item shape is labelled absent
    rather than unrecognised; and a seconds-long window exists in which a foreign stack started in
    the same checkout could be stopped.

### 10.14 What this section does not claim

- **No Owner verdict, no phase Pass, no promotion and no human certification**, and no claim that
  the phase is complete. § 1's sentence stands as written: "**The Owner verdict has not been
  given.**" The `verdict` fields of the journey and the companion are instrument outputs.
- **No hosted execution of this acceptance or of the fixture proof.** The hosted checks of § 10.1
  are evidence about the source.
- **No claim beyond the earlier runs' own scope.** `mtzmvemj` (§ 8) and `mu0diepc` and `mu0g1b1a`
  (§ 9) stand for what they recorded, and nothing here re-states or extends them.
- **Nothing about the 369 earlier-phase browser skips** except that they did not run here; they
  are outside P1-31 and are not P1-31 failures.
- **No collection figure as an execution figure.** The Owner's instruction of **2026-09-15**:

  > Do not equate a merged PR, collection count, index or browser smoke with full phase acceptance.

- **No row of [`task-matrix.md`](./task-matrix.md) moves in this section.** A state change belongs
  to the matrix, under its own rule.
