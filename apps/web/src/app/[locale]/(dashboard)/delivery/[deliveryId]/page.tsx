import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import {
  BackendUnavailableState,
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { readDelivery } from '@/features/delivery/api';
import { DeliveryDetailScreen } from '@/features/delivery/components/DeliveryDetailScreen';
import { DELIVERY_PERMISSIONS } from '@/features/delivery/delivery-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * One vehicle handover (P1-31) — its record, whether it may complete, who is
 * authorised to receive the vehicle, what was signed, what was checked, and
 * every move it has made.
 *
 * ## The guard runs BEFORE the read
 *
 * `sal.delivery.view` is tested and returned on before `readDelivery` is called.
 * A page that issues its read first has already asked the backend for the record
 * by the time it decides whether the operator may see it. The backend would
 * refuse — it is the authority, not this page — but the request would still have
 * been made, and a screen that leans on that is one backend regression away from
 * leaking. `scripts/ci/check-p1-31-access.mjs` is what keeps that ordering true
 * for every P1-31 screen after this one.
 *
 * ## A second permission is computed and does not gate the page
 *
 * The eligibility read demands `sal.finance.view` as well, because one of the
 * reasons it composes is the customer's open balance. That is resolved here and
 * passed down as a capability, so the eligibility panel refuses on its own while
 * the rest of the handover still renders. Gating the whole page on it would hide
 * the custody chain from everyone who is not in finance.
 *
 * `sal.delivery.complete` is computed for the same reason and gates nothing at
 * all in this slice: it decides only whether the eligibility panel says the one
 * overridable reason may be overridden by the reader or by somebody else. No
 * write exists here for it to authorise.
 *
 * **Both are affordances, never enforcement.** Every read is decided again by the
 * backend against the actual record.
 */
export default async function DeliveryDetailPage({
  params,
}: {
  readonly params: Promise<{ locale: string; deliveryId: string }>;
}) {
  const { locale, deliveryId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  /*
   * ONE crumb, because there is no ancestor SCREEN to route back to.
   *
   * The navigation entry for `/delivery` is still `planned` — the list is
   * FE-001 and waits on an Owner decision — so a parent crumb here would be
   * either a link to a page that does not exist or a route-less ancestor, and
   * `shell.dom.test.tsx` measures that no route-less ancestor exists in this
   * product. The list crumb arrives with the list.
   */
  const crumbs = [{ labelKey: 'delivery.detail.crumb' }];

  if (!holds(session.permissions, DELIVERY_PERMISSIONS.view)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="delivery.detail.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const record = await readDelivery(deliveryId);

  /**
   * The chrome every outcome shares.
   *
   * Each outcome below is its own `if` and its own return rather than a branch
   * of one ternary chain, for the reason the work-order detail page records:
   * `route-correlation-binding` reads the nearest enclosing `if` to decide
   * whether a denial came from the BACKEND or from a client-side gate, and a
   * ternary carries no condition it can see.
   */
  const shell = (children: React.ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="delivery.detail.title"
        descriptionKey="delivery.detail.description"
        crumbs={crumbs}
      />
      <PageBody>{children}</PageBody>
    </>
  );

  // The reference the backend logged. `null` becomes `undefined` because the
  // state components take an optional prop, and an explicit null would render as
  // a reference that is not there.
  const reference = record.correlationId ?? undefined;

  if (record.status === 'not-found') {
    // A delivery in another company or another branch is NOT FOUND here, not
    // "denied": the backend deliberately does not confirm that a record it will
    // not show you exists. No reference is printed, because the whole point is
    // that nothing about this record is being disclosed.
    return shell(<NotFoundState messages={messages} />);
  }
  if (record.status === 'denied') {
    // The BACKEND refused this read and that refusal is in its logs, so the
    // correlation reference is printed: it is the only diagnostic an operator
    // ever sees. The client-side gate above prints none, because nothing was
    // logged there and a reference would lead nowhere.
    return shell(<PermissionDeniedState messages={messages} correlationId={reference} />);
  }
  if (record.status === 'expired') {
    return shell(<SessionExpiredState messages={messages} />);
  }
  if (record.status === 'unavailable') {
    return shell(<BackendUnavailableState messages={messages} correlationId={reference} />);
  }
  if (record.status !== 'ok') {
    return shell(<ErrorState messages={messages} correlationId={reference} />);
  }

  return shell(
    <DeliveryDetailScreen
      locale={locale}
      messages={messages}
      delivery={record.data}
      canReadFinance={holds(session.permissions, DELIVERY_PERMISSIONS.financeView)}
      canComplete={holds(session.permissions, DELIVERY_PERMISSIONS.complete)}
    />
  );
}

export const generateMetadata = pageMetadata('delivery.detail.title');
