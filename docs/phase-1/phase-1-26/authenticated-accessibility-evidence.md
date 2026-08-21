# Phase 1-26 — authenticated accessibility evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

P1-26's final report recorded that no automated accessibility scan had ever run
against the authenticated screens. This is that scan, and what it found.

---

## 1. Toolchain

`axe-core@4.12.1`, already a dependency of `apps/web` and previously used only by
four jsdom component-level checks. **No new package was added.**

Rulesets: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` — the level the phase's
accessibility evidence claims.

## 2. Why the injection method matters

The bundle is injected with `page.addInitScript`, never `page.addScriptTag`.

`addScriptTag` creates a real `<script>` element, which the per-request nonce CSP
served by `src/proxy.ts` refuses. `window.axe` would then be undefined, and a
defensively written scan would report **zero violations over nothing** — a
vacuous pass on an accessibility gate, which is precisely the failure class this
repository has been burned by before.

`addInitScript` is delivered over the debugging protocol before any document
script runs and is not subject to the page CSP. A separate assertion — _"axe was
not injected"_ — runs before every scan, so a CSP block becomes a named failure
instead of a clean report.

## 3. Scope

Fourteen routes, in **both** locales:

```
/administration                      /administration/taxes
/administration/organization         /administration/currencies
/administration/users                /administration/languages
/administration/roles                /administration/audit-log
/administration/permissions          /administration/system-settings
/administration/approval-limits      /profile
/administration/numbering-rules      /            (the dashboard)
```

Plus an open dialog, and a keyboard check that the skip link is the first thing
Tab reaches.

## 4. Result

|                         |                                               |
| ----------------------- | --------------------------------------------- |
| Routes scanned          | **14**, twice (English and Arabic) = 28 scans |
| **Critical violations** | **0**                                         |
| **Serious violations**  | **0**                                         |
| Moderate / minor        | reported as annotations, none outstanding     |

Moderate and minor findings are recorded as test annotations rather than
failures, so they stay visible and dispositioned instead of either silently
tolerated or noisily blocking.

## 5. What it found — two real defects

Both were **serious**, both had shipped, and both are fixed.

### `P1-26-F-046` — `document-title`, all fourteen routes

The application had **no `<title>` element at all**, on any route, in either
language. WCAG 2.4.2 (Page Titled, Level A).

It survived the entire phase because nothing had scanned a rendered document:
the jsdom tier renders components, not documents, and the browser suite asserted
on landmarks. A missing title is invisible in both, and unmissable to anyone
using a screen reader or holding two tabs open.

Fixed by a localised default and a `%s — CRM` template in the locale layout,
with each of nineteen routes contributing its own name through the **same
message key its visible header already uses** — so the tab and the heading
cannot disagree.

### `P1-26-F-047` — `definition-list`, profile and languages

The `Fact` and `Definition` helpers placed the hint `<p>` as a **sibling** of the
`<dt>`/`<dd>` pair inside the `<dl>`'s wrapper `<div>`. A `<dl>` may contain only
`<dt>`/`<dd>` groups and `<div>` wrappers, and a wrapper may hold only the group.

Fixed by moving the hint inside the `<dd>`, which is also where it belongs: it
describes the value, so it should be read with the value rather than after it.

## 6. Keyboard verification

| Check                                              | Result             |
| -------------------------------------------------- | ------------------ |
| Skip link is the first Tab stop, authenticated     | pass, both locales |
| Dialog is reachable, traps focus, closes on Escape | pass               |
| Open dialog is free of critical/serious violations | pass               |

## 7. What this does not cover

An automated scan is a floor, not a ceiling. axe cannot judge whether a label
reads sensibly, whether an error message is actionable, or whether a reading
order makes sense to a person — and no claim is made that it can. Manual
screen-reader verification by a person using one remains outside what this
phase measured, and is stated here as absent rather than implied as done.
