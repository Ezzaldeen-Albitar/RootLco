import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { ADDRESS_TYPES } from '@/features/crm/customers/profile-contract';
import {
  VEHICLE_LIFECYCLE_STATUSES,
  WORKSHOP_STATUSES,
  POWERTRAIN_CATEGORIES,
} from '@/features/vehicles/contract';
import { VEHICLE_DUPLICATE_STATUSES } from '@/features/vehicles/duplicates-contract';

/**
 * Every server vocabulary, checked against the database that owns it AND
 * against both message catalogues.
 *
 * ## Why this file exists
 *
 * `translate()` falls back to the key: `messages[key] ?? key`. A value with no
 * label therefore renders `crm.addressType.service` to the operator and
 * **nothing fails** — not typecheck, not lint, not any test, not the build. It
 * looks like a rendering choice rather than a defect.
 *
 * Two shipped in this phase and were found only by an adversarial review of the
 * finished branch:
 *
 * - `ADDRESS_TYPES` was invented as `billing/shipping/site/other`. The CHECK
 *   constraint is `billing/service/registered/other`, so two real values had no
 *   label and two labels named values the database cannot store.
 * - `vehicles.field.*` had **zero** entries in either catalogue, so every row of
 *   the vehicle Change-history "Detail" column rendered a raw key.
 *
 * The phase had already caught six invented vocabularies and recorded that each
 * value was "read from the migration that owns the column". That claim was true
 * of the six and untrue of these two, and nothing re-checked it. So this file
 * does the comparison mechanically rather than trusting a claim in a docblock.
 */

const MIGRATIONS = join(process.cwd(), '..', '..', 'supabase', 'migrations');

/** The values a CHECK constraint admits, read out of the migration that owns it. */
function checkConstraintValues(file: string, constraint: string): readonly string[] {
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
  const index = sql.indexOf(constraint);
  if (index === -1) throw new Error(`${constraint} not found in ${file}`);
  const tail = sql.slice(index);
  const inList = /IN\s*\(([^)]*)\)/.exec(tail);
  if (!inList?.[1]) throw new Error(`${constraint} in ${file} has no IN (...) list`);
  return [...inList[1].matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

/** The field codes a trigger function actually writes. */
function emittedFieldCodes(file: string, fn: string): readonly string[] {
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
  const index = sql.indexOf(fn);
  if (index === -1) throw new Error(`${fn} not found in ${file}`);
  const body = sql.slice(index);
  return [...new Set([...body.matchAll(/NEW\.id,\s*'([a-z_]+)'/g)].map((m) => m[1] ?? ''))];
}

describe('this file reads the real migrations, not a copy of them', () => {
  it('finds a non-empty vocabulary for each authority it cites', () => {
    // Without this, a renamed migration makes every comparison below compare an
    // empty list to an empty list and pass having judged nothing.
    expect(
      checkConstraintValues('20260719097000_crm_contacts_addresses.sql', 'ck_addresses_type').length
    ).toBeGreaterThan(1);
    expect(
      emittedFieldCodes(
        '20260720095000_veh_vehicle_attribute_history.sql',
        'emit_vehicle_attribute_history'
      ).length
    ).toBeGreaterThan(1);
  });
});

describe('a frontend vocabulary matches the constraint that owns the column', () => {
  it('crm.addresses.address_type', () => {
    const database = checkConstraintValues(
      '20260719097000_crm_contacts_addresses.sql',
      'ck_addresses_type'
    );
    // Set equality both ways. A missing value renders a raw key; an extra value
    // is a control offering something the database will reject.
    expect([...ADDRESS_TYPES].sort()).toEqual([...database].sort());
  });
});

/** Every `prefix.` that a feature component builds a runtime key from. */
function prefixesUsedInSource(): ReadonlySet<string> {
  const roots = [join(process.cwd(), 'src', 'features')];
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        const source = readFileSync(full, 'utf8');
        for (const match of source.matchAll(/translateDynamic\(\s*messages,\s*`([^`$]+)\$\{/g)) {
          if (match[1]) found.add(match[1]);
        }
      }
    }
  };
  for (const root of roots) walk(root);
  return found;
}

describe('every value of every server vocabulary has a label in BOTH locales', () => {
  const VOCABULARIES: readonly { prefix: string; values: readonly string[] }[] = [
    { prefix: 'crm.addressType.', values: ADDRESS_TYPES },
    { prefix: 'vehicles.lifecycle.', values: VEHICLE_LIFECYCLE_STATUSES },
    { prefix: 'vehicles.workshop.', values: WORKSHOP_STATUSES },
    { prefix: 'vehicles.powertrain.', values: POWERTRAIN_CATEGORIES },
    { prefix: 'vehicles.duplicateStatus.', values: VEHICLE_DUPLICATE_STATUSES },
    {
      prefix: 'vehicles.field.',
      values: emittedFieldCodes(
        '20260720095000_veh_vehicle_attribute_history.sql',
        'emit_vehicle_attribute_history'
      ),
    },
  ];

  it('covers six vocabularies, not a sample', () => {
    expect(VOCABULARIES).toHaveLength(6);
    for (const vocabulary of VOCABULARIES) {
      expect(vocabulary.values.length, vocabulary.prefix).toBeGreaterThan(0);
    }
  });

  it('names prefixes the source actually builds keys from', () => {
    // The first draft of this file guessed `vehicles.lifecycleStatus.`,
    // `.workshopStatus.` and `.powertrainCategory.`. The real prefixes are
    // `vehicles.lifecycle.`, `.workshop.` and `.powertrain.`, and the labels
    // were present all along — the test was inventing a vocabulary while
    // checking for invented vocabularies.
    //
    // Without this assertion a wrong prefix demands labels nobody renders, and
    // "fixing" it means adding dead keys until the test is quiet.
    const used = prefixesUsedInSource();
    expect(used.size).toBeGreaterThan(5);
    for (const vocabulary of VOCABULARIES) {
      expect(used, `${vocabulary.prefix} is not built by any component`).toContain(
        vocabulary.prefix
      );
    }
  });

  it.each(VOCABULARIES.map((v) => [v.prefix, v] as const))('%s', (_prefix, vocabulary) => {
    for (const value of vocabulary.values) {
      const key = `${vocabulary.prefix}${value}`;
      // `translate()` returns the key when it is missing, so an absent label is
      // silent everywhere except in front of an operator.
      expect(Object.keys(en), `${key} missing from en`).toContain(key);
      expect(Object.keys(ar), `${key} missing from ar`).toContain(key);
      expect(String((en as Record<string, string>)[key]).trim().length).toBeGreaterThan(0);
      expect(String((ar as Record<string, string>)[key]).trim().length).toBeGreaterThan(0);
    }
  });

  it('carries no label for a value the server cannot produce', () => {
    // The other direction, and the one a "did I add the key?" check misses.
    // `crm.addressType.shipping` and `.site` were labels for values
    // `ck_addresses_type` forbids — they read as capabilities the product has.
    for (const vocabulary of VOCABULARIES) {
      const declared = new Set(vocabulary.values.map((v) => `${vocabulary.prefix}${v}`));
      const orphans = Object.keys(en).filter(
        (key) => key.startsWith(vocabulary.prefix) && !declared.has(key)
      );
      expect(orphans, `${vocabulary.prefix} has labels for impossible values`).toEqual([]);
    }
  });
});
