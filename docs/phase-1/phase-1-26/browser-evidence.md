# Phase 1-26 — browser evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

Measured against a **real production build** in a real browser. `next dev` is not
evidence: it masks the whole class of failure that only appears in a production
build, and this phase hit one of those (`P1-26-F-013`).

---

## 1. The matrix

Five Playwright projects, run twice — once on the pinned Playwright chromium and
once on the machine's **installed Google Chrome** (`ROOTLCO_E2E_CHANNEL=chrome`).

| Project          | Viewport   | Locale  | Direction                     |
| ---------------- | ---------- | ------- | ----------------------------- |
| `desktop-en`     | 1440 × 900 | English | LTR                           |
| `desktop-ar`     | 1440 × 900 | Arabic  | RTL                           |
| `laptop-en`      | 1280 × 800 | English | LTR                           |
| `tablet-ar`      | 1024 × 768 | Arabic  | RTL                           |
| `reduced-motion` | 1280 × 800 | English | LTR, `prefers-reduced-motion` |

| Run                        | Result                                |
| -------------------------- | ------------------------------------- |
| Pinned Playwright chromium | **106 passed · 0 failed · 4 skipped** |
| Installed Google Chrome    | **106 passed · 0 failed · 4 skipped** |

**The 4 skips are one project-scoped test**, not a suppression: the reduced-motion
assertion declines the four projects it does not apply to and runs — and passes —
in `reduced-motion`. No required executable test is skipped.

The two runs agreeing matters: CI runs the pinned chromium so the hosted result
does not drift with the runner image's Chrome version, and the Owner acceptance
run uses the real installed browser. A difference between them would be a
finding.

## 2. What each run asserts

**Console cleanliness.** Every navigation test collects `console` errors and
`pageerror` events and asserts the list is empty. A hydration mismatch appears as
a console error and nothing else — the page looks correct while React has
silently thrown away the server tree — so an empty-console assertion is the only
way a test sees it.

**Direction, decided by the server.** `<html lang>` and `<html dir>` are asserted
on both locales. They are set in the layout, so the document arrives correct
rather than being corrected after hydration.

**No protected-content flash.** `/en/administration/users` with no session
redirects to `/en/login?reason=signed-out`, and the shell's navigation landmark
is asserted **absent**. If protected markup had reached the browser before the
redirect, that landmark would be there.

**The credential pages render.** `/en/reset-password` with no token shows its
no-token state and **no password field**. This is the assertion that failed
across all five projects when the bridge took a render prop, and it is what
guards the fix.

**Keyboard reach.** Tab lands on the skip link first; Enter moves focus to
`#main` — not just the scroll position, which is what happens without
`tabIndex={-1}` and leaves the next Tab back in the navigation.

**No horizontal scroll**, asserted on sign-in and on the shell at every project's
width.

**Permission filtering is live.** The gallery renders the shell with **no**
capabilities, so the test asserts that `Users` — a screen that now exists — is
still absent. An entry visible to an actor holding nothing would mean the filter
had stopped working.

## 3. What the browser suite does NOT cover, and why

**The eleven administration screens are not exercised in a browser.** They require
an authenticated session; obtaining one requires a real account in a real tenant;
and the no-fake-data policy forbids seeding one.

What that means precisely:

- Their **markup, direction, focus behaviour and accessible names** come from the
  P1-25 primitives, which are exercised in the browser through the gallery.
- Their **logic** — permission gating, cursor pagination, coercion, action-result
  mapping, catalogue drift — is covered by the unit suites.
- Their **integration** — the composed screen against a live API — is **not**
  browser-verified in this phase.

This is a real gap. It is not closed by asserting harder somewhere else, and it
is recorded in `known-limitations.md` rather than being described as covered.

Closing it needs one of: a seeded test tenant (a policy decision, currently
forbidden), or a mocked-adapter render of each screen (which proves markup, not
integration). Neither was in P1-26's authority to decide.

## 4. Visible-browser review

The Owner acceptance run above **is** the installed-Chrome run: same browser
binary, same production build, same five viewport and locale combinations,
executed headed-equivalent through Playwright's Chrome channel with an isolated
automation profile. No personal Chrome profile, history, cookie jar or saved
credential was read or used.
