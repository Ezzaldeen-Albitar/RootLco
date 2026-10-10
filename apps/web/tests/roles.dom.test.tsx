import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactElement } from 'react';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { inBranch, renderLtr, renderRtl } from './render';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
import type { RoleRow } from '@/features/administration/access/types';

/**
 * `/administration/roles` on Material UI (`P1-32-PRE-OD-ADM4`).
 *
 * The properties under test: the list is the operational grid over the
 * cursor-paged `iam.role-list` and names a provisioned role in the reader's
 * language; a role is created through the shared form dialog, refused on its own
 * boxes before anything is sent, and sent once however fast it is pressed; an
 * edit sends only what changed with the version the list showed as `If-Match`,
 * and a stale version is the server's conflict with a way to load the latest; a
 * built-in role offers nothing; a refused read is a refusal, never an empty
 * list; and the route page issues no read without `iam.role.read`.
 */

const EN = (key: string): string => {
  const value = (en as Record<string, string>)[key];
  if (value === undefined) throw new Error(`${key} is not in the English catalogue`);
  return value;
};
const AR = (key: string): string => {
  const value = (ar as Record<string, string>)[key];
  if (value === undefined) throw new Error(`${key} is not in the Arabic catalogue`);
  return value;
};
const CATALOGUE = { en: EN, ar: AR } as const;

const send = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api/server-client', () => ({ authorizedClient: async () => ({ send, get }) }));
let SESSION_PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: SESSION_PERMISSIONS, email: 'admin@test.local' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const { RolesScreen } = await import('@/features/administration/access/components/RolesScreen');
const { FormDialog } = await import('@/features/administration/shared/components/FormDialog');
const { FormTextField } = await import('@/components/forms/mui/FormTextField');
const { DateField } = await import('@/components/forms/mui/DateField');
const RolesPage = (await import('@/app/[locale]/(dashboard)/administration/roles/page'))
  .default as unknown as (args: {
  params: Promise<Record<string, string>>;
}) => Promise<React.ReactNode>;

const SUPERVISOR: RoleRow = {
  id: '70000000-0000-4000-8000-000000000071',
  roleCode: 'supervisor',
  name: 'Supervisor',
  description: 'Runs the floor',
  isSystem: false,
  recordVersion: 3,
};
const ADMINISTRATOR: RoleRow = {
  id: '70000000-0000-4000-8000-000000000072',
  roleCode: 'tenant_administrator',
  name: 'Tenant Administrator',
  description: null,
  isSystem: false,
  recordVersion: 1,
};
const BUILT_IN: RoleRow = {
  id: '70000000-0000-4000-8000-000000000073',
  roleCode: 'platform_auditor',
  name: 'Platform auditor',
  description: null,
  isSystem: true,
  recordVersion: 1,
};

const page = (rows: readonly RoleRow[]) => ({
  ok: true as const,
  status: 200,
  data: { items: rows, nextCursor: null, hasMore: false },
  correlationId: 'corr-roles',
});

/** A write the API refused as a stale version — `ERR-CON-001`. */
const STALE = {
  ok: false as const,
  kind: 'conflict' as const,
  status: 409,
  problem: {
    type: 'urn:rootlco:error:ERR-CON-001',
    title: 'Conflict',
    status: 409,
    code: 'ERR-CON-001',
    correlationId: 'corr-stale',
  },
  correlationId: 'corr-stale',
};

function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}

function mount(locale: 'en' | 'ar' = 'en', canManage = true) {
  const ui = withMui(
    inBranch(
      <RolesScreen messages={locale === 'en' ? en : ar} locale={locale} canManage={canManage} />,
      { locale }
    ),
    locale
  );
  return locale === 'en' ? renderLtr(ui) : renderRtl(ui);
}

/** A write whose answer is held until the case releases it. */
function heldSend() {
  let answer: (value: unknown) => void = () => undefined;
  send.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    })
  );
  return (value: unknown) => answer(value);
}

/**
 * Every write held until the case answers it, one answer per write, in order —
 * so "while the write is in flight" is a real wait, not a synchronous mock.
 */
function answeredOneByOne() {
  const waiting: ((value: unknown) => void)[] = [];
  send.mockImplementation(
    () =>
      new Promise((resolve) => {
        waiting.push(resolve);
      })
  );
  return (value: unknown) => {
    const next = waiting.shift();
    if (next === undefined) throw new Error('no write is waiting for an answer');
    next(value);
  };
}

/**
 * Lets an answer reach the dialog's submit handler and run it to its end
 * WITHOUT letting React draw the outcome: only promise jobs run here, and the
 * render the answer schedules is a later task. A key or a press now lands in
 * the moment between the answer and the dialog closing.
 */
async function answerHandledNotYetDrawn(): Promise<void> {
  for (let job = 0; job < 50; job += 1) await Promise.resolve();
}

/** The service could not be reached: the ordinary refusal a retry is for. */
const OUTAGE = {
  ok: false as const,
  kind: 'unavailable' as const,
  status: 503,
  problem: { code: 'ERR-SYS-001' },
  correlationId: 'corr-down',
};

beforeEach(() => {
  send.mockReset();
  get.mockReset();
  SESSION_PERMISSIONS = [];
});

describe('the roles list', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`names each role, its code and its kind, and a provisioned role in the reader's words (${locale})`, async () => {
      const C = CATALOGUE[locale];
      get.mockResolvedValue(page([SUPERVISOR, ADMINISTRATOR, BUILT_IN]));
      mount(locale);
      // Each name is the cell's own text; the row's actions repeat it for a screen reader.
      expect((await screen.findAllByText('Supervisor'))[0]).toBeVisible();
      expect(screen.getByText('supervisor')).toBeVisible();
      expect(screen.getAllByText(C('roles.standard.tenant_administrator'))[0]).toBeVisible();
      expect(screen.queryByText('Tenant Administrator')).toBeNull();
      expect(screen.getByText(C('roles.kind.system'))).toBeVisible();
      // No reference is ever printed.
      expect(document.body.textContent ?? '').not.toContain(SUPERVISOR.id);
      expect(String(get.mock.calls[0]?.[0])).toMatch(/^\/api\/v1\/iam\/roles\?/);
    });
  }

  it('offers no change on a built-in role, and none at all without the manage code', async () => {
    get.mockResolvedValue(page([BUILT_IN]));
    const view = mount('en');
    expect(await screen.findByText('Platform auditor')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: `${EN('roles.edit')} Platform auditor` })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: `${EN('roles.archive')} Platform auditor` })
    ).toBeNull();
    view.unmount();

    get.mockResolvedValue(page([SUPERVISOR]));
    mount('en', false);
    expect(await screen.findByText('Supervisor')).toBeVisible();
    expect(screen.queryByRole('button', { name: EN('roles.create') })).toBeNull();
    expect(screen.queryByRole('button', { name: `${EN('roles.edit')} Supervisor` })).toBeNull();
  });

  it('draws a refused read as a refusal with its reference, never as an empty list', async () => {
    get.mockResolvedValue({ ok: false, kind: 'forbidden', status: 403, correlationId: 'corr-r' });
    mount('en');
    expect(await screen.findByText(EN('state.denied.title'))).toBeVisible();
    expect(screen.getByText('corr-r')).toBeVisible();
    expect(screen.queryByText(EN('roles.kind.tenant'))).toBeNull();
  });

  it('the route page refuses without iam.role.read, before any read', async () => {
    SESSION_PERMISSIONS = [];
    renderLtr(
      withMui(
        inBranch((await RolesPage({ params: Promise.resolve({ locale: 'en' }) })) as never),
        'en'
      )
    );
    expect(screen.getByText(EN('state.denied.title'))).toBeVisible();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('creating a role', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`refuses an empty code and name on their own boxes and sends nothing (${locale})`, async () => {
      const C = CATALOGUE[locale];
      get.mockResolvedValue(page([SUPERVISOR]));
      const user = userEvent.setup();
      mount(locale);
      await user.click(await screen.findByRole('button', { name: C('roles.create') }));
      // A form is a dialog, not an alert, and its first box takes the cursor.
      const dialog = await screen.findByRole('dialog', { name: C('roles.create.title') });
      const code = within(dialog).getByLabelText(new RegExp(`^${C('roles.field.code')}`));
      await waitFor(() => expect(code).toHaveFocus());
      await user.click(within(dialog).getByRole('button', { name: C('admin.create') }));
      await waitFor(() => expect(code).toHaveAttribute('aria-invalid', 'true'));
      expect(
        within(dialog).getByLabelText(new RegExp(`^${C('roles.field.name')}`))
      ).toHaveAttribute('aria-invalid', 'true');
      expect(send).not.toHaveBeenCalled();
    });
  }

  it('sends the code, the name and the description, once, however fast Create is pressed', async () => {
    get.mockResolvedValue(page([SUPERVISOR]));
    const release = heldSend();
    const user = userEvent.setup();
    mount('en');
    await user.click(await screen.findByRole('button', { name: EN('roles.create') }));
    const dialog = await screen.findByRole('dialog', { name: EN('roles.create.title') });
    await user.type(within(dialog).getByLabelText(/^Code/), 'service_advisor');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Service adviser');
    await user.type(within(dialog).getByLabelText(/^Description/), 'Greets customers');
    const press = within(dialog).getByRole('button', { name: EN('admin.create') });
    act(() => {
      press.click();
      press.click();
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/iam/roles', {
      roleCode: 'service_advisor',
      name: 'Service adviser',
      description: 'Greets customers',
    });
    release({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: EN('roles.create.title') })).toBeNull()
    );
    expect(send).toHaveBeenCalledTimes(1);
    // Created: the list is read again.
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1));
  });

  it('keeps what was typed when the service refuses, and says why beside the buttons', async () => {
    get.mockResolvedValue(page([SUPERVISOR]));
    send.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      problem: {
        type: 'urn:rootlco:error:ERR-RES-002',
        title: 'Conflict',
        status: 409,
        code: 'ERR-RES-002',
        correlationId: 'corr-dup',
      },
      correlationId: 'corr-dup',
    });
    const user = userEvent.setup();
    mount('en');
    await user.click(await screen.findByRole('button', { name: EN('roles.create') }));
    const dialog = await screen.findByRole('dialog', { name: EN('roles.create.title') });
    await user.type(within(dialog).getByLabelText(/^Code/), 'supervisor');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Supervisor');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));
    expect(await within(dialog).findByText(EN('state.conflict.blocked.title'))).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Code/)).toHaveValue('supervisor');
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('Supervisor');
  });
});

describe('editing a role', () => {
  it('sends only what changed, with the version the list showed as If-Match', async () => {
    get.mockResolvedValue(page([SUPERVISOR]));
    send.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: SUPERVISOR.id },
      correlationId: 'c',
    });
    const user = userEvent.setup();
    mount('en');
    await user.click(await screen.findByRole('button', { name: `${EN('roles.edit')} Supervisor` }));
    const dialog = await screen.findByRole('dialog', { name: EN('roles.edit.title') });
    const name = within(dialog).getByLabelText(/^Name/);
    expect(name).toHaveValue('Supervisor');
    await user.clear(name);
    await user.type(name, 'Floor supervisor');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/iam/roles/${SUPERVISOR.id}`,
      { name: 'Floor supervisor' },
      { ifMatch: 3 }
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: EN('roles.edit.title') })).toBeNull()
    );
  });

  it('says nothing has changed, and sends nothing', async () => {
    get.mockResolvedValue(page([SUPERVISOR]));
    const user = userEvent.setup();
    mount('en');
    await user.click(await screen.findByRole('button', { name: `${EN('roles.edit')} Supervisor` }));
    const dialog = await screen.findByRole('dialog', { name: EN('roles.edit.title') });
    await user.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    expect(await within(dialog).findByText(EN('roles.edit.unchanged'))).toBeVisible();
    expect(send).not.toHaveBeenCalled();
  });

  for (const locale of ['en', 'ar'] as const) {
    it(`says a stale version is a conflict, keeps the typed name, and loads the latest on request (${locale})`, async () => {
      const C = CATALOGUE[locale];
      get.mockResolvedValue(page([SUPERVISOR]));
      send.mockResolvedValue(STALE);
      const user = userEvent.setup();
      mount(locale);
      await user.click(
        await screen.findByRole('button', { name: `${C('roles.edit')} Supervisor` })
      );
      const dialog = await screen.findByRole('dialog', { name: C('roles.edit.title') });
      const name = within(dialog).getByLabelText(new RegExp(`^${C('roles.field.name')}`));
      await user.clear(name);
      await user.type(name, 'Floor supervisor');
      await user.click(within(dialog).getByRole('button', { name: C('admin.save') }));
      expect(await within(dialog).findByText(C('state.conflict.title'))).toBeInTheDocument();
      expect(name).toHaveValue('Floor supervisor');

      // The newer role arrives with the latest version, and replaces the stale work.
      get.mockResolvedValue(page([{ ...SUPERVISOR, name: 'Shift lead', recordVersion: 4 }]));
      await user.click(within(dialog).getByRole('button', { name: C('form.loadLatest') }));
      await waitFor(() => expect(name).toHaveValue('Shift lead'));
    });
  }
});

describe('archiving a role', () => {
  it('asks first, then sends the archive with the version as If-Match', async () => {
    get.mockResolvedValue(page([SUPERVISOR]));
    send.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: SUPERVISOR.id },
      correlationId: 'c',
    });
    const user = userEvent.setup();
    mount('en');
    await user.click(
      await screen.findByRole('button', { name: `${EN('roles.archive')} Supervisor` })
    );
    // A confirmation stays an alert dialog.
    const confirm = await screen.findByRole('alertdialog', { name: EN('roles.confirm.archive') });
    expect(send).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: EN('roles.archive') }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        'PATCH',
        `/api/v1/iam/roles/${SUPERVISOR.id}`,
        { archive: true },
        { ifMatch: 3 }
      )
    );
  });
});

describe('the shared form dialog sends once, whatever Enter does (P1-32-PRE-OD-ADM4 review)', () => {
  /** A form dialog with a one-line box, a multi-line box and a date field. */
  function Probe({
    pending,
    onSubmit,
  }: {
    readonly pending: boolean;
    readonly onSubmit: () => void;
  }) {
    const [code, setCode] = useState('');
    const [note, setNote] = useState('');
    const [day, setDay] = useState<'' | `${number}-${number}-${number}`>('');
    return (
      <FormDialog
        messages={en}
        title="Probe form"
        submitLabel="Save probe"
        pending={pending}
        onCancel={() => undefined}
        onSubmit={onSubmit}
      >
        <FormTextField name="code" label="Probe code" value={code} onChange={setCode} />
        <FormTextField
          name="note"
          label="Probe note"
          value={note}
          onChange={setNote}
          multiline
          rows={3}
        />
        <DateField
          name="day"
          label="Probe day"
          value={day}
          onChange={(next) => setDay(next as typeof day)}
        />
      </FormDialog>
    );
  }

  function mountProbe(pending: boolean, onSubmit: () => void) {
    return renderLtr(withMui(inBranch(<Probe pending={pending} onSubmit={onSubmit} />), 'en'));
  }

  it('reaches the caller on Enter in a one-line box and in a date field part, not in a multi-line box', async () => {
    const submitted = vi.fn();
    const user = userEvent.setup();
    mountProbe(false, submitted);
    const dialog = await screen.findByRole('dialog', { name: 'Probe form' });

    await user.click(within(dialog).getByLabelText(/^Probe note/));
    await user.keyboard('{Enter}');
    expect(submitted).not.toHaveBeenCalled();

    await user.click(within(dialog).getByLabelText(/^Probe code/));
    await user.keyboard('{Enter}');
    expect(submitted).toHaveBeenCalledTimes(1);

    const group = within(dialog).getByRole('group', { name: /^Probe day/ });
    const part = within(group).getAllByRole('spinbutton')[0] as HTMLElement;
    await user.click(part);
    await user.keyboard('{Enter}');
    expect(submitted).toHaveBeenCalledTimes(2);
  });

  it('while the write is in flight, neither Enter nor the form submit event reaches the caller', async () => {
    const submitted = vi.fn();
    const user = userEvent.setup();
    mountProbe(true, submitted);
    const dialog = await screen.findByRole('dialog', { name: 'Probe form' });

    await user.click(within(dialog).getByLabelText(/^Probe code/));
    await user.keyboard('{Enter}{Enter}');
    const group = within(dialog).getByRole('group', { name: /^Probe day/ });
    await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('{Enter}');
    // `requestSubmit` does not consult the disabled button; the form refuses it.
    const form = dialog.querySelector('form') as HTMLFormElement;
    act(() => form.requestSubmit());
    expect(submitted).not.toHaveBeenCalled();
  });
});

describe('a role form is sent once between the answer and the dialog closing (P1-32-PRE-OD-ADM4 review)', () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    get.mockResolvedValue(page([SUPERVISOR]));
    mount('en');
    await user.click(await screen.findByRole('button', { name: EN('roles.create') }));
    const dialog = await screen.findByRole('dialog', { name: EN('roles.create.title') });
    await user.type(within(dialog).getByLabelText(/^Code/), 'service_advisor');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Service adviser');
    return dialog;
  }

  it('create: Enter while pending, and Enter or a press right after the answer, send nothing more', async () => {
    const answer = answeredOneByOne();
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    const name = within(dialog).getByLabelText(/^Name/);
    await user.click(name);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    // Held, auto-repeating Enter while the answer is awaited.
    await user.keyboard('{Enter}{Enter}{Enter}');
    expect(send).toHaveBeenCalledTimes(1);

    answer({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    await answerHandledNotYetDrawn();
    // The answer is in, and the dialog has not yet been closed.
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.click(within(dialog).getByRole('button', { name: EN('admin.creating') }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: EN('roles.create.title') })).toBeNull()
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('create: a failed save can be sent again, by a press and by Enter', async () => {
    const answer = answeredOneByOne();
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    answer(OUTAGE);
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    answer(OUTAGE);
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: EN('admin.create') })).toBeEnabled()
    );

    await user.click(within(dialog).getByLabelText(/^Name/));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    answer({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: EN('roles.create.title') })).toBeNull()
    );
    expect(send).toHaveBeenCalledTimes(3);
  });

  async function openEdit(user: ReturnType<typeof userEvent.setup>) {
    get.mockResolvedValue(page([SUPERVISOR]));
    mount('en');
    await user.click(await screen.findByRole('button', { name: `${EN('roles.edit')} Supervisor` }));
    const dialog = await screen.findByRole('dialog', { name: EN('roles.edit.title') });
    const name = within(dialog).getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, 'Floor supervisor');
    return { dialog, name };
  }

  it('edit: Enter while pending, and Enter or a press right after the answer, send no second change', async () => {
    const answer = answeredOneByOne();
    const user = userEvent.setup();
    const { dialog, name } = await openEdit(user);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await user.keyboard('{Enter}{Enter}');
    expect(send).toHaveBeenCalledTimes(1);

    answer({ ok: true, status: 200, data: { id: SUPERVISOR.id }, correlationId: 'c' });
    await answerHandledNotYetDrawn();
    expect(dialog).toBeInTheDocument();
    // A second change here would carry the version the first one replaced.
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.click(within(dialog).getByRole('button', { name: EN('admin.saving') }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: EN('roles.edit.title') })).toBeNull()
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/iam/roles/${SUPERVISOR.id}`,
      { name: 'Floor supervisor' },
      { ifMatch: 3 }
    );
  });

  it('edit: a failed save can be sent again, by a press and by Enter', async () => {
    const answer = answeredOneByOne();
    const user = userEvent.setup();
    const { dialog } = await openEdit(user);
    await user.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    answer(OUTAGE);
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    answer(OUTAGE);
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: EN('admin.save') })).toBeEnabled()
    );

    await user.click(within(dialog).getByLabelText(/^Name/));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  });
});
