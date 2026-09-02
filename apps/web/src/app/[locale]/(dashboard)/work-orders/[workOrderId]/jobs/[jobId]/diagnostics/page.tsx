import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { JobDiagnosticsScreen } from '@/features/diagnostics/components/JobDiagnosticsScreen';
import { DIAGNOSTICS_PERMISSIONS } from '@/features/diagnostics/diagnostics-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/work-orders/{workOrderId}/jobs/{jobId}/diagnostics` (P1-29 W7) — the
 * reports on one job and the workbench of the open one. Gated on
 * `dia.diagnostic.read` BEFORE any read. The job and work-order ids are path
 * segments the caller reached from the work-order detail; every operation
 * behind them answers 404 for a job the caller's tenant does not hold.
 */
export default async function JobDiagnosticsPage({
  params,
}: {
  readonly params: Promise<{ locale: string; workOrderId: string; jobId: string }>;
}) {
  const { locale, workOrderId, jobId } = await params;
  if (!isLocale(locale)) notFound();
  if (!UUID.test(workOrderId) || !UUID.test(jobId)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.workOrders', href: '/work-orders' },
    { labelKey: 'workOrders.detail.crumb', href: `/work-orders/${workOrderId}` },
    { labelKey: 'diagnostics.job.crumb' },
  ];

  if (!holds(session.permissions, DIAGNOSTICS_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="diagnostics.job.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="diagnostics.job.title"
        descriptionKey="diagnostics.job.description"
        crumbs={crumbs}
      />
      <PageBody>
        <JobDiagnosticsScreen
          locale={locale}
          messages={messages}
          jobId={jobId}
          capabilities={{
            canRecord: holds(session.permissions, DIAGNOSTICS_PERMISSIONS.record),
            canComplete: holds(session.permissions, DIAGNOSTICS_PERMISSIONS.complete),
            canReview: holds(session.permissions, DIAGNOSTICS_PERMISSIONS.review),
            canCapture: holds(session.permissions, DIAGNOSTICS_PERMISSIONS.documentManage),
          }}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('diagnostics.job.title');
