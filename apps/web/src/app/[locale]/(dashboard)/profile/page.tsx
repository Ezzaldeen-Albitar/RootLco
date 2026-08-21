import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { readUserDetail } from '@/features/authentication/api/profile';
import { requireSession } from '@/features/authentication/api/session';
import { ProfileForm } from '@/features/authentication/components/ProfileForm';
import { isUnrestrictedScope } from '@/features/authentication/types/session';
import { isLocale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Your profile.
 *
 * ## Read-only unless the platform actually offers an update
 *
 * There is no self-service profile operation (`P1-26-F-009`). The editable form
 * appears only when the account record can be read AND the actor holds
 * `iam.user.manage`; otherwise the screen says, in words, that an administrator
 * makes the change. Showing a form that the backend will refuse is worse than
 * showing none: it takes the operator's time and then blames them.
 *
 * Everything else on this page comes from `GET /api/v1/auth/session`, which is
 * the caller's own resolved identity, scope and permissions. Disclosing it to
 * them is not a leak — they already hold it — and seeing it is how an operator
 * answers "why can I not open that screen" without filing a ticket.
 */
export default async function ProfilePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  const mayManage = session.permissions.includes('iam.user.manage');
  const detail = mayManage ? await readUserDetail(session.userId) : null;
  const account = detail?.ok ? detail.data : null;

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="profile.title"
        descriptionKey="profile.description"
        crumbs={[{ labelKey: 'nav.overview', href: `/${locale}` }, { labelKey: 'nav.profile' }]}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          <Panel title={translate(messages, 'profile.identity')}>
            {account ? (
              <ProfileForm
                locale={locale}
                messages={messages}
                displayName={account.displayName}
                recordVersion={account.recordVersion}
              />
            ) : (
              <>
                <ReadOnlyRow
                  label={translate(messages, 'profile.displayName')}
                  value={session.displayName}
                />
                <p className="mt-3 rounded-lg border border-info-border bg-info-subtle p-3 text-supporting text-text-secondary">
                  <span className="font-medium text-text-primary">
                    {translate(messages, 'profile.readOnly')}
                  </span>{' '}
                  {translate(messages, 'profile.readOnlyDetail')}
                </p>
              </>
            )}

            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <Definition
                label={translate(messages, 'profile.email')}
                hint={translate(messages, 'profile.emailHint')}
                value={session.email}
              />
              <Definition
                label={translate(messages, 'profile.userId')}
                value={session.userId}
                mono
              />
              <Definition
                label={translate(messages, 'profile.tenant')}
                value={session.tenantId}
                mono
              />
              {account ? (
                <Definition
                  label={translate(messages, 'profile.mfaRequired')}
                  hint={translate(messages, 'profile.mfaHint')}
                  // Its own keys. Borrowing `field.active` and
                  // `permissions.effect.unset` rendered "Active" / "Not mapped"
                  // under "Two-factor authentication required", which is not
                  // what either word means here (P1-26-F-034).
                  value={translate(
                    messages,
                    account.mfaRequired ? 'profile.mfaOn' : 'profile.mfaOff'
                  )}
                />
              ) : null}
            </dl>
          </Panel>

          <Panel title={translate(messages, 'profile.scope')}>
            {isUnrestrictedScope(session) ? (
              <p className="text-body text-text-secondary">
                {translate(messages, 'profile.scope.unrestricted')}
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <ReferenceList
                  label={translate(messages, 'profile.scope.companies')}
                  values={session.companyIds}
                />
                <ReferenceList
                  label={translate(messages, 'profile.scope.branches')}
                  values={session.branchIds}
                />
              </div>
            )}
            <p className="mt-3 text-caption text-text-muted">
              {translate(messages, 'admin.contractGap.noDirectory')}
            </p>
          </Panel>

          <Panel title={translate(messages, 'profile.permissions')}>
            <p className="text-supporting text-text-muted">
              {translate(messages, 'profile.permissionsHint')}
            </p>
            {session.permissions.length === 0 ? (
              <p className="mt-3 text-body text-text-secondary">
                {translate(messages, 'profile.permissionsEmpty')}
              </p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {[...session.permissions].sort().map((code) => (
                  <li
                    key={code}
                    className="rounded-full border border-border-subtle bg-surface-subtle px-3 py-1 font-mono text-caption text-text-secondary"
                  >
                    {code}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </PageBody>
    </>
  );
}

function Panel({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface p-5 shadow-xs">
      <h2 className="text-section-title font-semibold text-text-heading">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ReadOnlyRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <p className="text-label font-medium text-text-primary">{label}</p>
      <p className="text-body text-text-secondary">{value}</p>
    </div>
  );
}

function Definition({
  label,
  value,
  hint,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly mono?: boolean;
}) {
  // The hint is INSIDE the `<dd>`. A `<dl>` may contain only `<dt>`/`<dd>`
  // groups and `<div>` wrappers, and a wrapper may hold only the group — a
  // sibling `<p>` makes the list malformed (`P1-26-F-047`, serious). It is also
  // where the hint belongs: it describes the value.
  return (
    <div>
      <dt className="text-label font-medium text-text-primary">{label}</dt>
      <dd className={`text-body text-text-secondary ${mono ? 'break-all font-mono' : ''}`}>
        {value}
        {hint ? <span className="mt-1 block text-caption text-text-muted">{hint}</span> : null}
      </dd>
    </div>
  );
}

function ReferenceList({
  label,
  values,
}: {
  readonly label: string;
  readonly values: readonly string[];
}) {
  return (
    <div>
      <p className="text-label font-medium text-text-primary">{label}</p>
      {values.length === 0 ? (
        <p className="text-body text-text-muted">—</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {values.map((value) => (
            <li key={value} className="break-all font-mono text-caption text-text-secondary">
              {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('profile.title');
