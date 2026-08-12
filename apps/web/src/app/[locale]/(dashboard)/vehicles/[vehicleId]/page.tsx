import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import {
  NotFoundState,
  PermissionDeniedState,
  ErrorState,
  SessionExpiredState,
} from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { VehicleProfileScreen } from '@/features/vehicles/components/VehicleProfileScreen';
import { readVehicle } from '@/features/vehicles/profile-api';
import { readEvProfile } from '@/features/vehicles/relations-api';
import { listVehicleDocuments, type DocumentsState } from '@/features/vehicles/documents-api';
import { DOCUMENT_LIST_PERMISSION } from '@/features/vehicles/documents-contract';
import { CRM_PERMISSIONS, VEHICLE_PERMISSIONS, holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Vehicle profile (`P1-27-FE-019`) and VIN validation (`P1-27-FE-020`).
 *
 * Three permissions, three different questions:
 *
 * - `veh.vehicle.read` — may this operator see the vehicle at all?
 * - `veh.vehicle.manage` — may they edit its description?
 * - `veh.vehicle.status.manage` — may they change its lifecycle?
 *
 * The read gates the page; the other two gate panels inside it. One read code
 * fans out to five write codes across this domain, so rendering an edit form
 * from read access would be wrong here and on every sub-resource.
 *
 * A 404 means four things at once — absent, soft-deleted, another tenant's, or
 * never existed — and the screen says "not found" without speculating which.
 * Speculating would rebuild the existence oracle the shared 404 exists to
 * prevent. A **merged** vehicle is not among them: it is returned, and shown.
 */
export default async function VehicleProfilePage({
  params,
}: {
  readonly params: Promise<{ locale: string; vehicleId: string }>;
}) {
  const { locale, vehicleId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const frame = (body: ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="vehicles.profile.title"
        // The parent crumb LINKS. Without an href it rendered as a `<span>`,
        // which marked a second current page in the breadcrumb landmark and
        // left a failed profile with no route back to the vehicle list.
        crumbs={[
          { labelKey: 'nav.vehicles', href: `/${locale}/vehicles` },
          { labelKey: 'vehicles.profile.title' },
        ]}
      />
      <PageBody>{body}</PageBody>
    </>
  );

  if (!holds(session.permissions, VEHICLE_PERMISSIONS.vehicleRead)) {
    // Decided here, before any request. Nothing was called, so there is no
    // reference to carry — unlike the backend denial below.
    return frame(<PermissionDeniedState messages={messages} />);
  }

  const result = await readVehicle(vehicleId);

  /*
   * One branch per outcome, in the same order as the CRM twin
   * (`crm/customers/[customerId]/page.tsx`), because the shapes diverged and one
   * of the two was wrong.
   *
   * This route read `not-found`, `denied` and `ok`, and let EVERYTHING else fall
   * into `ErrorState`. `readOperation` returns `{status:'expired'}` whenever
   * there is no authorized client, and `STATUS_BY_KIND.unauthenticated` is
   * `'expired'` as well — so an operator whose session had simply ended was told
   * the service had failed. They then retry, or call support about a system that
   * is working; what they needed to be told is to sign in again.
   *
   * The twin handles it, and `DataTable` handles it for every list on every
   * screen. This detail page was the outlier.
   *
   * Scope, stated plainly: the P1-27 task matrix has no field for this, so it is
   * a product inconsistency between two twins rather than a canonical
   * requirement being violated.
   */
  if (result.status === 'denied') {
    // A denial the BACKEND issued, which is a different fact from the gate
    // above: a request was made, the API answered 403, and there is a log line
    // to quote. `DataTable` and the CRM twin both carry the reference on this
    // outcome; this route dropped it, so the same 403 was traceable through a
    // list and untraceable through a profile.
    return frame(
      <PermissionDeniedState
        messages={messages}
        correlationId={result.correlationId ?? undefined}
      />
    );
  }

  if (result.status === 'not-found' || (result.status === 'ok' && result.data === null)) {
    return frame(<NotFoundState messages={messages} />);
  }

  if (result.status === 'expired') {
    // No retry control, deliberately, matching `DataTable`: re-issuing the same
    // request with the same dead session fails identically.
    return frame(<SessionExpiredState messages={messages} />);
  }

  if (result.status !== 'ok' || result.data === null) {
    return frame(
      <ErrorState messages={messages} correlationId={result.correlationId ?? undefined} />
    );
  }

  // Read on the SERVER. A 404 here means "no EV profile" as often as it means
  // "no vehicle", and the vehicle's existence has just been established above —
  // so this is the one place the ambiguity can be resolved honestly.
  const evProfile = await readEvProfile(vehicleId);

  // The documents tab needs `shared.document.manage` — a MANAGE capability from
  // a different module, inverted relative to every other vehicle sub-resource.
  // The list is only read when the caller holds it, so a denied operator never
  // spends an `expensive-read` slot discovering they cannot see it.
  const canListDocuments = holds(session.permissions, DOCUMENT_LIST_PERMISSION);
  const documents: DocumentsState = canListDocuments
    ? await listVehicleDocuments(vehicleId)
    : { status: 'denied', correlationId: null };

  return (
    <>
      <PageBody>
        <VehicleProfileScreen
          locale={locale}
          messages={messages}
          vehicle={result.data}
          canEdit={holds(session.permissions, VEHICLE_PERMISSIONS.vehicleManage)}
          canChangeStatus={holds(session.permissions, VEHICLE_PERMISSIONS.statusManage)}
          canManageRelationships={holds(
            session.permissions,
            VEHICLE_PERMISSIONS.relationshipManage
          )}
          // `crm.vehicle-link` is a CRM operation with a CRM permission. An
          // operator may hold one of these two and not the other, so the
          // relationships panel takes both rather than conflating them.
          canLinkCustomer={holds(session.permissions, CRM_PERMISSIONS.vehicleManage)}
          // `veh.vehicle.odometer.record` is implied by neither `manage` nor
          // `status.manage`: a technician records mileage without editing the
          // vehicle. The code was declared and consulted nowhere, so the
          // odometer form rendered for every reader (`P1-27-SEC-001`).
          canRecordOdometer={holds(session.permissions, VEHICLE_PERMISSIONS.odometerRecord)}
          evProfile={evProfile}
          canListDocuments={canListDocuments}
          documents={documents}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('vehicles.profile.title');
