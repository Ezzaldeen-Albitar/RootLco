/**
 * The Web idempotency manifest must not drift from the published contract
 * (`P1-27-INT-003`).
 *
 * The manifest is generated from `docs/api/openapi.v1.json`. If a backend phase
 * adds an idempotent operation and nobody regenerates it, the Web client would
 * fall back to its unknown-path behaviour — which errs toward sending a key, so
 * the operation still works, but the table has quietly stopped being the
 * contract. This is the check that says so out loud.
 *
 * It also pins the derivation itself. `readContract` decides "idempotent" from
 * the presence of the `IdempotencyKey` parameter `$ref`, which is exactly what
 * the document generator emits for `operation.idempotent`. A change to either
 * side that broke that correspondence would otherwise be invisible.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import { readContract, render } from '../../scripts/ci/generate-idempotent-operations.mjs';

const MANIFEST = join(
  REPOSITORY_ROOT,
  'apps',
  'web',
  'src',
  'lib',
  'api',
  'idempotent-operations.ts'
);
const CONTRACT = join(REPOSITORY_ROOT, 'docs', 'api', 'openapi.v1.json');

describe('the derivation', () => {
  it('reads idempotency from the IdempotencyKey parameter, not from the method', () => {
    const document = {
      paths: {
        '/api/v1/thing': {
          post: { operationId: 'x.create', parameters: [] },
          put: {
            operationId: 'x.set',
            parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
          },
          get: { operationId: 'x.read', parameters: [] },
        },
      },
    };
    const operations = readContract(JSON.stringify(document));
    const byId = new Map(operations.map((operation) => [operation.operationId, operation]));

    // A POST WITHOUT the parameter is not idempotent — which the old
    // method-based rule got exactly backwards.
    expect(byId.get('x.create')?.idempotent).toBe(false);
    // A PUT WITH it is.
    expect(byId.get('x.set')?.idempotent).toBe(true);
    expect(byId.get('x.read')?.idempotent).toBe(false);
  });

  it('strips the version prefix and sorts deterministically', () => {
    const document = {
      paths: {
        '/api/v1/zebra': { get: { operationId: 'z', parameters: [] } },
        '/api/v1/alpha': { get: { operationId: 'a', parameters: [] } },
      },
    };
    const operations = readContract(JSON.stringify(document));
    expect(operations.map((operation) => operation.template)).toEqual(['/alpha', '/zebra']);
  });

  it('renders byte-identically for the same input, so the file is stable', () => {
    const text = readFileSync(CONTRACT, 'utf8');
    expect(render(readContract(text))).toBe(render(readContract(text)));
  });
});

describe('the shipped manifest', () => {
  it('matches the published contract exactly', () => {
    const expected = render(readContract(readFileSync(CONTRACT, 'utf8')));
    const actual = readFileSync(MANIFEST, 'utf8').replace(/\r\n/g, '\n');
    // Not a count comparison. A count matches while one operation has been
    // swapped for another, which is precisely the drift worth catching.
    expect(actual).toBe(expected);
  });

  it('is what the generator writes, proven by running the real generator', () => {
    // The check above compares against an in-process render. This runs the
    // shipped script as CI does, because a module that exports a working
    // `render` and a broken CLI would pass the first and fail the build.
    const output = execFileSync(
      process.execPath,
      [join(REPOSITORY_ROOT, 'scripts', 'ci', 'generate-idempotent-operations.mjs'), '--check'],
      { encoding: 'utf8' }
    );
    expect(output).toContain('OK: manifest matches the published contract');
  }, 30_000);
});
