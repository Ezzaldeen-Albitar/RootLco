'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Adopts what a text box already holds when React first meets it.
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
 * Once, in the commit that mounts the form — hydration included, and before
 * the browser paints or any other update can render — it reads the box named
 * `name` and, when it holds something other than the state does, hands that
 * to `adopt`. From then on the state and the box agree, exactly as if the
 * value had been typed after hydration.
 *
 * A value that arrives AFTER hydration needs nothing from here: the browser
 * reports it with an event, which the box's own `onChange` hears.
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
    if (looked.current) return;
    looked.current = true;
    const control = formRef.current?.elements.namedItem(name);
    if (control instanceof HTMLInputElement && control.value !== held) adopt(control.value);
  }, [formRef, name, held, adopt]);
}
