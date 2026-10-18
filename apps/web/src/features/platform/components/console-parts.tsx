'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { DecisionActions, DecisionDialog } from '@/components/dialogs/ConfirmDialog';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import type { ServerTable } from '@/components/data-table/use-server-table';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * Pieces the organisation page draws on Material UI (P1-32-PRE-OD-WP06B).
 *
 * Local to the console, and kept here so the detail, the billing panel and the
 * growth panel draw them one way.
 */

const NOTHING = () => undefined;

/**
 * A set of rows the page already read on the server, as a table the
 * operational grid can draw: settled, holding every row, asking for nothing.
 * Neither a page size nor a sort would reach any read, so neither is offered.
 */
export function useSettledTable<Row>(rows: readonly Row[]): ServerTable<Row> {
  return useMemo<ServerTable<Row>>(
    () => ({
      request: INITIAL_REQUEST,
      setRequest: NOTHING,
      response: {
        rows,
        total: rows.length,
        page: 1,
        pageSize: INITIAL_REQUEST.pageSize,
        hasMore: false,
      },
      status: 'idle',
      correlationId: undefined,
      refresh: NOTHING,
      honours: { pageSize: false, sort: false },
    }),
    [rows]
  );
}

/**
 * One part of the organisation page: a region named by its heading, with the
 * acts it offers beside the heading.
 */
export function ConsoleSection({
  title,
  actions,
  children,
  testId,
}: {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string | undefined;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-section-title font-semibold text-text-primary">
          {title}
        </h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A confirmation that needs a written reason, on Material UI: the lifecycle
 * change of an organisation and the void of a charge.
 *
 * It is the shared `ReasonDialog` (`components/dialogs`) without one thing:
 * that dialog registers its typed reason with the working context's unsaved
 * guard, and the console has no working context — no console surface may call
 * a working-context hook (route sweep B3). Everything else is the same and is
 * what the dialog it replaces did: an alert dialog, Cancel taking the cursor
 * on a destructive act and the reason box otherwise, the action disabled until
 * there is a reason, the reason sent trimmed, the server's refusal said beside
 * the buttons, and the typed reason dropped when the dialog closes.
 */
export function ConsoleReasonDialog({
  messages,
  title,
  description,
  confirmLabel,
  reasonLabel,
  destructive = false,
  pending = false,
  error,
  onCancel,
  onConfirm,
  testId,
}: {
  readonly messages: Messages;
  readonly title: string;
  readonly description?: string | undefined;
  readonly confirmLabel: string;
  readonly reasonLabel: string;
  readonly destructive?: boolean;
  readonly pending?: boolean;
  /** A translated sentence: why the last attempt was refused. */
  readonly error?: string | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: (reason: string) => void;
  readonly testId?: string | undefined;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const empty = reason.trim().length === 0;

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
          error={touched && empty ? translate(messages, 'overlay.reasonRequired') : undefined}
          required
          multiline
          rows={3}
          disabled={pending}
          autoFocus={!destructive}
        />
      </div>
    </DecisionDialog>
  );
}
