'use client';

import { useState } from 'react';

import { SelectField, TextField } from '@/components/forms/Field';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';

import {
  createCoverageWindow,
  readWarrantyPolicy,
  renameWarrantyPolicy,
  setCoverageWindowStatus,
  setWarrantyPolicyStatus,
  type PolicyWriteState,
} from '../warranty-api';
import {
  COVERAGE_DATE_FORMAT,
  COVERED_SCOPES,
  MAX_DURATION_MONTHS,
  MAX_ODOMETER_ALLOWANCE,
  MAX_POLICY_NAME,
  MIN_DURATION_MONTHS,
  MIN_ODOMETER_ALLOWANCE,
  WHOLE_NUMBER,
  type CoveredScope,
  type WarrantyConfigurationStatus,
  type WarrantyCoverageTerms,
  type WarrantyPolicyDetail,
} from '../warranty-contract';
import {
  ConfigurationStatusLabel,
  CoveredScopeLabel,
  Distance,
  Fact,
  PRIMARY_BUTTON,
  Reference,
  SECONDARY_BUTTON,
  Section,
  isStaleView,
  refusalKeyFor,
} from './shared';

/**
 * One warranty plan and the windows of cover terms it holds (P1-31, FE-008 plan
 * administration).
 *
 * ## Every mutation re-reads, and the screen shows what came back
 *
 * Nothing on this screen is updated from the request that was sent. After a write
 * succeeds the plan is read again and the answer replaces what was held, so the name,
 * the state, the windows and — the part that matters — the two record versions are the
 * server's rather than this side's guess at what they became. That is not tidiness: the
 * next command is version-guarded, and a version inferred as "the one before plus one"
 * would encode an assumption about the database trigger that this application does not
 * own.
 *
 * ## The two record versions are never interchangeable
 *
 * The plan carries one and every window carries its own, on different rows. The rename
 * and the plan state command take the PLAN's; a window's state command takes that
 * WINDOW's. The path names both identifiers, which is what makes the confusion easy
 * and silent — the wrong one is a refusal at best and a write against the wrong row's
 * expectation at worst — so the two never share a variable here and each command is
 * given the version off the row it is acting on.
 *
 * ## A stale view is the one refusal an operator can clear by doing nothing
 *
 * The conflict code covers three causes. Only one of them — the plan moved while this
 * screen was open — is cleared by re-reading and sending the same thing again, and it
 * is the one that carries no violation rule. A reload control is offered beside that
 * message and beside no other, because offering it for an overlap would invite an
 * operator to retry a write that will be refused every time.
 *
 * ## Terms are added, never edited
 *
 * There is no edit control for a window and no delete for either row, because the
 * backend offers neither. A window's plan and start date are frozen by the database,
 * and the end date is deliberately not editable either: warranties cite their window
 * for their whole life, so re-closing one in place would restate terms a customer is
 * already bound to. Retire the window and add the one you meant — which leaves the
 * superseded terms readable beside the warranties that cite them.
 *
 * ## Nothing here computes a term
 *
 * No duration is summed, no window is compared against today, no distance is parsed.
 * `odometerAllowance` is an exact decimal string on the way in and on the way out; the
 * only value converted at all is the count of months, which the route takes as a whole
 * number because a count of months is not a measurement.
 */

/** Which control produced the outcome on screen, so it is reported where it happened. */
type WriteArea = 'rename' | 'planState' | 'window' | 'windowState';

interface Outcome {
  readonly area: WriteArea;
  readonly state: PolicyWriteState;
}

const ARCHIVED: WarrantyConfigurationStatus = 'archived';
const ACTIVE: WarrantyConfigurationStatus = 'active';

export function WarrantyPolicyScreen({
  messages,
  policyId,
  initial,
  canManagePolicies,
}: {
  readonly messages: Messages;
  readonly policyId: string;
  /** The plan as the page read it. Replaced by the server's answer after every write. */
  readonly initial: WarrantyPolicyDetail;
  /** `wty.policy.manage` — whether any control that changes the plan is drawn. */
  readonly canManagePolicies: boolean;
}) {
  const [detail, setDetail] = useState<WarrantyPolicyDetail>(initial);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [rereadFailed, setRereadFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const policy = detail.policy;

  /**
   * Read the plan again and keep whatever came back.
   *
   * A failed re-read is reported and the previously held plan is kept: the write it
   * followed may well have succeeded, and blanking the screen would suggest otherwise.
   */
  const reread = async () => {
    const next = await readWarrantyPolicy(policyId);
    if (next.status !== 'ok') {
      setRereadFailed(next.status);
      return;
    }
    setRereadFailed(null);
    setDetail(next.data);
  };

  /** Run one write, record where it happened, and re-read on success. */
  const run = async (area: WriteArea, write: () => Promise<PolicyWriteState>) => {
    if (busy) return;
    setBusy(true);
    const state = await write();
    setOutcome({ area, state });
    if (state.status === 'success') await reread();
    setBusy(false);
  };

  const report = (area: WriteArea) =>
    outcome && outcome.area === area ? (
      <WriteOutcome
        messages={messages}
        state={outcome.state}
        onReload={() => {
          setOutcome(null);
          void reread();
        }}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-6">
      <Section
        headingId="warranty-policy-summary-heading"
        titleKey="warranty.policies.summaryHeading"
        messages={messages}
        description={translate(messages, 'warranty.policies.summaryExplain')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Fact label={translate(messages, 'warranty.policies.nameField')}>
            <bdi>{policy.name}</bdi>
          </Fact>
          <Fact label={translate(messages, 'warranty.policies.columnState')}>
            <ConfigurationStatusLabel messages={messages} status={policy.status} />
          </Fact>
          <Reference
            label={translate(messages, 'warranty.policies.codeField')}
            value={policy.policyCode}
          />
          <Reference
            label={translate(messages, 'warranty.policies.columnCompany')}
            value={policy.companyId}
          />
        </div>
        {rereadFailed === null ? null : (
          <p role="alert" className="mt-3 text-body text-error">
            {translate(messages, 'warranty.policies.rereadFailed')}{' '}
            {translateDynamic(messages, `state.${rereadFailed}.title`)}
          </p>
        )}
      </Section>

      {canManagePolicies ? (
        <Section
          headingId="warranty-policy-rename-heading"
          titleKey="warranty.policies.renameHeading"
          messages={messages}
          description={translate(messages, 'warranty.policies.renameExplain')}
        >
          <RenameForm
            messages={messages}
            currentName={policy.name}
            busy={busy}
            onSubmit={(name) =>
              run('rename', () => renameWarrantyPolicy(policyId, { name }, policy.recordVersion))
            }
          />
          {report('rename')}
        </Section>
      ) : null}

      {canManagePolicies ? (
        <Section
          headingId="warranty-policy-state-heading"
          titleKey="warranty.policies.stateHeading"
          messages={messages}
          description={translate(messages, 'warranty.policies.stateExplain')}
        >
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={busy}
            onClick={() => {
              const next = policy.status === ACTIVE ? ARCHIVED : ACTIVE;
              void run('planState', () =>
                setWarrantyPolicyStatus(policyId, { status: next }, policy.recordVersion)
              );
            }}
          >
            {translate(
              messages,
              policy.status === ACTIVE
                ? 'warranty.policies.retirePlan'
                : 'warranty.policies.restorePlan'
            )}
          </button>
          {report('planState')}
        </Section>
      ) : null}

      <Section
        headingId="warranty-policy-coverage-heading"
        titleKey="warranty.policies.coverageHeading"
        messages={messages}
        description={translate(messages, 'warranty.policies.coverageExplain')}
      >
        {detail.coverage.length === 0 ? (
          <p className="text-body text-text-secondary">
            {translate(messages, 'warranty.policies.noCoverage')}
          </p>
        ) : (
          <table className="w-full text-body">
            <caption className="sr-only">
              {translate(messages, 'warranty.policies.coverageTableCaption')}
            </caption>
            <thead>
              <tr className="text-caption text-text-muted">
                <th scope="col" className="p-2 text-start">
                  {translate(messages, 'warranty.coverage.coveredScope')}
                </th>
                <th scope="col" className="p-2 text-start">
                  {translate(messages, 'warranty.coverage.durationMonths')}
                </th>
                <th scope="col" className="p-2 text-start">
                  {translate(messages, 'warranty.coverage.odometerAllowance')}
                </th>
                <th scope="col" className="p-2 text-start">
                  {translate(messages, 'warranty.coverage.effectiveFrom')}
                </th>
                <th scope="col" className="p-2 text-start">
                  {translate(messages, 'warranty.coverage.effectiveTo')}
                </th>
                <th scope="col" className="p-2 text-start">
                  {translate(messages, 'warranty.coverage.status')}
                </th>
                {canManagePolicies ? (
                  <th scope="col" className="p-2 text-start">
                    {translate(messages, 'warranty.policies.columnAction')}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {detail.coverage.map((terms) => (
                <tr key={terms.id} className="border-t border-border-subtle">
                  <td className="p-2">
                    <CoveredScopeLabel messages={messages} scope={terms.coveredScope} />
                  </td>
                  <td className="p-2">{terms.durationMonths}</td>
                  <td className="p-2">
                    {terms.odometerAllowance === null ? (
                      translate(messages, 'warranty.coverage.unlimitedDistance')
                    ) : (
                      <Distance value={terms.odometerAllowance} />
                    )}
                  </td>
                  <td className="p-2">
                    <span dir="ltr">{terms.effectiveFrom}</span>
                  </td>
                  <td className="p-2">
                    {terms.effectiveTo === null ? (
                      translate(messages, 'warranty.coverage.openEnded')
                    ) : (
                      <span dir="ltr">{terms.effectiveTo}</span>
                    )}
                  </td>
                  <td className="p-2">
                    <ConfigurationStatusLabel messages={messages} status={terms.status} />
                  </td>
                  {canManagePolicies ? (
                    <td className="p-2">
                      <WindowStateButton
                        messages={messages}
                        terms={terms}
                        busy={busy}
                        onClick={() => {
                          const next = terms.status === ACTIVE ? ARCHIVED : ACTIVE;
                          void run('windowState', () =>
                            setCoverageWindowStatus(
                              policyId,
                              terms.id,
                              { status: next },
                              // The WINDOW's own version, off the row this button
                              // belongs to. The plan's is a different counter.
                              terms.recordVersion
                            )
                          );
                        }}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {report('windowState')}
      </Section>

      {canManagePolicies ? (
        <Section
          headingId="warranty-policy-add-coverage-heading"
          titleKey="warranty.policies.addCoverageHeading"
          messages={messages}
          description={translate(messages, 'warranty.policies.addCoverageExplain')}
        >
          <CoverageForm
            messages={messages}
            busy={busy}
            onSubmit={(body) => run('window', () => createCoverageWindow(policyId, body))}
          />
          {report('window')}
        </Section>
      ) : null}
    </div>
  );
}

/** The result of one write, with a reload offered for the one refusal it clears. */
function WriteOutcome({
  messages,
  state,
  onReload,
}: {
  readonly messages: Messages;
  readonly state: PolicyWriteState;
  readonly onReload: () => void;
}) {
  if (state.status === 'success') {
    return (
      <p role="status" className="mt-3 text-body text-text-primary">
        {translateDynamic(messages, state.messageKey ?? 'action.succeeded')}
      </p>
    );
  }
  return (
    <div className="mt-3 flex flex-col items-start gap-2">
      <p role="alert" className="text-body text-error">
        {translateDynamic(messages, refusalKeyFor(state))}
        {state.correlationId ? (
          <>
            {' '}
            <span className="text-caption text-text-muted">
              {translate(messages, 'state.correlationId')}{' '}
              <code className="font-mono" dir="ltr">
                {state.correlationId}
              </code>
            </span>
          </>
        ) : null}
      </p>
      {isStaleView(state) ? (
        <button type="button" className={SECONDARY_BUTTON} onClick={onReload}>
          {translate(messages, 'warranty.policies.reload')}
        </button>
      ) : null}
    </div>
  );
}

/** Retire or restore one window, labelled by what it will do. */
function WindowStateButton({
  messages,
  terms,
  busy,
  onClick,
}: {
  readonly messages: Messages;
  readonly terms: WarrantyCoverageTerms;
  readonly busy: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={onClick}>
      {translate(
        messages,
        terms.status === ACTIVE
          ? 'warranty.policies.retireWindow'
          : 'warranty.policies.restoreWindow'
      )}
    </button>
  );
}

/** The name, and nothing else: the reference is not renameable and no field offers it. */
function RenameForm({
  messages,
  currentName,
  busy,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly currentName: string;
  readonly busy: boolean;
  readonly onSubmit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(currentName);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      aria-label={translate(messages, 'warranty.policies.renameFormLabel')}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = draft.trim();
        if (trimmed.length === 0 || trimmed.length > MAX_POLICY_NAME) {
          setError('warranty.policies.nameLength');
          return;
        }
        setError(null);
        onSubmit(trimmed);
      }}
    >
      <div className="grow">
        <TextField
          label={translate(messages, 'warranty.policies.nameField')}
          required
          maxLength={MAX_POLICY_NAME}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          error={error ? translateDynamic(messages, error) : undefined}
        />
      </div>
      <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
        {translate(messages, 'warranty.policies.renameSubmit')}
      </button>
    </form>
  );
}

/**
 * Is this string of digits inside the distance the column accepts?
 *
 * Compared as a STRING, by length and then lexically, because that is exact for
 * digits and needs no conversion. Turning a distance into a number to range-check it
 * is the one place a reading could quietly change, and the value is sent onward as
 * the string it arrived as.
 */
function withinDistanceBound(digits: string): boolean {
  const floor = String(MIN_ODOMETER_ALLOWANCE);
  const ceiling = String(MAX_ODOMETER_ALLOWANCE);
  const trimmed = digits.replace(/^0+/, '');
  if (trimmed.length < floor.length) return false;
  if (trimmed.length === floor.length && trimmed < floor) return false;
  if (trimmed.length > ceiling.length) return false;
  return trimmed.length < ceiling.length || trimmed <= ceiling;
}

/** One window of cover terms, in the shape the add operation accepts. */
function CoverageForm({
  messages,
  busy,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly busy: boolean;
  readonly onSubmit: (body: {
    readonly coveredScope: CoveredScope;
    readonly durationMonths: number;
    readonly odometerAllowance?: string;
    readonly effectiveFrom: string;
    readonly effectiveTo?: string;
  }) => void;
}) {
  const [coveredScope, setCoveredScope] = useState<CoveredScope>('all');
  const [durationMonths, setDurationMonths] = useState('');
  const [odometerAllowance, setOdometerAllowance] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  return (
    <form
      aria-label={translate(messages, 'warranty.policies.addCoverageFormLabel')}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const found: Record<string, string> = {};
        const months = durationMonths.trim();
        const distance = odometerAllowance.trim();
        const from = effectiveFrom.trim();
        const to = effectiveTo.trim();

        const monthsAreWhole = WHOLE_NUMBER.test(months);
        const monthCount = monthsAreWhole ? Number.parseInt(months, 10) : 0;
        if (
          !monthsAreWhole ||
          monthCount < MIN_DURATION_MONTHS ||
          monthCount > MAX_DURATION_MONTHS
        ) {
          found['durationMonths'] = 'warranty.policies.monthsRange';
        }
        if (
          distance.length > 0 &&
          !(WHOLE_NUMBER.test(distance) && withinDistanceBound(distance))
        ) {
          found['odometerAllowance'] = 'warranty.policies.distanceRange';
        }
        if (!COVERAGE_DATE_FORMAT.test(from))
          found['effectiveFrom'] = 'warranty.policies.dateFormat';
        if (to.length > 0 && !COVERAGE_DATE_FORMAT.test(to)) {
          found['effectiveTo'] = 'warranty.policies.dateFormat';
        }
        if (to.length > 0 && COVERAGE_DATE_FORMAT.test(to) && to <= from) {
          // Mirrors the database CHECK, so an inverted window is named by the control
          // rather than answered as a refusal of the whole request. The constraint is
          // still the authority and refuses it again.
          found['effectiveTo'] = 'warranty.policies.endAfterStart';
        }
        setErrors(found);
        if (Object.keys(found).length > 0) return;

        onSubmit({
          coveredScope,
          durationMonths: monthCount,
          // Omitted rather than sent empty: an absent allowance is what an unlimited
          // distance means, and the route is strict about a value it does not expect.
          ...(distance.length === 0 ? {} : { odometerAllowance: distance }),
          effectiveFrom: from,
          ...(to.length === 0 ? {} : { effectiveTo: to }),
        });
      }}
    >
      <SelectField
        label={translate(messages, 'warranty.coverage.coveredScope')}
        required
        value={coveredScope}
        onChange={(event) => setCoveredScope(event.target.value as CoveredScope)}
        options={COVERED_SCOPES.map((scope) => ({
          value: scope,
          label: translate(messages, `warranty.coveredScope.${scope}`),
        }))}
      />

      <TextField
        label={translate(messages, 'warranty.coverage.durationMonths')}
        required
        inputMode="numeric"
        spellCheck={false}
        dir="ltr"
        value={durationMonths}
        onChange={(event) => setDurationMonths(event.target.value)}
        error={
          errors['durationMonths']
            ? translateDynamic(messages, errors['durationMonths'])
            : undefined
        }
      />

      <TextField
        label={translate(messages, 'warranty.coverage.odometerAllowance')}
        description={translate(messages, 'warranty.policies.distanceHelp')}
        inputMode="numeric"
        spellCheck={false}
        dir="ltr"
        value={odometerAllowance}
        onChange={(event) => setOdometerAllowance(event.target.value)}
        error={
          errors['odometerAllowance']
            ? translateDynamic(messages, errors['odometerAllowance'])
            : undefined
        }
      />

      <TextField
        label={translate(messages, 'warranty.coverage.effectiveFrom')}
        type="date"
        required
        value={effectiveFrom}
        onChange={(event) => setEffectiveFrom(event.target.value)}
        error={
          errors['effectiveFrom'] ? translateDynamic(messages, errors['effectiveFrom']) : undefined
        }
      />

      <TextField
        label={translate(messages, 'warranty.coverage.effectiveTo')}
        description={translate(messages, 'warranty.policies.endHelp')}
        type="date"
        value={effectiveTo}
        onChange={(event) => setEffectiveTo(event.target.value)}
        error={
          errors['effectiveTo'] ? translateDynamic(messages, errors['effectiveTo']) : undefined
        }
      />

      <div className="sm:col-span-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'warranty.policies.addCoverageSubmit')}
        </button>
      </div>
    </form>
  );
}
