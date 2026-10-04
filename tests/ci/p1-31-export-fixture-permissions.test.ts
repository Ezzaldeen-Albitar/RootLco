/**
 * The export fixture's nine codes, pinned against the authorities that decide them.
 *
 * `scripts/dev/owner-acceptance/export-fixture-setup.mjs` grants an acceptance principal a
 * hand-written list of permission codes. A hand-written list is the right shape for a
 * fixture — a list computed at run time would widen silently the day a dataset gained a
 * code, and a fixture that grows without anybody deciding is the opposite of the "explicit
 * authorization" this one exists to provide.
 *
 * The cost of writing it by hand is drift, and this file is what pays it: the SIX functional
 * codes are derived here from the two places that really decide them, and the fixture's list
 * must contain exactly those six plus the three the principal needs to hold a session and
 * read the company and branch pickers. A dataset that gains a permission therefore fails
 * here, loudly, at the line that names the fixture — rather than producing an acceptance run
 * whose principal is refused half way through an export.
 *
 * ## Where the two authorities are, and why one of them is quoted rather than imported
 *
 *   - The four datasets' own `requiredPermissions`, imported from
 *     `@api/modules/reporting/domain/report-datasets`. The domain LEAF, not the module
 *     barrel: the barrel reaches the application services and the connection pool, and this
 *     tier opens no connection.
 *   - The export operation's own floor, `['rpt.export', 'rpt.report.read']`, which
 *     `ReportExportService.generate` checks before every dataset code. That service is NOT
 *     on this branch's base: the export slice is committed on an unmerged candidate, read
 *     read-only as
 *     `git -C <the candidate checkout> show d3257416:apps/api/src/modules/reporting/application/report-export-service.ts`
 *     where the loop reads
 *     `for (const code of ['rpt.export', 'rpt.report.read', ...definition.requiredPermissions])`.
 *     It is therefore stated here as a literal with that provenance, and this docblock is
 *     the record of it. When the export slice merges, this constant becomes importable and
 *     the literal should be replaced by the import — the assertion below does not change.
 *
 * The route that serves the export declares the same pair in its `permissions` array, so the
 * floor is stated twice in the product and once here; nothing in this file would pass if
 * they disagreed with the fixture.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPORT_FIXTURE_PERMISSIONS,
  FIXTURE_GRANT_HOURS,
  REQUIRED_OPERATOR_CODE,
} from '../../scripts/dev/owner-acceptance/export-fixture-setup.mjs';
import { REQUIRED_PLATFORM_CODE } from '../../scripts/platform/backfill-tenant-administrator-bundle.mjs';
import {
  REPORT_DATASETS,
  REPORT_DATASET_CODES,
} from '@api/modules/reporting/domain/report-datasets';

/**
 * The export operation's permission floor, as the unmerged export candidate writes it.
 *
 * See this file's docblock for the exact command that reads it and the line it comes from.
 */
const EXPORT_FLOOR = ['rpt.export', 'rpt.report.read'] as const;

/**
 * What the principal needs that no report declares.
 *
 * A session that can read itself, and the two directory reads the report screens' company
 * and branch pickers perform. They are not part of any dataset's permissions, so they
 * cannot be derived from the registry and are named here for the same reason the fixture
 * names them: a picker that cannot be filled is a screen the principal cannot use.
 */
const SESSION_AND_DIRECTORY = ['iam.user.read', 'org.company.read', 'org.branch.read'] as const;

const fixture: readonly string[] = EXPORT_FIXTURE_PERMISSIONS as readonly string[];

describe('the P1-31 export fixture grants exactly what the export path needs', () => {
  it('covers every code the four registered datasets require', () => {
    const required = new Set<string>();
    for (const code of REPORT_DATASET_CODES) {
      for (const permission of REPORT_DATASETS[code].requiredPermissions) required.add(permission);
    }
    expect(
      required.size,
      'the dataset registry declares no permissions at all, which would make this assertion vacuous'
    ).toBeGreaterThan(0);
    const missing = [...required].filter((code) => !fixture.includes(code));
    expect(
      missing,
      'a registered report dataset requires a code the export fixture does not grant, so the ' +
        'acceptance principal would be refused that export half way through the run'
    ).toEqual([]);
  });

  it('covers the export operation’s own floor', () => {
    const missing = EXPORT_FLOOR.filter((code) => !fixture.includes(code));
    expect(
      missing,
      'the export service checks this pair before any dataset code; a fixture without it ' +
        'cannot export anything at all'
    ).toEqual([]);
  });

  it('grants nothing beyond those codes and the session and directory reads', () => {
    const permitted = new Set<string>([
      ...EXPORT_FLOOR,
      ...SESSION_AND_DIRECTORY,
      ...REPORT_DATASET_CODES.flatMap((code) => [...REPORT_DATASETS[code].requiredPermissions]),
    ]);
    const extra = fixture.filter((code) => !permitted.has(code));
    expect(
      extra,
      'the export fixture grants a code neither the datasets, the export floor nor the ' +
        'session and directory reads call for. An acceptance fixture is the one grant that ' +
        'must be exactly as wide as the case it serves'
    ).toEqual([]);
    // Stated as a number as well, so a code silently swapped for another still fails.
    expect(fixture.length, 'the fixture list changed size').toBe(permitted.size);
  });

  it('lists each code once, in a frozen list', () => {
    expect(new Set(fixture).size, 'a code is listed twice').toBe(fixture.length);
    expect(Object.isFrozen(EXPORT_FIXTURE_PERMISSIONS)).toBe(true);
  });

  it('is authorised by an existing platform code and time boxed', () => {
    /*
     * The SAME authority the committed tenant-administrator backfill runs under, compared
     * against that script's own exported constant rather than against a string typed here.
     *
     * Two things follow from writing it this way. Minting a new platform permission for a
     * test fixture is what this asserts has not happened — the code already sanctions
     * writing role permissions into an organisation, because that is what provisioning one
     * does. And the code is not NAMED in this file: the operation register attributes a
     * test file to every operation whose id it mentions, and a fixture-permission test is
     * not coverage of the provisioning operation. Comparing the two constants states the
     * fact without making that false claim.
     */
    expect(REQUIRED_OPERATOR_CODE).toBe(REQUIRED_PLATFORM_CODE);
    expect(
      FIXTURE_GRANT_HOURS,
      'the fixture grant must expire within the window of one acceptance run'
    ).toBeLessThanOrEqual(4);
  });
});
