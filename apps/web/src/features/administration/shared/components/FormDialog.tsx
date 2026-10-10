'use client';

import { useId, type ReactNode, type RefObject } from 'react';
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
 * A short form in a dialog, on Material UI — the department and employee
 * registers' create and rename forms (`P1-32-PRE-OD-ADM2`).
 *
 * The shared `DecisionDialog` is an ALERT dialog: a question the operator must
 * answer. A form is not a question, and two alert dialogs on one page — this
 * form and the working context's "discard your changes?" asked over it — would
 * be two answers awaited at once. So this is an ordinary dialog with the same
 * rules the decision dialogs keep (D1–D4):
 *
 *   - named by its title and described by its sentence; Material's dialog keeps
 *     Tab inside and returns focus to whatever opened it when it closes;
 *   - the caller's first field takes focus when it opens (`autoFocus`);
 *   - Escape cancels and a click outside does not; while the write is in flight
 *     both buttons are disabled and Escape does nothing;
 *   - a closed dialog leaves the page at once — the caller renders it only while
 *     open — and under "reduce motion" there is no fade;
 *   - a refusal is announced (`role="alert"`) beside the buttons it is about.
 *
 * The submit button belongs to the form by its `form` attribute, so Enter in a
 * field and a press of the button are the same submission.
 */
export function FormDialog({
  messages,
  title,
  description,
  submitLabel,
  pendingLabel,
  pending,
  error,
  onCancel,
  onSubmit,
  formRef,
  testId,
  children,
}: {
  readonly messages: Messages;
  readonly title: string;
  readonly description?: string | undefined;
  readonly submitLabel: string;
  /** What the submit button says while the write is in flight. Defaults to "Saving…". */
  readonly pendingLabel?: string | undefined;
  readonly pending: boolean;
  /** A translated sentence: why the last attempt was refused. */
  readonly error?: string | undefined;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
  /** The form's ref, so a refusal can move the cursor to the first field to fix. */
  readonly formRef?: RefObject<HTMLFormElement | null> | undefined;
  readonly testId?: string | undefined;
  readonly children: ReactNode;
}) {
  const base = useId();
  const titleId = `${base}-title`;
  const descriptionId = description ? `${base}-description` : undefined;
  const formId = `${base}-form`;
  const reducedMotion = useReducedMotion();

  return (
    <Dialog
      open
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      maxWidth="sm"
      fullWidth
      onClose={(_event, reason) => {
        // Answered on purpose, never by a stray click; and while the write is in
        // flight Escape is the disabled Cancel by another key.
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
      <DialogContent>
        {description ? (
          <DialogContentText id={descriptionId}>{description}</DialogContentText>
        ) : null}
        <form
          id={formId}
          ref={formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="flex flex-col gap-3 pt-2"
        >
          {children}
        </form>
      </DialogContent>
      <DialogActions className="flex-wrap gap-2">
        {error ? (
          <Typography role="alert" variant="body2" color="error" className="me-auto">
            {error}
          </Typography>
        ) : null}
        <Button variant="outlined" color="inherit" onClick={onCancel} disabled={pending}>
          {translate(messages, 'admin.cancel')}
        </Button>
        <Button
          type="submit"
          form={formId}
          variant="contained"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {pending ? (pendingLabel ?? translate(messages, 'admin.saving')) : submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
