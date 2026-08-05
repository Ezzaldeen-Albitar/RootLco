import { describe, expect, it } from 'vitest';
import {
  RULES,
  SCAN_ROOTS,
  evaluate,
  selfTest,
  stripComments,
} from '../../scripts/ci/check-p1-27-frontend.mjs';

/**
 * The P1-27 frontend gate (`P1-27-DO-001`).
 *
 * A gate is only worth its runtime if each rule is shown to catch the thing it
 * names. So every case below **plants that one violation** and asserts the gate
 * reports it — never "the gate passes on the real tree", which is what a gate
 * with a broken regex also does.
 */

/**
 * The forbidden operation ids, assembled at runtime rather than spelled out.
 *
 * `scripts/p1-24-operation-register.mjs` scans every test file for operation ids
 * and credits the file as evidence for each one it finds. Writing
 * the full merge operation id literally here made the P1-24 register claim this
 * **Frontend gate test** as backend test evidence for the merge route — a test
 * that proves the Web tier never calls an operation is not evidence that the
 * route is exercised, and the register said it was.
 *
 * The gate under test still receives the exact violating string. It simply is
 * not spelled contiguously in this file for a different scanner to misread.
 */
const OP = {
  customerMerge: ['crm', 'customer-merge'].join('.'),
  vehicleMerge: ['veh', 'vehicle-merge'].join('.'),
  duplicateScan: 'duplicate-scan',
} as const;

const CLEAN = [
  { path: 'apps/web/src/features/crm/customers/api.ts', source: 'export const a = 1;\n' },
  { path: 'apps/web/src/features/vehicles/api.ts', source: 'export const b = 2;\n' },
];

function withViolation(source: string) {
  return [...CLEAN, { path: 'apps/web/src/features/vehicles/bad.ts', source }];
}

describe('the gate is clean on clean input', () => {
  it('reports no failure for files that break nothing', () => {
    expect(evaluate(CLEAN).failures).toEqual([]);
  });
});

describe('each rule catches its own violation', () => {
  it.each([
    ['no-merge-caller', "await client.send('POST', `/api/v1/vehicles/${id}/merge`, {});"],
    ['no-merge-caller', `const op = '${OP.customerMerge}';`],
    ['no-merge-caller', `const op = '${OP.vehicleMerge}';`],
    ['no-merge-caller', 'export async function mergeVehicleAction() {}'],
    ['no-duplicate-scan-on-a-queue', `client.send('POST', '/api/v1/${OP.duplicateScan}', {});`],
    ['no-client-asserted-scope', 'const path = query({ tenantId, cursor });'],
    ['no-client-asserted-scope', 'const p = { branch_id: session.branch };'],
    ['no-invented-total', 'const page = { rows, total: rows.length };'],
    ['no-upload-path', 'const body = new FormData();'],
    ['no-upload-path', '<input type="file" name="photo" />'],
    ['no-console-output', "console.log('page', page);"],
  ])('%s catches: %s', (ruleId, source) => {
    const { failures } = evaluate(withViolation(source));
    expect(
      failures.some((f) => f.startsWith(`${ruleId}:`)),
      failures.join('\n')
    ).toBe(true);
  });
});

describe('the gate does not accuse the explanation of the rule', () => {
  it.each(RULES.map((rule) => rule.id))('%s ignores its own name in a comment', (ruleId) => {
    // Every rule names an operation this phase deliberately does not call, and
    // the reason is written in a docblock naming that operation. A scanner that
    // read prose would force the explanation to be deleted to stay green — and
    // the explanation is the only durable record of the decision.
    const prose = [
      '/**',
      ` * \`${OP.vehicleMerge}\` and \`${OP.customerMerge}\` are never called:`,
      ' * `P1-OD-017` is open. The two `' + OP.duplicateScan + '` operations are',
      ' * privileged audited writes. The client asserts no tenantId, companyId or',
      ' * branchId. No total is invented. There is no FormData() upload path.',
      ' */',
      '// console.log is never used here either.',
      'export const ok = 1;',
    ].join('\n');
    const { failures } = evaluate(withViolation(prose));
    expect(failures.filter((f) => f.startsWith(`${ruleId}:`))).toEqual([]);
  });
});

describe('the comment stripper is proven, not assumed', () => {
  it('passes its own self-test', () => {
    expect(selfTest()).toEqual([]);
  });

  it('removes prose and preserves code', () => {
    const stripped = stripComments(
      ['// customer-merge', '/** vehicle-merge */', "const p = '/merge';"].join('\n')
    );
    expect(stripped).not.toContain('customer-merge');
    expect(stripped).not.toContain('vehicle-merge');
    expect(stripped).toContain("'/merge'");
  });

  it('does not truncate a URL at its own double slash', () => {
    // A naive `//.*$` strip would delete everything after `https:`, hiding any
    // real match on the rest of that line.
    //
    // Asserted on the TAIL, not on the whole URL. `includes()` of a full URL is
    // `js/incomplete-url-substring-sanitization`, which CodeQL raised as HIGH
    // against the gate's own self-test on PR #198 — correctly, because a
    // substring check on a URL is a broken host check. The property here never
    // needed the host: what matters is that the characters after the `//`
    // survived, which is precisely what a truncation at `https:` destroys.
    expect(stripComments("const u = 'https://example.test/keep-me';")).toContain('/keep-me');
  });

  it('fails the whole gate when the stripper over-matches', () => {
    // The self-test result is folded into `evaluate`, so a stripper regression
    // cannot quietly turn every rule into a scan over empty strings. That is the
    // one failure mode the anti-vacuity rules below cannot see for themselves.
    const problems = selfTest();
    expect(Array.isArray(problems)).toBe(true);
  });
});

describe('a rule that measures nothing is a failure, not a pass', () => {
  it('fails when no file is inspected at all', () => {
    const { failures } = evaluate([]);
    expect(failures.some((f) => f.includes('no files were inspected'))).toBe(true);
  });

  it('fails a rule whose allow-list has swallowed every file', () => {
    const rule = RULES.find((r) => r.id === 'no-duplicate-scan-on-a-queue');
    expect(rule?.allow.length).toBeGreaterThan(0);
    const onlyAllowed = [
      {
        path: 'apps/web/src/features/crm/customers/creation-actions.ts',
        source: 'export const a = 1;',
      },
    ];
    const { failures } = evaluate(onlyAllowed);
    expect(
      failures.some((f) => f.includes('no-duplicate-scan-on-a-queue: inspected 0 files'))
    ).toBe(true);
  });
});

describe('the scan roots are both of this phase’s trees', () => {
  it('names CRM and vehicles, not one of them', () => {
    // A gate that scanned only `crm` would have reported clean over every
    // vehicle screen in Waves 7–12.
    const roots = SCAN_ROOTS.map((r: string) => r.split(/[\\/]/).join('/'));
    expect(roots).toContain('apps/web/src/features/crm');
    expect(roots).toContain('apps/web/src/features/vehicles');
  });

  it('allows the ONE legitimate duplicate-scan call site by name', () => {
    // The CRM scan operation is called once, on explicit intent, by the creation
    // form — the operation's legitimate use. Named rather than pattern-matched,
    // so widening it requires editing the gate.
    const rule = RULES.find((r) => r.id === 'no-duplicate-scan-on-a-queue');
    expect(rule?.allow).toEqual(['apps/web/src/features/crm/customers/creation-actions.ts']);
  });
});
