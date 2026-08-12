# Reception read surface — implementation plan

**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Status:** EXECUTED — branch `remediation/p1-18-reception-appointment-read-surface`,
commit `83c055d` (2026-08-12): the six arms shipped as reception `GET`s (list, detail,
party-roles, authorizations, condition-evidence, history) with `rec.reception.read`
seeded. One deliberate narrowing against arm E as drafted: the condition-evidence
read pages the eight non-restricted evidence relations only — signatures and
non-authorization refusals stay write-only because they carry their own
acknowledgement authority, and the restricted narratives stay behind
`iam.sensitive.view` (so `INT-017` closes as **partial**, recorded in
`finding-phase-disposition.md`). The same commit also delivers what this plan
scoped out: the appointment reads (`INT-019`), seven intake catalogue reads
(`INT-018`) and the two terminal close commands (`INT-014`) ·
**Read at:** `develop` `85151130` · **Recorded:** 2026-08-08

Closes `P1-27-INT-010`, `-011`, `-015`, `-016`, `-017` and `-021`: the reception
domain publishes eight operations and every one is a `POST`. There is not one
`GET`. Two of the writes are `versionGuarded` with mandatory `If-Match`, and the
only source of a visit's `recordVersion` is the response of a write the caller
just performed — so a reception is reachable in exactly one unbroken session and
in no other circumstance. Close the browser, drop the connection, hand the visit
to a second employee, or simply try to find a reception opened this morning, and
the vehicle is in custody with no path forward.

## How this document was produced, and what that is worth

Six parallel readers over the repository — the reception data layer, the route
and operation registry, keyset pagination, the registry/gate obligations of
adding an operation, the backend test harness, and the permission catalogue —
each followed by an **adversarial checker with a different lens**, whose brief
was to refute rather than confirm. The plan below is the synthesis of the six
verified reports.

**What is verified.** The six points where the reports disagreed were resolved by
re-opening the cited files. They are listed in §0 with the evidence. Two are worth
naming here because a plan that got them wrong would have produced working-looking
code that fails in production:

- **`withReadOnlyTransaction` is not the read precedent.** One report presented it
  as such, citing a docstring in `transaction.ts` that says query handlers "should
  prefer this". **No route in the API uses it** — `handleOperation` wraps every
  operation, `GET` included, in `withTransaction`. The docstring is an aspiration
  no query handler has ever followed. Refuted, and the plan takes the real path.
- **Path parameters are parsed INSIDE `handleOperation`.** One report led with a
  route that parses them outside; that shape is recorded in the codebase's own
  comments as defective, because the `AppFailure` then escapes the route function
  and surfaces as an unhandled 500 rather than a 422 naming the path segment.

The plan also independently reached the conclusion that `'standard-read'` is not a
registered rate-limit policy and that the two route comments claiming
`defineOperation` rejects unregistered names are false. That was confirmed
separately, reproduced against the running API, and closed as `P1-27-INT-113`
before this document was written.

**What is NOT verified.** Every remaining file:line citation below is the
subagents' work and has not been re-checked line by line. They are precise enough
to be checkable during execution, and they should be checked then — a citation
that no longer says what it is claimed to say is the failure mode this project has
met repeatedly. Treat §1–§6 as a plan to execute with the source open, not as a
statement of fact about the tree.

**§7 is the honest part.** Ten open questions are carried forward rather than
answered: whether `display_number` can be null, whether the detail should publish
an odometer reading, that `receiving_employee_id` has **no foreign key** so no
label can be joined honestly, whether the restricted narrative tables should ever
be published, and — load-bearing — that `rec.reception.read` **is holdable by
nobody**, because no seed maps any `rec.` code to any role. Granting it touches
the Owner acceptance environment and is only meaningful with reception fixture
data, which the no-fake-data policy governs. None of these was invented an answer.

**One thing below is reconstructed and said rather than buried:** the finding-id
mapping (A→INT-010 … F→INT-021) is taken from the task statement in order, and the
report that produced the registry obligations stated explicitly that it did not
read `findings.md`. Confirm the mapping before writing the coverage-manifest
notes, because those notes are the permanent record of why each read exists.

---

**Scope:** P1-27-INT-010 / -011 / -015 / -016 / -017 / -021. Six GET operations, one new permission code, one new read repository + read service.

**Verification note:** I re-opened the disputed files myself. Where the six reports disagreed, the verdicts and my own reads govern; every such point is called out inline and the conservative reading is taken.

---

## 0. Precedent that governs (settled, with the disagreements resolved)

| Question                                           | Reports disagreed                                                                                                                                   | Verified answer                                                                                                                                                         | Source                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Params parsed inside or outside `handleOperation`? | route-and-operation summary led with `customers/[customerId]` (outside); its own fact 14 and the verdict said that shape is documented as defective | **INSIDE.** `const raw = await route.params;` then `parseOrFail` in the callback                                                                                        | `apps/api/src/app/api/v1/work-orders/[workOrderId]/route.ts:48-57` — committed comment: parsing before `handleOperation` "would let the `AppFailure` escape the route function and surface as an unhandled 500 rather than a 422 naming the path segment" |
| `withReadOnlyTransaction`?                         | repository report said reads open one                                                                                                               | **No. Refuted.** Zero routes use it; `handleOperation` wraps every operation in `withTransaction`                                                                       | `apps/api/src/server/http/route-handler.ts:41, 331-332`                                                                                                                                                                                                   |
| Branch authorization on an id-addressed read       | repository report said "nothing in the codebase shows how a read does it"                                                                           | **Refuted.** Resolve row → `authorizeScope({companyId, branchId})`                                                                                                      | `billing-read-service.ts:483-484`, `delivery-read-service.ts:139-157`, and reception's own writes at `reception-service.ts:569-580`                                                                                                                       |
| Rate-limit policy                                  | `expensive-read` vs `standard-command` (the branch-scoped detail GET uses the latter)                                                               | **`expensive-read` on all six** — the tighter budget (30/60s vs 120/60s), keyed `operation+tenant+user`. **`standard-read` is NOT registered** and must never be copied | `rate-limit.ts:116-176`; the six routes naming `standard-read` are a live defect (`route-handler.ts:202` throws outside the `try` at `:219`)                                                                                                              |
| Read-code naming                                   | `.read`/`low` claimed as _the_ convention; refuted by `sal.delivery.view` `high`                                                                    | **One code, `.read`, `low`** — because the restricted tables are separately gated (see §4E). Risk level carried forward as an open question                             | seed `:87, :108, :172` vs `:70`                                                                                                                                                                                                                           |
| Cursor from a JS `Date`                            | all agree it is the defect                                                                                                                          | **`cursorTimestamp(col)` + `buildPageWithCursors` mandatory** on every timestamptz sort                                                                                 | `pagination.ts:230-232, 243-257`                                                                                                                                                                                                                          |

---

## 1. Files to create

| Path                                                                   | Contents                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/reception/data/reception-read-repository.ts`     | `ReceptionReadRepository extends Repository`; six ordering-contract constants; `requireLiveVisit`, `findReceptionDetail`, `listReceptions`, `listPartyRoles`, `listAuthorizations`, `listConditionEvidence`, `listHistory`. All SQL, all `this.run(...)`, explicit `tenant_id = $1` on every statement. |
| `apps/api/src/modules/reception/application/reception-read-service.ts` | `ReceptionReadService extends ApplicationService` (`protected readonly module = 'reception'`); `requireVisit` → 404 + `authorizeScope`; six public methods; converts validated query → `pageRequest(CONTRACT, query)`.                                                                                  |
| `apps/api/src/app/api/v1/receptions/[receptionId]/route.ts`            | **New route module.** `GET` = operation A. Directory exists; no `route.ts` in it today.                                                                                                                                                                                                                 |
| `apps/api/src/app/api/v1/receptions/[receptionId]/history/route.ts`    | **New route module.** `GET` = operation F.                                                                                                                                                                                                                                                              |
| `tests/backend/p1-27-reception-reads.test.ts`                          | The single backend suite for all six, table-driven by operation id (see §6).                                                                                                                                                                                                                            |

Only **two** new `route.ts` files. B/C/D/E must be co-located GETs — Next.js permits exactly one `route.ts` per directory and their paths map to directories that already hold a POST.

---

## 2. Files to edit

### 2.1 Source

**`apps/api/src/modules/reception/index.ts`**

- Import `ReceptionReadRepository` (from `./data/reception-read-repository`) and `ReceptionReadService`.
- Add to the `composeModule` create block (currently `:139-151`, four services):
  ```ts
  receptionRead: new ReceptionReadService(new ReceptionReadRepository()),
  ```
- Add row types to the `export type { … }` block — `ReceptionDetailRow`, `ReceptionListEntry`, `PartyRoleEntry`, `AuthorizationEntry`, `ConditionEvidenceEntry`, `ReceptionHistoryEntry` — **from the read repository**, mirroring `crm/index.ts:26-36`. Never export the repository itself (`index.ts:4-7`).

**`apps/api/src/app/api/v1/receptions/route.ts`** — add `export async function GET` (operation B) + its `defineOperation` constant + a `.strict()` `Query`. Keep the existing POST untouched.

**`apps/api/src/app/api/v1/receptions/[receptionId]/party-roles/route.ts`** — add GET (C).
**`apps/api/src/app/api/v1/receptions/[receptionId]/authorizations/route.ts`** — add GET (D).
**`apps/api/src/app/api/v1/receptions/[receptionId]/condition-evidence/route.ts`** — add GET (E).

In all three, the new GET must call `handleOperation(\n    <ITS_OWN_CONSTANT>,` at exactly four spaces of indent — `tests/foundation/p1-18-scoped-authorization.test.ts:835` matches that literal against comment-stripped source.

**`apps/api/src/server/http/route-templates.ts`** — insert two literals into the frozen list (reception block is `:181-188`):

```
  '/receptions',
  '/receptions/{receptionId}',            // NEW — A
  '/receptions/{receptionId}/approve',
  '/receptions/{receptionId}/authorizations',
  '/receptions/{receptionId}/condition-evidence',
  '/receptions/{receptionId}/convert-to-work-order',
  '/receptions/{receptionId}/history',    // NEW — F
  '/receptions/{receptionId}/party-roles',
  …
```

Omitting these fails `tests/foundation/route-templates.test.ts:53-60` in both directions; the module docblock records that a missing template makes every idempotent request to the path fail `ERR-INT-002`.

### 2.2 Seed + baselines (the new permission)

**`supabase/seeds/04_iam_permission_catalog.sql`** — insert **after** line 168 (`rec.reception.convert`), **before** the Phase 1-19 comment at line 169:

```sql
  -- Reading a reception is separated from every reception write, mirroring the
  -- wo.work_order.read split below: the board, the service advisor and the
  -- cashier all need to see a visit, who is present on it, what was authorized,
  -- what condition it arrived in and where custody has been, with no authority to
  -- accept custody, capture evidence, approve or convert. The two RESTRICTED
  -- narrative tables (rec.complaint_details, rec.vehicle_content_details) stay
  -- gated at the row by the existing iam.sensitive.view and are not published by
  -- this code.
  ('rec.reception.read',       'rec', 'Read reception visits, parties, authorizations, condition evidence and custody history', 'low', '00000000-0000-4000-8000-000000000001'),
```

**Baseline count changes — one code, three pinned numbers plus one regenerated pair:**

| File                                                                           | Line                                              | Now   | After                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------- | ----- | ----------------------------------------- |
| `.github/ci-baselines/schema-baseline.json`                                    | `:12` `"permissionCount"`                         | `104` | `105`                                     |
| `tests/db/p1-15-shared-services-runtime-capabilities.test.ts`                  | `:443` `expect(Number(total.rows[0]?.n)).toBe(…)` | `104` | `105`                                     |
| same file                                                                      | `:379` test title `"…the catalog totals 104"`     | `104` | `105`                                     |
| `docs/phase-1/phase-1-24/evidence/operation-register.json` `:13` / `.md` `:18` | `permissionCodes`                                 | `104` | `105` — **regenerated, do not hand-edit** |

`migrationCount` stays **120** and `schemaHash` is unchanged — this is a seed, idempotent and additive (`04_iam_permission_catalog.sql:15, :261`; the precedent note is `schema-baseline.json:13`).

### 2.3 Pinned count assertions that break

**`tests/ci/repository-paths.test.ts`**

- `:140` `expect(routeFiles.length).toBe(204)` → **`206`** (two new route modules). Update the explanatory comment at `:136-139`.
- `:161` test title `'discovers the same 243 operations…'` → **249**.
- `:174` `expect(report.operations).toHaveLength(243)` → **`249`**.

This file was missed by the registry-obligations report and is the one assertion that fires no matter how the routes are laid out.

**`tests/foundation/p1-18-scoped-authorization.test.ts` — the F10 block (`:700-843`)**

The discovery filter at `:791-795` selects `apt.`/`rec.` operations whose `path` contains `{`, **with no method filter** — deliberately (`:783-790`). A, C, D, E, F all match. Two assertions break: `:801-803` ("exactly the ten") and `:838-843` ("declares exactly one operation" — C/D/E's files would hold two).

**Required edit — split by method; do not narrow the discovery filter and do not delete an assertion:**

1. In `routeOperations()` (`:748-778`), capture the method alongside id/path/scope:
   ```ts
   const method = /method:\s*'([^']+)'/.exec(block);
   ```
   add `method: method?.[1] ?? ''` to `RouteOperation`.
2. Split the derived set:
   ```ts
   const affectedCommands = affected.filter((c) => c.method !== 'GET');
   const affectedReads = affected.filter((c) => c.method === 'GET');
   ```
3. `EXPECTED_LOCKED_ROW_OPERATIONS` stays **exactly the ten** at `:712-723`; retarget `:801-803` and the four `it.each` blocks at `:805`, `:812`, `:826`, `:838` to `affectedCommands`.
4. Add a sibling list and the same four assertions for reads:
   ```ts
   const EXPECTED_ID_ADDRESSED_READS = [
     'rec.reception-authorization-list',
     'rec.reception-condition-evidence-list',
     'rec.reception-detail',
     'rec.reception-history',
     'rec.reception-party-role-list',
   ] as const;
   ```
   asserting for each: `scope === 'branch'`, source contains `authorizeScope`, source contains `handleOperation(\n    ${constant},`.
5. Replace `:838-843`'s `siblings).toHaveLength(1)` with **one declaration per method per file** — `operations.filter((c) => c.file === entry?.file && c.method === entry?.method)` has length 1. This preserves the stated purpose (the `handleOperation(\n    CONST,` match stays unambiguous because it is per-constant) while permitting the co-located GET that Next.js forces.

Net effect: five operations gain the guard, nothing loses it.

### 2.4 Contract, registry and coverage artifacts

**`tests/openapi-contract.test.ts`** — add two side-effect imports into the reception block (`:141-148`); only NEW route FILES need one (`check-route-registry-parity.mjs:49-92` compares files, not operations):

```ts
import '@/app/api/v1/receptions/[receptionId]/route';
import '@/app/api/v1/receptions/[receptionId]/history/route';
```

**`scripts/check-operation-test-coverage.mjs`** — six MANIFEST entries inside the existing **Phase 1-18 (rec.)** block (`:476-565`); a P1-27 remediation read goes in its owning phase's block with the finding id in the note (`:284-288, :304-308` precedent). Shape:

```js
  'rec.reception-detail': {
    files: ['tests/backend/p1-27-reception-reads.test.ts'],
    required: ['success', 'denial', 'cross-tenant', 'isolation'],
    note: 'P1-27-INT-010. The reception had no read of any kind: rec.reception-approve and rec.reception-convert-to-work-order both demand If-Match and the only source of recordVersion was the response of a write the caller had just performed, so a visit was reachable in one unbroken session and in no other circumstance. This publishes recordVersion as an ETag.',
  },
```

`rec.` is on the **strict comment ratchet** (`:2408-2424`, `P1_18_PREFIXES = ['apt.','rec.']` at `:100`): comments are stripped before the "is this id referenced?" check, so every operation id must appear in **executable** code in the named file. It is also opted into the structural checks (`:2461-2497`) — declare both `route` and `service`, and the file must not be under `tests/foundation/`.

**Generated — never hand-edit:**

- `docs/api/openapi.v1.json`
- `docs/phase-1/phase-1-24/evidence/operation-register.{md,json}`
- `apps/web/src/lib/api/idempotent-operations.ts` (lists **every** published operation, not only idempotent ones)
- `docs/phase-1/phase-1-14/evidence/operation-test-matrix.json` and `…/phase-1-18/…` (side effect of `validate:operation-coverage`; nine matrices are rewritten, only these two change content). The P1-18 matrix is **not** in `.prettierignore`, so it must survive `format:check`.

### 2.5 Conditional

**`scripts/dev/owner-acceptance/context.mjs:229-237`** — `READER_PERMISSIONS` holds no `rec.` code, so `rec.reception.read` is holdable by nobody in the Owner acceptance environment. Adding `'rec.reception.read'` to the array is the grant path (`create-owner-account.mjs:227-230`). **Carried as an open question** — it also needs reception fixture data to be worth granting, and the no-fake-data policy governs that.

---

## 3. Operation definitions (literal `defineOperation` blocks)

All six: `module: 'reception'`, `scope: 'branch'`, `auditClass: 'none'` (so no `auditAction`), `rateLimitPolicy: 'expensive-read'`, `cacheCategory: 'never'`, no `idempotent`, no `versionGuarded` (no GET anywhere in the API carries either — 91 of 91).

### A — `apps/api/src/app/api/v1/receptions/[receptionId]/route.ts`

```ts
export const RECEPTION_DETAIL_OPERATION = defineOperation({
  id: 'rec.reception-detail',
  module: 'reception',
  method: 'GET',
  path: '/receptions/{receptionId}',
  summary: 'Read one reception visit, its origin, custody state and record version.',
  permissions: ['rec.reception.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});
```

Handler (the `work-orders/[workOrderId]/route.ts:44-69` shape verbatim):

```ts
export async function GET(
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    RECEPTION_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const reception = await receptionModule().receptionRead.readReception(
        db,
        params.receptionId,
        authorizeScope
      );
      return { body: reception, recordVersion: reception.recordVersion };
    },
    { params: raw }
  );
}
```

`recordVersion` on the `HandlerResult` is the only thing that emits an `ETag` (`route-handler.ts:63-69, 126-135, 386-392`), and `toETag` produces exactly the string `parseIfMatch` accepts (`concurrency.ts:36-49`). That is the whole fix for the If-Match supply problem.

### B — `apps/api/src/app/api/v1/receptions/route.ts` (added beside the existing POST)

```ts
export const RECEPTION_LIST_OPERATION = defineOperation({
  id: 'rec.reception-list',
  module: 'reception',
  method: 'GET',
  path: '/receptions',
  summary: 'List the reception visits of one branch, most recently received first.',
  permissions: ['rec.reception.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});
```

```ts
const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    status: z.enum(RECEPTION_STATUSES).optional(),
    vehicleId: schemas.uuid.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    RECEPTION_LIST_OPERATION,
    request,
    async ({ db }) => ({
      body: await receptionModule().receptionRead.listReceptions(
        db,
        parseOrFail(ListQuery, raw, 'query')
      ),
    }),
    scopeTargetOption(raw)
  );
}
```

`companyId`/`branchId` are **required** and passed as the authorization target — the `work-orders/route.ts:18-27, 79-111` precedent. This satisfies "the browser must not supply authoritative scope": `scopeTargetOption` (`validation.ts:236-252`) can only make authorization **stricter** — a malformed or absent pair yields _no_ target and the schema then refuses. Tenant is never accepted from the client; it comes from `context.principal.tenantId`.

### C — `…/[receptionId]/party-roles/route.ts` (added beside the existing POST)

```ts
export const RECEPTION_PARTY_ROLE_LIST_OPERATION = defineOperation({
  id: 'rec.reception-party-role-list',
  module: 'reception',
  method: 'GET',
  path: '/receptions/{receptionId}/party-roles',
  summary: 'List the dated party roles recorded on a reception visit.',
  permissions: ['rec.reception.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});
```

### D — `…/[receptionId]/authorizations/route.ts` (added beside the existing POST)

```ts
export const RECEPTION_AUTHORIZATION_LIST_OPERATION = defineOperation({
  id: 'rec.reception-authorization-list',
  module: 'reception',
  method: 'GET',
  path: '/receptions/{receptionId}/authorizations',
  summary: 'List the authorization decisions and authorization refusals on a reception visit.',
  permissions: ['rec.reception.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});
```

### E — `…/[receptionId]/condition-evidence/route.ts` (added beside the existing POST)

```ts
export const RECEPTION_CONDITION_EVIDENCE_LIST_OPERATION = defineOperation({
  id: 'rec.reception-condition-evidence-list',
  module: 'reception',
  method: 'GET',
  path: '/receptions/{receptionId}/condition-evidence',
  summary: 'List the pre-service condition evidence recorded on a reception visit.',
  permissions: ['rec.reception.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});
```

### F — `apps/api/src/app/api/v1/receptions/[receptionId]/history/route.ts`

```ts
export const RECEPTION_HISTORY_OPERATION = defineOperation({
  id: 'rec.reception-history',
  module: 'reception',
  method: 'GET',
  path: '/receptions/{receptionId}/history',
  summary: 'List the status and custody ledger of a reception visit, newest first.',
  permissions: ['rec.reception.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});
```

Every route module opens with `export const runtime = 'nodejs';` / `export const dynamic = 'force-dynamic';`.

---

## 4. Response shapes

Rules applied throughout: **ids are returned for navigation, never as the visible label** — every id is paired with a label column drawn from a real table; **`numeric`/`bigint` are rendered `::text` and stay strings**; timestamps are millisecond ISO via `.toISOString()` at the repository boundary while the **cursor** carries microseconds from `cursorTimestamp()`; snake_case → camelCase mapped by hand in the repository.

### A — `ReceptionDetailRow` (200 body; `ETag: "<recordVersion>"`)

| Field                     | Type                                                                                  | Notes                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | `string` (uuid)                                                                       | navigation                                                                                                                  |
| `displayNumber`           | `string \| null`                                                                      | the human label. **Nullable in the schema** (`reception_visits.display_number`) — see open question 1                       |
| `receptionStatus`         | `'opened'\|'inspecting'\|'authorized'\|'converted'\|'closed_without_work'\|'refused'` | `ck_reception_visits_status`                                                                                                |
| `origin`                  | `'appointment' \| 'walk_in'`                                                          | derived from the XOR (`ck_reception_visits_one_origin`); mirrors `reception-service.ts:124-130`                             |
| `appointmentId`           | `string \| null`                                                                      | navigation                                                                                                                  |
| `walkInId`                | `string \| null`                                                                      | navigation                                                                                                                  |
| `companyId`, `branchId`   | `string`                                                                              | navigation only; **never accepted as input on this route**                                                                  |
| `vehicleId`               | `string`                                                                              | navigation                                                                                                                  |
| `vehicleDisplayNumber`    | `string \| null`                                                                      | LEFT JOIN `veh.vehicles.display_number` — the label                                                                         |
| `odometerReadingId`       | `string \| null`                                                                      | id only; no reading value (open question 2)                                                                                 |
| `fuelLevelId`             | `string \| null`                                                                      | navigation                                                                                                                  |
| `fuelLevelName`           | `string \| null`                                                                      | LEFT JOIN `rec.fuel_levels` — **verify the catalogue's label column before writing the join**                               |
| `evSocPercent`            | `string \| null`                                                                      | `numeric(5,2)` → `ev_soc_percent::text`. **String. No JS float arithmetic.**                                                |
| `receivingEmployeeId`     | `string`                                                                              | **no label — the column has no foreign key** (open question 3)                                                              |
| `custodyAcceptedAt`       | `string` (ISO)                                                                        |                                                                                                                             |
| `custodyReleasedAt`       | `string \| null`                                                                      | added by migration `20260731090000_rec_custody_release_visit_marker.sql`; `null` means the workshop still holds the vehicle |
| `recordVersion`           | `number`                                                                              | `integer`, not bigint — stays a number, and is the ETag                                                                     |
| `createdAt` / `updatedAt` | `string` / `string \| null`                                                           |                                                                                                                             |

### B — `Page<ReceptionListEntry>` — `{ items, nextCursor, hasMore }`, **no total**

Item: `id`, `displayNumber`, `receptionStatus`, `origin`, `vehicleId`, `vehicleDisplayNumber`, `custodyAcceptedAt`, `custodyReleasedAt`, `recordVersion`.

Ordering contract `RECEPTION_LIST_ORDERING = { key: 'rec.reception_visits:custody_accepted_at_desc', direction: 'desc' }`.
SQL: `keysetFragment(page, { sort: 'rv.custody_accepted_at', id: 'rv.id' }, RECEPTION_LIST_ORDERING, n)` + `${cursorTimestamp('rv.custody_accepted_at')} AS custody_accepted_at_cursor` + `buildPageWithCursors`. Filters bound as `($n::text IS NULL OR rv.reception_status = $n)` / `($n::uuid IS NULL OR rv.vehicle_id = $n)` so no predicate is assembled from input and the keyset parameter index is fixed (`customer-identity-repository.ts:255-298` precedent).

`recordVersion` travels per row because the two guarded writes are addressed from the list (`customer-read-repository.ts:464-470` states this rule).

### C — `Page<PartyRoleEntry>`

`id`, `partnerId`, `partnerDisplayName`, `partnerDisplayNumber`, `relationshipRole` (one of the seven at `ck_reception_party_roles_role`), `validFrom`, `validTo` (`null` = still active), `assignmentSource`, `recordVersion`.
Labels from `crm.business_partners.display_name` / `.display_number`.
Optional `status: z.enum(['active','ended'])` filter, bound as `($n::text IS NULL OR (…))`.
Contract `{ key: 'rec.reception_party_roles:valid_from_desc', direction: 'desc' }`, cursor `cursorTimestamp('pr.valid_from')`.

### D — `Page<AuthorizationEntry>`

**The UNION is mandatory.** `rec.authorizations UNION ALL rec.refusals WHERE refusal_type = 'authorization' AND refusing_partner_id IS NOT NULL` — mirror `reception-repository.ts:348-361` exactly. Reading only `rec.authorizations` reports a withdrawn approval as consent, which is the defect the existing method exists to prevent (`:330-339`).

| Field                | Type                           | Notes                                                                                                                                                                                                                      |
| -------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`               | `'authorization' \| 'refusal'` | which table the row came from                                                                                                                                                                                              |
| `id`                 | `string`                       | navigation                                                                                                                                                                                                                 |
| `partnerId`          | `string`                       | `refusing_partner_id` for a refusal                                                                                                                                                                                        |
| `partnerDisplayName` | `string \| null`               | the label                                                                                                                                                                                                                  |
| `authorizingRole`    | `string \| null`               | `null` for a refusal                                                                                                                                                                                                       |
| `decision`           | `'approved' \| 'declined'`     | a refusal projects the literal `'declined'`                                                                                                                                                                                |
| `channel`            | `string \| null`               | `null` for a refusal                                                                                                                                                                                                       |
| `authorizedScope`    | `object \| null`               | `jsonb`                                                                                                                                                                                                                    |
| `evidenceDocumentId` | `string \| null`               | navigation                                                                                                                                                                                                                 |
| `occurredAt`         | `string` (ISO)                 |                                                                                                                                                                                                                            |
| `isStanding`         | `boolean`                      | `row_number() OVER (PARTITION BY partner_id ORDER BY occurred_at DESC, created_at DESC, id DESC) = 1` — the current decision for that partner. This is what makes the read tell the truth rather than "has ever approved". |

Contract `{ key: 'rec.reception_authorizations:occurred_at_desc', direction: 'desc' }`, cursor `cursorTimestamp('a.occurred_at')` on the outer alias.

### E — `Page<ConditionEvidenceEntry>`

One keyset page over a `UNION ALL` of the **eight non-restricted** evidence relations, mirroring the POST's discriminated union (`condition-evidence/route.ts:158-167`). Optional `kind` filter over the same eight literals.

Common: `kind`, `id`, `recordedAt` (`created_at`), `evidenceDocumentId`, plus per-kind fields:

- `complaint` — `category`, `severity`, `reportedByPartnerId`, `reportedByPartnerDisplayName`. **`complaint_text` is NOT projected.**
- `inspection` — `inspectorId`, `inspectionStatus`, `startedAt`, `completedAt`
- `condition_item` — `inspectionId`, `findingCategory`, `vehicleZone`, `severity`, `findingNote`, `correctionOf`
- `damage_map` — `documentId`, `documentVersionId`, `mapType`, `perspective`
- `damage_mark` — `damageMapId`, `markType`, `vehicleZone`, `coordX` (**string** — `::text`), `coordY` (**string**), `note`
- `contents` — the header row only. **`item_description`, `declared_value`, `declared_currency` are NOT projected.**
- `warning_light` — `warningLightCodeId`, `warningLightCode` (label from `rec.warning_light_codes`), `observedState`, `note`
- `leak` — `leakType`, `vehicleZone`, `severity`, `note`

`rec.complaint_details` and `rec.vehicle_content_details` are **excluded**. Both carry a SELECT policy requiring `iam.has_permission('iam.sensitive.view')` (`20260721099000_rec_complaints.sql:178-184`; `20260721103000_rec_vehicle_contents.sql:178-184`). Excluding them means the read needs no second permission code and no `auditClass: 'security'`. Publishing them is open question 4.

Contract `{ key: 'rec.condition_evidence:recorded_at_desc', direction: 'desc' }`, cursor `cursorTimestamp('e.created_at')` on the union alias.

### F — `Page<ReceptionHistoryEntry>`

`UNION ALL` of `rec.reception_status_history` and `rec.custody_history` — both are append-only ledgers with `(occurred_at, seq)` and a uuid `id`.

| Field                                                | Type                    | Notes                                                                |
| ---------------------------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| `kind`                                               | `'status' \| 'custody'` |                                                                      |
| `id`                                                 | `string`                | the keyset tie-breaker                                               |
| `fromState`                                          | `string \| null`        | status: `opened…refused`; custody: `accepted\|in_workshop\|released` |
| `toState`                                            | `string`                |                                                                      |
| `reason`                                             | `string \| null`        |                                                                      |
| `actorId`                                            | `string`                |                                                                      |
| `occurredAt`                                         | `string` (ISO)          |                                                                      |
| `seq`                                                | `string`                | **`bigint` → `seq::text`. String. No JS number.**                    |
| `correlationId`                                      | `string \| null`        |                                                                      |
| `receivingPartnerId` / `receivingPartnerDisplayName` | `string \| null`        | custody rows only                                                    |
| `releasingPartnerId` / `releasingPartnerDisplayName` | `string \| null`        | custody rows only                                                    |
| `evidenceDocumentId`                                 | `string \| null`        | custody rows only                                                    |

Contract `{ key: 'rec.reception_history:occurred_at_desc', direction: 'desc' }`.
**Tie-break on `id` (uuid), not `seq`** — `decodeCursor` rejects a non-uuid `i` (`pagination.ts:67-68, 121-125`); the precedent and its reasoning are `work-order-repository.ts:698-704`, which faced exactly this `(occurred_at DESC, seq DESC)` index. Cursor value from `cursorTimestamp('h.occurred_at')`.

`rec.custody_history` has never been SELECTed by the API. This is its first read path.

---

## 5. Registry / gate obligations checklist

Run in this order — the register imports from the coverage gate and reads the published contract, so the contract must be regenerated first.

- [ ] 1. Two new `route.ts` files exist, each with ≥1 `defineOperation`; every declared `{param}` maps to an existing `[param]` directory — `scripts/check-authorization-coverage.mjs:262-266, 282-291`
- [ ] 2. Two side-effect imports added to `tests/openapi-contract.test.ts` (new FILES only) — `scripts/ci/check-route-registry-parity.mjs:79-92`
- [ ] 3. Two literals added to `apps/api/src/server/http/route-templates.ts`
- [ ] 4. `rec.reception.read` seeded; `permissionCount` 104→105 in `schema-baseline.json:12` **in the same commit**; `tests/db/p1-15-shared-services-runtime-capabilities.test.ts:379, :443` updated — `scripts/ci/migration-replay-checks.mjs:238-243`
- [ ] 5. Six MANIFEST entries in `scripts/check-operation-test-coverage.mjs` — absence fails both `validate:operation-coverage` (`:2374-2376`) and `validate:p1-24-register` (`:480-482`)
- [ ] 6. `tests/backend/p1-27-reception-reads.test.ts` carries a `COVERAGE-EVIDENCE` block, and every operation id appears in **executable** code (strict ratchet, `:2408-2424`)
- [ ] 7. `tests/foundation/p1-18-scoped-authorization.test.ts` split by method; the ten commands unchanged; five reads added
- [ ] 8. `tests/ci/repository-paths.test.ts:140` → 206; `:161` title and `:174` → 249
- [ ] 9. Regenerate: `UPDATE_OPENAPI=1 npx vitest run tests/openapi-contract.test.ts`
- [ ] 10. Regenerate: `npm run validate:operation-coverage` (also rewrites nine matrices as a side effect)
- [ ] 11. Regenerate: `node scripts/p1-24-operation-register.mjs`
- [ ] 12. Regenerate: `node scripts/ci/generate-idempotent-operations.mjs`
- [ ] 13. `npm run verify:contracts` green — includes `validate:module-boundaries`, `validate:authorization-coverage`, `validate:operation-coverage`, `validate:openapi`, `validate:p1-24-register`, `validate:idempotent-operations`
- [ ] 14. `MAX_PARTIAL = 0` and `MAX_UNCOVERED = 0` still hold; totals move 243 → **249**, all Covered — `scripts/p1-24-operation-register.mjs:96, :99, :528-535`
- [ ] 15. `npm run format:check` from the **root** (the regenerated P1-18 matrix is not in `.prettierignore`), plus `apps/**` explicitly — root prettier does not see `apps/**`
- [ ] 16. `npm run test:backend`, `verify:inventories` (no P1-18/P1-27 inventory script exists — no change owed), `validate:aptrec-classification` (column gate — a read adds no columns, no-op)

**Do not** name `standard-read` as a rate-limit policy: it is not in `RATE_LIMIT_POLICIES` (`rate-limit.ts:116-176`), `policyFor` throws a bare `Error` outside `handleOperation`'s error boundary, and no gate catches it. Two route files carry a comment claiming `defineOperation` rejects unregistered names — that claim is false.

---

## 6. Test plan — `tests/backend/p1-27-reception-reads.test.ts`

Harness: import the exported `GET`s directly with a real `Request`; `runtimeAppPool()` (`rootlco_test_runtime`, `NOBYPASSRLS`) injected via `__setPrimaryPoolForTests`; principals via `StaticClaimsAuthenticator`; `ensureTestLogins` → `cleanBackendFixtures` → `ensureBackendFixtures`. Reads carry **no** idempotency key. Reception fixtures via `seedAuthorizedVisit` (`tests/backend/p1-19-helpers.ts:1319`, returns `{ visitId, vehicleId, companyId, branchId, recordVersion }`) — it already exists; do **not** copy the machinery out of `p1-18-reception-approval.test.ts`.

Table-driven, keyed by **registered operation id** (`p1-16-customer-read.test.ts:137-166` precedent) so the ids are executable code for the strict ratchet.

| #   | Test                                                                                                                                                                                                                                                                                         | What it proves                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Registration literal per operation: id, method `GET`, `permissions`, `scope === 'branch'`, `auditClass === 'none'`, `idempotent ?? false === false`, `versionGuarded ?? false === false`                                                                                                     | The declaration is what the plan says, not what a comment says                                                                                                                    |
| 2   | No authenticator installed → 401 `ERR-IAM-002`                                                                                                                                                                                                                                               | The pipeline authenticates before the handler                                                                                                                                     |
| 3   | Real, active, same-tenant principal holding every `rec.*` code **except** `rec.reception.read` → 403 `ERR-IAM-001`                                                                                                                                                                           | The new code is the operative one; not satisfied by any write code                                                                                                                |
| 4   | `it.each` over other-tenant / soft-deleted / never-existed ids → **the same** 404 `ERR-RES-001` on all five id-addressed reads                                                                                                                                                               | Existence is not disclosed across tenants; `ERR-RES-001` is documented as indistinguishable by design                                                                             |
| 5   | **Isolation split.** `PERMISSION_ELSEWHERE` (row visible via a permission-blind grant union, but no `rec.reception.read` in that branch) → **403**. `SCOPED_ELSEWHERE` (no grant in that branch at all) → **404**                                                                            | P1-18-A-01: RLS visibility is not authority, and the deferred `authorizeScope` is what refuses                                                                                    |
| 6   | Detail returns a numeric `recordVersion` **and** a non-null `ETag`; feed that exact header value back as `If-Match` to `POST /receptions/{id}/approve` and it succeeds; feed `version-1` and it is refused                                                                                   | **The point of the whole task.** No existing test round-trips a published version into a `rec.` guarded write                                                                     |
| 7   | `Object.keys(body).sort()` equals a literal contract key set (both directions) **plus** a forbidden-substring scan of the raw text for `complaint_text`, `complaintText`, `declared_value`, `declaredValue`, `item_description`, `vin_raw`, `chassis`, `engine_no`                           | A field-by-field assertion cannot catch an _added_ restricted column; the restricted narrative tables must never leak through E                                                   |
| 8   | Tenant-B principal with an **unrestricted** grant calling `GET /receptions?companyId=…&branchId=…` for tenant A's branch → 403 (target authorization refuses); calling for its own empty branch → **200 with an empty page**, not 404                                                        | An unrestricted grant is tenant-bounded by construction; the honest answer for an empty own-branch is an empty page                                                               |
| 9   | `GET /receptions` with `companyId` omitted → 422 naming the field; with a malformed pair → 422, never a scope-blind 200                                                                                                                                                                      | `scopeTargetOption` can only tighten; the schema is what refuses                                                                                                                  |
| 10  | **Cursor precision.** Fixture writes ten party roles / ten history rows in ONE statement so they share the timestamp to the microsecond; **first assert the collision exists** (`count = 10`, identical `to_char(…US)`), then walk at `limit=4` and assert 4 + 4 + 2 = 10 ids, no duplicates | P1-27-INT-006. A test that only walks proves paging terminates, not that it loses nothing. Mutation: restoring `sortValue: row.x.toISOString()` must make it return fewer than 10 |
| 11  | A cursor issued by C replayed against D → `ERR-PAG-001`                                                                                                                                                                                                                                      | Ordering contracts are per-list and non-transferable                                                                                                                              |
| 12  | `limit=1000` → 100 items + `hasMore: true`; `limit=0` → 422 `ERR-VAL-001`                                                                                                                                                                                                                    | `resolveLimit` clamps the ceiling and **rejects** below 1 (`pagination.ts:54-64`)                                                                                                 |
| 13  | Every page body has exactly the keys `items`, `nextCursor`, `hasMore`                                                                                                                                                                                                                        | No `total` is invented (P1-26-F-001)                                                                                                                                              |
| 14  | **Refusal is not consent.** Record an authorization approval, then a `refusal_type = 'authorization'` refusal for the same partner; D returns both rows and the refusal carries `isStanding: true` while the approval carries `isStanding: false`                                            | The two-table UNION is preserved; a withdrawn approval is visible as withdrawn                                                                                                    |
| 15  | `evSocPercent`, `coordX`, `coordY`, `seq` are `typeof === 'string'` in the JSON body, and `seq` survives a value beyond `Number.MAX_SAFE_INTEGER`                                                                                                                                            | numeric/bigint arrive as strings and stay strings                                                                                                                                 |
| 16  | `iam.audit_records` count **delta** across each read call is 0                                                                                                                                                                                                                               | A read is a read — asserted as a delta, because an absolute count proves nothing about what the call did                                                                          |
| 17  | Each `Query` rejects an unknown parameter (e.g. `?tenantId=…`) with 422                                                                                                                                                                                                                      | `.strict()` — and specifically that the browser cannot smuggle a tenant                                                                                                           |
| 18  | A malformed path uuid returns **422**, not 500                                                                                                                                                                                                                                               | Params parsed inside `handleOperation` (see §0)                                                                                                                                   |

---

## 7. Open questions — carried forward, not answered

1. **`display_number` is nullable** on `rec.reception_visits` (`:65`), and `insertWalkIn` passes it as `string | null`. If a visit can exist with no display number, the constraint "no UUID may be a visible label" has no label to fall back on for that visit. No report established when it is populated. **Decide before the UI consumes A or B.**

2. **Odometer value.** `odometer_reading_id` FKs `veh.odometer_readings (tenant_id, vehicle_id, id)`, but no report examined that table's columns and no reception read precedent projects it. The plan returns the id only. Whether the detail should publish the reading and its unit is unresolved.

3. **`receiving_employee_id` has no foreign key.** Verified: `Grep receiving_employee` over `supabase/` returns the column declaration, the immutability-trigger column list and the `rec.accept_check_in` parameter — **no `REFERENCES` clause anywhere**. There is no table it is guaranteed to resolve against, so no label can be joined honestly. The plan returns the bare id. Resolving this may need a data-model decision, not a read decision.

4. **Should E ever publish the restricted narrative?** `rec.complaint_details.complaint_text` and `rec.vehicle_content_details.*` are the customer's own words and declared values. The precedent for publishing them is `wo.additional-work-detail-read` (`permissions: ['wo.work_order.read','iam.sensitive.view']`, `auditClass: 'security'`); the competing precedent is `sal.delivery.view` (a domain-local `.view` code at risk `high`, `auditClass: 'privileged'`). The plan excludes them entirely, which needs neither. A second operation or a second permission is the follow-on if the Owner needs them.

5. **Risk level of `rec.reception.read`.** Proposed `low`, matching `crm.customer.read`, `veh.vehicle.read`, `wo.work_order.read`. The competing shape is `sal.delivery.view` at `high` for a read over signature/receiver evidence. The permissions report claimed `.read`/`low` was _the_ convention; the verdict refuted that. Risk level is catalogue metadata rather than an enforcement lever, so this does not change behaviour — but it should be confirmed rather than assumed.

6. **`rec.reception.read` is holdable by nobody.** No seed maps any `rec.*` code to any role (the catalogue's only INSERT is line 15, into `iam.permissions`), and `scripts/dev/owner-acceptance/context.mjs:229-237` carries no `rec.` code. Whether to add it to `READER_PERMISSIONS`/`OWNER_PERMISSIONS` is a change to the Owner acceptance environment, and it is only meaningful with reception fixture data — which the no-fake-data policy governs.

7. **E's page shape.** The plan uses one `UNION ALL` page with an optional `kind` filter, because the per-kind alternative (a required `kind`, eight ordering contracts) would put all eight of a screen's calls in the same `expensive-read` bucket — the exact fan-out the `customers/[customerId]/route.ts:35-39` rationale exists to avoid. There is no in-repo precedent for a _paginated_ UNION (only the unpaginated one at `reception-repository.ts:348-361`), so this is the least-bad reading rather than a copied pattern.

8. **Finding-id mapping.** A→INT-010, B→INT-011, C→INT-015, D→INT-016, E→INT-017, F→INT-021 is taken from the task statement in order. The registry-obligations report stated explicitly that it did not read `docs/phase-1/phase-1-27/findings.md` or `contract-archaeology.md`. **Confirm the mapping against those documents before writing the MANIFEST notes** — the notes are the permanent record of why each read exists.

9. **`fuel_levels` label column.** The plan joins `rec.fuel_levels` for `fuelLevelName`. The catalogue's actual label column was not verified. Check `20260721095000_rec_configuration_catalogs.sql:102` before writing the join.

10. **`rec.` phase bucket in the coverage counts.** `scripts/check-operation-test-coverage.mjs` counts stop at `p1_22` and the P1-27 vehicle reads were folded into the existing `veh.`/P1-17 rows. The plan folds these into the P1-18 `rec.` block for the same reason. Adding a P1-27 prefix with no operations behind it is explicitly called a "vacuous 0/0 block" at `:152-153`.
