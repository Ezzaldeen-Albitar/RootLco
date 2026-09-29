/**
 * The appointment setup screen in the DOM (Owner decision 2026-09-29): the
 * organisation's own appointment types, booking channels and cancellation reasons.
 *
 * What must be true and cannot be proven by reading the source: that every list
 * starts EMPTY and says so in plain words (nothing preset); that an entry is shown
 * by its name with its status in words, and a shared entry offers no change; that
 * creating sends exactly the two fields and re-reads the list; that a refused field
 * is red, carries its sentence beside it, takes the cursor, keeps what was typed and
 * lets go of its complaint once corrected; that a rename sends the version it was
 * read at, and a conflict offers "Load the latest version", which brings the stored
 * name and version back; that retiring asks first and sends the listed version;
 * that typed work is unsaved work; and that all of it reads in Arabic, right to
 * left, portals included.
 *
 * The adapters are mocked at the module boundary; what they send is proven by the
 * P1-28 drive table and the version-sourcing gate.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { useUnsavedWork } from '@/features/working-context/WorkingContextProvider';
import { getMessages } from '@/i18n/get-messages';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import { inBranch, renderLtr, renderRtl } from './render';

const adapters = vi.hoisted(() => ({
  listManagedAppointmentTypes: vi.fn(),
  listManagedSourceChannels: vi.fn(),
  listManagedCancellationReasons: vi.fn(),
  createAppointmentType: vi.fn(),
  createSourceChannel: vi.fn(),
  createCancellationReason: vi.fn(),
  renameAppointmentType: vi.fn(),
  renameSourceChannel: vi.fn(),
  renameCancellationReason: vi.fn(),
  setAppointmentTypeStatus: vi.fn(),
  setSourceChannelStatus: vi.fn(),
  setCancellationReasonStatus: vi.fn(),
}));
vi.mock('@/features/appointments/catalogue-api', () => adapters);

const { AppointmentSetupScreen } =
  await import('@/features/appointments/components/AppointmentSetupScreen');

interface Entry {
  readonly id: string;
  readonly scope: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}

const ROUTINE: Entry = {
  id: '0e5a0000-0000-4000-8000-000000000001',
  scope: 'tenant',
  code: 'routine',
  name: 'Routine service',
  status: 'active',
  recordVersion: 3,
};
const RETIRED: Entry = {
  id: '0e5a0000-0000-4000-8000-000000000002',
  scope: 'tenant',
  code: 'bodywork',
  name: 'Bodywork estimate',
  status: 'inactive',
  recordVersion: 5,
};
const SHARED: Entry = {
  id: '0e5a0000-0000-4000-8000-000000000003',
  scope: 'platform',
  code: 'shared_default',
  name: 'Shared inspection',
  status: 'active',
  recordVersion: 1,
};

const page = (items: readonly Entry[]) => ({
  status: 'ok' as const,
  data: { items, nextCursor: null, hasMore: false },
  correlationId: null,
});

const SUCCESS = { status: 'success', messageKey: 'appointmentSetup.created', attempt: 1 };

beforeEach(() => {
  for (const fn of Object.values(adapters)) fn.mockReset();
  adapters.listManagedAppointmentTypes.mockResolvedValue(page([]));
  adapters.listManagedSourceChannels.mockResolvedValue(page([]));
  adapters.listManagedCancellationReasons.mockResolvedValue(page([]));
  window.localStorage.clear();
});

/** Reads the shell's unsaved-work registry the way the branch selector does. */
function UnsavedProbe() {
  const work = useUnsavedWork();
  const [answer, setAnswer] = useState('unknown');
  return (
    <>
      <button type="button" onClick={() => setAnswer(String(work.any()))}>
        probe unsaved
      </button>
      <output data-testid="unsaved-answer">{answer}</output>
    </>
  );
}

function withMui(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}

function mount(locale: 'en' | 'ar' = 'en') {
  const messages = locale === 'en' ? en : ar;
  const ui = withMui(
    inBranch(
      <>
        <AppointmentSetupScreen locale={locale} messages={messages} />
        <UnsavedProbe />
      </>,
      { locale }
    ),
    locale
  );
  return locale === 'en' ? renderLtr(ui) : renderRtl(ui);
}

const section = (kind: 'types' | 'channels' | 'reasons') =>
  screen.getByTestId(`appointment-setup-${kind}`);
const typesForm = () => screen.getByTestId('appointment-setup-types-form');
const field = (scope: HTMLElement, label: string) =>
  within(scope).getByLabelText(new RegExp(`^${label}`));

describe('nothing is preset: every list starts empty and says so', () => {
  it('shows the three lists, each empty with an invitation to add the first entry', async () => {
    mount();
    for (const kind of ['types', 'channels', 'reasons'] as const) {
      expect(
        await within(section(kind)).findByTestId(`appointment-setup-${kind}-empty`)
      ).toHaveTextContent(en['appointmentSetup.emptyTitle']);
      expect(within(section(kind)).getByText(en['appointmentSetup.emptyBody'])).toBeVisible();
    }
    expect(
      screen.getByRole('heading', { name: en['appointmentSetup.types.heading'] })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: en['appointmentSetup.channels.heading'] })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: en['appointmentSetup.reasons.heading'] })
    ).toBeInTheDocument();
    // Each list is read from its own management operation, on the first page.
    expect(adapters.listManagedAppointmentTypes).toHaveBeenCalledWith(expect.any(Number), null);
    expect(adapters.listManagedSourceChannels).toHaveBeenCalledWith(expect.any(Number), null);
    expect(adapters.listManagedCancellationReasons).toHaveBeenCalledWith(expect.any(Number), null);
  });

  it('draws a refused read as a refusal, never as an empty list', async () => {
    adapters.listManagedAppointmentTypes.mockResolvedValue({
      status: 'denied',
      correlationId: 'corr-denied',
    });
    mount();
    expect(await within(section('types')).findByText(en['state.denied.title'])).toBeVisible();
    expect(within(section('types')).queryByTestId('appointment-setup-types-empty')).toBeNull();
  });
});

describe('an entry is shown by its name, its status in words', () => {
  it('names each entry, says in use or retired, hides the code, and offers no change to a shared entry', async () => {
    adapters.listManagedAppointmentTypes.mockResolvedValue(page([ROUTINE, RETIRED, SHARED]));
    mount();
    const types = section('types');
    expect(await within(types).findByText(ROUTINE.name, { selector: 'bdi' })).toBeVisible();
    expect(within(types).getByText(RETIRED.name, { selector: 'bdi' })).toBeVisible();
    expect(within(types).getAllByText(en['appointmentSetup.status.active']).length).toBe(2);
    expect(within(types).getByText(en['appointmentSetup.status.inactive'])).toBeVisible();
    // The short reference was asked for once, at creation; it is not the name.
    expect(within(types).queryByText(ROUTINE.code)).toBeNull();
    expect(
      within(types).getByRole('button', {
        name: `${en['appointmentSetup.retire']} ${ROUTINE.name}`,
      })
    ).toBeEnabled();
    expect(
      within(types).getByRole('button', {
        name: `${en['appointmentSetup.restore']} ${RETIRED.name}`,
      })
    ).toBeEnabled();
    expect(within(types).queryByRole('button', { name: new RegExp(SHARED.name) })).toBeNull();
    expect(within(types).queryByTestId('appointment-setup-types-empty')).toBeNull();
  });
});

describe('creating an entry', () => {
  it('sends exactly the name and the short reference, then empties the form and reads the list again', async () => {
    const user = userEvent.setup();
    adapters.createAppointmentType.mockResolvedValue(SUCCESS);
    mount();
    await within(section('types')).findByTestId('appointment-setup-types-empty');
    await user.type(field(typesForm(), en['appointmentSetup.field.name']), 'Routine service');
    await user.type(field(typesForm(), en['appointmentSetup.field.code']), 'routine');
    adapters.listManagedAppointmentTypes.mockResolvedValue(page([ROUTINE]));
    await user.click(within(typesForm()).getByRole('button', { name: en['appointmentSetup.add'] }));

    expect(adapters.createAppointmentType).toHaveBeenCalledWith({
      code: 'routine',
      name: 'Routine service',
    });
    expect(
      await within(section('types')).findByText(ROUTINE.name, { selector: 'bdi' })
    ).toBeVisible();
    expect(field(typesForm(), en['appointmentSetup.field.name'])).toHaveValue('');
    expect(field(typesForm(), en['appointmentSetup.field.code'])).toHaveValue('');
    // The other two lists are their own: nothing was written to them.
    expect(adapters.createSourceChannel).not.toHaveBeenCalled();
    expect(adapters.createCancellationReason).not.toHaveBeenCalled();
  });

  it('marks each missing field red with its sentence beside it, moves the cursor to the first, and lets go once corrected', async () => {
    const user = userEvent.setup();
    mount();
    await within(section('types')).findByTestId('appointment-setup-types-empty');
    await user.click(within(typesForm()).getByRole('button', { name: en['appointmentSetup.add'] }));

    const name = field(typesForm(), en['appointmentSetup.field.name']);
    const code = field(typesForm(), en['appointmentSetup.field.code']);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(within(typesForm()).getAllByText(en['field.required'])).toHaveLength(2);
    await waitFor(() => expect(name).toHaveFocus());
    expect(adapters.createAppointmentType).not.toHaveBeenCalled();

    await user.type(name, 'Routine service');
    expect(name).not.toHaveAttribute('aria-invalid', 'true');
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(within(typesForm()).getAllByText(en['field.required'])).toHaveLength(1);
  });

  it('puts a refused short reference on its own field and keeps everything typed', async () => {
    const user = userEvent.setup();
    // What the adapter answers for ERR-RES-002: the shared blocked conflict, with
    // the field it is about.
    adapters.createCancellationReason.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.blocked.title',
      fieldErrors: { code: 'appointmentSetup.codeTaken' },
      attempt: 1,
    });
    mount();
    const form = screen.getByTestId('appointment-setup-reasons-form');
    await within(section('reasons')).findByTestId('appointment-setup-reasons-empty');
    await user.type(field(form, en['appointmentSetup.field.name']), 'Customer asked');
    await user.type(field(form, en['appointmentSetup.field.code']), 'customer_request');
    await user.click(within(form).getByRole('button', { name: en['appointmentSetup.add'] }));

    const code = field(form, en['appointmentSetup.field.code']);
    expect(await within(form).findByText(en['appointmentSetup.codeTaken'])).toBeVisible();
    expect(code).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(code).toHaveFocus());
    expect(code).toHaveValue('customer_request');
    expect(field(form, en['appointmentSetup.field.name'])).toHaveValue('Customer asked');

    await user.type(code, '_2');
    expect(within(form).queryByText(en['appointmentSetup.codeTaken'])).toBeNull();
  });

  it('treats typed and unsaved work as unsaved, and a stored entry as not', async () => {
    const user = userEvent.setup();
    adapters.createSourceChannel.mockResolvedValue(SUCCESS);
    mount();
    const form = screen.getByTestId('appointment-setup-channels-form');
    await within(section('channels')).findByTestId('appointment-setup-channels-empty');
    await user.click(screen.getByRole('button', { name: 'probe unsaved' }));
    expect(screen.getByTestId('unsaved-answer')).toHaveTextContent('false');

    await user.type(field(form, en['appointmentSetup.field.name']), 'Phone');
    await user.click(screen.getByRole('button', { name: 'probe unsaved' }));
    expect(screen.getByTestId('unsaved-answer')).toHaveTextContent('true');

    await user.type(field(form, en['appointmentSetup.field.code']), 'phone');
    await user.click(within(form).getByRole('button', { name: en['appointmentSetup.add'] }));
    await waitFor(() => expect(field(form, en['appointmentSetup.field.name'])).toHaveValue(''));
    await user.click(screen.getByRole('button', { name: 'probe unsaved' }));
    expect(screen.getByTestId('unsaved-answer')).toHaveTextContent('false');
  });
});

describe('renaming under the version it was read at', () => {
  it('sends the listed version and the new name, then reads the list again', async () => {
    const user = userEvent.setup();
    adapters.listManagedAppointmentTypes.mockResolvedValue(page([ROUTINE]));
    adapters.renameAppointmentType.mockResolvedValue({
      ...SUCCESS,
      messageKey: 'appointmentSetup.renamed',
    });
    mount();
    await user.click(
      await within(section('types')).findByRole('button', {
        name: `${en['appointmentSetup.rename']} ${ROUTINE.name}`,
      })
    );
    const dialog = await screen.findByTestId('appointment-setup-types-rename');
    const name = within(dialog).getByLabelText(new RegExp(`^${en['appointmentSetup.field.name']}`));
    expect(name).toHaveValue(ROUTINE.name);
    await user.clear(name);
    await user.type(name, 'Routine check');
    const reads = adapters.listManagedAppointmentTypes.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: en['appointmentSetup.save'] }));

    expect(adapters.renameAppointmentType).toHaveBeenCalledWith(
      ROUTINE.id,
      ROUTINE.recordVersion,
      'Routine check'
    );
    await waitFor(() => expect(screen.queryByTestId('appointment-setup-types-rename')).toBeNull());
    expect(adapters.listManagedAppointmentTypes.mock.calls.length).toBeGreaterThan(reads);
  });

  it('refuses an empty name on the field, before anything is sent', async () => {
    const user = userEvent.setup();
    adapters.listManagedSourceChannels.mockResolvedValue(page([{ ...ROUTINE, name: 'Phone' }]));
    mount();
    await user.click(
      await within(section('channels')).findByRole('button', {
        name: `${en['appointmentSetup.rename']} Phone`,
      })
    );
    const dialog = await screen.findByTestId('appointment-setup-channels-rename');
    const name = within(dialog).getByLabelText(new RegExp(`^${en['appointmentSetup.field.name']}`));
    await user.clear(name);
    await user.click(within(dialog).getByRole('button', { name: en['appointmentSetup.save'] }));
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText(en['field.required'])).toBeVisible();
    expect(adapters.renameSourceChannel).not.toHaveBeenCalled();
  });

  it('offers "Load the latest version" on a conflict, which brings the stored name and version back', async () => {
    const user = userEvent.setup();
    adapters.listManagedAppointmentTypes.mockResolvedValue(page([ROUTINE]));
    adapters.renameAppointmentType.mockResolvedValueOnce({
      status: 'conflict',
      messageKey: 'state.conflict.message',
      attempt: 1,
    });
    mount();
    await user.click(
      await within(section('types')).findByRole('button', {
        name: `${en['appointmentSetup.rename']} ${ROUTINE.name}`,
      })
    );
    const dialog = await screen.findByTestId('appointment-setup-types-rename');
    const name = within(dialog).getByLabelText(new RegExp(`^${en['appointmentSetup.field.name']}`));
    await user.clear(name);
    await user.type(name, 'Stale edit');
    await user.click(within(dialog).getByRole('button', { name: en['appointmentSetup.save'] }));
    expect(await within(dialog).findByText(en['state.conflict.message'])).toBeVisible();

    // Somebody else renamed it meanwhile: the list now answers the newer record.
    const newer = { ...ROUTINE, name: 'Routine inspection', recordVersion: 4 };
    adapters.listManagedAppointmentTypes.mockResolvedValue(page([newer]));
    await user.click(within(dialog).getByRole('button', { name: en['form.loadLatest'] }));
    await waitFor(() => expect(name).toHaveValue('Routine inspection'));

    adapters.renameAppointmentType.mockResolvedValueOnce(SUCCESS);
    await user.clear(name);
    await user.type(name, 'Routine check');
    await user.click(within(dialog).getByRole('button', { name: en['appointmentSetup.save'] }));
    // The retry is based on what is stored now, at the version the refresh brought.
    expect(adapters.renameAppointmentType).toHaveBeenLastCalledWith(ROUTINE.id, 4, 'Routine check');
  });
});

describe('retiring and restoring ask first', () => {
  it('retires with the listed version after the question is answered, and re-reads the list', async () => {
    const user = userEvent.setup();
    adapters.listManagedCancellationReasons.mockResolvedValue(page([ROUTINE]));
    adapters.setCancellationReasonStatus.mockResolvedValue({
      ...SUCCESS,
      messageKey: 'appointmentSetup.retired',
    });
    mount();
    await user.click(
      await within(section('reasons')).findByRole('button', {
        name: `${en['appointmentSetup.retire']} ${ROUTINE.name}`,
      })
    );
    const confirm = await screen.findByTestId('appointment-setup-reasons-confirm');
    expect(adapters.setCancellationReasonStatus).not.toHaveBeenCalled();
    adapters.listManagedCancellationReasons.mockResolvedValue(
      page([{ ...ROUTINE, status: 'inactive', recordVersion: 4 }])
    );
    await user.click(within(confirm).getByRole('button', { name: en['appointmentSetup.retire'] }));

    expect(adapters.setCancellationReasonStatus).toHaveBeenCalledWith(
      ROUTINE.id,
      ROUTINE.recordVersion,
      'inactive'
    );
    expect(
      await within(section('reasons')).findByText(en['appointmentSetup.status.inactive'])
    ).toBeVisible();
  });

  it('changes nothing when the question is declined', async () => {
    const user = userEvent.setup();
    adapters.listManagedSourceChannels.mockResolvedValue(page([RETIRED]));
    mount();
    await user.click(
      await within(section('channels')).findByRole('button', {
        name: `${en['appointmentSetup.restore']} ${RETIRED.name}`,
      })
    );
    const confirm = await screen.findByTestId('appointment-setup-channels-confirm');
    await user.click(within(confirm).getByRole('button', { name: en['overlay.cancel'] }));
    expect(adapters.setSourceChannelStatus).not.toHaveBeenCalled();
  });

  it('says a stale retirement beside the list, with the way to the latest version', async () => {
    const user = userEvent.setup();
    adapters.listManagedAppointmentTypes.mockResolvedValue(page([ROUTINE]));
    adapters.setAppointmentTypeStatus.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.message',
      attempt: 1,
    });
    mount();
    await user.click(
      await within(section('types')).findByRole('button', {
        name: `${en['appointmentSetup.retire']} ${ROUTINE.name}`,
      })
    );
    const confirm = await screen.findByTestId('appointment-setup-types-confirm');
    await user.click(within(confirm).getByRole('button', { name: en['appointmentSetup.retire'] }));
    expect(await within(section('types')).findByText(en['state.conflict.message'])).toBeVisible();
    expect(
      within(section('types')).getByRole('button', { name: en['form.loadLatest'] })
    ).toBeVisible();
  });
});

describe('Arabic, right to left, portals included', () => {
  it('reads in Arabic with the document right to left, and the dialog too', async () => {
    const user = userEvent.setup();
    adapters.listManagedAppointmentTypes.mockResolvedValue(page([ROUTINE]));
    mount('ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(
      screen.getByRole('heading', { name: ar['appointmentSetup.types.heading'] })
    ).toBeInTheDocument();
    expect(
      await within(section('channels')).findByText(ar['appointmentSetup.emptyTitle'])
    ).toBeVisible();
    expect(within(section('types')).getByText(ar['appointmentSetup.status.active'])).toBeVisible();
    await user.click(
      within(section('types')).getByRole('button', {
        name: `${ar['appointmentSetup.rename']} ${ROUTINE.name}`,
      })
    );
    const dialog = await screen.findByTestId('appointment-setup-types-rename');
    expect(within(dialog).getByRole('button', { name: ar['appointmentSetup.save'] })).toBeVisible();
    expect(dialog.closest('[dir="ltr"]')).toBeNull();
  });
});
