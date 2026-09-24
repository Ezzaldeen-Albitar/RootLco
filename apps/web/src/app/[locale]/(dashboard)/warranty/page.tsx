import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { WarrantyListScreen } from '@/features/warranty/components/WarrantyListScreen';
import { WARRANTY_PERMISSIONS } from '@/features/warranty/warranty-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A branch's warranty records (P1-31, FE-008 entry point, FE-009 partial).
 *
 * ## The guard runs BEFORE anything is read
 *
 * `wty.warranty.read` is tested and returned on before the screen that issues the
 * list read is rendered at all. A page that reads first and denies second has already
 * asked the backend for the rows it then declines to show; the backend would refuse —
 * it is the authority, not this page — but the request would still have been made.
 * `scripts/ci/check-p1-31-access.mjs` is what keeps that ordering true here.
 *
 * ## The branch is not a permission this page computes
 *
 * It used to resolve `org.branch.read` so the screen could decide between a
 * branch picker and two boxes asking an operator to paste a reference. The
 * working context publishes the named branches this caller is authorized for,
 * so neither control exists any more and neither does the question.
 *
 * **The read check here is an affordance, never enforcement.** Every read is
 * decided again by the backend against the actual rows.
 *
 * ## The vehicle may arrive in the address, and nothing else may
 *
 * `vehicleId` is the only filter the list operation accepts, and it is the one this
 * screen honours on arrival — that is how a vehicle screen hands over to the warranty
 * history of one vehicle. It is admitted only when it is shaped like an identifier;
 * anything else is dropped rather than forwarded into a request that would be refused
 * for the whole page. No company or branch is ever read from the address: scope is
 * the operator's choice in the screen and the server's decision on every request.
 */
export default async function WarrantyListPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.warranty' }];

  if (!holds(session.permissions, WARRANTY_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="warranty.list.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const query = await searchParams;
  const raw = query['vehicleId'];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const vehicleId = candidate && UUID.test(candidate) ? candidate : null;

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="warranty.list.title"
        descriptionKey="warranty.list.description"
        crumbs={crumbs}
      />
      <PageBody>
        <WarrantyListScreen locale={locale} messages={messages} initialVehicleId={vehicleId} />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('warranty.list.title');
