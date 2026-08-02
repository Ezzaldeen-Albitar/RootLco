# P1-25 — Frontend foundation evidence

Companion to [workspace-normalization-evidence.md](workspace-normalization-evidence.md),
which covers Stage 1. This document covers the frontend foundation itself.

Every figure was produced by running the command beside it on the feature branch.

---

## 1. What was built

| Area              | Location                                       | Notes                                                                                |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Application shell | `src/components/shell/AppShell.tsx`            | sidebar region, header, main landmark, secondary panel slot, tablet drawer, collapse |
| Page furniture    | `src/components/shell/PageHeader.tsx`          | breadcrumbs, the single `h1`, description, page-actions slot                         |
| Navigation model  | `src/config/navigation.ts`                     | 15 modules, 5 groups; data, not JSX                                                  |
| Permission model  | `src/lib/permissions.ts`                       | usability only; unknown means denied                                                 |
| Locale switcher   | `src/components/shell/LocaleSwitcher.tsx`      | real links, so direction is set by the server                                        |
| Data table        | `src/components/data-table/`                   | server-driven; URL safety enforced by two independent rules                          |
| Form controls     | `src/components/forms/Field.tsx`               | one wrapper wires every accessible relationship                                      |
| Decimal money     | `src/lib/money.ts`, `forms/MoneyField.tsx`     | canonical strings end to end                                                         |
| Overlays          | `src/components/overlays/Overlays.tsx`         | dialog, alert dialog, drawer, tabs, toast, three confirmations                       |
| Shared states     | `src/components/states/States.tsx`             | ten states, none leaking internals                                                   |
| Typed API client  | `src/lib/api/client.ts`                        | the only place the web tier performs network I/O                                     |
| Print foundation  | `src/components/print/PrintDocument.tsx`       | A4, repeating table headers, chrome hidden                                           |
| Formatting        | `src/lib/format.ts`                            | locale-safe date, time and number                                                    |
| Component gallery | `src/components/gallery/`, `/[locale]/gallery` | the visible proof surface                                                            |
| Icons             | `src/components/primitives/Icon.tsx`           | 16 original paths, no icon dependency                                                |

---

## 2. Tests

| Tier                        | Files               | Tests    | Failed | Skipped |
| --------------------------- | ------------------- | -------- | ------ | ------- |
| Repository unit / component | 60                  | **1330** | 0      | 0       |
| Web logic + DOM             | 11                  | **231**  | 0      | 0       |
| Web browser (Playwright)    | 1 spec × 5 projects | **81**   | 0      | 0       |
| API backend                 | 75                  | **1752** | 0      | 0       |
| Database / RLS              | 138                 | **1636** | 0      | 0       |

Browser projects: `desktop-en` (1440×900), `desktop-ar` (1440×900), `laptop-en`
(1280×800), `tablet-ar` (1024×768), `reduced-motion` (1280×800).

**Zero flaky.** The first full matrix run reported 11 flaky results that all passed
on retry. The cause was five projects contending for one `next start` server, not the
application, so the concurrency is pinned to one worker and **retries are zero** — a
retry budget would have hidden the contention rather than fixed it.

---

## 3. Gates

| Gate             | Result                                            |
| ---------------- | ------------------------------------------------- |
| Web Stylelint    | 0 errors, 0 warnings                              |
| Design tokens    | 59 files, 0 raw values outside the token layer    |
| Brand isolation  | 59 files, 0 violations                            |
| API boundary     | 37 files, 0 violations                            |
| Command coverage | 68/68 locally, 68/68 in hosted CI                 |
| Dependency audit | 0 vulnerabilities in root, API and web; 0 waivers |

The API-boundary gate (`apps/web/scripts/check-api-boundary.mjs`) fails the build on
a `fetch()` outside `src/lib/api`, on any import of `apps/api` or Supabase source, on a
server-only Node import, and on `dangerouslySetInnerHTML`. Each of those compiles
perfectly and is invisible in review, which is why it is mechanical.

---

## 4. Decimal money

The rule: a canonical business amount is a **decimal string** from the keystroke to the
request body. No `Number()`, no `parseFloat`, no `toFixed`, no scaling by a power of ten.
Padding `"12.5"` to `"12.5000"` appends characters; comparison walks the digits.

`Number()` appears exactly **once**, inside a display helper, written as
`globalThis.Number` so it is greppable. `tests/money.test.ts` asserts that count is one,
that `parseFloat` and `toFixed` appear nowhere, and that no amount is multiplied or
divided — because a behavioural test alone cannot catch a `Number()` added later, which
rounds correctly for whatever values the test happens to use.

The proof that it matters: `99999999999999.9999` and `99999999999999.9998` are 18
significant digits, distinct here, and **identical** once either passes through a double.
`compareMoney` orders them; a numeric comparison reports equal.

---

## 5. URL safety

Table state belongs in a URL — a shared link, a bookmark, the back button. But a URL is
written to browser history, server access logs, proxy logs, and the `Referer` header of
every outbound request. So a URL may carry **which** filter is applied, never the **value**
an operator typed.

Two independent rules, not a convention:

1. A filter serialises only if its key is registered **and** its value is one the
   definition declares — the property that survives a `<select>` being changed into a
   text box later.
2. A list of sensitive key names (`vin`, `phone`, `plate`, `amount`, `sessionId`, …) is
   refused outright, because a filter registered with a very wide option set would
   otherwise pass rule 1.

`search` is inside the prohibition deliberately: it is the likeliest place for a
customer's name to reach a proxy log. It lives in memory and is never written or restored.

---

## 6. Accessibility

Automated `axe` assertions run over dialogs, tables, forms and print documents **in both
directions**. Beyond that, the specific decisions:

| Property             | Where                               | Why it is not the obvious implementation                                                                               |
| -------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Skip link works      | `#main` has `tabIndex={-1}`         | Without it the browser scrolls to main and leaves focus behind, so the next Tab returns to the navigation just skipped |
| Focus returns        | `useDialogBehaviour`                | Otherwise a keyboard user is dropped at the top of the document on every dismissal                                     |
| Focus is trapped     | `useDialogBehaviour`                | Otherwise the page behind a modal is still reachable by Tab                                                            |
| Destructive focus    | `ConfirmDialog`                     | Cancel is focused; Enter is muscle memory and a dialog that deletes on Enter turns a reflex into data loss             |
| Sort announced       | `aria-sort` on the header           | An arrow glyph conveys it to sighted users only                                                                        |
| Pagination named     | word names, not glyphs              | `«` is announced as "left-pointing double angle quotation mark", and it mirrors under RTL while the name must not      |
| Range announced      | `aria-live` on the count            | Otherwise a screen-reader user presses Next and hears nothing                                                          |
| Active item marked   | shape **and** colour                | Colour alone fails WCAG 1.4.1                                                                                          |
| Collapsed sidebar    | name moves to `aria-label`          | A visual affordance must not change what is announced                                                                  |
| Live region persists | `ToastRegion` renders when empty    | A region created with its content is silent                                                                            |
| One tab tabbable     | `tabIndex` on the selected tab only | Otherwise a keyboard user traverses every tab to reach the panel                                                       |

Manual keyboard review was performed in a real browser through the Playwright smoke:
Tab order from the skip link into main, focus trap and restoration in the dialog,
arrow-key movement in tabs, and the destructive-confirmation focus target are each
asserted against a running production build rather than a jsdom approximation.

---

## 7. Internationalisation

Both catalogues carry the same keys, asserted by `tests/i18n.test.ts`, which also fails on
an empty message, on a key without a namespace, and on an Arabic entry containing no
Arabic script — the copy-paste that leaves English in the Arabic file and reads as
translated to anyone who does not read Arabic.

`lang` and `dir` are set on `<html>` by the **server** layout, so the document arrives
correct rather than being corrected after hydration. The locale switcher renders real
links for the same reason.

**Numerals:** `ar` uses Latin digits via the `-u-nu-latn` extension. Workshop paperwork,
plates, VINs and invoices in Jordan are written with Latin digits, and a table where the
amounts are in ٠١٢٣ and the references in 0123 is harder to scan than either alone.

**Timezone:** dates and times are formatted in the **browser's** timezone, because an
operator reading an appointment time needs the clock in front of them. The consequence is
recorded rather than discovered later: the same instant renders differently in Amman and
Riyadh, so anything that must agree across locations formats server-side or carries an
explicit timezone. Nothing in this layer decides a business date.

---

## 8. Frontend security

A Content Security Policy is served from `apps/web/next.config.ts` and asserted by
`tests/security.test.ts`:

- no `'unsafe-eval'` — the single difference between a CSP that stops an injected script
  and one that does not
- no `'unsafe-inline'` for scripts; the one `'unsafe-inline'` in the policy is on
  `style-src`, which Next requires for critical CSS, and a style injection cannot execute
- no wildcard source anywhere; `connect-src` is `'self'` plus the configured API origin
- `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`

Also asserted mechanically: no `dangerouslySetInnerHTML` anywhere in `src` or `app`; no
server-only environment name (`SERVICE_ROLE`, `DB_PASSWORD`, `JWT_SECRET`, …) referenced
in web source; `localStorage` touched in exactly **one** reviewed module; the only
persisted value is a namespaced boolean; and the permission module contains no `isAdmin`,
no `role ===`, and no tenant, company or branch identifier read from client state.

---

## 9. Performance baseline

Measured on this machine — Windows, Node v24.16.0, npm 11.13.0 — from a cold
`npm run build:web`. These are a **baseline to compare against**, not a threshold: no
budget is asserted, because a first measurement is not evidence of what is acceptable.

| Measurement               | Value                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Web production build time | 36 s                                                                                               |
| `.next/static`            | 732,778 bytes (0.70 MB) across 16 files                                                            |
| `.next/server`            | 5,273,057 bytes (5.03 MB) across 181 files                                                         |
| Routes                    | `/`, `/[locale]` (SSG, `/ar` and `/en`), `/[locale]/gallery` (dynamic)                             |
| Hydration warnings        | none — the browser smoke asserts an empty console on `/en`, `/ar`, `/en/gallery` and `/ar/gallery` |
| Horizontal overflow       | none at 1440×900, 1280×800 or 1024×768                                                             |

The gallery is the only dynamic route, and deliberately so — see finding `P1-25-F-018`.

Client components are limited to the ones that genuinely hold state or listen for events:
the shell, sidebar, data table, overlays, form controls and gallery. The page shells,
page header, breadcrumbs, states and print document are server components.

---

## 10. Findings from this stage

| ID            | Severity | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-25-F-018` | Medium   | The gallery route was statically prerendered, so its runtime access flag was evaluated once at **build** time and `notFound()` was baked into the static page. The flag did nothing at runtime and the gallery was unreachable in every deployed environment, including the ones meant to opt in. Fixed with `force-dynamic`. **The general rule: a route whose visibility depends on a runtime value must not be statically prerendered.** |
| `P1-25-F-019` | Low      | The gallery flag was `NEXT_PUBLIC_`-prefixed, which Next.js inlines at build time — so it could never be changed by a deployment. Renamed to `ROOTLCO_ENABLE_GALLERY`; it is a server decision the browser has no reason to receive.                                                                                                                                                                                                        |
| `P1-25-F-020` | Low      | The API client could not distinguish a caller cancellation from its own timeout: both arrive as an `AbortError` whose reason is a `DOMException`. Reporting a user pressing Cancel as a backend timeout puts a service-unavailable state on screen for something that did not fail. Fixed with an explicit flag plus `TimeoutError`.                                                                                                        |
| `P1-25-F-021` | Low      | The reason-confirmation reset ran in an effect, which renders the stale reason once before clearing it — for a reason box, the previous refusal's text is briefly visible in the next one. Adjusted during render instead.                                                                                                                                                                                                                  |

Three test **fixtures** were also wrong rather than the code, and are recorded because the
corrections are facts worth keeping: `numeric(18,4)` allows 14 integer digits (not 16);
`formatMoney` canonicalises a short form rather than rejecting it; and the CSS minifier
normalises `0ms` to `0s`, so the reduced-motion assertion had to check the property rather
than the spelling.

---

## 11. What this phase does NOT claim

- **No business screen exists.** Thirteen of the fifteen navigation entries are
  `status: 'planned'` and render as visibly unavailable rather than as links that 404.
- **No PDF generation.** The print foundation is HTML that prints well.
- **No Product Owner visual approval.** The appearance is provisional by construction:
  `[SYSTEM NAME]`, a wordmark placeholder, and a neutral palette.
- **No final logo or palette.** Both remain pending Owner input.
