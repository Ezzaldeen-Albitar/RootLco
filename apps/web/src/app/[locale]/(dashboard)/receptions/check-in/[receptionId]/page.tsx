import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import {
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { CRM_PERMISSIONS, VEHICLE_PERMISSIONS, holds } from '@/features/crm/permissions';
import { readReception } from '@/features/receptions/api';
import { CHECK_IN_STEPS } from '@/features/receptions/check-in/steps';
import { CheckInWizardShell } from '@/features/receptions/components/CheckInWizardShell';
import { RECEPTION_PERMISSIONS } from '@/features/receptions/receptions-contract';
import { WORK_ORDER_READ_PERMISSION } from '@/features/receptions/work-order-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The check-in wizard for one reception visit (`P1-28-FE-007`…`FE-024`).
 *
 * `rec.reception.read` gates the page; every WRITE capability gates a control
 * inside a step, resolved here into `capabilities` so no component consults the
 * session itself:
 *
 * - `rec.reception.party.manage` — the party-role form (`FE-009`);
 * - `rec.reception.authorization.verify` — the authorization form (`FE-009`);
 * - `rec.reception.evidence.manage` — all eight condition-evidence kinds
 *   (`FE-010`…`FE-016`), one permission for the whole discriminated union;
 * - `rec.reception.signature.manage` — refusal evidence (`FE-019`), which
 *   shares its permission with signatures (`FE-018`);
 * - `veh.vehicle.odometer.record` — the arrival reading (`FE-013`), a VEHICLE
 *   capability with its own code, held by neither vehicle-manage nor
 *   reception-manage;
 * - `crm.customer.read` / `veh.vehicle.read` — the confirmation step's
 *   identity panels (`FE-008`), the odometer history (`FE-013`) and every
 *   partner search.
 *
 * The signed-in operator travels down as `session`, for the two evidence fields
 * whose referent the platform never defined — `rec.visual_inspections.inspector_id`
 * and `rec.vehicle_contents.witnessed_by_employee_id`, both uuid columns with no
 * foreign key and no employee master behind them (the named open decision
 * G-EMP). A name is offered where a uuid would otherwise have to be typed, and
 * the disposition is stated beside every control that submits one.
 *
 * The route performs the ONE detail read (`rec.reception-detail`); its
 * `recordVersion` is the `If-Match` the guarded commands demand, and the shell
 * re-sources it via `refresh()` — an operator arriving by URL (the resume
 * path) becomes able to act through exactly this read.
 *
 * One branch per failure outcome, in the same order as the vehicle-profile
 * twin: a backend 403 carries its correlation reference, a client-side gate
 * denial carries none (no request was made), an expired session is told to
 * sign in rather than that the service failed, and a 404 is stated without
 * speculating which of its four causes applies.
 */
export default async function CheckInWizardPage({
  params,
}: {
  readonly params: Promise<{ locale: string; receptionId: string }>;
}) {
  const { locale, receptionId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const frame = (body: ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="receptions.wizard.title"
        crumbs={[
          { labelKey: 'nav.receptions', href: `/${locale}/receptions` },
          { labelKey: 'receptions.wizard.title' },
        ]}
      />
      <PageBody>{body}</PageBody>
    </>
  );

  if (!holds(session.permissions, RECEPTION_PERMISSIONS.read)) {
    // Decided here, before any request — nothing was called, so there is no
    // reference to carry, unlike the backend denial below.
    return frame(<PermissionDeniedState messages={messages} />);
  }

  const result = await readReception(receptionId);

  if (result.status === 'denied') {
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
    // No retry control, deliberately: re-issuing the same request with the
    // same dead session fails identically.
    return frame(<SessionExpiredState messages={messages} />);
  }

  if (result.status !== 'ok' || result.data === null) {
    return frame(
      <ErrorState messages={messages} correlationId={result.correlationId ?? undefined} />
    );
  }

  return frame(
    <CheckInWizardShell
      locale={locale}
      messages={messages}
      initialDetail={result.data}
      steps={CHECK_IN_STEPS}
      capabilities={{
        manageParties: holds(session.permissions, RECEPTION_PERMISSIONS.partyManage),
        verifyAuthorizations: holds(session.permissions, RECEPTION_PERMISSIONS.authorizationVerify),
        readCustomers: holds(session.permissions, CRM_PERMISSIONS.customerRead),
        readVehicles: holds(session.permissions, VEHICLE_PERMISSIONS.vehicleRead),
        manageEvidence: holds(session.permissions, RECEPTION_PERMISSIONS.evidenceManage),
        manageSignatures: holds(session.permissions, RECEPTION_PERMISSIONS.signatureManage),
        recordOdometer: holds(session.permissions, VEHICLE_PERMISSIONS.odometerRecord),
        approveReceptions: holds(session.permissions, RECEPTION_PERMISSIONS.approve),
        convertReceptions: holds(session.permissions, RECEPTION_PERMISSIONS.convert),
        closeReceptions: holds(session.permissions, RECEPTION_PERMISSIONS.close),
        readWorkOrders: holds(session.permissions, WORK_ORDER_READ_PERMISSION),
      }}
      session={{ userId: session.userId, displayName: session.displayName }}
    />
  );
}

export const generateMetadata = pageMetadata('receptions.wizard.title');
