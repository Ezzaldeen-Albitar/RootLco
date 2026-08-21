'use client';

import { useCallback, useState } from 'react';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import { ErrorState } from '@/components/states/States';
import { readReception } from '../api';
import type { ReceptionDetail } from '../receptions-contract';
import {
  activeStep,
  writesLocked as writesLockedFor,
  type CheckInCapabilities,
  type CheckInSessionIdentity,
  type CheckInStepDefinition,
} from '../check-in/wizard';

/**
 * The check-in wizard shell (`FE-007`).
 *
 * ## The typed step interface — how later waves extend this without editing it
 *
 * The shell renders the step list it is HANDED (`steps`), and each step is a
 * `CheckInStepDefinition` from `check-in/wizard.ts`: `{ id, titleKey,
 * descriptionKey, Component }`, where `Component` takes exactly
 * `CheckInStepProps` — `{ locale, messages, visitId, recordVersion, detail,
 * capabilities, writesLocked, refresh }`. An evidence-capture step (Waves E)
 * lands by appending one entry to `check-in/steps.tsx`; this file does not
 * change, and `stepRegistryProblems` plus the registry test hold the entry to
 * the contract (unique id, feature-namespaced translation keys in BOTH
 * catalogues).
 *
 * ## The shell owns the ONE detail read, and `refresh` is the only way forward
 *
 * `detail.recordVersion` is the `If-Match` every guarded command demands, and
 * QA-004 forbids presenting a cached guess across user-visible staleness. So
 * the version lives HERE, once: steps receive it as a prop, and after any
 * write — and after any 409/412 — they call `refresh()`, which re-runs
 * `rec.reception-detail` and re-renders every step with the current truth.
 * A step holding its own copy of the version is the defect this shape exists
 * to prevent.
 *
 * ## The receiving employee renders as a NAME, from the visit's own snapshot
 *
 * This header used to print `receivingEmployeeId` in a `<code>` element, and a
 * DOM case asserted it did. `canonical-plan.md` §7 disposes of G-EMP with the
 * sentence "The UI shows names, never UUIDs", so the identifier on screen was
 * the defect and the case was holding it there.
 *
 * It was then fixed by RESOLVING the identifier through `iam.user-detail`, which
 * put a name on screen and left two things wrong: the read could fail, so the
 * header carried three "no name was learned" branches, and it answered with the
 * account's name TODAY. `DBCR-P1-18-002` ends both.
 * `rec.reception_visits.receiving_employee_display_name` is written at insert by
 * `rec.stamp_receiving_employee_identity()` and refused any later edit, so the
 * name arrives WITH the visit — no second read, no failure branch, and a rename
 * or a disabled account cannot rewrite who accepted custody.
 *
 * ## A terminal visit still renders
 *
 * `converted`, `closed_without_work` and `refused` are facts worth reading.
 * The shell states the terminal status once, and every step receives
 * `writesLocked` so its write controls are withdrawn with the reason visible.
 */

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly initialDetail: ReceptionDetail;
  readonly steps: readonly CheckInStepDefinition[];
  readonly capabilities: CheckInCapabilities;
  /**
   * The signed-in operator, resolved by the ROUTE from the session.
   *
   * Passed down rather than read in a step, for the same reason `capabilities`
   * is: no component consults the session, so there is one place where what the
   * server resolved becomes what the interface shows. The evidence steps need it
   * because `inspector_id` and `witnessed_by_employee_id` have no referent
   * (G-EMP) and the only nameable identity is the operator's own.
   */
  readonly session: CheckInSessionIdentity;
}

export function CheckInWizardShell({
  locale,
  messages,
  initialDetail,
  steps,
  capabilities,
  session,
}: Props) {
  const [detail, setDetail] = useState<ReceptionDetail>(initialDetail);
  const [chosenStepId, setChosenStepId] = useState<string | null>(null);
  const [refreshFailure, setRefreshFailure] = useState<{
    readonly correlationId: string | null;
  } | null>(null);

  const refresh = useCallback(async () => {
    const result = await readReception(detail.id);
    if (result.status === 'ok' && result.data !== null) {
      setDetail(result.data);
      setRefreshFailure(null);
      return;
    }
    // The re-read itself failed. The steps keep rendering the last truth they
    // had; the failure is stated with its reference rather than swallowed.
    setRefreshFailure({ correlationId: result.correlationId });
  }, [detail.id]);

  const step = activeStep(steps, chosenStepId);
  const locked = writesLockedFor(detail.receptionStatus);

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="check-in-visit-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2
          id="check-in-visit-heading"
          className="text-section-title font-medium text-text-primary"
        >
          {detail.displayNumber !== null
            ? `${translate(messages, 'receptions.wizard.visit')} ${detail.displayNumber}`
            : translate(messages, 'receptions.wizard.visitUnnumbered')}
        </h2>

        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-caption text-text-secondary">
              {translate(messages, 'receptions.wizard.status')}
            </dt>
            <dd className="text-body text-text-primary">
              {translateDynamic(messages, `receptions.status.${detail.receptionStatus}`)}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">
              {translate(messages, 'receptions.wizard.origin')}
            </dt>
            <dd className="text-body text-text-primary">
              {translateDynamic(messages, `receptions.origin.${detail.origin}`)}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">
              {translate(messages, 'receptions.wizard.vehicle')}
            </dt>
            <dd className="text-body text-text-primary">
              {detail.vehicleDisplayNumber ??
                translate(messages, 'receptions.wizard.vehicleUnnumbered')}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">
              {translate(messages, 'receptions.wizard.custodyAccepted')}
            </dt>
            <dd className="text-body text-text-primary">
              {formatDateTime(detail.custodyAcceptedAt, locale)}
            </dd>
          </div>
          {detail.fuelLevelName !== null ? (
            <div>
              <dt className="text-caption text-text-secondary">
                {translate(messages, 'receptions.wizard.fuelLevel')}
              </dt>
              <dd className="text-body text-text-primary">{detail.fuelLevelName}</dd>
            </div>
          ) : null}
          {detail.evSocPercent !== null ? (
            <div>
              <dt className="text-caption text-text-secondary">
                {translate(messages, 'receptions.wizard.evSoc')}
              </dt>
              {/* numeric(5,2) travels as a STRING; rendered as received, LTR. */}
              <dd className="text-body text-text-primary" dir="ltr">
                {detail.evSocPercent}%
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-caption text-text-secondary">
              {translate(messages, 'receptions.wizard.receivingEmployee')}
            </dt>
            {/* The SNAPSHOT the visit carries, never a directory lookup. It is
                `NOT NULL` with a non-blank CHECK, so there is no absent case to
                render — and no live read that a later rename could move. */}
            <dd className="text-body text-text-primary">{detail.receivingEmployeeDisplayName}</dd>
          </div>
        </dl>

        <p className="mt-2 text-caption text-text-muted" lang={locale}>
          {/* G-EMP, stated where the name is shown: it is a user account, not
              an employee record. */}
          {translate(messages, 'receptions.wizard.receivingEmployeeNote')}
        </p>
      </section>

      {locked ? (
        <div
          role="status"
          className="rounded-lg border border-border bg-surface-subtle p-4 text-body text-text-primary"
        >
          <p>
            {translate(messages, 'receptions.wizard.terminal')}{' '}
            <strong>
              {translateDynamic(messages, `receptions.status.${detail.receptionStatus}`)}
            </strong>
          </p>
          <p className="mt-1 text-caption text-text-muted">
            {translate(messages, 'receptions.wizard.terminalNote')}
          </p>
        </div>
      ) : null}

      {refreshFailure !== null ? (
        <ErrorState
          messages={messages}
          {...(refreshFailure.correlationId ? { correlationId: refreshFailure.correlationId } : {})}
        />
      ) : null}

      <nav aria-label={translate(messages, 'receptions.wizard.stepsLabel')}>
        <ol className="flex flex-wrap gap-2">
          {steps.map((candidate, index) => {
            const current = step !== null && candidate.id === step.id;
            return (
              <li key={candidate.id}>
                <button
                  type="button"
                  aria-current={current ? 'step' : undefined}
                  onClick={() => setChosenStepId(candidate.id)}
                  className={
                    current
                      ? 'rounded-md bg-primary px-3 py-1.5 text-body font-medium text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
                      : 'rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
                  }
                >
                  {index + 1}. {translateDynamic(messages, candidate.titleKey)}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {step !== null ? (
        <section
          aria-labelledby={`check-in-step-${step.id}-heading`}
          className="flex flex-col gap-3"
        >
          <div>
            <h3
              id={`check-in-step-${step.id}-heading`}
              className="text-section-title font-medium text-text-primary"
            >
              {translateDynamic(messages, step.titleKey)}
            </h3>
            <p className="text-supporting text-text-muted" lang={locale}>
              {translateDynamic(messages, step.descriptionKey)}
            </p>
          </div>
          <step.Component
            locale={locale}
            messages={messages}
            visitId={detail.id}
            recordVersion={detail.recordVersion}
            detail={detail}
            capabilities={capabilities}
            session={session}
            writesLocked={locked}
            refresh={refresh}
          />
        </section>
      ) : null}
    </div>
  );
}
