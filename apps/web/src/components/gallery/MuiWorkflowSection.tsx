'use client';

import { useCallback, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import { ChartPanel, type ChartCategory } from '@/components/charts/ChartPanel';
import { MetricCard } from '@/components/charts/MetricCard';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ReasonDialog } from '@/components/dialogs/ReasonDialog';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import {
  TODAY_PERIOD,
  type InstantWindow,
  type PeriodSelection,
} from '@/components/filters/period';
import { DateField, DateTimeField } from '@/components/forms/mui/DateField';
import { BranchSelector } from '@/features/working-context/mui/BranchSelector';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { FIXTURE_ROWS, FIXTURE_STATUS_KEY } from './fixtures';

/**
 * More shared Material UI wrappers, rendered — ADR-022 PR1.
 *
 * The branch selector, the two decision dialogs, the filter toolbar, the date
 * fields and the figures, each in the page's language and direction. Like the
 * rest of the gallery it fetches nothing and addresses nothing: the branches
 * are placeholders from the catalogue, every figure is counted from the
 * gallery's fixed placeholder rows (`./fixtures`), and the zone is UTC so the
 * page reads the same on every machine. Nothing here is saved or sent: a
 * choice, an answer or a period only changes this page.
 */

const GALLERY_ZONE = 'UTC';
const GALLERY_COMPANY = 'gallery-company';

const STATUSES = ['open', 'pending', 'closed'] as const;

export function MuiWorkflowSection({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const t = useCallback((key: keyof Messages) => translate(messages, key), [messages]);

  const companies = useMemo(
    () => [{ id: GALLERY_COMPANY, name: t('gallery.muiWorkflow.company'), code: 'GALLERY' }],
    [t]
  );
  const branches = useMemo(
    () =>
      (['branchFirst', 'branchSecond'] as const).map((key, index) => ({
        id: `gallery-branch-${String(index + 1)}`,
        companyId: GALLERY_COMPANY,
        code: `G${String(index + 1)}`,
        name: t(`gallery.muiWorkflow.${key}`),
        city: null,
        timezone: GALLERY_ZONE,
        status: 'active',
      })),
    [t]
  );
  const [branch, setBranch] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  const [term, setTerm] = useState('');
  const settledTerm = useDebouncedValue(term);
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState<PeriodSelection>(TODAY_PERIOD);
  const [sent, setSent] = useState<InstantWindow | null>(null);

  const [day, setDay] = useState('');
  const [moment, setMoment] = useState('');

  const counts = STATUSES.map((key) => FIXTURE_ROWS.filter((row) => row.status === key).length);
  const categories: readonly ChartCategory[] = STATUSES.map((key) => ({
    key,
    label: translateDynamic(messages, FIXTURE_STATUS_KEY[key]),
    hatched: key === 'closed',
    ...(key === 'closed' ? { note: t('gallery.muiWorkflow.chartFinished') } : {}),
    href: `/${locale}/gallery#${key}`,
  }));

  return (
    <section className="flex flex-col gap-6" data-testid="mui-workflow">
      <div className="flex flex-col gap-2">
        <h2 className="text-section-title font-semibold text-text-primary">
          {t('gallery.muiWorkflow.title')}
        </h2>
        <p className="text-supporting text-text-secondary">
          {t('gallery.muiWorkflow.description')}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-text-primary">
          {t('gallery.muiWorkflow.branchTitle')}
        </h3>
        <div className="flex flex-wrap items-center gap-6">
          <BranchSelector
            messages={messages}
            status="ready"
            companies={companies}
            branches={branches}
            value={branch}
            onSelect={setBranch}
            onRetry={() => undefined}
            offerAllBranches
          />
          <BranchSelector
            messages={messages}
            status="ready"
            companies={companies}
            branches={branches.slice(0, 1)}
            value={branches[0]?.id ?? ''}
            onSelect={() => undefined}
            onRetry={() => undefined}
            offerAllBranches={false}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-text-primary">
          {t('gallery.muiWorkflow.dialogsTitle')}
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outlined" onClick={() => setConfirmOpen(true)}>
            {t('gallery.muiWorkflow.confirmOpen')}
          </Button>
          <Button variant="outlined" onClick={() => setReasonOpen(true)}>
            {t('gallery.muiWorkflow.reasonOpen')}
          </Button>
        </div>
        {answer === null ? null : (
          <p role="status" className="text-supporting text-text-secondary">
            {answer}
          </p>
        )}
        <ConfirmDialog
          open={confirmOpen}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            setAnswer(t('gallery.muiWorkflow.answered'));
          }}
          title={t('gallery.muiWorkflow.confirmTitle')}
          description={t('gallery.muiWorkflow.confirmDescription')}
          confirmLabel={t('gallery.muiWorkflow.confirmAction')}
          messages={messages}
          destructive
        />
        <ReasonDialog
          open={reasonOpen}
          onCancel={() => setReasonOpen(false)}
          onConfirm={() => {
            setReasonOpen(false);
            setAnswer(t('gallery.muiWorkflow.answered'));
          }}
          title={t('gallery.muiWorkflow.reasonTitle')}
          description={t('gallery.muiWorkflow.confirmDescription')}
          confirmLabel={t('gallery.muiWorkflow.reasonAction')}
          reasonLabel={t('gallery.muiWorkflow.reasonLabel')}
          messages={messages}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-text-primary">
          {t('gallery.muiWorkflow.filtersTitle')}
        </h3>
        <FilterToolbar
          messages={messages}
          label={t('gallery.muiWorkflow.filtersLabel')}
          search={{
            label: t('gallery.muiWorkflow.searchLabel'),
            value: term,
            onChange: setTerm,
            example: t('gallery.muiWrappers.pickerExample'),
          }}
          filters={[
            {
              kind: 'chips',
              key: 'status',
              label: t('column.status'),
              options: STATUSES.map((key) => ({
                value: key,
                label: translateDynamic(messages, FIXTURE_STATUS_KEY[key]),
              })),
              value: status,
              onChange: setStatus,
            },
          ]}
          period={{
            presets: ['today', 'yesterday', 'last7', 'beforeToday', 'custom'],
            value: period,
            zone: GALLERY_ZONE,
            format: 'instants',
            maxDays: 92,
            onChange: (selection, window) => {
              setPeriod(selection);
              setSent(window);
            },
          }}
          testId="gallery-filter-toolbar"
        />
        <p className="text-supporting text-text-secondary" data-testid="gallery-filter-settled">
          {formatMessage(t('gallery.muiWorkflow.searchSettled'), { term: settledTerm })}
        </p>
        {sent === null ? null : (
          <p className="text-supporting text-text-secondary" data-testid="gallery-filter-sent">
            {formatMessage(t('gallery.muiWorkflow.periodSent'), {
              from: sent.from ?? '—',
              to: sent.to ?? '—',
            })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-text-primary">
          {t('gallery.muiWorkflow.datesTitle')}
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <DateField
            label={t('gallery.muiWorkflow.dateLabel')}
            value={day}
            onChange={setDay}
            timezone={GALLERY_ZONE}
            description={t('gallery.muiWorkflow.dateHint')}
          />
          <DateTimeField
            messages={messages}
            label={t('gallery.muiWorkflow.dateTimeLabel')}
            value={moment}
            onChange={setMoment}
            timezone={GALLERY_ZONE}
            description={t('gallery.muiWorkflow.dateHint')}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-text-primary">
          {t('gallery.muiWorkflow.figuresTitle')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            messages={messages}
            locale={locale}
            timeZone={GALLERY_ZONE}
            label={translateDynamic(messages, FIXTURE_STATUS_KEY.open)}
            metric={{ status: 'ok', value: counts[0] ?? 0 }}
            href={`/${locale}/gallery#open`}
            linkLabel={t('gallery.muiWorkflow.metricLink')}
            testId="gallery-metric-value"
          />
          <MetricCard
            messages={messages}
            locale={locale}
            timeZone={GALLERY_ZONE}
            label={t('gallery.muiWorkflow.metricZero')}
            metric={{ status: 'ok', value: 0 }}
            href={`/${locale}/gallery#none`}
            linkLabel={t('gallery.muiWorkflow.metricLink')}
            testId="gallery-metric-zero"
          />
          <MetricCard
            messages={messages}
            locale={locale}
            timeZone={GALLERY_ZONE}
            label={t('gallery.muiWorkflow.metricWithheld')}
            metric={{ status: 'unauthorized' }}
            testId="gallery-metric-withheld"
          />
          <MetricCard
            messages={messages}
            locale={locale}
            timeZone={GALLERY_ZONE}
            label={t('gallery.muiWorkflow.metricUnavailable')}
            metric={{ status: 'unavailable' }}
            testId="gallery-metric-unavailable"
          />
        </div>
        <ChartPanel
          messages={messages}
          locale={locale}
          title={t('gallery.muiWorkflow.chartTitle')}
          description={t('gallery.muiWorkflow.chartDescription')}
          summary={formatMessage(t('gallery.muiWorkflow.chartSummary'), {
            states: String(STATUSES.length),
            total: String(FIXTURE_ROWS.length),
          })}
          kind="bar"
          layout="horizontal"
          categories={categories}
          series={[
            {
              id: 'documents',
              label: t('gallery.muiWorkflow.chartCount'),
              data: counts,
              tone: 'primary',
            },
          ]}
          categoryHeader={t('column.status')}
          linkHeader={t('gallery.muiWorkflow.metricLink')}
          emptyText={t('gallery.muiWorkflow.chartEmpty')}
          testId="gallery-chart-states"
        />
        <ChartPanel
          messages={messages}
          locale={locale}
          title={t('gallery.muiWorkflow.trendTitle')}
          description={t('gallery.muiWorkflow.trendDescription')}
          summary={t('gallery.muiWorkflow.trendDescription')}
          kind="bar"
          layout="vertical"
          categories={FIXTURE_ROWS.map((row) => ({
            key: row.id,
            label: row.reference,
          }))}
          series={[
            {
              id: 'opened',
              label: t('gallery.muiWorkflow.trendOpened'),
              data: FIXTURE_ROWS.map((row) => (row.status === 'closed' ? 0 : 1)),
              tone: 'primary',
            },
            {
              id: 'closed',
              label: t('gallery.muiWorkflow.trendClosed'),
              data: FIXTURE_ROWS.map((row) => (row.status === 'closed' ? 1 : 0)),
              tone: 'muted',
              hatched: true,
            },
          ]}
          categoryHeader={t('column.reference')}
          emptyText={t('gallery.muiWorkflow.chartEmpty')}
          testId="gallery-chart-trend"
        />
      </div>
    </section>
  );
}
