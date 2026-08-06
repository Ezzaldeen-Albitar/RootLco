'use client';

import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import type { DocumentsState } from '../documents-api';
import { MEDIA_BLOCKING_DECISION } from '../documents-contract';

/**
 * Vehicle documents (`FE-026`) and media (`FE-027`).
 *
 * Both halves are mostly about refusing to imply capability the platform does
 * not have — see `documents-contract.ts` for the full contract reasoning.
 */

export function VehicleDocumentsSection({
  locale,
  messages,
  state,
  canListDocuments,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly state: DocumentsState;
  readonly canListDocuments: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="vehicle-documents-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2
          id="vehicle-documents-heading"
          className="text-section-title font-medium text-text-primary"
        >
          {translate(messages, 'vehicles.documents.heading')}
        </h2>

        {!canListDocuments ? (
          // Named, not blank. This tab needs `shared.document.manage` — a manage
          // capability from a different module — while every other vehicle
          // section needs `veh.vehicle.read`. An operator who can see the whole
          // vehicle and not this list deserves to know which capability is
          // missing rather than to see an empty panel.
          <p className="mt-2 text-body text-text-secondary" lang={locale}>
            {translate(messages, 'vehicles.documents.needsOtherPermission')}
          </p>
        ) : state.status === 'ok' ? (
          state.documentIds.length === 0 ? (
            <p className="mt-2 text-body text-text-secondary" lang={locale}>
              {translate(messages, 'vehicles.documents.none')}
            </p>
          ) : (
            <>
              <p className="mt-2 text-body text-text-secondary" lang={locale}>
                {/* The count is real — the operation returns the whole list, so
                    this is not a page of an unknown total. */}
                {translate(messages, 'vehicles.documents.countPrefix')}{' '}
                <strong dir="ltr">{state.documentIds.length}</strong>
              </p>
              <ul className="mt-3 flex flex-col gap-1">
                {state.documentIds.map((id) => (
                  <li key={id}>
                    {/* A reference, presented as a reference. The operation
                        publishes ids and nothing else — no filename, size, type
                        or date — so a table of these would be a uuid list
                        wearing a table. */}
                    <code className="font-mono text-caption text-text-secondary" dir="ltr">
                      {id}
                    </code>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-caption text-text-muted" lang={locale}>
                {translate(messages, 'vehicles.documents.noMetadata')}
              </p>
            </>
          )
        ) : state.status === 'not-found' ? (
          <p className="mt-2 text-body text-text-secondary" lang={locale}>
            {translate(messages, 'vehicles.documents.vehicleNotFound')}
          </p>
        ) : (
          <p role="alert" className="mt-2 text-body text-error">
            {translate(messages, 'vehicles.documents.readFailed')}
            {state.correlationId ? (
              <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
            ) : null}
          </p>
        )}

        <p className="mt-3 text-caption text-text-muted" lang={locale}>
          {/* No download control, and no prefetching of one.
              `shared.attachment-download-authorize` is `auditClass: 'security'`,
              so warming a link would write a security audit record for a
              download nobody performed. */}
          {translate(messages, 'vehicles.documents.downloadNote')}
        </p>
      </section>

      <section
        aria-labelledby="vehicle-media-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="vehicle-media-heading" className="text-section-title font-medium text-text-primary">
          {translate(messages, 'vehicles.media.heading')}
        </h2>
        <p className="mt-2 text-body text-text-secondary" lang={locale}>
          {/* No control at all — not a disabled one. A greyed-out upload button
              advertises a capability the product does not have and cannot have
              until P1-OD-025 decides accepted types, size limits and storage
              placement. */}
          {translate(messages, 'vehicles.media.blocked')}
        </p>
        <p className="mt-2 text-caption text-text-muted" dir="ltr">
          {MEDIA_BLOCKING_DECISION}
        </p>
      </section>
    </div>
  );
}
