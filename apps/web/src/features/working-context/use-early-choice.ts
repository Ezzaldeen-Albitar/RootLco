'use client';

import { useLayoutEffect, type RefObject } from 'react';
import { wasChosenBeforeHydration } from './early-choice-mark';

/**
 * Takes a branch chosen in a select before React had hydrated it as the choice
 * it is (P1-32-PRE-OD-UXQ, Q-1).
 *
 * ## The defect it closes
 *
 * The workspace shell is in the server's HTML, so a branch select is drawn —
 * enabled, with every branch in it — before React has attached to the page. A
 * branch chosen in that moment changes the select and is heard by nobody:
 * React leaves the select as it finds it while it hydrates, and the next render
 * writes the provider's value back over the choice. With "All my branches"
 * remembered the header's select read "Choose your branch" again and the
 * choice was gone.
 *
 * ## What it does
 *
 * The select is read in the commit that mounts it — hydration included, before
 * the browser paints and before any other update can render. When it holds
 * something other than the value it was drawn with, one of two things happens:
 *
 *   - it is handed to `adopt` exactly as if it had just been chosen — the
 *     provider's guarded switch, so it is remembered, it moves the version
 *     once, and unsaved work is asked about first — when it is one of the
 *     values the select was given to offer AND a person's `input` or `change`
 *     was aimed at the select (`wasChosenBeforeHydration`, below); or
 *   - otherwise nothing is adopted and the select is put back to the value it
 *     was drawn with: the remembered selection stands and the select does not
 *     go on naming a branch that is not in force.
 *
 * It is the adoption the sign-in form makes for a box filled before hydration
 * (`usePrefilledValue`), for a select that can show it was chosen.
 *
 * ## A choice is recognised by its event, never by the value alone
 *
 * A select can hold a value it was not drawn with for two reasons: a person
 * chose it, or the browser put an earlier value back when it re-opened the
 * document from its history. Adopted, a value put back would move this tab and
 * every other to it without a word.
 *
 * The browser-restore experiment of 2026-10-20 (Playwright 1.62.1; Chromium
 * 151, Firefox 153, WebKit 26.5; plain static pages; evidence in the Owner's
 * workspace, `orchestration/evidence/owner-directive-pr593-browser-restore/`)
 * found, in the builds it tested and where a new document was loaded:
 *
 *   - WebKit put the earlier value back into a select marked
 *     `autocomplete="off"` on every Back/Forward arrival, already visible
 *     while the document was still `interactive` — so `autocomplete="off"`
 *     does not tell a choice from a value put back;
 *   - Chromium and Firefox put it back into unmarked selects (Firefox on a
 *     reload too), and neither into a marked one;
 *   - no browser fired an `input` or `change` event while putting a value
 *     back.
 *
 * So the one thing that told them apart in every build tested is the event.
 * The locale layout renders `EarlyChoiceScript` first in the body, before any
 * select is parsed; it listens for `input` and `change` on the document, in
 * the capture phase, and records each select carrying `data-early-choice`
 * that one is aimed at (`early-choice-mark.ts`). A held value is adopted only
 * from a select so recorded — on every arrival: a fresh navigation, a reload,
 * a move through history, a prerender, or one the browser does not name. A
 * value without the record is put back on every arrival.
 *
 * ## The earlier rules, and what changed
 *
 * This hook adopted, first, on a fresh navigation only
 * (`PerformanceNavigationTiming.type === 'navigate'`) and put the select back
 * on every other arrival; then also when the event being dispatched
 * (`window.event`) was an `input` or `change` aimed at the select (#591). On a
 * reload or a move through history that lost every branch chosen before the
 * page had finished loading (runtime retest at 784322b1, F-1: 18 of 18, among
 * them choices React was already listening for). Those choices now carry the
 * record and are adopted.
 *
 * On a fresh navigation the earlier rule adopted ANY differing value, with or
 * without an event. The experiment found no browser putting a value back on a
 * fresh navigation, and every person's choice is recorded because the script
 * is in the page before the select, so for a person's choice the two rules
 * agree. They differ only for a value written without an event (a script, an
 * extension), which is no longer adopted. If the early script did not run, no
 * early choice is adopted on any arrival — the defect as it was before this
 * hook, never a value adopted that nobody chose.
 *
 * The `window.event` path is gone: a choice whose own event makes React
 * hydrate is recorded by the document's capture listener, which runs before
 * React's listeners on its root, so it is recorded before that hydration.
 *
 * Both callers keep `autocomplete="off"` on their select. It is not relied on;
 * where a browser honours it, it only spares the select from showing a stale
 * branch before React arrives.
 *
 * When React hydrates inside the dispatch of the choice itself, the choice
 * then arrives twice — read here, and delivered to the select's handler — and
 * the provider takes the handler's request for the selection already in force
 * as nothing to do, so the version moves once.
 *
 * ## Only a value the select was given to offer
 *
 * What the select holds is read from the document, and the document is not
 * the authority for which branches exist: an option can be edited there.
 * `offered` is the list the component drew its options from — the branches
 * the server published to this operator, and "All my branches" where the
 * screen offers it — and a held value outside it is not adopted, recorded or
 * not. The provider would refuse such a value too, but only after it had
 * replaced the remembered selection in storage; here nothing is written at
 * all.
 *
 * ## What it never does
 *
 * It never adopts the empty ask, and it never acts when the value the select
 * was drawn with is not one of its options: the browser then shows the first
 * option, which nobody chose. After React has rendered the select the two
 * agree, so all of this finds something only in the commit that hydrates it.
 */
export function useEarlyChoice(
  selectRef: RefObject<HTMLSelectElement | null>,
  value: string,
  offered: readonly string[],
  adopt: (chosen: string) => void
): void {
  useLayoutEffect(() => {
    const select = selectRef.current;
    if (select === null) return;
    const held = select.value;
    if (held === value) return;
    if (!Array.from(select.options).some((option) => option.value === value)) return;
    // Only a value a person's event was aimed at is a choice; a value the
    // browser put back comes with no event (see above).
    if (offered.includes(held) && wasChosenBeforeHydration(select)) {
      adopt(held);
      return;
    }
    select.value = value;
  }, [selectRef, value, offered, adopt]);
}
