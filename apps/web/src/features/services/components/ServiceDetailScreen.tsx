'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { DateField, type DayProblem } from '@/components/forms/mui/DateField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { TreePicker } from '@/components/pickers/TreePicker';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import {
  useUnsavedGuard,
  useWorkingContext,
  useWorkingContextChange,
} from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { useLocalRefusal } from '@/lib/forms/use-local-refusal';
import type { ServiceUpdateBody } from '@/lib/contracts/services-contract';

import {
  createServiceVersion,
  listBranches,
  publishServiceVersion,
  setBranchAvailability,
  updateService,
} from '../api';
import {
  MAX_DESCRIPTION,
  MAX_NAME,
  MAX_NOTES,
  type BranchOption,
  type ServiceDetail,
  type ServiceVersion,
} from '../services-contract';
import {
  LifecycleBadge,
  OutcomeNote,
  branchesFromContext,
  categoryTreeItems,
  useTaxonomy,
  type Taxonomy,
} from './ServiceCatalogueScreen';

/**
 * One service (P1-30, `W1`, FE-001) — `svc.service-detail`, with the four
 * writes that act on it. On the shared Material UI wrappers since
 * `P1-32-PRE-OD-MUISP` (ADR-022): `forms/mui` fields, the category tree,
 * `DateField` for every day, and `ConfirmDialog` before retiring.
 *
 * ## The version the guarded writes send
 *
 * `svc.service-update` and `svc.service-version-publish` are version-guarded
 * and require `If-Match`. The version is the `recordVersion` the page read —
 * for publication too, because `svc.publish_service_version` locks the SERVICE
 * first. After any write that moved it, the page is refreshed so the next
 * write carries the current one; a stale one is a genuine conflict and renders
 * as one, never as a silent overwrite.
 *
 * ## What this screen cannot show, and says
 *
 * There is no read of a service's versions and no read of its availability.
 * The draft this screen creates is held in state for publication because its
 * id exists nowhere else — so a held draft is unsaved work, and leaving asks
 * first; availability can be verified only through the catalogue's branch
 * filter. Both are stated on the screen rather than faked.
 *
 * ## Retired is terminal
 *
 * `archived` cannot be reversed (`svc.guard_service_lifecycle`), so retiring
 * asks in a confirmation dialog first, and a retired service offers no writes
 * at all — an edit form on a frozen row would be an invitation to a refusal.
 *
 * ## Days are calendar days
 *
 * Every date here is a `DateField` holding `YYYY-MM-DD` — the value the native
 * box produced and the routes accept. A day only partly typed is refused on its
 * own field (with the cursor put on the part to finish) rather than read as no
 * day at all.
 *
 * No money crosses this screen. `standardMinutes` would, as a decimal string,
 * if a version listed labour times; the create response carries the empty
 * draft's list, which is rendered as a count of entries and nothing more.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function ServiceDetailScreen({
  locale,
  messages,
  service,
  canManage,
  canReadBranches,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly service: ServiceDetail;
  readonly canManage: boolean;
  readonly canReadBranches: boolean;
}) {
  const router = useRouter();
  const retired = service.lifecycleStatus === 'archived';
  const taxonomy = useTaxonomy();
  const branches = useBranchList(canReadBranches, canManage && !retired);
  const categoryName = useMemo(
    () => taxonomy.categories?.find((category) => category.id === service.categoryId)?.name ?? null,
    [taxonomy.categories, service.categoryId]
  );

  return (
    <div className="flex flex-col gap-4" lang={locale}>
      <section
        aria-labelledby="service-summary-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="service-summary-heading" className="sr-only">
          {translate(messages, 'services.detail.summaryHeading')}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label={translate(messages, 'services.detail.code')}>
            <code className="font-mono text-caption" dir="ltr">
              {service.serviceCode}
            </code>
          </Field>
          <Field label={translate(messages, 'services.detail.name')}>
            <bdi>{service.name}</bdi>
          </Field>
          <Field label={translate(messages, 'services.detail.category')}>
            {categoryName !== null ? (
              <bdi>{categoryName}</bdi>
            ) : (
              // Said in words, never the identifier.
              <span className="text-text-muted">
                {translate(messages, 'services.catalogue.unknownCategory')}
              </span>
            )}
          </Field>
          <Field label={translate(messages, 'services.detail.status')}>
            <LifecycleBadge messages={messages} status={service.lifecycleStatus} />
          </Field>
          <Field label={translate(messages, 'services.detail.descriptionLabel')} wide>
            {service.description ? (
              <bdi>{service.description}</bdi>
            ) : (
              <span className="text-text-muted">
                {translate(messages, 'services.detail.noDescription')}
              </span>
            )}
          </Field>
        </dl>
        {retired ? (
          <p className="mt-3 text-body text-text-secondary">
            {translate(messages, 'services.detail.retiredNote')}
          </p>
        ) : null}
      </section>

      {!canManage ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'services.detail.noManagePermission')}
        </p>
      ) : retired ? null : (
        <>
          <EditPanel
            messages={messages}
            service={service}
            taxonomy={taxonomy}
            onDone={() => router.refresh()}
          />
          <AvailabilityPanel messages={messages} service={service} branches={branches} />
          <VersionPanel
            locale={locale}
            messages={messages}
            service={service}
            onPublished={() => router.refresh()}
          />
        </>
      )}
    </div>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-body text-text-primary">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Reference data
 * ------------------------------------------------------------------ */

/**
 * The branch list as one of six outcomes rather than three fields — the same
 * correction as the catalogue screen's, for the same reason (P1-30 CC-15).
 * `items === null` used to mean both "no request was made" and "the request has
 * not answered", and this panel resolved that toward the two identifier fields:
 * a permitted operator met free-text boxes on every first paint.
 */
type BranchList =
  | { readonly phase: 'not-offered' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'listed'; readonly items: readonly BranchOption[] }
  | { readonly phase: 'none' }
  | {
      readonly phase: 'failed';
      readonly messageKey: string;
      readonly retry: (() => void) | null;
    };

const BRANCHES_NOT_OFFERED: BranchList = { phase: 'not-offered' };
const BRANCHES_LOADING: BranchList = { phase: 'loading' };
const BRANCHES_NONE: BranchList = { phase: 'none' };

/**
 * `active` says whether the panel that needs a branch is shown at all;
 * `canRead` whether `org.branch-list` may be asked.
 *
 * The working context answers FIRST. It publishes the named branches this
 * caller may act in, so a manager without `org.branch.read` is offered those
 * rather than told there are none; the directory read is only the fallback
 * when the shell holds no answer (Owner directive, `P1-32-PRE-OD-UX`).
 */
function useBranchList(canRead: boolean, active: boolean): BranchList {
  const context = useWorkingContext();
  const fromContext = active ? branchesFromContext(context) : null;
  const wanted = active && canRead && fromContext === null;
  const [items, setItems] = useState<readonly BranchOption[] | null>(null);
  const [failure, setFailure] = useState<{ key: string; retryable: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setItems(null);
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void listBranches().then((state) => {
      if (!live) return;
      if (state.status === 'ok') {
        setItems(state.data.items);
        return;
      }
      if (state.status === 'denied') {
        setFailure({ key: 'services.catalogue.branchesRefused', retryable: false });
      } else if (state.status === 'expired') {
        setFailure({ key: 'state.expired.message', retryable: false });
      } else {
        setFailure({ key: 'services.catalogue.branchesUnavailable', retryable: true });
      }
    });
    return () => {
      live = false;
    };
  }, [wanted, attempt]);

  if (fromContext !== null) return { phase: 'listed', items: fromContext };
  if (!wanted) return BRANCHES_NOT_OFFERED;
  if (failure !== null) {
    return { phase: 'failed', messageKey: failure.key, retry: failure.retryable ? retry : null };
  }
  if (items === null) return BRANCHES_LOADING;
  if (items.length === 0) return BRANCHES_NONE;
  return { phase: 'listed', items };
}

/* ------------------------------------------------------------------ *
 * Editing — `svc.service-update`, version-guarded
 * ------------------------------------------------------------------ */

function EditPanel({
  messages,
  service,
  taxonomy,
  onDone,
}: {
  readonly messages: Messages;
  readonly service: ServiceDetail;
  readonly taxonomy: Taxonomy;
  readonly onDone: () => void;
}) {
  const opened = {
    name: service.name,
    description: service.description ?? '',
    categoryId: service.categoryId,
  };
  const [form, setForm] = useState(opened);
  const { errorKey, formRef, refuse } = useLocalRefusal(form);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [confirmingRetire, setConfirmingRetire] = useState(false);
  const [retireError, setRetireError] = useState<string | undefined>(undefined);
  const items = useMemo(() => categoryTreeItems(taxonomy.categories), [taxonomy.categories]);

  // A change from what the page read is unsaved work until it is saved.
  const dirty =
    form.name !== opened.name ||
    form.description !== opened.description ||
    form.categoryId !== opened.categoryId;
  useUnsavedGuard(dirty, () => {
    setForm(opened);
    setOutcome(null);
  });

  const errorFor = (...names: readonly string[]): string | undefined => {
    for (const name of names) {
      const key = errorKey(name) ?? outcome?.fieldErrors?.[name];
      if (key) return translateDynamic(messages, key);
    }
    return undefined;
  };

  const problemKey = (state: ActionState): string =>
    state.status === 'conflict'
      ? 'services.detail.conflict'
      : (state.messageKey ?? 'action.failed');

  const save = async () => {
    const found: Record<string, string> = {};
    const name = form.name.trim();
    if (name.length === 0) found['name'] = 'field.required';
    else if (name.length > MAX_NAME) found['name'] = 'services.create.nameTooLong';
    const description = form.description.trim();
    if (description.length > MAX_DESCRIPTION)
      found['description'] = 'services.create.descriptionTooLong';
    refuse(found);
    if (Object.keys(found).length > 0) return;

    // Only what changed travels. `description` is three-way: a blank field on a
    // service that had one CLEARS it (`null`); an unchanged field is omitted.
    const body: ServiceUpdateBody = {
      ...(name !== service.name ? { name } : {}),
      ...(form.categoryId !== service.categoryId ? { serviceCategoryId: form.categoryId } : {}),
      ...(description !== (service.description ?? '')
        ? { description: description.length === 0 ? null : description }
        : {}),
    };
    if (Object.keys(body).length === 0) {
      setOutcome({ status: 'invalid', messageKey: 'services.detail.nothingChanged' });
      return;
    }
    setBusy(true);
    const result = await updateService(service.id, body, service.recordVersion);
    setBusy(false);
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      setOutcome(null);
      onDone();
      return;
    }
    setOutcome({ ...result, messageKey: problemKey(result) });
  };

  const retire = async () => {
    setBusy(true);
    const result = await updateService(
      service.id,
      { lifecycleStatus: 'archived' },
      service.recordVersion
    );
    setBusy(false);
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      setConfirmingRetire(false);
      setRetireError(undefined);
      onDone();
      return;
    }
    // Said in the dialog that asked, which stays open on the refusal.
    setRetireError(translateDynamic(messages, problemKey(result)));
  };

  return (
    <section
      aria-labelledby="service-edit-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="service-edit-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'services.detail.editHeading')}
      </h2>
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        noValidate
        aria-labelledby="service-edit-heading"
        className="flex flex-col gap-4"
      >
        <FormTextField
          label={translate(messages, 'services.create.name')}
          required
          value={form.name}
          onChange={(name) => setForm((f) => ({ ...f, name }))}
          error={errorFor('name')}
        />
        <TreePicker
          label={translate(messages, 'services.create.category')}
          description={taxonomy.refused ? translateDynamic(messages, taxonomy.refused) : undefined}
          items={items}
          value={form.categoryId}
          onChange={(categoryId) => setForm((f) => ({ ...f, categoryId }))}
          error={errorFor('serviceCategoryId', 'categoryId')}
          testId="service-edit-category"
        />
        <FormTextField
          label={translate(messages, 'services.create.description')}
          description={translate(messages, 'services.detail.descriptionHelp')}
          multiline
          rows={3}
          value={form.description}
          onChange={(description) => setForm((f) => ({ ...f, description }))}
          error={errorFor('description')}
        />
        <OutcomeNote messages={messages} outcome={outcome} />
        <div>
          <Button type="submit" variant="contained" disabled={busy}>
            {translate(messages, 'services.detail.save')}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <h3 className="text-body font-medium text-text-primary">
          {translate(messages, 'services.detail.retire')}
        </h3>
        <p className="text-caption text-text-muted">
          {translate(messages, 'services.detail.retireConfirm')}
        </p>
        <div>
          <Button
            type="button"
            variant="outlined"
            color="error"
            disabled={busy}
            onClick={() => {
              setRetireError(undefined);
              setConfirmingRetire(true);
            }}
          >
            {translate(messages, 'services.detail.retire')}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmingRetire}
        messages={messages}
        title={translate(messages, 'services.detail.retire')}
        description={translate(messages, 'services.detail.retireConfirm')}
        confirmLabel={translate(messages, 'services.detail.retire')}
        destructive
        pending={busy}
        error={retireError}
        onCancel={() => {
          setConfirmingRetire(false);
          setRetireError(undefined);
        }}
        onConfirm={() => void retire()}
        testId="service-retire-dialog"
      />
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Availability — `svc.branch-availability-set`, branch-scoped
 * ------------------------------------------------------------------ */

function AvailabilityPanel({
  messages,
  service,
  branches,
}: {
  readonly messages: Messages;
  readonly service: ServiceDetail;
  readonly branches: BranchList;
}) {
  /*
   * Starts at the branch the operator is working in, when that is one branch:
   * availability is set FOR a branch, and the header already says which.
   */
  const working = useBranchTarget();
  const workingContext = useWorkingContext();
  const workingBranch = (): string => (working.kind === 'ready' ? working.target.branchId : '');
  const [branchId, setBranchId] = useState(workingBranch);
  const [offered, setOffered] = useState(true);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  /*
   * What the form last matched: the values it opened with, then the values
   * last recorded. A change from it is unsaved work, declared to the shell so a
   * branch switch asks before it resets the form.
   */
  const [baseline, setBaseline] = useState(() => ({ branchId: workingBranch(), offered: true }));
  useUnsavedGuard(branchId !== baseline.branchId || offered !== baseline.offered);
  // Which write is current. The reply to one made before a switch is not shown after it.
  const attempt = useRef(0);

  /*
   * The branch FOLLOWS the header, not just its first value. Seeded once, the
   * panel went on naming the previous branch after a switch. On every change it
   * is reset to the new working branch (or to nothing, when the selection is
   * not one branch), and a reply still in flight is superseded.
   */
  useWorkingContextChange(() => {
    attempt.current += 1;
    const next = workingBranch();
    setBranchId(next);
    setOffered(true);
    setBaseline({ branchId: next, offered: true });
    setErrors({});
    setOutcome(null);
    setBusy(false);
  });

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const listed = branches.phase === 'listed';
  const listedItems = branches.phase === 'listed' ? branches.items : null;
  /*
   * A branch held in this panel's own state that the list in hand cannot
   * contain is treated as nothing chosen — DERIVED, so the form can never send
   * a pair the screen is not displaying.
   */
  const stale =
    listedItems !== null && branchId !== '' && !listedItems.some((one) => one.id === branchId);
  const chosen = stale ? '' : branchId;

  const submit = async () => {
    const found: Record<string, string> = {};
    /*
     * The branch is chosen from the platform's own named list, and the company
     * comes from that branch's own row. There is no typed half left, so the
     * only rule is that a branch was chosen at all.
     */
    const branch = chosen.trim();
    if (branch.length === 0) found['branchId'] = 'field.required';
    const company = listedItems?.find((option) => option.id === branch)?.companyId ?? '';
    if (company.length === 0) found['companyId'] = 'field.required';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    attempt.current += 1;
    const mine = attempt.current;
    const result = await setBranchAvailability(service.id, {
      companyId: company,
      branchId: branch,
      isAvailable: offered,
    });
    notifyActionResult(result, messages);
    if (mine !== attempt.current) return;
    setBusy(false);
    setOutcome(result.status === 'success' ? null : result);
    if (result.status === 'success') setBaseline({ branchId: branch, offered });
  };

  return (
    <section
      aria-labelledby="service-availability-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="service-availability-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'services.availability.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'services.availability.explain')}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        aria-labelledby="service-availability-heading"
        className="flex flex-col gap-3"
      >
        {branches.phase === 'loading' ? (
          // No control yet; `role="status"` appears in no other phase here.
          <div className="flex flex-col gap-1.5">
            <p className="text-label font-medium text-text-primary">
              {translate(messages, 'services.availability.branch')}
            </p>
            <p role="status" aria-live="polite" className="text-supporting text-text-muted">
              {translate(messages, 'services.catalogue.branchesLoading')}
            </p>
          </div>
        ) : listed ? (
          <FormSelectField
            label={translate(messages, 'services.availability.branch')}
            required
            value={chosen}
            onChange={(next) => {
              setBranchId(next);
              // A complaint goes the moment the operator corrects it.
              setErrors({});
            }}
            options={(listedItems ?? []).map((branch) => ({
              value: branch.id,
              label: `${branch.branchCode} — ${branch.name}`,
            }))}
            placeholder={translate(messages, 'services.availability.chooseBranch')}
            // One control for the pair: the company's complaint lands here too.
            error={errorFor('branchId') ?? errorFor('companyId')}
          />
        ) : (
          /*
           * No branch to choose, so nothing to say about one. Availability is
           * set FOR a branch, so without one there is nothing to record, and
           * saying so is the only honest answer (Owner directive,
           * `P1-32-PRE-OD-UX`).
           */
          <div className="flex flex-col gap-1.5">
            <p className="text-label font-medium text-text-primary">
              {translate(messages, 'services.availability.branch')}
            </p>
            <p
              role="status"
              data-testid="service-availability-no-branch"
              className="text-supporting text-text-secondary"
            >
              {workingContext.present && workingContext.status === 'unavailable'
                ? translate(messages, 'workingContext.unavailable')
                : branches.phase === 'failed'
                  ? translateDynamic(messages, branches.messageKey)
                  : branches.phase === 'none'
                    ? translate(messages, 'services.catalogue.branchesNone')
                    : translate(messages, 'services.availability.noBranch')}
            </p>
            {branches.phase === 'failed' && branches.retry !== null ? (
              <div>
                <Button type="button" variant="outlined" size="small" onClick={branches.retry}>
                  {translate(messages, 'state.retry')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
        <FormControlLabel
          control={
            <Checkbox checked={offered} onChange={(event) => setOffered(event.target.checked)} />
          }
          label={translate(messages, 'services.availability.offered')}
        />
        <OutcomeNote messages={messages} outcome={outcome} />
        <div>
          {/* Nothing to submit without a branch to set it for. */}
          <Button type="submit" variant="contained" disabled={busy || !listed}>
            {translate(messages, 'services.availability.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Versions — create a draft, then publish THAT draft
 * ------------------------------------------------------------------ */

const EMPTY_VERSION = { effectiveFrom: '', effectiveTo: '', notes: '' };

function VersionPanel({
  locale,
  messages,
  service,
  onPublished,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly service: ServiceDetail;
  readonly onPublished: () => void;
}) {
  const [form, setForm] = useState(EMPTY_VERSION);
  /*
   * Whether a date field holds parts of a day and not yet a whole one. The
   * field reports `''` then, so without this a half-typed day would read as no
   * day — and an unfinished end date would be left out silently.
   */
  const [unfinished, setUnfinished] = useState<Readonly<Record<string, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const [draft, setDraft] = useState<ServiceVersion | null>(null);
  const [publishFrom, setPublishFrom] = useState('');
  // Each field's value and whether it is half typed: erasing the parts of a
  // refused day is a correction too, and withdraws its complaint.
  const {
    errorKey: refusedKey,
    formRef: refusalFormRef,
    refuse,
  } = useLocalRefusal({
    effectiveFrom: `${form.effectiveFrom}|${unfinished['effectiveFrom'] === true}`,
    effectiveTo: `${form.effectiveTo}|${unfinished['effectiveTo'] === true}`,
    notes: form.notes,
    publishFrom: `${publishFrom}|${unfinished['publishFrom'] === true}`,
  });

  /*
   * Typed and not yet created is unsaved work; so is a draft created and not
   * yet published, because its id exists nowhere but here (there is no read of
   * a service's versions) and leaving would lose the way to publish it.
   */
  const typed =
    form.effectiveFrom !== '' ||
    form.effectiveTo !== '' ||
    form.notes.trim() !== '' ||
    Object.values(unfinished).some(Boolean);
  useUnsavedGuard(typed || draft !== null, () => {
    setForm(EMPTY_VERSION);
    setUnfinished({});
    setDraft(null);
    setPublishFrom('');
    setOutcome(null);
  });

  const errorFor = (name: string): string | undefined => {
    const key = refusedKey(name) ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };
  const noteDay = (field: string) => (problem: DayProblem) =>
    setUnfinished((current) =>
      current[field] === (problem !== null) ? current : { ...current, [field]: problem !== null }
    );

  const createDraft = async () => {
    const found: Record<string, string> = {};
    const effectiveFrom = form.effectiveFrom.trim();
    if (unfinished['effectiveFrom'] || !ISO_DATE.test(effectiveFrom)) {
      found['effectiveFrom'] = 'services.catalogue.dateFormat';
    }
    const effectiveTo = form.effectiveTo.trim();
    if (unfinished['effectiveTo'] || (effectiveTo.length > 0 && !ISO_DATE.test(effectiveTo))) {
      found['effectiveTo'] = 'services.catalogue.dateFormat';
    } else if (effectiveTo.length > 0 && effectiveTo <= effectiveFrom) {
      // Two ISO dates compare correctly as strings; the range is half-open.
      found['effectiveTo'] = 'services.version.rangeOrder';
    }
    const notes = form.notes.trim();
    if (notes.length > MAX_NOTES) found['notes'] = 'services.version.notesTooLong';
    refuse(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createServiceVersion(service.id, {
      effectiveFrom,
      ...(effectiveTo ? { effectiveTo } : {}),
      ...(notes ? { notes } : {}),
    });
    setBusy(false);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      // What was typed is now the draft: the form is empty again, so once the
      // draft is published nothing is left here to call unsaved.
      setForm(EMPTY_VERSION);
      setUnfinished({});
      setOutcome(null);
      setDraft(result.created);
      setPublishFrom(result.created.effectiveFrom);
      return;
    }
    setOutcome(result.state);
  };

  const publish = async () => {
    if (!draft) return;
    const from = publishFrom.trim();
    if (unfinished['publishFrom'] || !ISO_DATE.test(from)) {
      refuse({ publishFrom: 'services.catalogue.dateFormat' });
      return;
    }
    refuse({});
    setBusy(true);
    const result = await publishServiceVersion(
      service.id,
      draft.id,
      { effectiveFrom: from },
      service.recordVersion
    );
    setBusy(false);
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      setForm(EMPTY_VERSION);
      setUnfinished({});
      setDraft(null);
      setPublishFrom('');
      setOutcome(null);
      onPublished();
      return;
    }
    /*
     * The publish refusal is filed against the control this form renders.
     *
     * `svc.service-version-publish` takes the date as `effectiveFrom`, so a
     * forward-only refusal arrives keyed `effectiveFrom` — but the only date on
     * screen at this point is `publishFrom`, and the control named
     * `effectiveFrom` belongs to the draft form this branch has already
     * replaced. Left as it arrived, the sentence would be written to a name
     * nothing reads, which on screen is the same as dropping it.
     */
    const published = result.fieldErrors;
    const forThisForm =
      published && published['effectiveFrom'] !== undefined
        ? { ...published, publishFrom: published['effectiveFrom'] }
        : published;
    setOutcome({
      ...result,
      ...(forThisForm ? { fieldErrors: forThisForm } : {}),
      messageKey:
        result.status === 'conflict'
          ? 'services.detail.conflict'
          : (result.messageKey ?? 'action.failed'),
    });
  };

  return (
    <section
      aria-labelledby="service-versions-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="service-versions-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'services.version.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'services.version.explain')}
      </p>

      {draft === null ? (
        <form
          ref={refusalFormRef}
          onSubmit={(event) => {
            event.preventDefault();
            void createDraft();
          }}
          noValidate
          aria-labelledby="service-versions-heading"
          className="grid gap-4 sm:grid-cols-2"
        >
          <DateField
            label={translate(messages, 'services.version.effectiveFrom')}
            required
            value={form.effectiveFrom}
            onChange={(effectiveFrom) => setForm((f) => ({ ...f, effectiveFrom }))}
            onProblem={noteDay('effectiveFrom')}
            error={errorFor('effectiveFrom')}
            testId="service-version-from"
          />
          <DateField
            label={translate(messages, 'services.version.effectiveTo')}
            description={translate(messages, 'services.version.effectiveToHelp')}
            value={form.effectiveTo}
            onChange={(effectiveTo) => setForm((f) => ({ ...f, effectiveTo }))}
            onProblem={noteDay('effectiveTo')}
            error={errorFor('effectiveTo')}
            testId="service-version-to"
          />
          <div className="sm:col-span-2">
            <FormTextField
              label={translate(messages, 'services.version.notes')}
              multiline
              rows={3}
              value={form.notes}
              onChange={(notes) => setForm((f) => ({ ...f, notes }))}
              error={errorFor('notes')}
            />
          </div>
          <div className="sm:col-span-2">
            <OutcomeNote messages={messages} outcome={outcome} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="contained" disabled={busy}>
              {translate(messages, 'services.version.createDraft')}
            </Button>
          </div>
        </form>
      ) : (
        <form
          ref={refusalFormRef}
          onSubmit={(event) => {
            event.preventDefault();
            void publish();
          }}
          noValidate
          aria-labelledby="service-draft-heading"
          className="flex flex-col gap-3 border-t border-border pt-3"
        >
          <h3 id="service-draft-heading" className="text-body font-medium text-text-primary">
            {translate(messages, 'services.version.draftHeading')}
          </h3>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Field label={translate(messages, 'services.version.number')}>
              <code className="font-mono text-caption" dir="ltr">
                {draft.versionNo}
              </code>
            </Field>
            <Field label={translate(messages, 'services.version.effectiveFrom')}>
              <code className="font-mono text-caption" dir="ltr">
                {draft.effectiveFrom}
              </code>
            </Field>
            <Field label={translate(messages, 'services.version.effectiveTo')}>
              {draft.effectiveTo ? (
                <code className="font-mono text-caption" dir="ltr">
                  {draft.effectiveTo}
                </code>
              ) : (
                <span className="text-text-muted">
                  {translate(messages, 'services.version.noEnd')}
                </span>
              )}
            </Field>
          </dl>
          <p className="text-caption text-text-muted">
            {translate(messages, 'services.version.labourNote')}{' '}
            <code className="font-mono" dir="ltr">
              {draft.laborTimes.length}
            </code>
          </p>
          <DateField
            label={translate(messages, 'services.version.publishFrom')}
            required
            value={publishFrom}
            onChange={setPublishFrom}
            onProblem={noteDay('publishFrom')}
            error={errorFor('publishFrom')}
            testId="service-version-publish-from"
          />
          <OutcomeNote messages={messages} outcome={outcome} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="contained" disabled={busy}>
              {translate(messages, 'services.version.publish')}
            </Button>
            <Button
              type="button"
              variant="outlined"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setPublishFrom('');
                setOutcome(null);
              }}
            >
              {translate(messages, 'services.version.discardDraft')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
