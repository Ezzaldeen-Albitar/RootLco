#!/usr/bin/env node
/**
 * OpenAPI structural validation (P1-13-BE-020).
 *
 * Validates the committed `docs/api/openapi.v1.json` without pulling in a
 * validator dependency. Two complementary gates protect the contract:
 *
 *  1. **This script** — the document is structurally sound: every `$ref`
 *     resolves, operationIds are unique, every operation declares security and
 *     its required-permission extension, every failure response points at the
 *     shared problem component, and no path escapes `/api/v1`.
 *  2. **`tests/foundation/openapi.test.ts`** — the document still *matches the
 *     code*: it is regenerated from the operation registry and compared. That is
 *     the divergence gate; this one is the sanity gate. Neither replaces the
 *     other: a hand-edited document could be perfectly well-formed and still
 *     describe an endpoint that no longer exists.
 *
 * Exit codes: 0 valid · 1 invalid · 2 IO error.
 */
import { readFileSync, existsSync } from 'node:fs';
import { REPOSITORY_ROOT } from './lib/repository-paths.mjs';
import { join } from 'node:path';

const ROOT = REPOSITORY_ROOT;
const DOCUMENT_PATH = join(ROOT, 'docs', 'api', 'openapi.v1.json');
const API_PREFIX = '/api/v1';

if (!existsSync(DOCUMENT_PATH)) {
  console.error(`OpenAPI document not found at docs/api/openapi.v1.json`);
  process.exit(2);
}

let document;
try {
  document = JSON.parse(readFileSync(DOCUMENT_PATH, 'utf8'));
} catch (error) {
  console.error(`OpenAPI document is not valid JSON: ${error.message}`);
  process.exit(2);
}

const errors = [];
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];

/** Resolves a `#/a/b/c` pointer against the document. */
function resolvePointer(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let node = document;
  for (const segment of ref.slice(2).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

/** Walks the whole document collecting unresolvable `$ref`s. */
function checkRefs(node, path) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child, index) => checkRefs(child, `${path}[${index}]`));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref') {
      if (resolvePointer(value) === undefined) {
        errors.push(`${path}: unresolvable $ref "${value}"`);
      }
    } else {
      checkRefs(value, `${path}/${key}`);
    }
  }
}

// --- top level -------------------------------------------------------------
if (typeof document.openapi !== 'string' || !document.openapi.startsWith('3.')) {
  errors.push('openapi: must be a 3.x version string');
}
if (!document.info?.title || !document.info?.version) {
  errors.push('info: title and version are required');
}
if (!document.paths || typeof document.paths !== 'object') {
  errors.push('paths: missing');
}
if (!document.components?.schemas?.ProblemDocument) {
  errors.push('components.schemas.ProblemDocument: the shared error shape is required');
}

// The product name is pending owner approval (ADR-011) and must not leak into a
// published contract as if it were decided.
const infoText = JSON.stringify(document.info ?? {});
if (
  /RootLco\s*(CRM|ERP|Platform)\b/i.test(infoText) === false &&
  infoText.includes('PRODUCT NAME')
) {
  errors.push('info: the product-name placeholder must not appear in a published contract');
}

// --- operations ------------------------------------------------------------
const operationIds = new Map();
for (const [path, item] of Object.entries(document.paths ?? {})) {
  if (!path.startsWith(API_PREFIX)) {
    errors.push(`paths: "${path}" is outside the versioned prefix ${API_PREFIX}`);
  }
  for (const [method, operation] of Object.entries(item ?? {})) {
    if (!HTTP_METHODS.includes(method)) continue;
    const label = `${method.toUpperCase()} ${path}`;

    if (!operation.operationId) {
      errors.push(`${label}: operationId is required`);
    } else if (operationIds.has(operation.operationId)) {
      errors.push(
        `${label}: duplicate operationId "${operation.operationId}" (also ${operationIds.get(operation.operationId)})`
      );
    } else {
      operationIds.set(operation.operationId, label);
    }

    if (!operation.summary) errors.push(`${label}: summary is required`);
    if (!operation.responses || Object.keys(operation.responses).length === 0) {
      errors.push(`${label}: at least one response is required`);
    }
    // 202 was missing until the contract started publishing the status each
    // operation actually returns. `POST /auth/password-reset` has always answered
    // `202 Accepted` -- deliberately, so a caller cannot learn whether an account
    // exists -- but the generator advertised a fixed `200` for every operation, so
    // this check never saw the real code and passed. A checker is only as honest
    // as the document it reads.
    if (
      !operation.responses?.['200'] &&
      !operation.responses?.['201'] &&
      !operation.responses?.['202'] &&
      !operation.responses?.['204']
    ) {
      errors.push(`${label}: no success response declared`);
    }

    // Security must be explicit either way. An operation with no `security` key
    // inherits the document default, which is exactly the ambiguity that lets an
    // endpoint ship unauthenticated by accident.
    if (!Array.isArray(operation.security)) {
      errors.push(`${label}: security must be declared explicitly (use [] for public)`);
    }

    const permissions = operation['x-required-permissions'];
    if (!Array.isArray(permissions)) {
      errors.push(`${label}: x-required-permissions is required`);
    } else if (
      permissions.length === 0 &&
      Array.isArray(operation.security) &&
      operation.security.length > 0
    ) {
      errors.push(`${label}: secured operation declares no required permissions`);
    }

    // Every declared failure must use the shared problem response.
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      if (Number(status) < 400) continue;
      const ref = response?.$ref ?? '';
      const isProblem =
        ref === '#/components/responses/Problem' ||
        response?.content?.['application/problem+json'] !== undefined;
      if (!isProblem) {
        errors.push(`${label}: response ${status} does not use the shared problem document`);
      }
    }
  }
}

checkRefs(document, '#');

const operationCount = operationIds.size;
console.log(
  `OpenAPI: ${document.openapi}, ${Object.keys(document.paths ?? {}).length} path(s), ${operationCount} operation(s)`
);
if (errors.length === 0) {
  console.log('OK: document is structurally valid and every operation is guarded');
} else {
  console.error(`\n${errors.length} problem(s):`);
  for (const error of errors) console.error(`  - ${error}`);
}
process.exit(errors.length === 0 ? 0 : 1);
