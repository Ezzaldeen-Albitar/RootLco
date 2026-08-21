# ADR-021: Application Scroll Ownership and Notification Authority

## Status

**Accepted** — 2026-08-04, during the P1-26 Owner-acceptance shared-UX remediation.

Every Frontend phase from P1-27 onward inherits these two contracts. They are
recorded as an ADR rather than as phase notes because they are not P1-26
decisions: they are the shape of every screen the product will ever have, and a
later phase that re-litigates them will do so by accident.

## Context

The Product Owner reported that scrolling past the end of a page continued into
a blank region, that notifications could not be seen from wherever the operator
happened to be, and that there was no way to change language without editing the
URL. Measured in real Chrome across 28 route × viewport combinations before any
fix:

| defect                            | count |
| --------------------------------- | ----- |
| routes where the document scrolls | 5     |
| routes with blank overscroll      | 5     |
| routes with a language control    | 0     |
| routes with a notification region | 0     |

`/en/administration/permissions` at a 900px viewport reported
`documentElement.scrollHeight = 7075` against `clientHeight = 900`, and the
document really moved: setting `scrollTop` reached **6175px**.

### The cause was not what it looked like

The obvious reading is "something is too tall". It was not. `html`, `body` and
the application shell were all exactly 900px, and the shell was already
`overflow: hidden`.

The cause was **`.sr-only`**. The visually-hidden pattern uses
`position: absolute`, and `main` was `position: static` — so every screen-reader
caption resolved its containing block to the **initial containing block**, i.e.
the viewport, and was laid out at document coordinates. The permissions screen
renders seventeen tables; the deepest caption landed at y≈7200. Six thousand
pixels of blank space, produced entirely by 1px of accessibility text.

Established by bisection against the live page, each on a fresh load:

| mutation                                | result                                 |
| --------------------------------------- | -------------------------------------- |
| `html { height:100%; overflow:hidden }` | no effect — still 6175px               |
| `body { height:100%; overflow:hidden }` | no effect                              |
| both                                    | no effect                              |
| `main { position: relative }`           | **fixed**, main still scrolls 7136/836 |
| `main { contain: paint }`               | fixed                                  |
| `shell { position: relative }`          | fixed                                  |

The two declarations everyone reaches for first are **inert against this
defect**. That is the single most useful fact in this document.

## Decision 1 — scroll ownership

**Every element that is a scroll container must also be a containing block.**

An element with `overflow` other than `visible` clips descendants **in flow**. It
does not clip an absolutely positioned descendant whose containing block resolved
past it. A scroll container that is `position: static` is therefore a container
that clips most things and silently leaks the rest into the document.

The instrument is **`position: relative`**, and the alternatives are rejected for
concrete reasons:

- **`contain: paint`** also establishes a containing block for `position: fixed`
  descendants. Every `Dialog` and `Drawer` is `fixed inset-0`, rendered inline
  from screens that live inside `main`. Paint containment would resolve
  `inset-0` to main's padding box: backdrops no longer covering the sidebar,
  dialogs clipped by the scrollport.
- **`isolation: isolate`** creates a stacking context but **not** a containing
  block, so it would not fix the defect at all — and it would flatten the
  dropdown, dialog and toast layers underneath the header.
- **`position: relative` with `z-index: auto` creates no stacking context**, so
  nothing that must escape is trapped, and `position: sticky` table headers keep
  sticking to the same scrollport.

The regions, and who owns what:

| element                | rule                                                                  |
| ---------------------- | --------------------------------------------------------------------- |
| `html`, `body`         | `height: 100%`                                                        |
| `body.app-viewport`    | `overflow: hidden` — **scoped to the locale layout only**             |
| shell root             | `relative h-dvh overflow-hidden`                                      |
| sidebar nav            | `relative min-h-0 flex-1 overflow-y-auto overscroll-contain`          |
| main                   | `relative min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain` |
| secondary panel        | `relative overflow-y-auto overscroll-contain`                         |
| table region           | `flex-initial min-h-0 max-h-[70dvh] overflow-auto`, focusable         |
| `[data-scroll-region]` | `scrollbar-gutter: stable`                                            |

`h-dvh`, never `min-h-dvh`. A floor lets the document grow; only a cap prevents
it.

**The body lock is scoped deliberately.** Per CSS Overflow §3.3 a `body` overflow
value is propagated to the viewport while `html` computes to `visible`, and
`body` itself then computes to `visible` — it clips nothing and only removes the
scroll gesture. Applied globally it would also reach routes outside `[locale]`,
which have no shell and no inner scroller, and their content would become
**unreachable** rather than scrollable. A class on the one `<body>` that belongs
to a route group owning a scroll region is the correct scope.

### The authentication exception

Sign-in owns exactly **one** scroll region — the form column — because a short
viewport or an open software keyboard must never clip the form. The decorative
panel is `overflow-hidden` and never scrolls, so two nested vertical scrollers
can never compete for one gesture.

### The debt this decision incurs, and how it is repaid

Browsers persist and restore `window.scrollY` across history entries. They do
**not** restore a `<div>`'s `scrollTop`. Moving the scroll into `main` therefore
loses browser scroll restoration on Back and Forward — measured, not assumed:
scroll to 1500, follow a link, press Back, land at 0.

`useScrollRestoration` repays it (`P1-26-F-076`). Three properties of that hook
are load-bearing and none of them is obvious:

- **The history key is recomputed on every record.** A forward navigation is a
  `pushState` and fires no event, so a key cached at mount still names the entry
  the operator came _from_.
- **The restore window is time-bounded, not frame-bounded.** At `popstate` the
  router has changed the URL but not painted the content, so `scrollTop` is
  clamped to a shorter element and silently becomes 0.
- **It holds positions in module memory, never in browser storage.** The P1-26
  frontend gate refuses browser storage, correctly; and because the hook restores
  only on `popstate` — same-document traversal — a durable store could never have
  been read on the path where it would have mattered.

A future scroll region that opts into `[data-scroll-region]` does **not** get
restoration for free; it must call the hook.

## Decision 2 — one notification authority

**One store, one host, mounted once, above every route group, outside the shell.**

- The store is module-level and read through `useSyncExternalStore`. A Server
  Action result, a helper's fetch failure and a click handler all need to raise a
  notification, and only one of those is inside a component tree.
- The host mounts in `app/[locale]/layout.tsx` as a direct child of `<body>`. The
  shell is `overflow: hidden`, so a toast rendered inside it would be clipped;
  and because Decision 1 chose `position: relative` over `contain: paint`, no
  ancestor creates a containing block for `position: fixed`.
- **No portal.** A portal exists to escape an ancestor. This component has no
  ancestor to escape.
- Placement is `fixed top-4 end-4` — top-right in English, top-left in Arabic,
  from one logical declaration. Top rather than bottom because the bottom of a
  bounded table region is where pagination lives, and a toast that covers the
  control the operator is reaching for is worse than no toast.
- **Two politeness levels inside one region.** Errors are `assertive`, everything
  else `polite`. A failure announced politely queues behind whatever is already
  speaking, and the operator acts on stale information in the gap. Two live
  children of one labelled region is correct politeness; two hosts would be two
  authorities.
- **Errors do not auto-dismiss.** They are the only notification carrying a
  correlation ID, and the region is last in the document — so reaching the
  dismiss control by keyboard means tabbing past the whole page. A timed error is
  unreachable by exactly the people who cannot reach for a mouse. The stack is
  bounded at four instead.

`scripts/ci/check-notification-authority.mjs` enforces the count. The gallery
previously kept its own list and its own region beside the real one, which is
what the gate now makes impossible.

### Toast, inline, page, or dialog

| use                                                          | surface                  |
| ------------------------------------------------------------ | ------------------------ |
| saved, sent, failed, unavailable, retried, copied            | global toast             |
| invalid email, required value, a bad number                  | inline, beside the field |
| the whole screen failed, subscription expired, access denied | page state               |
| delete, suspend, reactivate, reset sensitive configuration   | blocking dialog          |

A modal for every successful save is not on this list, and neither is SweetAlert2.

## Consequences

- Any new scroll container must declare `position: relative` (or an equivalent
  containing block) or it will leak absolutely positioned descendants into the
  document. The rule is asserted by test, with each token proved load-bearing by
  removing it from a copy of its own source.
- A new route group must own a scroll region or must not carry `app-viewport`.
- The print stylesheet must undo all of it: `height: auto; overflow: visible` on
  `html`, `body`, `main` and every `[data-scroll-region]`, or a printed screen
  emits one viewport and drops the rest.
- A bounded, scrollable region needs `tabindex="0"` and a name, or it cannot be
  scrolled by keyboard. This surfaced as a serious axe violation the moment the
  table region became genuinely bounded.

## Alternatives rejected

**Leave the document scrolling and make the sidebar `sticky`.** Treats the
symptom. The blank region would remain, and every future absolutely positioned
descendant would extend it again.

**`contain: paint` on the shell.** Fixes the measured defect and breaks every
modal. See Decision 1.

**A negative margin to hide the blank region.** Hides the evidence and leaves the
mechanism in place.

**A toast library.** The application already had a `ToastRegion` primitive with
the correct semantics and no authority around it. What was missing was a store
and a mount, not a dependency.
