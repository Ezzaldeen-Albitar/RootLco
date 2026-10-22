#!/usr/bin/env node
// Bounded local fault routing for the P1-31 operation set. No network transport.
import { createReadStream, readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { P1_31_OPERATION_IDS } from '../ci/check-p1-31-access.mjs';
import { API_SRC_ROOT } from '../lib/repository-paths.mjs';
import { parseModule } from '../lib/typescript-source.mjs';

export const MONITOR_LIMITS = Object.freeze({
  inputBytes: 32 * 1024 * 1024,
  lineBytes: 64 * 1024,
  alerts: 1000,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function registeredErrorCodes() {
  const source = parseModule(readFileSync(join(API_SRC_ROOT, 'server/errors/catalog.ts'), 'utf8'));
  if (!source) throw new Error('Error catalog cannot be parsed.');
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'ERROR_CODES') continue;
      let value = declaration.initializer;
      while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value)))
        value = value.expression;
      if (
        !value ||
        !ts.isArrayLiteralExpression(value) ||
        !value.elements.length ||
        !value.elements.every(ts.isStringLiteral)
      )
        throw new Error('Error catalog is not a literal code set.');
      return new Set(value.elements.map((element) => element.text));
    }
  }
  throw new Error('Error catalog code set is absent.');
}
const ERROR_CODES = registeredErrorCodes();

/** Converts a bounded local log stream into an explicit, sanitized local queue. */
export function createAlertRouter(environment, operations = P1_31_OPERATION_IDS) {
  if (!['local', 'test'].includes(environment))
    throw new Error('Explicit local or test environment required.');
  const allowed = new Set(operations);
  const seen = new Set();
  const counts = { read: 0, ignored: 0, malformed: 0, duplicate: 0, routed: 0 };
  return {
    counts,
    accept(line) {
      counts.read += 1;
      if (Buffer.byteLength(line, 'utf8') > MONITOR_LIMITS.lineBytes) {
        counts.malformed += 1;
        throw new Error('Log line exceeds the bound.');
      }
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        counts.malformed += 1;
        return null;
      }
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        counts.malformed += 1;
        return null;
      }
      if (
        record.env !== environment ||
        !allowed.has(record.operation) ||
        record.result !== 'failure' ||
        !['error', 'fatal'].includes(record.severity)
      ) {
        counts.ignored += 1;
        return null;
      }
      if (
        typeof record.correlationId !== 'string' ||
        typeof record.time !== 'string' ||
        !UUID.test(record.correlationId ?? '') ||
        !ERROR_CODES.has(record.errorCode) ||
        !INSTANT.test(record.time ?? '') ||
        !Number.isFinite(Date.parse(record.time))
      ) {
        counts.malformed += 1;
        return null;
      }
      // Stable identifiers only. No upstream text or object is copied into the queue.
      const key = [record.env, record.correlationId, record.operation, record.errorCode].join('|');
      if (seen.has(key)) {
        counts.duplicate += 1;
        return null;
      }
      if (seen.size >= MONITOR_LIMITS.alerts) throw new Error('Alert capacity exceeded.');
      seen.add(key);
      const routes = ['technical-reviewer'];
      // An export failure may affect disclosure auditing. Review it; do not assert an audit failure.
      if (
        record.operation === 'rpt.report-export' ||
        ['ERR-IAM-001', 'ERR-IAM-002', 'ERR-TEN-001'].includes(record.errorCode)
      ) {
        routes.push('security-reviewer');
      }
      counts.routed += 1;
      return {
        environment,
        time: record.time,
        correlationId: record.correlationId,
        operation: record.operation,
        errorCode: record.errorCode,
        routes,
      };
    },
  };
}

/** Exclusive output preserves earlier evidence. Nonzero exit means the queue is incomplete. */
export async function routeLogFile({ inputPath, outputPath, environment }) {
  const router = createAlertRouter(environment);
  const output = await open(outputPath, 'wx', 0o600);
  let bytes = 0;
  let pending = '';
  try {
    for await (const chunk of createReadStream(inputPath, {
      encoding: 'utf8',
      highWaterMark: 16 * 1024,
    })) {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > MONITOR_LIMITS.inputBytes) throw new Error('Input exceeds the bound.');
      pending += chunk;
      let index;
      while ((index = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, index).replace(/\r$/, '');
        pending = pending.slice(index + 1);
        if (!line.trim()) continue;
        const alert = router.accept(line);
        if (alert) await output.write(`${JSON.stringify(alert)}\n`);
      }
      if (Buffer.byteLength(pending, 'utf8') > MONITOR_LIMITS.lineBytes)
        throw new Error('Log line exceeds the bound.');
    }
    if (pending.trim()) {
      const alert = router.accept(pending);
      if (alert) await output.write(`${JSON.stringify(alert)}\n`);
    }
    await output.sync();
    return { complete: router.counts.malformed === 0, inputBytes: bytes, ...router.counts };
  } finally {
    await output.close();
  }
}

async function main(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (
      !['--input', '--output', '--environment'].includes(key) ||
      !args[index + 1] ||
      values[key]
    ) {
      throw new Error('Use --input PATH --output NEW_PATH --environment local|test.');
    }
    values[key] = args[index + 1];
  }
  if (Object.keys(values).length !== 3) throw new Error('Three explicit options are required.');
  const result = await routeLogFile({
    inputPath: values['--input'],
    outputPath: values['--output'],
    environment: values['--environment'],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.complete) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    // Exceptions may embed input paths. Keep the public failure bounded and free of input text.
    const reasons = new Set([
      'Explicit local or test environment required.',
      'Input exceeds the bound.',
      'Log line exceeds the bound.',
      'Alert capacity exceeded.',
      'Use --input PATH --output NEW_PATH --environment local|test.',
      'Three explicit options are required.',
    ]);
    const reason = reasons.has(error?.message)
      ? error.message
      : 'Input or output could not be accessed.';
    process.stderr.write(
      `${JSON.stringify({ complete: false, reason, partialOutput: 'not a completed run' })}\n`
    );
    process.exitCode = 1;
  });
}
