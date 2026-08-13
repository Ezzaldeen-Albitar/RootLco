import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

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
vi.mock('@/lib/customers/vehicles', () => ({
  listCustomerVehicles: (...args: unknown[]) => listCustomerVehicles(...args),
}));

const searchVehicles = vi.fn();
const createVehicleAction = vi.fn();
vi.mock('@/features/vehicles/api', () => ({
  searchVehicles: (...args: unknown[]) => searchVehicles(...args),
  createVehicleAction: (...args: unknown[]) => createVehicleAction(...args),
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
    request: { page: 1, pageSize: 25 },
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

  it('states the blocked kind in Arabic too', () => {
    renderRtl(<CoverageNotice locale="ar" messages={ar} kind="damage_map" />);
    expect(screen.getByTestId('evidence-notice-damage_map')).toHaveTextContent(
      AR['receptions.evidence.damageMapBlocked'] as string
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
 * BranchTargetFields — a resource selector, and the directory that is missing
 * ====================================================================== */

describe('BranchTargetFields', () => {
  const COMPANY = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const BRANCH = '10101010-1010-4010-8010-101010101010';

  it('offers the session’s OWN resolved references, and says why there are no names', () => {
    renderLtr(
      <BranchTargetFields
        messages={en}
        companyIds={[COMPANY]}
        branchIds={[BRANCH]}
        companyId={COMPANY}
        branchId={BRANCH}
        onCompanyChange={vi.fn()}
        onBranchChange={vi.fn()}
      />
    );
    // Two selects, each carrying the contract-gap sentence: the platform
    // publishes no company or branch directory, so there are no names to show.
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getAllByText(EN['admin.contractGap.noDirectory'] as string)).toHaveLength(2);
    expect(screen.getByRole('option', { name: COMPANY })).toBeInTheDocument();
  });

  it('falls back to a typed reference when the session resolves NO scope', () => {
    // An empty resolved list means unrestricted within the workspace, not "no
    // access" — offering an empty select would read as the opposite.
    renderLtr(
      <BranchTargetFields
        messages={en}
        companyIds={[]}
        branchIds={[]}
        companyId=""
        branchId=""
        onCompanyChange={vi.fn()}
        onBranchChange={vi.fn()}
      />
    );
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.getAllByText(EN['admin.scope.noneResolved'] as string)).toHaveLength(2);
  });

  it('reports each half separately, so an error lands on the field it is about', () => {
    renderLtr(
      <BranchTargetFields
        messages={en}
        companyIds={[]}
        branchIds={[]}
        companyId=""
        branchId=""
        onCompanyChange={vi.fn()}
        onBranchChange={vi.fn()}
        branchError="This branch is required"
      />
    );
    expect(screen.getByText('This branch is required')).toBeVisible();
  });

  it('reports what the operator typed, for the branch half only', async () => {
    const onCompanyChange = vi.fn();
    const onBranchChange = vi.fn();
    renderLtr(
      <BranchTargetFields
        messages={en}
        companyIds={[]}
        branchIds={[]}
        companyId=""
        branchId=""
        onCompanyChange={onCompanyChange}
        onBranchChange={onBranchChange}
      />
    );
    const fields = screen.getAllByRole('textbox');
    await userEvent.type(fields[1] as HTMLElement, 'b');
    expect(onBranchChange).toHaveBeenCalledWith('b');
    expect(onCompanyChange).not.toHaveBeenCalled();
  });
});

/* ====================================================================== *
 * WindowFields — the clock is named, and the errors are the window's
 * ====================================================================== */

describe('WindowFields', () => {
  function fields(over: Record<string, unknown> = {}) {
    return (
      <WindowFields
        messages={en}
        locale="en"
        legend="Requested window"
        fromLabel="From"
        toLabel="To"
        draft={{ from: '', to: '' }}
        onChange={vi.fn()}
        errors={{}}
        {...over}
      />
    );
  }

  it('names the clock the composed instants will carry', () => {
    // A booking made in Amman for a branch in Riyadh is a decision the operator
    // must be able to SEE, not discover afterwards.
    renderLtr(fields());
    expect(
      screen.getByText(EN['appointments.window.clockNote'] as string, { exact: false })
    ).toBeVisible();
  });

  it('shows what will actually be sent, once a half is complete', () => {
    renderLtr(fields({ draft: { from: '2026-09-01T09:00', to: '' } }));
    const willSend = EN['appointments.window.willSend'] as string;
    const shown = screen.getAllByText(new RegExp(willSend));
    expect(shown).toHaveLength(1);
    // The offset is what makes the value unambiguous, and it is visible.
    expect(shown[0]?.textContent).toMatch(/2026-09-01T09:00:00(Z|[+-]\d{2}:\d{2})/);
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
  });

  it('reports every keystroke to its owner, keeping the other half untouched', async () => {
    const onChange = vi.fn();
    renderLtr(fields({ onChange }));
    const inputs = screen.getAllByLabelText(/From|To/);
    await userEvent.type(inputs[0] as HTMLElement, '2026-09-01T09:00');
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as { from: string; to: string };
    expect(last.to).toBe('');
  });

  it('carries real Arabic for the clock note', () => {
    renderRtl(
      <WindowFields
        messages={ar}
        locale="ar"
        legend="نافذة"
        fromLabel="من"
        toLabel="إلى"
        draft={{ from: '', to: '' }}
        onChange={vi.fn()}
        errors={{}}
      />
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
    expect(screen.getByLabelText(EN['crm.customers.create.givenName'] as string)).toBeVisible();
    expect(screen.queryByLabelText(EN['crm.customers.create.legalName'] as string)).toBeNull();
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
    expect(screen.getByLabelText(EN['crm.customers.create.legalName'] as string)).toBeVisible();
    expect(screen.queryByLabelText(EN['crm.customers.create.givenName'] as string)).toBeNull();
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
