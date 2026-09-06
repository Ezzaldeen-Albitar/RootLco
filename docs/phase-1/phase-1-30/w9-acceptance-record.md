# P1-30 W9 — integrated acceptance on a fresh organisation (production build, local stack, 2026-09-06)

The acceptance the Owner's directive of 2026-09-06 asked for, taken the way the P1-29 W9 record
was: a real platform operator, two organisations provisioned through
`platform.organization-provision`, every credential established through the product's own
reset/invitation completion route with the link read out of the local mailbox as a person would,
and every business row made by an authenticated HTTP call to a published operation holding
ordinary application permissions — then the two W10 screens walked in a real browser, signed in
through the product's login form by the e2e tier's own sign-in setup. **No SQL fixture, no
privileged insert, no invented seed touched the flow after the sanctioned genesis.** Every line
below is a shipped route or screen; correlation ids are the API's own. No secret, token or
password appears here. The harness and the browser spec are session artefacts described in §5;
the evidence document they wrote is summarised in §2 and §3 rather than committed, as the P1-29
record did.

**Build:** `npm run acceptance:serve` (production `next build` + `next start`) from protected
`develop` `ea8c0666`; API `http://localhost:3000`, web `http://localhost:3100`, Mailpit
`:54324`. Organisations `p30_journey_a_iecd6d` and `p30_journey_b_iecd6d`, the run stamp being
the harness's own.

## 1. Verdict

**PASSED — the approved P1-30 journey runs end to end on a fresh organisation through the
product, with zero findings against the expected statuses**, including the two corrective closures
this path was blocked on until today: stock now exists through the product (setup → opening batch
→ a second person's approval → on hand), and an invoice is created, issued, paid and settled on
an organisation that had nothing but its provisioning. Isolation from a second organisation held on
every probe; same-key concurrency resolved to one row; every failure case was refused by the field.

What this record does NOT claim: the Owner's own hand-driven acceptance (the directive's explicit
verdict on a production build is the Owner's to give); the delivery and warranty screens (P1-31);
the Playwright walk covers the two W10 screens and the inventory page — the W1–W7 screens are
proved by their DOM tiers and backend suites and by the HTTP journey below, not by this browser
walk.

## 2. The journey, step by step (HTTP, production build)

Run `iecd6d` at 2026-09-06T15:46:13.347Z on develop `ea8c0666` (production build of the develop checkout; #325 and the closure record are documentation-only successors). 71 steps, 0 finding(s).

### Platform operator and two fresh organisations

| #   | step                                                          | status | correlation id                         | detail                                                                    |
| --- | ------------------------------------------------------------- | ------ | -------------------------------------- | ------------------------------------------------------------------------- |
| 1   | operator: password reset requested                            | 202    | `d0b964c0-aaa1-46ca-8914-aee6ae4f46ec` | `{}`                                                                      |
| 2   | operator: credential set through the shipped completion route | 200    | `a6e7d334-4bd7-4359-b6b0-af818889d304` | `{}`                                                                      |
| 3   | operator: login                                               | 200    | `a303f8c1-b71b-47fb-b304-d760985b632c` | `{}`                                                                      |
| 4   | org A provisioned through platform.organization-provision     | 201    | `3a703661-269c-4204-b820-c14112c5b716` | `{"tenantId": "31de8ff9-aeb8-4767-8e86-c20fe4f60e8b", "activated": true}` |
| 5   | org B provisioned through platform.organization-provision     | 201    | `453776fc-0210-4ac1-8ea1-47251df235ab` | `{"tenantId": "e87b9836-952d-415f-af10-7fdf904fc27d", "activated": true}` |
| 6   | owner A: password reset requested                             | 202    | `98e1bc9f-0267-4bda-a7fc-d84ae539dd45` | `{}`                                                                      |
| 7   | owner A: credential set through the shipped completion route  | 200    | `f3dd4807-4756-49a1-9585-a5de82f01978` | `{}`                                                                      |
| 8   | owner A: login                                                | 200    | `1554a3e2-1fb5-4eee-8662-7380b0ea16b2` | `{}`                                                                      |
| 9   | owner B: password reset requested                             | 202    | `ae7008bc-ea36-43f3-b280-fba1b8903442` | `{}`                                                                      |
| 10  | owner B: credential set through the shipped completion route  | 200    | `201d6dec-e14e-4dc6-8246-c7f6eb8103d8` | `{}`                                                                      |
| 11  | owner B: login                                                | 200    | `2c8fa2d1-de80-4049-9320-404af723ecea` | `{}`                                                                      |

### Owner A session and branch

| #   | step                 | status | correlation id                         | detail                                                                                                                     |
| --- | -------------------- | ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 12  | owner A session      | 200    | `d64f59fa-efd7-428c-a506-88ab2312b732` | `{"permissions": 67, "holds": {"inv.item.manage": true, "inv.adjustment.approve": true, "inv.stock.operate": true, "iam.u` |
| 13  | owner A: branch list | 200    | `464c44d3-d7f0-49fa-91ba-6c21d7c79b46` | `{"count": 1}`                                                                                                             |

### W10 — inventory setup through the shipped writers

| #   | step                                                              | status | correlation id                         | detail                                                                           |
| --- | ----------------------------------------------------------------- | ------ | -------------------------------------- | -------------------------------------------------------------------------------- |
| 14  | item category created                                             | 201    | `c3c3f87f-1b63-4136-ad58-e59f569c9224` | `{"id": "411c1124-04c8-4302-bb54-c23922661c80", "code": "brakes"}`               |
| 15  | unit list                                                         | 200    | `b90a6a59-d003-4e6b-924f-efec04f3761a` | `{"count": 12, "chosen": "each"}`                                                |
| 16  | item created (catalogue row, no cost, no stock)                   | 201    | `6d1f6dcd-291b-468a-97e7-2bcb40ba0966` | `{"id": "645175bd-d9da-45e7-8b5f-0398af17025b"}`                                 |
| 17  | warehouse created                                                 | 201    | `ba1adac1-a616-4801-a3aa-bfd99fc8cb31` | `{"id": "714970eb-c3fe-430d-991c-acf2aeb258c4"}`                                 |
| 18  | storage place created inside the warehouse                        | 201    | `716d9206-bf97-43ac-85b9-3bc3b4beebaf` | `{"id": "7121eb91-edc7-4f1b-82dc-018b27708ca8"}`                                 |
| 19  | FAILURE CASE: storage without a warehouse is refused by the field | 422    | `4d01647b-4148-46b9-b97d-5243f8442b45` | `{"violations": [{"path": "body.parentLocationId", "rule": "parent_required"}]}` |
| 20  | location list for the branch                                      | 200    | `86541723-0830-4960-8e69-9105274cd942` | `{"count": 2}`                                                                   |

### W10 — opening stock, the maker ≠ checker refusal, and the second person

| #   | step                                                                  | status | correlation id                         | detail                                                                         |
| --- | --------------------------------------------------------------------- | ------ | -------------------------------------- | ------------------------------------------------------------------------------ |
| 21  | opening batch opened                                                  | 201    | `945bb02f-f701-4172-84b4-3405978db6d9` | `{"id": "54137e96-65a8-4604-bf0d-bbb521eb415a", "state": "draft"}`             |
| 22  | opening line added (quantity as typed)                                | 201    | `d767937d-0d34-4103-886c-26ae3eaf81ea` | `{"quantity": "12.000"}`                                                       |
| 23  | FAILURE CASE: a zero quantity is refused                              | 422    | `cc42053a-e308-4065-9d15-d7e2d70faf37` | `{"violations": [{"path": "body.quantity", "rule": "custom"}]}`                |
| 24  | the counter approving their own batch is REFUSED (maker != checker)   | 409    | `2e1d3e2a-4550-4433-a9e6-0f66d72e3c96` | `{"code": "ERR-TRN-001"}`                                                      |
| 25  | second person invited with the administrator role                     | 201    | `37f8f964-5dc1-450b-b970-7457d6b4552b` | `{"state": "invited"}`                                                         |
| 26  | second person: credential set through the invitation token            | 200    | `73664bfc-3de5-4553-b899-4871f301ea18` | `{}`                                                                           |
| 27  | second person: login BEFORE activation is refused                     | 401    | `b18b7580-79d3-4fea-a7cb-96e5e03d6962` | `{}`                                                                           |
| 28  | second person activated by the administrator                          | 200    | `6d15d20d-b688-4715-bb0d-ddfedc58dd09` | `{"state": "active"}`                                                          |
| 29  | second person (after activation): login                               | 200    | `eb30097e-a3c2-4486-8890-fb9fa4c5d368` | `{}`                                                                           |
| 30  | batch APPROVED by the second person                                   | 200    | `31fc3000-d412-4ee0-8a7b-23a439d48365` | `{"state": "approved", "approvedBy": "7ba3e172-958f-4d33-bcc0-f76f333c0414"}`  |
| 31  | the same approval replayed with the same key is not a second approval | 200    | `1b98ecdf-c186-4c28-bf7f-4d42e3ac872a` | `{"state": "approved"}`                                                        |
| 32  | ON HAND after approval, as the server publishes it                    | 200    | `bb68289b-e8fd-40b4-be17-642133341461` | `{"cells": [{"location": "WH-1", "onHand": "12.000", "available": "12.000"}]}` |
| 33  | movement ledger shows the opening row                                 | 200    | `d88419e9-61c6-4c60-83e9-2ecdaa0f4172` | `{"count": 1, "types": ["opening"]}`                                           |

### W1/W2 — service catalogue and pricing to a resolved price

| #   | step                                                              | status | correlation id                         | detail                                                               |
| --- | ----------------------------------------------------------------- | ------ | -------------------------------------- | -------------------------------------------------------------------- |
| 34  | service category created                                          | 201    | `ce7d7e2a-b34f-4027-aa03-2c84f9464c98` | `{"id": "f495b0b6-e244-4d54-82e9-3816a7610e9c"}`                     |
| 35  | service created                                                   | 201    | `48925c11-5733-4ee8-8f16-17a1ffb01afa` | `{"id": "e926b43b-ccf4-4915-ac01-4b35e7cf6c86", "recordVersion": 1}` |
| 36  | service version created                                           | 201    | `aedeb76d-8bb3-42b6-a0ec-a478183e7e03` | `{"id": "ba7962d9-f0be-455a-934b-916edbf25dfd", "state": "draft"}`   |
| 37  | service version published                                         | 200    | `c39c93bc-73fc-4046-b088-a38514308118` | `{"state": "published"}`                                             |
| 38  | service made available at the branch                              | 200    | `51f8d9e8-e0c6-451b-9eac-e9c7016c421e` | `{}`                                                                 |
| 39  | price list created                                                | 201    | `b386f5b4-c393-4b5e-9904-0057d272a1f7` | `{"id": "a15ee4ec-9995-495a-aa54-7a38f8bc9a36", "recordVersion": 1}` |
| 40  | price list version created                                        | 201    | `654863c1-bf05-45ac-9416-e104bbf3f747` | `{"id": "c976677f-7970-4512-bec2-3a366bef97d7"}`                     |
| 41  | price rule recorded (amount as a string)                          | 201    | `ec839c64-3c41-444d-997a-b39211f2e223` | `{"amount": "45.0000"}`                                              |
| 42  | price list version published (If-Match = the LIST record version) | 200    | `80ec2102-3be3-4f14-b2fa-b017d5575537` | `{}`                                                                 |
| 43  | price list assigned to the branch                                 | 201    | `69af6552-5f64-4e8d-a0ab-6d33cfde5a51` | `{"id": "b86ee0ed-5e39-422d-b75e-7567999ae455"}`                     |
| 44  | price RESOLVED by the server                                      | 200    | `d3186c0e-5de4-4e71-9bae-cfc3131dff63` | `{"currency": "JOD"}`                                                |

### Customer, vehicle, reception, authorization, work order

| #   | step                                                              | status | correlation id                         | detail                                                                                                             |
| --- | ----------------------------------------------------------------- | ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 45  | customer created                                                  | 201    | `6b520243-2a00-4b68-9f10-069a874e187a` | `{"displayNumber": "000001"}`                                                                                      |
| 46  | vehicle created by VIN                                            | 201    | `78ba193b-3ad3-4a1a-b414-4d8b71408cbe` | `{"id": "55f1f4c3-67de-4066-b927-5a5410698904", "lifecycle": "draft"}`                                             |
| 47  | vehicle detail (lifecycle and record version)                     | 200    | `cad85758-8a32-4870-882f-384833f93d03` | `{"lifecycle": "draft", "recordVersion": 1}`                                                                       |
| 48  | reception created (walk-in)                                       | 201    | `f9d0d176-c496-43e2-b421-51fb94182e10` | `{"id": "b181d9ff-c41c-4516-b559-353f66b14bab", "displayNumber": "000001", "state": "opened", "recordVersion": 1}` |
| 49  | reception detail (for its record version)                         | 200    | `c672bc6d-2b29-4548-968e-565f327ca4f3` | `{"recordVersion": 1, "state": "opened"}`                                                                          |
| 50  | customer (service requester) AUTHORIZES the work on the reception | 201    | `06345c4f-4b20-4eac-b0a9-8bf3e062dee6` | `{"decision": "approved"}`                                                                                         |
| 51  | reception authorized                                              | 200    | `d47e9359-0bff-4331-b563-35270e03541c` | `{"state": "authorized", "recordVersion": 3}`                                                                      |
| 52  | reception converted to a WORK ORDER                               | 200    | `47ef4776-7223-4366-9365-91bf60dfb3b0` | `{"workOrderId": "04e050f3-4b84-466e-a4df-fa2af2eaa240"}`                                                          |

### W3 — quotation, issue, customer decision

| #   | step                                           | status | correlation id                         | detail                                                                                                                     |
| --- | ---------------------------------------------- | ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 53  | quotation created with one priced line         | 201    | `b880df63-865a-4103-8cab-69da177ba345` | `{"id": "2c65549f-a9c8-438d-b2aa-de1882f1e70f", "revision": "f01b1d8f-0eb9-4228-a2c8-fcf153871711", "recordVersion": 1, "` |
| 54  | quotation ISSUED (totals frozen by the server) | 200    | `23401ddd-9e94-4dda-b2d8-2bf5b71be1f9` | `{"state": "issued", "grandTotal": "45.0000"}`                                                                             |
| 55  | customer decision recorded: approved           | 201    | `00215c76-3d6e-4c93-8c7d-60900a596f41` | `{"decision": "approved"}`                                                                                                 |

### W6/W7 — invoice preview, create, issue, receipt, allocation, outstanding

| #   | step                                                     | status | correlation id                         | detail                                                                                                                     |
| --- | -------------------------------------------------------- | ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 56  | invoice preview (server figures)                         | 200    | `0f51c876-59ca-46a2-8f3e-7ffc62f002d1` | `{"lines": 1}`                                                                                                             |
| 57  | invoice created (draft)                                  | 201    | `933fe4ea-3446-446d-af22-8ea371bf2e35` | `{"id": "55b7b24a-19a2-484e-865c-3388c149b337", "recordVersion": 1, "state": "draft", "lines": 1}`                         |
| 58  | invoice ISSUED with a number from the branch sequence    | 200    | `89f8e067-b18c-4be3-84c6-55cc8a084768` | `{"number": "000001", "state": "issued"}`                                                                                  |
| 59  | invoice detail after issue                               | 200    | `ae158b79-e0d4-422c-a134-8fbd9d6a360a` | `{"state": "issued", "number": "000001"}`                                                                                  |
| 60  | payment methods (tenant cash present)                    | 200    | `dfdcae55-7a03-441f-8576-96c6211742a9` | `{"cash": true}`                                                                                                           |
| 61  | receipt recorded for the invoice amount                  | 201    | `361c81b1-7116-49b7-a85c-83069a9be179` | `{"id": "9b505550-48c8-4928-8d9a-c4b20b53cf35", "reference": "000001", "money": {"amount": "45.0000", "currency": "JOD"}}` |
| 62  | receipt ALLOCATED to the invoice                         | 201    | `711e821e-d777-4438-954d-2849b6a61861` | `{}`                                                                                                                       |
| 63  | OUTSTANDING after allocation, as the server publishes it | 200    | `1f066b31-8cab-4d63-8dc7-a92dbf218475` | `{"outstanding": {"amount": "0.0000", "currency": "JOD"}}`                                                                 |

### Isolation — organisation B against organisation A

| #   | step                                                                                  | status | correlation id                         | detail         |
| --- | ------------------------------------------------------------------------------------- | ------ | -------------------------------------- | -------------- |
| 64  | ISOLATION: org B item search is empty                                                 | 200    | `8e247b3f-7ba1-4c0c-b290-6bfedf5a6145` | `{"count": 0}` |
| 65  | ISOLATION: org B cannot read org A invoice                                            | 404    | `eb61738b-d17d-4b2f-9b5b-1aae7ae6bd78` | `{}`           |
| 66  | ISOLATION: org B listing org A locations sees NO row (200 empty by RLS, or a refusal) | 200    | `015b04b1-2289-4637-b632-3c9a513adf1c` | `{"count": 0}` |
| 67  | ISOLATION: org B cannot add a line to org A batch                                     | 404    | `83dd12dd-7bf9-4617-aee0-2bf42b1e22f4` | `{}`           |
| 68  | ISOLATION: org B cannot read org A work order                                         | 404    | `9e1ed369-9073-44ef-8bfd-b23a38bbb258` | `{}`           |

### Concurrency and the category list afterwards

| #   | step                                                    | status  | correlation id                         | detail                                                                                                       |
| --- | ------------------------------------------------------- | ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 69  | CONCURRENCY: same key twice in parallel -> one row      | 201/200 | `31691618-5c18-49a5-90b2-2fb5fd9e56ec` | `{"ids": ["58a55796-b42e-4534-b2d7-32d7ead2ef8d", "58a55796-b42e-4534-b2d7-32d7ead2ef8d"], "sameRow": true}` |
| 70  | CONCURRENCY: same code, two keys -> one 201 and one 409 | 409/201 | `47911808-faf4-4951-a58f-5b16c921068a` | `{"statuses": [201, 409]}`                                                                                   |
| 71  | category list after the races                           | 200     | `59d2ea30-58d4-4575-bb7b-8d47a262ee5b` | `{"codes": ["brakes", "filters", "oils"]}`                                                                   |

### Verdict the harness computed

- findings: **0**
- on hand after approval: ['12.000']
- invoice issued: True
- outstanding after allocation: `{"amount": "0.0000", "currency": "JOD"}`
- isolation held: True — cross-tenant location list: `{"status": 200, "rows": 0, "note": "an unrestricted holder of another tenant is not refused by the scope check; RLS returns no row (the A2 honest negative, and the #322 MD-X1 observation)"}`

## 3. The screens, in a real browser (Playwright, `authenticated-en` project, sign-in through the login form)

Seven screenshots were taken and reviewed (held as session artefacts; described here):

| #   | page                          | what is on it                                                                                                                                                                                                                                                                            |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/en/inventory/setup`         | first paint on the fresh organisation: the category list as the server sent it, the units section stating that no organisation unit can be created here                                                                                                                                  |
| 2   | `/en/inventory/setup`         | after the walk: a category, an item and a warehouse created through the forms, each rendered from the server's echo; the item's unit is the first platform unit the list offered (centimetre) — the walk's choice, not a product behaviour                                               |
| 3   | `/en/inventory/opening-stock` | a batch opened for the branch — code, `Draft`, the batch id — with the statement that no batch read exists                                                                                                                                                                               |
| 4   | `/en/inventory/opening-stock` | a line of `12.000` at a location, then the owner's own approval **refused on screen** with its reference: "the person who counted a batch may not approve it"                                                                                                                            |
| 5   | `/ar/inventory/setup`         | the same page in Arabic, `dir="rtl"`                                                                                                                                                                                                                                                     |
| 6   | `/ar/inventory/opening-stock` | the same page in Arabic, right-to-left, the no-batch-read statement in Arabic — captured at first paint, so the branch target form still shows its two identifier fields: the branch list had not yet answered, and the picker renders identifiers until it does (observation CC-15, §6) |
| 7   | `/en/inventory`               | the inventory page linking to both new pages; its W4 category filter still asks for an identifier and says categories cannot be listed from that screen, which W10 made stale (observation CC-16, §6)                                                                                    |

One client-side refusal was captured on the way (the item form refusing an empty unit before any
request) — the screen behaving as its DOM suite says.

## 4. Failure, concurrency and isolation cases, on the same organisations

| case                                                                                                                                                                   | result                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| storage place without a warehouse                                                                                                                                      | 422 `body.parentLocationId` `parent_required`                                               |
| opening line with quantity `0`                                                                                                                                         | 422 `body.quantity`                                                                         |
| the counter approving their own batch                                                                                                                                  | 409 `ERR-TRN-001`                                                                           |
| an invited person signing in before activation                                                                                                                         | 401                                                                                         |
| reception approved before the customer's authorization (seen in the dry run of this harness on the W10 build; the formal run records the authorization first, step 51) | 409 `ERR-TRN-001` — the guard demands an approved authorization; the walk records one first |
| the same approval replayed with the same key                                                                                                                           | 200, no second approval                                                                     |
| two identical category creates in parallel under one key                                                                                                               | 201 + 200, one row, one id                                                                  |
| two creates of one code under two keys                                                                                                                                 | one 201, one 409                                                                            |
| organisation B: item search / invoice / work order / batch line                                                                                                        | empty / 404 / 404 / 404                                                                     |
| organisation B: organisation A's location list                                                                                                                         | 200 with no row (RLS) — observation CC-14                                                   |

## 5. How it was driven, and what only a person can do

- HTTP: a Node script against the production stack (`acceptance-p1-30-journey.mjs`, session
  artefact), 71 steps, unexpected statuses recorded as findings rather than skipped.
- Browser: a Playwright spec under the repository's own `authenticated-en` project, credentials
  through `ROOTLCO_E2E_EMAIL` / `ROOTLCO_E2E_PASSWORD` from a scratchpad-only handoff the harness
  wrote and the run removed. The author typed no credential.
- Human-only: the Owner's explicit verdict on the production build (the directive's W9 sentence),
  and any judgement of the screens' wording and layout beyond what the assertions state.

## 6. Observations recorded for the lanes that own them

- **CC-14** (Backend `iam`/`inventory`): an unrestricted holder of another tenant addressing a
  foreign company/branch pair is not refused by the scope check; RLS returns no row. No data
  crosses; the refusal shape differs from a 403 (§4, and #322 MD-X1 on the write path).
- **CC-15** (Frontend `inventory`, the shared branch-pair picker from W4): while the branch list is
  still loading the picker renders its two identifier fields, the same fields a holder refused the
  branch read sees by design; the English walk saw the list, the Arabic first-paint screenshot saw
  the fields. A loading state instead of the fields is the named follow-on; no typed identifier
  was used anywhere in this acceptance.
- **CC-16** (Frontend `inventory`): the W4 inventory page's category filter is an identifier field
  with a statement that categories cannot be listed from that screen; since W10 the category list
  exists and the setup page reads it. A select fed by that list is the named follow-on.
- `inv.opening-batch-line-create` carries no idempotency key (W10 record).
- No opening-batch read exists; the page holds the echoes (register C-2).
- `sal.invoice-create` requires `payerPartnerId` (nullable, not optional): the harness first sent
  none and was refused `invalid_type`; the W6 screen sends it. Stated for the mirror's reader.
