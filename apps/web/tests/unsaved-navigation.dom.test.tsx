import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type MouseEvent, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { TenantView } from '@/features/administration/organization/types';
import { getMessages } from '@/i18n/get-messages';
import { inBranch, renderLtr, renderRtl } from './render';

/**
 * Leaving a page that holds unsaved work asks first (DEF-S2b, settings QA at
 * d17e7df1).
 *
 * Browser QA typed a new time zone on the Organisation page, clicked "Customers"
 * in the side menu and lost the draft without a word: the only question the
 * product asked was the branch switch's, and that page has no branch control.
 * The properties under test, for every screen that declares its work with
 * `useUnsavedGuard` — one shared mechanism, mounted by the working-context
 * provider, so these cases render nothing but the provider and a form:
 *
 *   - a link clicked while work is unsaved opens the question and goes nowhere;
 *     "Stay" keeps the typed values, the address and the cursor; "Leave"
 *     discards the work and then follows the link;
 *   - with nothing unsaved, or after a successful save, nothing asks;
 *   - a click that does not take the page away (a modifier, a new tab, a
 *     download) is never intercepted;
 *   - back and forward ask the same question, and "Stay" puts the address back;
 *   - the browser's own reload/close question is registered only while work is
 *     unsaved;
 *   - in English and in Arabic, right to left.
 *
 * The link stands in for the router's: a React `onClick` that prevents the
 * browser's navigation and records where it would have gone — which is exactly
 * what the application's link component does before it asks the router.
 */

const send = vi.fn();
vi.mock('@/lib/api/server-client', () => ({ authorizedClient: async () => ({ send }) }));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const { TenantForm } = await import('@/features/administration/organization/components/TenantForm');

const HERE = '/en/administration/organization';
const ELSEWHERE = '/en/crm/customers';

const navigated = vi.fn();

function RouterLink({
  href,
  children,
  ...rest
}: {
  readonly href: string;
  readonly children: string;
  readonly target?: string;
  readonly download?: boolean;
}) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    navigated(href);
  };
  return (
    <a href={href} onClick={follow} {...rest}>
      {children}
    </a>
  );
}

/** A form that declares its work, with a discard the question must honour. */
function NoteForm() {
  const [note, setNote] = useState('');
  useUnsavedGuard(note.length > 0, () => setNote(''));
  return (
    <form>
      <label>
        Note
        <input value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button type="button" onClick={() => setNote('')}>
        clear note
      </button>
    </form>
  );
}

const WORKSPACE: TenantView = {
  id: '30000000-0000-4000-8000-000000000003',
  tenantCode: 'tenant_one',
  displayName: 'Tenant One',
  status: 'active',
  defaultLocale: 'en',
  defaultTimezone: 'UTC',
  recordVersion: 3,
};

const READERS = [
  { locale: 'en' as const, catalogue: en as Record<string, string>, paint: renderLtr },
  { locale: 'ar' as const, catalogue: ar as Record<string, string>, paint: renderRtl },
];

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', HERE);
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe.each(READERS)('$locale: leaving the settings page', ({ locale, catalogue, paint }) => {
  const M = (key: string): string => {
    const value = catalogue[key];
    if (value === undefined) throw new Error(`${key} is not in the ${locale} catalogue`);
    return value;
  };
  const zone = () =>
    screen.getByLabelText(new RegExp(`^${escapeRegExp(M('organization.defaultTimezone'))}`));

  function page(): ReactElement {
    return inBranch(
      <>
        <nav>
          <RouterLink href={ELSEWHERE}>Customers</RouterLink>
        </nav>
        <TenantForm
          locale={locale}
          messages={getMessages(locale)}
          canWrite
          tenant={WORKSPACE}
          referenceValues={{
            currencies: [],
            timezones: [{ zoneName: 'UTC' }, { zoneName: 'Asia/Amman' }],
            languages: [
              { localeCode: 'en', name: 'English', direction: 'ltr' },
              { localeCode: 'ar', name: 'Arabic', direction: 'rtl' },
            ],
          }}
        />
      </>,
      { locale }
    );
  }

  it('asks before a link leaves unsaved work, in plain words and in the reading direction', async () => {
    const user = userEvent.setup();
    paint(page());
    await user.selectOptions(zone(), 'Asia/Amman');
    await user.click(screen.getByRole('link', { name: 'Customers' }));

    const dialog = await screen.findByRole('alertdialog', {
      name: M('workingContext.leave.title'),
    });
    expect(dialog).toHaveTextContent(M('workingContext.leave.description'));
    expect(
      within(dialog).getByRole('button', { name: M('workingContext.leave.stay') })
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: M('workingContext.leave.confirm') })
    ).toBeVisible();
    expect(dialog.closest('[dir]')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    // Nothing has moved while the question is open.
    expect(navigated).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(HERE);
  });

  it('stays on "Stay": the choice, the address and the cursor are where they were', async () => {
    const user = userEvent.setup();
    paint(page());
    await user.selectOptions(zone(), 'Asia/Amman');
    await user.click(screen.getByRole('link', { name: 'Customers' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: M('workingContext.leave.stay') }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(navigated).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(HERE);
    expect(zone()).toHaveValue('Asia/Amman');
    await waitFor(() => expect(zone()).toHaveFocus());
    expect(send).not.toHaveBeenCalled();
  });

  it('discards and then follows the link on "Leave", sending nothing', async () => {
    const user = userEvent.setup();
    paint(page());
    await user.selectOptions(zone(), 'Asia/Amman');
    await user.click(screen.getByRole('link', { name: 'Customers' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: M('workingContext.leave.confirm') })
    );

    expect(navigated).toHaveBeenCalledTimes(1);
    expect(navigated).toHaveBeenCalledWith(ELSEWHERE);
    // The form's own discard ran: the saved zone is back, and nothing was sent.
    await waitFor(() => expect(zone()).toHaveValue('UTC'));
    expect(send).not.toHaveBeenCalled();
  });

  it('asks nothing when nothing is unsaved', async () => {
    const user = userEvent.setup();
    paint(page());
    await user.click(screen.getByRole('link', { name: 'Customers' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(navigated).toHaveBeenCalledWith(ELSEWHERE);
  });

  it('asks nothing after the work is saved', async () => {
    send.mockResolvedValue({ ok: true, status: 200, data: {}, correlationId: 'corr-save' });
    const user = userEvent.setup();
    paint(page());
    await user.selectOptions(zone(), 'Asia/Amman');
    await user.click(screen.getByRole('button', { name: M('admin.save') }));
    expect(await screen.findByText(M('admin.saved'))).toBeVisible();

    await user.click(screen.getByRole('link', { name: 'Customers' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(navigated).toHaveBeenCalledWith(ELSEWHERE);
  });
});

describe('clicks that do not take the page away are left alone', () => {
  async function dirtyWith(link: ReactElement) {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          {link}
          <NoteForm />
        </>
      )
    );
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'half a thought');
    return user;
  }

  it.each([
    { name: 'Ctrl', init: { ctrlKey: true } },
    { name: 'Cmd', init: { metaKey: true } },
    { name: 'Shift', init: { shiftKey: true } },
    { name: 'Alt', init: { altKey: true } },
    { name: 'the middle button', init: { button: 1 } },
  ])('a click with $name', async ({ init }) => {
    await dirtyWith(<RouterLink href={ELSEWHERE}>Customers</RouterLink>);
    fireEvent.click(screen.getByRole('link', { name: 'Customers' }), init);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a link that opens in another tab, and a download', async () => {
    await dirtyWith(
      <>
        <RouterLink href={ELSEWHERE} target="_blank">
          Customers
        </RouterLink>
        <RouterLink href="/en/reports/export" download>
          Export
        </RouterLink>
      </>
    );
    fireEvent.click(screen.getByRole('link', { name: 'Customers' }));
    fireEvent.click(screen.getByRole('link', { name: 'Export' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a link to a place on the same page', async () => {
    await dirtyWith(<RouterLink href={`${HERE}#capacity`}>Capacity</RouterLink>);
    fireEvent.click(screen.getByRole('link', { name: 'Capacity' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('back and forward', () => {
  const router = vi.fn();
  const follow = (event: PopStateEvent) => router(event.state);

  beforeEach(() => {
    window.history.replaceState({ page: 'list' }, '', ELSEWHERE);
    window.history.pushState({ page: 'settings' }, '', HERE);
    // Registered BEFORE the provider mounts, as the router's own listener is.
    window.addEventListener('popstate', follow);
  });
  afterEach(() => {
    window.removeEventListener('popstate', follow);
    router.mockReset();
  });

  async function dirtyThenBack() {
    const user = userEvent.setup();
    renderLtr(inBranch(<NoteForm />));
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'half a thought');
    window.history.back();
    return { user, dialog: await screen.findByRole('alertdialog') };
  }

  it('asks before the router follows Back, and "Stay" puts the address back', async () => {
    const { user, dialog } = await dirtyThenBack();
    expect(router).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: en['workingContext.leave.stay'] }));

    expect(window.location.pathname).toBe(HERE);
    expect(window.history.state).toEqual({ page: 'settings' });
    expect(router).not.toHaveBeenCalled();
    const note = screen.getByRole('textbox', { name: 'Note' });
    expect(note).toHaveValue('half a thought');
    await waitFor(() => expect(note).toHaveFocus());
  });

  it('lets the router follow Back on "Leave", after the work is discarded', async () => {
    const { user, dialog } = await dirtyThenBack();
    await user.click(
      within(dialog).getByRole('button', { name: en['workingContext.leave.confirm'] })
    );
    expect(router).toHaveBeenCalledTimes(1);
    expect(router).toHaveBeenCalledWith({ page: 'list' });
    expect(window.location.pathname).toBe(ELSEWHERE);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue(''));
  });

  it('does not stand between the router and Back when nothing is unsaved', async () => {
    renderLtr(inBranch(<NoteForm />));
    window.history.back();
    await waitFor(() => expect(router).toHaveBeenCalledWith({ page: 'list' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('reload and closing the tab', () => {
  it('registers the browser question only while work is unsaved, and removes it after', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const user = userEvent.setup();
    renderLtr(inBranch(<NoteForm />));
    const registered = () => add.mock.calls.filter(([name]) => name === 'beforeunload');
    expect(registered()).toHaveLength(0);
    expect(unloadIsQuestioned()).toBe(false);

    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'x');
    await waitFor(() => expect(registered()).toHaveLength(1));
    expect(unloadIsQuestioned()).toBe(true);

    await user.click(screen.getByRole('button', { name: 'clear note' }));
    await waitFor(() =>
      expect(remove.mock.calls.filter(([name]) => name === 'beforeunload')).toHaveLength(1)
    );
    expect(unloadIsQuestioned()).toBe(false);
    add.mockRestore();
    remove.mockRestore();
  });
});

/** Whether the page would make the browser ask before unloading now. */
function unloadIsQuestioned(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
