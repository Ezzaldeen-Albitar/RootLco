'use client';

import { useId, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useReducedMotion } from '@/components/ui-foundation/use-reduced-motion';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * A decision the operator must answer before continuing, on Material UI —
 * ADR-022 PR1. The same props as `ConfirmDialog` in `components/overlays`, so a
 * call site moves by changing its import.
 *
 * ## The contract it keeps
 *
 *   - **An alert dialog**, named by its title and described by its sentence.
 *     Material's `Dialog` traps Tab inside the paper while it is open and
 *     returns focus to whatever opened it when it closes.
 *   - **Safe initial focus.** Cancel takes focus when the dialog opens. A
 *     destructive action never receives default focus: Enter is muscle memory,
 *     and a dialog that deletes on Enter turns a reflex into data loss.
 *   - **Escape cancels; a click outside does not.** A decision is not dismissed
 *     by missing it with the pointer. While the action is `pending` Cancel is
 *     disabled, and Escape — the same answer by another key — is too.
 *   - **Destructive styling** is the error colour AND the wording the caller
 *     passes; colour is never the only signal.
 *   - **A refusal is announced** (`role="alert"`) inside the dialog, beside the
 *     buttons it is about.
 *
 * ## Why a closed dialog renders nothing
 *
 * Material keeps a dialog mounted through its exit transition, and during
 * those frames it is still in the accessibility tree: a screen reader, a test,
 * or a second dialog opened at once would find a decision that has already
 * been answered. The dialog this replaces left the page the moment it was
 * answered, so this one does too — it is rendered only while `open`, and the
 * fade is an entrance only. Under "reduce motion" there is no fade at all.
 */
export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
  readonly description?: string | undefined;
  readonly confirmLabel: string;
  readonly messages: Messages;
  readonly destructive?: boolean;
  readonly pending?: boolean;
  /** A translated sentence: why the last attempt was refused. */
  readonly error?: string | undefined;
  readonly testId?: string | undefined;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  return <OpenConfirmDialog {...props} />;
}

function OpenConfirmDialog({
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel,
  messages,
  destructive = false,
  pending = false,
  error,
  testId,
}: ConfirmDialogProps) {
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
          onConfirm={onConfirm}
          focusCancel
        />
      }
    />
  );
}

/**
 * The frame both decision dialogs share: the title, the sentence, the body and
 * the buttons, with the dismissal rules above. Exported for `ReasonDialog`.
 */
export function DecisionDialog({
  title,
  description,
  onCancel,
  pending,
  testId,
  children,
  actions,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly onCancel: () => void;
  readonly pending: boolean;
  readonly testId?: string | undefined;
  readonly children?: ReactNode;
  readonly actions: ReactNode;
}) {
  const base = useId();
  const titleId = `${base}-title`;
  const descriptionId = description ? `${base}-description` : undefined;
  const reducedMotion = useReducedMotion();

  return (
    <Dialog
      open
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      maxWidth="xs"
      fullWidth
      onClose={(_event, reason) => {
        // A decision is answered on purpose, never by a stray click; and while
        // the action is in flight Escape is the disabled Cancel by another key.
        if (reason === 'backdropClick') return;
        if (pending) return;
        onCancel();
      }}
      {...(reducedMotion ? { transitionDuration: 0 } : {})}
      slotProps={{ paper: { 'data-testid': testId } as Record<string, unknown> }}
    >
      <DialogTitle id={titleId} component="h2" variant="h3">
        {title}
      </DialogTitle>
      {description || children ? (
        <DialogContent>
          {description ? (
            <DialogContentText id={descriptionId}>{description}</DialogContentText>
          ) : null}
          {children}
        </DialogContent>
      ) : null}
      <DialogActions className="flex-wrap gap-2">{actions}</DialogActions>
    </Dialog>
  );
}

/** Cancel, then the action, with the refusal (if any) on the reading start. */
export function DecisionActions({
  messages,
  error,
  pending,
  destructive,
  confirmLabel,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  focusCancel,
}: {
  readonly messages: Messages;
  readonly error: string | undefined;
  readonly pending: boolean;
  readonly destructive: boolean;
  readonly confirmLabel: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly confirmDisabled?: boolean;
  /** Whether Cancel takes focus when the dialog opens. */
  readonly focusCancel: boolean;
}) {
  return (
    <>
      {error ? (
        <Typography role="alert" variant="body2" color="error" className="me-auto">
          {error}
        </Typography>
      ) : null}
      <Button
        variant="outlined"
        color="inherit"
        onClick={onCancel}
        disabled={pending}
        autoFocus={focusCancel}
      >
        {translate(messages, 'overlay.cancel')}
      </Button>
      <Button
        variant="contained"
        color={destructive ? 'error' : 'primary'}
        onClick={onConfirm}
        disabled={pending || confirmDisabled}
        aria-busy={pending || undefined}
        data-destructive={destructive || undefined}
      >
        {pending ? translate(messages, 'overlay.working') : confirmLabel}
      </Button>
    </>
  );
}
