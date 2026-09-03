import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { WorkOrderClosureScreen } from '@/features/quality/components/WorkOrderClosureScreen';
import { QUALITY_PERMISSIONS } from '@/features/quality/quality-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/work-orders/{workOrderId}/closure` (P1-29 W8) — the quality and closure
 * view: the closure gate as the backend states it, the QC records and their
 * per-check results, rework links and their sign-off, the append-only
 * reopen-attempt log, additional-work requests and their approvals, and the
 * closure command. Gated on `wo.work_order.read` BEFORE any read; each panel
 * appears only for the code its operations declare, and the two restricted
 * narratives are read only with `iam.sensitive.view`.
 */
export default async function WorkOrderClosurePage({
  params,
}: {
  readonly params: Promise<{ locale: string; workOrderId: string }>;
}) {
  const { locale, workOrderId } = await params;
  if (!isLocale(locale)) notFound();
  if (!UUID.test(workOrderId)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.workOrders', href: '/work-orders' },
    { labelKey: 'workOrders.detail.crumb', href: `/work-orders/${workOrderId}` },
    { labelKey: 'quality.closure.crumb' },
  ];

  if (!holds(session.permissions, QUALITY_PERMISSIONS.workRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="quality.closure.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const can = (code: string) => holds(session.permissions, code);
  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="quality.closure.title"
        descriptionKey="quality.closure.description"
        crumbs={crumbs}
      />
      <PageBody>
        <WorkOrderClosureScreen
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          capabilities={{
            canReadQc: can(QUALITY_PERMISSIONS.qcRead),
            canRecordQc: can(QUALITY_PERMISSIONS.qcRecord),
            canFinalizeQc: can(QUALITY_PERMISSIONS.qcFinalize),
            canManageRework: can(QUALITY_PERMISSIONS.reworkManage),
            canSignOffRework: can(QUALITY_PERMISSIONS.reworkSignOff),
            canTransition: can(QUALITY_PERMISSIONS.transition),
            canClose: can(QUALITY_PERMISSIONS.close),
            canRequestAdditionalWork: can(QUALITY_PERMISSIONS.additionalWorkRequest),
            canApproveAdditionalWork: can(QUALITY_PERMISSIONS.additionalWorkApprove),
            canViewSensitive: can(QUALITY_PERMISSIONS.sensitiveView),
          }}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('quality.closure.title');
