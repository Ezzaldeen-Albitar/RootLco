# Phase 1-26 — accessibility evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

Everything here is inherited from P1-25 and used correctly, or added by P1-26 and
tested. Nothing is claimed that a component does not do.

---

## 1. What P1-26 inherited and did not re-invent

Every accessible property below belongs to a P1-25 primitive that P1-26
**composes**. That is the point of the foundation: a screen cannot get these
wrong without deliberately avoiding the shared component.

| Property                                                                                    | Owned by                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Label wired to control (`htmlFor`, `aria-describedby`, `aria-invalid`, `aria-errormessage`) | `FieldFrame`                              |
| Error announced on submit (`role="alert"`)                                                  | `FieldFrame`, `FormFeedback`              |
| Focus moved into an overlay, trapped, and returned to the trigger                           | `useDialogBehaviour`                      |
| Cancel focused on a destructive confirmation                                                | `ConfirmDialog`                           |
| `aria-sort` on a sortable header, and a button name that says what pressing it will DO      | `DataTable`                               |
| Pagination range announced (`aria-live="polite"`)                                           | `DataTable`                               |
| One persistent toast live region                                                            | `ToastRegion`                             |
| Skip link, and `#main` focusable with `tabIndex={-1}`                                       | `[locale]/layout.tsx`, both group layouts |
| Logical direction throughout (`start`/`end`, `ms`/`me`, `ps`/`pe`)                          | the token and utility layer               |
| Every transition duration collapsed to zero under `prefers-reduced-motion`                  | `styles/tokens/_index.scss`               |

## 2. What P1-26 added, and how each is announced

**`FormFeedback`** — the one banner every form uses. `role="status"` for a
success, `role="alert"` for a failure: a polite confirmation and an assertive
correction, and both are wrong the other way round.

It is **keyed on the attempt number**. React reconciles by position, so
submitting the same wrong password twice renders an identical node and the second
failure is announced to nobody. The key forces a fresh node, so every submission
is reported.

**`SubmitButton`** — `disabled` while the action is in flight (the double-submit
guard), plus `aria-disabled` and `aria-busy` so a screen-reader user is told why
the control stopped responding rather than finding it silently gone.

**`AccountMenu`** — a disclosure, not a modal. It closes on Escape and on an
outside click and **returns focus to its trigger**. It deliberately does not trap
focus: a header menu that traps is a modal that forgot to say so.

**Status and risk pills** — every one carries **text**, not colour alone. An
unrecognised risk level renders verbatim rather than being mapped to a
reassuring default.

**The cursor pager** — when the server publishes no count, First and Last are
**absent, not disabled**. A disabled Last implies a last page the interface could
reach if only the button worked.

## 3. Headings

Exactly one `<h1>` per page, from `PageHeader` or `AuthCard`. Panels are `<h2>`,
permission domains `<h3>`. The decorative navy panel on the authentication screens
is `aria-hidden`, so it does not introduce a second contentless heading before
the form the visitor came for.

## 4. Direction

Arabic is RTL and English LTR, decided by the **server** in
`[locale]/layout.tsx` — the document arrives correct rather than being corrected
after hydration.

No physical CSS direction appears in any P1-26 component. Chevrons and page
glyphs that must mirror carry `rtl:-scale-x-100`; their accessible names are
words, not glyphs, because "«" is announced as "left-pointing double angle
quotation mark" and that is both wrong and direction-dependent.

## 5. Measured

| Check                                           | Result                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `axe` on rendered components                    | 0 violations (`gallery-and-print.dom.test.tsx`, both directions) |
| Browser matrix, five projects                   | see `browser-evidence.md`                                        |
| Keyboard-only reach of the sign-in form         | asserted — skip link first, then every control                   |
| Focus moves to `#main` on skip                  | asserted in both route groups                                    |
| No horizontal scroll at any reviewed width      | asserted on sign-in and on the shell                             |
| Reduced motion collapses every duration to `0s` | asserted in the `reduced-motion` project                         |

## 6. What is not claimed

**No automated accessibility scan was run against the eleven administration
screens in a browser.** They require an authenticated session, and the
no-fake-data policy forbids seeding an account to obtain one. Their accessible
properties come from the P1-25 primitives, which **are** scanned — but that is
inheritance, not measurement of the composed screen.

This is a real gap and it is named rather than papered over. Closing it needs
either a seeded test tenant, which is a policy decision, or a component-level
render of each screen with mocked adapters, which proves the markup but not the
integration. Recorded in `known-limitations.md`.
