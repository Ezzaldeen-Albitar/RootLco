import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TENANT_ADMINISTRATOR_ROLE } from '@api/modules/iam/domain/bootstrap-roles';
import { OWNER_PERMISSIONS } from '../../scripts/dev/owner-acceptance/context.mjs';
import {
  ACCOUNT_MANIFEST_PATH,
  EMIT_COMMAND,
  accountManifestDocument,
} from '../../scripts/dev/owner-acceptance/emit-account-manifest.mjs';

/**
 * The committed account manifest says the truth about both credential kinds.
 *
 * ## What the manifest is for
 *
 * `apps/web/tests/e2e/authenticated/account-manifest.json` is how a Playwright spec
 * learns what the account it signed in as is entitled to see. It exists because
 * neither authority can be imported from `apps/web`: `apps/web/tsconfig.json` sets
 * `allowJs: false`, which rules out `context.mjs`, and importing `apps/api` source
 * from the web workspace is a boundary breach. A generated, committed document is
 * the only shape that crosses.
 *
 * ## Why that needs a test rather than a convention
 *
 * A committed copy of a permission set drifts the moment either authority moves, and
 * the drift is INVISIBLE: a spec would pin the outcome the manifest describes, the
 * screen would render the outcome the real grant produces, and the case would fail
 * naming the screen rather than the stale file. So the manifest is compared, byte for
 * byte, against the document its generator produces from the two authorities as they
 * stand at this head.
 *
 * ## The membership assertions, and why there is no count
 *
 * The asymmetries below are what every rewritten browser case turns on, and each is
 * asserted as MEMBERSHIP. No cardinality is pinned: `OWNER_PERMISSIONS` is a runtime
 * union of four sets and the number it happens to produce is not a contract — a
 * figure typed here would fail the day a P1-28 screen consults one more code, which
 * is a change to nothing this file is about. `tests/ci/p1-28-access-gate.test.ts`
 * already holds the one floor that set owes.
 */

const MANIFEST: Record<string, readonly string[]> = JSON.parse(
  readFileSync(ACCOUNT_MANIFEST_PATH, 'utf8')
) as Record<string, readonly string[]>;

/** The codes each browser case pins an outcome on, and the screen each one gates. */
const OWNER_ACCEPTANCE_LACKS = [
  // The three reporting operations, and therefore the catalogue, the run screen and
  // the operational overview.
  'rpt.report.read',
  // The plan-creation panel on the warranty plans screen.
  'wty.policy.manage',
] as const;

const BOTH_KINDS_HOLD = [
  // Both warranty screens.
  'wty.warranty.read',
  // The readiness queue's three-code conjunction.
  'sal.delivery.view',
  'wo.work_order.read',
  'sal.finance.view',
  // The audit log.
  'iam.audit.view',
  // The company and branch directory every one of those screens resolves against.
  'org.company.read',
  'org.branch.read',
] as const;

describe('the P1-31 browser tier account manifest', () => {
  it('is exactly what its generator produces from the two authorities', () => {
    const committed = readFileSync(ACCOUNT_MANIFEST_PATH, 'utf8');
    expect(
      committed,
      `the committed account manifest is not what the two permission authorities say. Run: ${EMIT_COMMAND}`
    ).toBe(accountManifestDocument());
  });

  it('carries the two runtime sets, sorted, and nothing else', () => {
    expect(Object.keys(MANIFEST).sort()).toEqual(['org-administrator', 'owner-acceptance']);
    expect(MANIFEST['owner-acceptance']).toEqual([...OWNER_PERMISSIONS].sort());
    expect(MANIFEST['org-administrator']).toEqual(
      [...TENANT_ADMINISTRATOR_ROLE.permissionCodes].sort()
    );
    for (const kind of ['owner-acceptance', 'org-administrator']) {
      const codes = MANIFEST[kind] ?? [];
      expect(codes.length, `${kind} holds no codes at all`).toBeGreaterThan(0);
      expect(new Set(codes).size, `${kind} lists a code twice`).toBe(codes.length);
    }
  });

  it('records the asymmetry the browser cases pin their outcomes on', () => {
    /*
     * Stated as membership in both directions. Each absence below is why a browser
     * case pins a REFUSAL for the acceptance owner where it pins the surface for the
     * organisation administrator; a manifest that quietly gained one of them would
     * turn those cases into assertions about a screen nobody can reach.
     */
    for (const code of OWNER_ACCEPTANCE_LACKS) {
      expect(
        MANIFEST['owner-acceptance'],
        `the acceptance owner must not hold ${code}; the refusal cases assert on its absence`
      ).not.toContain(code);
      expect(
        MANIFEST['org-administrator'],
        `the organisation administrator must hold ${code}; the surface cases assert on it`
      ).toContain(code);
    }
    for (const code of BOTH_KINDS_HOLD) {
      expect(MANIFEST['owner-acceptance'], `the acceptance owner must hold ${code}`).toContain(
        code
      );
      expect(
        MANIFEST['org-administrator'],
        `the organisation administrator must hold ${code}`
      ).toContain(code);
    }
  });

  it('is read by the browser tier and by nothing that could substitute for it', () => {
    /*
     * The manifest is only worth generating if the specs read IT rather than a
     * literal beside them. This asserts the helper that owns the lookup is the one
     * importing the document, so a spec that hand-listed codes would be visible as a
     * second reader here.
     */
    const helper = readFileSync(
      ACCOUNT_MANIFEST_PATH.replace(/account-manifest\.json$/, 'account-manifest.ts'),
      'utf8'
    );
    expect(helper).toContain("import manifest from './account-manifest.json'");
    expect(helper).toContain('export function holds(');
  });
});
