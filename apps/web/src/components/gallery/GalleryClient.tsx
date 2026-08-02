'use client';

import { useCallback, useMemo, useState } from 'react';
import { BrandMark } from '@/components/brand';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import {
  CheckboxField,
  RadioGroupField,
  SelectField,
  TextAreaField,
  TextField,
} from '@/components/forms/Field';
import { MoneyField } from '@/components/forms/MoneyField';
import {
  ConfirmDialog,
  Dialog,
  Drawer,
  ReasonConfirmDialog,
  Tabs,
  ToastRegion,
  type ToastMessage,
} from '@/components/overlays/Overlays';
import { Icon, ICON_NAMES } from '@/components/primitives/Icon';
import { PrintDocument, PrintTable } from '@/components/print/PrintDocument';
import {
  BackendUnavailableState,
  ConflictState,
  EmptyState,
  ErrorState,
  LoadingState,
  NoResultsState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
  SkeletonRows,
} from '@/components/states/States';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { formatDateTime, intlLocale } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import {
  FIXTURE_CURRENCY,
  FIXTURE_FILTER_DEFINITIONS,
  FIXTURE_ROWS,
  FIXTURE_STATUS_KEY,
  simulateServer,
  type FixtureRow,
} from './fixtures';

/**
 * The component gallery.
 *
 * Every shared component, rendered from fixed fixtures, in whichever direction
 * the surrounding locale layout established. It exists so that "the design
 * system works" is a thing somebody can look at rather than a claim, and so the
 * browser review and the print check have one page to run against.
 *
 * It fetches nothing. That is deliberate: a gallery that needs a database is a
 * gallery nobody opens.
 */

const BUTTON =
  'rounded-md px-4 py-2 text-button font-medium transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

export function GalleryClient({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const t = useCallback((key: string) => translate(messages, key as keyof Messages), [messages]);

  const [request, setRequest] = useState<TableRequest>({ ...INITIAL_REQUEST, pageSize: 10 });
  const [tableStatus, setTableStatus] = useState<'idle' | 'loading' | 'error' | 'denied'>('idle');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [destructiveOpen, setDestructiveOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);
  const [amount, setAmount] = useState('1250.0000');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('open');
  const [priority, setPriority] = useState('normal');
  const [active, setActive] = useState(true);

  const response = useMemo(() => simulateServer(FIXTURE_ROWS, request), [request]);

  const columns: readonly Column<FixtureRow>[] = useMemo(
    () => [
      {
        id: 'reference',
        headerKey: 'column.reference',
        sortable: true,
        cell: (row) => <span className="font-mono">{row.reference}</span>,
      },
      {
        id: 'descriptionKey',
        headerKey: 'column.description',
        cell: (row) => t(row.descriptionKey),
      },
      {
        id: 'status',
        headerKey: 'column.status',
        sortable: true,
        cell: (row) => (
          <StatusBadge status={row.status} label={t(FIXTURE_STATUS_KEY[row.status])} />
        ),
      },
      {
        id: 'updated',
        headerKey: 'column.updated',
        sortable: true,
        cell: (row) => formatDateTime(row.updated, locale),
      },
      {
        id: 'amount',
        headerKey: 'column.amount',
        numeric: true,
        cell: (row) =>
          formatMoney({ amount: row.amount, currency: FIXTURE_CURRENCY }, intlLocale(locale)),
      },
    ],
    [locale, t]
  );

  return (
    <div className="flex flex-col gap-10">
      <p className="rounded-md border border-info bg-info-subtle px-4 py-3 text-supporting text-text-secondary">
        {t('gallery.fixtureNotice')}
      </p>

      <Section title={t('gallery.foundations')}>
        <SubSection title={t('gallery.colour')}>
          <div className="flex flex-wrap gap-3">
            {[
              'surface',
              'surface-subtle',
              'primary',
              'accent',
              'success',
              'warning',
              'error',
              'info',
              'border',
              'skeleton',
            ].map((token) => (
              <div key={token} className="flex w-28 flex-col gap-1">
                <div className={`h-10 rounded-md border border-border bg-${token}`} />
                <code className="text-caption text-text-muted">{token}</code>
              </div>
            ))}
          </div>
        </SubSection>

        <SubSection title={t('gallery.typography')}>
          <div className="flex flex-col gap-1">
            <p className="text-display">Display / عرض</p>
            <p className="text-page-title">Page title / عنوان الصفحة</p>
            <p className="text-section-title">Section / قسم</p>
            <p className="text-body">Body / نصّ أساسي</p>
            <p className="text-supporting text-text-secondary">Supporting / نصّ مساند</p>
            <p className="text-caption text-text-muted">Caption / تعليق</p>
          </div>
        </SubSection>

        <SubSection title={t('gallery.spacing')}>
          <div className="flex items-end gap-2">
            {[1, 2, 3, 4, 6, 8, 12, 16].map((step) => (
              <div key={step} className="flex flex-col items-center gap-1">
                <div className={`w-4 bg-primary-subtle h-${step}`} />
                <code className="text-caption text-text-muted">{step}</code>
              </div>
            ))}
          </div>
        </SubSection>

        <SubSection title={`${t('gallery.radii')} · ${t('gallery.shadows')}`}>
          <div className="flex flex-wrap gap-3">
            {(['sm', 'md', 'lg', 'xl'] as const).map((radius) => (
              <div
                key={radius}
                className={`flex h-16 w-24 items-center justify-center border border-border bg-surface text-caption text-text-muted shadow-sm rounded-${radius}`}
              >
                {radius}
              </div>
            ))}
            {(['xs', 'sm', 'md', 'lg', 'overlay'] as const).map((shadow) => (
              <div
                key={shadow}
                className={`flex h-16 w-24 items-center justify-center rounded-md border border-border bg-surface text-caption text-text-muted shadow-${shadow}`}
              >
                {shadow}
              </div>
            ))}
          </div>
        </SubSection>

        <SubSection title={t('gallery.motion')}>
          <p className="text-supporting text-text-secondary">
            {/* Reduced motion is a TOKEN concern: every duration collapses to 0ms
                in the token layer, so a component written later inherits the
                preference without knowing it exists. */}
            instant · fast · base · slow · overlay
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={`${BUTTON} bg-primary text-on-primary hover:bg-primary-hover`}
            >
              hover
            </button>
            <button
              type="button"
              className={`${BUTTON} border border-border bg-surface text-text-secondary hover:bg-surface-subtle`}
            >
              {t('gallery.focusRing')}
            </button>
          </div>
        </SubSection>

        <SubSection title="Icons">
          <div className="flex flex-wrap gap-3 text-text-secondary">
            {ICON_NAMES.map((icon) => (
              <span key={icon} className="flex w-20 flex-col items-center gap-1">
                <Icon name={icon} size={22} />
                <code className="text-caption text-text-muted">{icon}</code>
              </span>
            ))}
          </div>
        </SubSection>

        <SubSection title="Brand">
          <BrandMark />
        </SubSection>
      </Section>

      <Section title={t('gallery.controls')}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t('field.name')}
            description={t('field.nameHint')}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label={t('field.search')}
            type="search"
            optionalHint={t('field.optional')}
            leadingIcon={<Icon name="reports" size={16} />}
          />
          <TextField label={t('field.quantity')} type="number" inputMode="numeric" min={0} />
          <TextField label={t('field.phone')} type="tel" inputMode="tel" dir="ltr" />
          <TextField label={t('field.date')} type="date" />
          <TextField label={t('field.time')} type="time" />
          <MoneyField
            messages={messages}
            label={t('field.amount')}
            currency={FIXTURE_CURRENCY}
            value={amount}
            onChange={(next) => setAmount(next)}
            required
          />
          <SelectField
            label={t('field.status')}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            placeholder={t('field.selectPlaceholder')}
            options={[
              { value: 'open', label: t('fixture.statusOpen') },
              { value: 'pending', label: t('fixture.statusPending') },
              { value: 'closed', label: t('fixture.statusClosed') },
            ]}
          />
          <TextField label={t('field.attachment')} type="file" />
          <TextField label={t('field.name')} error={t('field.required')} defaultValue="" />
          <TextField label={t('field.name')} disabled defaultValue="—" />
          <TextField label={t('field.name')} loading readOnly defaultValue="…" />
          <TextAreaField label={t('field.notes')} optionalHint={t('field.optional')} />
          <div className="flex flex-col gap-4">
            <CheckboxField
              label={t('field.active')}
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            <RadioGroupField
              label={t('field.priority')}
              name="gallery-priority"
              value={priority}
              onChange={setPriority}
              options={[
                { value: 'low', label: 'Low / منخفضة' },
                { value: 'normal', label: 'Normal / عادية' },
                { value: 'high', label: 'High / عالية' },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section title={t('gallery.dataTable')}>
        <div className="mb-3 flex flex-wrap gap-2">
          {(['idle', 'loading', 'error', 'denied'] as const).map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => setTableStatus(state)}
              aria-pressed={tableStatus === state}
              className={`${BUTTON} border border-border text-supporting ${
                tableStatus === state
                  ? 'bg-primary-subtle text-primary'
                  : 'bg-surface text-text-secondary'
              }`}
            >
              {state}
            </button>
          ))}
        </div>
        <DataTable
          messages={messages}
          columns={columns}
          rowId={(row) => row.id}
          request={request}
          response={response}
          status={tableStatus}
          filterDefinitions={FIXTURE_FILTER_DEFINITIONS}
          onRequestChange={setRequest}
          onRetry={() => setTableStatus('idle')}
          correlationId="00000000-0000-4000-8000-000000000000"
          caption={t('gallery.dataTable')}
          rowActions={() => (
            <button type="button" className="text-supporting text-primary hover:underline">
              {t('table.rowActions')}
            </button>
          )}
        />
      </Section>

      <Section title={t('gallery.overlays')}>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className={`${BUTTON} bg-primary text-on-primary hover:bg-primary-hover`}
          >
            {t('gallery.openDialog')}
          </button>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className={`${BUTTON} border border-border bg-surface text-text-secondary hover:bg-surface-subtle`}
          >
            {t('gallery.openDrawer')}
          </button>
          <button
            type="button"
            onClick={() => setDestructiveOpen(true)}
            className={`${BUTTON} bg-error text-text-inverse hover:opacity-90`}
          >
            {t('gallery.confirmDestructive')}
          </button>
          <button
            type="button"
            onClick={() => setReasonOpen(true)}
            className={`${BUTTON} border border-border bg-surface text-text-secondary hover:bg-surface-subtle`}
          >
            {t('gallery.confirmReason')}
          </button>
          <button
            type="button"
            onClick={() =>
              setToasts((current) => [
                ...current,
                {
                  id: `toast-${current.length + 1}`,
                  tone: 'success',
                  title: t('gallery.toastTitle'),
                  description: t('gallery.toastBody'),
                },
              ])
            }
            className={`${BUTTON} border border-border bg-surface text-text-secondary hover:bg-surface-subtle`}
          >
            {t('gallery.showToast')}
          </button>
        </div>

        <div className="mt-6">
          <Tabs
            label={t('gallery.overlays')}
            tabs={[
              { id: 'one', label: 'One / واحد', panel: <p className="text-body">Panel one.</p> },
              { id: 'two', label: 'Two / اثنان', panel: <p className="text-body">Panel two.</p> },
              {
                id: 'three',
                label: 'Three / ثلاثة',
                panel: <p className="text-body">Panel three.</p>,
              },
            ]}
          />
        </div>

        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          messages={messages}
          title={t('gallery.sampleDialogTitle')}
          description={t('gallery.sampleDialogBody')}
          footer={
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className={`${BUTTON} bg-primary text-on-primary hover:bg-primary-hover`}
            >
              {t('overlay.close')}
            </button>
          }
        >
          <TextField label={t('field.name')} />
        </Dialog>

        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          messages={messages}
          title={t('gallery.sampleDrawerTitle')}
        >
          <p className="text-body text-text-secondary">{t('gallery.sampleDialogBody')}</p>
        </Drawer>

        <ConfirmDialog
          open={destructiveOpen}
          onCancel={() => setDestructiveOpen(false)}
          onConfirm={() => setDestructiveOpen(false)}
          messages={messages}
          destructive
          title={t('gallery.destructiveTitle')}
          description={t('gallery.destructiveBody')}
          confirmLabel={t('gallery.confirmDestructive')}
        />

        <ReasonConfirmDialog
          open={reasonOpen}
          onCancel={() => setReasonOpen(false)}
          onConfirm={() => setReasonOpen(false)}
          messages={messages}
          title={t('gallery.reasonTitle')}
          description={t('gallery.reasonBody')}
          reasonLabel={t('gallery.reasonLabel')}
          confirmLabel={t('gallery.confirmReason')}
        />

        <ToastRegion
          messages={messages}
          toasts={toasts}
          onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
        />
      </Section>

      <Section title={t('gallery.states')}>
        <div className="grid gap-4 md:grid-cols-2">
          <StateBox>
            <LoadingState messages={messages} />
          </StateBox>
          <StateBox>
            <SkeletonRows rows={3} />
          </StateBox>
          <StateBox>
            <EmptyState messages={messages} />
          </StateBox>
          <StateBox>
            <NoResultsState messages={messages} />
          </StateBox>
          <StateBox>
            <ErrorState messages={messages} />
          </StateBox>
          <StateBox>
            <ErrorState messages={messages} correlationId="00000000-0000-4000-8000-000000000000" />
          </StateBox>
          <StateBox>
            <PermissionDeniedState messages={messages} />
          </StateBox>
          <StateBox>
            <NotFoundState messages={messages} />
          </StateBox>
          <StateBox>
            <BackendUnavailableState messages={messages} />
          </StateBox>
          <StateBox>
            <ConflictState messages={messages} />
          </StateBox>
          <StateBox>
            <SessionExpiredState messages={messages} />
          </StateBox>
        </div>
      </Section>

      <Section title={t('gallery.print')}>
        <p className="mb-3 text-supporting text-text-muted">{t('gallery.printHint')}</p>
        <PrintDocument
          title={t('gallery.printSample')}
          brand={<BrandMark />}
          header={<p>{new Date('2026-03-04T00:00:00.000Z').toISOString().slice(0, 10)}</p>}
          footer={<p>{t('print.page')} 1</p>}
        >
          <PrintTable
            headers={[t('column.reference'), t('column.description'), t('column.amount')]}
            rows={FIXTURE_ROWS.map((row) => [
              row.reference,
              t(row.descriptionKey),
              formatMoney({ amount: row.amount, currency: FIXTURE_CURRENCY }, intlLocale(locale)),
            ])}
          />
        </PrintDocument>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-section-title font-semibold text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

function SubSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-label font-medium uppercase tracking-wide text-text-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}

function StateBox({ children }: { readonly children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-surface">{children}</div>;
}

function StatusBadge({ status, label }: { readonly status: string; readonly label: string }) {
  const tone =
    status === 'open'
      ? 'bg-info-subtle text-info'
      : status === 'pending'
        ? 'bg-warning-subtle text-warning'
        : 'bg-success-subtle text-success';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-caption font-medium ${tone}`}>
      {label}
    </span>
  );
}
