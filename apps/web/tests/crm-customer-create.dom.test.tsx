import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import type { Messages } from '@/i18n/get-messages';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  WorkingBranchProbe,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';
import { forgetRememberedBranch, heldBranch, switchWithoutQuestion } from './support/branch-switch';
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

/*
 * The transport, for the last section of this file only.
 *
 * A REAL `ApiClient` over a stubbed `fetch`. Every other case here drives the
 * creation actions through the module mock above and never reaches this.
 */
const fetchImpl = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/server-client', async () => {
  const { ApiClient } = await import('@/lib/api/client');
  return {
    authorizedClient: async () =>
      new ApiClient({
        baseUrl: 'http://api.test',
        fetchImpl: (input: unknown, init: unknown) => fetchImpl(input, init),
      }),
  };
});

const { CustomerCreateScreen } =
  await import('@/features/crm/customers/components/CustomerCreateScreen');

/**
 * The REAL creation actions, kept beside the spies that stand in for them.
 *
 * `vi.mock` above replaces the module for the whole file; the last section
 * points the spies at these so a real 422 can travel the whole way.
 */
const actualCreationActions = await vi.importActual<
  typeof import('@/features/crm/customers/creation-actions')
>('@/features/crm/customers/creation-actions');

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

/** The Material field root a control sits in — where `Mui-error` is drawn. */
const fieldRoot = (control: HTMLElement) => control.closest('.MuiInputBase-root');

function successState(overrides: Record<string, unknown> = {}) {
  return {
    status: 'success',
    messageKey: 'crm.customers.create.created',
    attempt: 1,
    created: { ...CREATED, ...overrides },
  };
}

beforeEach(() => {
  fetchImpl.mockReset();
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
    /*
     * The wait has to be on the ATTRIBUTE, not on the field.
     *
     * `findByLabelText` is satisfied the moment the input exists, and the input
     * exists before the submit is ever made — so it waited for nothing and this
     * assertion raced the action's state update. `aria-invalid` is rendered as
     * `invalid || undefined`, so losing that race reads the attribute as `null`
     * and fails on a screen that is about to be correct.
     *
     * Latent since the case was written: it needs the machine to be slow enough,
     * which under a full parallel DOM run it intermittently is. Found when
     * `FE-030` changed formatting timings just enough to lose the race about
     * half the time. Nothing about what is asserted changes.
     */
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    // Described, not merely coloured. A colour is not an announcement.
    expect(field.getAttribute('aria-describedby')).toBeTruthy();
  });

  /*
   * Browser QA part 7, rows 6.2, 6.3 and 6.5, in both languages. The refused
   * box kept the grey edge of a valid one; after Save the cursor sat on the
   * document body, and after Enter in "Given name" it stayed there while
   * "Family name" was the box refused; and a corrected family name went on
   * saying "This field is required." until the next submission.
   */
  const FAMILY_REFUSED = {
    status: 'invalid' as const,
    messageKey: 'form.formError',
    fieldErrors: { familyName: 'field.required' },
    attempt: 1,
  };

  for (const locale of ['en', 'ar'] as const) {
    const messages = locale === 'en' ? en : ar;
    const view = locale === 'en' ? renderLtr : renderRtl;
    const given = () =>
      screen.getByLabelText(messages['crm.customers.create.givenName'], { exact: false });
    const family = () =>
      screen.getByLabelText(messages['crm.customers.create.familyName'], { exact: false });

    it(`marks the refused box with the red edge, and only that box (${locale})`, async () => {
      createIndividualAction.mockResolvedValue(FAMILY_REFUSED);
      const user = userEvent.setup();
      view(<CustomerCreateScreen locale={locale} messages={messages} kind="individual" />);
      await user.type(given(), 'Nadia');
      await user.click(screen.getByRole('button', { name: messages['form.submit'] }));

      await waitFor(() => expect(family()).toHaveAttribute('aria-invalid', 'true'));
      // The red edge is drawn on the Material field root, which carries
      // `Mui-error` exactly when the field is refused.
      expect(fieldRoot(family())).toHaveClass('Mui-error');
      expect(fieldRoot(given())).not.toBeNull();
      expect(fieldRoot(given())).not.toHaveClass('Mui-error');
    });

    it(`puts the cursor on the refused box, even after Enter in another (${locale})`, async () => {
      createIndividualAction.mockResolvedValue(FAMILY_REFUSED);
      const user = userEvent.setup();
      view(<CustomerCreateScreen locale={locale} messages={messages} kind="individual" />);
      await user.type(given(), 'Nadia{Enter}');

      await waitFor(() => expect(family()).toHaveFocus());
      expect(createIndividualAction).toHaveBeenCalledTimes(1);
    });

    it(`withdraws the complaint once the box is corrected, before any resubmission (${locale})`, async () => {
      createIndividualAction.mockResolvedValue(FAMILY_REFUSED);
      const user = userEvent.setup();
      view(<CustomerCreateScreen locale={locale} messages={messages} kind="individual" />);
      await user.type(given(), 'Nadia');
      await user.click(screen.getByRole('button', { name: messages['form.submit'] }));
      await waitFor(() => expect(family()).toHaveFocus());
      expect(screen.getByText(messages['field.required'])).toBeInTheDocument();

      await user.type(family(), 'Khoury');
      await user.tab();

      expect(family()).not.toHaveAttribute('aria-invalid');
      expect(fieldRoot(family())).not.toHaveClass('Mui-error');
      expect(screen.queryByText(messages['field.required'])).toBeNull();
      // No second request was needed to find that out.
      expect(createIndividualAction).toHaveBeenCalledTimes(1);
    });
  }

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

/**
 * A real 422 reaching a CRM screen — `QA-002`, off the vehicle module.
 *
 * ## Why this block exists beside the vehicle one
 *
 * `QA-002` is not vehicle-specific, and the only end-to-end proof of the
 * violation path was `vehicle-profile-lifecycle.dom.test.tsx`. One screen
 * proving a shared mechanism proves that screen. The mechanism here is entirely
 * shared — `violationKeysOf`, `controlNameFor`, `violationMessageKey` and
 * `fromFailure` all live in `lib/`, and each screen supplies its own join
 * between `state.fieldErrors` and its controls. That join is per-screen, and it
 * is precisely what was missing on `VehicleProfileScreen`, which passed `error`
 * to no control at all while every layer beneath it was green.
 *
 * So this asserts the CRM screen's own join, over the same real transport.
 *
 * ## How much of it is real
 *
 * Everything except the socket: the shipped `createIndividualAction`, its Zod
 * schema, a real `ApiClient` from `@/lib/api/server-client`, the status-to-kind
 * mapping, the violation parse and the mounted screen.
 *
 * ## The fixtures are the route's own shapes
 *
 * `POST /api/v1/customers/individuals` bounds `givenName` and `familyName` at
 * `MAX_PERSON_NAME`, and `toViolations` emits Zod's issue code verbatim — so
 * `{ path: 'body.givenName', rule: 'too_big' }` is what the route really sends.
 * The paths are prefixed `body.`, which `controlNameFor` strips to the last
 * segment; a fixture written as a bare `givenName` would also pass and would
 * stop testing the prefix handling that the wire actually exercises.
 */
describe('the field errors a real 422 carries reach the CRM controls it names', () => {
  interface Violation {
    readonly path: string;
    readonly rule: string;
  }

  const GIVEN = en['crm.customers.create.givenName'];
  const FAMILY = en['crm.customers.create.familyName'];
  const LOCALE_FIELD = en['crm.customers.create.preferredLocale'];

  /**
   * The response the API really sends for a refused command.
   *
   * `application/problem+json`: `readPayload` parses on the `json` substring, so
   * a fixture served as `text/plain` arrives as a null problem and every
   * assertion below would pass or fail for the wrong reason.
   */
  function refuseWith(...violations: readonly Violation[]): void {
    fetchImpl.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'https://errors.example.test/ERR-VAL-001',
          title: 'Validation failed',
          status: 422,
          code: 'ERR-VAL-001',
          correlationId: 'corr-crm-fixture',
          violations,
        }),
        { status: 422, headers: { 'content-type': 'application/problem+json' } }
      )
    );
  }

  beforeEach(() => {
    createIndividualAction.mockImplementation(actualCreationActions.createIndividualAction);
    createCompanyAction.mockImplementation(actualCreationActions.createCompanyAction);
  });

  function control(label: string): HTMLElement {
    return screen.getByLabelText(label, { exact: false });
  }

  /**
   * The message a control POINTS AT, not merely a message somewhere on the page.
   *
   * `getByText` would be satisfied by an error rendered beside a different field
   * — the same "told something, somewhere" the banner already does. The
   * assertion is the ASSOCIATION: `aria-invalid`, plus text reached through the
   * id the control itself names.
   *
   * `CustomerCreateScreen` is on the Material wrappers (`P1-32-PRE-OD-CRM1A`),
   * whose control names its error through `aria-errormessage` and lists it in
   * `aria-describedby` (`components/forms/mui/field-wiring.tsx`). The helper
   * reads whichever is present, and the description span is skipped by id so a
   * field with a hint does not return its hint as its error.
   *
   * The wrapper's error node also holds the decorative `!` mark, hidden from
   * assistive technology with `aria-hidden`. What is read here is what a screen
   * reader reads — the node's text without its hidden parts — so the mark is
   * not mistaken for part of the sentence.
   */
  function messageOn(label: string): string {
    const element = control(label);
    expect(element.getAttribute('aria-invalid'), `${label} is not marked invalid`).toBe('true');
    const ids =
      element.getAttribute('aria-errormessage') ?? element.getAttribute('aria-describedby') ?? '';
    const errorNode = ids
      .split(/\s+/)
      .filter((one) => one.endsWith('-error'))
      .map((one) => document.getElementById(one))
      .find((node): node is HTMLElement => node !== null);
    expect(errorNode, `${label} points at no error message`).toBeTruthy();
    if (!errorNode) return '';
    const spoken = errorNode.cloneNode(true) as HTMLElement;
    for (const hidden of spoken.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
    return spoken.textContent ?? '';
  }

  /** Fill the two required names and submit. Values that PASS the client schema,
   *  so the request really is issued and the server is the one refusing. */
  async function create(locale: 'en' | 'ar' = 'en'): Promise<void> {
    // `delay: null` removes userEvent's inter-keystroke delay. It changes no
    // behaviour under test — every event still fires in order — and it keeps this
    // block from pushing the whole web suite past the 5 s per-test default, which
    // it was measured doing to two unrelated files.
    const user = userEvent.setup({ delay: null });
    const messages = locale === 'en' ? en : ar;
    await user.type(control(messages['crm.customers.create.givenName']), 'Nadia');
    await user.type(control(messages['crm.customers.create.familyName']), 'Khoury');
    await user.click(screen.getByRole('button', { name: messages['form.submit'] }));
  }

  function mount(locale: 'en' | 'ar' = 'en') {
    const view = locale === 'en' ? renderLtr : renderRtl;
    return view(
      <CustomerCreateScreen
        locale={locale}
        messages={locale === 'en' ? en : ar}
        kind="individual"
      />
    );
  }

  it('puts a name violation on the name control, translated', async () => {
    refuseWith({ path: 'body.givenName', rule: 'too_big' });
    mount();
    await create();

    // The request really happened. A 422 nobody asked for would leave every
    // assertion below satisfied by a form that never submitted.
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const [url, init] = fetchImpl.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://api.test/api/v1/customers/individuals');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ givenName: 'Nadia', familyName: 'Khoury' });

    await waitFor(() => expect(messageOn(GIVEN)).toBe(en['form.violation.too_big']));
    // The catalogue SENTENCE, never the key.
    expect(messageOn(GIVEN)).not.toContain('form.violation');
  });

  it('marks every field the response names, and only those', async () => {
    refuseWith(
      { path: 'body.givenName', rule: 'too_big' },
      { path: 'body.preferredLocale', rule: 'invalid_format' }
    );
    mount();
    await create();

    await waitFor(() => expect(messageOn(GIVEN)).toBe(en['form.violation.too_big']));
    expect(messageOn(LOCALE_FIELD)).toBe(en['form.violation.invalid_format']);
    // The family name was not named, so it must not be marked. Without this the
    // case would be satisfied by a form that flags everything after any refusal.
    expect(control(FAMILY).getAttribute('aria-invalid')).toBeNull();
  });

  it('translates into Arabic rather than falling back to English', async () => {
    refuseWith({ path: 'body.givenName', rule: 'too_big' });
    mount('ar');
    await create('ar');

    await waitFor(() =>
      expect(messageOn(ar['crm.customers.create.givenName'])).toBe(ar['form.violation.too_big'])
    );
    expect(ar['form.violation.too_big']).not.toBe(en['form.violation.too_big']);
  });

  it('turns an UNKNOWN rule token into the catalogue fallback, never the token', async () => {
    /*
     * The API emits more than eighty rule tokens and the catalogue carries
     * fourteen. `violationMessageKey` maps anything it does not know to
     * `form.violation.invalid` — the honest generic — rather than rendering the
     * server's token. This is the case that proves a malicious or merely newer
     * response cannot get text of its own onto the screen through this path.
     */
    refuseWith({ path: 'body.givenName', rule: 'crm_party_kind_unsupported' });
    const { container } = mount();
    await create();

    await waitFor(() => expect(messageOn(GIVEN)).toBe(en['form.violation.invalid']));
    expect(container.textContent ?? '').not.toContain('crm_party_kind_unsupported');
  });

  it('gives a truthful general error for a violation that names no control', async () => {
    /*
     * `{ path: 'body', rule: ... }` names no control: `controlNameFor` returns
     * null for a bare request part, so `fromFailure` promotes the key to
     * `messageKey` and the banner carries it. Attaching it to an arbitrary field
     * would accuse one; dropping it — what the client did to every violation of
     * every shape before `violations` was read at all — leaves the operator with
     * a form that refuses and says nothing.
     */
    refuseWith({ path: 'body', rule: 'empty_patch' });
    mount();
    await create();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent ?? '').toContain(
        en['form.violation.empty_patch']
      )
    );
    for (const label of [GIVEN, FAMILY, LOCALE_FIELD]) {
      expect(control(label).getAttribute('aria-invalid'), `${label} was marked`).toBeNull();
    }
  });

  it('gives a truthful general error when the named field is not on this form', async () => {
    /*
     * A violation about a field this form does not render — a server-side rule
     * over a column the create screen never offers. Nothing can be marked, and
     * the operator must still be told the save failed rather than watching a
     * form sit there having done nothing.
     */
    refuseWith({ path: 'body.taxIdentifier', rule: 'invalid_format' });
    mount();
    await create();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent ?? '').toContain(en['form.formError'])
    );
    for (const label of [GIVEN, FAMILY, LOCALE_FIELD]) {
      expect(control(label).getAttribute('aria-invalid'), `${label} was marked`).toBeNull();
    }
  });

  it('shows no part of the raw payload', async () => {
    refuseWith({ path: 'body.givenName', rule: 'too_big' });
    const { container } = mount();
    await create();

    await waitFor(() => expect(messageOn(GIVEN)).toBe(en['form.violation.too_big']));

    // The correlation id on screen is the one the CLIENT sent, never the
    // response-supplied one. Asserted present so this case cannot pass on a
    // screen that rendered no failure at all.
    const [, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    const text = container.textContent ?? '';
    expect(text).toContain(init.headers['x-correlation-id']);
    for (const leak of [
      'corr-crm-fixture',
      'ERR-VAL-001',
      'Validation failed',
      'https://errors.example.test',
      'too_big',
      'body.givenName',
      '{',
    ]) {
      expect(text, `the response leaked ${leak}`).not.toContain(leak);
    }
  });

  it('leaves every control unmarked when the create succeeds', async () => {
    /*
     * The anti-vacuity control. `messageOn` asserts a MARKED control, so a form
     * that marked everything unconditionally would satisfy every case above;
     * this is the direction that catches it.
     */
    fetchImpl.mockResolvedValue(
      new Response(
        JSON.stringify({
          customerId: '2f1e0f6a-5c2d-4a5b-8f2c-1a2b3c4d5e6f',
          displayNumber: 'C-0042',
          partyType: 'individual',
          lifecycleStatus: 'prospect',
          possibleDuplicates: [],
        }),
        { status: 201, headers: { 'content-type': 'application/json' } }
      )
    );
    mount();
    await create();

    await waitFor(() => expect(screen.getByText(/Customer created/)).toBeTruthy());
  });

  it('asserts on distinct messages, so no case can pass by coincidence', () => {
    const messages = [
      en['form.violation.too_big'],
      en['form.violation.invalid_format'],
      en['form.violation.invalid'],
      en['form.violation.empty_patch'],
      en['form.formError'],
    ];
    for (const message of messages) {
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    }
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe('a branch switch neither asks about nor empties a customer being created', () => {
  /*
   * A customer is the tenant's, not a branch's: the create request names no
   * branch, and nothing typed here is re-addressed by a switch. So the form
   * does not declare unsaved work — the question "Changing branch now will lose
   * them" would be untrue here — and a switch leaves every entry where it was.
   */
  it('switches without a question and keeps what was typed', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          <CustomerCreateScreen locale="en" messages={en} kind="individual" />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    try {
      await user.click(screen.getByRole('button', { name: 'first' }));
      await user.type(screen.getByLabelText(/Given name/), 'Layla');
      await switchWithoutQuestion(user, 'second');
      await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
      expect(screen.getByLabelText(/Given name/)).toHaveValue('Layla');
    } finally {
      forgetRememberedBranch();
    }
  });
});

/**
 * The screen on Material UI (`P1-32-PRE-OD-CRM1A`), in both languages.
 *
 * A presentation change, so what is pinned here is what must NOT have moved:
 * the fields each kind offers, the names the form submits, the required marks
 * the wrappers carry (`aria-required`, never the native `required`), the
 * refusal of an empty name before any request, the busy submit button and the
 * outcome links.
 */
describe('the screen on Material UI keeps its fields, its names and its refusals', () => {
  const MESSAGES: Readonly<Record<'en' | 'ar', Messages>> = { en, ar };
  const VIEW = { en: renderLtr, ar: renderRtl } as const;

  const labelled = (messages: Messages, key: keyof Messages) =>
    screen.getByLabelText(messages[key], { exact: false });

  /** The visible label of a control, as the operator reads it. */
  const labelText = (control: HTMLElement) =>
    document.querySelector(`label[for="${control.id}"]`)?.textContent ?? '';

  function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it('renders the Arabic individual form right to left with all three fields', () => {
    renderRtl(<CustomerCreateScreen locale="ar" messages={ar} kind="individual" />);
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(labelled(ar, 'crm.customers.create.givenName')).toHaveAttribute('name', 'givenName');
    expect(labelled(ar, 'crm.customers.create.familyName')).toHaveAttribute('name', 'familyName');
    expect(labelled(ar, 'crm.customers.create.preferredLocale')).toHaveAttribute(
      'name',
      'preferredLocale'
    );
    expect(screen.getByRole('link', { name: ar['form.cancel'] })).toHaveAttribute(
      'href',
      '/ar/crm/customers'
    );
  });

  for (const locale of ['en', 'ar'] as const) {
    const messages = MESSAGES[locale];
    const view = VIEW[locale];

    it(`marks the required boxes with aria-required and never the native required (${locale})`, () => {
      const { unmount } = view(
        <CustomerCreateScreen locale={locale} messages={messages} kind="individual" />
      );
      for (const key of [
        'crm.customers.create.givenName',
        'crm.customers.create.familyName',
      ] as const) {
        expect(labelled(messages, key)).toHaveAttribute('aria-required', 'true');
        expect(labelled(messages, key)).not.toHaveAttribute('required');
      }
      expect(labelled(messages, 'crm.customers.create.preferredLocale')).not.toHaveAttribute(
        'aria-required'
      );
      unmount();

      view(<CustomerCreateScreen locale={locale} messages={messages} kind="company" />);
      expect(labelled(messages, 'crm.customers.create.legalName')).toHaveAttribute(
        'aria-required',
        'true'
      );
      expect(labelled(messages, 'crm.customers.create.legalName')).not.toHaveAttribute('required');
      expect(labelled(messages, 'crm.customers.create.tradeName')).not.toHaveAttribute(
        'aria-required'
      );
    });

    it(`labels Trading name and Preferred language with the optional suffix (${locale})`, () => {
      const { unmount } = view(
        <CustomerCreateScreen locale={locale} messages={messages} kind="individual" />
      );
      expect(labelText(labelled(messages, 'crm.customers.create.preferredLocale'))).toBe(
        `${messages['crm.customers.create.preferredLocale']} ${messages['field.optional']}`
      );
      // A required label carries no optional suffix.
      expect(labelText(labelled(messages, 'crm.customers.create.givenName'))).not.toContain(
        messages['field.optional']
      );
      unmount();

      view(<CustomerCreateScreen locale={locale} messages={messages} kind="company" />);
      expect(labelText(labelled(messages, 'crm.customers.create.tradeName'))).toBe(
        `${messages['crm.customers.create.tradeName']} ${messages['field.optional']}`
      );
    });

    it(`offers the preferred language to an individual and not to a company (${locale})`, () => {
      const { unmount } = view(
        <CustomerCreateScreen locale={locale} messages={messages} kind="individual" />
      );
      expect(document.querySelector('input[name="preferredLocale"]')).not.toBeNull();
      unmount();

      view(<CustomerCreateScreen locale={locale} messages={messages} kind="company" />);
      expect(document.querySelector('input[name="legalName"]')).not.toBeNull();
      expect(document.querySelector('input[name="preferredLocale"]')).toBeNull();
      expect(
        screen.queryByLabelText(messages['crm.customers.create.preferredLocale'], { exact: false })
      ).toBeNull();
    });

    it(`submits exactly the individual field names (${locale})`, async () => {
      const user = userEvent.setup({ delay: null });
      view(<CustomerCreateScreen locale={locale} messages={messages} kind="individual" />);
      await user.type(labelled(messages, 'crm.customers.create.givenName'), 'Nadia');
      await user.type(labelled(messages, 'crm.customers.create.familyName'), 'Khoury');
      await user.click(screen.getByRole('button', { name: messages['form.submit'] }));

      await waitFor(() => expect(createIndividualAction).toHaveBeenCalledTimes(1));
      const form = createIndividualAction.mock.calls[0]?.[1] as FormData;
      expect([...form.keys()].sort()).toEqual(
        ['familyName', 'givenName', 'lifecycleStatus', 'preferredLocale'].sort()
      );
      expect(form.get('lifecycleStatus')).toBe('prospect');
      expect(createCompanyAction).not.toHaveBeenCalled();
    });

    it(`submits exactly the company field names (${locale})`, async () => {
      const user = userEvent.setup({ delay: null });
      view(<CustomerCreateScreen locale={locale} messages={messages} kind="company" />);
      await user.type(labelled(messages, 'crm.customers.create.legalName'), 'Khoury Trading');
      await user.click(screen.getByRole('button', { name: messages['form.submit'] }));

      await waitFor(() => expect(createCompanyAction).toHaveBeenCalledTimes(1));
      const form = createCompanyAction.mock.calls[0]?.[1] as FormData;
      expect([...form.keys()].sort()).toEqual(['legalName', 'lifecycleStatus', 'tradeName'].sort());
      expect(form.get('lifecycleStatus')).toBe('prospect');
      expect(createIndividualAction).not.toHaveBeenCalled();
    });

    it(`refuses empty individual names in the action, before any request (${locale})`, async () => {
      createIndividualAction.mockImplementation(actualCreationActions.createIndividualAction);
      const user = userEvent.setup({ delay: null });
      view(<CustomerCreateScreen locale={locale} messages={messages} kind="individual" />);
      await user.click(screen.getByRole('button', { name: messages['form.submit'] }));

      const given = labelled(messages, 'crm.customers.create.givenName');
      const family = labelled(messages, 'crm.customers.create.familyName');
      await waitFor(() => expect(given).toHaveAttribute('aria-invalid', 'true'));
      expect(family).toHaveAttribute('aria-invalid', 'true');
      for (const control of [given, family]) {
        const errorId = control.getAttribute('aria-errormessage');
        expect(errorId).toBeTruthy();
        expect(document.getElementById(errorId ?? '')).toHaveTextContent(
          messages['field.required']
        );
      }
      expect(createIndividualAction).toHaveBeenCalledTimes(1);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it(`refuses an empty legal name in the action, before any request (${locale})`, async () => {
      createCompanyAction.mockImplementation(actualCreationActions.createCompanyAction);
      const user = userEvent.setup({ delay: null });
      view(<CustomerCreateScreen locale={locale} messages={messages} kind="company" />);
      await user.click(screen.getByRole('button', { name: messages['form.submit'] }));

      const legal = labelled(messages, 'crm.customers.create.legalName');
      await waitFor(() => expect(legal).toHaveAttribute('aria-invalid', 'true'));
      expect(
        document.getElementById(legal.getAttribute('aria-errormessage') ?? '')
      ).toHaveTextContent(messages['field.required']);
      expect(labelled(messages, 'crm.customers.create.tradeName')).not.toHaveAttribute(
        'aria-invalid'
      );
      expect(createCompanyAction).toHaveBeenCalledTimes(1);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it(`disables the submit button and marks it busy while saving (${locale})`, async () => {
      const pending = deferred<ReturnType<typeof successState>>();
      createIndividualAction.mockReturnValue(pending.promise);
      const user = userEvent.setup({ delay: null });
      view(<CustomerCreateScreen locale={locale} messages={messages} kind="individual" />);
      await user.type(labelled(messages, 'crm.customers.create.givenName'), 'Nadia');
      await user.type(labelled(messages, 'crm.customers.create.familyName'), 'Khoury');
      await user.click(screen.getByRole('button', { name: messages['form.submit'] }));

      const busy = await screen.findByRole('button', { name: messages['form.saving'] });
      expect(busy).toBeDisabled();
      expect(busy).toHaveAttribute('aria-busy', 'true');

      pending.resolve(successState());
      expect(
        await screen.findByRole('link', { name: messages['crm.customers.create.openCreated'] })
      ).toBeInTheDocument();
    });
  }

  it('keeps the outcome links as links, with Arabic hrefs', async () => {
    createIndividualAction.mockResolvedValue(
      successState({
        possibleDuplicates: [{ id: 'other-1', displayName: 'نادية خوري', displayNumber: 'C-0007' }],
      })
    );
    const user = userEvent.setup({ delay: null });
    renderRtl(<CustomerCreateScreen locale="ar" messages={ar} kind="individual" />);
    await user.type(labelled(ar, 'crm.customers.create.givenName'), 'نادية');
    await user.type(labelled(ar, 'crm.customers.create.familyName'), 'خوري');
    await user.click(screen.getByRole('button', { name: ar['form.submit'] }));

    expect(
      await screen.findByRole('link', { name: ar['crm.customers.create.openCreated'] })
    ).toHaveAttribute('href', `/ar/crm/customers/${CREATED.customerId}`);
    expect(
      screen.getByRole('link', { name: ar['crm.customers.create.backToSearch'] })
    ).toHaveAttribute('href', '/ar/crm/customers');
    expect(screen.getByRole('link', { name: 'نادية خوري' })).toHaveAttribute(
      'href',
      '/ar/crm/customers/other-1'
    );
    // Neither outcome action is drawn as a button.
    expect(
      screen.queryByRole('button', { name: ar['crm.customers.create.openCreated'] })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: ar['crm.customers.create.backToSearch'] })
    ).toBeNull();
  });
});
