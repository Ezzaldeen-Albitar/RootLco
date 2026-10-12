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

/**
 * A short form in a dialog, on Material UI — saving and restating a report
 * snapshot (`P1-32-PRE-OD-REPB`).
 *
 * The shared `ConfirmDialog` and `ReasonDialog` are ALERT dialogs: a question the
 * operator must answer. Saving a snapshot and restating one are forms — a
 * statement of what will be kept, and a reason to type — so this is an ordinary
 * dialog (`role="dialog"`) keeping the same rules the decision dialogs keep
 * (route checklist D1–D4), the form-dialog pattern the administration slices
 * use:
 *
 *   - named by its title and described by its sentence; Material's dialog keeps
 *     Tab inside and returns focus to whatever opened it when it closes;
 *   - the caller's first field takes focus when it opens (`autoFocus`), and a
 *     form with no field gives it to the submit button;
 *   - Escape cancels and a click outside does not; while the write is in flight
 *     both buttons are disabled and Escape does nothing;
 *   - a closed dialog leaves the page at once — the caller renders it only while
 *     open — and under "reduce motion" there is no fade;
 *   - a refusal is announced (`role="alert"`) beside the buttons it is about,
 *     with anything the caller adds to it (`refusalDetail`).
 *
 * The submit button belongs to the form by its `form` attribute, so Enter in a
 * single-line field and a press of the button are the same submission.
 */
export function ReportFormDialog({
  title,
  description,
  submitLabel,
  pendingLabel,
  cancelLabel,
  pending,
  error,
  refusalDetail,
  onCancel,
  onSubmit,
  formRef,
  focusSubmit = false,
  testId,
  children,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly submitLabel: string;
  /** What the submit button says while the write is in flight. */
  readonly pendingLabel: string;
  readonly cancelLabel: string;
  readonly pending: boolean;
  /** A translated sentence: why the last attempt was refused. */
  readonly error?: string | undefined;
  /** What the caller adds under a refusal — the record it is about, a way to it. */
  readonly refusalDetail?: ReactNode;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
  /** The form's ref, so a refusal can move the cursor to the field to fix. */
  readonly formRef?: RefObject<HTMLFormElement | null> | undefined;
  /** A form with no field: the submit button takes the focus on opening. */
  readonly focusSubmit?: boolean;
  readonly testId?: string | undefined;
  readonly children?: ReactNode;
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
        {error ? (
          <div className="flex flex-col gap-2 pt-3">
            <Typography role="alert" variant="body2" color="error">
              {error}
            </Typography>
            {refusalDetail}
          </div>
        ) : null}
      </DialogContent>
      <DialogActions className="flex-wrap gap-2">
        <Button variant="outlined" color="inherit" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button
          type="submit"
          form={formId}
          variant="contained"
          disabled={pending}
          aria-busy={pending || undefined}
          autoFocus={focusSubmit}
        >
          {pending ? pendingLabel : submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
