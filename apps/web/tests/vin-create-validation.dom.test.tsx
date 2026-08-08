import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CatalogueResult } from '@/features/vehicles/catalogue-api';

/**
 * VIN validation on the CREATE journey (`P1-27-FE-020`).
 *
 * ## The defect
 *
 * The canonical row for `FE-020` names `veh.vehicle-create` FIRST, and the
 * create path had none of it. `VinField` — which already implements the four
 * verdicts the canonical plan calls for — was mounted in exactly ONE place:
 * `VehicleProfileScreen`'s `veh.vehicle-update` panel. The create form rendered
 * the VIN as a plain `TextField`, so an operator creating a vehicle got:
 *
 *   - no format feedback,
 *   - no uniqueness preview,
 *   - and, on a VIN that already exists, the server's `409 ERR-RES-002` arriving
 *     as the generic `state.conflict.title` — "Someone else changed this" —
 *     which is not what happened and is not something they can act on.
 *
 * ## What is NOT invented here
 *
 * No 17-character refusal: `veh.vehicles.vin_raw` is `text` with a length bound
 * and no format CHECK, so the platform accepts older, imported and non-road
 * vehicles. A non-standard length is reported as an OBSERVATION, never a
 * refusal, and this file asserts that distinction because getting it wrong would
 * refuse vehicles the database is happy to hold.
 *
 * No check-digit arithmetic, no I/O/Q exclusion, no decode, and no external
 * verification service — `veh.vin_verifications` is a table no code reads or
 * writes, and the canonical plan puts that workflow outside P1-27.
 *
 * ## The fourth verdict is the point
 *
 * `unavailable` must never read as `available`. A uniqueness check that could
 * not run is its own answer; collapsing it would present a VIN that is in fact
 * taken as free to use.
 */

const checkVinAvailability = vi.fn();
const createVehicleAction = vi.fn();
const listMakes = vi.fn();
const listModels = vi.fn();
const listTrims = vi.fn();

vi.mock('@/features/vehicles/profile-api', () => ({
  checkVinAvailability: (...a: unknown[]) => checkVinAvailability(...a),
}));
vi.mock('@/features/vehicles/api', () => ({
  createVehicleAction: (...a: unknown[]) => createVehicleAction(...a),
}));
vi.mock('@/features/vehicles/catalogue-api', () => ({
  listMakes: (...a: unknown[]) => listMakes(...a),
  listModels: (...a: unknown[]) => listModels(...a),
  listTrims: (...a: unknown[]) => listTrims(...a),
  listBodyTypes: async () => EMPTY_CATALOGUE,
  listPowertrainTypes: async () => EMPTY_CATALOGUE,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/**
 * `CatalogueResult`, not a row array.
 *
 * The catalogue reads are separate operations that can each fail on their own,
 * so the screen receives a status alongside the options. An empty catalogue is a
 * successful read that returned nothing — deliberately used here, because this
 * file is about the VIN and a populated catalogue would only add noise.
 */
const EMPTY_CATALOGUE: CatalogueResult = {
  status: 'ok',
  options: [],
  truncated: false,
  correlationId: 'cid',
};

const { VehicleCreateScreen } = await import('@/features/vehicles/components/VehicleCreateScreen');
const { VinField } = await import('@/features/vehicles/components/VinField');

beforeEach(() => {
  for (const fn of [checkVinAvailability, createVehicleAction, listMakes, listModels, listTrims]) {
    fn.mockReset();
  }
  listMakes.mockResolvedValue(EMPTY_CATALOGUE);
  listModels.mockResolvedValue(EMPTY_CATALOGUE);
  listTrims.mockResolvedValue(EMPTY_CATALOGUE);
  createVehicleAction.mockResolvedValue({ status: 'idle' });
  checkVinAvailability.mockResolvedValue({ verdict: 'available', holderId: null });
});

function render(locale: 'en' | 'ar' = 'en') {
  const messages = locale === 'en' ? en : ar;
  const view = locale === 'en' ? renderLtr : renderRtl;
  return view(
    <VehicleCreateScreen
      locale={locale}
      messages={messages}
      makes={EMPTY_CATALOGUE}
      bodyTypes={EMPTY_CATALOGUE}
      powertrainTypes={EMPTY_CATALOGUE}
    />
  );
}

/** The VIN box, found by its label rather than by a test id. */
function vinInput(locale: 'en' | 'ar' = 'en') {
  const label = (locale === 'en' ? en : ar)['vehicles.create.vin'];
  return screen.getByLabelText(label);
}

function checkButton(locale: 'en' | 'ar' = 'en') {
  const label = (locale === 'en' ? en : ar)['vehicles.vin.check'];
  return screen.getByRole('button', { name: label });
}

describe('the create form carries the canonical VIN control', () => {
  it('offers the uniqueness check, which the plain text box never did', () => {
    render();
    expect(vinInput()).toBeInTheDocument();
    // The control that did not exist on this screen before.
    expect(checkButton()).toBeInTheDocument();
  });

  it('asks the server only on explicit request, never on a keystroke', async () => {
    // `veh.vehicle-search` is `expensive-read` at 30/min. A check-as-you-type
    // would exhaust it in seconds and, because the match is exact, would answer
    // "available" for every prefix of a VIN that is taken.
    const user = userEvent.setup();
    render();
    await user.type(vinInput(), 'JH4KA7561PC008269');
    expect(checkVinAvailability).not.toHaveBeenCalled();

    await user.click(checkButton());
    await waitFor(() => expect(checkVinAvailability).toHaveBeenCalledTimes(1));
  });

  it('excludes no vehicle, because on create there is no own VIN to excuse', async () => {
    const user = userEvent.setup();
    render();
    await user.type(vinInput(), 'JH4KA7561PC008269');
    await user.click(checkButton());
    await waitFor(() => expect(checkVinAvailability).toHaveBeenCalled());
    // The second argument is `excludeVehicleId`. Passing a value here would
    // silence a genuine conflict.
    expect(checkVinAvailability.mock.calls[0]?.[1]).toBeNull();
  });
});

describe('the four verdicts stay apart', () => {
  it('AVAILABLE says so', async () => {
    const user = userEvent.setup();
    render();
    await user.type(vinInput(), 'JH4KA7561PC008269');
    await user.click(checkButton());
    expect(await screen.findByText(en['vehicles.vin.available'])).toBeInTheDocument();
  });

  it('CONFLICT names a conflict, not a generic failure', async () => {
    checkVinAvailability.mockResolvedValue({ verdict: 'duplicate', holderId: 'v-9' });
    const user = userEvent.setup();
    const { container } = render();
    await user.type(vinInput(), 'JH4KA7561PC008269');
    await user.click(checkButton());
    expect(await screen.findByText(en['vehicles.vin.duplicate'])).toBeInTheDocument();
    // Emphatically NOT the generic conflict copy the create path used to show.
    expect(container.textContent ?? '').not.toContain(en['state.conflict.title']);
    // And never the id of the vehicle that holds it.
    expect(container.textContent ?? '').not.toContain('v-9');
  });

  it('UNAVAILABLE is not AVAILABLE, which is the whole reason it exists', async () => {
    checkVinAvailability.mockResolvedValue({ verdict: 'unavailable', holderId: null });
    const user = userEvent.setup();
    const { container } = render();
    await user.type(vinInput(), 'JH4KA7561PC008269');
    await user.click(checkButton());
    expect(await screen.findByText(en['vehicles.vin.checkUnavailable'])).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toContain(en['vehicles.vin.available']);
    expect(text).not.toContain(en['vehicles.vin.duplicate']);
  });

  it('INVALID is decided locally and never spends a request', async () => {
    const user = userEvent.setup();
    render();
    // No alphanumeric character at all — the one format rule the platform has.
    await user.type(vinInput(), '---');
    await user.click(checkButton());
    expect(await screen.findByText(en['vehicles.vin.invalidFormat'])).toBeInTheDocument();
    expect(checkVinAvailability).not.toHaveBeenCalled();
  });
});

describe('a non-standard length is an observation, never a refusal', () => {
  it('notes a short VIN and still allows the check to run', async () => {
    const user = userEvent.setup();
    render();
    await user.type(vinInput(), 'ABC123');
    expect(screen.getByText(en['vehicles.vin.nonStandardLength'])).toBeInTheDocument();

    // The decisive half: it is a note, not a block. Older, imported and non-road
    // vehicles do not carry a 17-character VIN and the database accepts them.
    await user.click(checkButton());
    await waitFor(() => expect(checkVinAvailability).toHaveBeenCalledTimes(1));
  });

  it('says nothing about length for a 17-character VIN', async () => {
    const user = userEvent.setup();
    const { container } = render();
    await user.type(vinInput(), 'JH4KA7561PC008269');
    expect(container.textContent ?? '').not.toContain(en['vehicles.vin.nonStandardLength']);
  });
});

describe('a verdict never outlives the value it was about', () => {
  it('clears when the VIN is edited', async () => {
    const user = userEvent.setup();
    const { container } = render();
    await user.type(vinInput(), 'JH4KA7561PC008269');
    await user.click(checkButton());
    await screen.findByText(en['vehicles.vin.available']);

    await user.type(vinInput(), 'X');
    // A stale "available" beside a changed VIN is worse than showing nothing.
    expect(container.textContent ?? '').not.toContain(en['vehicles.vin.available']);
  });
});

describe('the server keeps the last word', () => {
  it('renders the write rejection against the VIN field itself', async () => {
    // The 409 the create used to render as "Someone else changed this".
    createVehicleAction.mockResolvedValue({
      status: 'invalid',
      attempt: 1,
      fieldErrors: { vin: 'field.required' },
    });
    const user = userEvent.setup();
    render();
    await user.type(vinInput(), 'JH4KA7561PC008269');
    await user.click(screen.getByRole('button', { name: en['vehicles.create.submit'] }));

    const message = await screen.findByText(en['field.required']);
    expect(message).toBeInTheDocument();
    // Wired, not merely rendered: an error a screen reader cannot reach from the
    // control is an error only sighted operators get.
    expect(vinInput()).toHaveAttribute('aria-invalid', 'true');
    expect(vinInput().getAttribute('aria-errormessage')).toBe(message.id);
  });

  it('preserves what the operator typed across a rejected submit', async () => {
    createVehicleAction.mockResolvedValue({
      status: 'invalid',
      attempt: 1,
      fieldErrors: { vin: 'field.required' },
    });
    const user = userEvent.setup();
    render();
    await user.type(vinInput(), 'JH4KA7561PC008269');
    await user.click(screen.getByRole('button', { name: en['vehicles.create.submit'] }));
    await screen.findByText(en['field.required']);
    // Retyping a VIN because the form threw it away is the failure this guards.
    expect(vinInput()).toHaveValue('JH4KA7561PC008269');
  });
});

describe('VinField on its own, not through a screen', () => {
  /*
   * `VinField` was named in this file's docblock and imported by no test —
   * mounted only inside `VehicleCreateScreen` and `VehicleProfileScreen`. That
   * is enough to exercise it, but not enough for the QA-001 inventory to SEE it,
   * and the inventory's substring sweep then counted the docblock mention as
   * coverage. Two of its properties are also invisible through a screen: the
   * `excludeVehicleId` it is given on the PROFILE path (a vehicle's own VIN is
   * not a conflict), and the fact that editing clears a stale verdict.
   */
  function Harness({ exclude }: { readonly exclude: string | null }) {
    const [value, setValue] = useState('');
    return (
      <VinField
        messages={en}
        id="vin-under-test"
        value={value}
        onChange={setValue}
        maxLength={64}
        excludeVehicleId={exclude}
      />
    );
  }

  it('passes the vehicle being edited through as the exclusion', async () => {
    const user = userEvent.setup();
    renderLtr(<Harness exclude="veh-1" />);
    await user.type(vinInput(), 'JH4KA7561PC008269');
    await user.click(checkButton());
    await waitFor(() => expect(checkVinAvailability).toHaveBeenCalled());
    // On the profile path the vehicle's OWN VIN must not read as a duplicate.
    expect(checkVinAvailability).toHaveBeenCalledWith('JH4KA7561PC008269', 'veh-1');
  });

  it('clears a stale verdict the moment the VIN changes', async () => {
    checkVinAvailability.mockResolvedValue({ verdict: 'available', holderId: null });
    const user = userEvent.setup();
    renderLtr(<Harness exclude={null} />);
    await user.type(vinInput(), 'JH4KA7561PC008269');
    await user.click(checkButton());
    expect(await screen.findByText(en['vehicles.vin.available'])).toBeInTheDocument();

    // "Available" beside a VIN that is no longer the one that was checked is
    // worse than showing nothing.
    await user.type(vinInput(), 'X');
    expect(screen.queryByText(en['vehicles.vin.available'])).toBeNull();
  });

  it('renders the server error wired to the input', () => {
    renderLtr(
      <VinField
        messages={en}
        id="vin-with-error"
        value="JH4KA7561PC008269"
        onChange={() => {}}
        maxLength={64}
        excludeVehicleId={null}
        error="vehicles.vin.duplicate"
      />
    );
    const input = screen.getByLabelText(en['vehicles.create.vin']);
    const message = screen.getByText(en['vehicles.vin.duplicate']);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-errormessage')).toBe(message.id);
  });

  it('refuses to check an empty VIN at all', () => {
    renderLtr(<Harness exclude={null} />);
    // Disabled rather than answering "available" for the empty string, which is
    // what an unguarded exact match would have done.
    expect(checkButton()).toBeDisabled();
  });
});

describe('Arabic', () => {
  it('offers the same control and the same verdicts', async () => {
    checkVinAvailability.mockResolvedValue({ verdict: 'duplicate', holderId: null });
    const user = userEvent.setup();
    render('ar');
    expect(document.documentElement.dir).toBe('rtl');
    await user.type(vinInput('ar'), 'JH4KA7561PC008269');
    await user.click(checkButton('ar'));
    expect(await screen.findByText(ar['vehicles.vin.duplicate'])).toBeInTheDocument();
  });

  it('renders the VIN box left-to-right inside a right-to-left page', () => {
    render('ar');
    // A VIN is a Latin identifier. Rendered RTL it reads backwards.
    expect(vinInput('ar')).toHaveAttribute('dir', 'ltr');
  });
});

describe('this file is not vacuous', () => {
  it('asserts against copy that exists in both catalogues', () => {
    for (const key of [
      'vehicles.vin.available',
      'vehicles.vin.duplicate',
      'vehicles.vin.invalidFormat',
      'vehicles.vin.checkUnavailable',
      'vehicles.vin.nonStandardLength',
      'vehicles.vin.check',
      'vehicles.create.vin',
    ]) {
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(ar), key).toContain(key);
      expect((en as Record<string, string>)[key]).not.toBe((ar as Record<string, string>)[key]);
    }
    // The four verdicts must read differently, or "not available" assertions
    // above would pass against identical strings.
    const verdicts = new Set([
      en['vehicles.vin.available'],
      en['vehicles.vin.duplicate'],
      en['vehicles.vin.invalidFormat'],
      en['vehicles.vin.checkUnavailable'],
    ]);
    expect(verdicts.size).toBe(4);
  });
});
