# Phase 1-26 — authenticated browser evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

The gap P1-26's own final report named: _"the eleven administration screens in a
browser"_ — not proven, because reaching them needed an account that did not
exist. It exists now, and this is what it showed.

---

## 1. How the suite is gated

`apps/web/tests/e2e/authenticated/` runs only when `ROOTLCO_E2E_AUTH=1`. It needs
a running Supabase, a running API and a real password — none of which a hosted
runner is given.

The five anonymous projects therefore carry `testIgnore: /authenticated[\\/]/`.
Without it Playwright's `testDir` sweep would hand every authenticated spec to
five projects with no credentials, and CI would go red on a capability that only
exists on the Owner's machine.

**Proven, not assumed:** with the flag unset, `playwright test --list` reports
**110 tests in 1 file** — identical to before this remediation.

## 2. Authentication happens for real

`auth.setup.ts` drives the actual sign-in form rather than constructing a
cookie. That proves the form, the Server Action, the API contract, the cookie
attributes and the post-login redirect all agree; a hand-built cookie would
prove only that the test can build a cookie.

It then asserts the session cookie itself:

| Attribute  | Asserted                      |
| ---------- | ----------------------------- |
| `httpOnly` | **true**                      |
| `sameSite` | **Lax**                       |
| `secure`   | **false** on plain-HTTP local |

The failure message names the trap: `NEXT_PUBLIC_APP_ENV` is inlined at build
time and defaults to `production`, so a build made without `apps/web/.env.local`
marks the cookie `Secure`, which plain-HTTP localhost silently discards — and
the symptom is an endless redirect back to sign-in that reads as an application
bug.

## 3. Result

Measured on the tree that ships, with the authenticated projects run on their
own so the figure is about them and nothing else.

| Run                                                                                 | Result                               |
| ----------------------------------------------------------------------------------- | ------------------------------------ |
| Authenticated tier — `authenticated-en`, `authenticated-ar`, `authenticated-tablet` | **97 passed · 0 failed · 0 skipped** |
| Anonymous suite, flag unset                                                         | **110 tests in 1 file** — unchanged  |

Nothing is skipped. The four skips the earlier figure carried were the dialog
case declining on projects whose screen exposes no dialog opener for this
permission set; with the acceptance account's fourteen permissions the opener is
present everywhere and every test executes.

### An earlier figure in this document was measured on a different suite

It read **197 passed · 0 failed · 4 skipped** and was presented alongside the
rows-actually-load assertions described in §4. Re-reading that run's log settles
it: `administration.spec.ts:84` was the browser-storage test there, so **the rows
assertions did not exist yet**. That run was 110 anonymous plus 91 authenticated;
the authenticated tier is **97** tests now, the six added being the two rows
assertions across three projects.

The figure was true of the suite that produced it and untrue of the suite this
document describes, and the two were one commit apart. `P1-26-F-052` records it,
together with the assertion defect the re-measurement exposed.

**A test count is evidence about the suite that produced it, not about the file
it is written next to.**

## 4. Coverage

Projects: `authenticated-en` and `authenticated-ar` at 1440×900, and
`authenticated-tablet` at 1024×768.

Every one of the eleven screens is asserted to:

- load with a status below 400;
- **not** redirect to sign-in;
- render the shell landmark and `main`;
- render **no** permission-denied state;
- produce **no** console error and no page error.

Plus, across the screens:

| Assertion                                                           | Why it is here                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The users table **finishes loading and shows the operators**        | The assertion this file was missing. Every other case proves a screen _renders_; none proved it renders _data_. A table stuck loading satisfies "route loads", "no console error", "no denial" and "no overflow" at once, and looks completely broken to the person accepting the phase. It is what caught `P1-26-F-048` |
| The roles table finishes loading                                    | The same, for a second screen, so the first is not a one-off                                                                                                                                                                                                                                                             |
| Nothing credential-shaped in `localStorage` or `sessionStorage`     | The rule the gate enforces statically, checked at runtime                                                                                                                                                                                                                                                                |
| `document.cookie` does not expose `rootlco.session`                 | What `httpOnly` is for, asserted against a real session                                                                                                                                                                                                                                                                  |
| No `token=`, `password=`, `secret=` in any URL                      | Credentials must not reach history, proxy logs or `Referer`                                                                                                                                                                                                                                                              |
| No horizontal overflow at 1440 / 1280 / 1024                        | An RTL or narrow-viewport defect is invisible at one width                                                                                                                                                                                                                                                               |
| The brand assets render, are unbroken, and declare width and height | A broken image and a reflowing header are both Owner-visible                                                                                                                                                                                                                                                             |

## 5. What this found

Two defects that had shipped, and one that made the whole local application
unusable:

- **`P1-26-F-046`** — no page had a `<title>`, on any route, in either language.
- **`P1-26-F-047`** — malformed definition lists on the profile and languages
  screens.
- **`P1-26-F-048`** — no client component ever ran locally, so every
  server-driven table sat empty for ever.

All three are recorded in `findings.md` with their fixes and regression
coverage.

## 6. What this still does not prove

The suite exercises the screens against a **local** stack with **synthetic**
data. It does not prove behaviour against production data volumes, a remote
network, or a browser other than Chromium and Google Chrome. Nothing here is
evidence about performance under load, and no claim is made about one.
