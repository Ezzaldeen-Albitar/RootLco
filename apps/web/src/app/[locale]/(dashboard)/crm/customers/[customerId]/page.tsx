import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import {
  BackendUnavailableState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { CustomerProfileScreen } from '@/features/crm/customers/components/CustomerProfileScreen';
import { permittedWrites } from '@/features/crm/customers/governance-contract';
import { readCustomer } from '@/features/crm/customers/profile-api';
import { CRM_PERMISSIONS, holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * A customer profile (`P1-27-FE-006`).
 *
 * ## The header is read on the server, the components on demand
 *
 * The profile cannot render without the customer, so that one read happens here
 * and its failure IS the page's state. The nine component lists are separate
 * operations and load inside their own sections, so a slow or denied component
 * does not blank a profile that otherwise loaded.
 *
 * ## 404 means four things and the screen must not guess which
 *
 * Absent, soft-deleted, merged away, and belonging to another tenant all answer
 * `ERR-RES-001`. That is deliberate: it stops the endpoint being an existence
 * oracle. So "not found" is what is shown, and no copy here speculates about
 * which of the four it was — speculating would rebuild the oracle in the
 * interface.
 */
export default async function CustomerProfilePage({
  params,
}: {
  readonly params: Promise<{ locale: string; customerId: string }>;
}) {
  const { locale, customerId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const frame = (body: React.ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="crm.customers.title"
        crumbs={[
          { labelKey: 'nav.customers', href: `/${locale}/crm/customers` },
          { labelKey: 'crm.customers.profile.title' },
        ]}
      />
      <PageBody>{body}</PageBody>
    </>
  );

  if (!holds(session.permissions, CRM_PERMISSIONS.customerRead)) {
    return frame(<PermissionDeniedState messages={messages} />);
  }

  const result = await readCustomer(customerId);

  if (result.status === 'denied') {
    return frame(
      <PermissionDeniedState
        messages={messages}
        correlationId={result.correlationId ?? undefined}
      />
    );
  }
  if (result.status === 'not-found') {
    return frame(<NotFoundState messages={messages} />);
  }
  if (result.status === 'expired') {
    return frame(<SessionExpiredState messages={messages} />);
  }
  if (result.status !== 'ok') {
    /*
     * The reference is carried HERE too, and it was not.
     *
     * `PermissionDeniedState` twelve lines up already passes it, and the vehicle
     * profile's equivalent branch passes it
     * (`vehicles/[vehicleId]/page.tsx:85`) — so this route dropped it on the one
     * outcome where an operator most needs something to quote. A denial is
     * self-explanatory; "the service is unavailable" is not, and without a
     * reference the only thing they can report is the time of day.
     *
     * `SEC-004` swept `features/**` for `correlationId` and never opened a route
     * file, so the omission sat inside its blind spot; the prop is optional
     * (`States.tsx:199`), so nothing else objected either.
     */
    return frame(
      <BackendUnavailableState
        messages={messages}
        correlationId={result.correlationId ?? undefined}
      />
    );
  }

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="crm.customers.profile.title"
        crumbs={[
          { labelKey: 'nav.customers', href: `/${locale}/crm/customers` },
          { labelKey: 'crm.customers.profile.title' },
        ]}
      />
      <PageBody fill>
        <CustomerProfileScreen
          locale={locale}
          messages={messages}
          customer={result.data}
          // Resolved once here, on the server, from the session the Backend
          // itself issued — never from anything the browser can state.
          //
          // Nine writes across this profile need five different capabilities,
          // and NONE of them is the `crm.customer.read` that gates this page.
          // Only `crm.customer-status-set` was ever checked; the other eight
          // forms rendered for every operator who could open a customer
          // (`P1-27-SEC-001`). Visibility only — the server decides, and
          // `permittedWrites` cannot make a forged call succeed.
          writes={permittedWrites(session.permissions)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('crm.customers.profile.title');
