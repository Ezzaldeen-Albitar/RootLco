'use client';

import Link from 'next/link';

import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { formatDate, formatInteger } from '@/lib/format';

import type { WarrantyRecord } from '../warranty-contract';
import {
  ConfigurationStatusLabel,
  CoveredScopeLabel,
  Distance,
  Fact,
  ItemKindLabel,
  Reference,
  Section,
  WarrantyStatusLabel,
} from './shared';

/**
 * One warranty record (P1-31, FE-008).
 *
 * Four sections, in the order an operator asks the questions: what state is this
 * warranty in and how long does it run; under which policy; on what terms; and over
 * which jobs and parts.
 *
 * ## Nothing here is derived
 *
 * The screen does not decide whether cover is still live, does not compare the
 * expiry against today, does not subtract the issue reading from the limit, and does
 * not convert a duration into an end date. `status`, `startDate`, `expiryDate` and
 * both odometer figures are the backend's, and a second opinion computed here would
 * disagree with the authority at exactly the moment it mattered — the day the cover
 * lapses. The status is reported verbatim; `claimed_against` is a legal value of the
 * check constraint that nothing in this phase can write.
 *
 * ## The two odometer figures are labelled apart
 *
 * The record's limit is the ABSOLUTE reading at which cover lapses. The coverage's
 * allowance is the RELATIVE distance the coverage grants. They are the same column
 * name in two tables, and showing them under one label is how a warranty quietly
 * becomes wrong. Neither carries a unit, because neither read publishes one.
 *
 * ## Identifiers stay identifiers, with one exception that is not one
 *
 * The vehicle, the work order and the handover are bare references and this screen
 * resolves none of them to a name. The handover gets a link because a handover screen
 * exists to link to, and the work order likewise; a link is navigation, not a name.
 * The policy is shown by its own code and name because the read carries both.
 *
 * ## No money, and no claim history
 *
 * The warranty schema holds no amount, no currency and no cap in any unit of account,
 * so there is no figure to show and none is invented. There is no claim table in any
 * schema either, so there is no claim history to render.
 */
export function WarrantyRecordScreen({
  locale,
  messages,
  warranty,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The page's own read. */
  readonly warranty: WarrantyRecord;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-6">
      <Section
        headingId="warranty-summary-heading"
        titleKey="warranty.summary.heading"
        messages={messages}
      >
        <div className="flex flex-col gap-3">
          <Fact label={translate(messages, 'warranty.summary.status')}>
            <span
              data-status={warranty.status}
              className="rounded-md border border-border-subtle bg-surface-subtle px-2 py-1 text-caption text-text-primary"
            >
              <WarrantyStatusLabel messages={messages} status={warranty.status} />
            </span>
          </Fact>

          <Fact label={translate(messages, 'warranty.summary.startDate')}>
            {formatDate(warranty.startDate, locale)}
          </Fact>

          <Fact label={translate(messages, 'warranty.summary.expiryDate')}>
            {formatDate(warranty.expiryDate, locale)}
          </Fact>

          <Fact label={translate(messages, 'warranty.summary.odometerAtIssue')}>
            <Distance value={warranty.odometerAtIssue} />
          </Fact>

          <Fact label={translate(messages, 'warranty.summary.odometerLimit')}>
            {warranty.odometerLimit === null ? (
              translate(messages, 'warranty.summary.noDistanceLimit')
            ) : (
              <Distance value={warranty.odometerLimit} />
            )}
          </Fact>

          <p className="text-body">
            <Link
              href={`/${locale}/work-orders/${warranty.workOrderId}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {translate(messages, 'warranty.summary.workOrderLink')}
            </Link>
          </p>

          <p className="text-body">
            <Link
              href={`/${locale}/delivery/${warranty.deliveryRecordId}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {translate(messages, 'warranty.summary.deliveryLink')}
            </Link>
          </p>

          <Reference
            label={translate(messages, 'warranty.summary.vehicle')}
            value={warranty.vehicleId}
          />
          <p className="text-caption text-text-muted">
            {translate(messages, 'warranty.summary.identifiersExplain')}
          </p>
        </div>
      </Section>

      <Section
        headingId="warranty-policy-heading"
        titleKey="warranty.policy.heading"
        messages={messages}
        description={translate(messages, 'warranty.policy.explain')}
      >
        <div className="flex flex-col gap-3">
          <Fact label={translate(messages, 'warranty.policy.name')}>
            <bdi>{warranty.policy.name}</bdi>
          </Fact>
          <Fact label={translate(messages, 'warranty.policy.code')}>
            <code className="font-mono text-caption" dir="ltr">
              {warranty.policy.policyCode}
            </code>
          </Fact>
          <Fact label={translate(messages, 'warranty.policy.status')}>
            <ConfigurationStatusLabel messages={messages} status={warranty.policy.status} />
          </Fact>
        </div>
      </Section>

      <Section
        headingId="warranty-coverage-heading"
        titleKey="warranty.coverage.heading"
        messages={messages}
        description={translate(messages, 'warranty.coverage.explain')}
      >
        <div className="flex flex-col gap-3">
          <Fact label={translate(messages, 'warranty.coverage.coveredScope')}>
            <CoveredScopeLabel messages={messages} scope={warranty.coverage.coveredScope} />
          </Fact>
          <Fact label={translate(messages, 'warranty.coverage.durationMonths')}>
            {formatInteger(warranty.coverage.durationMonths, locale)}
          </Fact>
          <Fact label={translate(messages, 'warranty.coverage.odometerAllowance')}>
            {warranty.coverage.odometerAllowance === null ? (
              translate(messages, 'warranty.coverage.unlimitedDistance')
            ) : (
              <Distance value={warranty.coverage.odometerAllowance} />
            )}
          </Fact>
          <Fact label={translate(messages, 'warranty.coverage.effectiveFrom')}>
            {formatDate(warranty.coverage.effectiveFrom, locale)}
          </Fact>
          <Fact label={translate(messages, 'warranty.coverage.effectiveTo')}>
            {warranty.coverage.effectiveTo === null
              ? translate(messages, 'warranty.coverage.openEnded')
              : formatDate(warranty.coverage.effectiveTo, locale)}
          </Fact>
          <Fact label={translate(messages, 'warranty.coverage.status')}>
            <ConfigurationStatusLabel messages={messages} status={warranty.coverage.status} />
          </Fact>
        </div>
      </Section>

      <Section
        headingId="warranty-items-heading"
        titleKey="warranty.items.heading"
        messages={messages}
        description={translate(messages, 'warranty.items.explain')}
      >
        {warranty.items.length === 0 ? (
          <p className="text-body text-text-secondary">
            {translate(messages, 'warranty.items.none')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {warranty.items.map((item) => (
              <li
                key={item.id}
                className="rounded-md border border-border-subtle p-2 text-body text-text-primary"
              >
                <span className="font-medium">
                  <ItemKindLabel messages={messages} kind={item.itemKind} />
                </span>{' '}
                <bdi>{item.description}</bdi>
                <div className="mt-1">
                  <Reference
                    label={translate(
                      messages,
                      item.sourcePartId === null
                        ? 'warranty.items.sourceJob'
                        : 'warranty.items.sourcePart'
                    )}
                    value={item.sourcePartId ?? item.sourceJobId}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="text-caption text-text-muted">
        {translate(messages, 'warranty.record.noHistoryYet')}
      </p>
    </div>
  );
}
