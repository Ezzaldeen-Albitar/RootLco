'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { useLocalRefusal } from '@/lib/forms/use-local-refusal';
import { exportReport } from '../reports-api';
import type { ReportScopeSelection } from '../reports-contract';

/** The longest reason the export route accepts. */
const REASON_LIMIT = 500;

/**
 * The export of a shown report (P-12), mounted beneath a successful run and keyed
 * with its submitted branch and period.
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-REPA`)
 *
 * The reason is `FormTextField` (multiline) and the download is a Material
 * button inside a form, so a refused reason is a FIELD error on the box that
 * takes the cursor (`useLocalRefusal`) and is withdrawn once the box changes.
 * Enter in the box writes a new line, as it did; only the button downloads.
 *
 * ## What it guards
 *
 *   - **Permission.** Without `rpt.export` (withheld under CC-04) or a published
 *     export authority, no control is drawn — one sentence says export is not
 *     available, and nothing else.
 *   - **One file per press.** A second press while the first is being prepared
 *     does nothing (`inFlight`), so two presses inside one moment send one
 *     audited export, never two.
 *   - **The reason is work.** A reason typed and not yet sent is unsaved: a
 *     branch switch or leaving the page asks first, and discarding clears it. A
 *     reason already sent with a file is not asked about again.
 *   - **The moment.** A file of amounts as of a stated moment (D16) asks for that
 *     same moment, so the file holds the figures on the screen.
 */
export function ReportExportPanel({
  messages,
  reportCode,
  selection,
  permitted,
  asOf = null,
  asOfMoment = null,
}: {
  readonly messages: Messages;
  readonly reportCode: string;
  readonly selection: ReportScopeSelection;
  readonly permitted: boolean;
  /**
   * The moment the shown report's amounts are as of (Owner decision D16), exactly
   * as the server stated it. The export asks for that same moment, so the file
   * holds the figures on the screen. Null for a report that states none.
   */
  readonly asOf?: string | null;
  /** `asOf` as the operator reads it: on the branch's clock, with the zone named. */
  readonly asOfMoment?: string | null;
}) {
  if (!permitted)
    return (
      <p className="text-caption text-text-secondary">
        {translate(messages, 'reports.export.withheld')}
      </p>
    );
  return (
    <ExportForm
      messages={messages}
      reportCode={reportCode}
      selection={selection}
      asOf={asOf}
      asOfMoment={asOfMoment}
    />
  );
}

function ExportForm({
  messages,
  reportCode,
  selection,
  asOf,
  asOfMoment,
}: {
  readonly messages: Messages;
  readonly reportCode: string;
  readonly selection: ReportScopeSelection;
  readonly asOf: string | null;
  readonly asOfMoment: string | null;
}) {
  const [reason, setReason] = useState('');
  /** The reason that last went out with a file, which is no longer unsaved work. */
  const [sent, setSent] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { errorKey, formRef, refuse } = useLocalRefusal({ reason });
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useUnsavedGuard(reason.trim().length > 0 && reason !== sent, () => setReason(''));

  async function download() {
    if (inFlight.current) return;
    const clean = reason.trim();
    if (!clean || clean.length > REASON_LIMIT) {
      refuse({ reason: 'reports.export.reasonRequired' });
      return;
    }
    refuse({});
    inFlight.current = true;
    setPending(true);
    try {
      const result = await exportReport(reportCode, {
        ...selection,
        ...(asOf === null ? {} : { asOf }),
        reason: clean,
      });
      if (!alive.current) return;
      if (result.status !== 'success' || !result.exported) {
        if (result.status === 'invalid') refuse({ reason: 'reports.export.reasonRequired' });
        notifyActionResult(result, messages);
        return;
      }
      setSent(reason);
      const value = result.exported;
      const blob = new Blob([value.file.content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = value.file.filename;
        anchor.hidden = true;
        document.body.append(anchor);
        try {
          anchor.click();
        } finally {
          anchor.remove();
        }
      } finally {
        // Let the browser start consuming the object URL before revoking it.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      notifyActionResult(result, messages);
    } catch {
      if (alive.current) {
        const failure: ActionState = { status: 'error', messageKey: 'action.failed' };
        notifyActionResult(failure, messages);
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setPending(false);
    }
  }

  const refusal = errorKey('reason');

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      aria-labelledby="report-export-heading"
      aria-busy={pending}
    >
      <h4 id="report-export-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'reports.export.title')}
      </h4>
      {/* A file of amounts as of a stated moment says that moment instead of
          warning that its values may have moved since the screen was read. */}
      {asOf === null || asOfMoment === null ? (
        <p className="text-caption text-text-secondary">
          {translate(messages, 'reports.export.liveNote')}
        </p>
      ) : (
        <p className="text-caption text-text-secondary" data-testid="report-export-as-of">
          <bdi>
            {formatMessage(translate(messages, 'reports.export.asOfNote'), {
              moment: asOfMoment,
            })}
          </bdi>
        </p>
      )}
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void download();
        }}
      >
        <FormTextField
          label={translate(messages, 'reports.export.reason')}
          required
          multiline
          rows={3}
          maxLength={REASON_LIMIT}
          value={reason}
          disabled={pending}
          error={refusal === undefined ? undefined : translate(messages, refusal as keyof Messages)}
          onChange={setReason}
        />
        <div>
          <Button type="submit" variant="outlined" disabled={pending}>
            {translate(messages, pending ? 'reports.export.preparing' : 'reports.export.download')}
          </Button>
        </div>
      </form>
    </section>
  );
}
