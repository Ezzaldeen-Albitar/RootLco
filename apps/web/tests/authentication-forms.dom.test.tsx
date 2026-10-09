import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { useUnsavedWork } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { ActionState } from '@/lib/forms/action-result';
import {
  inBranch,
  messagesFor,
  renderLtr as renderInLtr,
  renderRtl as renderInRtl,
} from './render';

/**
 * The sign-in and account-recovery screens on Material UI (P1-32-PRE-OD-AUTHA).
 *
 * `/login`, `/forgot-password`, `/reset-password`, `/activate-account` and
 * `/profile` moved onto the ADR-022 wrappers (`FormTextField`,
 * `FormPasswordField`, the Material banner and submit button, and `AuthCard` on
 * `Paper`). Moving them changed what they draw and nothing about how they
 * decide, so every case here is a behaviour the legacy forms already had, held
 * in English and in Arabic:
 *
 *   - a refused sign-in names nothing about which half was wrong;
 *   - a forgotten-password request is answered the same whether or not an
 *     account exists;
 *   - an expired, invalid or already-used link is ONE sentence;
 *   - the address survives a refusal and a password does not;
 *   - the cursor lands on the first refused field;
 *   - Enter submits, and a second press before the first is answered sends
 *     nothing (both presses inside ONE `act()`, so the screen's own hold is what
 *     is tested, not a re-rendered disabled button).
 *
 * The Server Actions are replaced by mocks for the screens; the reset actions'
 * own single-answer rules are exercised for real below, against a mocked API
 * client, because no other suite runs them.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A Material label carries a decorative asterisk after the words. */
const labelled = (text: string) => new RegExp(`^${escape(text)}`);

const loginAction = vi.fn();
vi.mock('@/features/authentication/actions/login', () => ({
  loginAction: (...args: unknown[]) => loginAction(...args),
}));

const requestPasswordResetAction = vi.fn();
const completePasswordResetAction = vi.fn();
vi.mock('@/features/authentication/actions/password-reset', () => ({
  requestPasswordResetAction: (...args: unknown[]) => requestPasswordResetAction(...args),
  completePasswordResetAction: (...args: unknown[]) => completePasswordResetAction(...args),
}));

const updateOwnProfileAction = vi.fn();
vi.mock('@/features/authentication/actions/profile', () => ({
  updateOwnProfileAction: (...args: unknown[]) => updateOwnProfileAction(...args),
}));

const send = vi.fn();
vi.mock('@/lib/api/server-client', () => ({
  anonymousClient: () => ({ send }),
  clientWithToken: () => ({ send }),
  authorizedClient: async () => ({ send, get: send }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/login',
  useSearchParams: () => new URLSearchParams(''),
  redirect: (target: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { target });
  },
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const { LoginForm } = await import('@/features/authentication/components/LoginForm');
const { ForgotPasswordForm } =
  await import('@/features/authentication/components/ForgotPasswordForm');
const { RecoveryTokenBridge } =
  await import('@/features/authentication/components/RecoveryTokenBridge');
const { ProfileForm } = await import('@/features/authentication/components/ProfileForm');
const { AuthCard } = await import('@/features/authentication/components/AuthCard');
const realReset = await vi.importActual<
  typeof import('@/features/authentication/actions/password-reset')
>('@/features/authentication/actions/password-reset');

function withMui(ui: ReactElement, locale: Locale): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(messagesFor(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderIn = (locale: Locale, ui: ReactElement) =>
  locale === 'en' ? renderInLtr(withMui(ui, 'en')) : renderInRtl(withMui(ui, 'ar'));
const words = (locale: Locale) => (locale === 'en' ? EN : AR);
const LOCALES: readonly Locale[] = ['en', 'ar'];

/**
 * A Server Action that stays unanswered until the test answers it.
 *
 * Every one is answered after its case as well, pass or fail: React entangles
 * every later transition with an async action still in flight, so one left
 * unanswered would hold every form in the cases after it pending.
 */
const outstanding: ((state: ActionState) => void)[] = [];
function held(): {
  readonly answer: (state: ActionState) => void;
  readonly promise: Promise<ActionState>;
} {
  let answer: (state: ActionState) => void = () => undefined;
  const promise = new Promise<ActionState>((resolve) => (answer = resolve));
  outstanding.push(answer);
  return { answer, promise };
}

/** Both presses inside ONE act(): the second arrives before any re-render. */
const twice = (button: HTMLElement) =>
  act(() => {
    button.click();
    button.click();
  });

/** The FormData a mocked Server Action was called with, as a plain record. */
function sent(mock: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
  const form = mock.mock.calls[call]?.[1] as FormData;
  return Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

afterEach(async () => {
  await act(async () => {
    for (const answer of outstanding.splice(0)) answer({ status: 'idle' });
  });
});

// --- /login ---------------------------------------------------------------------

describe.each(LOCALES)('sign-in (%s)', (locale) => {
  const t = words(locale);
  const renderLogin = () =>
    renderIn(locale, <LoginForm locale={locale} messages={messagesFor(locale)} />);
  const email = () => screen.getByLabelText(labelled(t['auth.login.email'] as string));
  const password = () =>
    screen.getByLabelText(labelled(t['auth.login.password'] as string)) as HTMLInputElement;
  const submit = () => screen.getByRole('button', { name: t['auth.login.submit'] as string });

  it('labels the two boxes, keeps the reveal control inside the password box, and links to recovery', () => {
    renderLogin();
    expect(document.documentElement.dir).toBe(locale === 'en' ? 'ltr' : 'rtl');
    expect(email()).toHaveAttribute('type', 'email');
    expect(email()).toHaveAttribute('autocomplete', 'username');
    expect(email()).toHaveAttribute('aria-required', 'true');
    expect(email()).not.toHaveAttribute('required');
    expect(password()).toHaveAttribute('type', 'password');
    expect(password()).toHaveAttribute('autocomplete', 'current-password');

    const toggle = screen.getByTestId('password-reveal-toggle');
    expect(password().parentElement?.contains(toggle)).toBe(true);
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-controls', password().id);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAccessibleName(t['field.password.show'] as string);

    expect(screen.getByRole('link', { name: t['auth.login.forgot'] as string })).toHaveAttribute(
      'href',
      `/${locale}/forgot-password`
    );
    expect(screen.queryByLabelText(/workspace/i)).toBeNull();
  });

  it('reveals the password without replacing the box or rewriting autocomplete', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(password(), 'correct horse battery staple');
    const box = password();
    await user.click(screen.getByTestId('password-reveal-toggle'));
    expect(password()).toBe(box);
    expect(password()).toHaveAttribute('type', 'text');
    expect(password()).toHaveValue('correct horse battery staple');
    expect(password()).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByTestId('password-reveal-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('password-reveal-toggle')).toHaveAccessibleName(
      t['field.password.hide'] as string
    );
    expect(loginAction).not.toHaveBeenCalled();
  });

  it('submits on Enter, with the address, the password and the page language', async () => {
    const user = userEvent.setup();
    loginAction.mockResolvedValue({
      status: 'error',
      messageKey: 'auth.login.error.failed',
      attempt: 1,
    });
    renderLogin();
    await user.type(email(), 'operator@example.test');
    await user.type(password(), 'a-password{Enter}');
    await waitFor(() => expect(loginAction).toHaveBeenCalledTimes(1));
    expect(sent(loginAction)).toEqual({
      locale,
      email: 'operator@example.test',
      password: 'a-password',
    });
  });

  it('answers every credential failure with one sentence, keeps the address and clears the password', async () => {
    const user = userEvent.setup();
    loginAction.mockResolvedValue({
      status: 'error',
      messageKey: 'auth.login.error.failed',
      correlationId: 'corr-login',
      attempt: 1,
    });
    renderLogin();
    await user.type(email(), 'operator@example.test');
    await user.type(password(), 'wrong-password');
    await user.click(submit());

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(t['auth.login.error.failed'] as string);
    expect(banner).toHaveTextContent('corr-login');
    // Nothing per field: the answer says sign-in did not succeed, and no more.
    expect(email()).not.toHaveAttribute('aria-invalid');
    expect(password()).not.toHaveAttribute('aria-invalid');
    expect(email()).toHaveValue('operator@example.test');
    expect(password()).toHaveValue('');
  });

  it('puts the cursor on the first refused field and withdraws the complaint once it is edited', async () => {
    const user = userEvent.setup();
    loginAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'auth.login.error.invalid',
      fieldErrors: { email: 'auth.login.error.email', password: 'auth.login.error.password' },
      attempt: 1,
    });
    renderLogin();
    await user.click(submit());

    await waitFor(() => expect(email()).toHaveFocus());
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    expect(password()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(t['auth.login.error.email'] as string)).toBeInTheDocument();
    expect(screen.getByText(t['auth.login.error.password'] as string)).toBeInTheDocument();

    await user.type(email(), 'o');
    expect(email()).not.toHaveAttribute('aria-invalid');
    expect(password()).toHaveAttribute('aria-invalid', 'true');
  });

  it('sends one sign-in for two presses, and a new one once the first is answered', async () => {
    const answer = held();
    loginAction.mockReturnValue(answer.promise);
    renderLogin();
    await twice(submit());
    expect(loginAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer.answer({ status: 'error', messageKey: 'auth.login.error.failed', attempt: 1 });
      await answer.promise;
    });
    await screen.findByRole('alert');

    // Answered, so the next press is a new attempt — and only one again.
    loginAction.mockResolvedValue({
      status: 'error',
      messageKey: 'auth.login.error.failed',
      attempt: 2,
    });
    await twice(submit());
    await waitFor(() => expect(loginAction).toHaveBeenCalledTimes(2));
  });

  /*
   * The working state is read after an ordinary press. A press made inside a
   * synchronous `act()` reaches the action (the case above) but jsdom never
   * paints React's pending form status for it — measured with ONE press as well
   * as two, so it is the harness, not the hold.
   */
  it('says it is working while the sign-in is out, and cannot be pressed', async () => {
    const user = userEvent.setup();
    const answer = held();
    loginAction.mockReturnValue(answer.promise);
    renderLogin();
    await user.click(submit());
    const working = await screen.findByRole('button', {
      name: t['auth.login.submitting'] as string,
    });
    expect(working).toBeDisabled();
    expect(working).toHaveAttribute('aria-busy', 'true');
    expect(loginAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer.answer({ status: 'error', messageKey: 'auth.login.error.failed', attempt: 1 });
      await answer.promise;
    });
    await waitFor(() => expect(submit()).toBeEnabled());
    expect(submit()).not.toHaveAttribute('aria-busy');
  });
});

// --- /forgot-password -------------------------------------------------------------

describe.each(LOCALES)('forgotten password (%s)', (locale) => {
  const t = words(locale);
  const renderForgot = () =>
    renderIn(locale, <ForgotPasswordForm messages={messagesFor(locale)} />);
  const email = () => screen.getByLabelText(labelled(t['auth.forgot.email'] as string));
  const submit = () => screen.getByRole('button', { name: t['auth.forgot.submit'] as string });

  it('replaces the form with the one confirmation, which says nothing about whether an account exists', async () => {
    const user = userEvent.setup();
    requestPasswordResetAction.mockResolvedValue({
      status: 'success',
      messageKey: 'auth.forgot.submitted',
      attempt: 1,
    });
    renderForgot();
    await user.type(email(), 'someone@example.test{Enter}');

    const done = await screen.findByTestId('forgot-submitted');
    expect(done).toHaveAttribute('role', 'status');
    expect(done).toHaveTextContent(t['auth.forgot.submitted'] as string);
    expect(done).toHaveTextContent(t['auth.forgot.submittedDetail'] as string);
    // No second request can be made from under the confirmation.
    expect(screen.queryByRole('button', { name: t['auth.forgot.submit'] as string })).toBeNull();
    expect(sent(requestPasswordResetAction)).toEqual({ email: 'someone@example.test' });
  });

  it('keeps the address and focuses it when the address is refused', async () => {
    const user = userEvent.setup();
    requestPasswordResetAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'auth.forgot.error.invalid',
      fieldErrors: { email: 'auth.forgot.error.email' },
      attempt: 1,
    });
    renderForgot();
    await user.type(email(), 'not-an-address');
    await user.click(submit());

    await waitFor(() => expect(email()).toHaveFocus());
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    expect(email()).toHaveValue('not-an-address');
    expect(screen.getByTestId('form-feedback')).toHaveTextContent(
      t['auth.forgot.error.invalid'] as string
    );
    expect(screen.getAllByText(t['auth.forgot.error.email'] as string).length).toBeGreaterThan(0);
  });

  it('sends one request for two presses', async () => {
    const answer = held();
    requestPasswordResetAction.mockReturnValue(answer.promise);
    renderForgot();
    await twice(submit());
    expect(requestPasswordResetAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer.answer({ status: 'success', messageKey: 'auth.forgot.submitted', attempt: 1 });
      await answer.promise;
    });
    expect(await screen.findByTestId('forgot-submitted')).toBeInTheDocument();
    expect(requestPasswordResetAction).toHaveBeenCalledTimes(1);
  });
});

// --- /reset-password and /activate-account ---------------------------------------

const TOKEN = 'recovery-link-token-for-tests';

describe.each(LOCALES)('choosing a password from a link (%s)', (locale) => {
  const t = words(locale);
  const renderBridge = (serverToken: string | null, activate = false) =>
    renderIn(
      locale,
      <AuthCard
        title={t[activate ? 'auth.activate.title' : 'auth.reset.title'] as string}
        description={t[activate ? 'auth.activate.description' : 'auth.reset.description'] as string}
      >
        <RecoveryTokenBridge
          locale={locale}
          messages={messagesFor(locale)}
          serverToken={serverToken}
          submitLabelKey="auth.reset.submit"
          doneTitleKey={activate ? 'auth.activate.done' : 'auth.reset.done'}
          doneBodyKey={activate ? 'auth.activate.doneDetail' : 'auth.reset.doneDetail'}
        />
      </AuthCard>
    );
  const password = () =>
    screen.getByLabelText(labelled(t['auth.reset.password'] as string)) as HTMLInputElement;
  const confirmation = () =>
    screen.getByLabelText(labelled(t['auth.reset.confirmPassword'] as string)) as HTMLInputElement;
  const submit = () => screen.getByRole('button', { name: t['auth.reset.submit'] as string });

  it('offers no form for a link without a token, only the way to a new link', () => {
    renderBridge(null);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      t['auth.reset.title'] as string
    );
    const notice = screen.getByTestId('missing-token');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveTextContent(t['auth.reset.missingToken'] as string);
    expect(screen.queryByLabelText(labelled(t['auth.reset.password'] as string))).toBeNull();
    expect(
      screen.getByRole('link', { name: t['auth.reset.requestAnother'] as string })
    ).toHaveAttribute('href', `/${locale}/forgot-password`);
  });

  it('reads a token delivered in the fragment, and erases it from the address bar', async () => {
    window.history.replaceState(null, '', `/${locale}/reset-password#access_token=${TOKEN}`);
    renderBridge(null);
    expect(
      await screen.findByLabelText(labelled(t['auth.reset.password'] as string))
    ).toBeVisible();
    expect(document.querySelector('input[name="token"]')).toHaveValue(TOKEN);
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('carries the token, both passwords and nothing else, and states the rule under the box', async () => {
    const user = userEvent.setup();
    completePasswordResetAction.mockResolvedValue({
      status: 'success',
      messageKey: 'auth.reset.done',
      attempt: 1,
    });
    renderBridge(TOKEN);
    expect(password()).toHaveAccessibleDescription(t['auth.reset.passwordHint'] as string);
    expect(password()).toHaveAttribute('autocomplete', 'new-password');
    expect(confirmation()).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getAllByTestId('password-reveal-toggle')).toHaveLength(2);

    await user.type(password(), 'a-long-new-password');
    await user.type(confirmation(), 'a-long-new-password{Enter}');
    await waitFor(() => expect(completePasswordResetAction).toHaveBeenCalledTimes(1));
    expect(sent(completePasswordResetAction)).toEqual({
      token: TOKEN,
      password: 'a-long-new-password',
      confirmPassword: 'a-long-new-password',
    });

    const done = await screen.findByTestId('set-password-done');
    expect(done).toHaveTextContent(t['auth.reset.done'] as string);
    // A link onward, never an automatic redirect off the confirmation.
    expect(screen.getByRole('link', { name: t['auth.reset.continue'] as string })).toHaveAttribute(
      'href',
      `/${locale}/login`
    );
  });

  it('says the activation words when it is an invitation', async () => {
    const user = userEvent.setup();
    completePasswordResetAction.mockResolvedValue({
      status: 'success',
      messageKey: 'auth.reset.done',
      attempt: 1,
    });
    renderBridge(TOKEN, true);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      t['auth.activate.title'] as string
    );
    await user.type(password(), 'a-long-new-password');
    await user.type(confirmation(), 'a-long-new-password');
    await user.click(submit());
    const done = await screen.findByTestId('set-password-done');
    expect(done).toHaveTextContent(t['auth.activate.done'] as string);
    expect(done).toHaveTextContent(t['auth.activate.doneDetail'] as string);
  });

  it('answers an expired, invalid or used link with one sentence, and clears both boxes', async () => {
    const user = userEvent.setup();
    completePasswordResetAction.mockResolvedValue({
      status: 'error',
      messageKey: 'auth.reset.error.token',
      correlationId: 'corr-token',
      attempt: 1,
    });
    renderBridge(TOKEN);
    await user.type(password(), 'a-long-new-password');
    await user.type(confirmation(), 'a-long-new-password');
    await user.click(submit());

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(t['auth.reset.error.token'] as string);
    expect(banner).toHaveTextContent('corr-token');
    expect(password()).toHaveValue('');
    expect(confirmation()).toHaveValue('');
    expect(
      screen.getByRole('link', { name: t['auth.reset.requestAnother'] as string })
    ).toHaveAttribute('href', `/${locale}/forgot-password`);
    // The token itself is never shown back.
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('marks the confirmation that does not match and puts the cursor there', async () => {
    const user = userEvent.setup();
    completePasswordResetAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'auth.reset.error.invalid',
      fieldErrors: { confirmPassword: 'auth.reset.error.mismatch' },
      attempt: 1,
    });
    renderBridge(TOKEN);
    await user.type(password(), 'a-long-new-password');
    await user.type(confirmation(), 'something-else');
    await user.click(submit());

    await waitFor(() => expect(confirmation()).toHaveFocus());
    expect(confirmation()).toHaveAttribute('aria-invalid', 'true');
    expect(password()).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText(t['auth.reset.error.mismatch'] as string)).toBeInTheDocument();
  });

  it('sends one completion for two presses', async () => {
    const answer = held();
    completePasswordResetAction.mockReturnValue(answer.promise);
    renderBridge(TOKEN);
    await twice(submit());
    expect(completePasswordResetAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer.answer({ status: 'error', messageKey: 'auth.reset.error.token', attempt: 1 });
      await answer.promise;
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t['auth.reset.error.token'] as string
    );
  });
});

// --- the reset actions' own single answers -----------------------------------------

describe('the reset actions answer by their own rules, whatever the API says', () => {
  const failure = (kind: string, status: number | null) => ({
    ok: false,
    kind,
    status,
    problem: null,
    correlationId: 'corr-api',
  });
  const form = (entries: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  };

  it('confirms a reset request for an address the service does not know exactly as for one it does', async () => {
    const answers: ActionState[] = [];
    for (const reply of [
      { ok: true, status: 202, data: null, correlationId: 'corr-ok' },
      failure('not-found', 404),
      failure('validation', 422),
      failure('unauthenticated', 401),
      failure('forbidden', 403),
      failure('conflict', 409),
    ]) {
      send.mockResolvedValueOnce(reply);
      answers.push(
        await realReset.requestPasswordResetAction(
          { status: 'idle' },
          form({ email: 'someone@example.test' })
        )
      );
    }
    for (const answer of answers) {
      expect(answer).toEqual({
        status: 'success',
        messageKey: 'auth.forgot.submitted',
        attempt: 1,
      });
    }
  });

  it('says a throttle and an outage as themselves, because neither discloses an account', async () => {
    send.mockResolvedValueOnce(failure('rate-limited', 429));
    const throttled = await realReset.requestPasswordResetAction(
      { status: 'idle' },
      form({ email: 'someone@example.test' })
    );
    expect(throttled.messageKey).toBe('auth.forgot.error.throttled');
    send.mockResolvedValueOnce(failure('unavailable', 503));
    const down = await realReset.requestPasswordResetAction(
      { status: 'idle' },
      form({ email: 'someone@example.test' })
    );
    expect(down.messageKey).toBe('auth.forgot.error.unavailable');
  });

  it('answers an expired, an invalid and an already-used link with the same sentence', async () => {
    const answers: ActionState[] = [];
    for (const reply of [
      failure('unauthenticated', 401),
      failure('not-found', 404),
      failure('conflict', 409),
      failure('forbidden', 403),
    ]) {
      send.mockResolvedValueOnce(reply);
      answers.push(
        await realReset.completePasswordResetAction(
          { status: 'idle', attempt: 2 },
          form({
            token: TOKEN,
            password: 'a-long-new-password',
            confirmPassword: 'a-long-new-password',
          })
        )
      );
    }
    for (const answer of answers) {
      expect(answer).toMatchObject({
        status: 'error',
        messageKey: 'auth.reset.error.token',
        attempt: 3,
      });
    }
    // A password the provider refuses is a different sentence: the link was fine.
    send.mockResolvedValueOnce(failure('validation', 422));
    const rejected = await realReset.completePasswordResetAction(
      { status: 'idle' },
      form({
        token: TOKEN,
        password: 'a-long-new-password',
        confirmPassword: 'a-long-new-password',
      })
    );
    expect(rejected).toMatchObject({ status: 'invalid', messageKey: 'auth.reset.error.rejected' });
  });

  it('refuses a mismatch and a short password before asking the API', async () => {
    const mismatch = await realReset.completePasswordResetAction(
      { status: 'idle' },
      form({ token: TOKEN, password: 'a-long-new-password', confirmPassword: 'different-one' })
    );
    expect(mismatch.fieldErrors).toEqual({ confirmPassword: 'auth.reset.error.mismatch' });
    const short = await realReset.completePasswordResetAction(
      { status: 'idle' },
      form({ token: TOKEN, password: 'short', confirmPassword: 'short' })
    );
    expect(short.fieldErrors?.password).toBe('auth.reset.error.passwordLength');
    expect(send).not.toHaveBeenCalled();
  });
});

// --- /profile -------------------------------------------------------------------

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

describe.each(LOCALES)('the profile name (%s)', (locale) => {
  const t = words(locale);
  const renderProfile = (displayName = 'Layla Haddad', recordVersion = 4) =>
    renderIn(
      locale,
      inBranch(
        <>
          <ProfileForm
            locale={locale}
            messages={messagesFor(locale)}
            displayName={displayName}
            recordVersion={recordVersion}
          />
          <UnsavedProbe />
        </>,
        { locale }
      )
    );
  const name = () => screen.getByLabelText(labelled(t['profile.displayName'] as string));
  const save = () => screen.getByRole('button', { name: t['profile.save'] as string });
  const unsaved = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'probe unsaved' }));
    return screen.getByTestId('unsaved-answer').textContent;
  };

  it('sends the typed name with the version it was read at, and the page language', async () => {
    const user = userEvent.setup();
    updateOwnProfileAction.mockResolvedValue({
      status: 'success',
      messageKey: 'profile.saved',
      attempt: 1,
    });
    renderProfile();
    await user.clear(name());
    await user.type(name(), 'Layla H.{Enter}');
    await waitFor(() => expect(updateOwnProfileAction).toHaveBeenCalledTimes(1));
    expect(sent(updateOwnProfileAction)).toEqual({
      locale,
      recordVersion: '4',
      displayName: 'Layla H.',
    });
    const saved = await screen.findByTestId('form-feedback');
    expect(saved).toHaveAttribute('role', 'status');
    expect(saved).toHaveTextContent(t['profile.saved'] as string);
  });

  it('counts a changed name as unsaved work until it is saved', async () => {
    const user = userEvent.setup();
    updateOwnProfileAction.mockResolvedValue({
      status: 'success',
      messageKey: 'profile.saved',
      attempt: 1,
    });
    renderProfile();
    expect(await unsaved()).toBe('false');
    await user.type(name(), ' Haddad');
    expect(await unsaved()).toBe('true');
    await user.click(save());
    await screen.findByTestId('form-feedback');
    expect(await unsaved()).toBe('false');
  });

  it('keeps the typed name, focuses it and states the refusal when the name is refused', async () => {
    const user = userEvent.setup();
    updateOwnProfileAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.formError',
      fieldErrors: { displayName: 'profile.error.displayNameLength' },
      attempt: 1,
    });
    renderProfile();
    await user.clear(name());
    await user.type(name(), 'x');
    await user.click(save());
    await waitFor(() => expect(name()).toHaveFocus());
    expect(name()).toHaveAttribute('aria-invalid', 'true');
    expect(name()).toHaveValue('x');
    expect(screen.getByText(t['profile.error.displayNameLength'] as string)).toBeInTheDocument();
    expect(await unsaved()).toBe('true');
  });

  it('says a conflict as a conflict, and keeps what was typed', async () => {
    const user = userEvent.setup();
    updateOwnProfileAction.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.title',
      correlationId: 'corr-409',
      attempt: 1,
    });
    renderProfile();
    await user.type(name(), ' Haddad');
    await user.click(save());
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(t['state.conflict.title'] as string);
    expect(banner).toHaveAttribute('data-state', 'conflict');
    expect(name()).toHaveValue('Layla Haddad Haddad');
  });

  it('sends one save for two presses', async () => {
    const answer = held();
    updateOwnProfileAction.mockReturnValue(answer.promise);
    renderProfile();
    await twice(save());
    expect(updateOwnProfileAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer.answer({ status: 'success', messageKey: 'profile.saved', attempt: 1 });
      await answer.promise;
    });
    expect(await screen.findByTestId('form-feedback')).toHaveAttribute('role', 'status');
  });
});

// --- the card ---------------------------------------------------------------------

describe('the authentication card', () => {
  it('holds the one h1, its description and the footer, in both directions', () => {
    for (const locale of LOCALES) {
      const t = words(locale);
      const { unmount } = renderIn(
        locale,
        <AuthCard
          title={t['auth.forgot.title'] as string}
          description={t['auth.forgot.description'] as string}
          footer={<a href={`/${locale}/login`}>{t['auth.backToLogin']}</a>}
        >
          <p>slot</p>
        </AuthCard>
      );
      const card = screen.getByTestId('auth-card');
      expect(within(card).getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(within(card).getByRole('heading', { level: 1 })).toHaveTextContent(
        t['auth.forgot.title'] as string
      );
      expect(card).toHaveTextContent(t['auth.forgot.description'] as string);
      expect(
        within(card).getByRole('link', { name: t['auth.backToLogin'] as string })
      ).toBeVisible();
      unmount();
    }
  });
});
