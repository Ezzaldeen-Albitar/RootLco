'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type { ActionState } from './action-result';

/**
 * After a refusal, put the operator's cursor on the first thing to fix.
 *
 * ## The failure this closes
 *
 * A long form refuses. Somewhere in it — possibly below the fold, possibly
 * inside a collapsed section, possibly on a tab that is not the one showing —
 * one field is marked invalid. Nothing moves. The operator sees a banner
 * saying the save did not work and has to hunt for the red text, and on a tab
 * they are not looking at there is no red text to find at all.
 *
 * Nothing in this application did this. `RecordForm` renders `fieldErrors`,
 * `FieldFrame` wires `aria-invalid` and `aria-errormessage`, and after all of
 * that the focus stayed on the submit button.
 *
 * ## Why it queries `[aria-invalid="true"]` rather than the error map
 *
 * The map is keyed by FIELD NAME, and a name is not a way to find an element:
 * the control's `id` is generated per instance (`useId`), several forms render
 * on one screen, and a hand-built form may not use `name` at all. The attribute
 * is on the element that is actually wrong, it is in DOM order for free, and it
 * is the same attribute a screen reader uses — so this focuses exactly what
 * assistive technology would announce as invalid, and never a control that
 * merely shares a name with an error key.
 *
 * It follows that `aria-invalid` must be present ONLY when a field really is
 * invalid, which is what `FieldFrame` guarantees.
 *
 * ## `data-invalid`, for a control ARIA will not let say it
 *
 * ARIA 1.2 does not support `aria-invalid` on the button role, and a choice
 * made in a picker is changed through a button — the "Change" control beside a
 * chosen record. Such a control carries `data-invalid="true"` instead, is
 * described by the refusal, and the refusal is its own `role="alert"`. The
 * query matches either marker, in document order, so the cursor still reaches
 * the thing to fix without an ARIA attribute the role does not allow.
 *
 * ## Never stealing the cursor from where the operator has gone
 *
 * The operator can move on long before the refusal arrives. A slow save gives
 * them the whole round trip to click into another field and start typing, and
 * moving the cursor then drops their keystrokes into the refused field.
 *
 * So the position is taken when the form is SUBMITTED, not when the refusal
 * lands: the element focused at submission, and the control that submitted it.
 * Noting it at the refusal instead recorded wherever the operator had already
 * gone during the wait — and then "focus is still where it was" was true of
 * their new field, and the cursor was taken from it anyway. The frame after the
 * refusal focuses the first invalid control ONLY if focus is still where it was
 * at submission, is on the submitting control, or has fallen to the document
 * body (a submit button that was disabled while the write ran drops it there).
 * Anywhere else is the operator's own choice, and it is left alone.
 *
 * A form refused WITHOUT a submit event of its own — a state handed in by a
 * parent, a write started from a button's click handler — has no submission to
 * remember, and falls back to the element focused when the refusal arrived.
 *
 * ## Revealing before focusing
 *
 * Focusing an element inside a closed `<details>` scrolls nowhere and announces
 * nothing, so every enclosing `<details>` is opened first. A hidden TAB panel
 * cannot be opened from here — only the form knows how its tabs work — so the
 * form passes `onRevealSection`, and this hook calls it with the
 * `data-section` value of the invalid control's nearest labelled section.
 *
 * The honest limit, stated rather than discovered: a tab panel that is not
 * MOUNTED has no element to find, so neither the section nor the error is
 * discoverable from the DOM. A form whose panels unmount must keep its error
 * summary outside them.
 *
 * ## Why the focus happens a frame later
 *
 * Opening a `<details>` or activating a tab changes the tree, and the element
 * found a moment ago may have been replaced. So the reveal happens first, and
 * the query is repeated on the next frame against whatever is there then.
 */

const INVALID = '[aria-invalid="true"], [data-invalid="true"]';

function openEnclosingDetails(element: Element): void {
  let node: Element | null = element.parentElement;
  while (node !== null) {
    if (node instanceof HTMLDetailsElement) node.open = true;
    node = node.parentElement;
  }
}

export function useFocusFirstInvalid(
  state: ActionState,
  options: {
    /**
     * Called with the `data-section` of the section holding the first invalid
     * control, so the form can activate the tab or panel that contains it.
     */
    readonly onRevealSection?: ((section: string) => void) | undefined;
    /** Off by default for nothing; present so a screen can opt out deliberately. */
    readonly enabled?: boolean;
  } = {}
): RefObject<HTMLFormElement | null> {
  const formRef = useRef<HTMLFormElement | null>(null);
  const { onRevealSection, enabled = true } = options;

  /*
   * The reveal callback, kept OUT of the effect's dependencies.
   *
   * A form passes it inline, so it is a new function on every render and would
   * make this effect run on every render — which is the one thing it must not
   * do, since running means moving the operator's focus. Excluding it with a
   * suppression would be a suppression; this box is refreshed by an effect
   * declared FIRST, and React runs effects in declaration order after a commit,
   * so the read below always sees the callback of the render that produced this
   * attempt.
   */
  const reveal = useRef(onRevealSection);
  useEffect(() => {
    reveal.current = onRevealSection;
  });

  // The attempt is the whole trigger. A form that re-renders for any other
  // reason must not steal focus back from wherever the operator has moved it.
  const attempt = state.attempt ?? 0;
  const hasFieldErrors = Object.keys(state.fieldErrors ?? {}).length > 0;

  /*
   * The attempt this form was BORN with, and the reason it is recorded.
   *
   * A mount is not a refusal. A form can be rendered already carrying an
   * attempt and its errors — remounted after a settled action, restored under a
   * new key, or handed a state that a parent is holding — and moving the cursor
   * then takes the operator somewhere they did not ask to go, before they have
   * read anything. Worse, it does it on arrival, which is exactly when a
   * screen reader is announcing the page.
   *
   * So the trigger is "an attempt ARRIVED AFTER mount", not "an attempt
   * exists". A fresh form mounts at 0 and the first refusal is 1, so the
   * ordinary case is unaffected.
   */
  const bornAt = useRef(attempt);

  /*
   * Where the cursor was when the operator SUBMITTED, and what submitted.
   *
   * Listened for on the document, in the capture phase, and matched against
   * the form by identity: the listener is added once, sees the event before any
   * handler on the form can stop it, and still finds a form that was replaced
   * under the same ref. The latest submission wins; a refusal consumes it.
   */
  const atSubmit = useRef<{
    readonly focused: Element | null;
    readonly submitter: Element | null;
  } | null>(null);
  useEffect(() => {
    const onSubmit = (event: Event) => {
      const form = formRef.current;
      if (form === null || event.target !== form) return;
      atSubmit.current = {
        focused: document.activeElement,
        submitter: 'submitter' in event ? (event as SubmitEvent).submitter : null,
      };
    };
    document.addEventListener('submit', onSubmit, true);
    return () => document.removeEventListener('submit', onSubmit, true);
  }, []);

  useEffect(() => {
    if (!enabled || !hasFieldErrors) return undefined;
    if (attempt <= bornAt.current) return undefined;
    const form = formRef.current;
    if (form === null) return undefined;

    const found = form.querySelector<HTMLElement>(INVALID);
    if (found !== null) {
      openEnclosingDetails(found);
      const section = found.closest<HTMLElement>('[data-section]')?.dataset['section'];
      if (section !== undefined) reveal.current?.(section);
    }

    // Where the cursor was when the operator submitted — or, for a refusal no
    // submission of this form produced, where it is now.
    const submitted = atSubmit.current;
    atSubmit.current = null;
    const anchor = submitted === null ? document.activeElement : submitted.focused;
    const trigger = submitted?.submitter ?? null;
    const frame = window.requestAnimationFrame(() => {
      const now = document.activeElement;
      const untouched =
        now === null ||
        now === document.body ||
        now === anchor ||
        (trigger !== null && now === trigger);
      if (!untouched) return;
      const live = formRef.current?.querySelector<HTMLElement>(INVALID);
      if (!live) return;
      openEnclosingDetails(live);
      live.focus({ preventScroll: true });
      // jsdom implements neither, and a missing scroll is not a reason to throw
      // inside a form's render path.
      if (typeof live.scrollIntoView === 'function') {
        live.scrollIntoView({ block: 'center' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [attempt, hasFieldErrors, enabled]);

  return formRef;
}
