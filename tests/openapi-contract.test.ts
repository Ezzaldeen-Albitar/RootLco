/**
 * OpenAPI code/spec divergence gate (P1-13-BE-020, P1-13-QA-006).
 *
 * The committed `docs/api/openapi.v1.json` is *generated* from the operation
 * registry. This test regenerates it and compares, so the published contract
 * cannot drift from the code that serves it — the failure mode where a client
 * team builds against a document describing an endpoint that changed months ago.
 *
 * Regenerate deliberately after an intentional contract change:
 *
 *   UPDATE_OPENAPI=1 npx vitest run tests/openapi-contract.test.ts
 *
 * Writing the file is opt-in precisely so a drifting build cannot "fix" itself.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildOpenApiDocument } from '@/server/openapi/document';

// Importing the route module executes its `defineOperation` call, which is what
// puts the operation in the registry. If a route is not imported anywhere the
// authorization-coverage check catches it; here we only need the registry filled.
import '@/app/api/v1/meta/ping/route';

const DOCUMENT_PATH = join(process.cwd(), 'docs', 'api', 'openapi.v1.json');

describe('OpenAPI contract', () => {
  const generated = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

  it('matches the committed document', () => {
    if (process.env.UPDATE_OPENAPI === '1') {
      mkdirSync(dirname(DOCUMENT_PATH), { recursive: true });
      writeFileSync(DOCUMENT_PATH, generated, 'utf8');
    }
    // Compared as parsed JSON, not as text: whitespace is Prettier's business
    // (it formats the committed file), while the *contract* is the structure.
    // A byte comparison would turn a formatting pass into a false divergence.
    const committed: unknown = JSON.parse(readFileSync(DOCUMENT_PATH, 'utf8'));
    expect(committed).toEqual(JSON.parse(generated));
  });

  it('registers the exemplar operation with its guard metadata', () => {
    const document = JSON.parse(generated) as {
      paths: Record<
        string,
        Record<
          string,
          { operationId: string; 'x-required-permissions': string[]; security: unknown[] }
        >
      >;
    };
    const ping = document.paths['/api/v1/meta/ping']?.['get'];
    expect(ping?.operationId).toBe('meta.ping');
    expect(ping?.['x-required-permissions']).toEqual(['platform.meta.ping']);
    // A secured operation must not advertise itself as public.
    expect(ping?.security).not.toEqual([]);
  });

  it('declares every failure response as the shared problem document', () => {
    const document = JSON.parse(generated) as {
      paths: Record<string, Record<string, { responses: Record<string, { $ref?: string }> }>>;
    };
    for (const item of Object.values(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        for (const [status, response] of Object.entries(operation.responses)) {
          if (Number(status) < 400) continue;
          expect(response.$ref).toBe('#/components/responses/Problem');
        }
      }
    }
  });
});
