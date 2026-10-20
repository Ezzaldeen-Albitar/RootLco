/**
 * The mark a person's change leaves on a branch select before React has
 * hydrated it (P1-32-PRE-OD-UXQ, F-1).
 *
 * ## Why a mark
 *
 * A branch select in the server's HTML can hold a value it was not drawn with
 * by the time React hydrates it, for two reasons that look the same from the
 * select: a person chose it, or the browser put an earlier value back when it
 * re-opened the document from its history. Only the first is a choice.
 *
 * Neither `autocomplete="off"` nor the navigation type tells them apart. In
 * the browser-restore experiment of 2026-10-20 (Playwright 1.62.1; Chromium
 * 151, Firefox 153, WebKit 26.5, plain static pages), WebKit put the earlier
 * value back into a select marked `autocomplete="off"` on every Back/Forward
 * arrival that loaded a new document, already visible at
 * `readyState === 'interactive'`; Chromium and Firefox put it back into
 * unmarked selects (Firefox on a reload too). What separated the two cases in
 * every build tested: **no browser fired an `input` or `change` event while
 * putting a value back**, and a person's choice always fires both.
 *
 * So a person's choice is recognised by its event. `EARLY_CHOICE_SCRIPT` is
 * rendered inline, with the request's CSP nonce, as the first element of the
 * document body — before any select is parsed, so before anyone can use one.
 * It installs one capture-phase listener for `input` and one for `change` on
 * `window`, and records in a `WeakSet` every select carrying
 * `data-early-choice` that such an event is aimed at.
 *
 * Why `window`: React listens on its root container, and Next (16.3) makes
 * that container the `document` itself (`next/dist/client/app-index.js`
 * hydrates `document`). Two capture listeners on the same node run in the
 * order they were registered, and whether this script runs before the
 * application's chunk calls `hydrateRoot` is not something the page can
 * promise — an async chunk can run before the body has been parsed, and with
 * streaming a select further down can be hydrated by a root registered
 * earlier. An event's capture path visits `window` before `document`, so a
 * listener on `window` runs before every listener on the document whatever
 * the order of registration, and a choice whose event makes React hydrate is
 * recorded before the hydration it causes.
 *
 * Nothing is written to the select itself: a changed attribute would be a
 * mismatch React reports when it hydrates. The set lives on `window` under
 * `EARLY_CHOICE_GLOBAL` and is read by `wasChosenBeforeHydration`.
 *
 * ## What the script may contain
 *
 * It is a literal: the same text is sent to the browser and executed by the
 * tests. It runs before any application code, so it uses nothing but the
 * DOM, and it does nothing when it has already run (a second copy, or a
 * client-side render of the layout, which a browser does not execute anyway).
 */

/** The attribute a select carries to opt in to being recorded. */
export const EARLY_CHOICE_ATTRIBUTE = 'data-early-choice';

/** Where on `window` the set of recorded selects is kept. */
export const EARLY_CHOICE_GLOBAL = '__rootlcoEarlyChoice';

/** The listener, as the inline script sends it. See the module note. */
export const EARLY_CHOICE_SCRIPT =
  '(function(){' +
  `if(window.${EARLY_CHOICE_GLOBAL})return;` +
  'var chosen=new WeakSet();' +
  `window.${EARLY_CHOICE_GLOBAL}=chosen;` +
  'function mark(event){' +
  'var target=event.target;' +
  `if(target&&target.tagName==='SELECT'&&target.hasAttribute('${EARLY_CHOICE_ATTRIBUTE}'))chosen.add(target);` +
  '}' +
  "window.addEventListener('input',mark,true);" +
  "window.addEventListener('change',mark,true);" +
  '})();';

/**
 * Whether an `input` or `change` event has been aimed at this select since the
 * document began — the mark of a person's choice. `false` when the early
 * script did not run, so a value nobody can be shown to have chosen is never
 * taken as a choice.
 *
 * The mark is read, not consumed: in development React runs a layout effect
 * twice on mount, and the second run must give the same answer.
 */
export function wasChosenBeforeHydration(select: HTMLSelectElement): boolean {
  if (typeof window === 'undefined') return false;
  const chosen = (window as unknown as Record<string, unknown>)[EARLY_CHOICE_GLOBAL];
  return chosen instanceof WeakSet && chosen.has(select);
}
