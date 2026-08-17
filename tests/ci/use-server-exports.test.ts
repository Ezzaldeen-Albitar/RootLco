import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a CI gate, deliberately plain JavaScript.
import {
  declaresUseServer,
  offendingExports,
  run,
  stripComments,
} from '../../scripts/ci/check-use-server-exports.mjs';

/**
 * The `'use server'` export gate, proved on the defect that produced it.
 *
 * `features/attachments/api.ts` shipped `export { EMPTY_CATEGORIES }` — an array
 * nothing imported. Next refuses such a module at evaluation, and because that
 * happens while the SERVER CHUNK is instantiated it takes down every Server
 * Action bundled beside it. The casualty was `listWarningLightCodes()` in a
 * different feature, which does not import that file: it rejected before
 * reaching the API, and the reception warning-light step waited on a catalogue
 * that was never coming.
 *
 * Three tiers were green while that was true. `next dev` evaluates lazily and
 * never instantiated the module in a failing context; the defect appeared the
 * first time the tier was built the way it ships. So the gate is the point, and
 * the cases below are about the gate FIRING rather than about the tree being
 * clean — a clean tree is what it looked like all along.
 */
describe("the 'use server' export gate", () => {
  it('fires on the exact export that broke the server chunk', () => {
    const problems = offendingExports(
      'apps/web/src/features/attachments/api.ts',
      [
        "'use server';",
        'const EMPTY = [];',
        'export async function ok() {}',
        'export { EMPTY };',
      ].join('\n')
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('re-exports EMPTY');
  });

  it('fires on every other shape the rule forbids', () => {
    for (const [label, source] of [
      ['const', "'use server';\nexport const handler = 1;"],
      ['let', "'use server';\nexport let handler = 1;"],
      ['class', "'use server';\nexport class Thing {}"],
      ['non-async function', "'use server';\nexport function handler() {}"],
      ['default non-async', "'use server';\nexport default function handler() {}"],
    ] as const) {
      expect(offendingExports('p.ts', source), label).toHaveLength(1);
    }
  });

  it('accepts what the contract allows, so it is not simply always red', () => {
    for (const [label, source] of [
      ['an async function', "'use server';\nexport async function handler() {}"],
      [
        'two async functions',
        "'use server';\nexport async function a() {}\nexport async function b() {}",
      ],
      // Types are erased before Next sees the module, so they are not exports.
      [
        'a type-only re-export',
        "'use server';\nexport async function a() {}\nexport { type Thing };",
      ],
      [
        'an exported interface',
        "'use server';\nexport async function a() {}\nexport interface Thing { x: number }",
      ],
      [
        'an exported type alias',
        "'use server';\nexport async function a() {}\nexport type Thing = number;",
      ],
      // A module without the directive may export whatever it likes.
      ['no directive at all', 'export const anything = [];'],
    ] as const) {
      expect(offendingExports('p.ts', source), label).toEqual([]);
    }
  });

  it('reads the directive rather than guessing, and ignores it inside a comment', () => {
    expect(declaresUseServer("'use server';\n")).toBe(true);
    expect(declaresUseServer('"use server";\n')).toBe(true);
    // The rule quoted in a docblock must not turn an ordinary module into a
    // Server Action module — the prose-read-as-code failure this repository has
    // hit repeatedly.
    expect(declaresUseServer("/* a 'use server' file may only… */\nexport const x = 1;")).toBe(
      false
    );
    expect(stripComments("/* 'use server' */ const a = 1;")).not.toContain('use server');
  });

  it('reports EVERY offending export, not merely the first', () => {
    const problems = offendingExports(
      'p.ts',
      [
        "'use server';",
        'export const a = 1;',
        'export const b = 2;',
        'export function c() {}',
      ].join('\n')
    );
    expect(problems).toHaveLength(3);
  });

  it('is clean on the repository, over a corpus it really opened', () => {
    const result = run();
    // Anti-vacuity in both directions: files were read, and some of them really
    // are Server Action modules. A sweep of nothing satisfies the rule having
    // examined nothing, which is exactly how this defect survived.
    expect(result.scanned).toBeGreaterThan(100);
    expect(result.serverModules).toBeGreaterThan(10);
    expect(result.problems).toEqual([]);
  });
});
