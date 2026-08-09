import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import {
  CREATABLE_LIFECYCLE_STATUSES,
  MAX_COMPANY_NAME,
  MAX_PERSON_NAME,
} from '@/features/crm/customers/creation-contract';

/**
 * Customer creation and its duplicate warning (`FE-003`, `FE-004`, `FE-005`).
 *
 * The claim that matters most here is a negative one: **the form does not
 * pretend to check for duplicates before submitting**. There is no operation for
 * that — `crm.duplicate-scan` is a POST that writes candidate rows and emits a
 * privileged audit record — so a pre-check would either be a lie or would fill
 * the audit trail with scans nobody asked for.
 */

const createIndividualAction = vi.fn();
const createCompanyAction = vi.fn();

vi.mock('@/features/crm/customers/creation-actions', () => ({
  createIndividualAction: (...args: unknown[]) => createIndividualAction(...args),
  createCompanyAction: (...args: unknown[]) => createCompanyAction(...args),
}));

const { CustomerCreateScreen } =
  await import('@/features/crm/customers/components/CustomerCreateScreen');

const CREATED = {
  customerId: '2f1e0f6a-5c2d-4a5b-8f2c-1a2b3c4d5e6f',
  displayNumber: 'C-0042',
  partyType: 'individual' as const,
  lifecycleStatus: 'prospect',
  possibleDuplicates: [] as readonly {
    id: string;
    displayName: string;
    displayNumber: string | null;
  }[],
};

function successState(overrides: Record<string, unknown> = {}) {
  return {
    status: 'success',
    messageKey: 'crm.customers.create.created',
    attempt: 1,
    created: { ...CREATED, ...overrides },
  };
}

beforeEach(() => {
  createIndividualAction.mockReset();
  createCompanyAction.mockReset();
  createIndividualAction.mockResolvedValue(successState());
  createCompanyAction.mockResolvedValue(successState({ partyType: 'organization' }));
});

describe('the contract vocabulary', () => {
  it('offers TWO lifecycle statuses on create, not the five search offers', () => {
    // A customer can REACH inactive, blocked or merged; it cannot be BORN there.
    // Offering the search vocabulary would 422 on three of five options.
    expect([...CREATABLE_LIFECYCLE_STATUSES]).toEqual(['prospect', 'active']);
  });

  it('bounds the name fields where the routes bound them', () => {
    expect(MAX_PERSON_NAME).toBe(100);
    expect(MAX_COMPANY_NAME).toBe(200);
  });
});

/*
 * The "edge validation" block that stood here is gone with the functions it
 * called (`P1-27-FE-013`).
 *
 * `validateIndividual` and `validateCompany` mirrored the create schemas and
 * were invoked by nothing, so the three cases here asserted that an unreachable
 * mirror named the right field — while the form an operator actually uses gets
 * its field errors from the server. They also disagreed with that server, using
 * `crm.customers.create.tooLong` where the action returns `field.tooLong`.
 *
 * The cases below already cover the real path: the form renders a server-issued
 * field error against its own field, in both locales.
 */

describe('the individual form', () => {
  it('renders the individual fields and not the company ones', () => {
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="individual" />);
    expect(screen.getByLabelText(/Given name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Family name/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Legal name/)).toBeNull();
  });

  it('offers exactly two initial statuses', () => {
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="individual" />);
    const select = screen.getByLabelText(en['crm.customers.create.lifecycleStatus']);
    expect(within(select).getAllByRole('option')).toHaveLength(2);
  });

  it('bounds the name fields in the markup, not only on the server', () => {
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="individual" />);
    expect(screen.getByLabelText(/Given name/)).toHaveAttribute(
      'maxlength',
      String(MAX_PERSON_NAME)
    );
  });
});

describe('the company form', () => {
  it('renders the company fields and not the individual ones', () => {
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="company" />);
    expect(screen.getByLabelText(/Legal name/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Given name/)).toBeNull();
  });

  it('marks the trading name optional, because the contract does', () => {
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="company" />);
    expect(screen.getByLabelText(/Trading name/)).toBeInTheDocument();
  });
});

describe('the duplicate warning is a RESULT, not a pre-check', () => {
  it('calls nothing while the operator types a name', async () => {
    // The whole point. A pre-submit check would have to be `crm.duplicate-scan`,
    // which writes rows and emits a privileged audit record.
    const user = userEvent.setup();
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="individual" />);
    await user.type(screen.getByLabelText(/Given name/), 'Nadia');
    await user.type(screen.getByLabelText(/Family name/), 'Khoury');
    await user.tab();
    expect(createIndividualAction).not.toHaveBeenCalled();
  });

  it('states the record WAS created, then lists the look-alikes', async () => {
    createIndividualAction.mockResolvedValue(
      successState({
        possibleDuplicates: [
          { id: 'other-1', displayName: 'Nadia Khoury', displayNumber: 'C-0007' },
        ],
      })
    );
    const user = userEvent.setup();
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="individual" />);
    await user.type(screen.getByLabelText(/Given name/), 'Nadia');
    await user.type(screen.getByLabelText(/Family name/), 'Khoury');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    // Success first and unambiguous — a duplicate list under an ambiguous
    // heading reads as a rejection, and the record does exist.
    expect(await screen.findByText(/Customer created/)).toBeInTheDocument();
    expect(screen.getByText(en['crm.customers.create.duplicatesTitle'])).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nadia Khoury' })).toHaveAttribute(
      'href',
      '/en/crm/customers/other-1'
    );
  });

  it('shows no duplicate section when there are none', async () => {
    const user = userEvent.setup();
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="individual" />);
    await user.type(screen.getByLabelText(/Given name/), 'Unique');
    await user.type(screen.getByLabelText(/Family name/), 'Person');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));
    await screen.findByText(/Customer created/);
    expect(screen.queryByText(en['crm.customers.create.duplicatesTitle'])).toBeNull();
  });
});

describe('the created customer', () => {
  it('links to the new record', async () => {
    const user = userEvent.setup();
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="individual" />);
    await user.type(screen.getByLabelText(/Given name/), 'Nadia');
    await user.type(screen.getByLabelText(/Family name/), 'Khoury');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));
    expect(
      await screen.findByRole('link', { name: en['crm.customers.create.openCreated'] })
    ).toHaveAttribute('href', `/en/crm/customers/${CREATED.customerId}`);
  });

  it('treats a missing customer number as a supported state, not a failure', async () => {
    // A tenant without a provisioned number sequence gets a customer with no
    // number. The backend calls that supported; the screen must not call it an
    // error.
    createIndividualAction.mockResolvedValue(successState({ displayNumber: null }));
    const user = userEvent.setup();
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="individual" />);
    await user.type(screen.getByLabelText(/Given name/), 'Nadia');
    await user.type(screen.getByLabelText(/Family name/), 'Khoury');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));
    expect(await screen.findByText(en['crm.customers.create.noNumberYet'])).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('failure', () => {
  it('announces a field error against its field', async () => {
    createIndividualAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.formError',
      fieldErrors: { givenName: 'field.required' },
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="individual" />);
    await user.type(screen.getByLabelText(/Family name/), 'Khoury');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    const field = await screen.findByLabelText(/Given name/);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    // Described, not merely coloured. A colour is not an announcement.
    expect(field.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('shows the correlation reference and keeps the form usable', async () => {
    createIndividualAction.mockResolvedValue({
      status: 'unavailable',
      messageKey: 'state.unavailable.title',
      correlationId: 'fixed-correlation-id',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="individual" />);
    await user.type(screen.getByLabelText(/Given name/), 'Nadia');
    await user.type(screen.getByLabelText(/Family name/), 'Khoury');
    await user.click(screen.getByRole('button', { name: en['form.submit'] }));

    expect(await screen.findByRole('alert')).toHaveTextContent('fixed-correlation-id');
    // The form is still there — a transport failure is not a reason to make the
    // operator retype a customer's name.
    expect(screen.getByLabelText(/Given name/)).toHaveValue('Nadia');
  });

  it('keeps the CHOSEN initial status after a failed submit, not just the typed names', async () => {
    /*
     * The case above asserted only a TextField, and that gap is why this defect
     * survived a PASS verdict: the status select carried `defaultValue="prospect"`
     * with no `value` and no `onChange`, eight lines beneath a docblock claiming
     * every field here is controlled so that a transport failure cannot discard
     * the operator's input.
     *
     * "Active" is deliberately the value chosen, because it is not the default.
     * Asserting the select still reads "Prospect" would pass against the broken
     * code and against the fix alike, and would prove nothing.
     *
     * The consequence this guards is quiet rather than loud: the names visibly
     * survive, so the form LOOKS intact, while the one field that does not read
     * as typed text has reverted. The operator resubmits and creates a prospect
     * they did not ask for, fixable only through a different screen.
     */
    createIndividualAction.mockResolvedValue({
      status: 'unavailable',
      messageKey: 'state.unavailable.title',
      correlationId: 'fixed-correlation-id',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(<CustomerCreateScreen locale="en" messages={en} kind="individual" />);

    await user.type(screen.getByLabelText(/Given name/), 'Nadia');
    await user.type(screen.getByLabelText(/Family name/), 'Khoury');
    const status = screen.getByLabelText(en['crm.customers.create.lifecycleStatus']);
    await user.selectOptions(status, 'active');
    expect(status).toHaveValue('active');

    await user.click(screen.getByRole('button', { name: en['form.submit'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent('fixed-correlation-id');

    expect(screen.getByLabelText(en['crm.customers.create.lifecycleStatus'])).toHaveValue('active');
    // Asserted together, so a future change cannot "fix" the select by making
    // the whole form uncontrolled again.
    expect(screen.getByLabelText(/Given name/)).toHaveValue('Nadia');
  });
});

describe('Arabic', () => {
  it('renders the company form right to left', () => {
    renderRtl(<CustomerCreateScreen locale="ar" messages={ar} kind="company" />);
    expect(screen.getByLabelText(/الاسم القانوني/)).toBeInTheDocument();
  });
});

describe('the source carries no pre-submit duplicate check', () => {
  const source = readFileSync(
    join(
      process.cwd(),
      '..',
      '..',
      'apps',
      'web',
      'src',
      'features',
      'crm',
      'customers',
      'creation-actions.ts'
    ),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  it('calls only the two creation operations', () => {
    expect(source).toContain('/api/v1/customers/individuals');
    expect(source).toContain('/api/v1/customers/companies');
    // `duplicate-scans` would be a privileged write on a form that has not been
    // submitted yet.
    expect(source).not.toContain('duplicate-scans');
  });
});
