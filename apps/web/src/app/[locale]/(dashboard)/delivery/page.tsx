import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { DeliveryReadinessScreen } from '@/features/delivery/components/DeliveryReadinessScreen';
import { DELIVERY_READINESS_PERMISSIONS } from '@/features/delivery/readiness-contract';
import { readDeliveryReadinessScopes } from '@/features/delivery/readiness-api';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The ready-for-delivery queue (P1-31, FE-001, Owner decision **D-3** of
 * 2026-09-09).
 *
 * The work orders of one branch that are finished, each with the checks that
 * decide whether its vehicle may be released — including the ones with no
 * handover record yet, which the handover list cannot contain by construction.
 *
 * ## Three permissions gate the page, and all three are the operation's own
 *
 * The queue IS the read: there is no part of this screen an operator without all
 * three codes may see, so a partial denial would be a screen with nothing left
 * in it. The three are the ones `sal.delivery-readiness-list` registers, and none
 * of them is here for tidiness:
 *
 * - the delivery view code gates the handover record every row carries;
 * - the work-order read code is required because every row IS a work order, and
 *   publishing a branch's work orders behind the delivery code alone would be a
 *   second, quieter way to read the work-order board;
 * - the financial view code is required because one of the four checks is the
 *   customer's open balance, whose rows live behind it — a caller without it
 *   would be answered from an invisible zero and shown a vehicle as releasable
 *   while money is owed on it.
 *
 * A caller missing any one of them is refused by the route. This page decides
 * first so the refusal is stated in the operator's own language instead of
 * putting a denial in the backend's log for a decision it could make itself.
 *
 * ## The guard runs BEFORE anything is read
 *
 * Nothing is awaited above the check except the route parameters and the session
 * that produces the permissions being tested, and the screen below issues no read
 * of its own until an operator names a branch.
 * The page tests exercise every missing permission before the directory read.
 *
 * ## No write is offered
 *
 * Starting a handover lives on the work order's own handover panel with its own
 * authority. This page links; it does not act.
 */
export default async function DeliveryReadinessPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.delivery' }];

  if (
    !holds(session.permissions, DELIVERY_READINESS_PERMISSIONS.view) ||
    !holds(session.permissions, DELIVERY_READINESS_PERMISSIONS.workOrderRead) ||
    !holds(session.permissions, DELIVERY_READINESS_PERMISSIONS.financeView)
  ) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="delivery.queue.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const scopeOptions = await readDeliveryReadinessScopes();

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="delivery.queue.title"
        descriptionKey="delivery.queue.description"
        crumbs={crumbs}
      />
      <PageBody>
        <DeliveryReadinessScreen locale={locale} messages={messages} scopeOptions={scopeOptions} />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('delivery.queue.title');
