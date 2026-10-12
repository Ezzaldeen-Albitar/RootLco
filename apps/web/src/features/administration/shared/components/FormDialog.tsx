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
 * registers' create and rename forms (`P1-32-PRE-OD-ADM2`), and since
 * `P1-32-PRE-OD-ADM4` every administration form dialog: the role, approval-limit,
 * invitation, account-details and grant forms. Planner ruling: a FORM is this
 * dialog; `DecisionDialog` stays for confirmations only.
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
 * field and a press of the button are the same submission. Enter in a one-line
 * text box or in a part of a date field submits the form through
 * `requestSubmit` — the one path the button takes too, behind the caller's
 * single-flight guard — and is left alone in a multi-line box, on a choice list
 * (a combobox handles its own Enter), in a picker's calendar, while an input
 * method is still composing a word, and when a control already used it. While
 * the write is in flight neither Enter nor the form's submit event reaches the
 * caller: `requestSubmit` does not consult the disabled button.
 *
 * `completed` is a write that is done but whose outcome the operator should
 * read before leaving (an invitation sent): the form gives way to that sentence,
 * announced, and the only button left is Close, which takes the cursor.
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
  completed,
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
  /** A translated sentence: the write is done; only Close remains. */
  readonly completed?: string | undefined;
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
        {completed ? (
          <p role="status" className="pt-2 text-supporting text-text-primary">
            {completed}
          </p>
        ) : (
          <form
            id={formId}
            ref={formRef}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              // `requestSubmit` does not consult the disabled button: the
              // write in flight is refused here, whichever key or press asked.
              if (pending) return;
              onSubmit();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              if (event.defaultPrevented) return;
              if (!entersSubmit(event.target, event.currentTarget)) return;
              event.preventDefault();
              if (pending) return;
              event.currentTarget.requestSubmit();
            }}
            className="flex flex-col gap-3 pt-2"
          >
            {children}
          </form>
        )}
      </DialogContent>
      <DialogActions className="flex-wrap gap-2">
        {completed ? (
          <Button type="button" variant="contained" onClick={onCancel} autoFocus>
            {translate(messages, 'admin.close')}
          </Button>
        ) : (
          <FormButtons
            messages={messages}
            error={error}
            pending={pending}
            submitLabel={submitLabel}
            pendingLabel={pendingLabel}
            formId={formId}
            onCancel={onCancel}
          />
        )}
      </DialogActions>
    </Dialog>
  );
}

/** The one-line boxes in which Enter submits the form. */
const ENTER_SUBMITS: ReadonlySet<string> = new Set(['text', 'email', 'tel', 'url']);

/**
 * Whether Enter pressed on `target` submits `form`: a one-line text box that is
 * not a choice list, or a part (day, month, year) of a date field. A date
 * field's parts are not inputs — each is a `spinbutton` — so they are named on
 * their own. Only what is inside the form's own markup counts: a
 * picker's calendar opens in a popover elsewhere in the page, and its events
 * reach this form through React alone, so Enter there stays the calendar's.
 */
function entersSubmit(target: EventTarget, form: HTMLFormElement): boolean {
  if (!(target instanceof HTMLElement) || !form.contains(target)) return false;
  if (target instanceof HTMLInputElement) {
    return ENTER_SUBMITS.has(target.type) && target.getAttribute('role') !== 'combobox';
  }
  // One part holds the cursor; or every part is selected, and the editable
  // element is then the list of parts itself.
  if (target.getAttribute('role') === 'spinbutton') return true;
  return (
    target.getAttribute('contenteditable') === 'true' &&
    target.querySelector('[role="spinbutton"]') !== null
  );
}

function FormButtons({
  messages,
  error,
  pending,
  submitLabel,
  pendingLabel,
  formId,
  onCancel,
}: {
  readonly messages: Messages;
  readonly error: string | undefined;
  readonly pending: boolean;
  readonly submitLabel: string;
  readonly pendingLabel: string | undefined;
  readonly formId: string;
  readonly onCancel: () => void;
}) {
  return (
    <>
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
    </>
  );
}
