import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { WalkInIntakeScreen } from '@/features/receptions/intake/components/WalkInIntakeScreen';
import { CRM_PERMISSIONS, VEHICLE_PERMISSIONS, holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Walk-in customer and vehicle intake (`P1-28-FE-006`).
 *
 * Gated on `crm.customer.read` — the permission the flow's FIRST operation
 * (`crm.customer-search`) actually requires. An operator who cannot search
 * for the person at the desk cannot use anything after that step, so the
 * denial renders instead of the screen. The remaining capabilities are
 * resolved here, once, from the session the SERVER established — the client
 * asserts no scope and no permission, ever — and each one is the code the
 * operation behind the control requires:
 *
 *   - `crm.customer.create`         → the two create-customer paths
 *   - `veh.vehicle.read`            → searching across all vehicles
 *   - `veh.vehicle.manage`          → registering a new vehicle
 *   - `crm.customer.vehicle.manage` → recording the relationship
 *
 * None of this is the security boundary. The backend re-checks every request;
 * these gates only stop a control being shown whose every use would come back
 * denied.
 */
export default async function WalkInIntakePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  if (!holds(session.permissions, CRM_PERMISSIONS.customerRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="receptions.intake.title"
          crumbs={[{ labelKey: 'nav.walkIn' }]}
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
        titleKey="receptions.intake.title"
        descriptionKey="receptions.intake.description"
        crumbs={[{ labelKey: 'nav.walkIn' }]}
      />
      <PageBody>
        <WalkInIntakeScreen
          locale={locale}
          messages={messages}
          canCreateCustomer={holds(session.permissions, CRM_PERMISSIONS.customerCreate)}
          canSearchVehicles={holds(session.permissions, VEHICLE_PERMISSIONS.vehicleRead)}
          canCreateVehicle={holds(session.permissions, VEHICLE_PERMISSIONS.vehicleManage)}
          canLinkVehicle={holds(session.permissions, CRM_PERMISSIONS.vehicleManage)}
          /*
           * The check-in wizard (`P1-28-FE-007`) is mounted, so the completed
           * intake links to it. Its address comes from `CHECK_IN_WIZARD_PATH`
           * (`features/receptions/intake/intake-handoff.ts`), which now names
           * the directory that exists — `receptions/check-in`, plural. While
           * this was false the constant was WRONG and nothing could tell,
           * because the only code that reads it never rendered.
           */
          checkInAvailable={true}
        />
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('receptions.intake.title');
