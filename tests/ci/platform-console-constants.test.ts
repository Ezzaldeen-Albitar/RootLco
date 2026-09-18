/**
 * The console constants that exist twice, held to one value.
 *
 * ## What this closes
 *
 * `apps/web` may not import backend source, so two values the Platform Owner
 * Console needs before it spends a request are written out a second time in
 * `features/platform/types.ts`:
 *
 *   - the widest audit window `platform.audit-search` accepts, so the search can
 *     name the real limit instead of sending a request the server will refuse
 *     and drawing the refusal as an outage;
 *   - the charge statuses `platform.charge-list` filters by, so the billing
 *     panel can offer them.
 *
 * Each carried a hand-written comment naming the file it was copied from. A
 * comment is not a check: it stays exactly as true-looking after the server
 * changes, and the screen then states a limit nobody applies or offers a filter
 * the operation refuses. This file reads both sides and fails when they differ,
 * which is the only form of pin that turns red at the moment of the divergence.
 *
 * ## Read as text, on purpose
 *
 * The API constants are declarations in modules whose import graph reaches the
 * database, the outbox worker and the environment schema. Importing them here to
 * compare two literals would make this suite depend on all of that. Both sides
 * are therefore extracted from source, and the extractors FAIL CLOSED: each
 * returns null when the declaration is not found, and the cases below prove it,
 * so a rename cannot leave this file passing over nothing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API_INSIGHT = join(
  'apps',
  'api',
  'src',
  'modules',
  'platform',
  'application',
  'insight-service.ts'
);
const API_PLATFORM_INDEX = join('apps', 'api', 'src', 'modules', 'platform', 'index.ts');
const WEB_TYPES = join('apps', 'web', 'src', 'features', 'platform', 'types.ts');

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), 'utf8');
}

/** The value of `export const <name> = <digits>;`, or null when absent. */
export function numberConstant(source: string, name: string): number | null {
  const match = new RegExp(`export const ${name}\\s*=\\s*(\\d[\\d_]*)\\s*;`).exec(source);
  return match ? Number(match[1]?.replace(/_/g, '')) : null;
}

/** The members of `export const <name> = ['a', 'b'] as const;`, or null when absent. */
export function stringListConstant(source: string, name: string): readonly string[] | null {
  const match = new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!match) return null;
  const members = [...(match[1] ?? '').matchAll(/'([^']*)'|"([^"]*)"/g)].map(
    (entry) => entry[1] ?? entry[2] ?? ''
  );
  return members;
}

describe('the extractors fail closed', () => {
  it('reads a numeric constant and answers null when there is none', () => {
    expect(
      numberConstant('export const MAX_AUDIT_WINDOW_DAYS = 92;', 'MAX_AUDIT_WINDOW_DAYS')
    ).toBe(92);
    expect(numberConstant('const MAX_AUDIT_WINDOW_DAYS = 92;', 'MAX_AUDIT_WINDOW_DAYS')).toBeNull();
    expect(numberConstant('nothing at all', 'MAX_AUDIT_WINDOW_DAYS')).toBeNull();
  });

  it('reads a string list and answers null when there is none', () => {
    expect(
      stringListConstant(
        "export const CHARGE_STATUSES = ['open', 'void'] as const;",
        'CHARGE_STATUSES'
      )
    ).toEqual(['open', 'void']);
    expect(stringListConstant('nothing at all', 'CHARGE_STATUSES')).toBeNull();
  });
});

describe('the audit window is one value in two workspaces', () => {
  it('is declared by the API service that enforces it', () => {
    expect(numberConstant(read(API_INSIGHT), 'MAX_AUDIT_WINDOW_DAYS')).toBeGreaterThan(0);
  });

  it('is repeated in the console by the same number, never a drifted one', () => {
    const server = numberConstant(read(API_INSIGHT), 'MAX_AUDIT_WINDOW_DAYS');
    const console_ = numberConstant(read(WEB_TYPES), 'AUDIT_MAX_WINDOW_DAYS');
    expect(server, 'MAX_AUDIT_WINDOW_DAYS in the platform insight service').not.toBeNull();
    expect(console_, 'AUDIT_MAX_WINDOW_DAYS in the console types').not.toBeNull();
    expect(console_, 'the console states a window the server does not apply').toBe(server);
  });
});

describe('the charge statuses are one list in two workspaces', () => {
  it('is declared by the platform module the route schema is built from', () => {
    expect(stringListConstant(read(API_PLATFORM_INDEX), 'CHARGE_STATUSES')?.length).toBeGreaterThan(
      0
    );
  });

  it('is repeated in the console in the same values and the same order', () => {
    const server = stringListConstant(read(API_PLATFORM_INDEX), 'CHARGE_STATUSES');
    const console_ = stringListConstant(read(WEB_TYPES), 'CHARGE_STATUSES');
    expect(server, 'CHARGE_STATUSES in the platform module').not.toBeNull();
    expect(console_, 'CHARGE_STATUSES in the console types').not.toBeNull();
    expect(console_, 'the console offers a status filter the operation would refuse').toEqual(
      server
    );
  });
});
