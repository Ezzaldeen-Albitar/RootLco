#!/usr/bin/env node
/**
 * Hostile mutation matrix for the CodeQL remediation.
 *
 * A test that passes proves the code does something. Only a test that FAILS
 * when the guarantee is broken proves it pins that guarantee. Each entry below
 * breaks exactly one property in exactly one place, runs the suite that is
 * supposed to notice, and asserts a non-zero exit. A mutation that survives is
 * a test that proves nothing.
 *
 * This is deliberately NOT wired into the pipeline: it edits tracked source in
 * place, and a CI job that does that is a job that can leave a broken tree
 * behind. It is a pre-merge instrument, run by hand, and it restores every file
 * in a `finally` — including when the verification command throws.
 *
 * The matrix caught a survivor on its first run: `safeText` had no assertion
 * that could distinguish backslash-first escaping from pipe-first, so the
 * high-severity `js/incomplete-sanitization` fix was unpinned. That is the
 * whole argument for running it.
 *
 * Usage: node scripts/ci/hostile-mutations.mjs
 * Exit codes: 0 every mutation caught · 1 something survived.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { API_SRC_PATH, fromRoot } from '../lib/repository-paths.mjs';

const VALIDATION = 'npx vitest run tests/foundation/validation.test.ts';
const SECRETS = 'npx vitest run tests/foundation/idempotency-secret-material.test.ts';
const POLICY = 'npx vitest run tests/ci/codeql-policy.test.ts';
const FINGERPRINT = 'npx vitest run tests/foundation/idempotency-fingerprint.test.ts';
const TEMPLATES = 'npx vitest run tests/foundation/route-templates.test.ts';
/**
 * P1-22 verifiers. The backend tier needs its own config because these suites talk to a
 * real PostgreSQL — a mutation 'caught' by a suite that never reached the database would
 * be caught by the connection failing, which proves nothing about the guard.
 */
const PAYMENTS =
  'npx vitest run --config vitest.config.backend.ts tests/backend/p1-22-payments.test.ts';
const WARRANTY =
  'npx vitest run --config vitest.config.backend.ts tests/backend/p1-22-warranty.test.ts';
const MONEY_GATE = 'npx vitest run tests/foundation/exact-money-gate.test.ts';
const DELIVERY =
  'npx vitest run --config vitest.config.backend.ts tests/backend/p1-22-delivery.test.ts';
const CURRENCY =
  'npx vitest run --config vitest.config.backend.ts tests/backend/p1-22-currency-coherence.test.ts';

/**
 * P1-27 Owner-acceptance verifiers.
 *
 * These run inside `apps/web`, which is its own workspace with its own Vitest
 * configuration — hence the `cwd` field below. A mutation "caught" by a suite
 * that never loaded its config would be caught by the config failing, which
 * proves nothing about the guarantee.
 */
const WEB_ACCEPTANCE = 'npx vitest run tests/p1-27-owner-acceptance.dom.test.tsx';
const WEB_VEHICLES = 'npx vitest run tests/vehicle-screens.dom.test.tsx';
const WEB_SEARCH = 'npx vitest run tests/crm-customer-search.test.ts';
const WEB = 'apps/web';
const PLAIN_LANGUAGE = 'npx vitest run tests/ci/plain-language-gate.test.ts';
const THEME = 'npx vitest run tests/ci/tailwind-theme-gate.test.ts';

/**
 * Every `verify` command is a literal from this frozen table. Nothing here is
 * built from an argument, an environment variable or a file — the only inputs
 * this script has are the ones written below.
 */
const MUTATIONS = Object.freeze([
  // ---- src/server/http/validation.ts — the prototype fix -------------------
  {
    id: 'M-01',
    target: `${API_SRC_PATH}/server/http/validation.ts`,
    claim: 'the result has a null prototype, so Zod cannot read an inherited field',
    from: '  return Object.setPrototypeOf(Object.fromEntries(entries), null) as Record<',
    to: '  return Object.fromEntries(entries) as Record<',
    verify: VALIDATION,
  },
  {
    id: 'M-02',
    target: `${API_SRC_PATH}/server/http/validation.ts`,
    claim: 'a __proto__ parameter is not copied, so the anomaly cannot travel into a copy',
    from: "    if (key === '__proto__') continue;",
    to: '',
    verify: VALIDATION,
  },
  {
    id: 'M-03',
    target: `${API_SRC_PATH}/server/http/validation.ts`,
    claim: 'the comparison is exact — a case-folded one would match nothing',
    from: "    if (key === '__proto__') continue;",
    to: "    if (key === '__PROTO__') continue;",
    verify: VALIDATION,
  },
  {
    id: 'M-04',
    target: `${API_SRC_PATH}/server/http/validation.ts`,
    claim: 'the function is TOTAL: eight routes call it outside the error boundary',
    from: "    if (key === '__proto__') continue;",
    to: "    if (key === '__proto__') throw new AppFailure('ERR-VAL-001', { message: 'x' });",
    verify: VALIDATION,
  },
  {
    id: 'M-05',
    target: `${API_SRC_PATH}/server/http/validation.ts`,
    claim: 'a repeated parameter still arrives as an array',
    from: "    entries.push([key, values.length > 1 ? values : (values[0] ?? '')]);",
    to: "    entries.push([key, values[0] ?? '']);",
    verify: VALIDATION,
  },

  // ---- src/server/http/idempotency.ts — secret material --------------------
  {
    id: 'M-06',
    target: `${API_SRC_PATH}/server/http/idempotency.ts`,
    claim: 'the body is screened BEFORE it reaches createHash',
    from: "  assertNoSecretMaterial(input.body, 'body');",
    to: '',
    verify: SECRETS,
  },
  {
    id: 'M-07',
    target: `${API_SRC_PATH}/server/http/idempotency.ts`,
    claim: 'route params are screened too, not only the body',
    from: "  assertNoSecretMaterial(input.params ?? {}, 'params');",
    to: '',
    verify: SECRETS,
  },
  {
    id: 'M-08',
    target: `${API_SRC_PATH}/server/http/idempotency.ts`,
    claim: 'the word list actually contains `password`',
    from: "  'password',\n  'passwd',",
    to: "  'passwd',",
    verify: SECRETS,
  },
  {
    id: 'M-09',
    target: `${API_SRC_PATH}/server/http/idempotency.ts`,
    claim: 'camelCase is split, so `newPassword` is seen — the gap the guard tests caught',
    from: "    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')",
    to: '',
    verify: SECRETS,
  },
  {
    id: 'M-10',
    target: `${API_SRC_PATH}/server/http/idempotency.ts`,
    claim: 'nesting is walked, so a secret one level down is still seen',
    from: '  if (depth > 32 || value === null || typeof value !== ',
    to: '  if (depth > 0 || value === null || typeof value !== ',
    verify: SECRETS,
  },

  // ---- scripts/ci/codeql-policy.mjs — the SARIF gate -----------------------
  {
    id: 'M-11',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'a dismissal matches on rule AND path, never on rule alone',
    from: '  return entry.ruleId === finding.ruleId && entry.path === finding.path;',
    to: '  return entry.ruleId === finding.ruleId;',
    verify: POLICY,
  },
  {
    id: 'M-12',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'the high band starts at 7.0 — raising it is how sensitivity gets lowered quietly',
    from: "  if (score >= 7.0) return { level: 'high', score };",
    to: "  if (score >= 8.5) return { level: 'high', score };",
    verify: POLICY,
  },
  {
    id: 'M-13',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'a language whose SARIF is absent is reported, not assumed clean',
    from: '  const missingLanguages = expectedLanguages.filter((language) => {',
    to: '  const missingLanguages = [].filter((language) => {',
    verify: POLICY,
  },
  {
    id: 'M-14',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'a pack matches a hyphen-segment filename (javascript-typescript → javascript.sarif)',
    from: "    const candidates = [language, ...language.split('-')];",
    to: '    const candidates = [language];',
    verify: POLICY,
  },
  {
    id: 'M-15',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'the ceiling is enforced, so a new finding cannot arrive unnoticed',
    from: "  if (typeof ceiling === 'number' && open.length > ceiling) {",
    to: "  if (typeof ceiling === 'number' && false) {",
    verify: POLICY,
  },

  {
    id: 'M-19',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'a rule this pack cannot report is not judged stale here',
    from: '    if (reportableRules.size > 0 && !reportableRules.has(entry.ruleId)) {',
    to: '    if (false) {',
    verify: POLICY,
  },
  {
    id: 'M-20',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'scoping does NOT let a dead dismissal survive where the pack OWNS the rule',
    from: '    if (reportableRules.size > 0 && !reportableRules.has(entry.ruleId)) {',
    to: '    if (true) {',
    verify: POLICY,
  },
  {
    id: 'M-21',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'the rule set is read from tool.extensions, where CodeQL actually puts it',
    from: '        for (const rule of extension?.rules ?? []) {',
    to: '        for (const rule of []) {',
    verify: POLICY,
  },

  {
    id: 'M-22',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'the rule set is read from tool.driver.rules as well',
    from: '      for (const rule of run?.tool?.driver?.rules ?? []) {',
    to: '      for (const rule of []) {',
    verify: POLICY,
  },
  {
    id: 'M-23',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'scoping is by RULE, not by analysed path — the artifact list lies',
    from: '    if (reportableRules.size > 0 && !reportableRules.has(entry.ruleId)) {',
    to: '    if (analysed.size > 0 && !analysed.has(normalisePath(entry.path))) {',
    verify: POLICY,
  },

  // ---- src/server/http/idempotency.ts — the hashed-literal fix -------------
  {
    id: 'M-24',
    target: `${API_SRC_PATH}/server/http/idempotency.ts`,
    claim: 'the hashed verb is a LITERAL from the frozen array, not the caller string',
    from: '        canonicalMethod(input.method),',
    to: '        input.method.toUpperCase(),',
    verify: FINGERPRINT,
  },
  {
    id: 'M-25',
    target: `${API_SRC_PATH}/server/http/idempotency.ts`,
    claim: 'the hashed path is the INTERNED literal, not the caller string',
    from: '        assertRouteTemplate(input.path),',
    to: '        input.path,',
    verify: FINGERPRINT,
  },
  {
    id: 'M-26',
    target: `${API_SRC_PATH}/server/http/idempotency.ts`,
    claim: 'an unroutable verb is refused rather than falling through',
    from: '  if (!known) {',
    to: '  if (false) {',
    verify: FINGERPRINT,
  },
  {
    id: 'M-27',
    target: `${API_SRC_PATH}/server/http/route-templates.ts`,
    claim: 'the list is reconciled against the route modules, so it cannot drift',
    from: "  '/appointments',",
    to: '',
    verify: TEMPLATES,
  },

  {
    id: 'M-28',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'a diff-informed run does not judge dismissal staleness',
    from: '    if (partial) {\n      unjudged.push(entry);\n      return;\n    }',
    to: '',
    verify: POLICY,
  },
  {
    id: 'M-29',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'a diff-informed run does not claim the ceiling was met',
    from: '  } else if (partial) {',
    to: '  } else if (false) {',
    verify: POLICY,
  },
  {
    id: 'M-30',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'incrementalMode is what decides the scope, not a guess',
    from: '      if (run?.properties?.incrementalMode) return true;',
    to: '      if (false) return true;',
    verify: POLICY,
  },
  {
    id: 'M-31',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'a partial run STILL blocks on a High it actually saw',
    from: '  for (const finding of blocking) {',
    to: '  for (const finding of []) {',
    verify: POLICY,
  },

  // ---- scripts/ci/check-commit-checks.mjs — the AR-52 instrument -----------
  {
    id: 'M-16',
    target: 'scripts/ci/check-commit-checks.mjs',
    claim: 'the backslash is escaped BEFORE the pipe',
    from: "    .replace(/\\\\/g, '\\\\\\\\')\n    .replace(/\\|/g, '\\\\|')",
    to: "    .replace(/\\|/g, '\\\\|')",
    verify: POLICY,
  },
  {
    id: 'M-17',
    target: 'scripts/ci/check-commit-checks.mjs',
    claim: 'a `failure` conclusion is not acceptable',
    from: "export const ACCEPTABLE = Object.freeze(['success', 'skipped', 'neutral']);",
    to: "export const ACCEPTABLE = Object.freeze(['success', 'skipped', 'neutral', 'failure']);",
    verify: POLICY,
  },
  {
    id: 'M-18',
    target: 'scripts/ci/check-commit-checks.mjs',
    claim: 'a check still running is not counted as passed',
    from: "    if (check.status !== 'completed') {",
    to: '    if (false) {',
    verify: POLICY,
  },
  // ---- Phase 1-22 — billing, payment, delivery and warranty ----------------
  //
  // These target the guards that have NO database backstop. Every one of them, if
  // it survived, would mean the application is the only thing standing between a
  // caller and a wrong financial or custody outcome — and that nothing would
  // notice its removal.
  //
  // The verifier for each is the suite that is supposed to care. A mutation
  // verified by a suite that does not exercise the guard is a mutation that
  // proves the verifier wrong, not the guard safe.
  {
    id: 'M-22-01',
    target: `${API_SRC_PATH}/modules/payments/application/payment-service.ts`,
    claim:
      'a platform payment method is refused before it reaches the FK, because fk_receipts_method resolves (tenant_id, id) and a platform row carries a NULL tenant',
    from: '      assertPaymentMethodIsTenantScoped(method);',
    to: '',
    verify: PAYMENTS,
  },
  {
    id: 'M-22-02',
    target: `${API_SRC_PATH}/modules/payments/application/payment-service.ts`,
    claim: 'an inactive or unknown-kind payment method is refused',
    from: '      assertPaymentMethodUsable(method);',
    to: '',
    verify: PAYMENTS,
  },
  {
    id: 'M-22-03',
    target: `${API_SRC_PATH}/modules/payments/application/payment-service.ts`,
    claim:
      'the three allocation currencies must agree — sal.allocate_receipt compares receipt against invoice and never sees what the caller believed',
    from: `      assertAllocationCurrencyCoherent(
        declaredCurrency,
        receipt.currencyCode,
        invoice.currencyCode
      );`,
    to: '',
    verify: PAYMENTS,
  },
  {
    id: 'M-22-04',
    target: `${API_SRC_PATH}/modules/payments/data/payments-repository.ts`,
    claim:
      'an allocation is created by sal.allocate_receipt and by nothing else — app_runtime holds raw INSERT on sal.payment_allocations and no constraint bounds the sum',
    from: 'const ALLOCATE_RECEIPT_SQL = `SELECT sal.allocate_receipt($1, $2, $3::numeric, $4) AS id`;',
    to: 'const ALLOCATE_RECEIPT_SQL = `INSERT INTO sal.payment_allocations (tenant_id) VALUES ($1) RETURNING id`;',
    verify: PAYMENTS,
  },
  {
    id: 'M-22-05',
    target: `${API_SRC_PATH}/modules/warranty/application/warranty-service.ts`,
    claim:
      'an ARCHIVED warranty policy is refused — wty.issue_warranty checks the coverage status and NEVER the policy status, so nothing else refuses it (CC-6)',
    from: "    ruleRefusal('ERR-TRN-001', () => assertPolicyActive(policy.status, policy.policyCode));",
    to: '',
    verify: WARRANTY,
  },
  {
    id: 'M-22-06',
    target: `${API_SRC_PATH}/modules/warranty/domain/warranty.ts`,
    claim:
      'the delivered-handover test is the RIGHT WAY ROUND — a delivered delivery is accepted and anything else is refused',
    /**
     * Retargeted after the original mutation SURVIVED, and the reason is worth keeping.
     *
     * The first version deleted the CALL SITE:
     *   `ruleRefusal('ERR-TRN-001', () => assertDeliveryDelivered(delivery.status));`
     * and the warranty suite still passed. That is not a weak test. It is an
     * UNOBSERVABLE mutation, and the schema is why:
     *
     * `ck_delivery_records_delivered_shape` is
     *   `(status = 'delivered') = (delivered_at IS NOT NULL AND final_odometer_reading_id IS NOT NULL)`
     * so for any real row `status <> 'delivered'` IMPLIES `delivered_at IS NULL` — and the
     * very next guard in the same method refuses a null `deliveredAt` with the SAME
     * `ERR-TRN-001`. The two conditions are equivalent on real data and produce an
     * identical HTTP response, so no assertion over the API surface can tell which one
     * fired. Adding one would have meant asserting on a message, and `problemFor` never
     * emits one.
     *
     * So the property worth pinning is not "the call exists" but "the comparison is the
     * right way round". Inverting it makes a DELIVERED delivery refused, which the success
     * case (TC-P1-22-007) must notice — and does.
     */
    from: "  if (deliveryStatus !== 'delivered') {",
    to: "  if (deliveryStatus === 'delivered') {",
    verify: WARRANTY,
  },
  {
    id: 'M-22-07',
    target: `${API_SRC_PATH}/modules/payments/application/payment-service.ts`,
    claim: 'recording a payment writes exactly one audit record',
    from: '    await appendAudit(db, {',
    to: '    if (false as boolean) await appendAudit(db, {',
    verify: PAYMENTS,
  },
  {
    id: 'M-22-08',
    target: `${API_SRC_PATH}/modules/warranty/application/warranty-service.ts`,
    claim: 'generating a warranty publishes exactly one event, in the committing transaction',
    from: '    await publishEvent(db, {',
    to: '    if (false as boolean) await publishEvent(db, {',
    verify: WARRANTY,
  },
  {
    id: 'M-22-09',
    target: 'scripts/ci/check-exact-money.mjs',
    claim:
      'the exact-money gate refuses Number() on the financial surface — the loss it prevents is silent, unrepeatable, and invisible in a passing test',
    from: '    pattern: /\\bNumber\\s*\\(/,',
    to: '    pattern: /\\bNeverMatchesAnything\\s*\\(/,',
    verify: MONEY_GATE,
  },
  /**
   * The five below target the fixes for the independent review round. Each restores the
   * exact defect a review found, so a green matrix is the claim that the fix is pinned by
   * a test rather than merely present in the diff.
   */
  {
    id: 'M-22-10',
    target: `${API_SRC_PATH}/modules/billing/application/billing-read-service.ts`,
    claim:
      'a draft invoice is NOT collectable, so the delivery module blocks on it — otherwise creating a draft REMOVES the financial blocker and makes a handover more permissive than one carrying no invoice at all',
    from: '        collectable: false,',
    to: '        collectable: true,',
    verify: DELIVERY,
  },
  {
    id: 'M-22-11',
    target: `${API_SRC_PATH}/modules/delivery/application/delivery-service.ts`,
    claim:
      'delivery evidence must be attached to the delivery\u2019s work order or reception visit — without the link check the signature gate degrades to "name any document id you can see", and every principal in the tenant can enumerate them',
    from: '    let hasProvenance = version.linkedToEntity;',
    to: '    let hasProvenance = true;',
    verify: DELIVERY,
  },
  {
    id: 'M-22-12',
    target: `${API_SRC_PATH}/server/http/validation.ts`,
    claim:
      'an amount more precise than its currency is refused — a half-cent USD credit leaves a residue no tenderable payment can settle, holding the delivery financial blocker up forever with an override as the only exit',
    from: '  if (!/[1-9]/.test(excess)) return;',
    to: '  if (true) return;',
    verify: CURRENCY,
  },
  {
    id: 'M-22-13',
    target: `${API_SRC_PATH}/modules/payments/application/payment-service.ts`,
    claim:
      'no restricted amount reaches the outbox — shared.event_outbox\u2019s only SELECT policy is tenant-only, with no permission and no scope predicate, so an amount in a payload is a copy of the cash ledger behind a strictly weaker policy',
    from: '        receiptStatus: after.status,',
    to: '        receiptStatus: allocation.amount,',
    verify: PAYMENTS,
  },
  {
    id: 'M-22-14',
    target: `${API_SRC_PATH}/app/api/v1/deliveries/[deliveryId]/eligibility/route.ts`,
    claim:
      'the eligibility read publishes the delivery\u2019s record_version — it is the only response a completing principal can obtain, and sal.delivery-complete is versionGuarded with no wildcard If-Match, so without it the operation is unreachable',
    from: '      return { body: eligibility, recordVersion: eligibility.recordVersion };',
    to: '      return { body: eligibility };',
    verify: DELIVERY,
  },

  /**
   * ---- P1-27 Owner-acceptance remediation ---------------------------------
   *
   * The Product Owner returned FAIL against a build that had 767 green unit
   * tests, a green anonymous browser tier and a green authenticated browser
   * tier. Every defect they found was invisible to all three.
   *
   * So for this remediation, "the tests pass" is not the claim. The claim is
   * that undoing each fix turns a specific test red, and each entry below is
   * that claim executed: it restores the exact defect the Owner reported and
   * asserts the suite notices.
   */
  {
    id: 'M-OA-01',
    target: 'apps/web/src/components/forms/Field.tsx',
    claim:
      'the password reveal control is positioned INSIDE the field — the Owner rejected a control rendered below the input, where an error message separates it from the field it belongs to',
    from: '            className="absolute end-1 flex h-8 w-8 items-center justify-center rounded-md',
    to: '            className="mt-2 flex h-8 w-8 items-center justify-center rounded-md',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-02',
    target: 'apps/web/src/components/forms/Field.tsx',
    claim:
      'the reveal control cannot submit the form — a bare button inside a form defaults to submit, so revealing a password would attempt a sign-in',
    from: '            // Not `submit`. A bare button inside a form submits it, and the\n            // whole point of this control is that it does not.\n            type="button"',
    to: '            type="submit"',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-03',
    target: 'apps/web/src/components/forms/Field.tsx',
    claim:
      'the input element is patched rather than replaced, so the typed password survives the toggle',
    from: "            type={revealed ? 'text' : 'password'}",
    to: "            type={'password'}",
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-04',
    target: 'apps/web/src/components/shell/Sidebar.tsx',
    claim:
      'a sidebar parent is a disclosure — the Owner reported Administration as "always expanded, with no clear expand/collapse arrow"',
    from: '  const isDisclosure = hasChildren && !collapsed;',
    to: '  const isDisclosure = false;',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-05',
    target: 'apps/web/src/components/shell/Sidebar.tsx',
    claim:
      'a group containing the current page opens itself — otherwise a collapsed sidebar makes the page the operator is on impossible to locate',
    from: '  const expanded = overrides[item.key] ?? withinGroup;',
    to: '  const expanded = overrides[item.key] ?? false;',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-06',
    target: 'apps/web/src/components/shell/Sidebar.tsx',
    claim:
      'a closed group is inert — zero height is not zero focusability, and without it six invisible links stay in the tab order',
    from: '          inert={!expanded}',
    to: '          inert={false}',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-06b',
    target: 'apps/web/src/components/shell/Sidebar.tsx',
    claim:
      'the clipping box carries no padding of its own — a box’s padding is never clipped by its own overflow, so one element doing both left every closed group 6px tall in installed Chrome',
    from: '          <div className="overflow-hidden">',
    to: '          <div className="overflow-hidden pt-0.5 pb-1">',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-06c',
    target: 'apps/web/src/components/shell/AppShell.tsx',
    claim:
      'the drawer renders the navigation EXPANDED — inheriting the desktop rail state would put a 64px icon strip inside a 288px panel with no disclosure at all, on the one surface no desktop measurement can see',
    from: '                collapsed={false}\n                withinDrawer',
    to: '                collapsed={collapsed}\n                withinDrawer',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-07',
    target: 'apps/web/src/components/shell/Sidebar.tsx',
    claim:
      'the navigation carries the subtle-scrollbar treatment — without it Windows draws its ~15px classic channel down the shell’s most prominent surface',
    from: '        className="subtle-scrollbar-on-dark relative min-h-0 flex-1 overflow-y-auto',
    to: '        className="relative min-h-0 flex-1 overflow-y-auto',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-08',
    target: 'apps/web/src/styles/base/_scrollbars.scss',
    claim: 'the scrollbar is narrow rather than the operating system default width',
    from: '  scrollbar-width: thin;',
    to: '  scrollbar-width: auto;',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-09',
    target: 'apps/web/src/styles/base/_scrollbars.scss',
    claim:
      'the thumb is transparent at rest and appears on interaction — a permanently painted thumb is the defect, only thinner',
    from: '  scrollbar-color: transparent transparent;\n  transition: scrollbar-color var(--duration-base) var(--ease-standard);\n\n  &::-webkit-scrollbar-thumb {\n    background-color: transparent;\n  }\n\n  &:hover,\n  &:focus-within {',
    to: '  scrollbar-color: var(--color-sidebar-text-muted) transparent;\n\n  &:hover,\n  &:focus-within {',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-10',
    target: 'apps/web/src/features/crm/customers/components/CustomerCreateActions.tsx',
    claim:
      'the Add Customer actions render — the Owner reported "Customer Search has no clear Add Customer action"',
    from: '  if (!canCreate) return null;',
    to: '  return null;',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-11',
    target: 'apps/web/src/features/crm/customers/components/CustomerCreateActions.tsx',
    claim:
      'the actions are ABSENT without the permission, not merely quiet — a disabled control asserts the capability exists and this operator lacks it',
    from: '  if (!canCreate) return null;',
    to: '  if (false) return null;',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-12',
    target: 'apps/web/src/lib/duplicates/explanations.ts',
    claim:
      'an unrecognised comparison never reaches the operator by its internal name — a fallback that echoes the signal reintroduces the defect the first time the backend adds one',
    from: '  return unrecognised ? [...known, UNKNOWN_REASON] : known;',
    to: '  return unrecognised ? [...known, ...signals] : known;',
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-13',
    target: 'apps/web/src/features/vehicles/components/VehicleDuplicateReviewScreen.tsx',
    claim:
      'the vehicle review panel explains the match in sentences rather than printing the stored evidence',
    from: '      <MatchExplanation\n        locale={locale}\n        messages={messages}\n        score={candidate.matchScore}\n        bands={VEHICLE_CONFIDENCE_BANDS}\n        reasonKeys={vehicleMatchReasons(candidate.matchBasis)}\n      />',
    to: '      <pre>{JSON.stringify(candidate.matchBasis, null, 2)}</pre>',
    verify: WEB_VEHICLES,
    cwd: WEB,
  },
  {
    id: 'M-OA-14',
    target: 'apps/web/src/lib/duplicates/score.ts',
    claim:
      'the confidence band is derived from the score — without it every pair reads the same and the band stops being information',
    from: "  if (percent >= bands.strong) return 'strong';",
    to: "  if (false) return 'strong';",
    verify: WEB_ACCEPTANCE,
    cwd: WEB,
  },
  {
    id: 'M-OA-15',
    target: 'apps/web/src/app/[locale]/(dashboard)/crm/customers/page.tsx',
    claim:
      'the customer search page mounts the creation actions in its header, not only under an empty result',
    from: '        actions={\n          <CustomerCreateActions',
    to: '        actionsRemovedByMutation={\n          <CustomerCreateActions',
    verify: WEB_SEARCH,
    cwd: WEB,
  },
  {
    id: 'M-OA-16',
    target: 'apps/web/src/i18n/messages/en.json',
    claim:
      'no shipped message is a raw translation key — `translate` returns the key when a message is missing, and a key pasted in as its own value makes that failure permanent and invisible',
    from: '  "duplicates.reasonsHeading": "Why these records were matched",',
    to: '  "duplicates.reasonsHeading": "duplicates.reasonsHeading",',
    verify: PLAIN_LANGUAGE,
  },
  {
    id: 'M-OA-17',
    target: 'apps/web/src/i18n/messages/en.json',
    claim: 'no shipped message names an internal identifier at a workshop employee',
    from: '  "crm.duplicates.reason.name": "Both records use the same name, once spacing and capital letters are ignored.",',
    to: '  "crm.duplicates.reason.name": "The normalized_name signal fired on match_basis.",',
    verify: PLAIN_LANGUAGE,
  },
  {
    id: 'M-OA-18',
    target: 'apps/web/tailwind.config.ts',
    claim:
      'every colour utility resolves — Tailwind emits nothing for a name it does not know and says nothing about it, which is how 51 utilities across 14 components shipped with no CSS behind them',
    from: "        primary: 'var(--color-primary)',",
    to: "        primaryRenamedByMutation: 'var(--color-primary)',",
    verify: THEME,
  },
]);

/**
 * `--only=<prefix>` runs one family.
 *
 * The backend families need a live PostgreSQL; the P1-27 families do not. Being
 * able to run `--only=M-27` is what makes the frontend matrix usable during a
 * remediation instead of something that is only ever run once at the end.
 *
 * The prefix filters ids, which are literals in the frozen table above — no
 * argument reaches a command.
 */
const onlyArgument = process.argv.find((argument) => argument.startsWith('--only='));
const only = onlyArgument ? onlyArgument.slice('--only='.length) : null;
const selected = only ? MUTATIONS.filter((mutation) => mutation.id.startsWith(only)) : MUTATIONS;

if (only && selected.length === 0) {
  console.error(`--only=${only} matched no mutation. Nothing was run.`);
  process.exit(2);
}

const results = [];

for (const mutation of selected) {
  const targetPath = fromRoot(mutation.target);
  const original = readFileSync(targetPath, 'utf8');

  // A mutation whose target string has drifted is not a passing mutation — it
  // is a mutation that never ran, which is the CSA-06 shape.
  if (!original.includes(mutation.from)) {
    results.push({
      ...mutation,
      outcome: 'target string not found — the matrix has drifted',
      caught: false,
    });
    console.log(`${mutation.id}  NOT FOUND  ${mutation.target}`);
    continue;
  }

  const mutated = original.replace(mutation.from, mutation.to);
  let caught = false;
  let outcome = '';
  try {
    writeFileSync(targetPath, mutated);
    try {
      // `cwd` because the web workspace holds its own Vitest configuration. A
      // mutation "caught" by a run that never loaded its config would be caught
      // by the config failing, which proves nothing about the guarantee.
      execSync(mutation.verify, {
        stdio: 'pipe',
        encoding: 'utf8',
        ...(mutation.cwd ? { cwd: fromRoot(mutation.cwd) } : {}),
      });
      outcome = 'the suite PASSED against mutated source';
    } catch (error) {
      caught = true;
      const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      /*
       * `\s+(\d+)\s+failed`, not `\s+\S*\s*(\d+) failed`.
       *
       * The old pattern reported "0 test(s) failed" for a run in which ten
       * tests failed: `\S*` swallowed "1" out of "10", backtracking left `(\d+)`
       * matching the "0", and the harness printed a count that was the last
       * DIGIT rather than the number. Found while investigating a `CAUGHT — 0
       * test(s) failed` line on the P1-27 matrix, which is exactly the shape of
       * a mutation caught by something other than the guarantee it targets —
       * and which therefore has to be explained rather than accepted.
       */
      const failed = text.match(/Tests\s+(\d+)\s+failed/);
      outcome = failed
        ? `${failed[1]} test(s) failed`
        : /error TS\d+|Transform failed|SyntaxError/.test(text)
          ? 'rejected at compile time'
          : 'non-zero exit';
    }
  } finally {
    // Always, including on a throw above. A harness that leaves a mutated file
    // behind is worse than no harness.
    writeFileSync(targetPath, original);
  }

  results.push({ ...mutation, outcome, caught });
  console.log(
    `${mutation.id}  ${caught ? 'CAUGHT  ' : 'SURVIVED'}  ${mutation.claim} — ${outcome}`
  );
}

const survivors = results.filter((result) => !result.caught);
console.log(`\n${results.length - survivors.length}/${results.length} mutations caught.`);
for (const survivor of survivors) {
  console.log(`SURVIVOR ${survivor.id}  ${survivor.target}  ${survivor.claim}`);
}
process.exitCode = survivors.length === 0 ? 0 : 1;
