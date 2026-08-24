# P1-29 — information architecture and component reuse

Where P1-29 lives in the application, what each screen is, and — more usefully —
what already exists so that P1-29 builds screens rather than infrastructure.

---

## 1. The router conventions P1-29 must follow

`apps/web/src/app/` is the only router root (pinned by
`scripts/ci/check-web-topology.mjs`, which also makes `apps/web/app/` a
forbidden tracked prefix). Every route sits under `src/app/[locale]/`.

- **Locales**: `LOCALES = ['ar','en']`, `DEFAULT_LOCALE = 'ar'`,
  `DIRECTION = {ar:'rtl', en:'ltr'}`. `directionOf()` is the only place
  direction is decided, and `dir` is set once on `<html>` in the locale layout.
  Components use logical Tailwind utilities (`ps-*`, `border-e`, `start-*`) and
  never `[dir='rtl']` selectors.
- **Route groups** add no URL segment: `(auth)`, `(dashboard)`, `(design)`.
  Everything P1-29 builds is in `(dashboard)`.
- **The dashboard layout runs `requireSession(locale)` before any page markup
  exists**, then renders `<AppShell locale messages capabilities={{permissions:
session.permissions}} account=… />`.
- **Naming**: `<module>/page.tsx` (list), `<module>/[<entity>Id]/page.tsx`
  (detail), `<module>/new/page.tsx` (create), plus named sub-routes. Existing
  instances: `/crm/customers`, `/crm/customers/[customerId]`, `/vehicles`,
  `/receptions`, `/receptions/check-in`, `/appointments`, `/appointments/new`.

### 1.1 The page template, verbatim in shape

```
export default async function X({params}: {readonly params: Promise<{locale: string; …Id: string}>})
  → await params
  → isLocale(locale) guard, else notFound()
  → requireSession(locale)
  → getMessages(locale)
  → permission check: holds(session.permissions, CODE) — deny and return
  → await the read adapter
  → render the screen component
```

**`scripts/ci/check-p1-28-access.mjs` rule `gate-before-read` requires every
phase route page to deny-and-return on a permission _before_ its first awaited
read.** P1-29 will need the equivalent rule extended to its own routes, or its
pages will pass a gate that was never pointed at them. That is a CI-config
question for the implementation phase, recorded here so it is not discovered
late — `INS-12`.

`pageMetadata(titleKey)` returns a `generateMetadata`; the locale layout owns
the ` — CRM` suffix via `title.template`. **Use the same key as the visible
`PageHeader`.**

---

## 2. Navigation — the entries already exist and are test-pinned

`apps/web/src/config/navigation.ts:177-198`, group `work`:

| key                         | href                       | permission                 | status    | scope  |
| --------------------------- | -------------------------- | -------------------------- | --------- | ------ |
| `work-orders`               | `/work-orders`             | `wo.work_order.read`       | `planned` | branch |
| ├ `work-orders.diagnostics` | `/work-orders/diagnostics` | `dia.diagnostic.read`      | `planned` | branch |
| └ `work-orders.quality`     | `/work-orders/quality`     | `qms.quality_control.read` | `planned` | branch |
| `technicians`               | `/technicians`             | `tech.technician.read`     | `planned` | branch |

Diagnostics and quality are already declared as **children** of `work-orders`,
not siblings. Two facts that constrain P1-29:

1. **`navigation.test.ts` asserts the exact sorted sets of `available` and
   `planned` keys** (`navigation.test.ts:52` and `:96`), with the stated reason
   that _"`available` is a claim that a screen exists"_ — an `available` entry
   with no screen makes the sidebar produce 404s. Flipping any of these four
   from `planned` to `available` therefore requires editing that test in the
   same change, and only once the screen genuinely exists.
2. **Visibility is capability-driven, never role-driven.**
   `hasPermission(capabilities, code)` is true only for `code === null` or exact
   membership. `visibleNavigation()` filters items and drops any parent left
   with no visible children — and `navigation.test.ts:226` pins that children
   are filtered _independently of their parent_, so a caller holding only
   `dia.diagnostic.read` sees the diagnostics child under a `work-orders` parent
   they cannot otherwise open. P1-29's parent route must handle being reached
   that way.

`Icon`'s `ICON_NAMES` includes `'work-orders'` and `'technicians'`. There is
**no** diagnostics or quality glyph — both children currently reuse
`'work-orders'`. If P1-29 wants distinct glyphs, that is an addition to
`PATHS` in `Icon.tsx`.

---

## 3. Proposed route map

Existing declared routes are marked ✔; the rest are proposals for the
implementation phase.

| route                                                   | screen                              | permission                                                    | notes                                                                            |
| ------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `/work-orders` ✔                                        | **branch board**                    | `wo.work_order.read`                                          | requires a company/branch pair; filters `state`, `kind`, `openedFrom`/`openedTo` |
| `/work-orders/[workOrderId]`                            | **work-order detail**               | `wo.work_order.read`                                          | the hub — see section 4                                                          |
| `/work-orders/[workOrderId]/closure`                    | **closure checklist**               | `wo.work_order.read` to view, `…transition` + `…close` to act | driven by the eligibility endpoint                                               |
| `/work-orders/diagnostics` ✔                            | **diagnostics index**               | `dia.diagnostic.read`                                         | see the caveat in section 5                                                      |
| `/work-orders/[workOrderId]/inspections/[inspectionId]` | **diagnostic report**               | `dia.diagnostic.read`                                         | reached from the job it belongs to                                               |
| `/work-orders/quality` ✔                                | **quality index**                   | `qms.quality_control.read`                                    |                                                                                  |
| `/work-orders/[workOrderId]/quality/[recordId]`         | **QC record**                       | `qms.quality_control.read`                                    | QC is per work order                                                             |
| `/technicians` ✔                                        | **technician index / availability** | `tech.technician.read`                                        | `from`/`to` are mandatory on the availability read                               |
| `/technicians/[technicianProfileId]`                    | **technician queue**                | `tech.technician.read`                                        | _not_ "my queue" — see section 6                                                 |

**No `/work-orders/new`.** There is no creation endpoint (A2 in
[permission-matrix.md](permission-matrix.md)); work orders arrive from
reception. The board's empty state should say so and link to `/receptions`
rather than offering a create action that cannot exist.

**No standalone `/jobs/[jobId]`.** There is no job read endpoint (`INS-03`), so
a job route would have to load the whole parent to render one child. Jobs are
panels inside the work-order detail until that endpoint exists.

---

## 4. Work-order detail — the hub

One read (`GET /work-orders/{id}`) returns `{workOrder, jobs[], nextStates[]}`.
Everything else on the page is a separate call, each with its own permission,
each independently deniable. The layout must therefore tolerate _partial
authority_ — a caller who can see the order but not the assignments, or the
lines but not the restricted detail.

Proposed structure, using the existing `Tabs` component:

| tab                 | content                                                                        | reads                            | authority                                            |
| ------------------- | ------------------------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------- |
| **Overview**        | header facts, current state, `nextStates` actions, closure eligibility summary | detail + closure-eligibility     | `wo.work_order.read`                                 |
| **Jobs**            | `jobs[]` from the detail read; per-job assignment and labour panels            | + assignments, + labour sessions | assignment/labour panels need `tech.technician.read` |
| **Lines & parts**   | service lines, required parts                                                  | two unpaginated `{items}` reads  | `wo.work_order.read`                                 |
| **Additional work** | requests, their state, the customer decision                                   | list + per-request approval read | approve/detail need their own codes                  |
| **Diagnostics**     | reports per job                                                                | per-job list                     | `dia.diagnostic.read`                                |
| **Quality**         | QC records for the order                                                       | list                             | `qms.quality_control.read`                           |
| **History**         | the work-order transition history                                              | keyset page                      | `wo.work_order.read`                                 |

Design notes that follow from the contract rather than from taste:

- **Actions come from `nextStates`, not from a hard-coded list.** The graph is
  tenant-overridable data ([contract-archaeology.md](contract-archaeology.md)
  section 6.1). Render one action per returned next state, label it from the
  catalogue code, and prompt for a reason when the transition requires one.
- **A reason-requiring transition uses `ReasonConfirmDialog`**, which already
  exists (`onConfirm(reason: string)`).
- **Every state-changing control must carry the current `record_version`** for
  `If-Match`. Losing it turns a legitimate action into a 428.
- **`qc_pending` freezes scope** (`allows_jobs`, `allows_labor`,
  `allows_additional_work` all false). The tabs should reflect that visibly, not
  let a user compose a request that the Backend will refuse.
- **Closure is a checklist, not a button.** `GET …/closure-eligibility` returns
  every blocker at once; render all of them with their remedies.

---

## 5. The diagnostics and quality index routes are questionable as declared

`/work-orders/diagnostics` and `/work-orders/quality` are declared as _branch-
level index_ routes. There is no branch-level read for either:

- diagnostic reports are listed **per job** (`GET /jobs/{jobId}/inspections`);
- QC records are listed **per work order**
  (`GET /work-orders/{id}/quality-controls`).

So neither index can be populated by a single call. Three options, and this is a
decision the implementation phase must take explicitly rather than discover:

1. **Make them entry points, not lists** — a search/pick-a-work-order screen
   that navigates into the per-order surfaces. No Backend change. Weakest
   product value, honest.
2. **Fan out client-side** over the board's page of work orders. N+1 reads,
   bounded by page size, and wrong the moment the user pages. Not recommended.
3. **Add branch-level list endpoints.** Backend work, and the right answer.
   P1-29 is a mixed phase, so "Backend" does not put it out of scope — but it is
   not in [backend-prerequisite-gate.md](backend-prerequisite-gate.md), because
   nothing designed is blocked on it. Adding it would be widening the phase, and
   that is an Owner decision rather than a drafting one.

Recorded as `INS-13`. The navigation entries exist either way — this decides
what is behind them.

---

## 6. The technician surface, and the "my queue" problem

`GET /technicians/{technicianProfileId}/queue` exists.
**Nothing maps a signed-in user to their own `technicianProfileId`** (`INS-04`).
`GET /auth/session` returns `{userId, tenantId, email, displayName, companyIds,
branchIds, permissions[]}` and no profile reference.

Consequences for the IA:

- `/technicians/[technicianProfileId]` — a **supervisor** picking a technician —
  is buildable today.
- `/technicians/me` — a technician opening their own work — is **not**, and no
  client-side workaround is legitimate. Guessing from `displayName` or email is
  a correctness and a privacy defect.
- `/technicians` as an index has the same problem as section 5: there is no
  technician _directory_ read, only `GET /technicians/available` with a
  mandatory `from`/`to` window. An "available technicians in this window"
  screen is buildable; a "list of our technicians" screen is not.

This is the single largest gap between what the phase title promises
("Technician Experience") and what the platform can serve. It is stated at full
strength in [blocker-register.md](blocker-register.md).

---

## 7. Component reuse manifest

### 7.1 Available — use, do not rebuild

| component / helper                        | signature highlights                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppShell`                                | `{locale, messages, capabilities?, children, secondaryPanel?, account?}` — sidebar, collapse rail, tablet drawer, `<main>`                                                                                                                                                                                                            |
| `PageHeader` / `PageBody` / `Breadcrumbs` | `{messages, locale, titleKey, descriptionKey?, crumbs?: Crumb[], actions?}`; a parent crumb must carry `href`                                                                                                                                                                                                                         |
| `DataTable`                               | `{messages, columns: Column<Row>[], rowId, request, response, status, filterDefinitions?, onRequest…}`                                                                                                                                                                                                                                |
| `useServerTable<Row>(load, {initial})`    | → `{request, setRequest, response, status, correlationId, refresh}`; the loader returns `ServerPage<Row>` with `'ok' \| 'denied' \| …`                                                                                                                                                                                                |
| `CursorPager`                             | pagination where no `total` exists — **the P1-29 case for every keyset read**                                                                                                                                                                                                                                                         |
| read-completeness helpers                 | `readCompleteness()`, `hasFurtherPage()`, `membershipVerdict<Row>()`, `canPage()` — the rules that stop a paged read answering for the whole set (the P1-28 round-two defect). **Mandatory** wherever P1-29 draws a conclusion from a page.                                                                                           |
| view states (10)                          | `LoadingState`, `SkeletonRows`, `EmptyState`, `NoResultsState`, … from `@/components/states/States`                                                                                                                                                                                                                                   |
| `Dialog`                                  | `{open, onClose, title, description?, children, footer?, messages, role?: 'dialog' \| 'alertdialog', initialFocusRef?, closeOnOutsideClick?, width?}`                                                                                                                                                                                 |
| `Drawer`                                  | `{open, onClose, title, children, footer?, messages, side?}`                                                                                                                                                                                                                                                                          |
| `Tabs`                                    | `{tabs: TabDefinition[], label, initialId?}`                                                                                                                                                                                                                                                                                          |
| `ConfirmDialog` / `ReasonConfirmDialog`   | the second adds `onConfirm(reason: string)` — **the transition-reason control**                                                                                                                                                                                                                                                       |
| `ToastRegion` + `notifyActionResult`      | tone map: success→success, conflict/throttled→**warning**, denied/expired/unavailable/error→error; `invalid` is deliberately **not** toasted (it belongs on the field)                                                                                                                                                                |
| `Field` primitives                        | `FieldFrame`, `TextField`, `SelectField`, … with `FieldIds {controlId, describedBy, …}`                                                                                                                                                                                                                                               |
| `MoneyField`                              | backed by `lib/money.ts` — for the rework cost                                                                                                                                                                                                                                                                                        |
| `RecordForm`                              | declarative append/replace form over a Server Action                                                                                                                                                                                                                                                                                  |
| instant helpers                           | `validateInstant`, `composeInstant`, `composeDayInstant`, `instantFieldError`, `toLocalDateTimeValue`, `hasExplicitUtcOffset` — **for labour-session correction and the availability window**                                                                                                                                         |
| `BranchTargetFields`                      | the company/branch pair. Use `key` + `defaultValue` + `onChange` with an `attempt` counter, not a controlled `value` — a controlled value is not re-written by the reconciler after a Server Action settles, and the pair silently blanks. `form-reset-class.test.ts` pins that every `<form action={…}>` call site passes `attempt`. |
| `CustomerSelector` / `PartyLabel`         | only if P1-29 surfaces a party — note `INS-10`                                                                                                                                                                                                                                                                                        |
| `PrintDocument` / `PrintTable`            | the printable shell, if a job card is ever printed                                                                                                                                                                                                                                                                                    |
| `Icon`                                    | `'work-orders'` and `'technicians'` already exist                                                                                                                                                                                                                                                                                     |
| formatting                                | `intlLocale`, `formatNumber`, `formatInteger`, `formatDate`, `formatTime`, `formatDateTime`, `resolvedTimeZone()`                                                                                                                                                                                                                     |
| attachments                               | `features/attachments/api.ts`: `listDocumentCategories()`, `captureDocument(CaptureInput)` — the route to a `documentVersionId`                                                                                                                                                                                                       |

The `(design)` gallery at `/[locale]/gallery` renders these live and is the
fastest way to check a prop before writing against it.

### 7.2 Missing — P1-29 will have to build or decide

| gap                             | detail                                                                                                                                                                                    | recommendation                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **status badge**                | The only `StatusBadge` in the tree is a private, unexported local function inside the design gallery. Real screens render status as plain translated text.                                | P1-29 has more status vocabularies than any prior phase (9 WO states, 6 job states, 4 diagnostic states, 3 QC results, 4 additional-work states, 5 finding severities, 3 recommendation priorities). This is the one shared component worth promoting — but it must be **catalogue-driven**, not an enum, for the two tenant-overridable graphs. |
| **timeline**                    | No timeline component exists anywhere; the word appears only in docblock prose.                                                                                                           | P1-29 has four history surfaces. Build one, or render history as a `DataTable`.                                                                                                                                                                                                                                                                  |
| **permission gate component**   | There is no `<Can>` / `<PermissionGate>`. The established pattern is two-layer and prop-based: the route page computes `holds(session.permissions, CODE)` and passes a boolean prop down. | Follow the established pattern. Do not introduce a new abstraction in a phase this large.                                                                                                                                                                                                                                                        |
| **permission constants module** | Each domain declares a frozen `const X_PERMISSIONS = {…} as const` plus `holds()`. `features/crm/permissions.ts` is the model.                                                            | P1-29 needs `features/work-orders/permissions.ts` covering all 22 codes.                                                                                                                                                                                                                                                                         |
| **`features/work-orders`**      | `src/features/` holds administration, appointments, attachments, authentication, crm, receptions, vehicles — and nothing for this domain.                                                 | New feature modules: `work-orders`, and a decision on whether diagnostics/technicians/quality are sub-modules or siblings.                                                                                                                                                                                                                       |
| **the routes themselves**       | No `work-orders`, `technicians`, `diagnostics` or `quality` directory exists under `(dashboard)`. The nav entries point at routes that do not exist.                                      | —                                                                                                                                                                                                                                                                                                                                                |

### 7.3 Conventions that are not what you would guess

- **No React Query, no SWR.** Zero hits for `tanstack`/`useQuery`/`useMutation`/
  `swr` in `apps/web/src`. There is no query-key shape and no invalidation
  convention. **Do not introduce one** — a new data-fetching dependency is
  outside the P1-29 Frontend remit and would touch package dependencies.
- **`react-hook-form` is a declared dependency and is used nowhere.** Only a
  docblock in `SubmitButton.tsx` mentions it. It is not the convention.
- **Reads**: a server component awaits a `'use server'` adapter in
  `features/<domain>/*-api.ts` which calls `readOperation<T>(path)` →
  `ReadState<T> = {status:'ok', data, correlationId} | {status:…}`.
- **Writes**: Server Actions returning
  `ActionState {status, messageKey?, fieldErrors?, correlationId?, attempt?}`
  (`IDLE`, `fromFailure`, `invalid`, `success`, `isTerminalSuccess`).
- **A `'use server'` module may export only async functions.** A single
  non-function export takes down every Server Action bundled beside it — _in
  other features_ — and `next dev` will not tell you. This has bitten before.
- **`src/lib/api` is the only module allowed to perform network I/O**
  (`check-api-boundary.mjs` `NETWORK_OWNERS`). No importing `apps/api` source,
  no importing supabase from `apps/web`.
- **`PUBLISHED_OPERATIONS`** (305 operations, generated from
  `docs/api/openapi.v1.json`, carrying `{template, method, operationId,
idempotent, auditClass}`) is consumed via `resolveOperation…` to attach
  `Idempotency-Key`. P1-29's idempotent calls get their key from that registry,
  not from ad-hoc code.
- **Notification authority is gate-enforced**: `check-notification-authority`
  has four rules — `ToastRegion` rendered in exactly one place, that place is
  `NotificationHost`, mounted once in the locale layout, and no second
  notification library. P1-29 raises toasts through `notifyActionResult`, never
  by rendering its own region.
- **"A feature may never import another feature"** is repeated in six docblocks
  and **enforced by nothing** — no ESLint rule, no CI gate — and is already
  violated by eight administration imports. P1-29 should honour it as a
  convention and should **not** rely on it being true elsewhere. `INS-14`.

---

## 8. i18n

Two flat catalogues, `src/i18n/messages/en.json` and `ar.json`, keyed by dotted
strings; **1868 keys in `en`**; no per-namespace files. P1-29 adds a large key
block (`workOrders.*`, `jobs.*`, `diagnostics.*`, `technicians.*`, `quality.*`)
and every key must land in **both** catalogues in the same change.

Two P1-29-specific i18n problems worth naming now:

- **Catalogue codes are data, not message keys.** Tenant-defined work-order
  states have no translation and cannot have one at build time. The UI needs a
  documented fallback: translate known platform codes, and render an unknown
  code humanised from the code itself rather than showing a missing-key error.
- **`evidenceType` on diagnostic evidence is free text with no vocabulary.** If
  the UI offers a picker, the UI owns that vocabulary and its translations; if
  it offers a text box, the data will be unqueryable. Prefer a picker with an
  "other" escape.

`LocaleSwitcher` lives in the AppShell top bar and exports
`swapLocale(pathname, next)` and `withCarriedQuery(path, search)` so query state
survives a language change — P1-29's board filters must therefore be **in the
query string**, not in component state, or they will be lost on a locale switch.
