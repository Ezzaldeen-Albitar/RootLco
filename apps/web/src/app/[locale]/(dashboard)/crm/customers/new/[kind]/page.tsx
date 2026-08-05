import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { CustomerCreateScreen } from '@/features/crm/customers/components/CustomerCreateScreen';
import { CRM_PERMISSIONS, holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Create a customer (`P1-27-FE-004` individual, `P1-27-FE-005` company).
 *
 * One route with a `kind` segment rather than two near-identical pages: the two
 * forms differ by three fields and share their outcome, their duplicate warning
 * and their permission. Two pages would be two places to fix the next thing.
 *
 * The segment is validated against a closed set — anything else is a 404 rather
 * than a form that renders half-built.
 */
const KINDS = ['individual', 'company'] as const;
type Kind = (typeof KINDS)[number];

function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

export default async function CreateCustomerPage({
  params,
}: {
  readonly params: Promise<{ locale: string; kind: string }>;
}) {
  const { locale, kind } = await params;
  if (!isLocale(locale) || !isKind(kind)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const titleKey =
    kind === 'individual'
      ? 'crm.customers.create.individualTitle'
      : 'crm.customers.create.companyTitle';

  // Rendered INSTEAD of the form. A form that submits and then discovers it is
  // denied has already asked an operator to type a customer's name for nothing.
  if (!holds(session.permissions, CRM_PERMISSIONS.customerCreate)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey={titleKey}
          crumbs={[
            { labelKey: 'nav.customers', href: `/${locale}/crm/customers` },
            { labelKey: titleKey },
          ]}
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
        titleKey={titleKey}
        descriptionKey="crm.customers.create.description"
        crumbs={[
          { labelKey: 'nav.customers', href: `/${locale}/crm/customers` },
          { labelKey: titleKey },
        ]}
      />
      <PageBody>
        <CustomerCreateScreen locale={locale} messages={messages} kind={kind} />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('crm.customers.title');
