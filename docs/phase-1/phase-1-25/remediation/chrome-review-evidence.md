# P1-25 remediation — installed-Chrome review evidence

The final browser verification ran in the **machine-installed Google Chrome**, not only
in Playwright's bundled chromium. Two complementary passes:

## 1. Automated: Playwright on the `chrome` channel

`ROOTLCO_E2E_CHANNEL=chrome npx playwright test` runs the full five-project matrix
(desktop-en 1440×900, desktop-ar 1440×900, laptop-en 1280×800, tablet-ar 1024×768,
reduced-motion) against a production build in the installed Chrome.

|                   |                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Chrome executable | `C:\Program Files\Google\Chrome\Application\chrome.exe`                                                                         |
| Chrome version    | 151.0.7922.71                                                                                                                   |
| Result            | **81 passed, 0 failed** (4 project-scoping skips: one reduced-motion-only test excluded by design from the other four projects) |

The channel is env-selected so hosted CI keeps the pinned Playwright chromium — a hosted
result must not drift with the runner image's Chrome version — while the owner
acceptance run uses the real browser. **The distinction earned its keep immediately:**
the first chrome-channel run failed 5/81 on a `/favicon.ico` 404 that chromium never
surfaces, because only real Chrome probes for an undeclared favicon.

## 2. Visible: the owner's normal Chrome window

Opened via `Start-Process` with the detected executable and **left open** on:

- `http://127.0.0.1:3100/en` — LTR shell, sidebar, breadcrumbs, provisional-brand notice
- `http://127.0.0.1:3100/ar` — full RTL: التخطيط، القائمة الجانبية، مسار التنقّل، كلها من اليمين إلى اليسار
- `http://127.0.0.1:3100/en/gallery` and `/ar/gallery` — every shared component, both
  directions, and the **API connection** panel reading "The API is reachable and ready."

No personal Chrome profile data was read, copied or used; the window is the owner's
normal browser opened at localhost URLs.

## Runtime checks against the live dev stack

- Console: **0 errors** on a fresh tab across `/en`, `/ar`, `/en/gallery` (after the two
  fixes recorded in [local-runtime-evidence.md](local-runtime-evidence.md)).
- Network: no failed request; `/favicon.svg` 200; API readiness reached from the server
  render only (no cross-origin browser call, hence no CORS surface).
- CSP: per-request nonce present and enforced; the dev-only `'unsafe-eval'` concession
  verified absent from the default policy by `tests/security.test.ts` (17/17).
- Direction: `<html lang dir>` server-rendered per locale — no direction flash.
- No hydration warning, no redirect loop, no 404 on any required route, no reference to
  the retired `apps/web/app/` path anywhere in the served output.

Screenshot capture stayed in an ignored temporary folder; no browser report, trace or
video is tracked (the topology gate forbids it).
