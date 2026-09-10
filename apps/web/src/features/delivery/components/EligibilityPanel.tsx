'use client';

import { PermissionDeniedState } from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import type { DeliveryEligibility, EligibilityFact } from '../delivery-contract';
import { BlockerLabel } from './CodeLabel';
import { Fact, Panel, PanelFailure, PanelLoading } from './PanelShell';

/**
 * Whether this vehicle may be released, and every reason it may not (FE-002).
 *
 * ## The permission is decided BEFORE the read, here as well as on the page
 *
 * The eligibility operation declares the financial read code alongside the
 * delivery one, because one of the eight reasons it composes is the customer's
 * open balance. A caller without it is refused at the route. So the read is not
 * issued at all and this panel renders its own scoped refusal instead: a request
 * whose answer is already known would put a denial in the backend's log and tell
 * the operator nothing extra. The rest of the screen still renders, which is the
 * reason the refusal is scoped to this panel rather than to the page.
 *
 * ## The read is the screen's, not this panel's
 *
 * `useEligibility` holds it, because the completion control needs the same
 * answer — and above all the same `recordVersion`. A panel that read for itself
 * would spend a second request on one answer and could show a version different
 * from the one the button sends, which is the difference between a guard that
 * works and a guard that is refused every other time.
 *
 * ## "Blocked" and "could not be checked" are drawn differently, on purpose
 *
 * Five of the eight reasons exist only because the application composes them,
 * and every composed fact fails CLOSED: a fact that could not be read counts as
 * blocking. That is the right default and a terrible thing to render as if it
 * were an observation. An operator who reads "the customer still owes money"
 * chases the customer; an operator who reads "this could not be checked" raises
 * a platform problem. The list below says which of the two happened for every
 * single reason, and the second carries the reference support needs.
 *
 * ## The version is shown because completion needs it
 *
 * A completion is version-guarded and every preparation step moves the version,
 * so the number a completion must quote is the one this read republishes. It is
 * displayed rather than hidden so that the value on screen is the value the next
 * act uses.
 */
export function EligibilityPanel({
  messages,
  state,
  withheld,
  canComplete,
}: {
  readonly messages: Messages;
  /** The screen's own read. `null` while it is in flight, or when it was withheld. */
  readonly state: ReadState<DeliveryEligibility> | null;
  /** True when the caller lacks the financial read code and nothing was asked. */
  readonly withheld: boolean;
  /** Whether the caller holds the authority that may override the one overridable reason. */
  readonly canComplete: boolean;
}) {
  if (withheld) {
    return (
      <Panel
        headingId="delivery-eligibility-heading"
        titleKey="delivery.eligibility.heading"
        messages={messages}
        description={translate(messages, 'delivery.eligibility.needsFinance')}
      >
        <PermissionDeniedState messages={messages} />
      </Panel>
    );
  }

  return (
    <Panel
      headingId="delivery-eligibility-heading"
      titleKey="delivery.eligibility.heading"
      messages={messages}
    >
      {state === null ? (
        <PanelLoading messages={messages} />
      ) : state.status !== 'ok' ? (
        <PanelFailure
          messages={messages}
          status={state.status}
          correlationId={state.correlationId}
        />
      ) : (
        <EligibilityBody messages={messages} view={state.data} canComplete={canComplete} />
      )}
    </Panel>
  );
}

function EligibilityBody({
  messages,
  view,
  canComplete,
}: {
  readonly messages: Messages;
  readonly view: DeliveryEligibility;
  readonly canComplete: boolean;
}) {
  const blocking = new Set(view.blockers);
  const overridable = new Set(view.overridable.map((entry) => entry.code));
  const someBlockerIsOverridable = view.blockers.some((code) => overridable.has(code));

  return (
    <div className="flex flex-col gap-4">
      <p
        role="status"
        className={
          view.eligible
            ? 'rounded-md border border-success-border bg-success-subtle p-3 text-body text-text-primary'
            : 'rounded-md border border-warning-border bg-warning-subtle p-3 text-body text-text-primary'
        }
      >
        {translate(
          messages,
          view.eligible ? 'delivery.eligibility.eligible' : 'delivery.eligibility.notEligible'
        )}
      </p>

      {view.blockers.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="text-label font-medium text-text-primary">
            {translate(messages, 'delivery.eligibility.blockersHeading')}
          </h3>
          <ul className="flex list-disc flex-col gap-1 ps-5">
            {view.blockers.map((code) => (
              <li key={code} className="text-body text-text-primary">
                <BlockerLabel messages={messages} code={code} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {someBlockerIsOverridable ? (
        <p className="text-caption text-text-secondary">
          {translate(
            messages,
            canComplete
              ? 'delivery.eligibility.overridableByYou'
              : 'delivery.eligibility.overridableByOther'
          )}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-label font-medium text-text-primary">
          {translate(messages, 'delivery.eligibility.factsHeading')}
        </h3>
        <p className="text-caption text-text-muted">
          {translate(messages, 'delivery.eligibility.factsExplain')}
        </p>
        <ul className="flex flex-col gap-2">
          {view.facts.map((fact) => (
            <FactRow
              key={fact.blocker}
              messages={messages}
              fact={fact}
              blocking={blocking.has(fact.blocker)}
            />
          ))}
        </ul>
      </div>

      {view.checklistGaps.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="text-label font-medium text-text-primary">
            {translate(messages, 'delivery.eligibility.gapsHeading')}
          </h3>
          <p className="text-caption text-text-muted">
            {translate(messages, 'delivery.eligibility.gapsExplain')}
          </p>
          <ul className="flex list-disc flex-col gap-1 ps-5">
            {view.checklistGaps.map((gap) => (
              <li key={gap.templateItemId} className="text-body text-text-primary">
                <bdi>{gap.label}</bdi>{' '}
                <code className="font-mono text-caption text-text-secondary" dir="ltr">
                  {gap.itemCode}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Fact label={translate(messages, 'delivery.eligibility.version')}>
        <span dir="ltr">{String(view.recordVersion)}</span>
      </Fact>
    </div>
  );
}

/** One composed reason, drawn as observed or as unreadable — never as both. */
function FactRow({
  messages,
  fact,
  blocking,
}: {
  readonly messages: Messages;
  readonly fact: EligibilityFact;
  readonly blocking: boolean;
}) {
  const unreadable = !fact.established;
  return (
    <li
      data-established={fact.established ? 'yes' : 'no'}
      className={
        unreadable
          ? 'rounded-md border border-error-border bg-error-subtle p-2 text-body text-text-primary'
          : 'rounded-md border border-border-subtle p-2 text-body text-text-primary'
      }
    >
      <span className="font-medium">
        <BlockerLabel messages={messages} code={fact.blocker} />
      </span>{' '}
      <span className="text-caption text-text-secondary">
        {translate(
          messages,
          unreadable
            ? 'delivery.eligibility.factUnreadable'
            : blocking
              ? 'delivery.eligibility.factBlocking'
              : 'delivery.eligibility.factSatisfied'
        )}
      </span>
      {unreadable ? (
        <>
          {' '}
          <code className="font-mono text-caption text-text-secondary" dir="ltr">
            {fact.source}
          </code>
        </>
      ) : null}
    </li>
  );
}
