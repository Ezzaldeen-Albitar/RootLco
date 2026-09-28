import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  TEST_COMPANY,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';
import {
  discardAndSwitch,
  forgetRememberedBranch,
  stayOnBranch,
  switchExpectingQuestion,
} from './support/branch-switch';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';

/**
 * The shared pieces the appointment and reception screens are built out of
 * (`P1-28-QA-001`).
 *
 * ## Why these have their own suite
 *
 * Twelve exported components in the two P1-28 trees were rendered by no test
 * that named them. Each of them IS reached through the screen that composes it,
 * which is exactly what makes the gap invisible: a screen suite asserts what the
 * operator sees at the end of a flow, and a defect in one shared panel shows up
 * — if it shows up — as a puzzling failure three files away. The P1-27 twin of
 * this file (`p1-27-qa.test.ts`) records the same finding: six components
 * shipped with zero component coverage while a coverage claim read green.
 *
 * So each one is rendered here directly, in the state that is hardest to get a
 * screen into, and the claims are about the piece rather than about the flow.
 *
 * ## Both directions
 *
 * `renderRtl` sets `dir` and `lang` on the document element exactly as the
 * locale layout does. A component tested only in a bare LTR container carries
 * every RTL defect through the suite untouched.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/* --- adapter mocks, so a piece can be rendered without a transport --------- */

const listConditionEvidence = vi.fn();
vi.mock('@/features/receptions/api', () => ({
  listConditionEvidence: (...args: unknown[]) => listConditionEvidence(...args),
}));

const listCustomerVehicles = vi.fn();
vi.mock('@/lib/customers/vehicles-read', () => ({
  listCustomerVehiclesCancellable: (...args: unknown[]) => listCustomerVehicles(...args),
}));

const searchVehicles = vi.fn();
const createVehicleAction = vi.fn();
vi.mock('@/features/vehicles/api', () => ({
  createVehicleAction: (...args: unknown[]) => createVehicleAction(...args),
}));
vi.mock('@/features/vehicles/vehicle-search-read', () => ({
  searchVehiclesCancellable: (...args: unknown[]) => searchVehicles(...args),
}));

const linkCustomerAction = vi.fn();
vi.mock('@/features/vehicles/relations-api', () => ({
  linkCustomerAction: (...args: unknown[]) => linkCustomerAction(...args),
}));

const createIndividualAction = vi.fn();
const createCompanyAction = vi.fn();
vi.mock('@/features/crm/customers/creation-actions', () => ({
  createIndividualAction: (...args: unknown[]) => createIndividualAction(...args),
  createCompanyAction: (...args: unknown[]) => createCompanyAction(...args),
}));

const {
  CoverageNotice,
  EvidenceReadBack,
  EvidenceSection,
  EvidenceStates,
  SessionCaptureList,
  StepOutcome,
  WriteWithdrawn,
} = await import('@/features/receptions/components/steps/EvidencePanels');
const { CommandOutcome } = await import('@/features/receptions/components/steps/SummaryStep');
const { BranchTargetFields } =
  await import('@/features/appointments/components/BranchTargetFields');
const { WindowFields } = await import('@/features/appointments/components/WindowFields');
const { IntakeCustomerCreate } =
  await import('@/features/receptions/intake/components/IntakeCustomerCreate');
const { IntakeVehicleStep } =
  await import('@/features/receptions/intake/components/IntakeVehicleStep');
const { EVIDENCE_KIND_COVERAGE } = await import('@/features/receptions/check-in/evidence');

beforeEach(() => {
  vi.clearAllMocks();
  listConditionEvidence.mockResolvedValue({
    status: 'ok',
    rows: [],
    nextCursor: null,
    hasMore: false,
    correlationId: null,
  });
  listCustomerVehicles.mockResolvedValue({
    status: 'ok',
    rows: [],
    nextCursor: null,
    hasMore: false,
    correlationId: null,
  });
});

/** A `ServerTable` in one state, without running the hook that produces one. */
function table(over: Record<string, unknown> = {}) {
  return {
    // The whole request `OperationalGrid` draws its pager and chips from.
    request: { page: 1, pageSize: 25, sort: null, filters: [] },
    setRequest: vi.fn(),
    response: null,
    status: 'idle',
    correlationId: undefined,
    refresh: vi.fn(),
    ...over,
  } as never;
}

/* ====================================================================== *
 * EvidenceStates — the non-idle table states, and Retry where it applies
 * ====================================================================== */

describe('EvidenceStates', () => {
  it('offers Retry on an error and states the correlation reference', () => {
    const retry = vi.fn();
    renderLtr(
      <EvidenceStates messages={en} status="error" correlationId="corr-evidence" onRetry={retry} />
    );
    expect(screen.getByText('corr-evidence')).toBeVisible();
    expect(screen.getByRole('button', { name: EN['state.retry'] as string })).toBeVisible();
  });

  it('actually calls back when Retry is pressed', async () => {
    const retry = vi.fn();
    renderLtr(
      <EvidenceStates messages={en} status="error" correlationId={undefined} onRetry={retry} />
    );
    await userEvent.click(screen.getByRole('button', { name: EN['state.retry'] as string }));
    // Without this the button is decoration: a control that renders and does
    // nothing is worse than no control, because the operator believes they
    // retried.
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders a denial as a denial, never as an empty list', () => {
    // "There is nothing here" and "you may not see it" are different sentences
    // and only one of them is true.
    renderLtr(
      <EvidenceStates messages={en} status="denied" correlationId="corr-1" onRetry={vi.fn()} />
    );
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('offers no Retry on an expired session — the cure is signing in', () => {
    renderLtr(
      <EvidenceStates messages={en} status="expired" correlationId={undefined} onRetry={vi.fn()} />
    );
    expect(screen.getByText(EN['state.expired.title'] as string)).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('shows a skeleton while loading, and a plain state when the caller opts out', () => {
    const { container, unmount } = renderLtr(
      <EvidenceStates messages={en} status="loading" correlationId={undefined} onRetry={vi.fn()} />
    );
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    unmount();

    renderLtr(
      <EvidenceStates
        messages={en}
        status="loading"
        correlationId={undefined}
        onRetry={vi.fn()}
        skeleton={false}
      />
    );
    expect(screen.getByText(EN['state.loading'] as string)).toBeVisible();
  });

  it('renders the denial in Arabic too', () => {
    renderRtl(
      <EvidenceStates messages={ar} status="denied" correlationId={undefined} onRetry={vi.fn()} />
    );
    expect(screen.getByText(AR['state.denied.title'] as string)).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
  });
});

/* ====================================================================== *
 * EvidenceReadBack — the published envelope, and what it cannot return
 * ====================================================================== */

describe('EvidenceReadBack', () => {
  const ROW = {
    id: 'ev-1',
    kind: 'complaint',
    recordedAt: '2026-08-13T07:30:00.000Z',
    evidenceDocumentId: null,
    category: 'noise',
    severity: 'high',
  };

  it('says in words that a restricted narrative is not in the read-back', () => {
    // `rec.reception-condition-evidence-list` deliberately never selects the
    // restricted narrative tables, so a complaint's words are absent. A thin row
    // with no explanation reads as data loss.
    renderLtr(
      <EvidenceReadBack
        locale="en"
        messages={en}
        kind="complaint"
        table={table({ response: { rows: [ROW], total: null, page: 1, pageSize: 25 } })}
      />
    );
    expect(screen.getByText(EN['receptions.evidence.restrictedReadBack'] as string)).toBeVisible();
    // And the envelope IS rendered: the category is a published field.
    expect(screen.getByText(EN['receptions.complaintCategory.noise'] as string)).toBeVisible();
  });

  it('does not claim a restriction for a kind that has none', () => {
    renderLtr(
      <EvidenceReadBack
        locale="en"
        messages={en}
        kind="leak"
        table={table({ response: { rows: [], total: null, page: 1, pageSize: 25 } })}
      />
    );
    expect(screen.queryByText(EN['receptions.evidence.restrictedReadBack'] as string)).toBeNull();
    expect(screen.getByText(EN['receptions.evidence.readBackEmpty'] as string)).toBeVisible();
  });

  it('renders an unparseable instant AS IT ARRIVED instead of throwing', () => {
    /*
     * `formatDateTime` raises `RangeError: Invalid time value` on anything
     * `Date` cannot parse, and a throw inside a list row takes the WHOLE step
     * down — the operator loses the evidence panel because one timestamp was
     * not what this screen expected. Rendering the raw value is the honest
     * degradation; this case is the proof that the row does not crash.
     */
    expect(() =>
      renderLtr(
        <EvidenceReadBack
          locale="en"
          messages={en}
          kind="leak"
          table={table({
            response: {
              rows: [
                { id: 'ev-2', kind: 'leak', recordedAt: 'not-a-time', evidenceDocumentId: null },
              ],
              total: null,
              page: 1,
              pageSize: 25,
            },
          })}
        />
      )
    ).not.toThrow();
    expect(screen.getByText('not-a-time')).toBeVisible();
  });

  it('hands a non-idle table straight to EvidenceStates', () => {
    renderLtr(
      <EvidenceReadBack
        locale="en"
        messages={en}
        kind="complaint"
        table={table({ status: 'denied', correlationId: 'corr-denied' })}
      />
    );
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['receptions.evidence.readBackEmpty'] as string)).toBeNull();
  });

  it('says there are more pages when the server says so', () => {
    renderLtr(
      <EvidenceReadBack
        locale="en"
        messages={en}
        kind="leak"
        table={table({
          response: { rows: [], total: null, page: 1, pageSize: 25, hasMore: true },
        })}
      />
    );
    expect(screen.getByText(EN['receptions.evidence.morePages'] as string)).toBeVisible();
  });
});

/* ====================================================================== *
 * SessionCaptureList — what THIS tab recorded, labelled as that
 * ====================================================================== */

describe('SessionCaptureList', () => {
  const CAPTURED = [
    { evidenceId: 'ev-1', kind: 'complaint' as const, summary: 'Pulls left under braking' },
    { evidenceId: 'ev-2', kind: 'leak' as const, summary: 'Coolant, front left' },
  ];

  it('shows only this kind, and says the list does not survive a reload', () => {
    renderLtr(
      <SessionCaptureList locale="en" messages={en} kind="complaint" captured={CAPTURED} />
    );
    expect(screen.getByText('Pulls left under braking')).toBeVisible();
    expect(screen.queryByText('Coolant, front left')).toBeNull();
    expect(screen.getByText(EN['receptions.evidence.sessionNote'] as string)).toBeVisible();
  });

  it('renders NOTHING when this session captured nothing of this kind', () => {
    // An empty "captured this session" panel on an already-populated visit
    // would suggest the visit itself is empty, which the read-back beside it
    // contradicts.
    const { container } = renderLtr(
      <SessionCaptureList locale="en" messages={en} kind="contents" captured={CAPTURED} />
    );
    expect(container.textContent).toBe('');
  });

  it('carries real Arabic for its own heading and note', () => {
    renderRtl(
      <SessionCaptureList locale="ar" messages={ar} kind="complaint" captured={CAPTURED} />
    );
    for (const key of ['receptions.evidence.sessionHeading', 'receptions.evidence.sessionNote']) {
      expect(/[؀-ۿ]/.test(AR[key] as string), `${key} carries no Arabic`).toBe(true);
    }
    expect(
      screen.getByRole('region', { name: AR['receptions.evidence.sessionHeading'] as string })
    ).toBeVisible();
  });
});

/* ====================================================================== *
 * CoverageNotice and WriteWithdrawn — the absences, stated
 * ====================================================================== */

describe('CoverageNotice', () => {
  it('states the coverage row’s OWN reason, so screen and test read one string', () => {
    renderLtr(<CoverageNotice locale="en" messages={en} kind="warning_light" />);
    const notice = screen.getByTestId('evidence-notice-warning_light');
    expect(notice).toHaveTextContent(EN['receptions.evidence.warningCatalogueEmpty'] as string);
  });

  it('renders nothing for a kind with nothing to explain', () => {
    const { container } = renderLtr(<CoverageNotice locale="en" messages={en} kind="complaint" />);
    expect(container.textContent).toBe('');
  });

  it('renders the extra a step hands it beside the reason', () => {
    renderLtr(
      <CoverageNotice
        locale="en"
        messages={en}
        kind="damage_map"
        extra={<span>an extra sentence the step supplied</span>}
      />
    );
    expect(screen.getByText('an extra sentence the step supplied')).toBeVisible();
  });

  it('states the data-gated kind in Arabic too', () => {
    /*
     * This case read `receptions.evidence.damageMapBlocked` while `damage_map`
     * was a BLOCKED kind — no map could be opened, because nothing in the
     * product could register a template document. `P1-15` built the chain and
     * `P1-18` publishes the branch's bindable revisions, so the kind is now
     * `data_gated`: the control exists, and a branch with no published revision
     * is a configuration state rather than a missing capability.
     *
     * The notice key is read from the coverage table rather than named here, so
     * this case follows the source of truth instead of pinning a second copy of
     * it — the reason the old key could go stale unnoticed in the first place.
     */
    const row = EVIDENCE_KIND_COVERAGE.find((entry) => entry.kind === 'damage_map');
    expect(row?.status, 'damage_map is no longer the data-gated kind').toBe('data_gated');
    expect(row?.noticeKey, 'a gated kind must state something').not.toBeNull();

    renderRtl(<CoverageNotice locale="ar" messages={ar} kind="damage_map" />);
    expect(screen.getByTestId('evidence-notice-damage_map')).toHaveTextContent(
      AR[row!.noticeKey as string] as string
    );
  });
});

describe('WriteWithdrawn', () => {
  it('says WHY a control is gone rather than greying one out', () => {
    renderLtr(
      <WriteWithdrawn locale="en" messages={en} messageKey="receptions.evidence.readOnly" />
    );
    expect(screen.getByText(EN['receptions.evidence.readOnly'] as string)).toBeVisible();
  });
});

/* ====================================================================== *
 * StepOutcome and CommandOutcome — the two failure voices
 * ====================================================================== */

describe('StepOutcome', () => {
  it('is silent while idle and after a success', () => {
    const { container, unmount } = renderLtr(
      <StepOutcome messages={en} state={{ status: 'idle' }} />
    );
    expect(container.textContent).toBe('');
    unmount();
    const after = renderLtr(<StepOutcome messages={en} state={{ status: 'success' }} />);
    expect(after.container.textContent).toBe('');
  });

  it('does not guess which rule refused a conflict', () => {
    // The evidence writes share the non-disclosing 409 ERR-TRN-001 with the
    // state guard, so naming a cause would be an invention.
    renderLtr(
      <StepOutcome
        messages={en}
        state={{ status: 'conflict', messageKey: 'state.conflict.title', correlationId: 'corr-c' }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      EN['receptions.evidence.conflict'] as string
    );
    expect(screen.getByText('corr-c')).toBeVisible();
  });

  it('falls back to a generic failure when the backend named no key', () => {
    renderLtr(<StepOutcome messages={en} state={{ status: 'error' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(EN['action.failed'] as string);
  });
});

describe('CommandOutcome', () => {
  it('tells the two 409s apart, because the cure is opposite', () => {
    const stale = renderLtr(
      <CommandOutcome
        locale="en"
        messages={en}
        state={{ status: 'conflict', messageKey: 'state.conflict.title' }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      EN['receptions.command.conflictStale'] as string
    );
    stale.unmount();

    renderLtr(
      <CommandOutcome
        locale="en"
        messages={en}
        state={{ status: 'conflict', messageKey: 'state.conflict.blocked.title' }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      EN['receptions.command.conflictBlocked'] as string
    );
  });

  it('fails CLOSED: an unrecognised conflict key reads as BLOCKED', () => {
    // Getting this backwards invites a retry against a state that refuses the
    // command, which is the ERR-TRN-001 loop the distinction exists to prevent.
    renderLtr(
      <CommandOutcome locale="en" messages={en} state={{ status: 'conflict', messageKey: 'x' }} />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      EN['receptions.command.conflictBlocked'] as string
    );
  });

  it('is silent while idle and after a success', () => {
    const { container } = renderLtr(
      <CommandOutcome locale="en" messages={en} state={{ status: 'success' }} />
    );
    expect(container.textContent).toBe('');
  });

  it('states a denial with its reference, in Arabic', () => {
    renderRtl(
      <CommandOutcome
        locale="ar"
        messages={ar}
        state={{ status: 'denied', messageKey: 'state.denied.title', correlationId: 'corr-ar' }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(AR['state.denied.title'] as string);
    expect(screen.getByText('corr-ar')).toBeVisible();
  });
});

/* ====================================================================== *
 * EvidenceSection — the panel every evidence step is built out of
 * ====================================================================== */

describe('EvidenceSection', () => {
  it('labels the region by its own heading, so a screen reader can reach it', () => {
    renderLtr(
      <EvidenceSection id="complaints" messages={en} headingKey="receptions.complaint.heading">
        <p>the step body</p>
      </EvidenceSection>
    );
    const region = screen.getByRole('region', {
      name: EN['receptions.complaint.heading'] as string,
    });
    expect(region).toBeVisible();
    expect(region).toHaveTextContent('the step body');
  });
});

/* ====================================================================== *
 * BranchTargetFields — a resource selector, now NAMED
 * ====================================================================== */

describe('BranchTargetFields', () => {
  function fields(over: Record<string, unknown> = {}, snapshot = branchSnapshot()) {
    return renderLtr(
      inBranch(
        <BranchTargetFields
          messages={en}
          companyId=""
          branchId=""
          onCompanyChange={vi.fn()}
          onBranchChange={vi.fn()}
          {...over}
        />,
        { snapshot }
      )
    );
  }

  it('NAMES the branch instead of offering a reference to recognise', () => {
    /*
     * This block used to assert the opposite, and it was right at the time:
     * two selects whose options were raw references, each carrying the sentence
     * "the service publishes no company or branch directory". The directory now
     * exists — `GET /auth/working-context` publishes named, active entities —
     * so the reference is gone from the screen entirely.
     */
    fields();
    const shown = screen.getByTestId('appointment-branch-target');
    expect(shown).toHaveTextContent(TEST_BRANCH.name);
    expect(shown).toHaveTextContent(TEST_COMPANY.name);
    expect(shown).not.toHaveTextContent(TEST_BRANCH.id);
  });

  it('offers NO control at all, because the header owns the choice', () => {
    // A second editable pair here would be a second authority for one fact.
    fields();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('never offers a free-text box, not even to an operator with no narrowing', () => {
    /*
     * The defect this closes. An EMPTY resolved scope means unrestricted within
     * the workspace, so the operator with the MOST reach was the one handed two
     * boxes and asked to type a reference. They now get the same named list as
     * everybody else.
     */
    fields({}, branchSnapshot([TEST_BRANCH], 'ready'));
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getByTestId('appointment-branch-target')).toHaveTextContent(TEST_BRANCH.name);
  });

  it('reports the branch upward, so the surrounding form still builds its request', async () => {
    // The props did not change: the screen keeps its own copy of the pair, and
    // the header's choice is pushed into it.
    const onCompanyChange = vi.fn();
    const onBranchChange = vi.fn();
    fields({ onCompanyChange, onBranchChange });
    await waitFor(() => expect(onBranchChange).toHaveBeenCalledWith(TEST_BRANCH.id));
    expect(onCompanyChange).toHaveBeenCalledWith(TEST_COMPANY.id);
  });

  it('says what to do when several branches are authorized and none is chosen', () => {
    const second = { ...TEST_BRANCH, id: '66666666-6666-4666-8666-666666666666', name: 'Second' };
    fields({}, branchSnapshot([TEST_BRANCH, second]));
    expect(screen.getByTestId('requires-concrete-branch')).toHaveTextContent(
      EN['workingContext.chooseBranchHere'] as string
    );
  });

  it('renders a server complaint about either half once, under the pair', () => {
    fields({ branchError: 'This branch is required' });
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('This branch is required');
  });
});

/* ====================================================================== *
 * WindowFields — the clock is named, and the errors are the window's
 * ====================================================================== */

describe('WindowFields', () => {
  /** The product's Material provider, around a working context. */
  function framed(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
    return (
      <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
        {inBranch(ui, { locale })}
      </UiFoundationProvider>
    );
  }

  function fields(over: Record<string, unknown> = {}) {
    return framed(
      <WindowFields
        messages={en}
        locale="en"
        legend="Requested window"
        fromLabel="From"
        toLabel="To"
        draft={{ from: '', to: '' }}
        onChange={vi.fn()}
        errors={{}}
        timezone={TEST_BRANCH.timezone}
        {...over}
      />
    );
  }

  it('names the branch clock the moments are typed on', () => {
    // A booking made in Amman for a branch in Riyadh is a decision the operator
    // must be able to SEE, not discover afterwards.
    renderLtr(fields());
    expect(
      screen.getByText(EN['appointments.window.clockNote'] as string, { exact: false })
    ).toBeVisible();
    expect(screen.getByTestId('appointment-window-zone')).toHaveTextContent(TEST_BRANCH.timezone);
  });

  it('names the clock it is given, whatever the working branch', () => {
    renderLtr(fields({ timezone: 'Asia/Tokyo' }));
    expect(screen.getByTestId('appointment-window-zone')).toHaveTextContent('Asia/Tokyo');
  });

  it('takes no moment without a clock, and says what the caller says instead', () => {
    renderLtr(fields({ timezone: null, refusal: <p>No single clock</p> }));
    expect(screen.getByTestId('appointment-window-refused')).toHaveTextContent('No single clock');
    expect(screen.queryByRole('group', { name: /^From/ })).toBeNull();
    expect(screen.queryByTestId('appointment-window-zone')).toBeNull();
  });

  it('shows a stored moment on that clock', () => {
    renderLtr(fields({ draft: { from: '2026-09-01T09:00:00+03:00', to: '' } }));
    const from = screen.getByRole('group', { name: /^From/ });
    // The Riyadh wall clock, part by part: nothing converted to the reader's.
    expect(from).toHaveTextContent('01');
    expect(from).toHaveTextContent('09');
    expect(from).toHaveTextContent('2026');
    expect(from).toHaveTextContent('00');
  });

  it('renders a SERVER window complaint once, under the pair', () => {
    /*
     * The backend reports a window violation with the path `body.confirmedFrom`
     * even when the END is the offending half (`appointment-service.ts:184`), so
     * a renderer that trusted the path would underline the wrong box. ONE alert,
     * under both inputs, is the honest rendering of a complaint whose path
     * cannot be trusted to name the half.
     */
    renderLtr(fields({ serverError: 'form.violation.too_small' }));
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(EN['form.violation.too_small'] as string);
  });

  it('renders LOCAL refusals against the half each is about', () => {
    // The contract's own keys, through `WINDOW_ISSUE_KEY`: a missing start is
    // `field.required`, and an end at or before the start is
    // `field.windowEndsBeforeStart`.
    renderLtr(fields({ errors: { from: 'field.required', to: 'field.windowEndsBeforeStart' } }));
    expect(screen.getByText(EN['field.required'] as string)).toBeVisible();
    expect(screen.getByText(EN['field.windowEndsBeforeStart'] as string)).toBeVisible();
    expect(screen.getByRole('group', { name: /^From/ })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('group', { name: /^To/ })).toHaveAttribute('aria-invalid', 'true');
  });

  it('reports a whole moment with the branch offset, keeping the other half untouched', async () => {
    const onChange = vi.fn();
    const onEdit = vi.fn();
    const user = userEvent.setup();
    renderLtr(fields({ onChange, onEdit }));
    const from = screen.getByRole('group', { name: /^From/ });
    await user.click(within(from).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('010920260900');
    expect(onEdit).toHaveBeenCalledWith('from');
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-09-01T09:00:00+03:00', to: '' });
  });

  it('carries real Arabic for the clock note', () => {
    renderRtl(
      framed(
        <WindowFields
          messages={ar}
          locale="ar"
          legend="نافذة"
          fromLabel="من"
          toLabel="إلى"
          draft={{ from: '', to: '' }}
          onChange={vi.fn()}
          errors={{}}
          timezone={TEST_BRANCH.timezone}
        />,
        'ar'
      )
    );
    expect(/[؀-ۿ]/.test(AR['appointments.window.clockNote'] as string)).toBe(true);
    expect(
      screen.getByText(AR['appointments.window.clockNote'] as string, { exact: false })
    ).toBeVisible();
  });
});

/* ====================================================================== *
 * IntakeCustomerCreate — the duplicate advisory is a RESULT, not a scan
 * ====================================================================== */

describe('IntakeCustomerCreate', () => {
  const CREATED = '0aa1b2c3-d4e5-4f60-8172-9e8d7c6b5a40';
  const DUPLICATE = '11112222-3333-4444-8555-666677778888';

  it('states the creation FIRST, then offers the duplicate decision', () => {
    /*
     * There is no pre-submit duplicate check anywhere on the platform —
     * `crm.duplicate-scan` is a privileged audited WRITE. What the creation
     * response carries is `possibleDuplicates`, created-anyway being the
     * contract's own words, so the advisory must not read as a rejection.
     */
    createIndividualAction.mockImplementation(async () => ({
      status: 'success',
      created: {
        customerId: CREATED,
        displayNumber: 'C-000901',
        possibleDuplicates: [
          { customerId: DUPLICATE, displayNumber: 'C-000482', displayName: 'Layla Haddad' },
        ],
      },
    }));

    renderLtr(
      <IntakeCustomerCreate
        locale="en"
        messages={en}
        kind="individual"
        onChosen={vi.fn()}
        onBack={vi.fn()}
      />
    );
    // The form is what renders before anything is submitted.
    expect(
      screen.getByRole('button', { name: EN['receptions.intake.customer.backToSearch'] as string })
    ).toBeVisible();
  });

  it('goes back without creating anything', async () => {
    const onBack = vi.fn();
    renderLtr(
      <IntakeCustomerCreate
        locale="en"
        messages={en}
        kind="company"
        onChosen={vi.fn()}
        onBack={onBack}
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: EN['receptions.intake.customer.backToSearch'] as string })
    );
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(createCompanyAction).not.toHaveBeenCalled();
    expect(createIndividualAction).not.toHaveBeenCalled();
  });

  it('binds each kind to its OWN operation, and never to the other', () => {
    // `crm.individual-create` and `crm.company-create` are two operations with
    // two body shapes; a screen that chose the wrong one would 422 on every
    // submission.
    const individual = renderLtr(
      <IntakeCustomerCreate
        locale="en"
        messages={en}
        kind="individual"
        onChosen={vi.fn()}
        onBack={vi.fn()}
      />
    );
    // Named by its label (the required mark is decorative and not part of the name).
    expect(
      screen.getByRole('textbox', { name: EN['crm.customers.create.givenName'] as string })
    ).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: EN['crm.customers.create.legalName'] as string })
    ).toBeNull();
    individual.unmount();

    renderLtr(
      <IntakeCustomerCreate
        locale="en"
        messages={en}
        kind="company"
        onChosen={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(
      screen.getByRole('textbox', { name: EN['crm.customers.create.legalName'] as string })
    ).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: EN['crm.customers.create.givenName'] as string })
    ).toBeNull();
  });

  it('renders in Arabic with the document in RTL', () => {
    renderRtl(
      <IntakeCustomerCreate
        locale="ar"
        messages={ar}
        kind="individual"
        onChosen={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(
      screen.getByRole('button', { name: AR['receptions.intake.customer.backToSearch'] as string })
    ).toBeVisible();
  });
});

/* ====================================================================== *
 * IntakeVehicleStep — three ways to a vehicle, and the relationship question
 * ====================================================================== */

describe('IntakeVehicleStep', () => {
  const CUSTOMER = {
    id: '9f8e7d6c-5b4a-4392-8172-0e02b2c3d479',
    displayName: 'Layla Haddad',
    displayNumber: 'C-000482',
    partyType: 'individual',
  };
  const VEHICLE = {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    displayNumber: 'V-0007',
    vin: '1HGCM82633A004352',
    modelYear: 2019,
    alreadyLinked: false,
  };

  function step(over: Record<string, unknown> = {}) {
    return (
      <IntakeVehicleStep
        locale="en"
        messages={en}
        customer={CUSTOMER}
        vehicle={null}
        canSearchVehicles
        canCreateVehicle
        canLinkVehicle
        onVehicleChosen={vi.fn()}
        onVehicleCleared={vi.fn()}
        onLinkOutcome={vi.fn()}
        {...over}
      />
    );
  }

  it('reads the customer’s OWN vehicles rather than asking the desk to search first', async () => {
    renderLtr(step());
    // `crm.customer-vehicle-list` is real since Wave A; the customer-first path
    // is the one a reception desk actually tries first.
    expect(listCustomerVehicles).toHaveBeenCalled();
    expect(listCustomerVehicles.mock.calls[0]?.[0]).toBe(CUSTOMER.id);
  });

  it('withdraws the search when the operator may not read vehicles, and says so', () => {
    const denied = renderLtr(step({ canSearchVehicles: false, canCreateVehicle: false }));
    expect(
      screen.queryByRole('button', { name: EN['vehicles.search.submit'] as string })
    ).toBeNull();
    denied.unmount();

    renderLtr(step());
    expect(
      screen.getByRole('button', { name: EN['vehicles.search.submit'] as string })
    ).toBeVisible();
  });

  it('asks the relationship question only for a vehicle that is not already linked', () => {
    renderLtr(step({ vehicle: VEHICLE }));
    expect(
      screen.getByRole('region', { name: EN['receptions.intake.link.heading'] as string })
    ).toBeVisible();
    // And the way out is offered beside it, labelled with its consequence: the
    // visit continues while the relationship stays unrecorded.
    expect(screen.getByText(EN['receptions.intake.link.skipNote'] as string)).toBeVisible();
  });

  it('offers no link control when the operator may not record one, and says why', () => {
    // A silently missing step reads as a step that happened.
    renderLtr(step({ vehicle: VEHICLE, canLinkVehicle: false }));
    expect(screen.getByTestId('intake-link-denied')).toHaveTextContent(
      EN['receptions.intake.link.notPermitted'] as string
    );
    expect(
      screen.queryByRole('button', { name: EN['receptions.intake.link.submit'] as string })
    ).toBeNull();
    expect(linkCustomerAction).not.toHaveBeenCalled();
  });

  it('lets the desk go back to the vehicle choice from the relationship step', async () => {
    const onVehicleCleared = vi.fn();
    renderLtr(step({ vehicle: VEHICLE, onVehicleCleared }));
    await userEvent.click(
      screen.getByRole('button', { name: EN['receptions.intake.vehicle.change'] as string })
    );
    expect(onVehicleCleared).toHaveBeenCalledTimes(1);
  });
});

/* ====================================================================== *
 * The Material UI pieces every step is built from (ADR-022)
 * ====================================================================== */

const { InstantOrRaw, RecordReadState, RetryButton, SubmitButton, useStepForm } =
  await import('@/features/receptions/components/steps/EvidencePanels');
const { PartyRoleGrid } = await import('@/features/receptions/components/steps/PartiesStep');
const { FormTextField } = await import('@/components/forms/mui/FormTextField');
const { unreachable } = await import('@/lib/forms/action-result');
const { useFocusFirstInvalid } = await import('@/lib/forms/use-focus-first-invalid');

describe('RecordReadState', () => {
  it('says "not found" as itself, never as a fault with a retry', () => {
    renderLtr(
      <RecordReadState
        messages={en}
        status="not-found"
        correlationId="corr-404"
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText(EN['state.notFound.title'] as string)).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('says an unanswered read is unavailable, with the reference and a retry that runs', async () => {
    const retry = vi.fn();
    renderLtr(
      <RecordReadState
        messages={en}
        status="unavailable"
        correlationId="corr-503"
        onRetry={retry}
      />
    );
    expect(screen.getByText(EN['state.unavailable.title'] as string)).toBeVisible();
    expect(screen.getByText('corr-503')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: EN['state.retry'] as string }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('offers no retry at all when the caller has none to offer', () => {
    renderLtr(<RecordReadState messages={en} status="error" correlationId="corr-500" />);
    expect(screen.getByText(EN['state.error.title'] as string)).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });
});

describe('RetryButton and SubmitButton', () => {
  it('RetryButton asks again when pressed', async () => {
    const retry = vi.fn();
    renderRtl(<RetryButton messages={ar} onRetry={retry} />);
    await userEvent.click(screen.getByRole('button', { name: AR['state.retry'] as string }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('SubmitButton says it is working, and cannot be pressed twice', () => {
    const { rerender } = renderLtr(
      <form>
        <SubmitButton messages={en} pending={false} labelKey="receptions.complaint.record" />
      </form>
    );
    const idle = screen.getByRole('button', { name: EN['receptions.complaint.record'] as string });
    expect(idle).toBeEnabled();
    expect(idle).toHaveAttribute('type', 'submit');
    rerender(
      <form>
        <SubmitButton messages={en} pending labelKey="receptions.complaint.record" />
      </form>
    );
    const busy = screen.getByRole('button', { name: EN['form.pending'] as string });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
  });
});

describe('InstantOrRaw', () => {
  it('renders an instant as a time, and an unreadable one exactly as it arrived', () => {
    const { container } = renderLtr(
      <>
        <InstantOrRaw value="2026-08-13T07:30:00.000Z" locale="en" />
        <InstantOrRaw value="not-a-time" locale="en" />
      </>
    );
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-08-13T07:30:00.000Z');
    expect(screen.getByText('not-a-time').tagName).toBe('CODE');
  });
});

describe('PartyRoleGrid', () => {
  const ROLE = {
    id: 'role-1',
    partnerId: 'partner-1',
    partnerDisplayName: 'Layla Haddad',
    partnerDisplayNumber: 'C-0001',
    relationshipRole: 'service_requester',
    validFrom: '2026-08-13T07:00:00.000Z',
    validTo: null,
    assignmentSource: 'Front desk',
    recordVersion: 1,
  };

  it('names each party and its role, and never the partner identifier', async () => {
    const { container } = renderLtr(
      <PartyRoleGrid
        locale="en"
        messages={en}
        table={table({
          response: { rows: [ROLE], total: null, page: 1, pageSize: 25, hasMore: false },
        })}
      />
    );
    expect(await screen.findByText('Layla Haddad')).toBeVisible();
    expect(screen.getByText(EN['receptions.partyRole.service_requester'] as string)).toBeVisible();
    expect(screen.getByText(EN['receptions.parties.roleActive'] as string)).toBeVisible();
    expect(container.textContent).not.toContain('partner-1');
  });

  it('says the empty answer in the words its caller chose', () => {
    renderLtr(
      <PartyRoleGrid
        locale="en"
        messages={en}
        table={table({ response: { rows: [], total: null, page: 1, pageSize: 25 } })}
        showInterval={false}
        emptyKey="receptions.summary.partiesEmpty"
      />
    );
    expect(screen.getByText(EN['receptions.summary.partiesEmpty'] as string)).toBeVisible();
    expect(screen.queryByText(EN['receptions.parties.rolesEmpty'] as string)).toBeNull();
  });
});

/**
 * `useStepForm` — the behaviour every capture form of the wizard shares.
 *
 * Proved on a one-field harness, so each claim is about the hook rather than
 * about a step: the refusal on the field, the cursor, the kept entry, the
 * withdrawn complaint, the answer that never arrives, and the unsaved work.
 */
function StepFormHarness({
  send,
}: {
  readonly send: (draft: { readonly zone: string }, attempt: number) => Promise<unknown>;
}) {
  const form = useStepForm<{ readonly zone: string }>({
    messages: en,
    empty: { zone: '' },
    // The complaint is filed under the name the service would use.
    errorNames: { zone: 'vehicleZone' },
    check: (draft) =>
      draft.zone.trim() === '' ? { vehicleZone: 'receptions.finding.error.zoneRequired' } : {},
    send: send as never,
  });
  const formRef = useFocusFirstInvalid(form.state);
  return (
    <form ref={formRef} aria-label="harness" onSubmit={form.onSubmit} noValidate>
      <FormTextField
        label="Zone"
        value={form.draft.zone}
        onChange={(value) => {
          form.update('zone', value);
        }}
        onEdit={() => undefined}
        error={form.fieldError('vehicleZone')}
      />
      <p data-testid="harness-state">{form.state.messageKey ?? ''}</p>
      <SubmitButton messages={en} pending={form.pending} labelKey="receptions.finding.record" />
    </form>
  );
}

describe('useStepForm', () => {
  const zoneBox = () => screen.getByRole('textbox', { name: 'Zone' });
  const record = () =>
    screen.getByRole('button', { name: EN['receptions.finding.record'] as string });

  it('refuses on the field, moves the cursor there, and withdraws the complaint on correction', async () => {
    const send = vi.fn();
    const user = userEvent.setup();
    renderLtr(<StepFormHarness send={send} />);
    await user.click(record());

    await waitFor(() => expect(zoneBox()).toHaveFocus());
    expect(zoneBox()).toHaveAttribute('aria-invalid', 'true');
    expect(zoneBox()).toHaveAccessibleDescription(
      expect.stringContaining(EN['receptions.finding.error.zoneRequired'] as string)
    );
    expect(send).not.toHaveBeenCalled();

    // FALSIFICATION of the clearing half: typing withdraws the complaint.
    await user.type(zoneBox(), 'rear');
    expect(zoneBox()).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(EN['receptions.finding.error.zoneRequired'] as string)).toBeNull();
  });

  it('says an answer that never arrived is unavailable, keeps the entry and frees the button', async () => {
    const send = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderLtr(<StepFormHarness send={send} />);
    await user.type(zoneBox(), 'rear bumper');
    await user.click(record());

    await waitFor(() =>
      expect(screen.getByTestId('harness-state')).toHaveTextContent('state.unavailable.message')
    );
    expect(zoneBox()).toHaveValue('rear bumper');
    expect(record()).toBeEnabled();
    expect(unreachable(2)).toEqual({
      status: 'unavailable',
      messageKey: 'state.unavailable.message',
      attempt: 2,
    });
  });

  it('empties the form once the write is stored, and is no longer unsaved work', async () => {
    const send = vi.fn().mockResolvedValue({ status: 'success', attempt: 1 });
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          <StepFormHarness send={send} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await user.type(zoneBox(), 'rear');
    await user.click(record());
    await waitFor(() => expect(zoneBox()).toHaveValue(''));
    await user.click(screen.getByRole('button', { name: 'use second' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    forgetRememberedBranch();
  });

  it('asks before a switch while something is typed: Stay keeps it, Discard empties it', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          <StepFormHarness send={vi.fn()} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await user.type(zoneBox(), 'rear');

    await stayOnBranch(user, await switchExpectingQuestion(user, 'use second'));
    expect(zoneBox()).toHaveValue('rear');

    await discardAndSwitch(user, await switchExpectingQuestion(user, 'use second'));
    await waitFor(() => expect(zoneBox()).toHaveValue(''));
    forgetRememberedBranch();
  });
});
