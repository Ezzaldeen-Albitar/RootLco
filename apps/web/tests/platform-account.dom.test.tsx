import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * Account and security in the Platform Owner Console.
 *
 * The properties under test:
 *
 *   - per-field validation: each field is required, the confirmation must match
 *     the new password, and a new password equal to the current one is refused
 *     without asking the server;
 *   - every password field carries its own reveal control, and revealing one
 *     does not reveal the others;
 *   - a success clears all three fields and states what happened to the
 *     operator's other devices, using the sentence the SERVER's answer chose;
 *   - the two server refusals are distinct on screen and mark different
 *     fields — a current password that did not verify, and a new password the
 *     identity provider refused;
 *   - Arabic renders the same screen right to left with catalogued Arabic.
 *
 * No password typed here is ever asserted to appear anywhere but in the field
 * the operator typed it into.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;
const L = (key: string): string => EN[key] ?? `missing message ${key}`;

const refresh = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/en/platform/account',
}));

const changeOwnPasswordAction = vi.fn();
vi.mock('@/features/platform/actions', () => ({
  changeOwnPasswordAction: (...args: unknown[]) => changeOwnPasswordAction(...args),
}));

const { AccountSecurityScreen } =
  await import('@/features/platform/components/AccountSecurityScreen');
const { getMessages } = await import('@/i18n/get-messages');

const SESSION = {
  userId: '22222222-2222-4222-8222-222222222222',
  homeTenantId: '11111111-1111-4111-8111-111111111111',
  platformPermissions: ['platform.organization.read', 'platform.statistics.read'],
} as const;

const CURRENT = 'the-current-password';
const NEXT = 'a-different-password';

beforeEach(() => {
  changeOwnPasswordAction.mockReset();
  refresh.mockReset();
  changeOwnPasswordAction.mockResolvedValue({
    status: 'success',
    messageKey: 'platform.account.done',
    attempt: 1,
  });
});

function renderScreen(locale: 'en' | 'ar' = 'en') {
  const messages = getMessages(locale);
  const render = locale === 'en' ? renderLtr : renderRtl;
  return render(<AccountSecurityScreen messages={messages} session={SESSION} />);
}

/** The three password inputs, in the order the form declares them. */
function fields(): HTMLInputElement[] {
  return [
    document.querySelector<HTMLInputElement>('input[name="currentPassword"]'),
    document.querySelector<HTMLInputElement>('input[name="newPassword"]'),
    document.querySelector<HTMLInputElement>('input[name="confirmPassword"]'),
  ].map((element, index) => {
    if (!element) throw new Error(`password field ${index} is not rendered`);
    return element;
  });
}

async function fill(values: readonly [string, string, string]) {
  const user = userEvent.setup();
  const inputs = fields();
  for (const [index, value] of values.entries()) {
    const input = inputs[index] as HTMLInputElement;
    await user.clear(input);
    await user.type(input, value);
  }
  return user;
}

describe('the account screen shows the identity the console session carries', () => {
  it('names the operator, its home organisation and every authority code it holds', () => {
    renderScreen();
    expect(screen.getByTestId('account-operator-id')).toHaveTextContent(SESSION.userId);
    expect(screen.getByTestId('account-home-tenant')).toHaveTextContent(SESSION.homeTenantId);
    for (const code of SESSION.platformPermissions) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
  });

  it('offers a change-password form with three fields and no address field', () => {
    renderScreen();
    expect(fields()).toHaveLength(3);
    expect(document.querySelector('input[name="email"]')).toBeNull();
    expect(screen.getByRole('button', { name: L('platform.account.submit') })).toBeEnabled();
  });
});

describe('the form validates before it asks the server', () => {
  it('refuses an empty form and sends nothing', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));
    // One complaint per field, and nothing asked of the server.
    await waitFor(() => expect(screen.getAllByText(L('platform.error.required'))).toHaveLength(3));
    expect(changeOwnPasswordAction).not.toHaveBeenCalled();
    for (const field of fields()) expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses a confirmation that does not match, and marks only that field', async () => {
    renderScreen();
    const user = await fill([CURRENT, NEXT, 'something-else-entirely']);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await screen.findByText(L('platform.account.error.mismatch'));
    expect(changeOwnPasswordAction).not.toHaveBeenCalled();
    const [current, next, confirm] = fields();
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(current).not.toHaveAttribute('aria-invalid');
    expect(next).not.toHaveAttribute('aria-invalid');
  });

  it('refuses a new password equal to the current one, and withdraws the complaint on an edit', async () => {
    renderScreen();
    const user = await fill([CURRENT, CURRENT, CURRENT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await screen.findByText(L('platform.account.error.unchanged'));
    expect(changeOwnPasswordAction).not.toHaveBeenCalled();

    await user.type(fields()[1] as HTMLInputElement, '-and-more');
    await waitFor(() =>
      expect(screen.queryByText(L('platform.account.error.unchanged'))).toBeNull()
    );
  });

  it('carries the three values, and only those three, to the one server function', async () => {
    renderScreen();
    const user = await fill([CURRENT, NEXT, NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await waitFor(() => expect(changeOwnPasswordAction).toHaveBeenCalledTimes(1));
    const [sent] = changeOwnPasswordAction.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(sent).sort()).toEqual(['confirmPassword', 'currentPassword', 'newPassword']);
  });
});

describe('every password field can be revealed on its own', () => {
  it('starts hidden, reveals the field its toggle controls, and leaves the others hidden', async () => {
    const user = userEvent.setup();
    renderScreen();
    const [current, next, confirm] = fields();
    expect([current?.type, next?.type, confirm?.type]).toEqual([
      'password',
      'password',
      'password',
    ]);

    const toggles = screen.getAllByTestId('password-reveal-toggle');
    expect(toggles).toHaveLength(3);

    await user.click(toggles[1] as HTMLElement);
    expect(fields().map((field) => field.type)).toEqual(['password', 'text', 'password']);
    expect(toggles[1]).toHaveAttribute('aria-pressed', 'true');

    await user.click(toggles[1] as HTMLElement);
    expect(fields().map((field) => field.type)).toEqual(['password', 'password', 'password']);
  });

  it('is reachable from the keyboard', async () => {
    const user = userEvent.setup();
    renderScreen();
    const [current] = fields();
    current?.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getAllByTestId('password-reveal-toggle')[0]);
  });
});

describe('a success states what happened, and clears the fields', () => {
  it('announces the change, says the other devices were signed out, and empties the form', async () => {
    renderScreen();
    const user = await fill([CURRENT, NEXT, NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    const done = await screen.findByTestId('account-password-done');
    expect(done).toHaveTextContent(L('platform.account.doneTitle'));
    expect(done).toHaveTextContent(L('platform.account.done'));
    expect(fields().map((field) => field.value)).toEqual(['', '', '']);
  });

  it('says the other devices were NOT signed out when that is what the server reported', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.account.doneSessionsKept',
      attempt: 1,
    });
    renderScreen();
    const user = await fill([CURRENT, NEXT, NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    const done = await screen.findByTestId('account-password-done');
    expect(done).toHaveTextContent(L('platform.account.doneSessionsKept'));
    expect(done).not.toHaveTextContent(L('platform.account.done'));
  });
});

describe('the two refusals are distinct, and mark different fields', () => {
  it('marks the current password when the identity provider would not verify it', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'platform.account.error.currentPassword',
      fieldErrors: { currentPassword: 'platform.account.error.currentPassword' },
      correlationId: 'c-1',
      attempt: 1,
    });
    renderScreen();
    const user = await fill(['not-the-current-one', NEXT, NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    // Once in the banner and once against the field the operator must correct.
    await waitFor(() =>
      expect(
        screen.getAllByText(L('platform.account.error.currentPassword')).length
      ).toBeGreaterThan(0)
    );
    expect(screen.queryByTestId('account-password-done')).toBeNull();
    const [current, next] = fields();
    expect(current).toHaveAttribute('aria-invalid', 'true');
    expect(next).not.toHaveAttribute('aria-invalid');
  });

  it('marks the new password when the identity provider refused it, with a different sentence', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'platform.account.error.refused',
      fieldErrors: { newPassword: 'platform.account.error.refused' },
      correlationId: 'c-2',
      attempt: 1,
    });
    renderScreen();
    const user = await fill([CURRENT, 'short', 'short']);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await waitFor(() =>
      expect(screen.getAllByText(L('platform.account.error.refused')).length).toBeGreaterThan(0)
    );
    expect(L('platform.account.error.refused')).not.toBe(
      L('platform.account.error.currentPassword')
    );
    const [current, next] = fields();
    expect(next).toHaveAttribute('aria-invalid', 'true');
    expect(current).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByTestId('account-password-done')).toBeNull();
  });
});

describe('Arabic', () => {
  it('renders the screen right to left with catalogued Arabic', async () => {
    renderScreen('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR['platform.account.passwordTitle'] as string)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: AR['platform.account.submit'] as string })
    ).toBeInTheDocument();
    // Real Arabic, not an English string sitting in the Arabic catalogue.
    expect(AR['platform.account.title']).not.toBe(EN['platform.account.title']);
    expect(AR['platform.account.title']).toMatch(/[؀-ۿ]/);
  });

  it('keeps the reveal control on every field in Arabic too', async () => {
    const user = userEvent.setup();
    renderScreen('ar');
    const toggles = screen.getAllByTestId('password-reveal-toggle');
    expect(toggles).toHaveLength(3);
    await user.click(toggles[0] as HTMLElement);
    expect(fields()[0]?.type).toBe('text');
  });
});
