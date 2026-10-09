'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { useFormStatus } from 'react-dom';
import Button from '@mui/material/Button';
import type { ActionState } from '@/lib/forms/action-result';

/**
 * The submit button of an authentication or account Server Action form, on
 * Material UI — `SubmitButton`'s contract, kept: disabled while the action is
 * in flight (`useFormStatus`, owned by React, so a redirect or a throw cannot
 * leave it stuck), announced as working with `aria-busy`, and labelled with
 * what it is doing.
 *
 * `SubmitButton` stays: the screens that have not moved still render it.
 */
export function MuiSubmitButton({
  label,
  pendingLabel,
  full = true,
}: {
  readonly label: string;
  readonly pendingLabel: string;
  readonly full?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="contained"
      fullWidth={full}
      disabled={pending}
      aria-busy={pending || undefined}
      data-testid="form-submit"
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * One submission per press, held by the FORM rather than by the button.
 *
 * The disabled button is not enough on its own: two presses that land before
 * React has re-rendered (a double click, or Enter held down) both reach the
 * form while the button still looks enabled, and `useActionState` would queue
 * both — two sign-in requests, two reset mails, two profile saves.
 *
 * So a native `submit` listener on the form itself remembers that a submission
 * is out and stops any further one until the action settles (its state changes,
 * or it stops pending). It stops the event at the form — `preventDefault` so
 * the browser does not submit natively, and `stopPropagation` so React's root
 * listener never sees it. Cancelling it in React's own `onSubmit` is not
 * enough: a cancelled submit in the same task as one that started a
 * transition is read by React as "the handler started its own transition", and
 * it resets the form's pending status — the button would come back enabled
 * while the first request is still out.
 */
export function useSubmitOnce(
  formRef: RefObject<HTMLFormElement | null>,
  state: ActionState,
  pending: boolean
): void {
  const sending = useRef(false);

  useEffect(() => {
    if (!pending) sending.current = false;
  }, [state, pending]);

  useEffect(() => {
    const form = formRef.current;
    if (form === null) return undefined;
    const hold = (event: Event) => {
      if (sending.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      sending.current = true;
    };
    form.addEventListener('submit', hold);
    return () => form.removeEventListener('submit', hold);
  }, [formRef]);
}
