'use client';

import { useCallback, useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { listAddresses, listContacts } from '../profile-api';
import {
  addressLines,
  type Address,
  type ContactPoint,
  type CustomerDetail,
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
const BUILT: readonly Section[] = ['overview', 'contacts', 'addresses'];

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
