'use client';

import { useState } from 'react';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { DecisionActions, DecisionDialog } from './ConfirmDialog';

/**
 * A confirmation that requires a written reason, on Material UI — ADR-022 PR1.
 * The props of `ReasonConfirmDialog` in `components/overlays`, plus a
 * field-level refusal for the reason itself.
 *
 * Used for actions that are auditable rather than merely destructive — a
 * refused reception, a reopened work order. The reason is a business record:
 *
 *   - an empty or whitespace-only reason is refused rather than sent as `""`,
 *     and the action stays disabled until there is one;
 *   - a reason is sent trimmed;
 *   - the refusal is a FIELD error — the box is marked invalid, described by
 *     the sentence, and the sentence is announced (`FormTextField`'s
 *     `FieldFrame` contract) — so `useFocusFirstInvalid` would land on it;
 *   - a refusal the server gave about the reason (`reasonError`) is drawn the
 *     same way, on the same box, rather than as a page-level failure that
 *     teaches nobody which box to fix;
 *   - it stays LOCAL to this dialog until submit: free text about an
 *     operational decision does not belong in a store or a URL. It is dropped
 *     when the dialog closes, because the closed dialog renders nothing.
 *
 * The reason box takes focus when the dialog opens, because writing it is the
 * next thing to do — except on a destructive action, where Cancel does.
 */
export interface ReasonDialogProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (reason: string) => void;
  readonly title: string;
  readonly description?: string | undefined;
  readonly confirmLabel: string;
  readonly reasonLabel: string;
  readonly messages: Messages;
  readonly destructive?: boolean;
  readonly pending?: boolean;
  /** A translated sentence: why the last attempt was refused, as a whole. */
  readonly error?: string | undefined;
  /** A translated sentence: what is wrong with the reason itself. */
  readonly reasonError?: string | undefined;
  readonly maxLength?: number | undefined;
  readonly testId?: string | undefined;
}

export function ReasonDialog(props: ReasonDialogProps) {
  if (!props.open) return null;
  return <OpenReasonDialog {...props} />;
}

function OpenReasonDialog({
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel,
  reasonLabel,
  messages,
  destructive = false,
  pending = false,
  error,
  reasonError,
  maxLength,
  testId,
}: ReasonDialogProps) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const empty = reason.trim().length === 0;
  const fieldError = touched && empty ? translate(messages, 'overlay.reasonRequired') : reasonError;

  return (
    <DecisionDialog
      title={title}
      description={description}
      onCancel={onCancel}
      pending={pending}
      testId={testId}
      actions={
        <DecisionActions
          messages={messages}
          error={error}
          pending={pending}
          destructive={destructive}
          confirmLabel={confirmLabel}
          onCancel={onCancel}
          onConfirm={() => {
            setTouched(true);
            if (empty) return;
            onConfirm(reason.trim());
          }}
          confirmDisabled={empty}
          focusCancel={destructive}
        />
      }
    >
      <div className="pt-2">
        <FormTextField
          label={reasonLabel}
          value={reason}
          onChange={setReason}
          onBlur={() => setTouched(true)}
          error={fieldError}
          required
          multiline
          rows={3}
          maxLength={maxLength}
          disabled={pending}
          autoFocus={!destructive}
        />
      </div>
    </DecisionDialog>
  );
}
