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
 * appointment; taking reschedule, cancel or no-show on a real record; opening a
 * visit; the party-role, concern, condition, odometer, warning-light, contents,
 * damage, evidence, signature and refusal steps; approval; the two terminal
 * exits; the conversion to a work order; the acknowledgement's populated
 * sections and its per-section "could not be read" notice; and the
 * `P1-OD-025` media notice itself, whose only call site is a wizard step. Those
 * need `apt.appointment_types` (and `rec.fuel_levels`,
 * `apt.cancellation_reasons`) to be populatable by an administrator, plus at
 * least one customer and vehicle. When that arrives, the cases marked
 * `NEEDS DATA` below become positive paths without changing shape.
 *
 * WHAT IS NEVERTHELESS PROVED ABOUT EACH OF THOSE, WITHOUT A ROW. The absence of
 * data removes the positive path; it does not remove every claim. So each
 * blocked area carries the half a browser CAN establish against the real stack:
 * the appointment-originated check-in really asks the real calendar and states
 * the honest empty answer (§11); the origin XOR survives a change of mind (§11);
 * the fuel catalogue degrades the field and not the operation (§12); the
 * odometer/state-of-charge reading is exercisable and never reaches the address
 * bar (§12); the three lifecycle panels are absent over a record that could not
 * be read (§15); no capture control exists anywhere an operator can reach while
 * `P1-OD-025` is open (§16); and the whole surface discloses nothing of another
 * workspace, at both the browser and the API (§17).
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
 * A real bearer token for the branch-SCOPED reader.
 *
 * A separate helper rather than a parameter on `ownerBearer`, because the two
 * principals answer different questions and the difference is the whole point
 * of `narrowScope`: it refuses a company or branch outside the caller's grants
 * ONLY when the caller is restricted. The acceptance owner is unrestricted, so
 * for the owner that branch is unreachable by construction; the reader is the
 * principal for whom it fires.
 */
async function readerBearer(request: APIRequestContext): Promise<string> {
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: readerCredentials(),
    failOnStatusCode: false,
  });
  expect(login.status(), 'the acceptance reader must be able to sign in to the API').toBe(200);
  const body = (await login.json()) as { accessToken?: string };
  expect(body.accessToken, 'the reader login must issue an access token').toBeTruthy();
  return body.accessToken as string;
}

/**
 * The signed-in operator's DISPLAY NAME, read from the identity that issued the
 * session — never typed here.
 *
 * Needed because "the receiving employee defaults to the signed-in operator" is
 * only asserted by the whole rendered sentence. The screen renders
 * `You — <displayName>`; asserting the three characters "You" alone is very
 * nearly unfalsifiable, because 39 entries of `en.json` contain that substring
 * and any one of them anywhere in `main` satisfies it. A literal name would be
 * worse still: it would pin this suite to one bootstrap and pass on a screen
 * that had stopped reading the session at all.
 */
async function ownerDisplayName(request: APIRequestContext): Promise<string> {
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: ownerCredentials(),
    failOnStatusCode: false,
  });
  expect(login.status(), 'the acceptance owner must be able to sign in to the API').toBe(200);
  const body = (await login.json()) as { user?: { displayName?: string } };
  const name = body.user?.displayName;
  expect(name, 'the login response carries no display name to assert against').toBeTruthy();
  return name as string;
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
    // Eight navigations, each waiting for its segment to stream, plus a
    // `networkidle` settle. The 30 s default is the per-TEST budget, not the
    // per-step one, so this case is one slow segment away from failing for a
    // reason that is not a defect. Same budget as the eight-route walk in §1.
    test.setTimeout(90_000);
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

/* ================================================================== *
 * 11 — the APPOINTMENT-ORIGINATED check-in path, against the real
 *      calendar, with nothing invented
 * ================================================================== */

test.describe('check-in can originate from an appointment', () => {
  test('the appointment origin asks the real calendar and states the honest empty answer', async ({
    page,
  }) => {
    /*
     * `ck_reception_visits_one_origin` allows exactly ONE origin, and the draft
     * is a discriminated union, so appointment and walk-in can never both be
     * submitted. The appointment path is the one that CHECKS IN a booking:
     * `rec.reception-create` moves it `confirmed → checked_in` in the same
     * transaction, which is why the picker offers only confirmed appointments.
     *
     * THIS CASE INVENTS NOTHING. It drives the real picker against the real
     * `GET /appointments` read and asserts the answer an empty branch actually
     * gives. What it proves without a row is the part that was structurally
     * unproven: that the appointment origin is offered at all, that the picker
     * refuses to spend a request before a branch target names one, that naming
     * the target really does issue the read, and that zero confirmed
     * appointments is stated in domain words rather than left as a blank region.
     */
    const observed: string[] = [];
    const posts: string[] = [];
    page.on('request', (request) => {
      observed.push(request.url());
      if (request.method() === 'POST') posts.push(request.url());
    });

    await page.goto('/en/receptions/check-in');
    await segmentRendered(page, '/en/receptions/check-in');

    // Both origins are offered, as RADIOS — the XOR is a single choice in the
    // accessibility tree, not two independent toggles that could both be set.
    const walkIn = page.getByRole('radio', { name: say('en', 'receptions.origin.walk_in') });
    const fromAppointment = page.getByRole('radio', {
      name: say('en', 'receptions.origin.appointment'),
    });
    await expect(walkIn, 'the walk-in origin is not offered').toBeVisible();
    await expect(fromAppointment, 'the appointment origin is not offered').toBeVisible();

    await fromAppointment.check();
    await expect(fromAppointment).toBeChecked();
    await expect(walkIn, 'both origins were selected at once').not.toBeChecked();

    // The appointment half replaces the walk-in half. A requester control still
    // rendered here would be collecting a value the operation refuses (422
    // `incoherent_reference`): the vehicle and the requester come from the
    // appointment itself.
    // By test id, not by label: `CustomerSelector` names itself with
    // `aria-labelledby` on a `role="group"` wrapper rather than a `<label>` for a
    // control, so a label locator here would be asserting on the shape of the
    // accessible name rather than on the control being gone.
    await expect(
      page.getByTestId('customer-selector'),
      'the walk-in requester control survived the switch to an appointment origin'
    ).toHaveCount(0);

    // No branch target yet, so the picker must not be usable and must SAY why
    // rather than answering an empty list the operator would read as "none".
    const load = page.getByRole('button', {
      name: say('en', 'receptions.checkIn.loadAppointments'),
    });
    await expect(load, 'the appointment picker was usable with no branch named').toBeDisabled();
    await expect(page.getByRole('main')).toContainText(say('en', 'receptions.checkIn.targetFirst'));

    const before = posts.length;
    await nameScope(page.getByLabel(say('en', 'receptions.checkIn.company')), COMPANY_A);
    await nameScope(page.getByLabel(say('en', 'receptions.checkIn.branch')), BRANCH_A);
    await expect(load, 'a named branch target did not enable the picker').toBeEnabled();
    await expect(
      page.getByRole('main'),
      'the "name a target first" hint outlived the target being named'
    ).not.toContainText(say('en', 'receptions.checkIn.targetFirst'));

    await load.click();

    /*
     * The positive control. Without it every assertion below would also hold on
     * a screen that issued no request at all — the `P1-27-QA-003` vacuity. The
     * read is a Server Action (`features/appointments/support-api.ts` is
     * `'use server'`), so it reaches the network as a POST to the WEB origin;
     * the API call itself is made by the Next.js server process and is invisible
     * to a browser listener, which is why nothing here filters on `/api/v1/`.
     */
    await expect
      .poll(() => posts.length - before, {
        message: 'asking for confirmed appointments issued no request at all',
      })
      .toBeGreaterThan(0);
    expect(observed.length, 'the listener saw no requests at all').toBeGreaterThan(0);

    /*
     * And the answer. `apt.appointments` is empty, so there are no confirmed
     * appointments — the truthful outcome, and the screen states it. It must not
     * be a denial (the acceptance owner holds `apt.appointment.read`) and it must
     * not be an error (zero rows is the read WORKING).
     */
    await expect(page.getByRole('main')).toContainText(
      say('en', 'receptions.checkIn.noConfirmedAppointments'),
      { timeout: 20_000 }
    );
    await expect(
      page.getByRole('main'),
      'a permitted read of the calendar was refused'
    ).not.toContainText(say('en', 'receptions.checkIn.appointmentsDenied'));
    await expect(
      page.getByRole('main'),
      'an empty calendar was reported as a fault'
    ).not.toContainText(say('en', 'state.error.title'));

    /*
     * NEEDS DATA: that CHOOSING a confirmed appointment fills the vehicle and
     * requester from the appointment, that the chosen row can be changed, and
     * that submitting moves the appointment `confirmed → checked_in`. All three
     * need one confirmed appointment to exist, which needs an appointment type,
     * a customer and a vehicle. `apps/web/tests/` holds them against mocked
     * reads, which are fixtures; this tier will not seed a row to turn a blocked
     * screen into a green path.
     */
  });

  test('switching back to walk-in restores the walk-in half and clears the appointment half', async ({
    page,
  }) => {
    /*
     * The XOR has to survive a change of mind. `switchOriginKind` drops the
     * other side's SELECTIONS as well as its kind, because a stale choice
     * silently resurrected by switching back is the database constraint being
     * circumvented in component state — invisible to every mocked tier, because
     * a mock is asked what it was told to return.
     */
    await page.goto('/en/receptions/check-in');
    await segmentRendered(page, '/en/receptions/check-in');

    await page.getByRole('radio', { name: say('en', 'receptions.origin.appointment') }).check();
    await expect(
      page.getByRole('button', { name: say('en', 'receptions.checkIn.loadAppointments') })
    ).toBeVisible();

    await page.getByRole('radio', { name: say('en', 'receptions.origin.walk_in') }).check();
    await expect(
      page.getByRole('button', { name: say('en', 'receptions.checkIn.loadAppointments') }),
      'the appointment picker outlived the switch back to walk-in'
    ).toHaveCount(0);
    // The walk-in half is back, with its own two controls.
    const requester = page.getByTestId('customer-selector');
    await expect(requester).toBeVisible();
    await expect(requester, 'the restored selector is not the requester').toContainText(
      say('en', 'receptions.checkIn.requester')
    );
    await expect(page.getByLabel(say('en', 'receptions.checkIn.walkInNote'))).toBeVisible();
  });
});

/* ================================================================== *
 * 12 — the intake facts the visit opens with: fuel and state of charge
 * ================================================================== */

test.describe('the opening intake facts', () => {
  for (const locale of LOCALES) {
    test(`${locale}: an empty fuel catalogue disables its picker without disabling the form`, async ({
      page,
    }) => {
      /*
       * `rec.fuel_levels` ships with ZERO rows, and that is the catalogue
       * WORKING rather than failing. Three separable facts, and a screen can get
       * any one of them wrong on its own:
       *
       *   1. the picker offers nothing, and is DISABLED rather than presenting an
       *      empty list the operator would read as a broken control;
       *   2. the reason is stated as "not configured", never as a failed read —
       *      `fuelUnavailable` is the OTHER fact and only that one is retryable;
       *   3. the FORM still works. `fuelLevelId` is nullable, so an unconfigured
       *      catalogue must degrade the field and not the operation. A screen
       *      that blocked check-in on an empty optional catalogue would be
       *      refusing every visit in the branch.
       *
       * NON-NEGOTIABLE: no fuel level is seeded to produce a populated picker.
       */
      const route = `/${locale}/receptions/check-in`;
      await page.goto(route);
      await segmentRendered(page, route);

      const fuel = page.getByLabel(say(locale, 'receptions.checkIn.fuelLevel'));
      await expect(fuel, 'an unconfigured catalogue left its picker usable').toBeDisabled();
      expect(
        await fuel.locator('option').count(),
        'an empty catalogue rendered options from somewhere'
      ).toBeLessThanOrEqual(1); // the placeholder only, if the control renders one

      await expect(page.getByRole('main')).toContainText(
        say(locale, 'receptions.checkIn.fuelEmpty')
      );
      await expect(
        page.getByRole('main'),
        'an EMPTY catalogue was reported as a failed read; they are different facts'
      ).not.toContainText(say(locale, 'receptions.checkIn.fuelUnavailable'));

      // The form is not held hostage by the optional field.
      await expect(
        page.getByRole('button', { name: say(locale, 'receptions.checkIn.submit') }),
        'an empty OPTIONAL catalogue disabled the whole check-in'
      ).toBeEnabled();
    });
  }

  test('state of charge is offered as an optional reading and accepts one', async ({ page }) => {
    // The EV counterpart of fuel. It is a free reading rather than a catalogue,
    // so it is the one opening intake fact that is fully exercisable with an
    // empty database — typed, held, and never put in the address bar.
    await page.goto('/en/receptions/check-in');
    await segmentRendered(page, '/en/receptions/check-in');

    const soc = page.getByLabel(say('en', 'receptions.checkIn.evSoc'));
    await expect(soc).toBeVisible();
    await expect(soc).toBeEnabled();
    await soc.fill('82.5');
    await expect(soc).toHaveValue('82.5');
    expect(page.url(), 'a vehicle reading reached the address bar').not.toContain('82.5');
  });
});

/* ================================================================== *
 * 13 — the staff-directory disposition, stated where it is exercised
 * ================================================================== */

test.describe('the receiving-employee control states what it opens', () => {
  test('the directory-scope disposition renders beside the control, in the running application', async ({
    page,
    request,
  }) => {
    /*
     * `P1-28-SEC-001`. There is no employee master, so "who received this
     * vehicle" is served by `iam.user-list` — which reads the WHOLE workspace
     * user directory, every account with its address and status. That overload
     * is a disposition, and a disposition recorded only in a document is one an
     * operator never meets. This asserts it is rendered where the capability is
     * exercised.
     *
     * `G-EMP` is the neighbouring statement: the platform records an identifier,
     * not an employee-register entry, and the default is the signed-in operator
     * — the one identity certainly present.
     */
    await page.goto('/en/receptions/check-in');
    await segmentRendered(page, '/en/receptions/check-in');

    const notice = page.getByTestId('employee-directory-scope');
    await expect(notice, 'the directory-scope disposition is not rendered').toBeVisible();
    await expect(notice).toContainText(say('en', 'receptions.checkIn.employeeDirectoryScope'));

    await expect(page.getByRole('main')).toContainText(
      say('en', 'receptions.checkIn.employeeHint')
    );
    /*
     * The WHOLE sentence, not the word.
     *
     * `CheckInStartScreen.tsx` renders `${employeeSelf} — ${sessionUserName}`
     * when the selected employee is the session user, and `employee.label` when
     * it is not. Asserting only `employeeSelf` — the three characters "You" —
     * proves almost nothing: 39 entries of the English catalogue contain that
     * substring, so any of them appearing anywhere in `main` would satisfy it,
     * including on a screen that had stopped reading the session entirely.
     *
     * The name is READ from the identity that issued this session rather than
     * written down here, so the assertion binds the rendered default to the
     * signed-in operator instead of to one bootstrap's fixture.
     */
    const displayName = await ownerDisplayName(request);
    await expect(
      page.getByRole('main'),
      'the receiving employee does not default to the signed-in operator, by name'
    ).toContainText(`${say('en', 'receptions.checkIn.employeeSelf')} — ${displayName}`);
  });
});

/* ================================================================== *
 * 14 — the walk-in intake: customer confirmation, then vehicle
 * ================================================================== */

test.describe('the walk-in intake confirms a customer before a vehicle', () => {
  for (const locale of LOCALES) {
    test(`${locale}: the intake opens on the customer station and offers no vehicle step yet`, async ({
      page,
    }) => {
      /*
       * The intake is ordered — customer, then vehicle, then the handoff — and
       * the order is the product rule, not decoration: a vehicle is received FOR
       * somebody, and the walk-in handoff carries the pair. What a browser can
       * prove with an empty database is the ordering itself and the honest
       * absence of the later stations.
       *
       * NON-NEGOTIABLE: no customer is created to advance the wizard. The create
       * paths are asserted as OFFERS — the affordance a receptionist facing a
       * brand-new customer needs — and never taken.
       */
      const route = `/${locale}/reception/walk-in`;
      await page.goto(route);
      await segmentRendered(page, route);

      const stations = page.getByRole('navigation', {
        name: say(locale, 'receptions.intake.steps'),
      });
      await expect(stations, 'the intake renders no station strip').toBeVisible();
      for (const key of [
        'receptions.intake.step.customer',
        'receptions.intake.step.vehicle',
        'receptions.intake.step.handoff',
      ] as const) {
        await expect(stations, `the station strip is missing ${key}`).toContainText(
          say(locale, key)
        );
      }
      // The FIRST station is the current one, and exactly one is.
      await expect(
        stations.locator('[aria-current="step"]'),
        'the intake does not mark exactly one current station'
      ).toHaveCount(1);
      await expect(stations.locator('[aria-current="step"]')).toHaveText(
        say(locale, 'receptions.intake.step.customer')
      );

      // The customer station itself, with both create offers beside the search
      // rather than behind a failed one.
      await expect(page.getByRole('main')).toContainText(
        say(locale, 'receptions.intake.customer.heading')
      );
      await expect(page.getByRole('main')).toContainText(
        say(locale, 'receptions.intake.customer.createOffer')
      );

      // The stated phone degradation (`G-CRM-PHONE`), rendered where a
      // receptionist would type a caller's number rather than in a help page.
      const phone = page.getByTestId('phone-search-notice');
      await expect(phone, 'the phone-search degradation is not stated at the intake').toBeVisible();
      await expect(phone).toContainText(say(locale, 'receptions.intake.phone.title'));

      // No handoff has happened, so the handoff panel must not be printed.
      await expect(
        page.getByRole('main'),
        'the intake printed its handoff panel before a customer or vehicle existed'
      ).not.toContainText(say(locale, 'receptions.intake.done.heading'));

      /*
       * NEEDS DATA: choosing a customer, choosing or linking a vehicle, and the
       * handoff panel's Continue link carrying the real pair into the wizard.
       * Each needs a customer and a vehicle to exist. The REFUSAL half of that
       * seam — an unresolvable pair starting the check-in screen empty — is
       * proved in section 7 above, against the real stack.
       */
    });
  }
});

/* ================================================================== *
 * 15 — the appointment lifecycle panels never render over a record
 *      that could not be read
 * ================================================================== */

test.describe('reschedule, cancel and no-show are panels on a real appointment', () => {
  test('an appointment that does not exist renders a not-found and no lifecycle control', async ({
    page,
  }) => {
    /*
     * The detail screen hosts all three lifecycle surfaces — `FE-003`
     * reschedule, `FE-004` cancel, `FE-005` no-show — and they are separate
     * authorities: `apt.appointment.manage` ARRANGES, `apt.appointment
     * .lifecycle.manage` ENDS. Both panels live inside the successful-read
     * branch, and this is the assertion that the branch really is exclusive.
     *
     * A control offered over a record the page could not read is not a cosmetic
     * defect: every one of these commands is a guarded write whose `If-Match`
     * comes from the very read that failed, so the button would be submitting a
     * version it never had. This is the shape P1-27 shipped ten times — a write
     * form rendered for a principal or a record that could not support it, with
     * every automated tier green.
     */
    const route = `/en/appointments/${ABSENT_ID}`;
    await page.goto(route);
    await segmentRendered(page, route);

    const main = page.getByRole('main');
    const text = (await main.innerText()).toLowerCase();
    const notFound = say('en', 'state.notFound.title').toLowerCase();
    const denied = say('en', 'state.denied.title').toLowerCase();
    expect(
      text.includes(notFound) || text.includes(denied),
      'an appointment that does not exist rendered neither a not-found nor a denial'
    ).toBe(true);
    await expect(main, 'an absent record was reported as a fault').not.toContainText(
      say('en', 'state.error.title')
    );

    // Not one of the three lifecycle surfaces, by its own heading …
    for (const key of [
      'appointments.reschedule.title',
      'appointments.cancel.title',
      'appointments.noShow.title',
      'appointments.detail.factsHeading',
    ] as const) {
      await expect(main, `${key} was rendered over an unreadable appointment`).not.toContainText(
        say('en', key)
      );
    }
    // … and not one of their controls.
    for (const key of [
      'appointments.reschedule.submit',
      'appointments.cancel.openDialog',
      'appointments.noShow.openDialog',
    ] as const) {
      await expect(
        page.getByRole('button', { name: say('en', key) }),
        `${key} was offered over an unreadable appointment`
      ).toHaveCount(0);
    }

    /*
     * NEEDS DATA: the positive paths — rescheduling into a new window (which is
     * also the only way an appointment becomes `confirmed`, since this contract
     * publishes no Confirm operation), cancelling with a reason from
     * `apt.cancellation_reasons`, and marking a no-show. Each needs a booked
     * appointment, which needs a populated `apt.appointment_types`, a customer
     * and a vehicle. Section 4 asserts why booking is blocked today.
     *
     * NOTE that `apt.cancellation_reasons` is empty as well, so even with an
     * appointment the cancel dialog would state `appointments.cancel.noReasons`
     * rather than offering a picker — a second catalogue this tier will not seed.
     */
  });
});

/* ================================================================== *
 * 16 — P1-OD-025: no capture control exists anywhere an operator can
 *      reach, and the notice that says so is wizard-gated
 * ================================================================== */

test.describe('reception media is blocked by a named open decision', () => {
  test('no P1-28 route an operator can reach offers a capture control of any kind', async ({
    page,
  }) => {
    // Eight navigations with three locator assertions each. The 30 s default is
    // the per-TEST budget; see the identical note in §9.
    test.setTimeout(90_000);
    /*
     * `P1-OD-025` is an OPEN Owner decision: no retention period, no permitted
     * kinds, no size ceiling, and no storage provider or scanner exists. So
     * reception media cannot be captured, and the deliverable is a notice
     * explaining that — never a control, and never a DISABLED control standing
     * in for one, which would assert the capability exists and this operator
     * lacks permission. That is a different and false statement, the same
     * distinction `P1-OD-017` forced on the P1-27 merge affordance.
     *
     * `tests/p1-28-reception-media.test.ts` reads `MediaDecisionNotice.tsx`'s own
     * source and fails on `<button`, `<input`, `<form`, `<a `, `<video`,
     * `<canvas`, `onClick` or `disabled`. That is a proof about ONE file. This
     * is the complement it cannot make: that no OTHER screen on the phase's
     * surface quietly grew one — the walk-in intake and the check-in start
     * screen being exactly where a "just add a photo" control would land.
     */
    for (const route of phaseRoutes('en')) {
      await page.goto(route);
      await segmentRendered(page, route);

      await expect(
        page.locator('input[type="file"]'),
        `${route} offers a file input while P1-OD-025 is open`
      ).toHaveCount(0);
      await expect(
        page.locator('[capture]'),
        `${route} offers a camera capture affordance while P1-OD-025 is open`
      ).toHaveCount(0);
      await expect(
        page.locator('video'),
        `${route} renders a video surface while P1-OD-025 is open`
      ).toHaveCount(0);
    }

    /*
     * NEEDS DATA, and stated rather than quietly omitted: the NOTICE itself —
     * `receptions.media.blocked` naming `P1-OD-025`, the questions the Owner has
     * to decide, and the honest ceiling of the shipped attachment chain — renders
     * only inside the check-in wizard's media step, which needs a reception visit
     * to exist. `MediaDecisionNotice` has exactly one call site (`MediaStep`), so
     * there is no route this tier can reach it through, and this suite will not
     * open a visit to manufacture one. What is asserted above is the half a
     * browser CAN establish: that the absence is real everywhere it can look.
     */
  });
});

/* ================================================================== *
 * 17 — Tenant B, through the P1-28 surface specifically
 * ================================================================== */

test.describe('the P1-28 surface discloses nothing of another workspace', () => {
  /*
   * `isolation.spec.ts` proves this for the Administration, CRM and Vehicle
   * screens and names ten routes; not one of them is an appointment or a
   * reception route, so the phase's own surface had no cross-tenant evidence at
   * any tier that talks to the real database.
   *
   * Tenant B is fixed by `scripts/dev/owner-acceptance/context.mjs`, exists, is
   * populated, and the acceptance owner holds NO membership in it. Every claim
   * below is "a Tenant A principal asks for a Tenant B thing and does not get
   * it", with the control that makes a denial mean something.
   */
  const TENANT_B = 'c0000000-0000-4000-8000-00000000000b';
  const COMPANY_B = 'c1000000-0000-4000-8000-00000000000b';
  const BRANCH_B = 'c1100000-0000-4000-8000-00000000000b';
  const TENANT_B_NAME = 'CRM Isolation Tenant B';

  /**
   * Renders a route and proves it really rendered FOR TENANT A before any
   * negative assertion is made against it.
   *
   * The control is the whole point, and `isolation.spec.ts` records why: a blank
   * page, a redirect to sign-in, an error boundary and a 404 all satisfy
   * `not.toContain('Tenant B')` perfectly. Three things are established first —
   * the session is Tenant A's (the shell prints the signed-in address), the
   * segment streamed past `(dashboard)/loading.tsx` rather than being measured as
   * a skeleton, and `main` holds real content.
   */
  async function renderedForTenantA(page: Page, route: string): Promise<string> {
    const { email } = ownerCredentials();
    await page.goto(route);
    await segmentRendered(page, route);
    const body = await bodyText(page);
    expect(body, `${route} does not show the signed-in Tenant A account`).toContain(
      email.toLowerCase()
    );
    expect(body, `${route} rendered the error boundary`).not.toContain(
      say('en', 'state.error.title').toLowerCase()
    );
    return body;
  }

  for (const route of phaseRoutes('en')) {
    test(`Tenant B never appears on ${route}`, async ({ page }) => {
      const body = await renderedForTenantA(page, route);
      expect(body, `${route} must not disclose Tenant B`).not.toContain(
        TENANT_B_NAME.toLowerCase()
      );
      expect(body, `${route} must not disclose a Tenant B identifier`).not.toContain(TENANT_B);
      expect(body, `${route} must not name the Tenant B company`).not.toContain(
        'isolation company b'
      );
      expect(body, `${route} must not name the Tenant B branch`).not.toContain(
        'isolation branch b'
      );
    });
  }

  test('the control itself can fail — a missing account marker is not tolerated', async ({
    page,
  }) => {
    /*
     * The positive control for the positive control. Signed out, the same route
     * redirects to sign-in: the shell and the account address are gone, and
     * every `not.toContain` above would still hold on that page. If this passes,
     * the seventeen cases above were measuring something.
     */
    await page.context().clearCookies();
    await expect(renderedForTenantA(page, '/en/receptions')).rejects.toThrow();
  });

  test('a Tenant B branch target does not widen either board', async ({ page }) => {
    /*
     * `companyId`/`branchId` are a resource SELECTOR this phase legitimately
     * sends — but a selector is a request, not a decision. The Backend resolves
     * the caller's own authority from the session and never from the field.
     * Typed into the real controls, against the real API.
     *
     * PRECISELY what the Backend does with the request, because the earlier
     * wording here said "refuses a target outside it" and that is true of only
     * one of the two principals: `narrowScope` raises `ERR-IAM-001` for a
     * RESTRICTED caller and skips the check for an unrestricted one, whose
     * boundary is the row predicate instead. This case runs as the unrestricted
     * acceptance owner, so what it asserts is the board it actually gets —
     * nothing of Tenant B in it — and the refusal branch is proved separately,
     * with the reader, in the API case below.
     */
    await page.goto('/en/receptions');
    await segmentRendered(page, '/en/receptions');
    await nameScope(page.getByLabel(say('en', 'receptions.checkIn.company')), COMPANY_B);
    await nameScope(page.getByLabel(say('en', 'receptions.checkIn.branch')), BRANCH_B);
    await page.getByRole('button', { name: say('en', 'receptions.queue.show') }).click();

    const main = page.getByRole('main');
    // Whatever the answer is, it is not Tenant B's data. The board may state a
    // denial or an empty result; it may not name another workspace.
    await expect
      .poll(async () => (await main.innerText()).trim().length, {
        message: 'the queue never answered the Tenant B target at all',
      })
      .toBeGreaterThan(40);
    const body = await bodyText(page);
    expect(body, 'the queue disclosed Tenant B').not.toContain(TENANT_B_NAME.toLowerCase());
    expect(body, 'the queue named the Tenant B branch').not.toContain('isolation branch b');
  });

  const BOARDS_FOR_B = [
    `/api/v1/appointments?companyId=${COMPANY_B}&branchId=${BRANCH_B}&limit=1`,
    `/api/v1/receptions?companyId=${COMPANY_B}&branchId=${BRANCH_B}&limit=1`,
  ] as const;

  test('a branch-scoped token is REFUSED both P1-28 boards for Tenant B', async ({ request }) => {
    /*
     * A REAL bearer token, obtained the way the web tier obtains one. The
     * browser session cookie cannot be used for this and must not be: it belongs
     * to the WEB origin and is `httpOnly` precisely so the browser never holds a
     * bearer token. Driving the API through `page.request` would return 401 for
     * want of an Authorization header on every probe, and the test would pass
     * while proving nothing about tenancy at all — the exact vacuity
     * `isolation.spec.ts` recorded.
     *
     * THE READER, NOT THE OWNER, AND THIS IS THE CORRECTION THAT MADE THE CASE
     * MEAN SOMETHING.
     *
     * It was written against the acceptance OWNER and asserted "must not answer
     * 200". It failed, and the failure was the test's, not the platform's:
     * `narrowScope` (`server/context/resolve-context.ts`) refuses a requested
     * company or branch outside the caller's grants with `ERR-IAM-001`, and it
     * skips that check entirely for an UNRESTRICTED caller — "unrestricted
     * callers hold everything in the tenant, so `held` being empty means no
     * narrowing, not nothing allowed". The acceptance owner is unrestricted, so
     * the owner is the one principal for whom this guard cannot fire; the case
     * had picked it and was measuring a branch that is inert by construction.
     * The reader is provisioned scoped to Company A / Branch A, which is what
     * turns the same probe into an exercise of the live refusal path.
     *
     * Measured here: 403 `ERR-IAM-001` on both boards, and 200 on its own
     * branch immediately afterwards — without which "it refused" would also be
     * true of an account that can read nothing at all.
     */
    const token = await readerBearer(request);

    for (const path of BOARDS_FOR_B) {
      const response = await request.get(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      });
      expect(
        response.status(),
        `${path} must not answer 200 to a branch-scoped token naming another workspace`
      ).not.toBe(200);
      // A refusal, not a fault: a 5xx here would be the server failing to
      // decide rather than deciding. The exact code is not pinned to one value
      // because the refusal may come from the authorization target or from the
      // record simply not being visible, and both are correct answers.
      expect([400, 401, 403, 404, 422], `${path} answered ${response.status()}`).toContain(
        response.status()
      );

      // And a denial must not describe what it is denying.
      const text = (await response.text()).toLowerCase();
      expect(text, 'a denial disclosed the other tenant').not.toContain(
        TENANT_B_NAME.toLowerCase()
      );
      expect(text, 'a denial echoed the other tenant id').not.toContain(TENANT_B.toLowerCase());
    }

    // The control that makes the two refusals above evidence rather than noise.
    for (const path of [
      `/api/v1/appointments?companyId=${COMPANY_A}&branchId=${BRANCH_A}&limit=1`,
      `/api/v1/receptions?companyId=${COMPANY_A}&branchId=${BRANCH_A}&limit=1`,
    ]) {
      const own = await request.get(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      });
      expect(own.status(), `the reader was refused its OWN branch on ${path}`).toBe(200);
    }
  });

  test('an unrestricted token gets an EMPTY board for Tenant B, never a Tenant B row', async ({
    request,
  }) => {
    /*
     * The other half of the same rule, asserted as what it is rather than as
     * what the previous version of this section wished it were.
     *
     * `companyId` and `branchId` are a RESOURCE SELECTOR on these two reads
     * (`P1-18-A-01`: the server refuses to guess which of a multi-grant
     * operator's branches a board is for) — they are not the tenancy boundary.
     * The tenancy boundary is the row predicate and RLS. So for an unrestricted
     * principal a selector naming another workspace is not an authorization
     * question at all: the board is answered, and it is answered EMPTY.
     *
     * WHAT THIS CASE CANNOT PROVE, stated rather than implied. The acceptance
     * database holds no appointment and no reception in EITHER workspace, so
     * "no Tenant B row came back" is also what a leaking read would produce. An
     * empty answer is a necessary condition for isolation here and not a
     * sufficient one, and it cannot be made sufficient without seeding Tenant B
     * business rows — which the no-fake-data policy forbids and which this
     * suite will not do to manufacture a stronger-looking green. What IS proved
     * is the falsifiable part: the response carries no Tenant B name and no
     * Tenant B identifier, and it carries no rows at all. The refusal path that
     * a restricted principal meets is proved in the case above, where it fires.
     */
    const token = await ownerBearer(request);

    for (const path of BOARDS_FOR_B) {
      const response = await request.get(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      });
      // Both are correct answers and the case refuses to pin one: 403 if the
      // platform ever narrows unrestricted callers too, 200-and-empty today.
      expect([200, 403], `${path} answered ${response.status()}`).toContain(response.status());

      const text = (await response.text()).toLowerCase();
      if (response.status() === 200) {
        const page = JSON.parse(text) as { items?: readonly unknown[] };
        expect(
          page.items ?? [],
          `${path} returned rows for a workspace the caller does not belong to`
        ).toHaveLength(0);
      }
      expect(text, 'the answer disclosed the other tenant').not.toContain(
        TENANT_B_NAME.toLowerCase()
      );
      expect(text, 'the answer echoed the other tenant id').not.toContain(TENANT_B.toLowerCase());
    }
  });

  test('the same token reads its OWN branch, so the refusals above mean something', async ({
    request,
  }) => {
    /*
     * Without this control every assertion in this section would also pass
     * against an API that refuses absolutely everything — including a phase
     * whose two read operations were simply dead. Six P1-27 operations answered
     * 500 to every request while every tier was green, so "it refused" is never
     * evidence on its own.
     */
    const token = await ownerBearer(request);
    for (const path of [
      `/api/v1/appointments?companyId=${COMPANY_A}&branchId=${BRANCH_A}&limit=1`,
      `/api/v1/receptions?companyId=${COMPANY_A}&branchId=${BRANCH_A}&limit=1`,
    ]) {
      const response = await request.get(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      });
      expect(response.status(), `the Tenant A token must be able to read ${path}`).toBe(200);
    }
  });
});
