/**
 * Observability discipline for the P1-15 instruments (P1-15).
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * `src/server/observability/metrics.ts` states, in a comment beside the P1-15
 * instrument names, that "`tests/foundation/p1-15-observability.test.ts` asserts
 * that, so the rule is enforced rather than remembered."
 *
 * Until this file existed, that sentence was false: the rule was remembered and
 * nothing enforced it. A comment that claims a test exists is worse than no
 * comment, because a reviewer stops looking. This suite makes the sentence true.
 *
 * ===========================================================================
 * WHAT THE RULE IS
 * ===========================================================================
 * A metric LABEL is the highest-risk place an identifier can land. Unlike a log
 * line it is not sampled, not rotated, and not redacted at read time; it becomes
 * a permanent time series in a store that has no tenant isolation. A label
 * carrying a tenant id turns the metrics backend into a tenant enumerator; a
 * label carrying a document id or a dedupe key turns it into a business-record
 * enumerator; and either explodes cardinality until the store falls over.
 *
 * So: **every metric label must be catalogue metadata** — a channel, a result
 * word, a provider code, a sequence code, an aggregate name, an error code — and
 * never an identifier, an address, a key, a URL, a token, or free text.
 *
 * The same rule holds for the `context` object of a structured log call, which
 * is the only part of a log line that carries caller-derived values.
 *
 * ===========================================================================
 * HOW IT IS ENFORCED
 * ===========================================================================
 * By reading the source. A runtime assertion could only cover the paths a unit
 * test can reach, and most instruments fire inside a database transaction. A
 * source scan covers every call site that exists, including ones nobody wrote a
 * test for — which is the point.
 *
 * Two scans:
 *   1. every `metrics().increment|observe|gauge(...)` call in `src/`;
 *   2. every `context: { ... }` object in a structured log call in
 *      `src/modules/shared-services/`.
 *
 * Both assert the KEY is allow-listed and the VALUE EXPRESSION mentions no
 * identifier-bearing name. Adding a label that is genuinely low-cardinality
 * means adding one word to `ALLOWED_LABEL_KEYS` here — a reviewable change, in
 * the file whose whole subject is the rule.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { METRICS } from '@/server/observability/metrics';
import { REPOSITORY_ROOT, API_SRC_ROOT } from '../../scripts/lib/repository-paths.mjs';

const ROOT = REPOSITORY_ROOT;
const SRC = API_SRC_ROOT;
const toPosix = (p: string): string => p.split(sep).join('/');

/**
 * Label keys the platform is allowed to emit.
 *
 * Every one names a value drawn from a fixed, code-owned vocabulary. There is no
 * entry here whose value could be chosen by a caller or read from a row.
 */
const ALLOWED_LABEL_KEYS = new Set([
  'aggregate', // registered aggregate name, e.g. `org.branch`
  'attemptNumber', // small integer
  'channel', // `email` | `in_app`
  'check', // readiness check name, a code constant
  'code', // error code from the catalog
  'eventType', // registered event name
  'failureClass', // classification word
  'from', // registered state name
  'locale', // language tag
  'operation', // registered operation id
  'outcome', // classification word
  'policy', // rate-limit policy name
  'provider', // provider code, e.g. `local_fake`
  'purpose', // `upload` | `download`, or a template purpose
  'reason', // classification word
  'resource', // export resource code
  'result', // classification word
  'retryCount', // small integer
  'rule', // render-failure rule name
  'scoped', // boolean
  'sequence', // registered sequence code
  'to', // registered state name
  'ttlSeconds', // bounded integer
]);

/**
 * Substrings that make a value expression suspect.
 *
 * Matched case-insensitively against the raw expression text, so
 * `input.dedupeKey`, `message.recipient_digest` and `version.storage_key` are
 * all caught whichever spelling the call site used.
 */
const FORBIDDEN_VALUE_FRAGMENTS = [
  'tenant',
  'userid',
  'user_id',
  'actor',
  'principal',
  'correlationid',
  'correlation_id',
  'documentid',
  'document_id',
  'versionid',
  'version_id',
  'linkid',
  'link_id',
  'messageid',
  'message_id',
  'templateid',
  'template_id',
  'branchid',
  'branch_id',
  'companyid',
  'company_id',
  'storagekey',
  'storage_key',
  'dedupekey',
  'dedupe_key',
  'recipient',
  'email',
  'phone',
  'vin',
  'url',
  'token',
  'filename',
  'file_name',
  'subject',
  'body',
  'variables',
  'secret',
  'password',
  'signature',
  'digest',
  'sha256',
  'title',
];

interface CallSite {
  readonly file: string;
  readonly line: number;
  readonly labels: readonly { key: string; expression: string }[];
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Balances braces from `start` (which must index a `{`) and returns the literal. */
function objectLiteralAt(source: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  return null;
}

/**
 * Splits an object-literal body into `key: expression` pairs at top level,
 * ignoring commas nested inside braces, brackets, parentheses or strings.
 */
function topLevelEntries(body: string): { key: string; expression: string }[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (quote) {
      current += ch;
      if (ch === quote && body[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);

  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const colon = part.indexOf(':');
      // Shorthand (`{ channel }`) means key and expression are the same name.
      if (colon < 0) return { key: part.trim(), expression: part.trim() };
      return { key: part.slice(0, colon).trim(), expression: part.slice(colon + 1).trim() };
    });
}

/** Finds every call of `pattern` and extracts its label object literal. */
function collectCallSites(pattern: RegExp, files: readonly string[]): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const rel = toPosix(relative(ROOT, file));
    for (const match of source.matchAll(pattern)) {
      const from = (match.index ?? 0) + match[0].length;
      // The label object is the next `{` that opens before the call closes. A
      // call with no object literal (e.g. `increment(METRICS.cacheMiss)`)
      // carries no labels and is trivially compliant.
      const close = source.indexOf(');', from);
      const brace = source.indexOf('{', from);
      if (brace < 0 || (close >= 0 && brace > close)) continue;
      const body = objectLiteralAt(source, brace);
      if (body === null) continue;
      sites.push({
        file: rel,
        line: source.slice(0, brace).split('\n').length,
        labels: topLevelEntries(body),
      });
    }
  }
  return sites;
}

const FILES = sourceFiles(SRC);
const METRIC_CALLS = collectCallSites(/metrics\(\)\.(?:increment|observe|gauge)\(/g, FILES);
const LOG_CONTEXTS = collectCallSites(
  /context:\s*(?=\{)/g,
  FILES.filter((f) => toPosix(f).includes('/modules/shared-services/'))
);

describe('P1-15 metric instrument catalogue', () => {
  const names = Object.values(METRICS);

  it('every instrument name is a lower-case dotted identifier', () => {
    for (const name of names) {
      expect(name, name).toMatch(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/);
    }
  });

  it('instrument names are unique — two concepts never share a series', () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it('declares every P1-15 instrument the shared services emit', () => {
    for (const key of [
      'numberAllocationCount',
      'auditAppendFailureCount',
      'transitionCount',
      'transitionConflictCount',
      'attachmentAuthorizationCount',
      'signedUrlCount',
      'signedUrlDuration',
      'notificationEnqueueCount',
      'notificationDeliveryCount',
      'notificationRetryCount',
      'notificationDeadLetterCount',
      'templateRenderCount',
      'templateRenderFailureCount',
      'eventRejectionCount',
      'normalizationRejectionCount',
      'queryLimitRejectionCount',
      'exportAuthorizationCount',
      'readinessCheckDuration',
      'readinessCheckCount',
    ] as const) {
      expect(METRICS[key], key).toBeTypeOf('string');
    }
  });

  it('no instrument name embeds an identifier or a tenant', () => {
    for (const name of names) {
      expect(name).not.toMatch(/tenant|user|document|recipient|token|key/i);
    }
  });
});

describe('metric labels carry catalogue metadata and never an identifier', () => {
  it('finds the metric call sites it is meant to police', () => {
    // A scan that silently matched nothing would pass every assertion below.
    expect(METRIC_CALLS.length).toBeGreaterThan(15);
  });

  it('every label key is on the reviewed allow-list', () => {
    const offenders = METRIC_CALLS.flatMap((site) =>
      site.labels
        .filter((label) => !ALLOWED_LABEL_KEYS.has(label.key))
        .map((label) => `${site.file}:${site.line} → ${label.key}`)
    );
    expect(offenders).toEqual([]);
  });

  it('no label VALUE expression mentions an identifier, address, key or token', () => {
    const offenders: string[] = [];
    for (const site of METRIC_CALLS) {
      for (const label of site.labels) {
        const haystack = label.expression.toLowerCase();
        for (const fragment of FORBIDDEN_VALUE_FRAGMENTS) {
          if (haystack.includes(fragment)) {
            offenders.push(`${site.file}:${site.line} → ${label.key}: ${label.expression}`);
            break;
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no label value is a template literal, which is how free text gets in', () => {
    const offenders = METRIC_CALLS.flatMap((site) =>
      site.labels
        .filter((label) => label.expression.includes('`'))
        .map((label) => `${site.file}:${site.line} → ${label.key}`)
    );
    expect(offenders).toEqual([]);
  });
});

describe('shared-services log context carries the same discipline', () => {
  it('finds the log context objects it is meant to police', () => {
    expect(LOG_CONTEXTS.length).toBeGreaterThan(3);
  });

  it('every context key is on the reviewed allow-list', () => {
    const offenders = LOG_CONTEXTS.flatMap((site) =>
      site.labels
        .filter((label) => !ALLOWED_LABEL_KEYS.has(label.key))
        .map((label) => `${site.file}:${site.line} → ${label.key}`)
    );
    expect(offenders).toEqual([]);
  });

  it('no context VALUE expression mentions an identifier, address, key or token', () => {
    const offenders: string[] = [];
    for (const site of LOG_CONTEXTS) {
      for (const label of site.labels) {
        const haystack = label.expression.toLowerCase();
        for (const fragment of FORBIDDEN_VALUE_FRAGMENTS) {
          if (haystack.includes(fragment)) {
            offenders.push(`${site.file}:${site.line} → ${label.key}: ${label.expression}`);
            break;
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the scanner itself detects a violation', () => {
  // A lint that has never been shown to fail is indistinguishable from a lint
  // that always passes, so the parser is driven directly against a synthetic
  // offending call.
  const offending = `
    metrics().increment(METRICS.attachmentAuthorizationCount, {
      tenantRef: context.principal.tenantId,
      storageKey: version.storage_key,
      result: 'success',
    });
  `;

  it('extracts the keys and expressions of a label object', () => {
    const brace = offending.indexOf('{', offending.indexOf('increment('));
    const entries = topLevelEntries(objectLiteralAt(offending, brace) as string);
    expect(entries.map((e) => e.key)).toEqual(['tenantRef', 'storageKey', 'result']);
  });

  it('rejects the disallowed keys and flags the identifier-bearing values', () => {
    const brace = offending.indexOf('{', offending.indexOf('increment('));
    const entries = topLevelEntries(objectLiteralAt(offending, brace) as string);

    const badKeys = entries.filter((e) => !ALLOWED_LABEL_KEYS.has(e.key)).map((e) => e.key);
    expect(badKeys).toEqual(['tenantRef', 'storageKey']);

    const badValues = entries
      .filter((e) =>
        FORBIDDEN_VALUE_FRAGMENTS.some((fragment) => e.expression.toLowerCase().includes(fragment))
      )
      .map((e) => e.key);
    expect(badValues).toEqual(['tenantRef', 'storageKey']);

    // And the compliant one is left alone.
    expect(ALLOWED_LABEL_KEYS.has('result')).toBe(true);
  });
});
