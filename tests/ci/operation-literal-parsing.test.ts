/**
 * Falsifiability fixture for how the coverage gate READS a `defineOperation`
 * literal.
 *
 * `scripts/check-operation-test-coverage.mjs` derives an operation's evidence
 * obligations from the fields it parses out of that literal — `scope`,
 * `auditClass`, `public`, `idempotent`, `versionGuarded`. Until this suite
 * existed the parse was a regex over the RAW literal text, which took the first
 * match and had no idea what a comment was.
 *
 * That is a false-green vector, not a cosmetic bug, because a literal in this
 * codebase routinely explains its choice by naming the alternative it rejected,
 * in a comment directly above the real key. Reading the comment instead of the
 * code goes wrong in two directions and only one of them is loud:
 *
 *   harmless   a commented `scope: 'branch'` above a real `tenant` ADDS an
 *              isolation obligation nothing owes. The gate goes red and somebody
 *              looks. One P1-20 catalogue read was in exactly this state for the
 *              whole of the phase, and survived only because its manifest entry
 *              declared `isolation` for an unrelated reason.
 *
 *   DANGEROUS  a commented `scope: 'tenant'` above a real `branch` REMOVES the
 *              isolation obligation; a commented `auditClass: 'none'` above a
 *              real class removes `audit`. The gate reports green over an
 *              operation whose evidence was never demanded, and nothing looks.
 *
 * That operation is named in the docblock over `literalString` in the gate
 * itself, and deliberately NOT here. `p1-24-operation-register.mjs` builds an
 * operation's reference list by asking whether a file under `tests/` MENTIONS
 * the id — documented as a mention-level denominator, and correct as such — so
 * spelling it in this file would list a parser unit test among that operation's
 * evidence, which is a thing this codebase has been burned by declaring.
 *
 * So every case below asserts the CODE value wins, and each one first asserts
 * that the literal it was fed really does contain the trap — a case whose input
 * carried no misleading comment would pass against the broken parser too, and
 * would prove nothing.
 *
 * The end-to-end cases drive `scanRegisteredOperations()` over a synthetic
 * source tree rather than the real one, so they state a rule about the parser
 * instead of a fact about today's routes. The `svc.thing-*` ids they use are
 * registered nowhere, for the same reason.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  literalString,
  literalTrue,
  derivedRequirements,
  scanRegisteredOperations,
} from '../../scripts/check-operation-test-coverage.mjs';
import { API_SRC_PATH } from '../../scripts/lib/repository-paths.mjs';

/** The regex the gate used before this suite existed, kept as the control. */
const commentBlindString = (source: string, key: string): string | null => {
  const m = new RegExp(`\\b${key}\\s*:\\s*['"\`]([^'"\`]*)['"\`]`).exec(source);
  return m ? (m[1] ?? null) : null;
};
const commentBlindTrue = (source: string, key: string): boolean =>
  new RegExp(`\\b${key}\\s*:\\s*true\\b`).test(source);

describe('defineOperation literal parsing — the code wins, the comment does not', () => {
  it('reads the declared scope, not a scope named in the comment above it', () => {
    const literal = `{
  id: 'svc.thing-list',
  // \`tenant\`, because the catalogue is tenant-wide reference data. Declaring
  // \`scope: 'branch'\` here would be worse than useless: an unfiltered listing
  // names no branch, and requireScopedPermissions fails closed on an empty one.
  scope: 'tenant',
}`;
    expect(commentBlindString(literal, 'scope'), 'the trap is absent from this input').toBe(
      'branch'
    );
    expect(literalString(literal, 'scope')).toBe('tenant');
  });

  it('closes the DANGEROUS direction: a commented `tenant` cannot hide a real `branch`', () => {
    const literal = `{
  id: 'svc.thing-read',
  /* Not \`scope: 'tenant'\` — this table carries branch_id and the read must be
     bounded by the caller's branch. */
  scope: 'branch',
  auditClass: 'none',
}`;
    expect(commentBlindString(literal, 'scope'), 'the trap is absent from this input').toBe(
      'tenant'
    );
    expect(literalString(literal, 'scope')).toBe('branch');

    /*
     * The consequence, stated where it bites. Under the old parser this
     * operation derived no `isolation` obligation at all, so a suite that never
     * proved the branch boundary would have passed.
     */
    const operation = {
      id: 'svc.thing-read',
      scope: literalString(literal, 'scope'),
      auditClass: literalString(literal, 'auditClass'),
      path: '/things/{thingId}',
    };
    expect(derivedRequirements(operation)).toContain('isolation');
    expect(
      derivedRequirements({ ...operation, scope: commentBlindString(literal, 'scope') }),
      'the control did not reproduce the false green this test exists to close'
    ).not.toContain('isolation');
  });

  it('closes the same direction for auditClass', () => {
    const literal = `{
  id: 'svc.thing-write',
  // \`auditClass: 'none'\` would be wrong here: this writes a priced record.
  auditClass: 'financial',
  scope: 'tenant',
}`;
    expect(commentBlindString(literal, 'auditClass'), 'the trap is absent from this input').toBe(
      'none'
    );
    expect(literalString(literal, 'auditClass')).toBe('financial');
    expect(
      derivedRequirements({
        id: 'svc.thing-write',
        auditClass: literalString(literal, 'auditClass'),
      })
    ).toContain('audit');
  });

  it('does not read a boolean flag out of prose that only discusses it', () => {
    const literal = `{
  id: 'svc.thing-list',
  // \`idempotent: true\` is deliberately NOT declared: a GET replays for free and
  // an idempotency key on a read would create a replay obligation with nothing
  // to replay.
  method: 'GET',
  scope: 'tenant',
}`;
    expect(commentBlindTrue(literal, 'idempotent'), 'the trap is absent from this input').toBe(
      true
    );
    expect(literalTrue(literal, 'idempotent')).toBe(false);
  });

  it('still reads a flag that IS declared, so the strip cannot be a blanket false', () => {
    const literal = `{
  id: 'svc.thing-create',
  idempotent: true,
  versionGuarded: true,
  public: true,
  scope: 'tenant',
}`;
    expect(literalTrue(literal, 'idempotent')).toBe(true);
    expect(literalTrue(literal, 'versionGuarded')).toBe(true);
    expect(literalTrue(literal, 'public')).toBe(true);
    expect(literalTrue(literal, 'deprecated')).toBe(false);
  });

  it('reads a value the comment sits INSIDE the pair of, which the old regex missed entirely', () => {
    const literal = `{
  id: 'svc.thing-list',
  scope: /* not 'branch' */ 'company',
}`;
    expect(commentBlindString(literal, 'scope'), 'the trap is absent from this input').toBeNull();
    expect(literalString(literal, 'scope')).toBe('company');
    expect(derivedRequirements({ id: 'svc.thing-list', scope: 'company' })).toContain('isolation');
  });

  it('leaves a `//` inside a real string alone — a path is not a comment', () => {
    const literal = `{
  id: 'svc.thing-list',
  path: '/services',
  summary: 'Listed at http://localhost:3000/api/v1/services during acceptance.',
  scope: 'branch',
}`;
    expect(literalString(literal, 'summary')).toBe(
      'Listed at http://localhost:3000/api/v1/services during acceptance.'
    );
    expect(literalString(literal, 'path')).toBe('/services');
    expect(
      literalString(literal, 'scope'),
      'the strip truncated at a URL and lost a real key'
    ).toBe('branch');
  });

  it('survives an input that is null or empty rather than throwing', () => {
    expect(literalString(null as unknown as string, 'scope')).toBeNull();
    expect(literalString('', 'scope')).toBeNull();
    expect(literalTrue(null as unknown as string, 'idempotent')).toBe(false);
  });
});

describe('scanRegisteredOperations — a comment is not a registration', () => {
  /** Writes a synthetic API source tree and returns its repository root. */
  const withTree = (files: Record<string, string>, run: (root: string) => void) => {
    const root = mkdtempSync(join(tmpdir(), 'rootlco-opscan-'));
    try {
      for (const [rel, body] of Object.entries(files)) {
        const full = join(root, API_SRC_PATH, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, body);
      }
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it('registers the declared scope, not the one the comment rejects', () => {
    withTree(
      {
        'app/api/v1/things/route.ts': `import { defineOperation } from '@/server/auth/operation-registry';

export const THING_LIST = defineOperation({
  id: 'svc.thing-list',
  module: 'service-catalog',
  method: 'GET',
  path: '/things',
  // Declaring \`scope: 'branch'\` here would fail closed on an unfiltered listing.
  scope: 'tenant',
  auditClass: 'none',
});
`,
      },
      (root) => {
        const operations = scanRegisteredOperations(root);
        expect(operations.get('svc.thing-list')?.scope).toBe('tenant');
        expect(operations.get('svc.thing-list')?.surface).toBe('public-api');
        expect(derivedRequirements(operations.get('svc.thing-list'))).not.toContain('isolation');
      }
    );
  });

  it('does not register an operation that exists only inside a comment', () => {
    /*
     * `literalAt` balances braces with no idea which are code, so a comment that
     * merely MENTIONS defineOperation() sends it hunting the next `{` in the
     * file. Six such comments exist in the real tree and survive only because
     * the slice happens to contain no `id:`. One that spelled a whole literal
     * would register a phantom the gate then demands evidence for.
     */
    withTree(
      {
        'server/audit/notes.ts': `/**
 * Enforcement note. \`defineOperation({ id: 'svc.ghost-op', scope: 'branch' })\`
 * is what a caller would write, and this module refuses it.
 */
export const AUDIT_NOTE = 1;
`,
      },
      (root) => {
        expect([...scanRegisteredOperations(root).keys()]).toEqual([]);
      }
    );
  });

  it('does not let a commented-out stale copy overwrite the live registration', () => {
    /*
     * `operations.set(id, ...)` is last-write-wins, so a dead copy sitting AFTER
     * the real one replaces its facts — the false-green shape, because the dead
     * copy is exactly where an old, weaker declaration lives.
     */
    withTree(
      {
        'app/api/v1/things/route.ts': `import { defineOperation } from '@/server/auth/operation-registry';

export const THING_READ = defineOperation({
  id: 'svc.thing-read',
  module: 'service-catalog',
  method: 'GET',
  path: '/things/{thingId}',
  scope: 'branch',
  auditClass: 'access',
});

// Superseded by the registration above; kept for the review trail.
// export const OLD_THING_READ = defineOperation({
//   id: 'svc.thing-read',
//   scope: 'tenant',
//   auditClass: 'none',
// });
`,
      },
      (root) => {
        const operation = scanRegisteredOperations(root).get('svc.thing-read');
        expect(operation?.scope).toBe('branch');
        expect(operation?.auditClass).toBe('access');
        expect(derivedRequirements(operation)).toEqual(
          expect.arrayContaining(['isolation', 'audit', 'cross-tenant'])
        );
      }
    );
  });
});
