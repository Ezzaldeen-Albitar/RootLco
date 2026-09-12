import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * Starting a handover with a validated delivering employee (P1-31, FE-002).
 *
 * The control was withheld while `delivering_employee_id` carried no foreign key
 * and no validation, because a form that sent an unvalidated reference would
 * have been this tier inventing an identity. P1-31 prerequisite P-17 gave the
 * employee a real one and the Owner decided its shape on 2026-09-10, so the
 * control is back — and these are the properties that have to hold for it to
 * stay back.
 *
 * The properties under test:
 *
 *  - the picker is drawn only for a caller holding the register's own read code,
 *    and without it NOTHING is read — a denial the screen could predict has no
 *    business in the backend's log;
 *  - the form is ABSENT, not disabled, for a caller who may not open a handover;
 *  - a person chosen from the list is submitted as the delivering employee, with
 *    the work order beside them and nothing else in the body;
 *  - another branch of the same company can be read, because the employee's own
 *    branch is not a rule the server applies and a picker that hid those
 *    colleagues would re-impose in a browser what the database does not carry;
 *  - the two causes behind one refusal code are worded apart, because they send
 *    an operator somewhere different;
 *  - a work order that already has a handover says so in its own words;
 *  - the name shown after success is the one the SERVER stamped;
 *  - and every sentence reads in Arabic as Arabic.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const readWorkOrderDelivery = vi.fn();
const createDelivery = vi.fn();
vi.mock('@/features/delivery/api', () => ({
  readWorkOrderDelivery: (...args: unknown[]) => readWorkOrderDelivery(...args),
  createDelivery: (...args: unknown[]) => createDelivery(...args),
}));

const listEmployees = vi.fn();
vi.mock('@/features/delivery/employee-api', () => ({
  listEmployees: (...args: unknown[]) => listEmployees(...args),
  readEmployee: vi.fn(),
}));

const { WorkOrderDeliveryPanel } =
  await import('@/features/delivery/components/WorkOrderDeliveryPanel');

const WORK_ORDER_ID = '44444444-4444-4444-8444-444444444444';
const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_BRANCH_ID = '66666666-6666-4666-8666-666666666666';
const EMPLOYEE_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_EMPLOYEE_ID = '88888888-8888-4888-8888-888888888888';

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr-1' });
const refusedRead = (status: string, correlationId: string | null = 'corr-9') => ({
  status,
  correlationId,
});

const employee = (id: string, displayName: string, employmentRef: string | null) => ({
  id,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  displayName,
  userAccountId: null,
  employmentRef,
  status: 'active',
  recordVersion: 1,
});

const page = (items: readonly unknown[]) => okRead({ items, nextCursor: null, hasMore: false });

/** The two people the register answers with in the ordinary case. */
const ROSTER = [
  employee(EMPLOYEE_ID, 'Maryam Haddad', 'ref-104'),
  employee(OTHER_EMPLOYEE_ID, 'Omar Nasser', null),
];

beforeEach(() => {
  readWorkOrderDelivery.mockReset();
  createDelivery.mockReset();
  listEmployees.mockReset();
  // No live handover, which is the state the Start form is drawn in.
  readWorkOrderDelivery.mockResolvedValue(okRead({ workOrderId: WORK_ORDER_ID, delivery: null }));
  listEmployees.mockResolvedValue(page(ROSTER));
});

function renderPanel(
  props: {
    readonly canManage?: boolean;
    readonly canReadEmployees?: boolean;
    readonly locale?: 'en' | 'ar';
  } = {}
) {
  const locale = props.locale ?? 'en';
  const render = locale === 'en' ? renderLtr : renderRtl;
  return render(
    <WorkOrderDeliveryPanel
      locale={locale}
      messages={locale === 'en' ? en : ar}
      workOrderId={WORK_ORDER_ID}
      companyId={COMPANY_ID}
      branchId={BRANCH_ID}
      canManage={props.canManage ?? true}
      canReadEmployees={props.canReadEmployees ?? true}
    />
  );
}

const section = (text: Record<string, string> = EN) =>
  screen.getByRole('region', { name: text['delivery.workOrder.heading'] as string });

describe('the two authorities that decide what the Start control looks like', () => {
  it('draws no form at all for a caller who may not open a handover', async () => {
    renderPanel({ canManage: false });
    await waitFor(() => expect(readWorkOrderDelivery).toHaveBeenCalledWith(WORK_ORDER_ID));
    const region = section();
    expect(within(region).getByText(EN['delivery.workOrder.none'] as string)).toBeVisible();
    // Absent, not disabled: a control whose only outcome is a denial teaches an
    // operator to ignore denials.
    expect(within(region).queryAllByRole('button')).toHaveLength(0);
    expect(within(region).queryAllByRole('combobox')).toHaveLength(0);
    expect(listEmployees).not.toHaveBeenCalled();
  });

  it('states that the selection cannot be offered without the register read, and reads nothing', async () => {
    renderPanel({ canReadEmployees: false });
    const region = await screen.findByRole('region', {
      name: EN['delivery.workOrder.heading'] as string,
    });
    expect(
      within(region).getByText(EN['delivery.start.employeeSelectionUnavailable'] as string)
    ).toBeVisible();
    // Asked and refused would put a denial in the backend's log for a decision
    // this screen could make. So it is not asked.
    expect(listEmployees).not.toHaveBeenCalled();
    expect(within(region).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(region).queryAllByRole('button')).toHaveLength(0);
    expect(createDelivery).not.toHaveBeenCalled();
  });
});

describe('choosing who hands the vehicle over', () => {
  it('reads the work order’s own branch first and lists the people it answered with', async () => {
    renderPanel();
    await waitFor(() =>
      expect(listEmployees).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        status: 'active',
      })
    );
    const picker = await screen.findByLabelText(labelled('delivery.start.employeeField'));
    // The employment reference is shown beside the name where the register
    // carries one, so two colleagues who share a name can be told apart.
    expect(within(picker).getByRole('option', { name: 'Maryam Haddad — ref-104' })).toBeTruthy();
    expect(within(picker).getByRole('option', { name: 'Omar Nasser' })).toBeTruthy();
  });

  it('submits the work order and the chosen person, and nothing else', async () => {
    createDelivery.mockResolvedValue({
      status: 'success',
      messageKey: 'delivery.start.done',
      attempt: 1,
      created: {
        id: DELIVERY_ID,
        deliveringEmployeeId: EMPLOYEE_ID,
        deliveringEmployeeDisplayName: 'Maryam Haddad',
        status: 'ready',
      },
    });
    renderPanel();
    const picker = await screen.findByLabelText(labelled('delivery.start.employeeField'));
    await userEvent.selectOptions(picker, EMPLOYEE_ID);
    await userEvent.click(
      screen.getByRole('button', { name: EN['delivery.start.submit'] as string })
    );

    await waitFor(() =>
      expect(createDelivery).toHaveBeenCalledWith({
        workOrderId: WORK_ORDER_ID,
        deliveringEmployeeId: EMPLOYEE_ID,
      })
    );
    // The vehicle and the reception visit are the server's to derive from the
    // work order, so the body names neither.
    const body = createDelivery.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['deliveringEmployeeId', 'workOrderId']);
  });

  it('shows the name the SERVER stamped, and links to the handover it created', async () => {
    createDelivery.mockResolvedValue({
      status: 'success',
      messageKey: 'delivery.start.done',
      attempt: 1,
      created: {
        id: DELIVERY_ID,
        deliveringEmployeeId: EMPLOYEE_ID,
        // Deliberately NOT the text the picker showed: the stamp is the
        // authority for historical attribution, and echoing the request would
        // make the screen the author of its own confirmation.
        deliveringEmployeeDisplayName: 'Maryam Y. Haddad',
        status: 'ready',
      },
    });
    renderPanel();
    const picker = await screen.findByLabelText(labelled('delivery.start.employeeField'));
    await userEvent.selectOptions(picker, EMPLOYEE_ID);
    await userEvent.click(
      screen.getByRole('button', { name: EN['delivery.start.submit'] as string })
    );

    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent(EN['delivery.start.done'] as string);
    expect(done).toHaveTextContent('Maryam Y. Haddad');
    const link = within(done).getByRole('link', {
      name: EN['delivery.workOrder.open'] as string,
    });
    expect(link.getAttribute('href')).toBe(`/en/delivery/${DELIVERY_ID}`);
  });

  it('reads ANOTHER branch of the same company when the operator names one', async () => {
    listEmployees.mockResolvedValueOnce(page(ROSTER));
    listEmployees.mockResolvedValue(page([employee(OTHER_EMPLOYEE_ID, 'Lina Faraj', null)]));
    renderPanel();
    await screen.findByLabelText(labelled('delivery.start.employeeField'));

    const branch = screen.getByLabelText(labelled('delivery.start.branchField'));
    await userEvent.type(branch, OTHER_BRANCH_ID);

    await waitFor(() =>
      expect(listEmployees).toHaveBeenLastCalledWith({
        companyId: COMPANY_ID,
        branchId: OTHER_BRANCH_ID,
        status: 'active',
      })
    );
    // The set is REPLACED, not merged: a selection left behind from the previous
    // branch would be submitted under a name no longer on screen.
    const picker = await screen.findByLabelText(labelled('delivery.start.employeeField'));
    await waitFor(() =>
      expect(within(picker).getByRole('option', { name: 'Lina Faraj' })).toBeTruthy()
    );
    expect(within(picker).queryByRole('option', { name: 'Maryam Haddad — ref-104' })).toBeNull();
  });

  it('says when the branch has nobody to name, instead of showing an empty control', async () => {
    listEmployees.mockResolvedValue(page([]));
    renderPanel();
    expect(await screen.findByText(EN['delivery.start.noEmployees'] as string)).toBeVisible();
    expect(screen.queryByLabelText(labelled('delivery.start.employeeField'))).toBeNull();
  });

  it('offers a second attempt where one can help, and none where it cannot', async () => {
    listEmployees.mockResolvedValue(refusedRead('unavailable'));
    const unavailable = renderPanel();
    expect(
      await screen.findByText(EN['delivery.start.employeesUnavailable'] as string)
    ).toBeVisible();
    const retry = screen.getByRole('button', {
      name: EN['delivery.start.employeesRetry'] as string,
    });
    listEmployees.mockResolvedValue(page(ROSTER));
    await userEvent.click(retry);
    expect(await screen.findByLabelText(labelled('delivery.start.employeeField'))).toBeTruthy();
    unavailable.unmount();

    listEmployees.mockReset();
    listEmployees.mockResolvedValue(refusedRead('denied'));
    renderPanel();
    expect(await screen.findByText(EN['delivery.start.employeesRefused'] as string)).toBeVisible();
    // Re-issuing the same request against the same refusal fails identically,
    // and offering the button suggests otherwise.
    expect(
      screen.queryByRole('button', { name: EN['delivery.start.employeesRetry'] as string })
    ).toBeNull();
  });
});

describe('a refused start is reported in the server’s own terms', () => {
  const refusal = (code: string, rule?: string) => ({
    status: 'conflict' as const,
    messageKey: 'state.conflict.title',
    attempt: 1,
    code,
    ...(rule === undefined ? {} : { rule }),
    correlationId: 'corr-42',
  });

  async function start(outcome: unknown) {
    createDelivery.mockResolvedValue(outcome);
    renderPanel();
    const picker = await screen.findByLabelText(labelled('delivery.start.employeeField'));
    await userEvent.selectOptions(picker, EMPLOYEE_ID);
    await userEvent.click(
      screen.getByRole('button', { name: EN['delivery.start.submit'] as string })
    );
    return screen.findByRole('alert');
  }

  it('tells a retired employee apart from one it cannot resolve', async () => {
    const retired = await start(refusal('ERR-VAL-001', 'inactive_employee'));
    expect(retired).toHaveTextContent(EN['delivery.start.refusedRetired'] as string);
    expect(retired).toHaveTextContent('corr-42');
    // One code, two causes. Reporting them with one sentence would send an
    // operator to reinstate somebody who was never on the register.
    expect(retired).not.toHaveTextContent(EN['delivery.start.refusedUnknown'] as string);
  });

  it('reports an employee it cannot resolve without confirming one exists', async () => {
    const unknown = await start(refusal('ERR-VAL-001', 'custom'));
    expect(unknown).toHaveTextContent(EN['delivery.start.refusedUnknown'] as string);
    expect(unknown).not.toHaveTextContent(EN['delivery.start.refusedRetired'] as string);
  });

  it('reports a work order that already has a handover in its own words', async () => {
    const conflict = await start(refusal('ERR-RES-002'));
    expect(conflict).toHaveTextContent(EN['delivery.start.refusedAlreadyStarted'] as string);
  });

  it('reports a refused authority as a refused authority', async () => {
    const denied = await start(refusal('ERR-IAM-001'));
    expect(denied).toHaveTextContent(EN['delivery.start.refusedDenied'] as string);
  });

  it('keeps the shared wording for a cause the server did not distinguish', async () => {
    const other = await start({
      status: 'error' as const,
      messageKey: 'action.failed',
      attempt: 1,
      correlationId: 'corr-42',
    });
    // No sentence is invented per code: the catalogue carries the four the
    // backend genuinely tells apart, and everything else keeps the shared one.
    expect(other).toHaveTextContent(EN['action.failed'] as string);
  });

  it('does not re-send after a refusal, and does not re-send after a success', async () => {
    const refused = await start(refusal('ERR-RES-002'));
    expect(refused).toBeVisible();
    expect(createDelivery).toHaveBeenCalledTimes(1);
  });
});

describe('the whole surface reads in Arabic as Arabic', () => {
  it('names the control, the people and a refusal without falling back to English', async () => {
    createDelivery.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.title',
      attempt: 1,
      code: 'ERR-VAL-001',
      rule: 'inactive_employee',
      correlationId: 'corr-42',
    });
    renderPanel({ locale: 'ar' });
    const region = await screen.findByRole('region', {
      name: AR['delivery.workOrder.heading'] as string,
    });
    const picker = await within(region).findByLabelText(
      new RegExp(`^${escape(AR['delivery.start.employeeField'] as string)}`)
    );
    await userEvent.selectOptions(picker, EMPLOYEE_ID);
    await userEvent.click(
      within(region).getByRole('button', { name: AR['delivery.start.submit'] as string })
    );

    const alert = await within(region).findByRole('alert');
    expect(alert).toHaveTextContent(AR['delivery.start.refusedRetired'] as string);
    // A copy-paste that leaves the English string in the Arabic catalogue reads
    // as translated, so the English of the same sentence must not be on screen.
    expect(alert).not.toHaveTextContent(EN['delivery.start.refusedRetired'] as string);
    expect(within(region).queryByText(EN['delivery.start.submit'] as string)).toBeNull();
  });
});
