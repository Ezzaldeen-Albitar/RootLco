import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOTH_DIRECTIONS, messagesFor } from './render';
import { ReportExportPanel } from '@/features/reports/components/ReportExportPanel';

const calls = vi.hoisted(() => ({ export: vi.fn(), notify: vi.fn() }));
vi.mock('@/features/reports/reports-api', () => ({ exportReport: calls.export }));
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: calls.notify,
}));

const selection = {
  companyId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
  from: '2026-09-01',
  to: '2026-09-08',
};
const code = 'work_orders_by_status';
const content = '"recordType","companyId","branchId"\r\n"context","company","branch"\r\n';
const completed = {
  status: 'success',
  messageKey: 'reports.export.ready',
  exported: { file: { content, filename: 'work_orders_by_status-2026-09-01-2026-09-08.csv' } },
};
const OriginalURL = globalThis.URL;
const createObjectURL = vi
  .fn<(value: unknown) => string>()
  .mockReturnValue('blob:report-export-test');
const revokeObjectURL = vi.fn<(url: string) => void>();
const clicked: { href: string; download: string }[] = [];

beforeEach(() => {
  calls.export.mockReset();
  calls.notify.mockReset();
  calls.export.mockResolvedValue(completed);
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  clicked.length = 0;
  vi.stubGlobal(
    'URL',
    class extends OriginalURL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    }
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicked.push({ href: this.href, download: this.download });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe.each(BOTH_DIRECTIONS)('report export in %s', (locale, render) => {
  const messages = messagesFor(locale);
  const panel = (permitted = true) =>
    render(
      <ReportExportPanel
        messages={messages}
        reportCode={code}
        selection={selection}
        permitted={permitted}
      />
    );
  const button = () => screen.getByRole('button', { name: messages['reports.export.download'] });
  const reason = () =>
    screen.getByRole('textbox', { name: new RegExp(messages['reports.export.reason']) });

  it('withholds the control without explicit entitlement', () => {
    panel(false);
    expect(screen.getByText(messages['reports.export.withheld'])).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    expect(calls.export).not.toHaveBeenCalled();
  });

  it('requires a reason and downloads the actual CSV with its server filename', async () => {
    panel();
    const user = userEvent.setup();
    await user.click(button());
    expect(screen.getByText(messages['reports.export.reasonRequired'])).toBeVisible();
    expect(calls.export).not.toHaveBeenCalled();
    await user.type(reason(), '  Review this branch  ');
    await user.click(button());
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(calls.export).toHaveBeenCalledExactlyOnceWith(code, {
      ...selection,
      reason: 'Review this branch',
    });
    expect(clicked[0]).toEqual({
      href: 'blob:report-export-test',
      download: completed.exported.file.filename,
    });
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(await blobText(blob)).toBe(content);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:report-export-test'));
    expect(document.querySelector('a[download]')).toBeNull();
    expect(calls.notify).toHaveBeenCalledWith(completed, messages);
  });

  it('prevents duplicate submissions and allows recovery after a refusal', async () => {
    let finish!: (value: unknown) => void;
    calls.export.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    panel();
    const user = userEvent.setup();
    await user.type(reason(), 'Review');
    await user.dblClick(button());
    expect(calls.export).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: messages['reports.export.preparing'] })
    ).toBeDisabled();
    const refusal = {
      status: 'denied',
      messageKey: 'state.denied.title',
      correlationId: 'correlation-refusal',
    };
    await act(async () => {
      finish(refusal);
    });
    expect(calls.notify).toHaveBeenCalledWith(refusal, messages);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(button()).toBeEnabled();
    await user.click(button());
    await waitFor(() => expect(clicked).toHaveLength(1));
  });

  it('does not download a stale response after its report selection unmounts', async () => {
    let finish!: (value: unknown) => void;
    calls.export.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const rendered = panel();
    const user = userEvent.setup();
    await user.type(reason(), 'Review');
    await user.click(button());
    rendered.unmount();
    await act(async () => {
      finish(completed);
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(calls.notify).not.toHaveBeenCalled();
  });
});
