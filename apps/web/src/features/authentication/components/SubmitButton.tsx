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
 * `aria-disabled` is set alongside `disabled` deliberately: a disabled button is
 * removed from the tab order, so a keyboard user who was focused on it when the
 * request started loses their place. `aria-busy` announces why.
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
