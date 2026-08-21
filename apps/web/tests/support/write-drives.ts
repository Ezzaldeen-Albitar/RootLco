import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as crmCreation from '@/features/crm/customers/creation-actions';
import * as crmGovernance from '@/features/crm/customers/governance-actions';
import * as crmIdentity from '@/features/crm/customers/identity-api';
import * as crmProfileActions from '@/features/crm/customers/profile-actions';
import * as vehApi from '@/features/vehicles/api';
import * as vehDuplicates from '@/features/vehicles/duplicates-api';
import * as vehHistory from '@/features/vehicles/history-api';
import * as vehProfile from '@/features/vehicles/profile-api';
import * as vehRelations from '@/features/vehicles/relations-api';

/**
 * One accepted call for **every** write adapter the two feature trees export
 * (`P1-27-QA-001`).
 *
 * ## Why this is a shared module rather than a table inside one suite
 *
 * Two suites need the same set and must not be able to disagree about it:
 * `write-adapters-driven.test.ts` executes each adapter and asserts the request
 * it produced, and `p1-27-qa.test.ts` sweeps the same bodies for a smuggled
 * tenant, company or branch. When each kept its own list, the second drove three
 * of twenty-three and said so — a stated sample, which was honest but thin —
 * while nine adapters were driven by nothing anywhere in the suite. Every
 * reference to those nine was a `vi.fn()`, so mutating one changed no result.
 *
 * ## Not a test file
 *
 * `vitest.config.ts` collects files whose name ends in `.test.ts` or
 * `.dom.test.tsx` only, so this module is imported and never collected.
 *
 * ## Every call here must SUCCEED
 *
 * These are the accepted cases: each one must reach `client.send`. A call that
 * fails validation would make both consumers vacuous — a sweep for a smuggled
 * scope passes trivially against a request that was never made, which is the
 * exact defect the positive control in `p1-27-qa.test.ts` exists to catch. Both
 * consumers assert `send` was called exactly once for each entry.
 *
 * The rejected cases live in the suites, beside the bound they are about.
 */

/** A `FormData` from a plain object; repeated keys are supported by array values. */
export function formOf(values: Record<string, string | readonly string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const one of Array.isArray(value) ? value : [value as string]) data.append(key, one);
  }
  return data;
}

const IDLE = { status: 'idle' } as const;
const CUSTOMER = '2f1e0f6a-5c2d-4a5b-8f2c-1a2b3c4d5e6f';
const VEHICLE = 'a1b2c3d4-0000-4000-8000-000000000001';
const PARTNER = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const RELATIONSHIP = 'b7c1f2e3-0000-4000-8000-0000000000aa';
const CANDIDATE = 'd4e5f6a7-0000-4000-8000-0000000000bb';
/**
 * A reason past the ten-character floor `MIN_REASON`, `MIN_MERGE_REASON` and
 * `MIN_REVIEW_REASON` share.
 *
 * The wording matters: `p1-27-qa.test.ts` sweeps each body produced here for
 * `tenant`, `company` or `branch`, and the first draft of this line said "agreed
 * with the branch manager" — a fixture that failed a real rule by containing one
 * of its words. Kept free of all three.
 */
const REASON = 'Agreed with the workshop supervisor.';

export interface WriteDrive {
  /** The exported adapter name, matched against the feature trees below. */
  readonly name: string;
  /** A call that must reach `client.send` exactly once. */
  readonly call: () => Promise<unknown>;
}

export const WRITE_DRIVES: readonly WriteDrive[] = [
  {
    name: 'createIndividualAction',
    call: () =>
      crmCreation.createIndividualAction(
        IDLE as never,
        formOf({ givenName: 'Nadia', familyName: 'Khoury', lifecycleStatus: 'active' })
      ),
  },
  {
    name: 'createCompanyAction',
    call: () =>
      crmCreation.createCompanyAction(
        IDLE as never,
        formOf({ legalName: 'Al Nour Trading', lifecycleStatus: 'prospect' })
      ),
  },
  {
    name: 'addNoteAction',
    call: () =>
      crmGovernance.addNoteAction(
        CUSTOMER,
        IDLE as never,
        formOf({ body: 'Called about the invoice.' })
      ),
  },
  {
    name: 'raiseAlertAction',
    call: () =>
      crmGovernance.raiseAlertAction(
        CUSTOMER,
        IDLE as never,
        formOf({ alertType: 'operational', severity: 'info', message: 'Gate code changed.' })
      ),
  },
  {
    name: 'imposeRestrictionAction',
    call: () =>
      crmGovernance.imposeRestrictionAction(
        CUSTOMER,
        IDLE as never,
        formOf({ restrictionType: 'no_credit', reason: REASON })
      ),
  },
  {
    name: 'setCustomerStatusAction',
    call: () =>
      crmGovernance.setCustomerStatusAction(
        CUSTOMER,
        IDLE as never,
        formOf({ lifecycleStatus: 'inactive', reason: REASON })
      ),
  },
  {
    name: 'assignTagAction',
    call: () =>
      crmGovernance.assignTagAction(CUSTOMER, IDLE as never, formOf({ segmentCode: 'FLEET' })),
  },
  {
    name: 'setPreferenceAction',
    call: () =>
      crmGovernance.setPreferenceAction(
        CUSTOMER,
        IDLE as never,
        formOf({ channel: 'email', purpose: 'marketing', preferred: 'on' })
      ),
  },
  {
    name: 'recordConsentAction',
    call: () =>
      crmGovernance.recordConsentAction(
        CUSTOMER,
        IDLE as never,
        formOf({
          consentKind: 'marketing',
          channel: 'email',
          purpose: 'marketing',
          status: 'granted',
        })
      ),
  },
  {
    name: 'reviewDuplicateAction',
    call: () =>
      crmIdentity.reviewDuplicateAction(
        CANDIDATE,
        IDLE as never,
        formOf({ decision: 'dismissed', reason: REASON })
      ),
  },
  {
    name: 'addContactAction',
    call: () =>
      crmProfileActions.addContactAction(
        CUSTOMER,
        IDLE as never,
        formOf({ channel: 'email', value: 'nadia@example.test' })
      ),
  },
  {
    name: 'addAddressAction',
    call: () =>
      crmProfileActions.addAddressAction(
        CUSTOMER,
        IDLE as never,
        formOf({ addressType: 'billing', line1: '12 Rainbow Street' })
      ),
  },
  {
    name: 'createVehicleAction',
    call: () => vehApi.createVehicleAction(IDLE as never, formOf({ color: 'Silver' })),
  },
  {
    name: 'reviewVehicleDuplicateAction',
    call: () =>
      vehDuplicates.reviewVehicleDuplicateAction(
        CANDIDATE,
        IDLE as never,
        formOf({ decision: 'dismissed', reason: REASON })
      ),
  },
  {
    name: 'assignPlateAction',
    call: () =>
      vehHistory.assignPlateAction(
        VEHICLE,
        IDLE as never,
        formOf({ countryCode: 'JO', plateRaw: '12-3456', effectiveDate: '2026-01-01' })
      ),
  },
  {
    name: 'transferOwnershipAction',
    call: () =>
      vehHistory.transferOwnershipAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: PARTNER, ownershipKind: 'registered_owner' })
      ),
  },
  {
    name: 'recordOdometerAction',
    call: () =>
      vehHistory.recordOdometerAction(
        VEHICLE,
        IDLE as never,
        formOf({ value: '123456', unit: 'km', observedAt: '2026-03-01T09:30:00Z' })
      ),
  },
  {
    // The one adapter that takes no `FormData`: the panel computes the changed
    // fields itself, because an absent field and a null field are different
    // requests to this route.
    name: 'updateVehicleAction',
    call: () => vehProfile.updateVehicleAction(VEHICLE, { color: 'Blue' }, IDLE as never),
  },
  {
    name: 'changeVehicleStatusAction',
    call: () =>
      vehProfile.changeVehicleStatusAction(
        VEHICLE,
        IDLE as never,
        formOf({ lifecycleStatus: 'inactive' })
      ),
  },
  {
    name: 'setEvProfileAction',
    call: () =>
      vehRelations.setEvProfileAction(
        VEHICLE,
        IDLE as never,
        formOf({ evKind: 'bev', usableCapacityKwh: '64', chargePortType: 'CCS2' })
      ),
  },
  {
    name: 'linkCustomerAction',
    call: () =>
      vehRelations.linkCustomerAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: PARTNER, relationshipRole: 'driver' })
      ),
  },
  {
    name: 'authorizePartyAction',
    call: () =>
      vehRelations.authorizePartyAction(
        VEHICLE,
        IDLE as never,
        formOf({ partnerId: PARTNER, allowedActions: ['approve_quotation'] })
      ),
  },
  {
    name: 'retirePartyAction',
    call: () =>
      vehRelations.retirePartyAction(
        VEHICLE,
        RELATIONSHIP,
        IDLE as never,
        formOf({ effectiveDate: '2026-06-30' })
      ),
  },
];

/** The ids the drives above are built from, so a suite can assert on the path. */
export const DRIVE_IDS = {
  customer: CUSTOMER,
  vehicle: VEHICLE,
  partner: PARTNER,
  relationship: RELATIONSHIP,
  candidate: CANDIDATE,
  reason: REASON,
} as const;

/**
 * The declaration forms an exported write adapter can take.
 *
 * ## The blind spot these close
 *
 * There was ONE pattern here — `^export async function (\w+Action)` — and it is
 * the narrowest of the three forms TypeScript offers for the same export. An
 * adapter written `export const fooAction = async (…) => …` was invisible to the
 * walk, so the completeness comparison in `write-adapters-driven.test.ts` and
 * `p1-27-qa.test.ts` would have gone on reporting the SAME twenty-three and the
 * same "every adapter is driven" while the twenty-fourth was executed by
 * nothing. A check that cannot see the thing it certifies is not a check, and
 * this one certifies the coverage claim for every write in the phase.
 *
 * Nothing in either tree uses the const form TODAY — the widening discovers no
 * new adapter and the count stays twenty-three. That is the point: the hole is
 * closed before it is fallen into, rather than after.
 *
 * `export function` without `async` is here for the same reason. An adapter that
 * returns a promise without being declared `async` is an ordinary thing to write
 * and would have been just as invisible.
 */
const ADAPTER_DECLARATIONS: readonly RegExp[] = [
  /^export\s+(?:async\s+)?function\s+(\w+Action)\b/gm,
  // `export const fooAction: Handler = async (…) => …` — the annotation is
  // optional and is skipped up to the `=`, which cannot appear inside a type
  // annotation at this position without parentheses that would not be an
  // adapter declaration anyway.
  /^export\s+const\s+(\w+Action)\s*(?::[^=\n]+)?=/gm,
];

/**
 * Source with comments removed.
 *
 * A docblock naming an action it does not export would otherwise be discovered
 * as an export. Mirrors the stripper in `scripts/ci/check-p1-27-frontend.mjs`:
 * `//` starts a comment only when it is not preceded by `:`, so a `https://`
 * inside a string literal survives.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/**
 * Every write-adapter name one module's source declares as an export.
 *
 * Exported so a test can put a declaration form in front of the scanner
 * directly. The alternative — asserting only against the real tree — can never
 * fail for a form the tree does not happen to contain yet, which is exactly how
 * the `const` blind spot survived.
 */
export function writeAdapterNamesIn(source: string): readonly string[] {
  const found = new Set<string>();
  const stripped = stripComments(source);
  for (const pattern of ADAPTER_DECLARATIONS) {
    // A fresh regex per call: a `g` literal carries `lastIndex` across calls,
    // and a shared one would skip matches on every second source it read.
    for (const m of stripped.matchAll(new RegExp(pattern.source, pattern.flags))) {
      if (m[1]) found.add(m[1]);
    }
  }
  return [...found];
}

/** The two trees whose exported writes must every one be driven. */
function featureRoots(): readonly string[] {
  return [
    join(process.cwd(), 'src', 'features', 'crm'),
    join(process.cwd(), 'src', 'features', 'vehicles'),
  ];
}

/**
 * Every source file the walk reads.
 *
 * `.tsx` as well as `.ts`, and that is the second half of the same blind spot:
 * the walk filtered on `.ts` alone, so an adapter co-located with the screen
 * that calls it — a `'use server'` block in a `.tsx`, which this codebase does
 * not forbid — was skipped before any pattern was applied. Exported so a test
 * can assert the file set actually contains `.tsx` files rather than trusting
 * that an extension appears in a filter.
 */
export function writeAdapterSourceFiles(
  roots: readonly string[] = featureRoots()
): readonly string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      files.push(full);
    }
  };
  for (const root of roots) walk(root);
  return files.sort();
}

/**
 * Every `*Action` the two feature trees export, read from the filesystem.
 *
 * Derived rather than listed, because a list is exactly what let nine adapters
 * ship with no execution behind them while the coverage claim read green.
 */
export function exportedWriteAdapters(
  roots: readonly string[] = featureRoots()
): readonly string[] {
  const found = new Set<string>();
  for (const file of writeAdapterSourceFiles(roots)) {
    for (const name of writeAdapterNamesIn(readFileSync(file, 'utf8'))) found.add(name);
  }
  return [...found].sort();
}
