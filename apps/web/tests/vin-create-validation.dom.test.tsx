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
/*
 * The transport, for the last section of this file only.
 *
 * A REAL `ApiClient` over a stubbed `fetch`, so the status-to-kind mapping and
 * `fromFailure` run as shipped when a duplicate VIN comes back as a 409. Every
 * other case here drives `createVehicleAction` through the module mock above and
 * never reaches this.
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

/**
 * The REAL create adapter, kept beside the spy that stands in for it.
 *
 * `vi.mock` above replaces the module for the whole file. The last section needs
 * the shipped `createVehicleAction` so a real 409 can travel the whole way, so
 * the spy is pointed at this implementation there and left at
 * `mockResolvedValue` everywhere else — the same arrangement
 * `vehicle-profile-lifecycle.dom.test.tsx` uses, and for the same reason: a
 * second file rendering the same screen would put its cases in two places.
 */
const actualVehicleApi =
  await vi.importActual<typeof import('@/features/vehicles/api')>('@/features/vehicles/api');

beforeEach(() => {
  fetchImpl.mockReset();
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
  it('renders a local validation rejection against the VIN field itself', async () => {
    // `status: 'invalid'` with `fieldErrors.vin` is what a LOCAL Zod failure
    // produces. The 409 case is the one below, and this label used to claim to
    // be it while mocking a state a 409 never reaches.
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

/**
 * The duplicate-VIN 409 this file's header describes, driven for real.
 *
 * ## Why it was not proved before
 *
 * The header above names the defect precisely — "on a VIN that already exists,
 * the server's `409 ERR-RES-002` arriving as the generic `state.conflict.title`
 * — 'Someone else changed this'" — and every case in this file mocks
 * `createVehicleAction`, so none of them could ever see a 409. The fix lives in
 * `api.ts:177-181`, which replaces the generic conflict key with
 * `vehicles.create.conflict`, and nothing rendered it. A message key with no
 * render site is the same non-fix as a parse with no render site.
 *
 * ## What runs for real here
 *
 * Everything except the socket: the shipped `createVehicleAction`, its Zod
 * schema, a real `ApiClient` from `@/lib/api/server-client`, the real
 * status-to-kind mapping, `fromFailure`, and the mounted screen.
 *
 * ## The sentence is deliberately vague, and that is the correction
 *
 * `veh.vehicles` carries two tenant-scoped unique indexes — one on the
 * normalised VIN, one on the display number — and `mapWriteConflict` branches on
 * SQLSTATE alone without reading the constraint name. So `ERR-RES-002` cannot
 * say which value collided, and the copy names both fields as candidates rather
 * than accusing the VIN. These cases assert that the message does NOT single out
 * the VIN, because a wrong specific answer is worse than a right vague one.
 *
 * ## What this block does NOT cover, stated so nobody infers it does
 *
 * It does not exercise `failureMessageKey`'s two-way split of a 409. Measured,
 * not assumed: collapsing that function to `FAILURE_MESSAGE_KEY[failure.kind]`
 * leaves all seven cases here green, because `api.ts:177-181` overrides the key
 * for every conflict on this operation before the screen ever sees it. The split
 * is covered by `a real 409 reaches the screen as the sentence that fits its
 * cause` in `vehicle-profile-lifecycle.dom.test.tsx`, where six cases fail under
 * that mutation.
 *
 * The override is right for this operation — `POST /vehicles` sends no
 * `If-Match`, so there is no version race for `ERR-CON-001` to report — but a
 * reader counting 409 cases would otherwise credit this file with a proof it
 * does not carry.
 */
describe('a duplicate on create is reported as a duplicate, not as a race', () => {
  const CONFLICT = en['vehicles.create.conflict'];
  const VIN_VALUE = 'JH4KA7561PC008269';

  /** A backend-shaped `application/problem+json` 409. */
  function conflict(code: string): void {
    fetchImpl.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: `https://errors.example.test/${code}`,
          title: 'Resource conflict',
          status: 409,
          code,
          correlationId: 'corr-create-fixture',
        }),
        { status: 409, headers: { 'content-type': 'application/problem+json' } }
      )
    );
  }

  beforeEach(() => {
    createVehicleAction.mockImplementation(actualVehicleApi.createVehicleAction);
  });

  /** Type a VIN and submit. Every other field on this form is optional, both in
   *  `validateVehicleCreate` and in the server schema, so a VIN alone is a
   *  request the backend really would accept. */
  async function submit(locale: 'en' | 'ar' = 'en'): Promise<void> {
    // `delay: null` removes userEvent's inter-keystroke delay. It changes no
    // behaviour under test — every event still fires in order — and it keeps this
    // block from pushing the whole web suite past the 5 s per-test default, which
    // it was measured doing to two unrelated files.
    const user = userEvent.setup({ delay: null });
    const messages = locale === 'en' ? en : ar;
    await user.type(vinInput(locale), VIN_VALUE);
    await user.click(screen.getByRole('button', { name: messages['vehicles.create.submit'] }));
  }

  it('sends the VIN and renders the duplicate sentence, not the concurrency one', async () => {
    conflict('ERR-RES-002');
    const { container } = render();
    await submit();

    // The request really happened, and carried the VIN. Without this the case
    // would be satisfied by a form that never submitted at all.
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const [url, init] = fetchImpl.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://api.test/api/v1/vehicles');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ vin: VIN_VALUE });

    await waitFor(() => expect(screen.getByText(CONFLICT, { exact: false })).toBeTruthy());
    const text = container.textContent ?? '';
    // The exact sentence this file's header says an operator used to be given.
    expect(text).not.toContain(en['state.conflict.title']);
    expect(text).not.toContain(en['state.conflict.blocked.title']);
  });

  it('does not accuse the VIN, because the response cannot say which value collided', async () => {
    /*
     * A duplicate operator-typed REFERENCE NUMBER raises the same `23505`,
     * becomes the same `ERR-RES-002`, and would once have been rendered beside
     * the VIN field about a value the operator did not duplicate. The message
     * must therefore stay at the form level and name both candidates.
     */
    conflict('ERR-RES-002');
    render();
    await submit();

    await waitFor(() => expect(screen.getByText(CONFLICT, { exact: false })).toBeTruthy());
    // Not marked invalid: no violation named this control, or any control.
    expect(vinInput().getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText(en['vehicles.vin.duplicate'])).toBeNull();
  });

  it('renders the duplicate sentence in Arabic', async () => {
    conflict('ERR-RES-002');
    const { container } = render('ar');
    await submit('ar');

    await waitFor(() =>
      expect(screen.getByText(ar['vehicles.create.conflict'], { exact: false })).toBeTruthy()
    );
    expect(container.textContent ?? '').not.toContain(en['vehicles.create.conflict']);
    expect(ar['vehicles.create.conflict']).not.toBe(en['vehicles.create.conflict']);
  });

  it('shows no part of the problem document', async () => {
    conflict('ERR-RES-002');
    const { container } = render();
    await submit();

    await waitFor(() => expect(screen.getByText(CONFLICT, { exact: false })).toBeTruthy());

    // The correlation id on screen is the one the CLIENT sent, never the
    // response-supplied one. Asserted present so this case cannot pass on a
    // screen that rendered no failure.
    const [, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    const text = container.textContent ?? '';
    expect(text).toContain(init.headers['x-correlation-id']);
    for (const leak of [
      'corr-create-fixture',
      'ERR-RES-002',
      'Resource conflict',
      'https://errors.example.test',
      '{',
      'vehicles.create.conflict',
    ]) {
      expect(text, `the response leaked ${leak}`).not.toContain(leak);
    }
  });

  it('keeps the typed VIN after the refusal, so it can be corrected', async () => {
    // A create form that cleared itself on a conflict would make the operator
    // retype every field to fix one value.
    conflict('ERR-RES-002');
    render();
    await submit();

    await waitFor(() => expect(screen.getByText(CONFLICT, { exact: false })).toBeTruthy());
    expect((vinInput() as HTMLInputElement).value).toBe(VIN_VALUE);
  });

  it('renders nothing of the kind when the create succeeds', async () => {
    // The anti-vacuity control for this block.
    fetchImpl.mockResolvedValue(
      new Response(
        JSON.stringify({
          vehicleId: 'a1b2c3d4-0000-4000-8000-000000000001',
          displayNumber: 'V-0001',
          lifecycleStatus: 'draft',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } }
      )
    );
    const { container } = render();
    await submit();

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.textContent ?? '').not.toContain(CONFLICT));
  });

  it('asserts on a sentence that is neither of the generic conflict ones', () => {
    const sentences = [CONFLICT, en['state.conflict.title'], en['state.conflict.blocked.title']];
    for (const message of sentences) {
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    }
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});
