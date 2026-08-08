'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  addNoteAction,
  assignTagAction,
  imposeRestrictionAction,
  raiseAlertAction,
  recordConsentAction,
  setCustomerStatusAction,
  setPreferenceAction,
} from '../governance-actions';
import {
  allowedTransitions,
  isConsequentialTransition,
  ALERT_SEVERITIES,
  ALERT_TYPES,
  COMMUNICATION_PURPOSES,
  CONSENT_KINDS,
  MAX_ALERT_MESSAGE,
  MAX_APPROVAL_REF,
  MAX_CONSENT_SOURCE,
  MAX_NOTE_BODY,
  MAX_PREFERRED_LOCALE,
  MAX_REASON,
  MAX_SEGMENT_CODE,
  MAX_SEGMENT_NAME,
  NOTE_CLASSIFICATIONS,
  NOTE_VISIBILITIES,
  RECORDABLE_CONSENT_STATUSES,
  RESTRICTION_TYPES,
  NO_WRITES,
  type WritePermits,
} from '../governance-contract';
import { addAddressAction, addContactAction } from '../profile-actions';
import { listTimeline } from '../identity-api';
import type { TimelineEntry } from '../identity-contract';
import { RecordForm } from './RecordForm';
import {
  addressLines,
  ADDRESS_TYPES,
  CONTACT_CHANNELS,
  MAX_ADDRESS_LINE,
  MAX_CONTACT_VALUE,
  MAX_LABEL,
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

/**
 * Sections with a screen today. The rest render an honest "not yet" state.
 *
 * `vehicles` is the last one outstanding and belongs to `FE-025`, which cannot
 * be built until the Vehicle waves land — it lists a customer's vehicles, and
 * there is no vehicle screen to link to yet.
 */
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
  'timeline',
];

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customer: CustomerDetail;
  /**
   * Which of the nine customer writes this session may attempt, from
   * `permittedWrites(session.permissions)` on the server.
   *
   * One map rather than nine booleans, and it replaced a lone `canManageStatus`
   * — the single write that had a gate, while the other eight rendered for
   * anyone who could open the page (`P1-27-SEC-001`). Defaulting to `NO_WRITES`
   * means a caller that forgets it shows a read-only profile rather than a full
   * set of controls that 403.
   */
  readonly writes?: WritePermits;
}

export function CustomerProfileScreen({ locale, messages, customer, writes = NO_WRITES }: Props) {
  const [section, setSection] = useState<Section>('overview');

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <ProfileHeader
        locale={locale}
        messages={messages}
        customer={customer}
        canManageStatus={writes.status}
      />

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
                      ? 'border-b-2 border-primary font-medium text-text-primary'
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
      {/* Each section is handed its OWN capability, never a summary. A role that
          may add a note very often may not impose a restriction, and `writes`
          keeps those two answers apart all the way down. */}
      {section === 'contacts' ? (
        <ContactsSection
          locale={locale}
          messages={messages}
          customerId={customer.id}
          canWrite={writes.contact}
        />
      ) : null}
      {section === 'addresses' ? (
        <AddressesSection
          locale={locale}
          messages={messages}
          customerId={customer.id}
          canWrite={writes.address}
        />
      ) : null}
      {section === 'preferences' ? (
        <PreferencesSection
          locale={locale}
          messages={messages}
          customerId={customer.id}
          canWrite={writes.preference}
        />
      ) : null}
      {section === 'consents' ? (
        <ConsentsSection
          locale={locale}
          messages={messages}
          customerId={customer.id}
          canWrite={writes.consent}
        />
      ) : null}
      {section === 'notes' ? (
        <NotesSection
          locale={locale}
          messages={messages}
          customerId={customer.id}
          canWrite={writes.note}
        />
      ) : null}
      {section === 'alerts' ? (
        <AlertsSection
          locale={locale}
          messages={messages}
          customerId={customer.id}
          canWrite={writes.alert}
        />
      ) : null}
      {section === 'tags' ? (
        <TagsSection
          locale={locale}
          messages={messages}
          customerId={customer.id}
          canWrite={writes.tag}
        />
      ) : null}
      {section === 'restrictions' ? (
        <RestrictionsSection
          locale={locale}
          messages={messages}
          customerId={customer.id}
          canWrite={writes.restriction}
        />
      ) : null}
      {section === 'timeline' ? (
        <TimelineSection locale={locale} messages={messages} customerId={customer.id} />
      ) : null}
      {!BUILT.includes(section) ? (
        <p role="status" className="px-2 py-8 text-center text-body text-text-secondary">
          {translate(messages, 'crm.customers.profile.sectionPending')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Change the customer's lifecycle status.
 *
 * The header has shown `lifecycleStatus` since the profile shipped and offered
 * no way to change it, while `crm.customer-status-set` sat registered,
 * permission-covered and called from nowhere. The phase's own traceability
 * recorded it as attributed to "CRM profile surface — Not called", and no
 * approved decision anywhere says direct status editing should not exist: the
 * two operations that ARE deliberately absent carry a decision reference
 * (`P1-OD-017` for both merges). This was an omission.
 *
 * ## Only the moves that can succeed
 *
 * The target list comes from `allowedTransitions(current)`, mirroring the
 * server's `LIFECYCLE_TRANSITIONS`. Offering all four and letting two of them
 * 422 would show an operator a control that fails for reasons the error cannot
 * explain. `merged` appears in no list at all — a merge is not a status somebody
 * assigns.
 *
 * ## Blocking asks twice
 *
 * `isConsequentialTransition` singles out `blocked`, because it is the one move
 * that stops the workshop serving a real customer. Confirming every transition
 * would train an operator to click through the one that matters.
 */
function StatusChangeForm({
  locale,
  messages,
  customer,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customer: CustomerDetail;
}) {
  const router = useRouter();
  const [target, setTarget] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const targets = allowedTransitions(customer.lifecycleStatus);

  if (targets.length === 0) {
    // A merged customer, or a state the server does not let anyone leave.
    // Saying so beats an empty select nobody can use.
    return (
      <p className="mt-3 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'crm.customers.status.terminal')}
      </p>
    );
  }

  const needsConfirmation = isConsequentialTransition(target);

  return (
    <div className="mt-4">
      <RecordForm
        messages={messages}
        titleKey="crm.customers.status.change"
        submitKey="crm.customers.status.change"
        action={setCustomerStatusAction.bind(null, customer.id)}
        onRecorded={() => {
          setTarget('');
          setConfirmed(false);
          // The status lives in the page's own server-side read, so there is no
          // client fetch to re-run. A router refresh is the only thing that can
          // show the new value in the header above.
          router.refresh();
        }}
        guard={() =>
          needsConfirmation && !confirmed
            ? { lifecycleStatus: 'crm.customers.status.confirmRequired' }
            : null
        }
        prelude={(state) => (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-caption text-text-secondary">
              {translate(messages, 'crm.customers.status.newStatus')}
              <select
                name="lifecycleStatus"
                required
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                  // A changed target un-confirms: agreeing to block somebody and
                  // then switching to "inactive" must not carry the tick over.
                  setConfirmed(false);
                }}
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-body text-text-primary"
              >
                <option value="">{translate(messages, 'form.select.placeholder')}</option>
                {targets.map((value) => (
                  <option key={value} value={value}>
                    {translateDynamic(messages, `crm.lifecycle.${value}`)}
                  </option>
                ))}
              </select>
            </label>

            {needsConfirmation ? (
              <label className="flex items-start gap-2 text-body text-text-primary">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-1 size-4 accent-primary"
                />
                <span>{translate(messages, 'crm.customers.status.confirmBlock')}</span>
              </label>
            ) : null}

            {state.fieldErrors?.lifecycleStatus ? (
              <p role="alert" className="text-caption text-error">
                {translateDynamic(messages, state.fieldErrors.lifecycleStatus)}
              </p>
            ) : null}
          </div>
        )}
        fields={[
          {
            name: 'reason',
            kind: 'textarea',
            labelKey: 'crm.customers.restrictions.reason',
            required: true,
            maxLength: MAX_REASON,
            hintKey: 'crm.customers.status.reasonHint',
          },
        ]}
      />
    </div>
  );
}

function ProfileHeader({
  locale,
  messages,
  customer,
  canManageStatus,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customer: CustomerDetail;
  readonly canManageStatus: boolean;
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

      {canManageStatus ? (
        <StatusChangeForm locale={locale} messages={messages} customer={customer} />
      ) : null}
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
  canWrite,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
  readonly canWrite: boolean;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listContacts(customerId, request, cursor),
    [customerId]
  );
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

  // Uses `ComponentSection` for the same reason the six governance sections do:
  // it owns the one correct form gate. Before `FE-007`'s write was wired this
  // section had its own `<section>` + `DataTable`, because it had no form to gate.
  return (
    <ComponentSection<ContactPoint>
      id="crm-contacts"
      canWrite={canWrite}
      locale={locale}
      messages={messages}
      titleKey="crm.customers.profile.section.contacts"
      captionKey="crm.customers.contacts.caption"
      footnote={translate(messages, 'crm.customers.contacts.softDeleteNote')}
      load={load}
      columns={columns}
      form={(onRecorded) => (
        <RecordForm
          messages={messages}
          titleKey="crm.customers.contacts.add"
          submitKey="crm.customers.contacts.add"
          onRecorded={onRecorded}
          action={addContactAction.bind(null, customerId)}
          fields={[
            {
              name: 'channel',
              kind: 'select',
              labelKey: 'crm.customers.contacts.channel',
              required: true,
              options: CONTACT_CHANNELS,
              optionKeyPrefix: 'crm.channel.',
            },
            {
              name: 'value',
              kind: 'text',
              labelKey: 'crm.customers.contacts.value',
              required: true,
              maxLength: MAX_CONTACT_VALUE,
            },
            {
              name: 'label',
              kind: 'text',
              labelKey: 'crm.customers.contacts.label',
              maxLength: MAX_LABEL,
            },
            {
              name: 'isPrimary',
              kind: 'checkbox',
              labelKey: 'crm.customers.contacts.primary',
            },
          ]}
        />
      )}
    />
  );
}

function AddressesSection({
  locale,
  messages,
  customerId,
  canWrite,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
  readonly canWrite: boolean;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listAddresses(customerId, request, cursor),
    [customerId]
  );
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
    <ComponentSection<Address>
      id="crm-addresses"
      canWrite={canWrite}
      locale={locale}
      messages={messages}
      titleKey="crm.customers.profile.section.addresses"
      captionKey="crm.customers.addresses.caption"
      footnote={translate(messages, 'crm.customers.addresses.softDeleteNote')}
      load={load}
      columns={columns}
      form={(onRecorded) => (
        <RecordForm
          messages={messages}
          titleKey="crm.customers.addresses.add"
          submitKey="crm.customers.addresses.add"
          onRecorded={onRecorded}
          action={addAddressAction.bind(null, customerId)}
          fields={[
            {
              name: 'addressType',
              kind: 'select',
              labelKey: 'crm.customers.addresses.type',
              required: true,
              options: ADDRESS_TYPES,
              optionKeyPrefix: 'crm.addressType.',
            },
            {
              name: 'line1',
              kind: 'text',
              labelKey: 'crm.customers.addresses.line1',
              required: true,
              maxLength: MAX_ADDRESS_LINE,
            },
            {
              name: 'line2',
              kind: 'text',
              labelKey: 'crm.customers.addresses.line2',
              maxLength: MAX_ADDRESS_LINE,
            },
            {
              name: 'city',
              kind: 'text',
              labelKey: 'crm.customers.addresses.city',
              maxLength: MAX_ADDRESS_LINE,
            },
            {
              name: 'region',
              kind: 'text',
              labelKey: 'crm.customers.addresses.region',
              maxLength: MAX_ADDRESS_LINE,
            },
            {
              name: 'postalCode',
              kind: 'text',
              labelKey: 'crm.customers.addresses.postalCode',
              maxLength: 20,
            },
            {
              // Two letters, and no country is defaulted. An address with no
              // country recorded is a state the contract permits, and guessing
              // one from the tenant would silently attribute a foreign address
              // to it.
              name: 'countryCode',
              kind: 'text',
              labelKey: 'crm.customers.addresses.country',
              maxLength: 2,
              hintKey: 'crm.customers.addresses.countryHint',
            },
            {
              name: 'isPrimary',
              kind: 'checkbox',
              labelKey: 'crm.customers.contacts.primary',
            },
          ]}
        />
      )}
    />
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
  canWrite,
  form,
}: {
  readonly id: string;
  readonly locale: Locale;
  readonly messages: Messages;
  readonly titleKey: string;
  readonly captionKey: string;
  readonly footnote: React.ReactNode;
  readonly load: (request: TableRequest, cursor: string | null) => Promise<unknown>;
  readonly columns: readonly Column<Row>[];
  /**
   * Whether this session holds the capability THIS section's write needs, from
   * `permittedWrites`. Required rather than optional on purpose: a defaulted
   * `canWrite` would let a new section be added without deciding, which is
   * precisely how eight of these forms came to be ungated.
   */
  readonly canWrite: boolean;
  /** The write form, handed a callback that re-reads the list after a success. */
  readonly form?: (onRecorded: () => void) => React.ReactNode;
}) {
  const table = useServerTable<Row>(load as Parameters<typeof useServerTable<Row>>[0], {
    initial: INITIAL_REQUEST,
  });

  return (
    <section aria-labelledby={`${id}-heading`} className="flex min-h-0 flex-col gap-4">
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
      <p className="px-2 text-caption text-text-muted" lang={locale}>
        {footnote}
      </p>
      {/* The form appears only when the READ succeeded AND this session holds
          the write capability. Both are security properties rather than tidiness
          ones, and for a while only the first was here.

          Every one of these sections needs `crm.customer.read` to list and a
          STRONGER capability to write. So a caller who was denied the list
          certainly cannot write, and rendering the form for them would both
          invite an action guaranteed to fail and disclose the vocabulary the
          denial exists to hide — a restrictions form names `no_credit` and
          `contact_restriction` in its options whether or not a row was ever
          returned. This was caught by the fail-closed test, which started
          failing the moment the form was wired in.

          The read gate alone was NOT enough, and the reasoning above says why
          without following it through: "a stronger capability to write" means
          a caller who passed the read gate may still hold none of the eight
          write capabilities. `crm.customer.read` is exactly the permission the
          profile page already requires, so before `canWrite` every operator who
          could open a customer was offered every write form on it — including
          the restrictions form and its vocabulary. The one section that had a
          real gate was lifecycle status, and it sat in the header rather than
          here (`P1-27-SEC-001`).

          Both conditions live at this single point deliberately. Eight sections
          each deciding for themselves is eight chances to decide wrong, and the
          evidence is that eight of nine did.

          The list is RE-READ after a write rather than patched locally: the row
          the backend stored is the one to show, and a locally appended row would
          be missing the id, the timestamps and every default the server
          applied.

          Gated on `response`, not on a status string. `TableStatus` has no
          `'ok'` member — a loaded, undenied read is `'idle'` — so
          `status === 'ok'` is ALWAYS FALSE and reads exactly like a working
          fail-closed guard while rendering the form precisely never. That was
          the first version of this line, and only the inverse test ("does offer
          the form when the read succeeded") could tell the difference.
          `response` is non-null iff the page came back `ok`. */}
      {table.response && canWrite ? form?.(table.refresh) : null}
    </section>
  );
}

/** `FE-009` — communication preferences. */
function PreferencesSection({
  locale,
  messages,
  customerId,
  canWrite,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
  readonly canWrite: boolean;
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
      canWrite={canWrite}
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
      form={(onRecorded) => (
        <RecordForm
          messages={messages}
          titleKey="crm.customers.preferences.set"
          submitKey="crm.customers.preferences.set"
          onRecorded={onRecorded}
          action={setPreferenceAction.bind(null, customerId)}
          fields={[
            {
              name: 'channel',
              kind: 'select',
              labelKey: 'crm.customers.contacts.channel',
              required: true,
              options: CONTACT_CHANNELS,
              optionKeyPrefix: 'crm.channel.',
            },
            {
              name: 'purpose',
              kind: 'select',
              labelKey: 'crm.customers.preferences.purpose',
              required: true,
              options: COMMUNICATION_PURPOSES,
              optionKeyPrefix: 'crm.purpose.',
            },
            {
              name: 'preferred',
              kind: 'checkbox',
              labelKey: 'crm.customers.preferences.preferred',
            },
            {
              name: 'preferredLocale',
              kind: 'text',
              labelKey: 'crm.customers.create.preferredLocale',
              maxLength: MAX_PREFERRED_LOCALE,
              hintKey: 'crm.customers.preferences.localeHint',
            },
          ]}
        />
      )}
    />
  );
}

/** `FE-010` — consent history. */
function ConsentsSection({
  locale,
  messages,
  customerId,
  canWrite,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
  readonly canWrite: boolean;
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
      canWrite={canWrite}
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
      form={(onRecorded) => (
        <RecordForm
          messages={messages}
          titleKey="crm.customers.consents.record"
          submitKey="crm.customers.consents.record"
          onRecorded={onRecorded}
          action={recordConsentAction.bind(null, customerId)}
          fields={[
            {
              name: 'consentKind',
              kind: 'select',
              labelKey: 'crm.customers.consents.kind',
              required: true,
              options: CONSENT_KINDS,
              optionKeyPrefix: 'crm.consentKind.',
            },
            {
              name: 'status',
              kind: 'select',
              labelKey: 'crm.customers.column.status',
              required: true,
              // TWO options, not the three a consent row can hold. `expired` is
              // a system transition and is deliberately not offered.
              options: RECORDABLE_CONSENT_STATUSES,
              optionKeyPrefix: 'crm.consentStatus.',
              hintKey: 'crm.customers.consents.statusHint',
            },
            {
              name: 'channel',
              kind: 'select',
              labelKey: 'crm.customers.contacts.channel',
              required: true,
              options: CONTACT_CHANNELS,
              optionKeyPrefix: 'crm.channel.',
            },
            {
              name: 'purpose',
              kind: 'select',
              labelKey: 'crm.customers.preferences.purpose',
              required: true,
              options: COMMUNICATION_PURPOSES,
              optionKeyPrefix: 'crm.purpose.',
            },
            {
              name: 'source',
              kind: 'text',
              labelKey: 'crm.customers.consents.source',
              maxLength: MAX_CONSENT_SOURCE,
              hintKey: 'crm.customers.consents.sourceHint',
            },
          ]}
        />
      )}
    />
  );
}

/** `FE-011` — notes, which may be incomplete without saying so. */
function NotesSection({
  locale,
  messages,
  customerId,
  canWrite,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
  readonly canWrite: boolean;
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
      canWrite={canWrite}
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
      form={(onRecorded) => (
        <RecordForm
          messages={messages}
          titleKey="crm.customers.notes.add"
          submitKey="crm.customers.notes.add"
          onRecorded={onRecorded}
          action={addNoteAction.bind(null, customerId)}
          fields={[
            {
              name: 'body',
              kind: 'textarea',
              labelKey: 'crm.customers.notes.body',
              required: true,
              maxLength: MAX_NOTE_BODY,
            },
            {
              name: 'classification',
              kind: 'select',
              labelKey: 'crm.customers.notes.classification',
              options: NOTE_CLASSIFICATIONS,
              optionKeyPrefix: 'crm.noteClassification.',
              // Said before the operator chooses, not after. Picking
              // `restricted` decides who can ever read this note again.
              hintKey: 'crm.customers.notes.classificationHint',
            },
            {
              name: 'visibility',
              kind: 'select',
              labelKey: 'crm.customers.notes.visibility',
              options: NOTE_VISIBILITIES,
              optionKeyPrefix: 'crm.noteVisibility.',
            },
          ]}
        />
      )}
    />
  );
}

/** `FE-012` — alerts in force. */
function AlertsSection({
  locale,
  messages,
  customerId,
  canWrite,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
  readonly canWrite: boolean;
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
                ? 'font-semibold text-error'
                : severityRank(row.severity) === 1
                  ? 'font-medium text-warning'
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
      canWrite={canWrite}
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
      form={(onRecorded) => (
        <RecordForm
          messages={messages}
          titleKey="crm.customers.alerts.raise"
          submitKey="crm.customers.alerts.raise"
          onRecorded={onRecorded}
          action={raiseAlertAction.bind(null, customerId)}
          fields={[
            {
              name: 'alertType',
              kind: 'select',
              labelKey: 'crm.customers.alerts.type',
              required: true,
              options: ALERT_TYPES,
              optionKeyPrefix: 'crm.alertType.',
            },
            {
              name: 'severity',
              kind: 'select',
              labelKey: 'crm.customers.alerts.severity',
              required: true,
              // Offered in RANK order, not the constraint's declaration order
              // and not alphabetically. The list an operator scans should read
              // the way the severity actually escalates.
              options: [...ALERT_SEVERITIES].sort((a, b) => severityRank(a) - severityRank(b)),
              optionKeyPrefix: 'crm.severity.',
            },
            {
              name: 'message',
              kind: 'textarea',
              labelKey: 'crm.customers.alerts.message',
              required: true,
              maxLength: MAX_ALERT_MESSAGE,
            },
          ]}
        />
      )}
    />
  );
}

/** `FE-013` — segment tags. */
function TagsSection({
  locale,
  messages,
  customerId,
  canWrite,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
  readonly canWrite: boolean;
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
      canWrite={canWrite}
      locale={locale}
      messages={messages}
      titleKey="crm.customers.profile.section.tags"
      captionKey="crm.customers.tags.caption"
      footnote={translate(messages, 'crm.customers.tags.currentOnlyNote')}
      load={load}
      columns={columns}
      form={(onRecorded) => (
        <RecordForm
          messages={messages}
          titleKey="crm.customers.tags.assign"
          submitKey="crm.customers.tags.assign"
          onRecorded={onRecorded}
          action={assignTagAction.bind(null, customerId)}
          fields={[
            {
              name: 'segmentCode',
              kind: 'text',
              labelKey: 'crm.customers.tags.code',
              required: true,
              maxLength: MAX_SEGMENT_CODE,
              hintKey: 'crm.customers.tags.codeHint',
            },
            {
              name: 'name',
              kind: 'text',
              labelKey: 'crm.customers.tags.name',
              maxLength: MAX_SEGMENT_NAME,
            },
          ]}
        />
      )}
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
  canWrite,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
  readonly canWrite: boolean;
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
      canWrite={canWrite}
      locale={locale}
      messages={messages}
      titleKey="crm.customers.profile.section.restrictions"
      captionKey="crm.customers.restrictions.caption"
      footnote={translate(messages, 'crm.customers.restrictions.activeOnlyNote')}
      load={load}
      columns={columns}
      form={(onRecorded) => (
        <RecordForm
          messages={messages}
          titleKey="crm.customers.restrictions.impose"
          submitKey="crm.customers.restrictions.impose"
          onRecorded={onRecorded}
          action={imposeRestrictionAction.bind(null, customerId)}
          fields={[
            {
              name: 'restrictionType',
              kind: 'select',
              labelKey: 'crm.customers.restrictions.type',
              required: true,
              options: RESTRICTION_TYPES,
              optionKeyPrefix: 'crm.restrictionType.',
            },
            {
              name: 'reason',
              kind: 'textarea',
              labelKey: 'crm.customers.restrictions.reason',
              required: true,
              maxLength: MAX_REASON,
              // The ten-character floor is stated up front. Discovering it only
              // after submitting a two-word reason is a worse experience than
              // being told, and the floor exists for a real reason.
              hintKey: 'crm.customers.restrictions.reasonHint',
            },
            {
              name: 'approvalRef',
              kind: 'text',
              labelKey: 'crm.customers.restrictions.approvalRef',
              maxLength: MAX_APPROVAL_REF,
            },
          ]}
        />
      )}
    />
  );
}

/**
 * `FE-015` — the customer timeline.
 *
 * Read-only, and there is no write anywhere near it. `crm.timeline_events` is
 * written by the operations that cause the events; a control that let an
 * operator author a timeline entry directly would let them write history that
 * never happened, which is the one thing a timeline must not permit.
 */
function TimelineSection({
  locale,
  messages,
  customerId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly customerId: string;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listTimeline(customerId, request, cursor),
    [customerId]
  );

  const columns = useMemo<readonly Column<TimelineEntry>[]>(
    () => [
      {
        id: 'occurredAt',
        headerKey: 'crm.customers.timeline.occurredAt',
        cell: (row) => <FormattedInstant locale={locale} value={row.occurredAt} />,
      },
      {
        id: 'eventType',
        headerKey: 'crm.customers.timeline.event',
        cell: (row) => translateDynamic(messages, `crm.timelineEvent.${row.eventType}`),
      },
      {
        id: 'title',
        headerKey: 'crm.customers.timeline.title',
        // The backend's own summary line, shown as written. It is capped at 200
        // characters and is never blank.
        cell: (row) => <span className="break-words">{row.title}</span>,
      },
      {
        id: 'actor',
        headerKey: 'crm.customers.timeline.actor',
        /*
         * Three states, and the middle one used to be a uuid.
         *
         * This cell rendered `row.actorId` directly — a raw identifier under a
         * column headed "Recorded by", which names nobody and is exactly the
         * defect `P1-27-INT-026` fixed on the vehicle attribute ledger. That
         * remediation was scoped to the finding that raised it rather than to
         * the property it established, so the customer timeline — same shape,
         * same header, same backend publishing an id and no name — was never
         * swept.
         *
         *   actorId == null   a SYSTEM event. A real distinction worth keeping:
         *                     "the system expired this consent" is not
         *                     "somebody withdrew it".
         *   actorName present the person, named.
         *   otherwise         a phrase. `undefined` means the API predates the
         *                     identity surface and `null` means this caller may
         *                     not be told; neither is a licence to print the id.
         */
        cell: (row) => {
          if (row.actorId == null) {
            return (
              <span className="text-text-muted">
                {translate(messages, 'crm.customers.timeline.system')}
              </span>
            );
          }
          return typeof row.actorName === 'string' && row.actorName.trim().length > 0 ? (
            row.actorName
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'crm.customers.timeline.actorUnavailable')}
            </span>
          );
        },
      },
    ],
    [locale, messages]
  );

  return (
    <ComponentSection<TimelineEntry>
      id="crm-timeline"
      // The timeline is a read. It passes no `form`, so this only makes the
      // absence deliberate rather than accidental — `canWrite` is required
      // precisely so a section cannot skip the question.
      canWrite={false}
      locale={locale}
      messages={messages}
      titleKey="crm.customers.profile.section.timeline"
      captionKey="crm.customers.timeline.caption"
      // Newest first, and paged. An operator who sees ten events must not read
      // that as "ten things have ever happened to this customer".
      footnote={translate(messages, 'crm.customers.timeline.orderNote')}
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
