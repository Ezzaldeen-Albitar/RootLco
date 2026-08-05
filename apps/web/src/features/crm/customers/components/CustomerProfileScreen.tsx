'use client';

import { useCallback, useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import {
  listAddresses,
  listAlerts,
  listConsents,
  listContacts,
  listNotes,
  listPreferences,
  listRestrictions,
  listTags,
} from '../profile-api';
import {
  addressLines,
  severityRank,
  type Address,
  type Alert,
  type Consent,
  type ContactPoint,
  type CustomerDetail,
  type Note,
  type Preference,
  type Restriction,
  type Tag,
} from '../profile-contract';

/**
 * The customer profile (`FE-006`) with its contacts (`FE-007`) and addresses
 * (`FE-008`).
 *
 * ## Sections load independently
 *
 * The backend publishes nine separate component reads, not one aggregate. Each
 * section here owns its own request and its own state, so a profile is not as
 * slow as its slowest component and one denied section does not blank the page.
 *
 * ## The section list is exhaustive on purpose
 *
 * Every section P1-27 will deliver is named from the start, and the ones not yet
 * built say so rather than being absent. An operator who cannot see "Consents"
 * has no way to tell whether the product lacks it or their role hides it — and
 * those are very different facts.
 *
 * ## Scroll ownership
 *
 * This screen adds no scroll container. It renders inside the shell's `main`,
 * which owns the page scroll under ADR-021, and each table owns its own bounded
 * region. A second page-level scroller here would produce the nested-scroll
 * behaviour P1-26 was reopened to remove.
 */

/** Every profile section, including the ones later waves fill in. */
const SECTIONS = [
  'overview',
  'contacts',
  'addresses',
  'preferences',
  'consents',
  'notes',
  'alerts',
  'tags',
  'restrictions',
  'timeline',
  'vehicles',
] as const;
type Section = (typeof SECTIONS)[number];

/** Sections with a screen today. The rest render an honest "not yet" state. */
const BUILT: readonly Section[] = [
  'overview',
  'contacts',
  'addresses',
  'preferences',
  'consents',
  'notes',
  'alerts',
  'tags',
  'restrictions',
];

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customer: CustomerDetail;
}

export function CustomerProfileScreen({ locale, messages, customer }: Props) {
  const [section, setSection] = useState<Section>('overview');

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <ProfileHeader messages={messages} customer={customer} />

      <nav aria-label={translate(messages, 'crm.customers.profile.sections')}>
        <ul className="flex flex-wrap gap-1 border-b border-border">
          {SECTIONS.map((name) => {
            const active = name === section;
            const built = BUILT.includes(name);
            return (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => setSection(name)}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'rounded-t-md px-3 py-2 text-body',
                    active
                      ? 'border-b-2 border-brand-primary font-medium text-text-primary'
                      : 'text-text-secondary',
                  ].join(' ')}
                >
                  {translateDynamic(messages, `crm.customers.profile.section.${name}`)}
                  {built ? null : (
                    // Said out loud. A section that is simply missing leaves an
                    // operator unable to tell "not built" from "hidden from me".
                    <span className="ms-1 text-caption text-text-muted">
                      {translate(messages, 'nav.planned')}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {section === 'overview' ? <Overview messages={messages} customer={customer} /> : null}
      {section === 'contacts' ? (
        <ContactsSection locale={locale} messages={messages} customerId={customer.id} />
      ) : null}
      {section === 'addresses' ? (
        <AddressesSection locale={locale} messages={messages} customerId={customer.id} />
      ) : null}
      {section === 'preferences' ? (
        <PreferencesSection locale={locale} messages={messages} customerId={customer.id} />
      ) : null}
      {section === 'consents' ? (
        <ConsentsSection locale={locale} messages={messages} customerId={customer.id} />
      ) : null}
      {section === 'notes' ? (
        <NotesSection locale={locale} messages={messages} customerId={customer.id} />
      ) : null}
      {section === 'alerts' ? (
        <AlertsSection locale={locale} messages={messages} customerId={customer.id} />
      ) : null}
      {section === 'tags' ? (
        <TagsSection locale={locale} messages={messages} customerId={customer.id} />
      ) : null}
      {section === 'restrictions' ? (
        <RestrictionsSection locale={locale} messages={messages} customerId={customer.id} />
      ) : null}
      {!BUILT.includes(section) ? (
        <p role="status" className="px-2 py-8 text-center text-body text-text-secondary">
          {translate(messages, 'crm.customers.profile.sectionPending')}
        </p>
      ) : null}
    </div>
  );
}

function ProfileHeader({
  messages,
  customer,
}: {
  readonly messages: Messages;
  readonly customer: CustomerDetail;
}) {
  return (
    <header className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-page-title font-semibold text-text-primary">{customer.displayName}</h1>
        {customer.displayNumber ? (
          <code className="font-mono text-caption text-text-secondary">
            {customer.displayNumber}
          </code>
        ) : (
          // Never the uuid. An internal identifier shown where a reference
          // belongs reads to an operator as the customer's number.
          <span className="text-caption text-text-muted">
            {translate(messages, 'crm.customers.create.noNumberYet')}
          </span>
        )}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-3">
        <Fact
          messages={messages}
          labelKey="crm.customers.column.type"
          value={translateDynamic(messages, `crm.partyType.${customer.partyType}`)}
        />
        <Fact
          messages={messages}
          labelKey="crm.customers.column.status"
          value={translateDynamic(messages, `crm.lifecycle.${customer.lifecycleStatus}`)}
        />
        <Fact
          messages={messages}
          labelKey="crm.customers.profile.commercialStatus"
          value={translateDynamic(messages, `crm.commercial.${customer.commercialStatus}`)}
        />
      </dl>
    </header>
  );
}

function Overview({
  messages,
  customer,
}: {
  readonly messages: Messages;
  readonly customer: CustomerDetail;
}) {
  // Individual and company carry different fields, and the other side's are
  // null. Rendering both sets would put four empty rows on every profile.
  const facts =
    customer.partyType === 'individual'
      ? [
          ['crm.customers.create.givenName', customer.givenName],
          ['crm.customers.create.familyName', customer.familyName],
          ['crm.customers.create.preferredLocale', customer.preferredLocale],
        ]
      : [
          ['crm.customers.create.legalName', customer.legalName],
          ['crm.customers.create.tradeName', customer.tradeName],
        ];

  return (
    <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
      {facts.map(([key, value]) => (
        <Fact
          key={key as string}
          messages={messages}
          labelKey={key as string}
          value={
            value ?? (
              <span className="text-text-muted">
                {translate(messages, 'crm.customers.profile.notRecorded')}
              </span>
            )
          }
        />
      ))}
    </dl>
  );
}

function Fact({
  messages,
  labelKey,
  value,
}: {
  readonly messages: Messages;
  readonly labelKey: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-caption text-text-secondary">{translateDynamic(messages, labelKey)}</dt>
      <dd className="text-body text-text-primary">{value}</dd>
    </div>
  );
}

function ContactsSection({
  locale,
  messages,
  customerId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listContacts(customerId, request, cursor),
    [customerId]
  );
  const table = useServerTable<ContactPoint>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<ContactPoint>[]>(
    () => [
      {
        id: 'channel',
        headerKey: 'crm.customers.contacts.channel',
        cell: (row) => translateDynamic(messages, `crm.channel.${row.channel}`),
      },
      {
        id: 'value',
        headerKey: 'crm.customers.contacts.value',
        // `rawValue` is what the operator typed; the normalised form is the
        // lookup key and is not the thing to show a person. Falling back to it
        // is right when only the normalised form was kept.
        cell: (row) => <span dir="ltr">{row.rawValue ?? row.normalizedValue}</span>,
      },
      {
        id: 'label',
        headerKey: 'crm.customers.contacts.label',
        cell: (row) => row.label ?? <span className="text-text-muted">—</span>,
      },
      {
        id: 'isPrimary',
        headerKey: 'crm.customers.contacts.primary',
        cell: (row) =>
          row.isPrimary ? translate(messages, 'crm.customers.profile.yes') : <span>—</span>,
      },
      {
        id: 'status',
        headerKey: 'crm.customers.column.status',
        cell: (row) => translateDynamic(messages, `crm.contactStatus.${row.status}`),
      },
    ],
    [messages]
  );

  return (
    <section aria-labelledby="crm-contacts-heading" className="flex min-h-0 flex-col">
      <h2 id="crm-contacts-heading" className="sr-only">
        {translate(messages, 'crm.customers.profile.section.contacts')}
      </h2>
      <DataTable<ContactPoint>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'crm.customers.contacts.caption')}
      />
      <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'crm.customers.contacts.softDeleteNote')}
      </p>
    </section>
  );
}

function AddressesSection({
  locale,
  messages,
  customerId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listAddresses(customerId, request, cursor),
    [customerId]
  );
  const table = useServerTable<Address>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<Address>[]>(
    () => [
      {
        id: 'addressType',
        headerKey: 'crm.customers.addresses.type',
        cell: (row) => translateDynamic(messages, `crm.addressType.${row.addressType}`),
      },
      {
        id: 'address',
        headerKey: 'crm.customers.addresses.address',
        // Lines in published order, empties dropped. No country-specific
        // reordering is invented — the platform serves more than one country
        // and a guess is subtly wrong for everyone it was not written for.
        cell: (row) => (
          <span className="whitespace-pre-line break-words">{addressLines(row).join('\n')}</span>
        ),
      },
      {
        id: 'isPrimary',
        headerKey: 'crm.customers.contacts.primary',
        cell: (row) =>
          row.isPrimary ? translate(messages, 'crm.customers.profile.yes') : <span>—</span>,
      },
      {
        id: 'status',
        headerKey: 'crm.customers.column.status',
        cell: (row) => translateDynamic(messages, `crm.contactStatus.${row.status}`),
      },
    ],
    [messages]
  );

  return (
    <section aria-labelledby="crm-addresses-heading" className="flex min-h-0 flex-col">
      <h2 id="crm-addresses-heading" className="sr-only">
        {translate(messages, 'crm.customers.profile.section.addresses')}
      </h2>
      <DataTable<Address>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'crm.customers.addresses.caption')}
      />
      <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'crm.customers.addresses.softDeleteNote')}
      </p>
    </section>
  );
}

/**
 * The shape every component section shares: heading, bounded table, footnote.
 *
 * Written once because eight copies of it drift. The footnote is not decoration
 * — each of these lists is filtered by the backend in a way the rows themselves
 * do not reveal, and a list that silently omits rows while looking complete is
 * the failure mode this whole screen is guarding against.
 */
function ComponentSection<Row>({
  id,
  locale,
  messages,
  titleKey,
  captionKey,
  footnote,
  load,
  columns,
}: {
  readonly id: string;
  readonly locale: Locale;
  readonly messages: Messages;
  readonly titleKey: string;
  readonly captionKey: string;
  readonly footnote: React.ReactNode;
  readonly load: (request: TableRequest, cursor: string | null) => Promise<unknown>;
  readonly columns: readonly Column<Row>[];
}) {
  const table = useServerTable<Row>(load as Parameters<typeof useServerTable<Row>>[0], {
    initial: INITIAL_REQUEST,
  });

  return (
    <section aria-labelledby={`${id}-heading`} className="flex min-h-0 flex-col">
      <h2 id={`${id}-heading`} className="sr-only">
        {translateDynamic(messages, titleKey)}
      </h2>
      <DataTable<Row>
        messages={messages}
        columns={columns}
        rowId={(row) => (row as { id: string }).id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translateDynamic(messages, captionKey)}
      />
      <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
        {footnote}
      </p>
    </section>
  );
}

/** `FE-009` — communication preferences. */
function PreferencesSection({
  locale,
  messages,
  customerId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listPreferences(customerId, request, cursor),
    [customerId]
  );

  const columns = useMemo<readonly Column<Preference>[]>(
    () => [
      {
        id: 'channel',
        headerKey: 'crm.customers.contacts.channel',
        cell: (row) => translateDynamic(messages, `crm.channel.${row.channel}`),
      },
      {
        id: 'purpose',
        headerKey: 'crm.customers.preferences.purpose',
        cell: (row) => translateDynamic(messages, `crm.purpose.${row.purpose}`),
      },
      {
        id: 'preferred',
        headerKey: 'crm.customers.preferences.preferred',
        // `preferred` is a boolean and both values are meaningful: false is a
        // recorded decision not to use a channel, not an absence of one. So it
        // renders a word either way rather than a tick and a blank cell.
        cell: (row) =>
          translate(
            messages,
            row.preferred ? 'crm.customers.profile.yes' : 'crm.customers.profile.no'
          ),
      },
      {
        id: 'preferredLocale',
        headerKey: 'crm.customers.create.preferredLocale',
        cell: (row) => row.preferredLocale ?? <span className="text-text-muted">—</span>,
      },
      {
        id: 'quietHoursNote',
        headerKey: 'crm.customers.preferences.quietHours',
        cell: (row) => row.quietHoursNote ?? <span className="text-text-muted">—</span>,
      },
    ],
    [messages]
  );

  return (
    <ComponentSection<Preference>
      id="crm-preferences"
      locale={locale}
      messages={messages}
      titleKey="crm.customers.profile.section.preferences"
      captionKey="crm.customers.preferences.caption"
      // `quiet_hours_note` is a column no write operation can set (`P1-16-A-01`).
      // Showing the field while staying silent about that would leave an
      // operator hunting for an edit control that does not exist.
      footnote={translate(messages, 'crm.customers.preferences.quietHoursReadOnly')}
      load={load}
      columns={columns}
    />
  );
}

/** `FE-010` — consent history. */
function ConsentsSection({
  locale,
  messages,
  customerId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listConsents(customerId, request, cursor),
    [customerId]
  );

  const columns = useMemo<readonly Column<Consent>[]>(
    () => [
      {
        id: 'effectiveAt',
        headerKey: 'crm.customers.consents.effectiveAt',
        cell: (row) => <FormattedInstant locale={locale} value={row.effectiveAt} />,
      },
      {
        id: 'consentKind',
        headerKey: 'crm.customers.consents.kind',
        cell: (row) => translateDynamic(messages, `crm.consentKind.${row.consentKind}`),
      },
      {
        id: 'status',
        headerKey: 'crm.customers.column.status',
        cell: (row) => translateDynamic(messages, `crm.consentStatus.${row.status}`),
      },
      {
        id: 'channel',
        headerKey: 'crm.customers.contacts.channel',
        cell: (row) =>
          row.channel ? (
            translateDynamic(messages, `crm.channel.${row.channel}`)
          ) : (
            <span className="text-text-muted">—</span>
          ),
      },
      {
        id: 'source',
        headerKey: 'crm.customers.consents.source',
        // Rendered EXACTLY as stored. `crm.consent_history.source` is `text`
        // with no CHECK constraint, so its values are open — running it through
        // a translation key would print the raw key on screen the first time a
        // tenant records a source nobody anticipated.
        cell: (row) => row.source ?? <span className="text-text-muted">—</span>,
      },
    ],
    [locale, messages]
  );

  return (
    <ComponentSection<Consent>
      id="crm-consents"
      locale={locale}
      messages={messages}
      titleKey="crm.customers.profile.section.consents"
      captionKey="crm.customers.consents.caption"
      // `crm.consent_history` is append-only: a withdrawal is a new row, never
      // an edit. Presenting it as a current-state list would make a lawful
      // record look like something that can be rewritten.
      footnote={translate(messages, 'crm.customers.consents.appendOnlyNote')}
      load={load}
      columns={columns}
    />
  );
}

/** `FE-011` — notes, which may be incomplete without saying so. */
function NotesSection({
  locale,
  messages,
  customerId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
}) {
  // The one component read whose response carries more than a page. The flag
  // is held here rather than inside `useServerTable` because it is about the
  // caller's permission, not about the table's paging state.
  const [includesRestricted, setIncludesRestricted] = useState<boolean | null>(null);

  const load = useCallback(
    async (request: TableRequest, cursor: string | null) => {
      const page = await listNotes(customerId, request, cursor);
      setIncludesRestricted(page.status === 'ok' ? page.includesRestricted : null);
      return page;
    },
    [customerId]
  );

  const columns = useMemo<readonly Column<Note>[]>(
    () => [
      {
        id: 'createdAt',
        headerKey: 'crm.customers.notes.createdAt',
        cell: (row) => <FormattedInstant locale={locale} value={row.createdAt} />,
      },
      {
        id: 'classification',
        headerKey: 'crm.customers.notes.classification',
        cell: (row) => translateDynamic(messages, `crm.noteClassification.${row.classification}`),
      },
      {
        id: 'body',
        headerKey: 'crm.customers.notes.body',
        cell: (row) => <span className="whitespace-pre-line break-words">{row.body}</span>,
      },
      {
        id: 'editedAt',
        headerKey: 'crm.customers.notes.edited',
        // An edited note is a different evidential object from an original one.
        cell: (row) =>
          row.editedAt ? (
            <FormattedInstant locale={locale} value={row.editedAt} />
          ) : (
            <span className="text-text-muted">—</span>
          ),
      },
    ],
    [locale, messages]
  );

  return (
    <ComponentSection<Note>
      id="crm-notes"
      locale={locale}
      messages={messages}
      titleKey="crm.customers.profile.section.notes"
      captionKey="crm.customers.notes.caption"
      // The whole point of the section. `sel_notes_tenant` drops `restricted`
      // and `secret` rows for a caller without `iam.sensitive.view` and drops
      // them SILENTLY — the list is just shorter. Without this line the screen
      // would present a partial list as the complete record.
      //
      // `null` means no successful read has happened yet, so neither claim is
      // made. Defaulting to "you are seeing everything" would be the lie.
      footnote={
        includesRestricted === null
          ? null
          : translate(
              messages,
              includesRestricted
                ? 'crm.customers.notes.includesRestricted'
                : 'crm.customers.notes.restrictedHidden'
            )
      }
      load={load}
      columns={columns}
    />
  );
}

/** `FE-012` — alerts in force. */
function AlertsSection({
  locale,
  messages,
  customerId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listAlerts(customerId, request, cursor),
    [customerId]
  );

  const columns = useMemo<readonly Column<Alert>[]>(
    () => [
      {
        id: 'severity',
        headerKey: 'crm.customers.alerts.severity',
        // Ranked by meaning, never by label. `severity` is `text` with a CHECK,
        // so an alphabetical sort ranks `info` above `warning`. The backend
        // orders by explicit rank; this only decides how loud each row looks,
        // using the same ranking so the two cannot disagree.
        cell: (row) => (
          <span
            className={
              severityRank(row.severity) === 0
                ? 'font-semibold text-status-danger'
                : severityRank(row.severity) === 1
                  ? 'font-medium text-status-warning'
                  : 'text-text-secondary'
            }
          >
            {translateDynamic(messages, `crm.severity.${row.severity}`)}
          </span>
        ),
      },
      {
        id: 'alertType',
        headerKey: 'crm.customers.alerts.type',
        cell: (row) => translateDynamic(messages, `crm.alertType.${row.alertType}`),
      },
      {
        id: 'message',
        headerKey: 'crm.customers.alerts.message',
        cell: (row) => <span className="break-words">{row.message}</span>,
      },
      {
        id: 'effectiveFrom',
        headerKey: 'crm.customers.alerts.effectiveFrom',
        // A `date` read as `::text`. Printed as stored — parsing it into a JS
        // `Date` to reformat is exactly what shifts the day east of UTC.
        cell: (row) => <span dir="ltr">{row.effectiveFrom}</span>,
      },
      {
        id: 'effectiveTo',
        headerKey: 'crm.customers.alerts.effectiveTo',
        cell: (row) =>
          row.effectiveTo ? (
            <span dir="ltr">{row.effectiveTo}</span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'crm.customers.alerts.openEnded')}
            </span>
          ),
      },
    ],
    [messages]
  );

  return (
    <ComponentSection<Alert>
      id="crm-alerts"
      locale={locale}
      messages={messages}
      titleKey="crm.customers.profile.section.alerts"
      captionKey="crm.customers.alerts.caption"
      // The read returns alerts in force today, not the history. An operator
      // who assumes this is every alert ever raised would read an empty list
      // as "this customer has never had a problem".
      footnote={translate(messages, 'crm.customers.alerts.activeOnlyNote')}
      load={load}
      columns={columns}
    />
  );
}

/** `FE-013` — segment tags. */
function TagsSection({
  locale,
  messages,
  customerId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listTags(customerId, request, cursor),
    [customerId]
  );

  const columns = useMemo<readonly Column<Tag>[]>(
    () => [
      {
        id: 'name',
        headerKey: 'crm.customers.tags.name',
        // The segment's own name, as configured by the tenant. Not translated:
        // inventing a translation key from tenant data would render a raw key
        // string on screen the moment a tenant adds a segment.
        cell: (row) => row.name,
      },
      {
        id: 'segmentCode',
        headerKey: 'crm.customers.tags.code',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.segmentCode}
          </code>
        ),
      },
      {
        id: 'validFrom',
        headerKey: 'crm.customers.tags.validFrom',
        cell: (row) => <span dir="ltr">{row.validFrom}</span>,
      },
      {
        id: 'validTo',
        headerKey: 'crm.customers.tags.validTo',
        cell: (row) =>
          row.validTo ? (
            <span dir="ltr">{row.validTo}</span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'crm.customers.alerts.openEnded')}
            </span>
          ),
      },
    ],
    [messages]
  );

  return (
    <ComponentSection<Tag>
      id="crm-tags"
      locale={locale}
      messages={messages}
      titleKey="crm.customers.profile.section.tags"
      captionKey="crm.customers.tags.caption"
      footnote={translate(messages, 'crm.customers.tags.currentOnlyNote')}
      load={load}
      columns={columns}
    />
  );
}

/**
 * `FE-014` — restrictions.
 *
 * Fails closed. A denial renders the shared denied state and nothing else: no
 * count, no "there are restrictions you cannot see", no partial reason text. A
 * screen that says "3 restrictions hidden" has disclosed that this customer is
 * restricted, which is the fact the permission exists to protect. The shared
 * `DataTable` denied state carries no row data, so this is a property of the
 * section rendering nothing of its own on a denial rather than a filter applied
 * afterwards.
 */
function RestrictionsSection({
  locale,
  messages,
  customerId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listRestrictions(customerId, request, cursor),
    [customerId]
  );

  const columns = useMemo<readonly Column<Restriction>[]>(
    () => [
      {
        id: 'restrictionType',
        headerKey: 'crm.customers.restrictions.type',
        cell: (row) => translateDynamic(messages, `crm.restrictionType.${row.restrictionType}`),
      },
      {
        id: 'reason',
        headerKey: 'crm.customers.restrictions.reason',
        cell: (row) => <span className="break-words">{row.reason}</span>,
      },
      {
        id: 'approvalRef',
        headerKey: 'crm.customers.restrictions.approvalRef',
        cell: (row) =>
          row.approvalRef ? (
            <code className="font-mono text-caption" dir="ltr">
              {row.approvalRef}
            </code>
          ) : (
            <span className="text-text-muted">—</span>
          ),
      },
      {
        id: 'effectiveFrom',
        headerKey: 'crm.customers.alerts.effectiveFrom',
        cell: (row) => <span dir="ltr">{row.effectiveFrom}</span>,
      },
      {
        id: 'effectiveTo',
        headerKey: 'crm.customers.alerts.effectiveTo',
        cell: (row) =>
          row.effectiveTo ? (
            <span dir="ltr">{row.effectiveTo}</span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'crm.customers.alerts.openEnded')}
            </span>
          ),
      },
    ],
    [messages]
  );

  return (
    <ComponentSection<Restriction>
      id="crm-restrictions"
      locale={locale}
      messages={messages}
      titleKey="crm.customers.profile.section.restrictions"
      captionKey="crm.customers.restrictions.caption"
      footnote={translate(messages, 'crm.customers.restrictions.activeOnlyNote')}
      load={load}
      columns={columns}
    />
  );
}

/**
 * A `timestamptz` rendered in the operator's locale.
 *
 * Published as a millisecond ISO string, so it is safe to parse and format for
 * DISPLAY. What is never safe is treating the displayed value as a cursor: the
 * cursor carries microseconds and a millisecond value silently skips rows. That
 * is `P1-27-INT-006`, and it is why nothing here ever feeds a formatted instant
 * back into a request.
 */
function FormattedInstant({ locale, value }: { readonly locale: Locale; readonly value: string }) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    // An unparseable timestamp is shown raw rather than as "Invalid Date".
    return <span dir="ltr">{value}</span>;
  }
  return (
    <time dateTime={value} dir="ltr">
      {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)}
    </time>
  );
}
