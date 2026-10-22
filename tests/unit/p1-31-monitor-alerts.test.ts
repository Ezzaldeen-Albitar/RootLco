// The real capture boundary and the local routing/privacy controls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  createAlertRouter,
  MONITOR_LIMITS,
  routeLogFile,
} from '../../scripts/ops/p1-31-monitor-alerts.mjs';
import { captureException, __resetMonitorForTests } from '@/server/observability/monitoring';
import { __resetLoggerForTests } from '@/server/observability/logger';

const correlationId = '0f6a2f1e-5c2d-4a5b-8f2c-1a2b3c4d5e6f';
const record = {
  time: '2026-09-14T10:00:00.000Z',
  env: 'test',
  operation: 'rpt.report-export',
  severity: 'error',
  result: 'failure',
  errorCode: 'ERR-SYS-001',
  correlationId,
  context: { monitored: true },
};
const directories: string[] = [];
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'test');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  __resetLoggerForTests();
  __resetMonitorForTests();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('P1-31 local monitoring routing', () => {
  it('routes an actual recorded monitor fault without forwarding injected secrets or references', () => {
    const lines: string[] = [];
    __resetLoggerForTests({
      write: (line: string) => {
        lines.push(line);
      },
    });
    __resetMonitorForTests();
    const canary = 'p131-secret-canary-do-not-forward';
    captureException(new Error(canary), {
      correlationId,
      operation: 'rpt.report-export',
      module: 'reporting',
      errorCode: 'ERR-SYS-001',
      tenantRef: correlationId,
      actorRef: correlationId,
      context: { password: canary, body: canary, header: canary },
    });
    const router = createAlertRouter('test');
    const alerts = lines.map((line) => router.accept(line)).filter(Boolean);
    expect(alerts).toHaveLength(1);
    expect(Object.keys(alerts[0]!).sort()).toEqual([
      'correlationId',
      'environment',
      'errorCode',
      'operation',
      'routes',
      'time',
    ]);
    expect(alerts[0]!.routes).toEqual(['technical-reviewer', 'security-reviewer']);
    expect(JSON.stringify(alerts)).not.toContain(canary);
    expect(JSON.stringify(alerts)).not.toMatch(
      /tenantRef|actorRef|message|stack|header|password|context/
    );
    const rehearsalDirectory = process.env.ROOTLCO_P131_MONITOR_REHEARSAL_DIR;
    if (rehearsalDirectory) {
      const output = resolve(rehearsalDirectory);
      const rel = relative(process.cwd(), output);
      if (!(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
        throw new Error('Retained rehearsal evidence must be outside the checkout.');
      }
      mkdirSync(output);
      writeFileSync(join(output, 'captured.jsonl'), lines.join(''), { flag: 'wx' });
      writeFileSync(join(output, 'in-memory-alerts.json'), `${JSON.stringify(alerts, null, 2)}\n`, {
        flag: 'wx',
      });
    }
  });

  it('segregates environments and ignores expected denials and unrelated operations', () => {
    const router = createAlertRouter('test');
    for (const change of [
      { env: 'local' },
      { env: 'production' },
      { result: 'denied', severity: 'warn' },
      { result: 'success' },
      { operation: 'meta.ping' },
    ])
      expect(router.accept(JSON.stringify({ ...record, ...change }))).toBeNull();
    expect(router.counts).toMatchObject({ ignored: 5, routed: 0, malformed: 0 });
    expect(() => createAlertRouter('production')).toThrow();
  });

  it('refuses malformed structured identifiers and unregistered error codes', () => {
    const router = createAlertRouter('test');
    const inputs = [
      'not JSON',
      'null',
      '[]',
      ...[
        { correlationId: 'secret' },
        { correlationId: [correlationId] },
        { errorCode: 'ERR-SECRET-001' },
        { time: 'now' },
        { time: [record.time] },
      ].map((change) => JSON.stringify({ ...record, ...change })),
    ];
    for (const input of inputs) expect(router.accept(input)).toBeNull();
    expect(router.counts.malformed).toBe(inputs.length);
    expect(router.counts.routed).toBe(0);
  });

  it('deduplicates the same incident but keeps a different operation or correlation', () => {
    const router = createAlertRouter('test');
    expect(router.accept(JSON.stringify(record))).not.toBeNull();
    expect(router.accept(JSON.stringify({ ...record, msg: 'different detail' }))).toBeNull();
    expect(router.accept(JSON.stringify({ ...record, operation: 'rpt.report-run' }))).toMatchObject(
      { routes: ['technical-reviewer'] }
    );
    expect(
      router.accept(
        JSON.stringify({ ...record, correlationId: '1f6a2f1e-5c2d-4a5b-8f2c-1a2b3c4d5e6f' })
      )
    ).not.toBeNull();
    expect(router.counts).toMatchObject({ routed: 3, duplicate: 1 });
  });

  it('bounds a line before parsing and refuses an exhausted alert capacity', () => {
    const router = createAlertRouter('test');
    expect(() => router.accept('x'.repeat(MONITOR_LIMITS.lineBytes + 1))).toThrow(/bound/);
    for (let index = 0; index < MONITOR_LIMITS.alerts; index += 1) {
      router.accept(
        JSON.stringify({
          ...record,
          correlationId: `${index.toString(16).padStart(8, '0')}-5c2d-4a5b-8f2c-1a2b3c4d5e6f`,
        })
      );
    }
    expect(() => router.accept(JSON.stringify(record))).toThrow(/capacity/);
    expect(router.counts.routed).toBe(MONITOR_LIMITS.alerts);
  });

  it('writes an exclusive local queue and reports malformed input as incomplete', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'p131-monitor-'));
    directories.push(directory);
    const inputPath = join(directory, 'input.jsonl');
    const outputPath = join(directory, 'output.jsonl');
    await writeFile(inputPath, `${JSON.stringify(record)}\r\nmalformed\n${JSON.stringify(record)}`);
    const result = await routeLogFile({ inputPath, outputPath, environment: 'test' });
    expect(result).toMatchObject({
      complete: false,
      read: 3,
      routed: 1,
      duplicate: 1,
      malformed: 1,
    });
    const before = await readFile(outputPath, 'utf8');
    expect(before.trim().split('\n')).toHaveLength(1);
    await expect(routeLogFile({ inputPath, outputPath, environment: 'test' })).rejects.toThrow();
    expect(await readFile(outputPath, 'utf8')).toBe(before);
  });
});

it('refuses an oversized input file without treating its partial queue as complete', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p131-monitor-bound-'));
  directories.push(directory);
  const inputPath = join(directory, 'input.jsonl');
  const outputPath = join(directory, 'output.jsonl');
  const line = `${JSON.stringify({ ...record, env: 'production', msg: 'x'.repeat(1024) })}\n`;
  await writeFile(
    inputPath,
    line.repeat(Math.ceil(MONITOR_LIMITS.inputBytes / Buffer.byteLength(line)) + 1)
  );
  await expect(routeLogFile({ inputPath, outputPath, environment: 'test' })).rejects.toThrow(
    'Input exceeds the bound.'
  );
  expect(await readFile(outputPath, 'utf8')).toBe('');
});

it('reports CLI completion and refuses a bad environment without disclosing input paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p131-monitor-cli-'));
  directories.push(directory);
  const inputPath = join(directory, 'input.jsonl');
  const outputPath = join(directory, 'output.jsonl');
  await writeFile(inputPath, `${JSON.stringify(record)}\n`);
  const command = resolve('scripts/ops/p1-31-monitor-alerts.mjs');
  const args = [command, '--input', inputPath, '--output', outputPath, '--environment'];
  const done = spawnSync(process.execPath, [...args, 'test'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(done.status).toBe(0);
  expect(JSON.parse(done.stdout)).toMatchObject({ complete: true, routed: 1, malformed: 0 });
  const refused = spawnSync(process.execPath, [...args, 'production'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(refused.status).toBe(1);
  expect(JSON.parse(refused.stderr)).toMatchObject({
    complete: false,
    reason: 'Explicit local or test environment required.',
  });
  expect(refused.stderr).not.toContain(directory);
  expect((await readFile(outputPath, 'utf8')).trim().split('\n')).toHaveLength(1);
});
