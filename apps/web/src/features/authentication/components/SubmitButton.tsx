'use client';

import { useFormStatus } from 'react-dom';

/**
 * The submit button for a Server Action form.
 *
 * `useFormStatus` reads the pending state of the form this button is inside, so
 * it is **disabled while the action is in flight** — which is the double-submit
 * guard. Tracking pending state manually in the parent works until an action
 * redirects or throws, at which point the flag is never cleared and the form is
 * dead; the hook is owned by React and does not have that failure mode.
 *
 * `disabled` is what actually blocks the second submit, and it does remove the
 * button from the tab order — `aria-disabled` beside it does not change that,
 * and an earlier comment here claimed it did. What the two attributes buy is
 * announcement: a screen reader says "dimmed" and, with `aria-busy`, that the
 * control is working rather than broken (`P1-26-F-041`).
 *
 * Keeping the button focusable instead would need `aria-disabled` alone plus a
 * submit handler that refuses while pending — more moving parts for a control
 * that is disabled for the length of one request.
 */
export function SubmitButton({
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
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      className={`rounded-lg bg-primary px-5 py-2.5 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-70 ${
        full ? 'w-full' : ''
      }`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
