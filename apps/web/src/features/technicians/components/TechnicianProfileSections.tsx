'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import {
  useServerTable,
  type ServerPage,
  type ServerTable,
} from '@/components/data-table/use-server-table';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import {
  DateField,
  ZonedDateTimeField,
  type DayProblem,
  type MomentProblem,
} from '@/components/forms/mui/DateField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState } from '@/components/states/MuiStates';
import { FormDialog } from '@/features/administration/shared/components/FormDialog';
import {
  assignmentRoleLabel,
  jobStateLabel,
  workOrderStateLabel,
} from '@/features/work-orders/work-orders-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDayInZone, formatInZone, type CalendarDay } from '@/lib/branch-time';
import { formatDateTime, intlLocale } from '@/lib/format';
import type { ReadState } from '@/lib/api/read-operation';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';
import {
  recordAvailability,
  recordCertificateNumber,
  setTechnicianSkill,
  updateTechnicianCertification,
  withdrawAvailability,
  withdrawTechnicianSkill,
} from '../roster-actions';
import { readSkillCatalogue, readTechnicianQueue } from '../roster-api';
import {
  AVAILABILITY_KINDS,
  CERTIFICATION_STATUSES,
  MAX_AVAILABILITY_REASON,
  MAX_CERTIFICATE_NUMBER,
  type AvailabilityWindow,
  type HeldCertification,
  type HeldSkill,
  type TechnicianQueueItem,
  type TechnicianRosterEntry,
  type TechnicianSkillCatalogue,
} from '../roster-types';
import { UnsavedWork, refusalSentence, technicianName, useOneWrite } from './roster-parts';

/**
 * The sections of a technician's profile (`P1-32-PRE-OD-ADM2B`): skills,
 * certifications, availability and the work assigned now.
 *
 * Each section's writes are offered only with `tech.technician.manage`. Every
 * form is the shared `FormDialog`; every "are you sure" is the shared
 * `ConfirmDialog`. Each write is sent once, however often it is pressed; a
 * refusal stays in its form with the field it is about marked; a success or a
 * stale record is handed to the profile, which re-reads or says so.
 */

type Settle = (outcome: ActionState) => void;

/** A field's catalogue key, translated, or nothing. */
function fieldError(
  messages: Messages,
  errors: Readonly<Record<string, string>>,
  field: string
): string | undefined {
  const key = errors[field];
  return key ? translateDynamic(messages, key) : undefined;
}

/** A moment on the branch's clock, or on this device's clock with the clock said. */
function momentText(value: string, locale: Locale, zone: string | null): string {
  return zone === null
    ? formatDateTime(value, locale)
    : formatInZone(value, intlLocale(locale), zone);
}

/**
 * A calendar day, said in the reader's language. A day names no instant, so it
 * reads the same on any clock; the branch's is used when it is known, and the
 * world clock otherwise, so the day is never moved.
 */
function dayText(day: CalendarDay, locale: Locale, zone: string | null): string {
  return formatDayInZone(day, intlLocale(locale), zone ?? 'UTC');
}

// ─── Skills ──────────────────────────────────────────────────────────────────

type SkillCatalogueState = ReadState<TechnicianSkillCatalogue> | null;

export function SkillsSection({
  messages,
  profile,
  skills,
  canManage,
  onSettled,
}: {
  readonly messages: Messages;
  readonly profile: TechnicianRosterEntry;
  readonly skills: readonly HeldSkill[];
  readonly canManage: boolean;
  readonly onSettled: Settle;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [catalogue, setCatalogue] = useState<SkillCatalogueState>(null);
  const [editing, setEditing] = useState<HeldSkill | 'new' | null>(null);
  const [withdrawing, setWithdrawing] = useState<HeldSkill | null>(null);
  const [answer, setAnswer] = useState<ActionState>(IDLE);
  const write = useOneWrite();

  // The vocabulary is read only where a skill can be given: a reader has no use for it.
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void (async () => {
      let state: ReadState<TechnicianSkillCatalogue>;
      try {
        state = await readSkillCatalogue();
      } catch {
        state = { status: 'unavailable', correlationId: null };
      }
      if (!cancelled) setCatalogue(state);
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const held = new Set(skills.map((skill) => skill.skillId));
  const offerable =
    catalogue?.status === 'ok' ? catalogue.data.skills.filter((skill) => !held.has(skill.id)) : [];

  const withdraw = async (skill: HeldSkill) => {
    const outcome = await write.run(() => withdrawTechnicianSkill(profile.id, skill.skillId));
    if (outcome === null) return;
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success' || outcome.status === 'conflict') {
      setWithdrawing(null);
      setAnswer(IDLE);
      onSettled(outcome);
      return;
    }
    setAnswer(outcome);
  };

  return (
    <section aria-labelledby="technician-skills-heading" className="flex flex-col gap-3">
      <h2
        id="technician-skills-heading"
        className="text-section-title font-medium text-text-primary"
      >
        {t('technicians.skills.heading')}
      </h2>
      {skills.length === 0 ? (
        <p className="text-body text-text-secondary" data-testid="technician-skills-empty">
          {t('technicians.skills.none')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="technician-skills">
          {skills.map((skill) => (
            <li key={skill.skillId} className="flex flex-wrap items-center gap-3">
              <span className="text-body text-text-primary">
                <bdi className="font-medium">{skill.skillName}</bdi>
                {' — '}
                <bdi>{skill.skillLevelName}</bdi>
              </span>
              {canManage ? (
                <span className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="small"
                    variant="outlined"
                    disabled={catalogue?.status !== 'ok'}
                    aria-label={`${t('technicians.skills.changeLevel')}: ${skill.skillName}`}
                    onClick={() => setEditing(skill)}
                  >
                    {t('technicians.skills.changeLevel')}
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant="outlined"
                    color="error"
                    aria-label={`${t('technicians.skills.withdraw')}: ${skill.skillName}`}
                    onClick={() => {
                      setAnswer(IDLE);
                      setWithdrawing(skill);
                    }}
                  >
                    {t('technicians.skills.withdraw')}
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        catalogue === null ? (
          <p
            className="text-caption text-text-muted"
            data-testid="technician-skills-catalogue-loading"
          >
            {t('technicians.skills.catalogueLoading')}
          </p>
        ) : catalogue.status !== 'ok' ? (
          <p
            className="text-caption text-text-muted"
            data-testid="technician-skills-catalogue-failed"
          >
            {t('technicians.skills.catalogueUnavailable')}
          </p>
        ) : catalogue.data.skills.length === 0 || catalogue.data.skillLevels.length === 0 ? (
          <p
            className="text-caption text-text-muted"
            data-testid="technician-skills-catalogue-empty"
          >
            {t('technicians.skills.catalogueEmpty')}
          </p>
        ) : offerable.length === 0 ? (
          <p className="text-caption text-text-muted" data-testid="technician-skills-all-held">
            {t('technicians.skills.allHeld')}
          </p>
        ) : (
          <div>
            <Button type="button" variant="outlined" onClick={() => setEditing('new')}>
              {t('technicians.skills.add')}
            </Button>
          </div>
        )
      ) : null}

      {editing !== null && catalogue?.status === 'ok' ? (
        <SkillDialog
          messages={messages}
          profile={profile}
          catalogue={catalogue.data}
          offerable={offerable}
          holding={editing === 'new' ? null : editing}
          onDone={(outcome) => {
            setEditing(null);
            onSettled(outcome);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {withdrawing ? (
        <ConfirmDialog
          open
          messages={messages}
          destructive
          pending={write.running}
          title={t('technicians.skills.confirmWithdraw')}
          description={`${withdrawing.skillName}. ${t('technicians.skills.confirmWithdrawBody')}`}
          confirmLabel={t('technicians.skills.withdraw')}
          error={refusalSentence(messages, answer)}
          onCancel={() => {
            setWithdrawing(null);
            setAnswer(IDLE);
          }}
          onConfirm={() => void withdraw(withdrawing)}
          testId="technician-skill-withdraw"
        />
      ) : null}
    </section>
  );
}

function SkillDialog({
  messages,
  profile,
  catalogue,
  offerable,
  holding,
  onDone,
  onClose,
}: {
  readonly messages: Messages;
  readonly profile: TechnicianRosterEntry;
  readonly catalogue: TechnicianSkillCatalogue;
  readonly offerable: TechnicianSkillCatalogue['skills'];
  /** The holding whose level changes, or null to give a new skill. */
  readonly holding: HeldSkill | null;
  readonly onDone: Settle;
  readonly onClose: () => void;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [skillId, setSkillId] = useState(holding?.skillId ?? '');
  const [skillLevelId, setSkillLevelId] = useState(holding?.skillLevelId ?? '');
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<ActionState>(IDLE);
  const write = useOneWrite();
  const { errors, formRef } = useHeldRefusal(fieldErrors, { skillId, skillLevelId });
  const levels = useMemo(
    () => [...catalogue.skillLevels].sort((a, b) => a.rank - b.rank),
    [catalogue.skillLevels]
  );

  const submit = async () => {
    setProblem(IDLE);
    const found: Record<string, string> = {};
    if (skillId === '') found['skillId'] = 'technicians.skills.skillRequired';
    if (skillLevelId === '') found['skillLevelId'] = 'technicians.skills.levelRequired';
    else if (holding !== null && skillLevelId === holding.skillLevelId) {
      found['skillLevelId'] = 'technicians.skills.levelUnchanged';
    }
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    const outcome = await write.run(() =>
      setTechnicianSkill(profile.id, { skillId, skillLevelId })
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

  const dirty =
    holding === null
      ? skillId !== '' || skillLevelId !== ''
      : skillLevelId !== holding.skillLevelId;

  return (
    <FormDialog
      messages={messages}
      title={t(holding === null ? 'technicians.skills.add' : 'technicians.skills.changeLevel')}
      description={`${technicianName(messages, profile)}.${holding === null ? '' : ` ${holding.skillName}.`}`}
      submitLabel={t('admin.save')}
      pending={write.running}
      error={refusalSentence(messages, problem)}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="technician-skill-form"
    >
      {holding === null ? (
        <FormSelectField
          name="skillId"
          label={t('technicians.skills.skill')}
          value={skillId}
          onChange={setSkillId}
          error={fieldError(messages, errors, 'skillId')}
          placeholder={t('technicians.skills.chooseSkill')}
          required
          options={offerable.map((skill) => ({
            value: skill.id,
            label: skill.discipline ? `${skill.name} — ${skill.discipline}` : skill.name,
          }))}
        />
      ) : null}
      <FormSelectField
        name="skillLevelId"
        label={t('technicians.skills.level')}
        value={skillLevelId}
        onChange={setSkillLevelId}
        error={fieldError(messages, errors, 'skillLevelId')}
        placeholder={t('technicians.skills.chooseLevel')}
        required
        options={levels.map((level) => ({ value: level.id, label: level.name }))}
      />
      <UnsavedWork dirty={dirty} onDiscard={onClose} />
    </FormDialog>
  );
}

// ─── Certifications ──────────────────────────────────────────────────────────

function certificationStatusText(messages: Messages, status: string): string {
  return (CERTIFICATION_STATUSES as readonly string[]).includes(status)
    ? translateDynamic(messages, `technicians.certifications.status.${status}`)
    : status;
}

export function CertificationsSection({
  messages,
  locale,
  profile,
  certifications,
  zone,
  canManage,
  canRecordSensitive,
  onSettled,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly profile: TechnicianRosterEntry;
  readonly certifications: readonly HeldCertification[];
  readonly zone: string | null;
  readonly canManage: boolean;
  readonly canRecordSensitive: boolean;
  readonly onSettled: Settle;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [changing, setChanging] = useState<HeldCertification | null>(null);
  const [numbering, setNumbering] = useState<HeldCertification | null>(null);

  return (
    <section aria-labelledby="technician-certifications-heading" className="flex flex-col gap-3">
      <h2
        id="technician-certifications-heading"
        className="text-section-title font-medium text-text-primary"
      >
        {t('technicians.certifications.heading')}
      </h2>
      {certifications.length === 0 ? (
        <p className="text-body text-text-secondary" data-testid="technician-certifications-empty">
          {t('technicians.certifications.none')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="technician-certifications">
          {certifications.map((held) => (
            <li key={held.certificationId} className="flex flex-col gap-1">
              <span className="text-body text-text-primary">
                <bdi className="font-medium">{held.certificationName}</bdi>
                {' — '}
                {certificationStatusText(messages, held.certStatus)}
                {held.isSafetyCritical
                  ? ` · ${t('technicians.certifications.safetyCritical')}`
                  : ''}
              </span>
              <span className="text-caption text-text-secondary">
                {`${t('technicians.certifications.issuedOn')}: ${dayText(held.issuedOnDay, locale, zone)} · ${
                  held.expiresOn === null
                    ? t('technicians.certifications.noExpiry')
                    : `${t('technicians.certifications.expiresOn')}: ${dayText(held.expiresOn, locale, zone)}`
                }`}
              </span>
              {canManage ? (
                <span className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="small"
                    variant="outlined"
                    aria-label={`${t('technicians.certifications.change')}: ${held.certificationName}`}
                    onClick={() => setChanging(held)}
                  >
                    {t('technicians.certifications.change')}
                  </Button>
                  {canRecordSensitive ? (
                    <Button
                      type="button"
                      size="small"
                      variant="outlined"
                      aria-label={`${t('technicians.certifications.recordNumber')}: ${held.certificationName}`}
                      onClick={() => setNumbering(held)}
                    >
                      {t('technicians.certifications.recordNumber')}
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <p
          className="text-caption text-text-muted"
          data-testid="technician-certifications-no-record"
        >
          {t('technicians.certifications.recordUnavailable')}
        </p>
      ) : null}

      {changing ? (
        <CertificationDialog
          messages={messages}
          profile={profile}
          held={changing}
          zone={zone}
          onDone={(outcome) => {
            setChanging(null);
            onSettled(outcome);
          }}
          onClose={() => setChanging(null)}
        />
      ) : null}
      {numbering ? (
        <CertificateNumberDialog
          messages={messages}
          profile={profile}
          held={numbering}
          onDone={(outcome) => {
            setNumbering(null);
            onSettled(outcome);
          }}
          onClose={() => setNumbering(null)}
        />
      ) : null}
    </section>
  );
}

function CertificationDialog({
  messages,
  profile,
  held,
  zone,
  onDone,
  onClose,
}: {
  readonly messages: Messages;
  readonly profile: TechnicianRosterEntry;
  readonly held: HeldCertification;
  readonly zone: string | null;
  readonly onDone: Settle;
  readonly onClose: () => void;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [certStatus, setCertStatus] = useState(held.certStatus);
  const [expiresOn, setExpiresOn] = useState<CalendarDay | ''>(held.expiresOn ?? '');
  const [dayProblem, setDayProblem] = useState<DayProblem | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<ActionState>(IDLE);
  const write = useOneWrite();
  const { errors, formRef } = useHeldRefusal(fieldErrors, { certStatus, expiresOn });

  const submit = async () => {
    setProblem(IDLE);
    const found: Record<string, string> = {};
    if (dayProblem === 'incomplete')
      found['expiresOn'] = 'technicians.certifications.expiryIncomplete';
    else if (dayProblem !== null) found['expiresOn'] = 'field.invalid';
    else if (expiresOn !== '' && expiresOn < held.issuedOnDay) {
      found['expiresOn'] = 'form.violation.before-issued';
    }
    if (
      certStatus === held.certStatus &&
      (expiresOn === '' ? null : expiresOn) === held.expiresOn
    ) {
      found['certStatus'] = 'technicians.certifications.unchanged';
    }
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    const outcome = await write.run(() =>
      updateTechnicianCertification(profile.id, held.certificationId, held.recordVersion, {
        certStatus,
        expiresOn,
        previousStatus: held.certStatus,
        previousExpiresOn: held.expiresOn,
        issuedOnDay: held.issuedOnDay,
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

  const dirty = certStatus !== held.certStatus || expiresOn !== (held.expiresOn ?? '');

  return (
    <FormDialog
      messages={messages}
      title={t('technicians.certifications.change')}
      description={`${technicianName(messages, profile)}. ${held.certificationName}.`}
      submitLabel={t('admin.save')}
      pending={write.running}
      error={refusalSentence(messages, problem)}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="technician-certification-form"
    >
      <FormSelectField
        name="certStatus"
        label={t('technicians.certifications.state')}
        value={certStatus}
        onChange={setCertStatus}
        error={fieldError(messages, errors, 'certStatus')}
        required
        options={CERTIFICATION_STATUSES.map((status) => ({
          value: status,
          label: certificationStatusText(messages, status),
        }))}
      />
      <DateField
        name="expiresOn"
        label={t('technicians.certifications.expiresOn')}
        description={t('technicians.certifications.expiresOnHint')}
        value={expiresOn}
        onChange={setExpiresOn}
        onProblem={setDayProblem}
        min={held.issuedOnDay}
        timezone={zone ?? undefined}
        error={fieldError(messages, errors, 'expiresOn')}
      />
      <UnsavedWork dirty={dirty} onDiscard={onClose} />
    </FormDialog>
  );
}

function CertificateNumberDialog({
  messages,
  profile,
  held,
  onDone,
  onClose,
}: {
  readonly messages: Messages;
  readonly profile: TechnicianRosterEntry;
  readonly held: HeldCertification;
  readonly onDone: Settle;
  readonly onClose: () => void;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [certificateNumber, setCertificateNumber] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<ActionState>(IDLE);
  const write = useOneWrite();
  const { errors, formRef } = useHeldRefusal(fieldErrors, { certificateNumber });

  const submit = async () => {
    setProblem(IDLE);
    const value = certificateNumber.trim();
    const found: Record<string, string> = {};
    if (value.length === 0) found['certificateNumber'] = 'field.required';
    else if (value.length > MAX_CERTIFICATE_NUMBER) found['certificateNumber'] = 'field.tooLong';
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    const outcome = await write.run(() =>
      recordCertificateNumber(profile.id, held.certificationId, value)
    );
    if (outcome === null) return;
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success' || outcome.status === 'conflict') {
      setCertificateNumber('');
      onDone(outcome);
      return;
    }
    if (outcome.fieldErrors && Object.keys(outcome.fieldErrors).length > 0) {
      setFieldErrors(outcome.fieldErrors);
    }
    setProblem(outcome);
  };

  return (
    <FormDialog
      messages={messages}
      title={t('technicians.certifications.recordNumber')}
      description={`${held.certificationName}. ${t('technicians.certifications.recordNumberHint')}`}
      submitLabel={t('admin.save')}
      pending={write.running}
      error={refusalSentence(messages, problem)}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="technician-certificate-number-form"
    >
      <FormTextField
        name="certificateNumber"
        label={t('technicians.certifications.number')}
        value={certificateNumber}
        onChange={setCertificateNumber}
        error={fieldError(messages, errors, 'certificateNumber')}
        required
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_CERTIFICATE_NUMBER}
        dir="ltr"
        autoFocus
      />
      <UnsavedWork dirty={certificateNumber.trim().length > 0} onDiscard={onClose} />
    </FormDialog>
  );
}

// ─── Availability ────────────────────────────────────────────────────────────

function availabilityKindText(messages: Messages, kind: string): string {
  return (AVAILABILITY_KINDS as readonly string[]).includes(kind)
    ? translateDynamic(messages, `technicians.availability.kind.${kind}`)
    : kind;
}

export function AvailabilitySection({
  messages,
  locale,
  profile,
  windows,
  zone,
  canManage,
  onSettled,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly profile: TechnicianRosterEntry;
  readonly windows: readonly AvailabilityWindow[];
  readonly zone: string | null;
  readonly canManage: boolean;
  readonly onSettled: Settle;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [adding, setAdding] = useState(false);
  const [withdrawing, setWithdrawing] = useState<AvailabilityWindow | null>(null);
  const [answer, setAnswer] = useState<ActionState>(IDLE);
  const write = useOneWrite();

  const spanText = (window: AvailabilityWindow) =>
    `${momentText(window.availableFrom, locale, zone)} – ${momentText(window.availableTo, locale, zone)}`;

  const withdraw = async (window: AvailabilityWindow) => {
    const outcome = await write.run(() =>
      withdrawAvailability(profile.id, window.id, window.recordVersion)
    );
    if (outcome === null) return;
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success' || outcome.status === 'conflict') {
      setWithdrawing(null);
      setAnswer(IDLE);
      onSettled(outcome);
      return;
    }
    setAnswer(outcome);
  };

  return (
    <section aria-labelledby="technician-availability-heading" className="flex flex-col gap-3">
      <h2
        id="technician-availability-heading"
        className="text-section-title font-medium text-text-primary"
      >
        {t('technicians.availability.heading')}
      </h2>
      <p className="text-caption text-text-muted" data-testid="technician-availability-clock">
        {zone === null
          ? t('technicians.availability.deviceClock')
          : t('technicians.availability.branchClock')}
      </p>
      {windows.length === 0 ? (
        <p className="text-body text-text-secondary" data-testid="technician-availability-empty">
          {t('technicians.availability.none')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="technician-availability">
          {windows.map((window) => (
            <li key={window.id} className="flex flex-wrap items-center gap-3">
              <span className="text-body text-text-primary">
                <span className="font-medium">
                  {availabilityKindText(messages, window.availabilityKind)}
                </span>
                {' · '}
                <bdi>{spanText(window)}</bdi>
                {window.reason ? (
                  <>
                    {' · '}
                    <bdi>{window.reason}</bdi>
                  </>
                ) : null}
              </span>
              {canManage ? (
                <Button
                  type="button"
                  size="small"
                  variant="outlined"
                  color="error"
                  aria-label={`${t('technicians.availability.withdraw')}: ${spanText(window)}`}
                  onClick={() => {
                    setAnswer(IDLE);
                    setWithdrawing(window);
                  }}
                >
                  {t('technicians.availability.withdraw')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        zone === null ? (
          <p
            className="text-caption text-text-muted"
            data-testid="technician-availability-no-clock"
          >
            {t('technicians.availability.noClock')}
          </p>
        ) : (
          <div>
            <Button type="button" variant="outlined" onClick={() => setAdding(true)}>
              {t('technicians.availability.add')}
            </Button>
          </div>
        )
      ) : null}

      {adding && zone !== null ? (
        <AvailabilityDialog
          messages={messages}
          profile={profile}
          zone={zone}
          onDone={(outcome) => {
            setAdding(false);
            onSettled(outcome);
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {withdrawing ? (
        <ConfirmDialog
          open
          messages={messages}
          destructive
          pending={write.running}
          title={t('technicians.availability.confirmWithdraw')}
          description={`${spanText(withdrawing)}. ${t('technicians.availability.confirmWithdrawBody')}`}
          confirmLabel={t('technicians.availability.withdraw')}
          error={refusalSentence(messages, answer)}
          onCancel={() => {
            setWithdrawing(null);
            setAnswer(IDLE);
          }}
          onConfirm={() => void withdraw(withdrawing)}
          testId="technician-availability-withdraw"
        />
      ) : null}
    </section>
  );
}

interface AvailabilityDraft {
  readonly availabilityKind: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

const EMPTY_WINDOW: AvailabilityDraft = { availabilityKind: '', from: '', to: '', reason: '' };

function AvailabilityDialog({
  messages,
  profile,
  zone,
  onDone,
  onClose,
}: {
  readonly messages: Messages;
  readonly profile: TechnicianRosterEntry;
  readonly zone: string;
  readonly onDone: Settle;
  readonly onClose: () => void;
}) {
  const t = (key: keyof Messages) => translate(messages, key);
  const [draft, setDraft] = useState<AvailabilityDraft>(EMPTY_WINDOW);
  const [fromProblem, setFromProblem] = useState<MomentProblem | null>(null);
  const [toProblem, setToProblem] = useState<MomentProblem | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<ActionState>(IDLE);
  const write = useOneWrite();
  const { errors, formRef } = useHeldRefusal(fieldErrors, { ...draft });
  const set = (field: keyof AvailabilityDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    setProblem(IDLE);
    const found: Record<string, string> = {};
    if (draft.availabilityKind === '') found['availabilityKind'] = 'field.required';
    if (fromProblem === 'incomplete') found['from'] = 'field.dateTimeIncomplete';
    else if (draft.from === '') found['from'] = 'field.required';
    if (toProblem === 'incomplete') found['to'] = 'field.dateTimeIncomplete';
    else if (draft.to === '') found['to'] = 'field.required';
    else if (draft.from !== '' && Date.parse(draft.to) <= Date.parse(draft.from)) {
      found['to'] = 'field.windowEndsBeforeStart';
    }
    if (draft.reason.trim().length > MAX_AVAILABILITY_REASON) found['reason'] = 'field.tooLong';
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
    const outcome = await write.run(() =>
      recordAvailability(profile.id, {
        availabilityKind: draft.availabilityKind,
        from: draft.from,
        to: draft.to,
        reason: draft.reason,
      })
    );
    if (outcome === null) return;
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success' || outcome.status === 'conflict') {
      setDraft(EMPTY_WINDOW);
      onDone(outcome);
      return;
    }
    if (outcome.fieldErrors && Object.keys(outcome.fieldErrors).length > 0) {
      setFieldErrors(outcome.fieldErrors);
    }
    setProblem(outcome);
  };

  const dirty =
    draft.availabilityKind !== '' ||
    draft.from !== '' ||
    draft.to !== '' ||
    draft.reason.trim().length > 0;

  return (
    <FormDialog
      messages={messages}
      title={t('technicians.availability.add')}
      description={`${technicianName(messages, profile)}. ${t('technicians.availability.addDescription')}`}
      submitLabel={t('admin.save')}
      pending={write.running}
      error={refusalSentence(messages, problem)}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="technician-availability-form"
    >
      <FormSelectField
        name="availabilityKind"
        label={t('technicians.availability.kindLabel')}
        value={draft.availabilityKind}
        onChange={set('availabilityKind')}
        error={fieldError(messages, errors, 'availabilityKind')}
        placeholder={t('technicians.availability.chooseKind')}
        required
        options={AVAILABILITY_KINDS.map((kind) => ({
          value: kind,
          label: availabilityKindText(messages, kind),
        }))}
      />
      <ZonedDateTimeField
        messages={messages}
        name="from"
        label={t('technicians.availability.from')}
        timezone={zone}
        value={draft.from}
        onChange={set('from')}
        onProblem={setFromProblem}
        required
        error={fieldError(messages, errors, 'from')}
        testId="technician-availability-from"
      />
      <ZonedDateTimeField
        messages={messages}
        name="to"
        label={t('technicians.availability.to')}
        timezone={zone}
        value={draft.to}
        onChange={set('to')}
        onProblem={setToProblem}
        required
        error={fieldError(messages, errors, 'to')}
        testId="technician-availability-to"
      />
      <FormTextField
        name="reason"
        label={t('technicians.availability.reason')}
        description={t('technicians.availability.reasonHint')}
        value={draft.reason}
        onChange={set('reason')}
        error={fieldError(messages, errors, 'reason')}
        autoComplete="off"
        maxLength={MAX_AVAILABILITY_REASON}
      />
      <UnsavedWork dirty={dirty} onDiscard={onClose} />
    </FormDialog>
  );
}

// ─── The work assigned now ───────────────────────────────────────────────────

export function QueueSection({
  messages,
  locale,
  technicianProfileId,
  zone,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly technicianProfileId: string;
  readonly zone: string | null;
}) {
  const t = useCallback((key: string) => translateDynamic(messages, key), [messages]);
  const load = useCallback(async (): Promise<ServerPage<TechnicianQueueItem>> => {
    let read: ReadState<{ readonly items: readonly TechnicianQueueItem[] }>;
    try {
      read = await readTechnicianQueue(technicianProfileId);
    } catch {
      read = { status: 'unavailable', correlationId: null };
    }
    if (read.status !== 'ok') {
      return {
        status: read.status,
        rows: [],
        nextCursor: null,
        hasMore: false,
        correlationId: read.correlationId,
      };
    }
    // The whole set: the read is not paged, so there is nothing after it.
    return {
      status: 'ok',
      rows: read.data.items,
      nextCursor: null,
      hasMore: false,
      correlationId: read.correlationId,
      total: read.data.items.length,
    };
  }, [technicianProfileId]);
  const read = useServerTable<TechnicianQueueItem>(load, { initial: INITIAL_REQUEST });
  const table: ServerTable<TechnicianQueueItem> = {
    ...read,
    honours: { pageSize: false, sort: false },
  };

  const columns = useMemo<readonly OperationalColumn<TechnicianQueueItem>[]>(
    () => [
      {
        id: 'job',
        headerKey: 'technicians.workspace.job',
        flex: 2,
        cell: (row) => <bdi className="font-medium">{row.jobTitle}</bdi>,
      },
      {
        id: 'jobState',
        headerKey: 'technicians.workspace.jobState',
        cell: (row) => jobStateLabel(row.jobState, t),
      },
      {
        id: 'workOrder',
        headerKey: 'technicians.workspace.workOrder',
        cell: (row) => (
          <span className="flex flex-col">
            {row.displayNumber ? (
              <code className="font-mono text-caption" dir="ltr">
                {row.displayNumber}
              </code>
            ) : (
              <span className="text-text-muted">
                {translate(messages, 'workOrders.queue.column.noReference')}
              </span>
            )}
            <span className="text-caption text-text-muted">
              {workOrderStateLabel(row.workOrderState, [], t)}
            </span>
          </span>
        ),
      },
      {
        id: 'role',
        headerKey: 'technicians.queue.role',
        hideBelow: 'md',
        cell: (row) => assignmentRoleLabel(row.assignmentRole, t),
      },
      {
        id: 'since',
        headerKey: 'technicians.workspace.since',
        hideBelow: 'md',
        cell: (row) => <bdi>{momentText(row.validFrom, locale, zone)}</bdi>,
      },
    ],
    [locale, messages, t, zone]
  );

  const rowActions = useCallback(
    (row: TechnicianQueueItem): readonly RowAction[] => [
      {
        kind: 'link',
        label: translate(messages, 'technicians.queue.openWorkOrder'),
        href: `/${locale}/work-orders/${encodeURIComponent(row.workOrderId)}`,
        about: `${row.jobTitle} · ${row.displayNumber ?? translate(messages, 'workOrders.queue.column.noReference')}`,
      },
    ],
    [messages, locale]
  );

  return (
    <section aria-labelledby="technician-queue-heading" className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="technician-queue-heading"
          className="text-section-title font-medium text-text-primary"
        >
          {translate(messages, 'technicians.queue.heading')}
        </h2>
        <Button type="button" variant="outlined" onClick={table.refresh}>
          {translate(messages, 'technicians.workspace.reload')}
        </Button>
      </div>
      <p className="text-caption text-text-muted">
        {translate(messages, 'technicians.queue.note')}
      </p>
      <OperationalGrid<TechnicianQueueItem>
        messages={messages}
        locale={locale}
        label={translate(messages, 'technicians.queue.heading')}
        columns={columns}
        rowId={(row) => row.assignmentId}
        table={table}
        rowActions={rowActions}
        suppressEmptyState
        unpaged
        testId="technician-profile-queue"
      />
      {table.status === 'idle' && table.response && table.response.rows.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          titleKey="technicians.queue.emptyTitle"
          descriptionKey="technicians.queue.emptyBody"
          testId="technician-profile-queue-empty"
        />
      ) : null}
    </section>
  );
}
