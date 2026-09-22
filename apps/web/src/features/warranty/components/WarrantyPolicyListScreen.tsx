'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { SelectField, TextField } from '@/components/forms/Field';
import { EmptyState, FailureExplanation, LoadingState } from '@/components/states/States';
import { RequiresConcreteBranch } from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';

import {
  createWarrantyPolicy,
  listWarrantyPolicies,
  type PolicyWriteState,
} from '../warranty-api';
import {
  MAX_POLICY_NAME,
  POLICY_CODE_FORMAT,
  WARRANTY_CONFIGURATION_STATUSES,
  type WarrantyConfigurationStatus,
  type WarrantyPolicySummary,
} from '../warranty-contract';
import {
  ConfigurationStatusLabel,
  PRIMARY_BUTTON,
  ReadFailure,
  SECONDARY_BUTTON,
  Section,
  refusalKeyFor,
  type MoreFailure,
} from './shared';
import type { ReadFailureStatus } from '@/lib/api/read-operation';

/**
 * The warranty plans a tenant holds (P1-31, FE-008 plan administration).
 *
 * ## The list is TENANT-wide, and that is the route's decision rather than this
 * screen's
 *
 * `wty.warranty-policy-list` offers no company filter at all. Its own docblock gives
 * the reason: every row carries its company, the row-level rule already narrows to the
 * companies the caller's grants reach, and a filter that could only narrow that
 * further is a denial case and a coverage obligation for no capability. So the screen
 * asks for no company, shows the company each plan belongs to, and asserts no scope of
 * its own — which is the opposite of the warranty RECORD list beside it, where the
 * branch pair is a required target.
 *
 * ## The one filter is the route's, and the unfiltered set is the useful default
 *
 * `status` is optional there. Unfiltered it lists retired plans beside plans in use,
 * which is exactly what an administration screen needs: a retired plan still holds its
 * reference, and restoring one is a command this surface offers. The picker in the
 * issue control asks for the opposite — plans in use only — because a plan that is not
 * in use is refused by the generation.
 *
 * ## Creating is drawn on the administration code and on nothing else
 *
 * `wty.policy.manage` is what the create operation declares. A reader who holds only
 * `wty.warranty.read` sees the plans and no form: a control whose only outcome is a
 * denial teaches an operator to ignore denials. It is an affordance, never
 * enforcement — the server decides again, and its refusal is what is reported.
 *
 * ## A created plan is shown as the server returned it, and the list is re-read
 *
 * Nothing is inserted into the rows on screen from the request that was sent. The
 * list is asked again, so what an operator sees afterwards is what the server holds,
 * including the reference and the state it assigned.
 */

/** The value of the state control when no filter is applied. */
const ANY_STATUS = '';

interface Held {
  readonly key: string;
  readonly status: 'ok' | ReadFailureStatus;
  readonly rows: readonly WarrantyPolicySummary[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly correlationId: string | null;
  readonly moreFailed: MoreFailure | null;
}

export function WarrantyPolicyListScreen({
  locale,
  messages,
  canManagePolicies,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `wty.policy.manage` — whether the create form is drawn at all. */
  readonly canManagePolicies: boolean;
}) {
  const context = useWorkingContext();
  /** The published name of a company, or null when it is outside this context. */
  const companyName = (id: string): string | null =>
    context.companies.find((company) => company.id === id)?.name ?? null;

  const [filter, setFilter] = useState<WarrantyConfigurationStatus | ''>(ANY_STATUS);
  const [reloads, setReloads] = useState(0);
  const [held, setHeld] = useState<Held | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const key = `${filter}#${String(reloads)}`;

  useEffect(() => {
    let live = true;
    void listWarrantyPolicies(filter === ANY_STATUS ? {} : { status: filter }).then((state) => {
      if (!live) return;
      if (state.status !== 'ok') {
        setHeld({
          key,
          status: state.status,
          rows: [],
          nextCursor: null,
          hasMore: false,
          correlationId: state.correlationId,
          moreFailed: null,
        });
        return;
      }
      setHeld({
        key,
        status: 'ok',
        rows: state.data.policies.items,
        nextCursor: state.data.policies.nextCursor,
        hasMore: state.data.policies.hasMore,
        correlationId: state.correlationId,
        moreFailed: null,
      });
    });
    return () => {
      live = false;
    };
  }, [filter, key]);

  const loadMore = async () => {
    if (!held || held.key !== key || held.nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    const next = await listWarrantyPolicies({
      ...(filter === ANY_STATUS ? {} : { status: filter }),
      cursor: held.nextCursor,
    });
    setLoadingMore(false);
    if (next.status !== 'ok') {
      // The pages already read stay on screen. Wiping them to report a transient
      // fault loses the operator's place for no benefit.
      setHeld({
        ...held,
        moreFailed: { status: next.status, correlationId: next.correlationId },
      });
      return;
    }
    setHeld({
      ...held,
      rows: [...held.rows, ...next.data.policies.items],
      nextCursor: next.data.policies.nextCursor,
      hasMore: next.data.policies.hasMore,
      moreFailed: null,
    });
  };

  const current = held !== null && held.key === key ? held : null;

  return (
    <div className="flex flex-col gap-6">
      {canManagePolicies ? (
        <CreatePolicySection
          locale={locale}
          messages={messages}
          onCreated={() => setReloads((count) => count + 1)}
        />
      ) : null}

      <Section
        headingId="warranty-policies-filter-heading"
        titleKey="warranty.policies.filterHeading"
        messages={messages}
        description={translate(messages, 'warranty.policies.filterExplain')}
      >
        <form
          aria-label={translate(messages, 'warranty.policies.filterFormLabel')}
          className="max-w-sm"
          onSubmit={(event) => event.preventDefault()}
        >
          <SelectField
            label={translate(messages, 'warranty.policies.stateField')}
            value={filter}
            onChange={(event) => setFilter(event.target.value as WarrantyConfigurationStatus | '')}
            options={WARRANTY_CONFIGURATION_STATUSES.map((status) => ({
              value: status,
              label: translate(messages, `warranty.configurationStatus.${status}`),
            }))}
            placeholder={translate(messages, 'warranty.policies.anyState')}
          />
        </form>
      </Section>

      <Section
        headingId="warranty-policies-results-heading"
        titleKey="warranty.policies.listHeading"
        messages={messages}
      >
        {current === null ? (
          <LoadingState messages={messages} />
        ) : current.status !== 'ok' ? (
          <ReadFailure
            messages={messages}
            status={current.status}
            correlationId={current.correlationId}
          />
        ) : current.rows.length === 0 ? (
          <EmptyState
            messages={messages}
            titleKey="warranty.policies.noneTitle"
            descriptionKey="warranty.policies.noneDescription"
          />
        ) : (
          <>
            <table className="w-full text-body">
              <caption className="sr-only">
                {translate(messages, 'warranty.policies.tableCaption')}
              </caption>
              <thead>
                <tr className="text-caption text-text-muted">
                  <th scope="col" className="p-2 text-start">
                    {translate(messages, 'warranty.policies.columnName')}
                  </th>
                  <th scope="col" className="p-2 text-start">
                    {translate(messages, 'warranty.policies.columnCode')}
                  </th>
                  <th scope="col" className="p-2 text-start">
                    {translate(messages, 'warranty.policies.columnState')}
                  </th>
                  <th scope="col" className="p-2 text-start">
                    {translate(messages, 'warranty.policies.columnCompany')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {current.rows.map((row) => (
                  <tr key={row.id} className="border-t border-border-subtle">
                    <td className="p-2">
                      <Link
                        href={`/${locale}/warranty/policies/${row.id}`}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        <bdi>{row.name}</bdi>
                      </Link>
                    </td>
                    <td className="p-2">
                      <code className="font-mono text-caption" dir="ltr">
                        {row.policyCode}
                      </code>
                    </td>
                    <td className="p-2">
                      <ConfigurationStatusLabel messages={messages} status={row.status} />
                    </td>
                    <td className="p-2">
                      {/*
                        The name the platform published for this company, never
                        its reference: a reader cannot recognise a workshop by a
                        string they have never seen. A company outside the
                        reader's own working context has no name here, and the
                        reference is then all there is to show.
                      */}
                      {companyName(row.companyId) ?? (
                        <code className="font-mono text-caption" dir="ltr">
                          {row.companyId}
                        </code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {current.moreFailed === null ? null : (
              <ReadFailure
                messages={messages}
                status={current.moreFailed.status}
                correlationId={current.moreFailed.correlationId}
              />
            )}

            {current.hasMore ? (
              <button
                type="button"
                className={`mt-3 ${SECONDARY_BUTTON}`}
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {translate(messages, 'warranty.policies.loadMore')}
              </button>
            ) : null}
          </>
        )}
      </Section>
    </div>
  );
}

/**
 * The create form, drawn only for a caller holding the administration code.
 *
 * The company is a REQUIRED claim on the create body and the route resolves it
 * against the caller's own grants. It is chosen from the branch directory when that
 * directory can be read — every branch names its company — and typed otherwise, which
 * is the arrangement the warranty record list already uses for its target. No read on
 * this screen publishes a company NAME, so the identifier is shown as the identifier
 * it is rather than dressed up as a label the backend never sent.
 *
 * Cover terms are NOT collected here. A plan may be created with its windows in one
 * body, but an overlap refusal would then fail the whole creation without the operator
 * being able to see which window it refused; adding windows on the plan's own screen
 * puts each refusal beside the form that caused it.
 */
function CreatePolicySection({
  locale,
  messages,
  onCreated,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly onCreated: () => void;
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();
  /*
   * The company the operator is working in, chosen for them.
   *
   * The working context publishes the NAMED companies this caller is authorized
   * for, so the reference that used to be typed here — by exactly the operator
   * whose branch directory read was refused — is gone. A single authorized
   * company is filled in; several are offered by name; the header's own branch
   * choice decides the default when it names one.
   */
  const companies = context.companies;
  const defaultCompany =
    branch.kind === 'ready'
      ? branch.target.companyId
      : companies.length === 1
        ? (companies[0]?.id ?? '')
        : '';
  const [companyId, setCompanyId] = useState(defaultCompany);
  const [policyCode, setPolicyCode] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [state, setState] = useState<PolicyWriteState | null>(null);
  const [sending, setSending] = useState(false);

  /*
   * The default follows the header, adjusted DURING render.
   *
   * React's documented shape for "reset state when an input changes". An effect
   * would paint one frame with the previous company selected, which is the one
   * frame in which a submission would name the wrong workshop.
   */
  const [lastDefault, setLastDefault] = useState(defaultCompany);
  if (defaultCompany !== lastDefault) {
    setLastDefault(defaultCompany);
    setCompanyId(defaultCompany);
  }

  // Nothing to choose from is a real state — an operator authorized for no
  // company at all — and it is said rather than drawn as an empty control.
  const offered = companies.length > 0;
  const created = state?.policy ?? null;
  /*
   * The control's own complaint first, then the one the service published.
   *
   * `wty.warranty-policy-create` refuses an unreachable company against
   * `body.companyId`, which reaches this screen as a field error under
   * `companyId`. Read only from the local map, that sentence rendered nowhere
   * and the operator was left with the shared "check the fields" banner beside
   * a company they had picked from the directory.
   */
  const companyKey = errors['companyId'] ?? state?.fieldErrors?.['companyId'];
  const companyError = companyKey ? translateDynamic(messages, companyKey) : undefined;

  return (
    <Section
      headingId="warranty-policies-create-heading"
      titleKey="warranty.policies.createHeading"
      messages={messages}
      description={translate(messages, 'warranty.policies.createExplain')}
    >
      <form
        aria-label={translate(messages, 'warranty.policies.createFormLabel')}
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (sending) return;
          const found: Record<string, string> = {};
          const chosenCompany = companyId.trim();
          const chosenCode = policyCode.trim();
          const chosenName = name.trim();
          // The company is picked from the platform's own named list now, so
          // the only refusal left is "none was picked".
          if (chosenCompany.length === 0) found['companyId'] = 'field.required';
          if (!POLICY_CODE_FORMAT.test(chosenCode)) {
            // Refused by the control rather than by the request: the route answers a
            // malformed reference with a refusal of the whole body, which reads like
            // an outage instead of a correctable field.
            found['policyCode'] = 'warranty.policies.codeFormat';
          }
          if (chosenName.length === 0 || chosenName.length > MAX_POLICY_NAME) {
            found['name'] = 'warranty.policies.nameLength';
          }
          setErrors(found);
          if (Object.keys(found).length > 0) return;
          setSending(true);
          void createWarrantyPolicy({
            companyId: chosenCompany,
            policyCode: chosenCode,
            name: chosenName,
          }).then((outcome) => {
            setState(outcome);
            setSending(false);
            if (outcome.status !== 'success') return;
            setPolicyCode('');
            setName('');
            onCreated();
          });
        }}
      >
        {offered ? (
          <SelectField
            label={translate(messages, 'warranty.policies.companyField')}
            description={translate(messages, 'warranty.policies.companyFromDirectory')}
            required
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
            options={companies.map((company) => ({ value: company.id, label: company.name }))}
            placeholder={translate(messages, 'warranty.policies.companyPlaceholder')}
            error={companyError}
          />
        ) : (
          <RequiresConcreteBranch
            messages={messages}
            fallbackKey="warranty.policies.noCompanies"
            testId="warranty-policies-no-company"
          />
        )}

        <TextField
          label={translate(messages, 'warranty.policies.codeField')}
          description={translate(messages, 'warranty.policies.codeHelp')}
          required
          spellCheck={false}
          dir="ltr"
          value={policyCode}
          onChange={(event) => setPolicyCode(event.target.value)}
          error={
            errors['policyCode'] ? translateDynamic(messages, errors['policyCode']) : undefined
          }
        />

        <div className="sm:col-span-2">
          <TextField
            label={translate(messages, 'warranty.policies.nameField')}
            required
            maxLength={MAX_POLICY_NAME}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors['name'] ? translateDynamic(messages, errors['name']) : undefined}
          />
        </div>

        <div className="sm:col-span-2">
          <button type="submit" className={PRIMARY_BUTTON} disabled={sending}>
            {translate(messages, 'warranty.policies.createSubmit')}
          </button>
        </div>
      </form>

      {created ? (
        <p role="status" className="mt-3 text-body text-text-primary">
          {translate(messages, 'warranty.policies.created')}{' '}
          <Link
            href={`/${locale}/warranty/policies/${created.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'warranty.policies.openCreated')}
          </Link>
        </p>
      ) : null}

      {state && state.status !== 'success' ? (
        <p role="alert" className="mt-3 text-body text-error">
          {translateWithValues(messages, refusalKeyFor(state), state.messageValues)}
          <FailureExplanation messages={messages} messageKey={refusalKeyFor(state)} />
        </p>
      ) : null}
    </Section>
  );
}
