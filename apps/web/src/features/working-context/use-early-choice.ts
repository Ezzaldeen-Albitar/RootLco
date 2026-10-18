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
 *   - it is not one of the values the select was given to offer, or the
 *     select is not marked `autocomplete="off"` and the document was not
 *     reached by a fresh navigation (both below), so nothing is adopted and
 *     the select is put back to the value it was drawn with: the remembered
 *     selection stands and the select does not go on naming a branch that is
 *     not in force.
 *
 * It is the adoption the sign-in form makes for a box filled before hydration
 * (`usePrefilledValue`), for a select Chromium 151 did not put back in our
 * experiment (Firefox and WebKit not verified; below).
 *
 * ## A select marked `autocomplete="off"` is taken to hold the operator's choice
 *
 * A browser can put a form control back the way it was when it re-opens a
 * document from its history, and a value it put back is nobody's choice:
 * adopted, it would move this tab and every other without a word. What a
 * browser does was measured once, on plain static pages (experiment
 * 2026-10-18, Chromium 151): on a move through history without the
 * back/forward cache the earlier value was put back into every select that
 * was NOT marked `autocomplete="off"`, inside a form or outside one, and into
 * none that was; a reload put nothing back; and a page restored from the
 * back/forward cache is the live page itself, so React does not hydrate again
 * and this hook does not run. Firefox and WebKit were not verified.
 *
 * So the mark is checked here, not assumed. In a select marked
 * `autocomplete="off"`, a value that differs from what it was drawn with is
 * taken to be the operator's on every arrival, and it is adopted — on the
 * strength of that Chromium 151 measurement; a browser that did put a value
 * back into a marked select would have it adopted. In any other select it
 * may have been put back, so it is adopted on a fresh navigation only — on a
 * reload, a move through history, a prerender, or when the browser does not
 * say how the document was reached, the select is put back to the value it
 * was drawn with and the remembered selection stands (the earlier rule, kept
 * for a select without the mark). Both callers mark their select: the
 * header's (`BranchSelector`) and the chooser beside a screen's branch ask
 * (`ConcreteBranchChooser` in `WorkingBranchField`, marked in the same change
 * that made this rule).
 *
 * ## Why the mark, rather than how the document was reached
 *
 * This hook used to adopt only on a fresh navigation
 * (`PerformanceNavigationTiming.type === 'navigate'`) and put the select back
 * on every other arrival; later it also adopted when the event being
 * dispatched (`window.event`) was an `input` or `change` aimed at the select.
 * For the header's select, which was already marked, the reset could only
 * ever discard the operator's own choice in Chromium 151 in our experiment
 * (Firefox and WebKit not verified), and the runtime retest at 784322b1
 * (F-1) lost 18 of 18 branches chosen in the header or the chooser before the
 * page had finished loading on a reload or a move through history, among
 * them choices React was already listening for. Adopting in a marked select
 * on every arrival does not depend on when React hydrates or on which event,
 * if any, it is dispatching then; a fresh navigation is unchanged.
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
    // A select marked `autocomplete="off"` was not put back by Chromium 151 in
    // our experiment (Firefox and WebKit not verified), so what it holds is
    // taken as chosen on any arrival; any other select only on a fresh
    // navigation.
    if (offered.includes(held) && (isNotRestored(select) || arrivedByFreshNavigation())) {
      adopt(held);
      return;
    }
    select.value = value;
  }, [selectRef, value, offered, adopt]);
}

/**
 * Whether the select is marked `autocomplete="off"`: a control whose state the
 * browser was measured not to restore — in Chromium 151 only; whether it is
 * saved was not measured, and Firefox and WebKit were not verified (see
 * above).
 */
function isNotRestored(select: HTMLSelectElement): boolean {
  return (select.getAttribute('autocomplete') ?? '').trim().toLowerCase() === 'off';
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
