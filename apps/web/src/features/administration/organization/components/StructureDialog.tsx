'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { useReducedMotion } from '@/components/ui-foundation/use-reduced-motion';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * The frame of the Organisation screen's form dialogs — add or edit a company or
 * a branch — on Material UI (ADR-022, P1-32-PRE-OD-ADM1).
 *
 * It keeps what the overlay it replaces promised, and adds the one thing that
 * overlay lacked:
 *
 *   - **A dialog named by its title and described by its sentence.** Material's
 *     `Dialog` moves focus inside when it opens, keeps Tab inside while it is
 *     open, and returns focus to whatever opened it when it leaves the page.
 *   - **Rendered only while open.** The caller mounts it; a closed dialog is not
 *     kept through an exit transition, so nothing answered stays in the
 *     accessibility tree. Under "reduce motion" there is no fade at all.
 *   - **Escape and Close ask before throwing typed work away.** A stray click
 *     outside does nothing. With nothing typed, Escape and Close simply close;
 *     with something typed (`dirty`), they ask the shared question first and
 *     keep everything on "Cancel". The dialog's own Cancel button goes the same
 *     way (`actions` receives that close). While a write is in flight (`pending`) the
 *     dialog cannot be dismissed at all, so an answer never arrives at a dialog
 *     that is gone.
 */
export function StructureDialog({
  title,
  description,
  messages,
  dirty,
  pending,
  onClose,
  testId,
  children,
  actions,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly messages: Messages;
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly testId?: string | undefined;
  readonly children: ReactNode;
  /** The buttons under the form, given the close that asks first when work is typed. */
  readonly actions: (requestClose: () => void) => ReactNode;
}) {
  const base = useId();
  const titleId = `${base}-title`;
  const descriptionId = description ? `${base}-description` : undefined;
  const reducedMotion = useReducedMotion();
  const [asking, setAsking] = useState(false);
  const t = (key: string) => translate(messages, key as keyof Messages);

  const requestClose = () => {
    if (pending) return;
    if (dirty) {
      setAsking(true);
      return;
    }
    onClose();
  };

  return (
    <>
      <Dialog
        open
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        maxWidth="sm"
        fullWidth
        scroll="paper"
        onClose={(_event, reason) => {
          if (reason === 'backdropClick') return;
          requestClose();
        }}
        {...(reducedMotion ? { transitionDuration: 0 } : {})}
        slotProps={{ paper: { 'data-testid': testId } as Record<string, unknown> }}
      >
        <div className="flex items-start justify-between gap-3">
          <DialogTitle id={titleId}>{title}</DialogTitle>
          <div className="pe-2 pt-2">
            <IconButton
              aria-label={t('overlay.close')}
              onClick={requestClose}
              disabled={pending}
              size="small"
            >
              <span aria-hidden="true">&times;</span>
            </IconButton>
          </div>
        </div>
        <DialogContent>
          {description ? (
            <DialogContentText id={descriptionId} className="pb-4">
              {description}
            </DialogContentText>
          ) : null}
          {children}
        </DialogContent>
        <DialogActions>{actions(requestClose)}</DialogActions>
      </Dialog>
      <ConfirmDialog
        open={asking}
        messages={messages}
        title={t('form.unsavedTitle')}
        description={t('form.unsavedBody')}
        confirmLabel={t('form.discard')}
        destructive
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          onClose();
        }}
      />
    </>
  );
}

/**
 * Try again for a list read on the server while the page was rendered — the
 * currencies, the time zones and the languages. Renders the route again, which
 * repeats the read and keeps whatever was typed (`ReferenceListRetry`'s
 * behaviour, as a Material button).
 */
export function ListRetry({ label }: { readonly label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <Button
        type="button"
        variant="outlined"
        size="small"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {label}
      </Button>
    </div>
  );
}
