'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { FormDialog } from '@/features/administration/shared/components/FormDialog';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import { isKnownZone } from '@/lib/branch-time';
import type { ReadState } from '@/lib/api/read-operation';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';
import { retireTechnician, setTechnicianActive, updateTechnicianDetails } from '../roster-actions';
import { readTechnician } from '../roster-api';
import {
  MAX_EMPLOYMENT_REF,
  MAX_TRADE,
  type TechnicianProfileDetail,
  type TechnicianRosterEntry,
} from '../roster-types';
import {
  DetailRow,
  UnsavedWork,
  refusalSentence,
  technicianName,
  useOneWrite,
} from './roster-parts';
import {
  AvailabilitySection,
  CertificationsSection,
  QueueSection,
  SkillsSection,
} from './TechnicianProfileSections';

/**
 * One technician's profile (`P1-32-PRE-OD-ADM2B`), reached by its address, on
 * the shared Material wrappers (ADR-022).
 *
 * ## One read, one screen
 *
 * `tech.technician-detail` answers the profile with its skills, certifications
 * and upcoming availability; the queue is `tech.technician-queue`, read beside
 * it. The profile's own branch decides everything here — the server re-decides
 * every request against it — so the page reads no working branch at all, and
 * every moment is shown on THAT branch's clock, taken from the branches this
 * session works in. Where the clock is not known, the times say which clock
 * they are on and no window can be entered.
 *
 * ## After a change, the screen re-reads and keeps its place
 *
 * A write that succeeds re-reads the profile while the page stays drawn, so the
 * button that opened the form is still there to take focus back. A write the
 * server refuses as stale closes its form and says so beside the profile, with
 * "Load the latest version"; nothing is re-sent on the operator's behalf.
 *
 * ## What can and cannot change here
 *
 * Every write is offered only with `tech.technician.manage`, and the
 * certificate number only with `iam.sensitive.view` as well. The branch and the
 * person are fixed: a transfer is "Take off the roster" here and "Add
 * technician" in the other branch.
 */
export function TechnicianProfileScreen({
  messages,
  locale,
  technicianProfileId,
  canManage,
  canRecordSensitive,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly technicianProfileId: string;
  readonly canManage: boolean;
  /** `tech.technician.manage` AND `iam.sensitive.view`. */
  readonly canRecordSensitive: boolean;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const router = useRouter();
  const context = useWorkingContext();
  const [generation, setGeneration] = useState(0);
  const [held, setHeld] = useState<ReadState<TechnicianProfileDetail> | null>(null);
  const [conflict, setConflict] = useState<ActionState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let state: ReadState<TechnicianProfileDetail>;
      try {
        state = await readTechnician(technicianProfileId);
      } catch {
        state = { status: 'unavailable', correlationId: null };
      }
      if (!cancelled) setHeld(state);
    })();
    return () => {
      cancelled = true;
    };
  }, [technicianProfileId, generation]);

  const reload = useCallback(() => setGeneration((current) => current + 1), []);
  /** What every write calls with its answer: re-read on success, say a conflict, else nothing. */
  const settle = useCallback(
    (outcome: ActionState) => {
      if (outcome.status === 'success') {
        setConflict(null);
        reload();
      } else if (outcome.status === 'conflict') {
        setConflict(outcome);
      }
    },
    [reload]
  );

  if (held === null) {
    return <MuiLoadingState messages={messages} testId="technician-profile-loading" />;
  }
  if (held.status !== 'ok') {
    return (
      <div className="flex flex-col gap-4">
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={held.status}
          correlationId={held.correlationId}
          onRetry={held.status === 'not-found' || held.status === 'denied' ? undefined : reload}
          testId="technician-profile-failure"
        />
        <BackToRoster messages={messages} locale={locale} />
      </div>
    );
  }

  const detail = held.data;
  const profile = detail.profile;
  const branch = context.branches.find((entry) => entry.id === profile.branchId) ?? null;
  const zone = branch !== null && isKnownZone(branch.timezone) ? branch.timezone : null;

  return (
    <div className="flex flex-col gap-6" data-testid="technician-profile">
      <BackToRoster messages={messages} locale={locale} />

      {conflict ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-body text-error">
            {translateWithValues(
              messages,
              conflict.messageKey ?? 'state.conflict.message',
              conflict.messageValues
            )}
          </p>
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() => {
              setConflict(null);
              reload();
            }}
          >
            {t('form.loadLatest')}
          </Button>
        </div>
      ) : null}

      <ProfileSection
        messages={messages}
        profile={profile}
        branchName={branch?.name ?? null}
        canManage={canManage}
        onSettled={settle}
        onRetired={() => router.push(`/${locale}/technicians`)}
      />

      <SkillsSection
        messages={messages}
        profile={profile}
        skills={detail.skills}
        canManage={canManage}
        onSettled={settle}
      />

      <CertificationsSection
        messages={messages}
        locale={locale}
        profile={profile}
        certifications={detail.certifications}
        zone={zone}
        canManage={canManage}
        canRecordSensitive={canRecordSensitive}
        onSettled={settle}
      />

      <AvailabilitySection
        messages={messages}
        locale={locale}
        profile={profile}
        windows={detail.availability}
        zone={zone}
        canManage={canManage}
        onSettled={settle}
      />

      <QueueSection
        messages={messages}
        locale={locale}
        technicianProfileId={profile.id}
        zone={zone}
      />
    </div>
  );
}

function BackToRoster({
  messages,
  locale,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
}) {
  return (
    <div>
      <Button variant="text" href={`/${locale}/technicians`} data-testid="technician-profile-back">
        {translate(messages, 'technicians.profile.backToRoster')}
      </Button>
    </div>
  );
}

type ProfileQuestion = 'activate' | 'deactivate' | 'retire';

function ProfileSection({
  messages,
  profile,
  branchName,
  canManage,
  onSettled,
  onRetired,
}: {
  readonly messages: Messages;
  readonly profile: TechnicianRosterEntry;
  readonly branchName: string | null;
  readonly canManage: boolean;
  readonly onSettled: (outcome: ActionState) => void;
  readonly onRetired: () => void;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState<ProfileQuestion | null>(null);
  const [answer, setAnswer] = useState<ActionState>(IDLE);
  const write = useOneWrite();
  const name = technicianName(messages, profile);

  const decide = async (asked: ProfileQuestion) => {
    const outcome = await write.run(() =>
      asked === 'retire'
        ? retireTechnician(profile.id, profile.recordVersion)
        : setTechnicianActive(profile.id, profile.recordVersion, asked === 'activate')
    );
    if (outcome === null) return;
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success' || outcome.status === 'conflict') {
      setQuestion(null);
      setAnswer(IDLE);
      if (outcome.status === 'success' && asked === 'retire') {
        onRetired();
        return;
      }
      onSettled(outcome);
      return;
    }
    setAnswer(outcome);
  };

  return (
    <section aria-labelledby="technician-profile-heading" className="flex flex-col gap-3">
      <h2
        id="technician-profile-heading"
        className="text-section-title font-medium text-text-primary"
      >
        {profile.displayName === null ? name : <bdi>{profile.displayName}</bdi>}
      </h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DetailRow term={t('admin.scope.branch')}>
          {branchName === null ? t('technicians.profile.branchNotListed') : <bdi>{branchName}</bdi>}
        </DetailRow>
        <DetailRow term={t('technicians.roster.filter.state')}>
          {t(
            profile.isActive
              ? 'technicians.roster.state.active'
              : 'technicians.roster.state.inactive'
          )}
        </DetailRow>
        <DetailRow term={t('technicians.roster.trade')}>
          {profile.trade === null ? t('technicians.roster.noTrade') : <bdi>{profile.trade}</bdi>}
        </DetailRow>
        <DetailRow term={t('technicians.roster.employmentRef')}>
          {profile.employmentRef === null ? (
            t('technicians.roster.noReference')
          ) : (
            <bdi>{profile.employmentRef}</bdi>
          )}
        </DetailRow>
      </dl>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outlined" onClick={() => setEditing(true)}>
            {t('technicians.profile.edit')}
          </Button>
          <Button
            type="button"
            variant="outlined"
            onClick={() => {
              setAnswer(IDLE);
              setQuestion(profile.isActive ? 'deactivate' : 'activate');
            }}
          >
            {t(
              profile.isActive ? 'technicians.profile.deactivate' : 'technicians.profile.activate'
            )}
          </Button>
          <Button
            type="button"
            variant="outlined"
            color="error"
            onClick={() => {
              setAnswer(IDLE);
              setQuestion('retire');
            }}
          >
            {t('technicians.profile.retire')}
          </Button>
        </div>
      ) : null}

      {editing ? (
        <EditProfileDialog
          messages={messages}
          profile={profile}
          onDone={(outcome) => {
            setEditing(false);
            onSettled(outcome);
          }}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {question ? (
        <ConfirmDialog
          open
          messages={messages}
          destructive={question !== 'activate'}
          pending={write.running}
          title={t(
            question === 'retire'
              ? 'technicians.profile.confirmRetire'
              : question === 'deactivate'
                ? 'technicians.profile.confirmDeactivate'
                : 'technicians.profile.confirmActivate'
          )}
          description={`${name}. ${t(
            question === 'retire'
              ? 'technicians.profile.confirmRetireBody'
              : question === 'deactivate'
                ? 'technicians.profile.confirmDeactivateBody'
                : 'technicians.profile.confirmActivateBody'
          )}`}
          confirmLabel={t(
            question === 'retire'
              ? 'technicians.profile.retire'
              : question === 'deactivate'
                ? 'technicians.profile.deactivate'
                : 'technicians.profile.activate'
          )}
          error={refusalSentence(messages, answer)}
          onCancel={() => {
            setQuestion(null);
            setAnswer(IDLE);
          }}
          onConfirm={() => void decide(question)}
          testId="technician-profile-confirm"
        />
      ) : null}
    </section>
  );
}

function EditProfileDialog({
  messages,
  profile,
  onDone,
  onClose,
}: {
  readonly messages: Messages;
  readonly profile: TechnicianRosterEntry;
  /** Called with a success or a conflict; either closes the form. */
  readonly onDone: (outcome: ActionState) => void;
  readonly onClose: () => void;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [trade, setTrade] = useState(profile.trade ?? '');
  const [employmentRef, setEmploymentRef] = useState(profile.employmentRef ?? '');
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<ActionState>(IDLE);
  const write = useOneWrite();
  const { errors, formRef } = useHeldRefusal(fieldErrors, { trade, employmentRef });
  const errorFor = (field: string): string | undefined => {
    const key = errors[field];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    setProblem(IDLE);
    const found: Record<string, string> = {};
    if (trade.trim().length > MAX_TRADE) found['trade'] = 'field.tooLong';
    if (employmentRef.trim().length > MAX_EMPLOYMENT_REF) found['employmentRef'] = 'field.tooLong';
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    const outcome = await write.run(() =>
      updateTechnicianDetails(profile.id, profile.recordVersion, {
        trade,
        employmentRef,
        previousTrade: profile.trade,
        previousEmploymentRef: profile.employmentRef,
      })
    );
    if (outcome === null) return;
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success' || outcome.status === 'conflict') {
      onDone(outcome);
      return;
    }
    if (outcome.fieldErrors && Object.keys(outcome.fieldErrors).length > 0) {
      setFieldErrors(outcome.fieldErrors);
    }
    setProblem(outcome);
  };

  const dirty = useMemo(
    () => trade !== (profile.trade ?? '') || employmentRef !== (profile.employmentRef ?? ''),
    [trade, employmentRef, profile.trade, profile.employmentRef]
  );

  return (
    <FormDialog
      messages={messages}
      title={t('technicians.profile.edit')}
      description={t('technicians.profile.editDescription')}
      submitLabel={t('admin.save')}
      pending={write.running}
      error={refusalSentence(messages, problem)}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="technician-profile-edit"
    >
      <FormTextField
        name="trade"
        label={t('technicians.roster.trade')}
        description={t('technicians.roster.tradeHint')}
        value={trade}
        onChange={setTrade}
        error={errorFor('trade')}
        autoComplete="off"
        maxLength={MAX_TRADE}
        autoFocus
      />
      <FormTextField
        name="employmentRef"
        label={t('technicians.roster.employmentRef')}
        description={t('technicians.profile.clearHint')}
        value={employmentRef}
        onChange={setEmploymentRef}
        error={errorFor('employmentRef')}
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_EMPLOYMENT_REF}
      />
      <UnsavedWork dirty={dirty} onDiscard={onClose} />
    </FormDialog>
  );
}
