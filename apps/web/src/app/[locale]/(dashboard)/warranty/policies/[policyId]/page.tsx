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
import { WarrantyPolicyScreen } from '@/features/warranty/components/WarrantyPolicyScreen';
import { readWarrantyPolicy } from '@/features/warranty/warranty-api';
import { WARRANTY_PERMISSIONS } from '@/features/warranty/warranty-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * One warranty plan and its windows of cover terms (P1-31, FE-008 plan
 * administration).
 *
 * ## The guard runs BEFORE the read
 *
 * `wty.warranty.read` is tested and returned on before `readWarrantyPolicy` is called.
 * The plan read answers that code — the terms a warranty will be issued under must be
 * visible to whoever issues it — so the administration code gates the CONTROLS on the
 * screen and nothing else.
 *
 * ## Absent and invisible answer the same thing
 *
 * The backend decides absence before it decides scope, so a plan in a company the
 * caller cannot reach and an identifier that names nothing arrive identically. Both
 * are shown as not found rather than as a refusal, because a refusal would confirm
 * that the identifier names a real row somewhere.
 *
 * ## Each outcome is its own `if` and its own return
 *
 * Not one ternary chain, for the reason the warranty record page records:
 * `route-correlation-binding` reads the nearest enclosing `if` to decide whether a
 * denial came from the backend or from a client-side gate, and a ternary carries no
 * condition it can see.
 */
export default async function WarrantyPolicyPage({
  params,
}: {
  readonly params: Promise<{ locale: string; policyId: string }>;
}) {
  const { locale, policyId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.warranty', href: `/${locale}/warranty` },
    { labelKey: 'warranty.policies.crumb', href: `/${locale}/warranty/policies` },
    { labelKey: 'warranty.policies.detailCrumb' },
  ];

  if (!holds(session.permissions, WARRANTY_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="warranty.policies.detailTitle"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const canManagePolicies = holds(session.permissions, WARRANTY_PERMISSIONS.policyManage);
  const detail = await readWarrantyPolicy(policyId);

  const shell = (children: React.ReactNode) => (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="warranty.policies.detailTitle"
        descriptionKey="warranty.policies.detailDescription"
        crumbs={crumbs}
      />
      <PageBody>{children}</PageBody>
    </>
  );

  // The reference the backend logged. `null` becomes `undefined` because the state
  // components take an optional prop, and an explicit null would render as a reference
  // that is not there.
  const reference = detail.correlationId ?? undefined;

  if (detail.status === 'not-found') {
    return shell(<NotFoundState messages={messages} />);
  }
  if (detail.status === 'denied') {
    // The BACKEND refused this read and that refusal is in its logs, so the
    // correlation reference is printed. The client-side gate above prints none,
    // because nothing was logged there.
    return shell(<PermissionDeniedState messages={messages} correlationId={reference} />);
  }
  if (detail.status === 'expired') {
    return shell(<SessionExpiredState messages={messages} />);
  }
  if (detail.status === 'unavailable') {
    return shell(<BackendUnavailableState messages={messages} correlationId={reference} />);
  }
  if (detail.status !== 'ok') {
    return shell(<ErrorState messages={messages} correlationId={reference} />);
  }

  return shell(
    <WarrantyPolicyScreen
      messages={messages}
      policyId={policyId}
      initial={detail.data}
      canManagePolicies={canManagePolicies}
    />
  );
}

export const generateMetadata = pageMetadata('warranty.policies.detailTitle');
