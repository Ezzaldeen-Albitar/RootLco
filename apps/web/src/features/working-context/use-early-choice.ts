'use client';

import { useLayoutEffect, type RefObject } from 'react';

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
 *     once, and unsaved work is asked about first; or
 *   - nothing is adopted and the select is put back to the value it was drawn
 *     with, so the remembered selection stands and the select does not go on
 *     naming a branch that is not in force. (The header's select was put back
 *     by its next render anyway; the chooser beside a screen's branch ask,
 *     with nothing remembered, was not.)
 *
 * It is the adoption the sign-in form makes for a box filled before hydration
 * (`usePrefilledValue`), with one difference that matters: there, whatever the
 * box holds is the operator's. Here it may not be.
 *
 * ## Only a fresh navigation can hold a choice
 *
 * A browser puts form controls back the way they were when it re-opens a
 * document from its history. Go Back to a page that showed branch A after
 * switching to B elsewhere, or reload it, and the select may hold A again
 * before React arrives — put there by the browser, chosen by nobody. Adopted,
 * it would move this tab and every other back to A without a word.
 *
 * A select cannot say who set it, but the document can say how it was reached
 * (`PerformanceNavigationTiming.type`). On a fresh navigation the browser
 * restores nothing, so a select that differs from what the server drew was
 * changed by a person. On a reload, a move through history or a prerender, or
 * when the browser does not say, nothing is adopted: the remembered selection
 * wins, as it did before this hook existed. The cost is a choice made before
 * React was listening on those navigations, which is lost as it always was.
 *
 * ## Except the choice React is hydrating to deliver
 *
 * Once React is listening, a choice made in a select it has not hydrated yet
 * makes it hydrate at once, inside the dispatch of that `input` or `change`
 * event, and only then hand the event on. This hook runs in that hydration,
 * so the select already holds the choice — and on a reload or a move through
 * history, putting it back to the drawn value here left the select's handler
 * reading the ask when the event reached it: the choice was dropped and the
 * remembered selection stood (runtime retest 2026-10-18, a branch chosen on a
 * reload about a quarter of a second after the select was drawn).
 *
 * Merely leaving the select alone is not enough. Hydration is followed, inside
 * the same dispatch, by the render that restores the remembered selection,
 * and that render puts the controlled select back to the value it is given
 * before the event reaches the handler — so the handler would read the ask
 * all the same.
 *
 * So when the event being dispatched is an `input` or `change` aimed at this
 * very select, the choice is handed to `adopt` here, as on a fresh
 * navigation: the provider's guarded switch, the one the handler would have
 * called. The event then reaches the handler, which asks for the selection
 * now in force, and the provider takes that as nothing to do. A value the
 * browser put back comes with no event, so it is still put back.
 *
 * The event is read from `window.event` — the event the browser is
 * dispatching right now, `undefined` between dispatches — because it answers
 * the one question asked (is a person's change to THIS select being delivered
 * at this moment?) with no timing and no listener of this hook's own. A
 * listener of its own runs in an effect, after hydration has begun, so it
 * would have to be a document-wide one installed when this module loads — a
 * side effect of an import, and a mark that outlives the dispatch it was made
 * in. `window.event` is a legacy interface but every current browser and
 * jsdom keep it; where it is missing the select is put back, as before.
 * A fresh navigation is unchanged: the choice is adopted here, and the provider
 * takes the event's request for the selection now in force as nothing to do.
 *
 * ## Only a value the select was given to offer
 *
 * What the select holds is read from the document, and the document is not
 * the authority for which branches exist: an option can be edited there.
 * `offered` is the list the component drew its options from — the branches
 * the server published to this operator, and "All my branches" where the
 * screen offers it — and a held value outside it is not adopted. The provider
 * would refuse such a value too, but only after it had replaced the
 * remembered selection in storage; here nothing is written at all.
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
    // On a fresh navigation the browser restored nothing; otherwise only the
    // choice React is hydrating to deliver is one.
    if (offered.includes(held) && (arrivedByFreshNavigation() || isBeingChosen(select))) {
      adopt(held);
      return;
    }
    select.value = value;
  }, [selectRef, value, offered, adopt]);
}

/**
 * Whether a person's change to `select` is being dispatched at this moment —
 * the `input` or `change` event whose dispatch made React hydrate. `false`
 * between dispatches, for an event aimed at anything else, and wherever the
 * browser does not expose the event being dispatched.
 */
function isBeingChosen(select: HTMLSelectElement): boolean {
  const event = typeof window === 'undefined' ? undefined : window.event;
  if (event === undefined) return false;
  return event.target === select && (event.type === 'input' || event.type === 'change');
}

/**
 * Whether this document was reached by a fresh navigation — a link, a typed
 * address, a bookmark — rather than by a reload, a move through history or a
 * prerender. `false` whenever the browser does not say: an unknown arrival is
 * treated as one that may have restored the form.
 */
function arrivedByFreshNavigation(): boolean {
  try {
    const [entry] = performance.getEntriesByType('navigation');
    return (entry as PerformanceNavigationTiming | undefined)?.type === 'navigate';
  } catch {
    return false;
  }
}
