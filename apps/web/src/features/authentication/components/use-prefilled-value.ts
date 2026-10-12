'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * The events a value written without one is looked for at. Each is heard on the
 * form in the CAPTURE phase, which runs before React's own handlers for the
 * same event (React dispatches those from its root as the event bubbles), so
 * before any render those handlers ask for.
 */
const LOOKED_AT = ['focusin', 'pointerdown', 'keydown'] as const;

/**
 * Adopts what a text box holds that React was never told about.
 *
 * ## The defect it closes
 *
 * A Server Action form is usable before the page has hydrated, and a browser
 * or a password manager fills a sign-in form the moment it is drawn. Either
 * way a box can hold a value before React has attached to it. React leaves
 * that value in the box while it hydrates and does not tell the component, so
 * a CONTROLLED box is then out of step with its own state — and the next
 * render, for any reason at all, writes the state's stale value back over what
 * was typed. On the sign-in form, typing the password erased an address the
 * browser had filled in.
 *
 * ## What it does
 *
 * One comparison, made at two moments: the box named `name` is read and, when
 * it holds something other than the state does, that is handed to `adopt`.
 * From then on the state and the box agree, exactly as if the value had been
 * typed.
 *
 * 1. Once, in the commit that mounts the form — hydration included, and before
 *    the browser paints or any other update can render.
 * 2. Whenever focus moves into the form, a pointer is pressed in it or a key is
 *    pressed in it (P1-32-PRE-OD-AUTHB-04).
 *
 * The second is for a value written AFTER the form mounted. A browser's own
 * autofill and the mainstream password managers report what they write with an
 * event, which the box's own `onChange` hears, and nothing here is needed for
 * them. But a value can also be written straight onto the element with no
 * event at all (some extensions do), and then the box is out of step again:
 * the next render of that box would erase it. Nobody can type in another box,
 * press a reveal control or submit the form without one of those three events
 * reaching the form first, so the value is adopted before the render that
 * would have erased it.
 *
 * What stays uncovered: a render of the box that no focus, press or key in the
 * form came before — a refresh of the page's data, or a submit made by
 * something that sends none of the three — still writes the state over a value
 * written without an event.
 *
 * ## What it never does
 *
 * It only ever moves the state TO what the box shows, and only when the two
 * differ. So it cannot change what the operator is typing (typing is heard by
 * `onChange`, and the two already agree by the next event), and it cannot
 * bring back a value the form cleared: the comparison is against the state the
 * box was last drawn from, so while a clearing waits to be drawn the two still
 * agree and nothing is adopted, and once it is drawn the box is empty too. An
 * adoption made without the comparison would be queued behind that clearing
 * and put the value back.
 *
 * The value is read, compared and handed over; it is kept nowhere else. A
 * password stays in the component's state and nowhere besides.
 *
 * It exists because the Material wrappers (`FormTextField`,
 * `FormPasswordField`) are controlled, where the legacy fields these forms used
 * were not. Called once per box, by name, after the form's ref is taken.
 */
export function usePrefilledValue(
  formRef: RefObject<HTMLFormElement | null>,
  name: string,
  held: string,
  adopt: (value: string) => void
): void {
  const looked = useRef(false);

  useLayoutEffect(() => {
    const form = formRef.current;
    const look = () => {
      const control = form?.elements.namedItem(name);
      if (control instanceof HTMLInputElement && control.value !== held) adopt(control.value);
    };
    if (!looked.current) {
      looked.current = true;
      look();
    }
    if (form === null) return undefined;
    for (const type of LOOKED_AT) form.addEventListener(type, look, true);
    return () => {
      for (const type of LOOKED_AT) form.removeEventListener(type, look, true);
    };
  }, [formRef, name, held, adopt]);
}
