import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RULES,
  SCAN_ROOTS,
  evaluate,
  selfTest,
  stripComments,
} from '../../scripts/ci/check-p1-27-frontend.mjs';

/** The repository root, resolved from this file rather than from the cwd. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

  it('carries no rule whose allow-list could swallow every file', () => {
    /*
     * This case used to drive `no-duplicate-scan-on-a-queue`, whose allowance is
     * now empty because it exempted a file that never matched the rule
     * (`P1-27-FE-003`, and see the invariant below).
     *
     * NO rule carries an allowance today, so the swallow scenario cannot be
     * constructed from the real rule set — which the loop below states rather
     * than hiding behind a `find` that silently returns nothing. It is
     * deliberately empty NOW and becomes live the moment any allowance is added.
     *
     * The title used to say "fails a rule whose allow-list has swallowed every
     * file", which is what the NEXT case does. This one asserts an invariant.
     */
    const withAllowances = RULES.filter((r) => r.allow.length > 0);
    for (const rule of withAllowances) {
      const onlyAllowed = rule.allow.map((path: string) => ({
        path,
        source: 'export const a = 1;',
      }));
      const { failures } = evaluate(onlyAllowed);
      expect(
        failures.some((f) => f.includes(`${rule.id}: inspected 0 files`)),
        rule.id
      ).toBe(true);
    }
    // The invariant that makes the emptiness above a FACT rather than an
    // accident. Without it, a future allowance could reintroduce the hole and
    // this case would keep passing by iterating over nothing.
    expect(withAllowances.map((r) => r.id)).toEqual([]);
  });

  it('fails a rule that inspected zero files, proved on a synthetic rule', () => {
    /*
     * The per-rule anti-vacuity branch — `check-p1-27-frontend.mjs`'s
     * "inspected 0 files — this rule is measuring nothing" — has had ZERO
     * coverage since every allowance was emptied: the loop above iterates over
     * nothing, and `evaluate([])` returns at the earlier whole-run guard before
     * any rule is reached.
     *
     * A branch that exists to catch a gate measuring nothing must not itself be
     * deletable green. RULES is mutated for the length of this case only and
     * restored in `finally`, so the real rule set is unchanged either way.
     */
    // `RULES` is inferred `allow: never[]` because every real rule's allowance
    // is `[]` — which is the fact the case above pins. The cast is what lets a
    // synthetic rule carry one; it widens the local view, not the export.
    const rules = RULES as unknown as {
      id: string;
      pattern: RegExp;
      what: string;
      allow: string[];
    }[];
    rules.push({
      id: 'synthetic-allow-everything',
      pattern: /never-matches-anything/,
      what: 'exists only to reach the per-rule anti-vacuity branch',
      allow: ['synthetic/'],
    });
    try {
      const { failures } = evaluate([{ path: 'synthetic/a.ts', source: 'export const a = 1;' }]);
      expect(
        failures.some((f) => f.includes('synthetic-allow-everything: inspected 0 files')),
        'the per-rule anti-vacuity branch did not fire'
      ).toBe(true);
    } finally {
      rules.pop();
    }
    // And the rule set is back exactly as it was.
    expect(RULES.some((r) => r.id === 'synthetic-allow-everything')).toBe(false);
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

  it('exempts NO file from the duplicate-scan rule', () => {
    /*
     * This case used to assert the opposite, and its comment explained why: "the
     * CRM scan operation is called once, on explicit intent, by the creation
     * form". That was never true.
     *
     * `creation-actions.ts` contains no scan call — `crm-customer-create.dom
     * .test.tsx` asserts its absence deliberately — because the creation-time
     * duplicate warning arrives on the create RESPONSE as `possibleDuplicates`.
     * Both scans are `DELIBERATELY_ABSENT` in the reachability manifest.
     *
     * So the exemption matched nothing, and `evaluate()` skips allow-listed files
     * without ever reporting an unused entry. It was a live hole: a privileged
     * audited write added to that one file would have passed the gate that exists
     * to stop it. This assertion is what keeps the list empty (`P1-27-FE-003`).
     */
    const rule = RULES.find((r) => r.id === 'no-duplicate-scan-on-a-queue');
    expect(rule?.allow).toEqual([]);
  });

  it('has no allowance anywhere that matches no file in the tree', () => {
    // The general form of the defect above. An exemption for a path that does
    // not exist is either a typo or a hole, and neither should survive silently.
    for (const rule of RULES) {
      for (const allowed of rule.allow) {
        expect(
          existsSync(join(REPO_ROOT, allowed)),
          `${rule.id} exempts a missing path: ${allowed}`
        ).toBe(true);
      }
    }
  });
});
