'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

/**
 * A select whose list could not be loaded (P1-32-PRE-OD-QAF, item B).
 *
 * The currencies, time zones and languages the organisation screens offer are
 * read on the SERVER, while the page is rendered, so the browser has nothing to
 * retry by itself. When that read failed, the field says so on itself, offers
 * this button, and the form refuses to send until the list is there: an empty
 * select must never look like a valid, finished choice.
 *
 * ## Why the retry re-renders the page
 *
 * `router.refresh()` asks the server to render the route again, which repeats
 * the reference read, and keeps the client state — so whatever the operator has
 * typed into the other fields survives the retry.
 */
export function ReferenceListRetry({ label }: { readonly label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      aria-busy={pending || undefined}
      className="self-start rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:text-text-disabled"
    >
      {label}
    </button>
  );
}

export interface UnavailableListGuard {
  /**
   * Call first in the form's submit handler. While any named field has no list,
   * it stops the submission, marks those fields and moves the cursor to the
   * first of them in the form's order, and answers `true`.
   */
  readonly stop: (event: FormEvent<HTMLFormElement>) => boolean;
  /** Whether a field is refused for want of its list, after a submission tried. */
  readonly refused: (field: string) => boolean;
}

/**
 * Blocks a form while a field's list is missing.
 *
 * The refusal follows the list: once a retry brings the list back the field is
 * no longer named, and its complaint goes without another submission.
 */
export function useUnavailableListGuard(unavailable: readonly string[]): UnavailableListGuard {
  const [tried, setTried] = useState(false);
  return {
    stop: (event) => {
      if (unavailable.length === 0) return false;
      event.preventDefault();
      setTried(true);
      const first = Array.from(event.currentTarget.elements).find(
        (element): element is HTMLSelectElement =>
          element instanceof HTMLSelectElement && unavailable.includes(element.name)
      );
      first?.focus();
      return true;
    },
    refused: (field) => tried && unavailable.includes(field),
  };
}
