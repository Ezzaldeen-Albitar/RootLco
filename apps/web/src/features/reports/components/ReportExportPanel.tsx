'use client';

import { useEffect, useRef, useState } from 'react';
import { TextAreaField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { exportReport } from '../reports-api';
import type { ReportScopeSelection } from '../reports-contract';
import { REPORT_SECONDARY_BUTTON } from './ReportShell';

/** Mounted beneath a successful run, keyed with its submitted branch and period. */
export function ReportExportPanel({
  messages,
  reportCode,
  selection,
  permitted,
}: {
  readonly messages: Messages;
  readonly reportCode: string;
  readonly selection: ReportScopeSelection;
  readonly permitted: boolean;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (!permitted)
    return (
      <p className="text-caption text-text-secondary">
        {translate(messages, 'reports.export.withheld')}
      </p>
    );

  async function download() {
    if (inFlight.current) return;
    const clean = reason.trim();
    if (!clean || clean.length > 500) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    inFlight.current = true;
    setPending(true);
    try {
      const result = await exportReport(reportCode, { ...selection, reason: clean });
      if (!alive.current) return;
      if (result.status !== 'success' || !result.exported) {
        if (result.status === 'invalid') setInvalid(true);
        notifyActionResult(result, messages);
        return;
      }
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

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      aria-labelledby="report-export-heading"
      aria-busy={pending}
    >
      <h4 id="report-export-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'reports.export.title')}
      </h4>
      <p className="text-caption text-text-secondary">
        {translate(messages, 'reports.export.liveNote')}
      </p>
      <TextAreaField
        label={translate(messages, 'reports.export.reason')}
        required
        maxLength={500}
        value={reason}
        disabled={pending}
        error={invalid ? translate(messages, 'reports.export.reasonRequired') : undefined}
        onChange={(event) => setReason(event.target.value)}
      />
      <button
        type="button"
        className={REPORT_SECONDARY_BUTTON}
        disabled={pending}
        onClick={() => {
          void download();
        }}
      >
        {translate(messages, pending ? 'reports.export.preparing' : 'reports.export.download')}
      </button>
    </section>
  );
}
