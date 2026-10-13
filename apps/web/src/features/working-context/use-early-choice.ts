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
 *   - nothing is adopted, the remembered selection stands, and the render
 *     that restores it writes it back into the select, as it always did.
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
 * wins, as it did before this hook existed. The cost is the early choice on
 * those navigations, which is lost as it always was.
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
    if (!offered.includes(held)) return;
    if (arrivedByFreshNavigation()) adopt(held);
  }, [selectRef, value, offered, adopt]);
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
