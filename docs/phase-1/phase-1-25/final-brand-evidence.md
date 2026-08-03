# P1-25 — final brand evidence

The Owner supplied the working product name and the colour anchors, resolving OIR-01 and
OIR-06. This records what was applied, how it was derived, and how it was proved.

## Owner inputs received

| Input           | Value                                                                            |
| --------------- | -------------------------------------------------------------------------------- |
| Product name    | **CRM** — temporarily approved working name                                      |
| Primary green   | **#1F6B52**                                                                      |
| Primary navy    | **#0F2742**                                                                      |
| Neutrals        | **#FFFFFF**, **#000000**                                                         |
| Direction       | soft, elegant, premium, modern, user-friendly, rich in tools but never cluttered |
| Prototype basis | the approved P1-25 design system itself; no separate package                     |

RootLco remains the **company** (Root Link Company), never the product. Benzene remains a
configurable pilot tenant and appears nowhere as a product identity.

## The name is one field, deliberately

"CRM" is a working name and is expected to change. That is precisely why it lives in two
configuration values and nowhere else:

| Authority                              | Field                           |
| -------------------------------------- | ------------------------------- |
| `apps/web/src/config/brand.ts`         | `systemName`, `systemShortName` |
| `apps/api/src/shared/constants/app.ts` | `PRODUCT_NAME_PLACEHOLDER`      |

`scripts/ci/check-product-name-authority.mjs` enforces that these two are **always the
same string**, and that no third site in runtime source names the product. A rename that
updates one tier and forgets the other fails the build rather than shipping two
identities — which is the failure this gate was written for before the name existed.

The gate reads **"2 authorities, both decided"** at this SHA.

## The palette is derived, and the derivation is checkable

Every value comes from the four anchors. The green anchor is `$primary: 500` and the navy
anchor is `$navy: 900`, so both appear **verbatim** in the ramps rather than as something
close to them. No fifth brand colour was introduced.

| Ramp                         | Role                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `$primary` (green)           | actions, links, focus, active state, table row wash                                   |
| `$navy`                      | the sidebar, headings, depth, informational states                                    |
| `$neutral`                   | surfaces, borders, text — tinted with the navy hue so nothing reads as a foreign grey |
| `$success`                   | a brighter, more open emerald than the brand green, on purpose                        |
| `$warning` `$danger` `$info` | muted to sit beside the anchors; `$info` shares the navy hue                          |

### The steps are spaced by job, not evenly

Neutral 300 is a soft divider, **400 bounds a control**, **500 is muted text**, 600 is
secondary text, 900 is primary text. Each sits where it does because it has a contrast
obligation; an evenly-spaced ramp meets some of them only by luck.

The first derivation proved that: `text-muted` came out at **4.09:1** — a fail — and the
control boundary was set against an arbitrary 1.4 threshold that has no basis. WCAG 1.4.11
requires **3:1** for a boundary that identifies a control. Both were corrected by moving
the steps, not by lowering the bar.

### Contrast proof — 21 pairs, all passing WCAG AA

| Pair                                        | Ratio                     | Min |
| ------------------------------------------- | ------------------------- | --- |
| text-primary on surface                     | 16.24:1                   | 4.5 |
| text-secondary on surface                   | 6.90:1                    | 4.5 |
| text-muted on surface                       | 5.11:1                    | 4.5 |
| text on surface-subtle                      | 14.86:1                   | 4.5 |
| on-primary on primary                       | 6.40:1                    | 4.5 |
| primary on surface (link)                   | 6.40:1                    | 4.5 |
| primary-hover on surface                    | 8.11:1                    | 4.5 |
| sidebar text on sidebar                     | 13.83:1                   | 4.5 |
| sidebar muted on sidebar                    | 6.01:1                    | 4.5 |
| sidebar active on sidebar                   | 8.66:1                    | 4.5 |
| border-strong on surface                    | 3.35:1                    | 3.0 |
| border-strong on surface-subtle             | 3.06:1                    | 3.0 |
| focus-ring on surface                       | 6.40:1                    | 3.0 |
| success / warning / error / info on surface | 6.08 / 6.51 / 7.53 / 8.08 | 4.5 |
| text on success / warning / error subtle    | 7.86 / 6.12 / 8.97        | 4.5 |
| table header text                           | 9.47:1                    | 4.5 |

## Applied result, measured in the running application

Read from the live page rather than asserted:

```json
{
  "theme": "approved",
  "primary": "#1f6b52",
  "sidebarBg": "#0f2742",
  "sidebarText": "#f3f5f7",
  "textHeading": "#0f2742",
  "borderStrong": "#808e9d",
  "computedSidebarBackground": "rgb(15, 39, 66)"
}
```

`rgb(15, 39, 66)` is #0F2742 — the anchor is not merely configured, it is painting.

Also verified live: `data-theme="approved"` on both locales, `CRM` rendered as the brand
mark, `data-provisional` **absent**, the provisional pill **not rendered**, no placeholder
string in the served markup, Arabic still `dir="rtl"`, and **zero console errors**.

## Design decisions worth recording

**The sidebar is navy.** It is the one large surface carrying the brand's depth, and it
makes the white content area read as bright and calm by contrast. That is what "clean,
comfortable, premium" needs structurally, not just decoratively — and it puts both anchors
to work rather than leaving navy as an accent nobody sees.

**Green never competes with navy for attention.** Navy grounds; green acts. The active
sidebar entry is the one place the action colour appears on the dark surface, so it reads
as "you are here" rather than as decoration.

**Success is not the brand green.** A green "Save" button and a green success badge must
not read as the same thing, so success is a brighter, more open emerald.

**The theme is a sibling, not a rename.** `themes/_approved.scss` sits beside
`_provisional.scss` — which said an approved identity "can later be added as a sibling
file without touching a single component". Keeping both makes that claim demonstrable
rather than historical, and a third theme (a tenant brand, a dark mode) is added the same
way.

## Future replacement

Unchanged and now proven with real values: the brand lives in `config/brand.ts`,
`tokens/_colors.scss`, the theme layer, and `public/`. `apps/web/tests/brand-replacement.test.ts`
performs the swap and asserts **no component or route file changes**, then restores. Its
fixtures now swap _from_ CRM and the green anchor — the guard that the swap really applied
is what caught the stale fixtures when the brand changed.

## Findings from this cycle

Recorded in [brand-mechanism-findings.md](brand-mechanism-findings.md): `P1-25-F-026`
(the provisional notice ignored brand state — fixed before the brand was applied, or the
approved identity would have shipped alongside a "final brand pending" banner),
`P1-25-F-027` (the brand gate could not see the `.json` catalogues), `P1-25-F-028`
(`dev:stop` reported success without stopping).
