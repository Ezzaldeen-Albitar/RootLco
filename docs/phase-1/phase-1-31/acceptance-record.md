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

**PARTIAL.** The two halves answered differently and both answers are recorded as they came.

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
no unexplained skip, and an Owner verdict. The first holds twice over; the second now holds for 32 of
34 cases and not for the remaining two; the third has not happened. So the answer is still
**PARTIAL** — but on a much smaller residue than it was, and the residue is named. Twelve tasks are
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
