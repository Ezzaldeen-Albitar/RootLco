# Phase 1-27 — installed-Chrome review of the Owner-acceptance remediation

**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Status:** Evidence · **Recorded:** 2026-08-06

---

## Why the installed browser, and not the bundled one

Playwright ships its own chromium. Running this review in it would have been
worse than not running it, because **the defect the Owner reported cannot exist
there**: bundled chromium in a container draws overlay scrollbars, and Windows
11 draws classic ones. The review would have reported the scrollbar as fine
while the Owner was looking at a grey stripe.

So this review runs `channel: 'chrome'` — the browser installed on the Owner's
machine — and every check **measures** something and prints the measurement.
Nothing here asserts a class name. A `className` assertion is exactly what let
51 unresolvable colour utilities ship for a whole phase.

## What it ran against

|           |                                                                       |
| --------- | --------------------------------------------------------------------- |
| `develop` | `44e053ad1ec2267398ad96dab83693b5cada5d31`                            |
| tree      | `97c77f4cd9c5db3442b3723aa3defff7d39cbf7e`                            |
| Web       | `http://localhost:3100` (Next development server)                     |
| API       | `http://localhost:3000`                                               |
| Browser   | installed Google Chrome on Windows 11                                 |
| Accounts  | Owner administrator (30 permissions) · read-only branch-scoped reader |

## Result

**First pass: 26 passed · 3 not applicable · 0 failed.**
**Second pass (tablet drawer, overscroll, classified console): 18 passed · 0 failed.**

### The password control

| check                      | measurement                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| toggle inside the field    | vertically and horizontally inside the input's own rectangle; **4px** from its inline end            |
| reveal                     | `type` `password` → `text`, accessible name `Show password` → `Hide password`, `aria-pressed` `true` |
| the typed value survives   | 23 characters typed, toggled twice, 23 characters still present                                      |
| the toggle does not submit | still on `/en/login` after two activations                                                           |
| Arabic                     | `dir="rtl"`, control on the **visual left**, still inside the input                                  |

### The sidebar scrollbar

Measured against an unstyled scroll container created on the same page at the
same moment, rather than against an assumed operating-system width.

| viewport          | overflowing | gutter   | operating-system default | thumb at rest            |
| ----------------- | ----------- | -------- | ------------------------ | ------------------------ |
| 1440×900          | no          | —        | 15px                     | `rgba(0, 0, 0, 0)`       |
| 1440×768          | no          | —        | 15px                     | `rgba(0, 0, 0, 0)`       |
| 1440×560          | no          | —        | 15px                     | `rgba(0, 0, 0, 0)`       |
| 1440×420          | **yes**     | **10px** | 15px                     | `rgba(0, 0, 0, 0)`       |
| 1440×420, hovered | yes         | 10px     | 15px                     | **`rgb(137, 166, 200)`** |

Three of the five heights are recorded **not applicable**, not passed: at those
heights the navigation does not overflow, so there is no scrollbar to measure
and a 0px gutter proves nothing. That distinction is the whole lesson of this
phase and it is not going to be blurred in its own evidence.

**It is 10px, not the 6px the stylesheet asks for.** Chrome from 121 onward
implements the standard `scrollbar-width` and ignores an element's
`::-webkit-scrollbar` rules when it is set. The `::-webkit-` block is retained
for Safari and pre-121 Chromium and is labelled as dead code in current Chrome.
What matters is what was measured: a third narrower than the operating system's,
and nothing painted until the region is used.

### The sidebar accordion

| check                          | measurement                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Administration is a disclosure | `BUTTON`, `aria-expanded="false"`, `aria-controls` present                                                      |
| closed height                  | **0px** — was 6px before `M-OA-06b`'s fix, see below                                                            |
| closed group is inert          | `inert` present; six child links out of the tab order                                                           |
| opened height                  | **244px**, six child links, `inert` removed                                                                     |
| chevron                        | `matrix(0, -1, 1, 0, 0, 0)` closed → `none` open                                                                |
| transition                     | `grid-template-rows`                                                                                            |
| keyboard                       | Enter toggles, Space toggles                                                                                    |
| active child                   | on `/en/administration/roles`: parent `aria-expanded="true"`, `data-active="true"`, child `aria-current="page"` |

### The rest

| check                            | measurement                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Add Customer actions             | "Add an individual customer" and "Add a company customer" in the page header, above the fold                |
| primary button fill              | `rgb(31, 107, 82)` — the approved brand green. **Before this remediation it had no fill at all.**           |
| customer duplicate review        | confidence "Strong match"; two business sentences; `<pre>` count 0; no leaked signal name; no merge control |
| vehicle duplicate review         | confidence "Strong match"; two business sentences; no leaked signal name                                    |
| raw translation keys             | none on any route visited                                                                                   |
| 720×450 (≈200% zoom of 1440×900) | document does not scroll, no horizontal overflow                                                            |
| Arabic                           | `dir="rtl"`, `العملاء`, `إضافة عميل فرد`                                                                    |
| console                          | zero errors across every page in the run                                                                    |

### The read-only, branch-scoped operator

| check                | measurement                                                                      |
| -------------------- | -------------------------------------------------------------------------------- |
| signs in             | lands on `/en`                                                                   |
| reads customers      | heading renders, no denial                                                       |
| Add Customer actions | **absent** — the permission rule of the new control, checked in a browser        |
| duplicate queues     | **absent from the sidebar** — each is gated on its own `*.duplicate.review` code |

## What this review found that the automated tiers did not

Three defects, all in the first run, all in about twenty minutes.

1. **A closed navigation group was 6px tall.** One sliver per closed group,
   permanently, on the surface the Owner had just reported for a permanent
   artefact. A box's own padding is never clipped by its own `overflow: hidden`,
   and `min-height: 0` does not change that, so `pt-0.5 pb-1` survived the
   collapse to `0fr`. The CSS reasoning said it should already be zero. The
   measurement disagreed and the measurement was right.
2. **The stylesheet documented a rule the browser discards.** 6px was written
   down; 10px is painted.
3. **The authenticated browser tier could not sign in at all** —
   `getByLabel('Password')` matched two elements once the reveal control gained
   the name "Show password". The anonymous tier had the same defect and it was
   fixed before merge; this one survived because the anonymous tier is what CI
   runs and the authenticated tier is opt-in and local. **Neither tier is a
   superset of the other**, and that is now the second time this repository has
   paid for assuming otherwise.

All three are fixed in `44e053ad`, and the review was re-run against the merged
tree to produce the numbers above.

## Second pass — the tablet drawer, overscroll, and a classified console

The first pass left two of the Owner's §28 items unevidenced. This pass covers
them. **18 passed, 0 failed.**

### The drawer is not at 1024px, and that is worth stating

The probe's first run failed on its own first assertion at 1024×768: the desktop
sidebar was visible and there was no "Open navigation" button to click. That is
correct behaviour, not a defect. Tailwind's `lg` breakpoint is **1024px** and the
sidebar is `lg:flex`, so at exactly 1024 the application is already in its
desktop layout and the drawer does not exist.

The Owner's instruction lists 1024×768 among the viewports to test. At that size
the thing under test is the **desktop sidebar**; a "tablet drawer" check there
would have measured nothing and reported a pass. The drawer's range is strictly
below 1024, so it is measured at **900×700** — the geometry P1-26 measured its
own drawer defect at.

| check                               | measurement                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| desktop sidebar at 900px            | present in the DOM, width **0** — correctly not shown                                                 |
| drawer panel                        | top **0**, bottom **700**, viewport **700** — exactly the viewport                                    |
| every item reachable                | 21 items; last item "Component gallery" bottom **564**, inside the navigation and inside the viewport |
| accordion closed, inside the drawer | `aria-expanded="false"`, height **0**, `inert` present                                                |
| accordion open, inside the drawer   | `aria-expanded="true"`, height **244**, 6 child links, all within the navigation                      |
| focus trap                          | focus on the last control stays inside the panel after Tab                                            |
| Escape                              | panel gone, focus restored to the "Open navigation" trigger                                           |

The P1-26 drawer defect — fifteen links whose last item's bottom was at 798px
against a 700px viewport, so the last modules were unreachable — has not
returned, and the new accordion does not reintroduce it.

### No blank overscroll, at 1024×768

| route                            | document height | viewport | scrolls | horizontal overflow |
| -------------------------------- | --------------- | -------- | ------- | ------------------- |
| `/en`                            | 768             | 768      | no      | no                  |
| `/en/crm/customers`              | 768             | 768      | no      | no                  |
| `/en/crm/customer-duplicates`    | 768             | 768      | no      | no                  |
| `/en/vehicles`                   | 768             | 768      | no      | no                  |
| `/en/vehicles/duplicates`        | 768             | 768      | no      | no                  |
| `/en/administration/permissions` | 768             | 768      | no      | no                  |

`/administration/permissions` is in the list on purpose: it renders seventeen
tables and is the screen that produced 6175px of blank overscroll in P1-26.

### The console, classified rather than counted

24 console messages were seen across the whole run. Classified:

| class                              | count |
| ---------------------------------- | ----- |
| errors and page errors             | **0** |
| Content Security Policy violations | **0** |
| CORS failures                      | **0** |
| hydration mismatches               | **0** |
| failed network requests            | **0** |

"No console errors" is a weaker claim than it sounds — a CSP violation, a CORS
refusal and a hydration mismatch do not all surface as `console.error`. Each is
matched for by name.

## Screenshots

`.local/owner-review-shots/` — git-ignored, on the Owner's machine:

`01-login-en-password-revealed` · `02-login-ar-password` · `03-overview` ·
`03b-sidebar-900px` · `03b-sidebar-768px` · `03b-sidebar-560px` ·
`03b-sidebar-420px` · `04-sidebar-administration-open` · `05-customer-search` ·
`06-customer-duplicates` · `07-vehicle-duplicates` · `08-zoom-720x450` ·
`09-tablet-1024` · `10-customers-ar` · `11-reader-customers` ·
`12-tablet-drawer-accordion`

The probes that produced them are `.local/owner-review-chrome.mjs` and
`.local/owner-review-tablet-drawer.mjs`, also git-ignored — they read the local
acceptance credentials, which never enter the repository.

## What this review is not

It is not Owner acceptance. It is one engineer measuring the things the Owner
named, in the browser the Owner uses, so the next manual test starts from a
known state rather than from a claim.

**P1-27 closes only when the Product Owner manually tests the application and
returns `OWNER ACCEPTANCE: PASS`. Silence is not Pass.**
