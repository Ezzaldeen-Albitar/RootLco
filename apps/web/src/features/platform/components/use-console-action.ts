'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Messages } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';

/**
 * One console write, its outcome and its pending flag (P1-32-PRE-065).
 *
 * The outcome goes to the notification host; field errors stay in `state` for
 * the dialog that owns the fields. A success re-renders the server page so the
 * figures the operator sees are the server's, not a local guess.
 */
export function useConsoleAction(messages: Messages) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    (task: () => Promise<ActionState>, onSuccess?: () => void) => {
      startTransition(async () => {
        const result = await task();
        setState((previous) => ({ ...result, attempt: (previous.attempt ?? 0) + 1 }));
        if (result.status !== 'invalid') notifyActionResult(result, messages);
        if (result.status === 'success') {
          onSuccess?.();
          router.refresh();
        }
      });
    },
    [messages, router]
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { state, pending, run, reset };
}
