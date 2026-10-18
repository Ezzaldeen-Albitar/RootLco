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
 *   - it is not one of the values the select was given to offer (below), so
 *     nothing is adopted and the select is put back to the value it was drawn
 *     with, so the remembered selection stands and the select does not go on
 *     naming a branch that is not in force.
 *
 * It is the adoption the sign-in form makes for a box filled before hydration
 * (`usePrefilledValue`): whatever the select holds that it was not drawn with
 * is the operator's.
 *
 * ## Every caller's select carries `autocomplete="off"`
 *
 * That is what makes the held value the operator's on every arrival. A browser
 * puts form controls back the way they were when it re-opens a document from
 * its history or reloads it — but not a control marked `autocomplete="off"`,
 * whose state it neither saves nor restores. Both selects that use this hook
 * are so marked: the header's (`BranchSelector`) and the chooser beside a
 * screen's branch ask (`ConcreteBranchChooser` in `WorkingBranchField`). A new
 * caller must mark its select the same way, or a value the browser put back
 * would be adopted as a choice and move this tab and every other without a
 * word.
 *
 * ## Why not by how the document was reached
 *
 * This hook used to adopt only on a fresh navigation
 * (`PerformanceNavigationTiming.type === 'navigate'`) and put the select back
 * on a reload, a move through history or a prerender, to discard a value the
 * browser might have restored; later it also adopted when the event being
 * dispatched (`window.event`) was an `input` or `change` aimed at the select.
 * Neither select could be restored, so on those arrivals the reset only ever
 * discarded the operator's own choice: the runtime retest at 784322b1 (F-1)
 * lost 18 of 18 branches chosen before the page had finished loading on a
 * reload or a move through history, among them choices React was already
 * listening for. Adopting on every arrival does not depend on when React
 * hydrates or on which event, if any, it is dispatching then; a fresh
 * navigation is unchanged.
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
    // The select cannot be put back by the browser (`autocomplete="off"`), so
    // what it holds that it was not drawn with was chosen — on any arrival.
    if (offered.includes(held)) {
      adopt(held);
      return;
    }
    select.value = value;
  }, [selectRef, value, offered, adopt]);
}
