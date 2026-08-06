import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PasswordField } from '@/components/forms/Field';
import { MatchExplanation } from '@/components/duplicates/MatchExplanation';
import { Sidebar } from '@/components/shell/Sidebar';
import { CustomerCreateActions } from '@/features/crm/customers/components/CustomerCreateActions';
import { NAVIGATION } from '@/config/navigation';
import { CUSTOMER_CONFIDENCE_BANDS } from '@/features/crm/customers/identity-contract';
import { VEHICLE_CONFIDENCE_BANDS } from '@/features/vehicles/duplicates-contract';
import { customerMatchReasons, vehicleMatchReasons } from '@/lib/duplicates/explanations';
import { getMessages } from '@/i18n/get-messages';
import { visibleNavigation } from '@/lib/permissions';
import { BOTH_DIRECTIONS, renderLtr, renderRtl } from './render';

/**
 * The Owner-acceptance defects, each pinned by a test that fails if it returns.
 *
 * The Product Owner returned `OWNER ACCEPTANCE: FAIL` against the merged P1-27
 * application with eleven confirmed defects. Six of them are frontend behaviour
 * this remediation changed, and every one was invisible to the suite that
 * existed: 767 unit tests, an anonymous browser tier and an authenticated
 * browser tier were all green while the password toggle sat outside its field,
 * Administration could not be collapsed, and both duplicate screens printed
 * JSON at a receptionist.
 *
 * That is the point of this file. Each case below is written so that undoing
 * the fix turns it red — the mutation matrix in `scripts/ci/hostile-mutations.mjs`
 * proves that claim by actually undoing each one and re-running.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/en',
  useSearchParams: () => new URLSearchParams(''),
}));

const en = getMessages('en');
const ar = getMessages('ar');
const ROOT = join(__dirname, '..', '..', '..');

const FULL = {
  permissions: NAVIGATION.flatMap((group) =>
    group.items.flatMap((item) => [
      item.permission ?? 'x',
      ...(item.children ?? []).map((child) => child.permission ?? 'x'),
    ])
  ),
};

// --- defect 1: the password control -----------------------------------------

describe('the password reveal control is inside the field', () => {
  const renderField = (render: typeof renderLtr, messages: typeof en) =>
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted();
        }}
      >
        <PasswordField
          name="password"
          label={messages['auth.login.password']}
          autoComplete="current-password"
          showLabel={messages['field.password.show']}
          hideLabel={messages['field.password.hide']}
        />
        <button type="submit">go</button>
      </form>
    );

  const submitted = vi.fn();

  it.each(BOTH_DIRECTIONS)('renders the toggle inside the input wrapper (%s)', (locale, render) => {
    const messages = locale === 'en' ? en : ar;
    renderField(render, messages);

    const input = screen.getByLabelText(messages['auth.login.password']);
    const toggle = screen.getByTestId('password-reveal-toggle');

    // THE defect. The control used to be a text button rendered as a SIBLING of
    // the whole field, below the input and below its error message. Containment
    // is the assertion, not proximity: a button that merely appears near the
    // input can be moved by any layout change.
    expect(input.parentElement).not.toBeNull();
    expect(input.parentElement?.contains(toggle)).toBe(true);

    // Positioned at the inline end with a LOGICAL inset, so Arabic needs no
    // override. `end-1` is correct in both directions; `right-1` is correct in
    // one and wrong in the other, and the wrong one is the one nobody reviews.
    expect(toggle.className).toContain('absolute');
    expect(toggle.className).toContain('end-1');
    expect(toggle.className).not.toContain('right-1');
  });

  it('is a button that does not submit the form', async () => {
    const user = userEvent.setup();
    submitted.mockReset();
    renderField(renderLtr, en);

    await user.click(screen.getByTestId('password-reveal-toggle'));
    // A bare <button> inside a form defaults to submit. Revealing a password
    // would have signed the operator in — or failed to.
    expect(submitted).not.toHaveBeenCalled();
    expect(screen.getByTestId('password-reveal-toggle')).toHaveAttribute('type', 'button');
  });

  it('switches the field between hidden and visible, and says which it is', async () => {
    const user = userEvent.setup();
    renderField(renderLtr, en);

    const input = screen.getByLabelText(en['auth.login.password']);
    expect(input).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: en['field.password.show'] });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('aria-controls', input.id);

    await user.click(toggle);
    expect(screen.getByLabelText(en['auth.login.password'])).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: en['field.password.hide'] })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('keeps what the operator typed', async () => {
    const user = userEvent.setup();
    renderField(renderLtr, en);

    const input = screen.getByLabelText(en['auth.login.password']);
    await user.type(input, 'correct horse battery staple');
    await user.click(screen.getByTestId('password-reveal-toggle'));

    // The element must be PATCHED, not replaced. A conditional that rendered two
    // different inputs would clear the value here and send the operator back to
    // the start of a long password.
    expect(screen.getByLabelText(en['auth.login.password'])).toHaveValue(
      'correct horse battery staple'
    );
  });

  it('is reachable and operable from the keyboard alone', async () => {
    const user = userEvent.setup();
    renderField(renderLtr, en);

    await user.tab(); // the input
    await user.tab(); // the toggle
    expect(screen.getByTestId('password-reveal-toggle')).toHaveFocus();

    // A native button answers to both, with no key handler of our own.
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText(en['auth.login.password'])).toHaveAttribute('type', 'text');
    await user.keyboard(' ');
    expect(screen.getByLabelText(en['auth.login.password'])).toHaveAttribute('type', 'password');
  });

  it('does not rewrite autoComplete when the password becomes visible', async () => {
    const user = userEvent.setup();
    renderField(renderLtr, en);
    await user.click(screen.getByTestId('password-reveal-toggle'));
    // Changing it on reveal is what stops a password manager filling the form.
    expect(screen.getByLabelText(en['auth.login.password'])).toHaveAttribute(
      'autocomplete',
      'current-password'
    );
  });

  it('is used by every password field in the product', () => {
    for (const file of [
      'apps/web/src/features/authentication/components/LoginForm.tsx',
      'apps/web/src/features/authentication/components/SetPasswordForm.tsx',
    ]) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source, file).toContain('PasswordField');
      // A raw `type="password"` on a `TextField` is a field with no reveal
      // control, which is the state this remediation removed.
      expect(source, file).not.toMatch(/type="password"/);
    }
  });
});

// --- defects 2, 3, 4: the sidebar -------------------------------------------

describe('the sidebar navigation', () => {
  const groups = visibleNavigation(NAVIGATION, FULL);
  const renderSidebar = (pathname = '/en') =>
    renderLtr(
      <Sidebar locale="en" messages={en} groups={groups} pathname={pathname} collapsed={false} />
    );

  it('scrolls internally with a subtle scrollbar rather than the operating system channel', () => {
    renderSidebar();
    const nav = screen.getByTestId('sidebar-navigation');
    // Still a real scroll container. The fix changes the painting, not the
    // mechanism — a JavaScript scroller would break find-in-page and
    // scroll-into-view for a keyboard user.
    expect(nav.className).toContain('overflow-y-auto');
    expect(nav.className).toContain('subtle-scrollbar-on-dark');
  });

  it('keeps the scrollbar narrow, trackless and hidden until the region is used', () => {
    const raw = readFileSync(join(ROOT, 'apps/web/src/styles/base/_scrollbars.scss'), 'utf8');
    /*
     * Comments stripped BEFORE anything is asserted.
     *
     * The first version of this test read the file whole and matched
     * `/scrollbar-width:\s*thin/`. The mutation matrix then changed the real
     * declaration to `auto` and the test still passed — because the file's own
     * docblock contains the sentence "narrow (`scrollbar-width: thin`, 6px on
     * WebKit)". The assertion was reading prose about the code as if it were
     * the code.
     *
     * That is the fifth time this phase has made that mistake. It is written
     * down here rather than fixed quietly, because the lesson is the general
     * one: a text scanner cannot tell code from a sentence about code, and it
     * must be given only the code.
     */
    const scss = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');

    /*
     * Exact declarations in order, not "contains". There are two variants — the
     * navy sidebar and the light surfaces — and a `.replace` that fixed one
     * would leave the other, which is exactly how the second scrollbar mutation
     * survived its first run.
     */
    expect(scss.match(/scrollbar-width:\s*\w+/g)).toEqual([
      // The shared geometry: narrow.
      'scrollbar-width: thin',
      // …except under Windows High Contrast, where the user asked the operating
      // system to draw its own controls and we stand down.
      'scrollbar-width: auto',
    ]);
    expect(scss).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*6px/);
    // No track and no arrow buttons: what makes it read as an overlay rather
    // than as a channel.
    expect(scss).toMatch(/::-webkit-scrollbar-track\s*\{[^}]*background-color:\s*transparent/);
    expect(scss).toMatch(/::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/);

    const colours = scss.match(/scrollbar-color:[^;]+/g) ?? [];
    // Six: each variant declares a resting state, an interactive state and a
    // touch state. Two of the six are the resting state, and both must be
    // transparent — a painted thumb at rest is the defect, only thinner.
    expect(colours).toHaveLength(6);
    expect(colours.filter((rule) => /transparent transparent/.test(rule))).toHaveLength(2);

    expect(scss).toMatch(/&:hover,\s*\n\s*&:focus-within/);
    // Affordance is not removed for the people who cannot hover, nor for the
    // people who asked the operating system to draw its own controls.
    expect(scss).toMatch(/@media \(hover: none\)/);
    expect(scss).toMatch(/@media \(forced-colors: active\)/);
  });

  it('renders Administration as a collapsed disclosure, not as an always-open list', () => {
    renderSidebar();
    const toggle = screen.getByTestId('nav-disclosure-administration');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls');
    // The arrow the Owner asked for, and its direction carries the state.
    expect(within(toggle).getByTestId('nav-chevron')).toHaveAttribute('data-expanded', 'false');
  });

  it('opens and closes on click, and the arrow follows', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const toggle = screen.getByTestId('nav-disclosure-administration');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(toggle).getByTestId('nav-chevron')).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByRole('link', { name: en['nav.users'] })).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('answers Enter and Space, because it is a real button', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const toggle = screen.getByTestId('nav-disclosure-administration');

    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('animates rather than jumping, and needs no measured height to do it', () => {
    renderSidebar();
    const panel = document.getElementById(
      screen.getByTestId('nav-disclosure-administration').getAttribute('aria-controls') ?? ''
    );
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('transition-[grid-template-rows]');
    expect(panel?.className).toContain('duration-base');
    expect(panel?.className).toContain('grid-rows-[0fr]');
  });

  it('closes to nothing, because the clipped box carries no padding of its own', () => {
    renderSidebar();
    const panel = document.getElementById(
      screen.getByTestId('nav-disclosure-administration').getAttribute('aria-controls') ?? ''
    );
    const clipped = panel?.firstElementChild;
    const list = clipped?.firstElementChild;

    /*
     * Measured in installed Chrome, not reasoned about: a single element
     * carrying both `overflow-hidden` and the focus-ring padding was **6px tall
     * while closed** — one permanent sliver per closed group.
     *
     * A box's own padding is never clipped by its own `overflow: hidden`, and
     * `min-height: 0` does not help, so `pt-0.5 pb-1` survived the collapse to
     * `0fr`. The clipping box and the padded box have to be different elements.
     *
     * jsdom has no layout, so this asserts the STRUCTURE that produces the
     * geometry rather than the geometry itself. The 0px is in the Chrome review.
     */
    expect(clipped?.tagName).toBe('DIV');
    expect(clipped?.className).toBe('overflow-hidden');
    expect(list?.tagName).toBe('UL');
    expect(list?.className).toContain('pt-0.5');
    expect(list?.className).toContain('pb-1');
    expect(list?.className).not.toContain('overflow-hidden');
  });

  it('takes a closed group out of the tab order instead of hiding it at zero height', () => {
    renderSidebar();
    const panel = document.getElementById(
      screen.getByTestId('nav-disclosure-administration').getAttribute('aria-controls') ?? ''
    );
    // Zero height is not zero focusability. Without `inert`, tabbing past a
    // closed Administration lands on six links nobody can see.
    expect(panel?.hasAttribute('inert')).toBe(true);
  });

  it('opens the group that contains the current page, and marks it', () => {
    renderSidebar('/en/administration/users');
    const toggle = screen.getByTestId('nav-disclosure-administration');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // `aria-current` belongs to the link; the parent says it another way, or a
    // collapsed group would make the current page impossible to find.
    expect(toggle).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: en['nav.users'] })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('reopens a group the operator closed once the page moves inside it', async () => {
    const user = userEvent.setup();
    const { rerender } = renderSidebar('/en');
    const toggle = screen.getByTestId('nav-disclosure-administration');

    await user.click(toggle);
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    rerender(
      <Sidebar
        locale="en"
        messages={en}
        groups={groups}
        pathname="/en/administration/roles"
        collapsed={false}
      />
    );
    expect(screen.getByTestId('nav-disclosure-administration')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('does not leave every group permanently expanded', () => {
    renderSidebar('/en');
    const disclosures = screen.getAllByTestId(/^nav-disclosure-/);
    expect(disclosures.length).toBeGreaterThan(1);
    expect(disclosures.every((node) => node.getAttribute('aria-expanded') === 'false')).toBe(true);
  });

  it('keeps the module route reachable now that the parent no longer navigates', () => {
    renderSidebar('/en/administration');
    // `/administration` is a real page. Without its own child entry it would
    // have become a screen nothing in the interface admits exists.
    expect(screen.getByRole('link', { name: en['nav.administrationOverview'] })).toHaveAttribute(
      'aria-current',
      'page'
    );
    // And it must not claim to be the current page from a screen below it.
    expect(screen.getByRole('link', { name: en['nav.users'] })).not.toHaveAttribute('aria-current');
  });

  it('behaves the same in Arabic', async () => {
    const user = userEvent.setup();
    renderRtl(
      <Sidebar locale="ar" messages={ar} groups={groups} pathname="/ar" collapsed={false} />
    );
    const toggle = screen.getByTestId('nav-disclosure-administration');
    expect(toggle).toHaveTextContent(ar['nav.administration']);
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: ar['nav.users'] })).toBeInTheDocument();
  });

  it('gives each duplicate queue a review icon and a readable label', () => {
    renderSidebar();
    // Not truncated, and not the same icon as the search screen beside it.
    expect(screen.getByRole('link', { name: en['nav.customerDuplicates'] })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en['nav.vehicleDuplicates'] })).toBeInTheDocument();
    expect(en['nav.customerDuplicates']).toBe('Review duplicate customers');
    expect(en['nav.vehicleDuplicates']).toBe('Review duplicate vehicles');

    const customers = NAVIGATION.flatMap((group) => group.items).find(
      (item) => item.key === 'customer-duplicates'
    );
    const vehicles = NAVIGATION.flatMap((group) => group.items).find(
      (item) => item.key === 'vehicle-duplicates'
    );
    expect(customers?.icon).toBe('duplicate-review');
    expect(vehicles?.icon).toBe('duplicate-review');
  });
});

// --- defect 5: Add Customer -------------------------------------------------

describe('customer creation is offered where an operator looks for it', () => {
  it.each(BOTH_DIRECTIONS)('offers both kinds, with permission (%s)', (locale, render) => {
    const messages = locale === 'en' ? en : ar;
    render(
      <CustomerCreateActions locale={locale} messages={messages} canCreate variant="primary" />
    );
    expect(
      screen.getByRole('link', { name: messages['crm.customers.search.createIndividual'] })
    ).toHaveAttribute('href', `/${locale}/crm/customers/new/individual`);
    expect(
      screen.getByRole('link', { name: messages['crm.customers.search.createCompany'] })
    ).toHaveAttribute('href', `/${locale}/crm/customers/new/company`);
  });

  it('renders nothing at all without the permission', () => {
    const { container } = renderLtr(
      <CustomerCreateActions locale="en" messages={en} canCreate={false} />
    );
    // Absent, not disabled. A disabled control asserts the capability exists and
    // this operator lacks it — an invitation to ask for a permission they may
    // have no business holding. The backend denial remains the boundary.
    expect(container).toBeEmptyDOMElement();
  });

  it('is mounted by the search page header, not only by an empty result', () => {
    const page = readFileSync(
      join(ROOT, 'apps/web/src/app/[locale]/(dashboard)/crm/customers/page.tsx'),
      'utf8'
    );
    expect(page).toMatch(/actions=\{\s*<CustomerCreateActions/);
    const screenSource = readFileSync(
      join(ROOT, 'apps/web/src/features/crm/customers/components/CustomerSearchScreen.tsx'),
      'utf8'
    );
    expect(screenSource).toContain('CustomerCreateActions');
    expect(screenSource).toContain('crm.customers.search.noMatch');
  });
});

// --- defects 7, 8, 9: duplicate review reads as business language -----------

describe('a duplicate candidate explains itself', () => {
  const CRM_BASIS = [
    { signal: 'normalized_name', weight: 0.5 },
    { signal: 'contact_value', weight: 0.35 },
  ];
  const VEHICLE_BASIS = [
    { basis: 'vin_collision', classification: 'restricted', weight: 0.7 },
    { basis: 'make_model_year_similarity', classification: 'internal', weight: 0.2 },
  ];

  it('turns the customer evidence into sentences', () => {
    renderLtr(
      <MatchExplanation
        locale="en"
        messages={en}
        score="0.8500"
        bands={CUSTOMER_CONFIDENCE_BANDS}
        reasonKeys={customerMatchReasons(CRM_BASIS)}
      />
    );
    expect(screen.getByText(en['crm.duplicates.reason.name'])).toBeInTheDocument();
    expect(screen.getByText(en['crm.duplicates.reason.contact'])).toBeInTheDocument();
    expect(screen.getByTestId('match-confidence')).toHaveTextContent(
      en['duplicates.confidence.strong']
    );
  });

  it('turns the vehicle evidence into sentences, without printing a chassis number', () => {
    renderLtr(
      <MatchExplanation
        locale="en"
        messages={en}
        score="0.9000"
        bands={VEHICLE_CONFIDENCE_BANDS}
        reasonKeys={vehicleMatchReasons(VEHICLE_BASIS)}
      />
    );
    expect(screen.getByText(en['vehicles.duplicates.reason.vin'])).toBeInTheDocument();
    expect(screen.getByText(en['vehicles.duplicates.reason.makeModelYear'])).toBeInTheDocument();
  });

  it('renders no internal signal name, in either domain', () => {
    const { container } = renderLtr(
      <>
        <MatchExplanation
          locale="en"
          messages={en}
          score="0.8500"
          bands={CUSTOMER_CONFIDENCE_BANDS}
          reasonKeys={customerMatchReasons(CRM_BASIS)}
        />
        <MatchExplanation
          locale="en"
          messages={en}
          score="0.9000"
          bands={VEHICLE_CONFIDENCE_BANDS}
          reasonKeys={vehicleMatchReasons(VEHICLE_BASIS)}
        />
      </>
    );
    const text = container.textContent ?? '';
    for (const forbidden of [
      'normalized_name',
      'contact_value',
      'address_line',
      'vin_collision',
      'plate_collision',
      'make_model_year_similarity',
      'classification',
      'weight',
      'restricted',
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    expect(container.querySelector('pre')).toBeNull();
  });

  it('keeps the canonical decimal string exactly as the database sent it', () => {
    renderLtr(
      <MatchExplanation
        locale="en"
        messages={en}
        score="0.8500"
        bands={CUSTOMER_CONFIDENCE_BANDS}
        reasonKeys={customerMatchReasons(CRM_BASIS)}
      />
    );
    // 85%, AND `0.8500` — the percentage is derived from the digits and never
    // replaces the value a reviewer may have to justify later.
    expect(screen.getByText(/85% · 0\.8500/)).toBeInTheDocument();
  });

  it('says the system is warning, not deciding', () => {
    renderLtr(
      <MatchExplanation
        locale="en"
        messages={en}
        score="0.8500"
        bands={CUSTOMER_CONFIDENCE_BANDS}
        reasonKeys={customerMatchReasons(CRM_BASIS)}
      />
    );
    expect(screen.getByText(en['duplicates.warningNotDecision'])).toBeInTheDocument();
  });

  it('never falls back to the raw name of a comparison it does not recognise', () => {
    renderLtr(
      <MatchExplanation
        locale="en"
        messages={en}
        score="0.8500"
        bands={CUSTOMER_CONFIDENCE_BANDS}
        reasonKeys={customerMatchReasons([{ signal: 'a_brand_new_signal', weight: 0.5 }])}
      />
    );
    expect(screen.getByText(en['duplicates.reason.unrecognised'])).toBeInTheDocument();
    expect(screen.queryByText(/a_brand_new_signal/)).not.toBeInTheDocument();
  });

  it('says so honestly when there is no evidence at all', () => {
    renderLtr(
      <MatchExplanation
        locale="en"
        messages={en}
        score="0.8500"
        bands={CUSTOMER_CONFIDENCE_BANDS}
        reasonKeys={customerMatchReasons(null)}
      />
    );
    expect(screen.getByText(en['duplicates.reason.none'])).toBeInTheDocument();
  });

  it('renders the same explanation in Arabic', () => {
    renderRtl(
      <MatchExplanation
        locale="ar"
        messages={ar}
        score="0.9000"
        bands={VEHICLE_CONFIDENCE_BANDS}
        reasonKeys={vehicleMatchReasons(VEHICLE_BASIS)}
      />
    );
    expect(screen.getByText(ar['vehicles.duplicates.reason.vin'])).toBeInTheDocument();
    expect(screen.getByTestId('match-confidence')).toHaveTextContent(
      ar['duplicates.confidence.strong']
    );
  });
});
