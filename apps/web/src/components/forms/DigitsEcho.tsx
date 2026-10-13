import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { foldDigits } from '@/lib/text/normalization';

/**
 * Echoes Arabic-Indic digits back as Western digits, for DISPLAY only (P1-32).
 *
 * A receptionist typing a phone number or a work-order number on an Arabic
 * keyboard produces digits a colleague reading the screen may not expect. This
 * line shows how the value will be read. It changes nothing that is sent: the
 * search sends exactly what was typed and the backend folds the digits itself,
 * so there is one normaliser that decides a match, not two that could disagree.
 *
 * Renders nothing when the value holds no foldable digit.
 */
export function DigitsEcho({
  messages,
  value,
  id,
}: {
  readonly messages: Messages;
  readonly value: string | undefined;
  readonly id?: string;
}) {
  const typed = (value ?? '').trim();
  const folded = foldDigits(typed);
  if (typed.length === 0 || folded === typed) return null;
  return (
    <p id={id} className="text-caption text-text-muted" data-testid="digits-echo">
      {translate(messages, 'form.digitsEcho')}{' '}
      <bdi dir="ltr" className="font-mono">
        {folded}
      </bdi>
    </p>
  );
}
