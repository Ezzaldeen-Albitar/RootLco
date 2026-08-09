import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CatalogueResult } from '@/features/vehicles/catalogue-api';

/**
 * The vehicle creation journey (`P1-27-FE-018`).
 *
 * ## The defect
 *
 * The screen held the identifier of the record it had just created and threw it
 * away. `createVehicleAction` returns `created.vehicleId`, `CreationOutcome`
 * receives it, and it rendered three other fields while ignoring it — the only
 * exit being "Add another vehicle", which reloads the page.
 *
 * So the create journey ended in a dead end: to reach the vehicle you had just
 * added you had to leave the screen, open Vehicles, and search for it. That is
 * the same class of defect `FE-019` fixed on the search leg, on the other leg of
 * the same journey, and the sibling customer screen has offered both links since
 * it shipped.
 *
 * ## Why nothing caught it
 *
 * No test rendered this component. Every FE-018 test named in the traceability
 * record exercises `createVehicleAction` or `validateVehicleCreate` — the
 * adapter and the validator. A component with no rendering test cannot fail for
 * a missing link, a discarded id, or a lost form value.
 *
 * ## What is NOT here
 *
 * No catalogue expansion. The Owner's eventual requirement runs Make → Model
 * Year → Model → Generation → Trim → Body Type → Powertrain; what the P1-27
 * contract publishes today is Make, Model, Trim, Body type and Powertrain, and
 * this file asserts the flow that exists rather than inventing the rest. The
 * remainder belongs to the Owner carry-forward register for a catalogue phase.
 */

const createVehicleAction = vi.fn();
const checkVinAvailability = vi.fn();
const listModels = vi.fn();
const listTrims = vi.fn();

vi.mock('@/features/vehicles/api', () => ({
  createVehicleAction: (...a: unknown[]) => createVehicleAction(...a),
}));
vi.mock('@/features/vehicles/profile-api', () => ({
  checkVinAvailability: (...a: unknown[]) => checkVinAvailability(...a),
}));
vi.mock('@/features/vehicles/catalogue-api', () => ({
  listModels: (...a: unknown[]) => listModels(...a),
  listTrims: (...a: unknown[]) => listTrims(...a),
  listMakes: async () => CATALOGUE,
  listBodyTypes: async () => CATALOGUE,
  listPowertrainTypes: async () => CATALOGUE,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const MAKE_UUID = '11111111-2222-3333-4444-555555555555';
const VEHICLE_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/**
 * A catalogue whose option VALUE is a uuid and whose LABEL is a name.
 *
 * Deliberate: the uuid must reach the form as a submitted value and must never
 * reach the operator as text, and a fixture with a readable value could not tell
 * the difference.
 */
const CATALOGUE: CatalogueResult = {
  status: 'ok',
  options: [{ id: MAKE_UUID, scope: 'platform', code: 'TOYOTA', name: 'Toyota', status: 'active' }],
  truncated: false,
  correlationId: 'cid',
};

const { VehicleCreateScreen } = await import('@/features/vehicles/components/VehicleCreateScreen');

function successState() {
  return {
    status: 'success',
    messageKey: 'vehicles.create.created',
    attempt: 1,
    created: {
      vehicleId: VEHICLE_UUID,
      lifecycleStatus: 'draft',
      powertrainCategory: 'combustion',
      hasVin: true,
    },
  };
}

beforeEach(() => {
  for (const fn of [createVehicleAction, checkVinAvailability, listModels, listTrims]) {
    fn.mockReset();
  }
  createVehicleAction.mockResolvedValue({ status: 'idle' });
  checkVinAvailability.mockResolvedValue({ verdict: 'available', holderId: null });
  listModels.mockResolvedValue(CATALOGUE);
  listTrims.mockResolvedValue(CATALOGUE);
});

function render(locale: 'en' | 'ar' = 'en') {
  const messages = locale === 'en' ? en : ar;
  const view = locale === 'en' ? renderLtr : renderRtl;
  return view(
    <VehicleCreateScreen
      locale={locale}
      messages={messages}
      makes={CATALOGUE}
      bodyTypes={CATALOGUE}
      powertrainTypes={CATALOGUE}
    />
  );
}

async function submit(locale: 'en' | 'ar' = 'en') {
  const messages = locale === 'en' ? en : ar;
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: messages['vehicles.create.submit'] }));
}

describe('a failed creation keeps what the operator chose', () => {
  it('keeps the catalogue selections and the powertrain category', async () => {
    /*
     * `R-02` — `NEW-FE-01`'s second site.
     *
     * All six selects on this form were controlled `value=` + `onChange` with no
     * `key`, inside `<form action={submit}>`. That is verbatim the shape this
     * branch's own comment records as measured NOT to work
     * (`CustomerCreateScreen.tsx:197-207`: "Making it a controlled `value={…}`
     * field … DID NOT FIX IT"), and the comment at :218 says the hole exists
     * "wherever a `<select>` sits in a `<form action={…}>`". `NEW-FE-01` was then
     * closed against `RecordForm` alone, and this screen owns its own form.
     *
     * A vehicle arriving at a workshop is described from its papers: Make,
     * Model, Trim, Body type, Powertrain. Losing five dropdowns to a transient
     * 503 while the typed VIN survives is a form that looks like it kept the
     * operator's work and did not.
     *
     * The Make is asserted by its uuid VALUE — the fixture's label is a name and
     * its value is a uuid precisely so the two cannot be confused.
     */
    createVehicleAction.mockResolvedValue({
      status: 'unavailable',
      messageKey: 'state.unavailable.title',
      correlationId: 'corr-create-1',
      attempt: 1,
    });
    const user = userEvent.setup();
    render();

    /*
     * By submitted NAME, not by label. "Powertrain" is the visible label of two
     * different controls here — the broad category and the specific type — and
     * the name is what reaches the request anyway.
     */
    const field = (name: string) => {
      const el = document.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
      expect(el, `${name} is not on the form`).not.toBeNull();
      return el as HTMLSelectElement;
    };
    const make = () => field('makeId');
    const category = () => field('powertrainCategory');

    await user.selectOptions(make(), MAKE_UUID);
    await user.selectOptions(category(), 'ev');
    await submit();

    await waitFor(() => expect(createVehicleAction).toHaveBeenCalledTimes(1));

    expect(make(), 'the chosen Make was discarded by the failure').toHaveValue(MAKE_UUID);
    expect(category(), 'the chosen powertrain category was discarded').toHaveValue('ev');
  });
});

describe('the created vehicle is reachable from the screen that created it', () => {
  it('links to the new vehicle by its returned id', async () => {
    createVehicleAction.mockResolvedValue(successState());
    render();
    await submit();

    const link = await screen.findByRole('link', {
      name: en['vehicles.create.openCreated'],
    });
    // The id the action returned, not a search URL and not a reload.
    expect(link).toHaveAttribute('href', `/en/vehicles/${VEHICLE_UUID}`);
  });

  it('also offers the way back to search, like the customer screen does', async () => {
    createVehicleAction.mockResolvedValue(successState());
    render();
    await submit();
    expect(
      await screen.findByRole('link', { name: en['vehicles.create.backToSearch'] })
    ).toHaveAttribute('href', '/en/vehicles');
  });

  it('keeps "add another", because creating a batch is a real workflow', async () => {
    createVehicleAction.mockResolvedValue(successState());
    render();
    await submit();
    await screen.findByRole('link', { name: en['vehicles.create.openCreated'] });
    expect(screen.getByRole('button', { name: en['vehicles.create.another'] })).toBeInTheDocument();
  });

  it('links correctly in Arabic, with the locale in the path', async () => {
    createVehicleAction.mockResolvedValue(successState());
    render('ar');
    await submit('ar');
    const link = await screen.findByRole('link', { name: ar['vehicles.create.openCreated'] });
    expect(link).toHaveAttribute('href', `/ar/vehicles/${VEHICLE_UUID}`);
  });
});

describe('no identifier is shown to the operator', () => {
  it('renders no uuid on the success card, including the one it links to', async () => {
    createVehicleAction.mockResolvedValue(successState());
    const { container } = render();
    await submit();
    await screen.findByRole('link', { name: en['vehicles.create.openCreated'] });
    // An href may carry it — that is a URL, not a label. The TEXT may not.
    expect(container.textContent ?? '').not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
  });

  it('shows the make by name while submitting its id', async () => {
    const { container } = render();
    // The catalogue option's value is a uuid and its label is a name.
    expect(container.textContent ?? '').toContain('Toyota');
    expect(container.textContent ?? '').not.toContain(MAKE_UUID);
    const option = container.querySelector(`option[value="${MAKE_UUID}"]`);
    expect(option, 'the id must still be the submitted value').not.toBeNull();
  });

  it('reports whether a VIN was recorded rather than echoing it', async () => {
    // A VIN is `internal`-classified and the response does not return it. The
    // card must not invent one from the form either.
    createVehicleAction.mockResolvedValue(successState());
    const { container } = render();
    await submit();
    await screen.findByRole('link', { name: en['vehicles.create.openCreated'] });
    expect(container.textContent ?? '').toContain(en['vehicles.create.vinRecorded']);
  });
});

describe('a rejected submit does not discard the operator work', () => {
  it('keeps the typed values', async () => {
    createVehicleAction.mockResolvedValue({
      status: 'invalid',
      attempt: 1,
      fieldErrors: { displayNumber: 'field.tooLong' },
    });
    const user = userEvent.setup();
    render();
    await user.type(screen.getByLabelText(en['vehicles.column.reference']), 'REF-1');
    await submit();
    await screen.findByText(en['field.tooLong']);
    // React resets an UNCONTROLLED form once a Server Action completes, which
    // would turn a rejected submit into "type it all again".
    expect(screen.getByLabelText(en['vehicles.column.reference'])).toHaveValue('REF-1');
  });

  it('shows the field error against its own field', async () => {
    createVehicleAction.mockResolvedValue({
      status: 'invalid',
      attempt: 1,
      fieldErrors: { displayNumber: 'field.tooLong' },
    });
    render();
    await submit();
    expect(await screen.findByText(en['field.tooLong'])).toBeInTheDocument();
  });
});

describe('the catalogue is dependent, because the database requires it', () => {
  it('loads models for the chosen make', async () => {
    const user = userEvent.setup();
    render();
    await user.selectOptions(screen.getByLabelText(en['vehicles.column.make']), MAKE_UUID);
    await waitFor(() => expect(listModels).toHaveBeenCalledWith(MAKE_UUID));
  });

  it('clears the model when the make changes, so no incoherent pair is submitted', async () => {
    // `mapWriteConflict` turns a stale model id alongside a new make into a 422
    // the operator cannot diagnose. Clearing happens at the event, not in an
    // effect, because the effect runs too late to prevent the submit.
    const user = userEvent.setup();
    const { container } = render();
    const make = screen.getByLabelText(en['vehicles.column.make']);
    await user.selectOptions(make, MAKE_UUID);
    await waitFor(() => expect(listModels).toHaveBeenCalled());

    const model = container.querySelector('select[name="modelId"]') as HTMLSelectElement | null;
    expect(model).not.toBeNull();
    await user.selectOptions(model as HTMLSelectElement, MAKE_UUID);
    expect((model as HTMLSelectElement).value).toBe(MAKE_UUID);

    await user.selectOptions(make, '');
    expect((container.querySelector('select[name="modelId"]') as HTMLSelectElement).value).toBe('');
  });
});

describe('this file is not vacuous', () => {
  it('really renders the component, which no previous test did', () => {
    const { container } = render();
    expect(container.querySelector('form')).not.toBeNull();
    expect(screen.getByRole('button', { name: en['vehicles.create.submit'] })).toBeInTheDocument();
  });

  it('asserts against copy present in both catalogues and different between them', () => {
    for (const key of ['vehicles.create.openCreated', 'vehicles.create.backToSearch']) {
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(ar), key).toContain(key);
      expect((en as Record<string, string>)[key]).not.toBe((ar as Record<string, string>)[key]);
    }
  });
});
