import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { E2E_API_ORIGIN, REPO_ROOT } from '../origin';

/**
 * The P1-28 Appointment and Reception screens, against the **running
 * application, the running API and the real database** — the browser tier for
 * this phase, and the evidence `P1-28-QA-005` packages.
 *
 * ## Why this file exists
 *
 * Before it, the authenticated browser tier contained ZERO occurrences of
 * "appointment" or "reception" anywhere under `apps/web/tests/e2e/**`. The tier
 * is governed — `authenticated-browser` sits in the `needs` of both `ci-gate`
 * and `protected-gate` — so its green tick is quoted as this repository's
 * production-integration evidence. For P1-28 that tick observed NOTHING the
 * phase built. Every other P1-28 tier mocks the transport, and a mock is a test
 * fixture: it returns what the test author believed the operation returns, so a
 * screen can satisfy every mocked expectation and still be dead against the real
 * backend. That is not a hypothetical here — this phase has already shipped one
 * seam (`intake-handoff.ts`, `/reception/check-in` singular against a wizard
 * mounted at `/receptions/check-in` plural) that every mocked tier passed while
 * no operator could have reached the second screen.
 *
 * So nothing here is mocked. A real session reaches the real Next.js server,
 * which calls the real API, which queries the real database under RLS.
 *
 * ## WHAT THIS FILE DELIBERATELY DOES NOT DO — read this before extending it
 *
 * **It never seeds a business row to make a green path.** The acceptance
 * database holds zero customers, zero vehicles, zero appointment types, zero
 * appointments and zero reception visits, by the no-fake-data policy. Several
 * things a reader would expect to see proved here therefore cannot be, and each
 * one is asserted as the HONEST BLOCKED STATE the screen actually shows rather
 * than skipped, weakened, or made to pass by inventing data:
 *
 *   - **An appointment cannot be BOOKED.** `apt.appointment_types` is empty, so
 *     `/appointments/new` states "no appointment types have been set up … so an
 *     appointment cannot be booked" and DISABLES submit. That sentence is what
 *     this file asserts. Seeding one type would turn a truthful blocked screen
 *     into a green booking path and would prove the opposite of the truth.
 *   - **No reception visit exists**, so the wizard's thirteen-step registry and
 *     the acknowledgement document cannot be rendered against a real record.
 *     Both cases below DISCOVER a visit through the real API first and assert
 *     the registry / the document when one exists; with an empty database they
 *     assert the honest not-found instead, and they assert it in the shape that
 *     matters — never a blank page, never a printed sheet whose sections read
 *     empty. Neither case is ever a skip: a skipped test still counts toward the
 *     tier's executed total, which is how a "0 uncovered" number gets reported
 *     over a case that measured nothing.
 *   - **The walk-in handoff cannot be round-tripped with a real pair.** What is
 *     provable without data is the half that was actually broken: that the
 *     address the intake builds RESOLVES to the check-in screen in the running
 *     application, and that an unresolvable or half pair starts the screen empty
 *     rather than erroring.
 *   - **A terminal-close affordance cannot be observed on a row**, because there
 *     are no rows. What is asserted is the board's side of the same rule: the
 *     status vocabulary the graph is defined over renders as labels, and a board
 *     holding no visit offers no close affordance at all.
 *
 * UNTESTABLE UNTIL THE CATALOGUES AND THE BUSINESS TABLES CAN BE POPULATED —
 * stated here so nobody reads this file as covering them: booking an
 * appointment; confirm/reschedule, cancel and no-show; opening a visit; every
 * evidence, signature and refusal step; approval; the two terminal exits; the
 * conversion to a work order; the acknowledgement's populated sections and its
 * per-section "could not be read" notice. Those need `apt.appointment_types`
 * (and `rec.fuel_levels`, `apt.cancellation_reasons`) to be populatable by an
 * administrator, plus at least one customer and vehicle. When that arrives, the
 * cases marked `NEEDS DATA` below become positive paths without changing shape.
 *
 * ## Reader-only principal
 *
 * The Owner-acceptance context provisions a second identity —
 * `READER_PERMISSIONS` in `scripts/dev/owner-acceptance/context.mjs`, nine codes
 * including `apt.appointment.read` and `rec.reception.read` and pointedly NOT
 * `apt.appointment.manage` or `rec.reception.manage`. That pairing is what makes
 * a denial checkable: the same account reads the calendar and the queue, and is
 * refused the booking form. An account denied everything would evidence nothing,
 * because "empty" and "denied" look identical when both are empty.
 */

/* ------------------------------------------------------------------ *
 * The catalogues, read rather than restated
 * ------------------------------------------------------------------ */

const LOCALES = ['en', 'ar'] as const;
type Locale = (typeof LOCALES)[number];

/**
 * The message catalogues the running application renders from.
 *
 * Read here rather than quoted, for the reason `origin.ts` gives about the
 * origin: an English sentence typed into this file would be a SECOND statement
 * of a fact the catalogue already owns, and a copy edit to the product would
 * make this suite assert text no screen shows any more — which fails as though
 * the screen had regressed. Reading the source of truth means an assertion can
 * only fail when the SCREEN stops saying what the catalogue says.
 */
const MESSAGES: Record<Locale, Record<string, string>> = {
  en: JSON.parse(
    readFileSync(join(REPO_ROOT, 'apps', 'web', 'src', 'i18n', 'messages', 'en.json'), 'utf8')
  ),
  ar: JSON.parse(
    readFileSync(join(REPO_ROOT, 'apps', 'web', 'src', 'i18n', 'messages', 'ar.json'), 'utf8')
  ),
};

/**
 * One catalogue entry, or a hard failure.
 *
 * `translate()` is `messages[key] ?? key`, so a missing key would silently turn
 * every assertion below into `expect(body).toContain('receptions.queue.title')`
 * — a check that passes only when the screen is BROKEN. Failing here instead
 * means a renamed key breaks this suite loudly, at the line that names it.
 */
function say(locale: Locale, key: string): string {
  const value = MESSAGES[locale][key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${locale}.json has no entry for "${key}"; this suite cannot assert on it`);
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * Fixed references from the acceptance bootstrap
 * ------------------------------------------------------------------ */

/**
 * Tenant A's company and branch, fixed by
 * `scripts/dev/owner-acceptance/context.mjs` (`IDS.companyA` / `IDS.branchA`).
 * `isolation.spec.ts` declares its Tenant B counterparts the same way and for
 * the same reason: these are the only references a local acceptance stack is
 * guaranteed to have.
 *
 * They are a RESOURCE SELECTOR, not a scope assertion: `GET /appointments` and
 * `GET /receptions` both require the pair (`P1-18-A-01`) because the server
 * refuses to guess which of a multi-grant operator's branches a board is for.
 * The Backend still resolves the caller's own authority from the session.
 */
const COMPANY_A = 'c1000000-0000-4000-8000-00000000000a';
const BRANCH_A = 'c1100000-0000-4000-8000-00000000000a';

/**
 * A well-formed identifier that belongs to nothing.
 *
 * The acceptance bootstrap owns the `c…` prefix and `tests/db/helpers.ts` owns
 * `aaaaaaaa-…`/`bbbbbbbb-…`; `d…` is claimed by neither, so this cannot collide
 * with a real record now or after a future seed. It must be well-formed because
 * the point is to reach the route's READ and see its not-found branch — a
 * malformed id would be refused by `parseWalkInHandoff` or by the route's own
 * parameter handling and would test a different thing.
 */
const ABSENT_ID = 'd0000000-0000-4000-8000-00000000000f';
const ABSENT_ID_TWO = 'd0000000-0000-4000-8000-00000000001f';

const API = E2E_API_ORIGIN;
const HANDOFF = join(REPO_ROOT, '.local', 'owner-acceptance-account.json');

/** Every route this phase mounts, per locale. Derived from the `(dashboard)` tree. */
function phaseRoutes(locale: Locale): readonly string[] {
  return [
    `/${locale}/appointments`,
    `/${locale}/appointments/new`,
    `/${locale}/appointments/${ABSENT_ID}`,
    `/${locale}/reception/walk-in`,
    `/${locale}/receptions`,
    `/${locale}/receptions/check-in`,
    `/${locale}/receptions/check-in/${ABSENT_ID}`,
    `/${locale}/receptions/check-in/${ABSENT_ID}/acknowledgement`,
  ];
}

/* ------------------------------------------------------------------ *
 * Credentials and API access
 * ------------------------------------------------------------------ */

interface Credentials {
  readonly email: string;
  readonly password: string;
}

function handoffFile(): Record<string, unknown> {
  if (!existsSync(HANDOFF)) {
    throw new Error('No acceptance identities. Run: npm run acceptance:create-owner');
  }
  return JSON.parse(readFileSync(HANDOFF, 'utf8'));
}

/** The Tenant A owner — the identity `auth.setup.ts` captured the session for. */
function ownerCredentials(): Credentials {
  const email = process.env.ROOTLCO_E2E_EMAIL;
  const password = process.env.ROOTLCO_E2E_PASSWORD;
  if (email && password) return { email, password };
  const handoff = handoffFile() as { login: Credentials };
  return { email: handoff.login.email, password: handoff.login.password };
}

/**
 * The read-only, branch-scoped operator (`READER_PERMISSIONS`).
 *
 * The bootstrap writes it under `alsoProvisioned.reader`. Never a literal here:
 * a password in a tracked file fails the tracked-secret scan, and it fails it
 * permanently because the scan also runs over history.
 */
function readerCredentials(): Credentials {
  const email = process.env.ROOTLCO_E2E_READER_EMAIL;
  const password = process.env.ROOTLCO_E2E_READER_PASSWORD;
  if (email && password) return { email, password };
  const handoff = handoffFile() as {
    alsoProvisioned?: { reader?: Credentials };
  };
  const reader = handoff.alsoProvisioned?.reader;
  if (!reader?.email || !reader?.password) {
    throw new Error(
      'The acceptance handoff carries no reader identity. Re-run: npm run acceptance:create-owner'
    );
  }
  return { email: reader.email, password: reader.password };
}

/** A real bearer token for the owner, obtained the way the web tier obtains one. */
async function ownerBearer(request: APIRequestContext): Promise<string> {
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: ownerCredentials(),
    failOnStatusCode: false,
  });
  expect(login.status(), 'the acceptance owner must be able to sign in to the API').toBe(200);
  const body = (await login.json()) as { accessToken?: string };
  expect(body.accessToken, 'login must issue an access token').toBeTruthy();
  return body.accessToken as string;
}

/**
 * The first reception visit this branch holds, or `null`.
 *
 * DISCOVERED, never created. This is what lets the two `NEEDS DATA` cases below
 * be positive proofs the day a visit exists and honest not-found assertions
 * while none does, without either branch being a skip.
 *
 * A non-200 answer returns `null` deliberately: the case that calls this also
 * asserts the list read itself succeeds, so a broken read is reported there
 * rather than silently becoming "no data".
 */
async function firstReceptionId(request: APIRequestContext, token: string): Promise<string | null> {
  const response = await request.get(
    `${API}/api/v1/receptions?companyId=${COMPANY_A}&branchId=${BRANCH_A}&limit=1`,
    { headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false }
  );
  if (response.status() !== 200) return null;
  const body = (await response.json()) as {
    items?: readonly { id?: string }[];
    data?: { items?: readonly { id?: string }[] };
  };
  const items = body.items ?? body.data?.items ?? [];
  return items[0]?.id ?? null;
}

/* ------------------------------------------------------------------ *
 * Page helpers
 * ------------------------------------------------------------------ */

/**
 * Names one half of the branch target, whichever control the session produced.
 *
 * `BranchTargetFields` and `ReceptionQueueScreen.ScopeField` both render a
 * SELECT over the session's resolved identifiers when it resolves to any, and a
 * plain text input when it resolves to none (an empty resolved list means
 * unrestricted within the workspace, not "no access"). The acceptance owner is
 * unrestricted and the acceptance reader is scoped to Company A / Branch A, so
 * both shapes really occur in this suite and a helper that assumed one would
 * fail on the other account for a reason that is not a defect.
 */
async function nameScope(field: Locator, value: string): Promise<void> {
  const tag = await field.evaluate((element) => element.tagName.toLowerCase());
  if (tag === 'select') await field.selectOption(value);
  else await field.fill(value);
}

/** The rendered text of the page, lower-cased, after the segment has streamed. */
async function bodyText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).toLowerCase();
}

/**
 * Waits for the dashboard segment to render past its loading skeleton.
 *
 * `page.goto` resolves at `load`, and every P1-28 route is an async server
 * component, so Next streams `(dashboard)/loading.tsx` into `main` first — whose
 * entire text is the `sr-only` "Loading". `main` belongs to the LAYOUT, so
 * `toBeVisible()` is satisfied by the skeleton and says nothing about the
 * segment. `isolation.spec.ts` recorded exactly this: seven assertions there had
 * begun measuring the skeleton, and passed. The same guard is used here.
 */
async function segmentRendered(page: Page, route: string): Promise<void> {
  const main = page.getByRole('main');
  await expect(main, `${route} rendered no main landmark`).toBeVisible();
  await expect
    .poll(async () => (await main.innerText()).trim().length, {
      message: `${route} never rendered past the loading skeleton`,
    })
    .toBeGreaterThan(40);
}

/* ================================================================== *
 * 1 — every P1-28 route exists in the RUNNING application
 * ================================================================== */

test.describe('every P1-28 route is reachable and renders', () => {
  for (const locale of LOCALES) {
    test(`${locale}: the eight screens load without an error state`, async ({ page }) => {
      test.setTimeout(90_000);
      for (const route of phaseRoutes(locale)) {
        const response = await page.goto(route);
        // A 404 here means a route that exists in the repository and not in the
        // running application — the exact failure a build-time test cannot see,
        // and the exact failure this phase already shipped once at the
        // walk-in → check-in seam.
        expect(response?.status(), route).toBeLessThan(400);
        await segmentRendered(page, route);
        // Next renders its own overlay on a server exception; the app renders
        // its own error card on a failed read. Neither is acceptable on a first
        // load with a valid session and a full set of permissions.
        await expect(page.locator('body'), route).not.toContainText('Application error');
        await expect(page.locator('body'), route).not.toContainText('Unhandled Runtime Error');
        await expect(page.locator('body'), route).not.toContainText(
          say(locale, 'state.error.title')
        );
      }
    });
  }
});

test.describe('no P1-28 screen renders a raw message key', () => {
  for (const locale of LOCALES) {
    test(`${locale}: nothing that looks like a translation key reaches the page`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      /*
       * `translate()` is `messages[key] ?? key`, so a value with no label
       * renders `receptions.origin.walk_in` to the operator and NOTHING fails —
       * not typecheck, not lint, not a test, not the build. Two of these shipped
       * in P1-27 and were caught only by an adversarial review of the finished
       * branch.
       *
       * WHAT THIS COVERS AND WHAT IT DOES NOT. A missing label for a LITERAL key
       * is already a build error, because `translate()` takes `keyof Messages`.
       * The runtime risk is `translateDynamic`, whose key is built from server
       * or vocabulary data and cannot be typed — and P1-28 leans on it heavily:
       * every appointment status, every reception status and every reception
       * origin renders through it. Those render on an EMPTY database, because a
       * status filter renders every one of its options, so they are covered
       * here. A label that needs a row (an evidence kind on a real visit) is
       * not, and `tests/server-vocabularies.test.ts` is what covers those.
       */
      const routes = phaseRoutes(locale);
      for (const route of routes) {
        await page.goto(route);
        await segmentRendered(page, route);
        await page.waitForLoadState('networkidle');
        const text = (await page.locator('body').innerText()) ?? '';
        /*
         * A key is `segment.segment[.segment]` with no spaces, anchored to this
         * product's own namespaces so an ordinary sentence containing a full
         * stop cannot match. The lookbehind excludes an email host: the
         * acceptance accounts are `…@crm.local`, whose domain matched the first
         * version of P1-27's pattern and made the guard fail on real content. A
         * guard that cries wolf gets deleted, so it is narrowed rather than
         * loosened.
         */
        const keys =
          text.match(
            /(?<![@\w.])(?:appointments|receptions|nav|state|form|action|admin|field)\.[a-zA-Z]+\.?\w*/g
          ) ?? [];
        expect(keys, `${route} rendered raw message key(s): ${keys.join(', ')}`).toEqual([]);
      }
    });
  }
});

/* ================================================================== *
 * 2 — the screens are reachable without typing a URL
 * ================================================================== */

test.describe('the P1-28 modules are reachable from the sidebar', () => {
  test('a signed-in operator can navigate to the calendar, the queue and walk-in intake', async ({
    page,
  }) => {
    /*
     * Both P1-27 duplicate queues shipped with routes and no way in: every test
     * passed, the build compiled, and no operator could have found them. This is
     * the assertion that could not have been made from inside the repository,
     * and `navigation.ts` flipped three entries to `available` in this phase.
     */
    await page.goto('/en');
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await expect(nav).toBeVisible();

    for (const key of ['nav.appointments', 'nav.receptions', 'nav.walkIn'] as const) {
      await expect(
        nav.getByRole('link', { name: say('en', key), exact: true }),
        `the sidebar offers no way into ${key}`
      ).toBeVisible();
    }

    await nav.getByRole('link', { name: say('en', 'nav.receptions'), exact: true }).click();
    await expect(page).toHaveURL(/\/en\/receptions$/);
    await expect(page.getByRole('main')).toContainText(say('en', 'receptions.queue.idleTitle'));
  });
});

/* ================================================================== *
 * 3 — the calendar refuses to read before a branch target is chosen
 * ================================================================== */

test.describe('the appointment calendar reads only for a named branch', () => {
  test('it shows the idle state and issues no read until a target is submitted', async ({
    page,
  }) => {
    /*
     * `GET /appointments` REQUIRES `companyId` and `branchId` and the server
     * refuses to guess (`P1-18-A-01`), so the results table is a separately
     * MOUNTED component: before a target is submitted the component that would
     * issue the read does not exist.
     *
     * OBSERVED ON THE CHANNEL THE BROWSER ACTUALLY USES. The read is a Server
     * Action, which reaches the network as a POST to the WEB origin — every API
     * call is made by the Next.js server process, so a listener filtered on
     * `/api/v1/` would see nothing whatever happened and could not fail. That
     * vacuity is `P1-27-QA-003`; this counts POSTs to the web origin instead,
     * and carries the positive control that makes a negative worth anything.
     */
    const observed: string[] = [];
    const posts: string[] = [];
    page.on('request', (request) => {
      observed.push(request.url());
      if (request.method() === 'POST') posts.push(request.url());
    });

    await page.goto('/en/appointments');
    await segmentRendered(page, '/en/appointments');

    // Idle: the screen states that nothing is loaded, rather than showing an
    // empty table that would read as "this branch has no appointments".
    await expect(page.getByRole('main')).toContainText(
      say('en', 'appointments.calendar.idleTitle')
    );
    await expect(page.getByRole('main')).toContainText(say('en', 'appointments.calendar.idleBody'));

    // Pressing Show with no target must refuse LOCALLY, not spend a request.
    const before = posts.length;
    await page.getByRole('button', { name: say('en', 'appointments.calendar.show') }).click();
    await expect(page.getByText(say('en', 'field.required')).first()).toBeVisible();
    expect(posts.length - before, 'an incomplete branch target must not issue a read').toBe(0);

    // The positive control, twice over: the listener really is wired, and a
    // COMPLETE target really does issue the read. Without this the assertion
    // above would also pass on a page that made no requests at all.
    await nameScope(page.getByLabel(say('en', 'admin.scope.companyId')), COMPANY_A);
    await nameScope(page.getByLabel(say('en', 'admin.scope.branchId')), BRANCH_A);
    await page.getByRole('button', { name: say('en', 'appointments.calendar.show') }).click();

    await expect
      .poll(() => posts.length - before, {
        message: 'naming a branch target issued no read at all',
      })
      .toBeGreaterThan(0);
    expect(observed.length, 'the listener saw no requests at all').toBeGreaterThan(0);

    /*
     * And the answer is a STATE, not a blank region. The database is empty of
     * business data by policy, so "no appointments in this range" is the correct
     * outcome — and the screen says exactly that, rather than the table's
     * generic empty state, which would make a claim about the whole branch on
     * the evidence of one range.
     */
    await expect(page.getByRole('main')).toContainText(
      say('en', 'appointments.calendar.noneInRange'),
      { timeout: 20_000 }
    );
  });

  test('an inverted range is refused beside the field, not relayed from the server', async ({
    page,
  }) => {
    // The route answers 422 for an inverted range rather than an empty page, so
    // the screen refuses it locally. A refusal the screen can explain beside the
    // field beats one it has to relay.
    await page.goto('/en/appointments');
    await segmentRendered(page, '/en/appointments');

    await nameScope(page.getByLabel(say('en', 'admin.scope.companyId')), COMPANY_A);
    await nameScope(page.getByLabel(say('en', 'admin.scope.branchId')), BRANCH_A);
    await page.getByLabel(say('en', 'appointments.calendar.fromDay')).fill('2026-08-20');
    await page.getByLabel(say('en', 'appointments.calendar.toDay')).fill('2026-08-10');
    await page.getByRole('button', { name: say('en', 'appointments.calendar.show') }).click();

    await expect(page.getByRole('main')).toContainText(
      say('en', 'appointments.calendar.rangeInverted')
    );
  });
});

/* ================================================================== *
 * 4 — booking is BLOCKED, honestly, and that is the truth to assert
 * ================================================================== */

test.describe('the booking screen states the blocked truth rather than offering a path', () => {
  for (const locale of LOCALES) {
    test(`${locale}: an empty appointment-type catalogue blocks booking and says why`, async ({
      page,
    }) => {
      /*
       * NON-NEGOTIABLE, AND THE REASON THIS CASE IS WRITTEN THIS WAY.
       *
       * `apt.appointment_types` is EMPTY in the acceptance database, because no
       * fake business data ships and no operation in this phase populates a
       * catalogue. An appointment therefore cannot be booked, and the correct
       * assertion is the sentence the screen shows — not a seeded row that would
       * manufacture a green booking path. A test that invents data to pass is
       * worse than a missing test: it reports a capability the product does not
       * have.
       *
       * Three things are asserted together, because any one alone would be
       * satisfiable by a broken screen:
       *
       *   1. the empty catalogue is stated in DOMAIN words ("not set up"), not
       *      as an error and not as a retryable failure — zero rows is the
       *      catalogue WORKING;
       *   2. the failed-read wording is ABSENT, so an empty catalogue is never
       *      reported as a fault (the two are different renderable facts);
       *   3. submit is DISABLED, so the screen does not invite a submission the
       *      operation would refuse.
       */
      const route = `/${locale}/appointments/new`;
      await page.goto(route);
      await segmentRendered(page, route);

      const main = page.getByRole('main');
      await expect(main).toContainText(say(locale, 'appointments.book.noTypes'));
      await expect(
        main,
        'an EMPTY catalogue was reported as a failed read; they are different facts'
      ).not.toContainText(say(locale, 'appointments.book.catalogueUnavailable'));

      await expect(
        page.getByRole('button', { name: say(locale, 'appointments.book.submit') }),
        'the form invites a booking that cannot succeed'
      ).toBeDisabled();
    });
  }
});

/* ================================================================== *
 * 5 — the reception queue: branch-scoped, honest, graph-derived
 * ================================================================== */

test.describe('the reception queue is a board for one named branch', () => {
  test('it reads nothing until a branch is named, then states a real result', async ({ page }) => {
    const posts: string[] = [];
    const observed: string[] = [];
    page.on('request', (request) => {
      observed.push(request.url());
      if (request.method() === 'POST') posts.push(request.url());
    });

    await page.goto('/en/receptions');
    await segmentRendered(page, '/en/receptions');
    await expect(page.getByRole('main')).toContainText(say('en', 'receptions.queue.idleTitle'));

    const before = posts.length;
    await page.getByRole('button', { name: say('en', 'receptions.queue.show') }).click();
    await expect(page.getByText(say('en', 'field.required')).first()).toBeVisible();
    expect(posts.length - before, 'an incomplete branch target must not issue a read').toBe(0);

    await nameScope(page.getByLabel(say('en', 'receptions.checkIn.company')), COMPANY_A);
    await nameScope(page.getByLabel(say('en', 'receptions.checkIn.branch')), BRANCH_A);
    await page.getByRole('button', { name: say('en', 'receptions.queue.show') }).click();

    await expect
      .poll(() => posts.length - before, { message: 'naming a branch issued no read at all' })
      .toBeGreaterThan(0);
    expect(observed.length, 'the listener saw no requests at all').toBeGreaterThan(0);

    // The board's own honest sentence for zero rows — never the table's generic
    // empty state, which would claim something about the whole branch.
    await expect(page.getByRole('main')).toContainText(say('en', 'receptions.queue.noneMatching'), {
      timeout: 20_000,
    });
    // And the ordering is STATED, because the operation publishes no total and
    // the board must not imply one.
    await expect(page.getByRole('main')).toContainText(say('en', 'receptions.queue.orderingNote'));
  });

  test('the status vocabulary renders as labels, and an empty board offers no close', async ({
    page,
  }) => {
    /*
     * The terminal-close affordance is derived from `RECEPTION_TRANSITIONS`
     * through `receptionAffordances`, per ROW. With no visits there is no row
     * to observe, and this suite will not create one — see the header.
     *
     * What IS observable, and what this case asserts:
     *
     *   1. the six statuses the graph is defined over render as translated
     *      LABELS in the filter. Those go through `translateDynamic`, the one
     *      key shape the compiler cannot check, so an unlabelled status would
     *      reach an operator as `receptions.status.closed_without_work`.
     *   2. a board holding no visit offers NO close affordance anywhere. The
     *      affordance is a row action; a page rendering one without a row would
     *      be offering a custody release against nothing.
     *
     * NEEDS DATA: that a `converted` row offers no close and an `opened` row
     * does is unprovable in a browser until a visit exists. `check-in/closure.ts`
     * and its unit suite hold the graph itself.
     */
    await page.goto('/en/receptions');
    await segmentRendered(page, '/en/receptions');

    const filter = page.getByLabel(say('en', 'receptions.queue.statusFilter'));
    const options = (await filter.locator('option').allInnerTexts()).map((text) => text.trim());
    for (const status of [
      'opened',
      'inspecting',
      'authorized',
      'converted',
      'closed_without_work',
      'refused',
    ]) {
      const label = say('en', `receptions.status.${status}`);
      expect(options, `the queue filter does not offer ${status} as a label`).toContain(label);
    }

    await nameScope(page.getByLabel(say('en', 'receptions.checkIn.company')), COMPANY_A);
    await nameScope(page.getByLabel(say('en', 'receptions.checkIn.branch')), BRANCH_A);
    await page.getByRole('button', { name: say('en', 'receptions.queue.show') }).click();
    await expect(page.getByRole('main')).toContainText(say('en', 'receptions.queue.noneMatching'), {
      timeout: 20_000,
    });

    await expect(
      page.getByRole('link', { name: say('en', 'receptions.queue.releaseVehicle') }),
      'a board holding no visit rendered a custody-release affordance'
    ).toHaveCount(0);
  });
});

/* ================================================================== *
 * 6 — the check-in wizard: the start screen, and the step registry
 * ================================================================== */

test.describe('the check-in wizard', () => {
  test('the start screen renders its whole form and states the empty fuel catalogue honestly', async ({
    page,
  }) => {
    await page.goto('/en/receptions/check-in');
    await segmentRendered(page, '/en/receptions/check-in');

    const form = page.getByRole('form', { name: say('en', 'receptions.checkIn.formLabel') });
    await expect(form).toBeVisible();
    for (const key of [
      'receptions.checkIn.targetLegend',
      'receptions.checkIn.originLegend',
      'receptions.checkIn.employeeLegend',
      'receptions.checkIn.intakeLegend',
    ] as const) {
      await expect(form, `the ${key} section is missing`).toContainText(say('en', key));
    }
    await expect(
      page.getByRole('button', { name: say('en', 'receptions.checkIn.submit') })
    ).toBeVisible();

    // `rec.fuel_levels` is empty. The screen must say the catalogue is not
    // configured — not that it failed. The two are different facts and only one
    // of them is retryable.
    await expect(page.getByRole('main')).toContainText(say('en', 'receptions.checkIn.fuelEmpty'));
    await expect(
      page.getByRole('main'),
      'an empty catalogue was reported as a failed read'
    ).not.toContainText(say('en', 'receptions.checkIn.fuelUnavailable'));
  });

  test('a visit loads its thirteen-step registry — or the absent visit reads as not found', async ({
    page,
    request,
  }) => {
    /*
     * NEEDS DATA, and it never skips.
     *
     * The visit is DISCOVERED through the real API rather than created. Two
     * branches, both of which assert:
     *
     *   - a visit exists → open it and require the whole step registry to
     *     render. The registry is the wizard's extension point: the shell knows
     *     nothing about any step, so a step whose component threw would simply
     *     be missing and nothing else would fail.
     *   - no visit exists (the state of an empty acceptance database) → the
     *     per-visit route must render an honest not-found or denial and NOT the
     *     wizard. A blank frame, an error card, or a wizard shell over no record
     *     are all failures here.
     */
    const token = await ownerBearer(request);
    const list = await request.get(
      `${API}/api/v1/receptions?companyId=${COMPANY_A}&branchId=${BRANCH_A}&limit=1`,
      { headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false }
    );
    // The discovery read itself must work, or "no data" would be indistinguishable
    // from "the list is broken" — the exact confusion this file exists to end.
    expect(list.status(), 'the reception list read must succeed for the owner').toBe(200);

    const receptionId = await firstReceptionId(request, token);
    const route = `/en/receptions/check-in/${receptionId ?? ABSENT_ID}`;
    await page.goto(route);
    await segmentRendered(page, route);
    const text = await bodyText(page);

    if (receptionId === null) {
      const notFound = say('en', 'state.notFound.title').toLowerCase();
      const denied = say('en', 'state.denied.title').toLowerCase();
      expect(
        text.includes(notFound) || text.includes(denied),
        'a visit that does not exist rendered neither a not-found nor a denial'
      ).toBe(true);
      expect(text, 'a wizard shell rendered over a record that does not exist').not.toContain(
        say('en', 'receptions.wizard.stepsLabel').toLowerCase()
      );
      expect(text, 'an absent record was reported as a fault').not.toContain(
        say('en', 'state.error.title').toLowerCase()
      );
      return;
    }

    const steps = page.getByRole('navigation', { name: say('en', 'receptions.wizard.stepsLabel') });
    await expect(steps, 'the wizard rendered no step registry').toBeVisible();
    for (const key of [
      'receptions.steps.confirm.title',
      'receptions.steps.parties.title',
      'receptions.steps.complaints.title',
      'receptions.steps.inspection.title',
      'receptions.steps.damage.title',
      'receptions.steps.readings.title',
      'receptions.steps.warningLights.title',
      'receptions.steps.contents.title',
      'receptions.steps.media.title',
      'receptions.steps.signature.title',
      'receptions.steps.refusal.title',
      'receptions.steps.summary.title',
      'receptions.steps.convert.title',
    ] as const) {
      await expect(steps, `the registry is missing ${key}`).toContainText(say('en', key));
    }
  });
});

/* ================================================================== *
 * 7 — the walk-in → check-in handoff, the seam that was dead-wired once
 * ================================================================== */

test.describe('the walk-in intake hands off to check-in', () => {
  test('the address the intake builds resolves to the check-in screen', async ({ page }) => {
    /*
     * THE DEFECT THIS CASE IS ABOUT.
     *
     * `CHECK_IN_WIZARD_PATH` read `/reception/check-in` (singular) while the
     * wizard mounted at `/receptions/check-in` (plural), and nothing noticed,
     * because the producing end was switched off: the intake passed
     * `checkInAvailable={false}`, so the only code reading the constant never
     * rendered. A shared constant does not make two ends agree.
     *
     * Both ends are walked here in the running application: the producing screen
     * exists, and the address it builds — locale segment, plural `receptions`,
     * the two documented query parameters — lands on the check-in screen rather
     * than a 404. The unit suite pins the constant to the directory; only a
     * browser can say the served application agrees.
     */
    await page.goto('/en/reception/walk-in');
    await segmentRendered(page, '/en/reception/walk-in');
    await expect(page.getByRole('main')).toContainText(
      say('en', 'receptions.intake.customer.heading')
    );

    const handoff = `/en/receptions/check-in?customerId=${ABSENT_ID}&vehicleId=${ABSENT_ID_TWO}`;
    const response = await page.goto(handoff);
    expect(response?.status(), 'the handoff address does not resolve').toBeLessThan(400);
    await segmentRendered(page, handoff);
    await expect(page.getByRole('main')).toContainText(say('en', 'receptions.checkIn.description'));
  });

  test('a pair that does not resolve starts the screen empty rather than erroring', async ({
    page,
  }) => {
    /*
     * The refusals are "start empty", not an error state, because an operator
     * who navigated here directly is in exactly the same position. A customer
     * that does not read back leaves only a uuid, and this screen renders names,
     * never identifiers.
     *
     * NEEDS DATA: the POSITIVE round-trip — a real customer and vehicle handed
     * over and pre-selected, showing `receptions.checkIn.handoffApplied` — needs
     * a customer and a vehicle to exist. It is asserted at the component tier in
     * `apps/web/tests/reception-walkin-handoff.test.ts` against a mocked read,
     * which is a fixture and not integration evidence; this case covers the
     * refusal half against the real stack, where the customer read genuinely
     * happens and genuinely comes back empty.
     */
    for (const query of [
      // A well-formed pair naming nothing: the customer read is really issued.
      `customerId=${ABSENT_ID}&vehicleId=${ABSENT_ID_TWO}`,
      // A half pair. `parseWalkInHandoff` refuses it before any request.
      `customerId=${ABSENT_ID}`,
      // A malformed identifier.
      'customerId=not-a-uuid&vehicleId=also-not-a-uuid',
    ]) {
      const route = `/en/receptions/check-in?${query}`;
      await page.goto(route);
      await segmentRendered(page, route);
      const main = page.getByRole('main');
      await expect(main, `${route} claimed a handoff it could not resolve`).not.toContainText(
        say('en', 'receptions.checkIn.handoffApplied')
      );
      await expect(
        main,
        `${route} rendered an error for an unresolvable handoff`
      ).not.toContainText(say('en', 'state.error.title'));
      // Still the working screen: an unusable link must not cost the operator
      // the page they navigated to.
      await expect(main, `${route} did not render the check-in form`).toContainText(
        say('en', 'receptions.checkIn.targetLegend')
      );
    }
  });
});

/* ================================================================== *
 * 8 — the acknowledgement document
 * ================================================================== */

test.describe('the reception acknowledgement', () => {
  test('an unreadable visit prints a not-found, never a sheet with empty sections', async ({
    page,
    request,
  }) => {
    /*
     * `F1`, and it is the finding that makes this case worth writing. A failed
     * section read answers `rows: []`, which is indistinguishable from an empty
     * section unless the status travels with it — and the sheet used to print
     * "no records are recorded on this visit" over a read that had failed. An
     * absence nobody observed, asserted on the copy a customer signs and takes
     * away.
     *
     * The route-level shape of the same rule is what a browser can prove without
     * data: when the VISIT cannot be read there is no document, and the page
     * must say so rather than print a sheet whose every section reads empty.
     *
     * NEEDS DATA: the per-section notice — `receptions.acknowledgement
     * .sectionUnreadable`, "This section could not be read … That is not a
     * statement that nothing is recorded" — needs a readable visit whose party,
     * authorization or evidence list fails. Both halves are unreachable while
     * `rec.reception_visits` is empty, and this suite will not seed one.
     * `apps/web/tests/reception-acknowledgement.test.ts` holds that branch at
     * the component tier.
     */
    const token = await ownerBearer(request);
    const receptionId = await firstReceptionId(request, token);
    const route = `/en/receptions/check-in/${receptionId ?? ABSENT_ID}/acknowledgement`;
    await page.goto(route);
    await segmentRendered(page, route);
    const text = await bodyText(page);

    if (receptionId === null) {
      const notFound = say('en', 'state.notFound.title').toLowerCase();
      const denied = say('en', 'state.denied.title').toLowerCase();
      expect(
        text.includes(notFound) || text.includes(denied),
        'an acknowledgement for a visit that does not exist rendered neither state'
      ).toBe(true);
      // The load-bearing half: no sheet, so no section can read as an observed
      // absence. The footer note is printed on every real document and on
      // nothing else.
      expect(text, 'a handover sheet was printed for a visit that could not be read').not.toContain(
        say('en', 'receptions.acknowledgement.footerNote').toLowerCase()
      );
      expect(text, 'an absent record was reported as a fault').not.toContain(
        say('en', 'state.error.title').toLowerCase()
      );
      return;
    }

    await expect(page.getByRole('main')).toContainText(
      say('en', 'receptions.acknowledgement.visitHeading')
    );
    await expect(page.getByRole('main')).toContainText(
      say('en', 'receptions.acknowledgement.footerNote')
    );
  });
});

/* ================================================================== *
 * 9 — no P1-28 screen puts a scope, or a search term, into the address bar
 * ================================================================== */

test.describe('nothing this phase reads reaches the address bar', () => {
  test('no branch target and no identifier appears in a URL the browser navigates to', async ({
    page,
  }) => {
    /*
     * `companyId`/`branchId` are a resource selector this phase legitimately
     * SENDS — as a query pair on the API request the SERVER makes, through the
     * one named door `branchTargetQuery`. What must not happen is the browser's
     * own address carrying them: a URL becomes history, proxy logs and the
     * `Referer` header. `check-p1-28-access.mjs` rule 5 enforces the source-side
     * rule; this observes the running application.
     */
    await page.goto('/en/receptions');
    await segmentRendered(page, '/en/receptions');
    await nameScope(page.getByLabel(say('en', 'receptions.checkIn.company')), COMPANY_A);
    await nameScope(page.getByLabel(say('en', 'receptions.checkIn.branch')), BRANCH_A);
    await page.getByRole('button', { name: say('en', 'receptions.queue.show') }).click();
    await expect(page.getByRole('main')).toContainText(say('en', 'receptions.queue.noneMatching'), {
      timeout: 20_000,
    });

    expect(page.url(), 'the queue put its branch target into the address bar').not.toContain(
      COMPANY_A
    );
    expect(page.url(), 'the queue put its branch target into the address bar').not.toContain(
      BRANCH_A
    );

    await page.goto('/en/appointments');
    await segmentRendered(page, '/en/appointments');
    await nameScope(page.getByLabel(say('en', 'admin.scope.companyId')), COMPANY_A);
    await nameScope(page.getByLabel(say('en', 'admin.scope.branchId')), BRANCH_A);
    await page.getByRole('button', { name: say('en', 'appointments.calendar.show') }).click();
    await expect(page.getByRole('main')).toContainText(
      say('en', 'appointments.calendar.noneInRange'),
      { timeout: 20_000 }
    );
    expect(page.url(), 'the calendar put its branch target into the address bar').not.toContain(
      BRANCH_A
    );
  });

  test('no request the browser issues carries a tenant parameter', async ({ page }) => {
    const observed: string[] = [];
    const scoped: string[] = [];
    page.on('request', (request) => {
      observed.push(request.url());
      // `tenantId` is a selector on NO operation anywhere in this platform: a
      // tenant is resolved from the session and never asserted by a caller.
      if (/[?&]tenant[_A-Za-z]*=/i.test(request.url())) scoped.push(request.url());
    });

    for (const route of phaseRoutes('en')) {
      await page.goto(route);
      await segmentRendered(page, route);
    }
    await page.waitForLoadState('networkidle');

    expect(observed.length, 'the listener saw no requests at all').toBeGreaterThan(0);
    expect(scoped, scoped.join('\n')).toHaveLength(0);
  });
});

/* ================================================================== *
 * 10 — a reader-only principal is DENIED, and the denial is a denial
 * ================================================================== */

test.describe('a read-only operator meets a denial, not an empty screen', () => {
  /*
   * A fresh, signed-out context: the captured session belongs to the owner, and
   * these cases are about a different principal entirely.
   */
  test.use({ storageState: { cookies: [], origins: [] } });

  /**
   * Signs in as the reader through the real form.
   *
   * Deliberately a UI sign-in rather than a hand-built cookie, for the reason
   * `auth.setup.ts` gives: the session is an `httpOnly` cookie set by a Server
   * Action, so driving the form proves the form, the action, the API contract
   * and the cookie all agree. `getByRole('textbox', …)` for the password because
   * `getByLabel` matches an accessible name as a SUBSTRING and the reveal
   * control inside the field is named "Show password".
   */
  async function signInAsReader(page: Page): Promise<void> {
    const { email, password } = readerCredentials();
    await page.goto('/en/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/en(\?.*)?$/, { timeout: 20_000 });
  }

  test('the booking form is refused, while the calendar and queue still read', async ({ page }) => {
    test.setTimeout(90_000);
    /*
     * THE PAIR IS THE POINT, and it is why `READER_PERMISSIONS` grants
     * `apt.appointment.read` and `rec.reception.read` and withholds the two
     * manage codes.
     *
     * An account denied EVERYTHING evidences nothing: "denied" and "empty" are
     * indistinguishable when both screens are blank, and a suite that only ever
     * saw denials could not tell a correct permission rule from a broken read.
     * So the same principal is shown to READ two screens and be REFUSED a third,
     * in one session.
     */
    await signInAsReader(page);

    // Refused: booking gates on `apt.appointment.manage`.
    await page.goto('/en/appointments/new');
    await segmentRendered(page, '/en/appointments/new');
    const denied = page.getByRole('main');
    await expect(denied).toContainText(say('en', 'state.denied.title'));
    await expect(denied).toContainText(say('en', 'state.denied.description'));
    // A DENIAL, not an emptiness: neither the form nor an empty-state card.
    await expect(
      page.getByRole('button', { name: say('en', 'appointments.book.submit') }),
      'a denied operator was shown the booking form'
    ).toHaveCount(0);
    await expect(
      denied,
      'a permission denial was rendered as "nothing here yet"'
    ).not.toContainText(say('en', 'state.empty.title'));

    // Allowed, and genuinely rendering: the calendar's own filter form.
    await page.goto('/en/appointments');
    await segmentRendered(page, '/en/appointments');
    await expect(
      page.getByRole('main'),
      'the reader was denied a screen its read permission covers'
    ).not.toContainText(say('en', 'state.denied.title'));
    await expect(page.getByRole('main')).toContainText(
      say('en', 'appointments.calendar.idleTitle')
    );

    await page.goto('/en/receptions');
    await segmentRendered(page, '/en/receptions');
    await expect(
      page.getByRole('main'),
      'the reader was denied the queue its read permission covers'
    ).not.toContainText(say('en', 'state.denied.title'));
    await expect(page.getByRole('main')).toContainText(say('en', 'receptions.queue.idleTitle'));
  });

  test('every write affordance is absent for the reader, and the wizard says why', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    /*
     * Each absence below is the permission rule of a control this phase built,
     * and each is checked in a real browser rather than only in a unit test —
     * `WRITE_PERMISSIONS` once had exactly one reference, its own declaration,
     * while ten P1-27 write forms rendered for any reader and every automated
     * tier was green.
     */
    await signInAsReader(page);

    await page.goto('/en/appointments');
    await segmentRendered(page, '/en/appointments');
    await expect(
      page.getByRole('link', { name: say('en', 'appointments.book.title') }),
      'a reader was offered the booking link'
    ).toHaveCount(0);

    await page.goto('/en/receptions');
    await segmentRendered(page, '/en/receptions');
    await expect(
      page.getByRole('link', { name: say('en', 'receptions.queue.checkInVehicle') }),
      'a reader was offered the open-a-visit link'
    ).toHaveCount(0);

    /*
     * The check-in START screen is the interesting one: `rec.reception.read`
     * opens the PAGE (the resume path is a read and a reader has a legitimate
     * reason to be here), while `rec.reception.manage` gates OPENING a visit. So
     * the correct answer is a page that renders and states its own partial
     * denial — not a missing page, and not a form that would be refused.
     */
    await page.goto('/en/receptions/check-in');
    await segmentRendered(page, '/en/receptions/check-in');
    const main = page.getByRole('main');
    await expect(main).toContainText(say('en', 'state.denied.title'));
    await expect(main, 'the partial denial does not say which permission is missing').toContainText(
      say('en', 'receptions.checkIn.createDenied')
    );
    await expect(
      page.getByRole('button', { name: say('en', 'receptions.checkIn.submit') }),
      'a reader was shown the open-the-visit control'
    ).toHaveCount(0);
  });
});
