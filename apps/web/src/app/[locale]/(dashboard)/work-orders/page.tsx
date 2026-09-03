import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { WorkOrderQueueScreen } from '@/features/work-orders/components/WorkOrderQueueScreen';
import { WORK_ORDER_PERMISSIONS } from '@/features/work-orders/work-orders-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The branch work-order board and history (P1-29, `W1`).
 *
 * `wo.work_order.read` gates the page, because the board IS the read — there is
 * no part of this screen an operator without that code may see. Everything the
 * board can do beyond reading (transitions, jobs, assignment, closure) belongs
 * to later P1-29 items and is not offered here, so there is no second permission
 * to soften the denial into a missing button.
 *
 * The check is placed BEFORE any read is issued. `requireSession` runs first and
 * must: it is what produces the permissions being tested. Nothing else is
 * awaited above the guard, and the screen below issues no read of its own until
 * an operator names a branch.
 *
 * ## This page is the reason `features/work-orders` now exists
 *
 * P1-28 kept its one work-order read beside the conversion that produced it and
 * wrote down why: a `features/work-orders` module then would have been a surface
 * P1-29 owns, "built one wave early and half-shaped". This is that phase.
 */
export default async function WorkOrderQueuePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.workOrders' }];

  if (!holds(session.permissions, WORK_ORDER_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="workOrders.queue.title"
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
        titleKey="workOrders.queue.title"
        descriptionKey="workOrders.queue.description"
        crumbs={crumbs}
      />
      <PageBody>
        <WorkOrderQueueScreen
          locale={locale}
          messages={messages}
          companyIds={session.companyIds}
          branchIds={session.branchIds}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('workOrders.queue.title');
