import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { requireSession } from '@/features/authentication/api/session';
import { readTenant } from '@/features/administration/organization/api';
import { OrgReadFailure } from '@/features/administration/organization/components/OrgReadFailure';
import { TenantForm } from '@/features/administration/organization/components/TenantForm';
import { readReferenceValues } from '@/features/administration/organization/reference-values';
import {
  ContractNotice,
  Fact,
  Panel,
} from '@/features/administration/shared/components/ScreenStates';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { DIRECTION, LOCALES, isLocale } from '@/i18n/config';
import { getMessages, translate, type Messages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Languages.
 *
 * Two different things live on this screen, and conflating them would be a lie:
 *
 * **What this application serves** — Arabic and English, from
 * `src/i18n/config.ts`, which is the single Frontend authority for locale and
 * direction. It is not configurable at runtime because a locale with no message
 * catalogue is a screen full of translation keys.
 *
 * **What the workspace defaults to** — `defaultLocale` on the tenant record,
 * writable through `PATCH /api/v1/org/tenant` and foreign-key constrained to
 * `shared.languages` server-side.
 *
 * `shared.languages` is read through `org.reference-values-read`
 * (P1-32-PRE-OD-REF, closing `P1-26-F-006`), only for a holder of
 * `org.tenant.read`, so the default is chosen from the languages the platform
 * holds and the interface can be shown in. This screen still does not manage the
 * platform's language registry — it has no write to it — and the backend's "not
 * a registered platform value" verdict stays the authority.
 *
 * On Material UI (ADR-022, P1-32-PRE-OD-ADM1): the default is the workspace
 * form's Material fields, and a workspace read that did not answer is the shared
 * Material state — a refusal, an ended session, or an outage with Try again —
 * rather than one line that said "unavailable" for all of them.
 */
export default async function LanguagesPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages: Messages = getMessages(locale);
  const t = (key: string) => translate(messages, key as keyof Messages);
  const canReadTenant = holds(session.permissions, PERMISSIONS.tenantRead);
  // `iam.tenant-settings-read` declares `org.tenant.read`: without it the panel
  // says so, and no read is made to be refused.
  const tenant = canReadTenant
    ? await readTenant()
    : { status: 'denied' as const, data: null, correlationId: null };
  const referenceValues = canReadTenant ? await readReferenceValues() : null;
  const referenceUnavailable = canReadTenant && referenceValues === null;

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="languages.title"
        descriptionKey="languages.description"
        crumbs={[
          { labelKey: 'nav.administration', href: `/${locale}/administration` },
          { labelKey: 'nav.languages' },
        ]}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          <ContractNotice messages={messages} bodyKeys={['languages.required']} />

          <Panel title={t('languages.available')}>
            <dl className="grid gap-4 sm:grid-cols-2">
              {LOCALES.map((code) => (
                <Fact
                  key={code}
                  label={t(`locale.${code}`)}
                  value={t(
                    DIRECTION[code] === 'rtl'
                      ? 'languages.direction.rtl'
                      : 'languages.direction.ltr'
                  )}
                  hint={code}
                />
              ))}
            </dl>
          </Panel>

          <Panel title={t('languages.default')} description={t('languages.defaultHint')}>
            {tenant.status === 'ok' && tenant.data ? (
              <TenantForm
                locale={locale}
                messages={messages}
                tenant={tenant.data}
                canWrite={holds(session.permissions, PERMISSIONS.settingsManage)}
                referenceValues={referenceValues}
                referenceUnavailable={referenceUnavailable}
              />
            ) : (
              <OrgReadFailure
                messages={messages}
                locale={locale}
                status={tenant.status === 'ok' ? 'error' : tenant.status}
                correlationId={tenant.correlationId}
              />
            )}
          </Panel>
        </div>
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('languages.title');
