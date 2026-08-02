import { describe, expect, it } from 'vitest';
import {
  AGGREGATE,
  REGISTER,
  edgesOf,
  evaluate,
  key,
  readScripts,
  readWorkflowInvocations,
  reachableFrom,
} from '../../scripts/ci/check-command-coverage.mjs';

/**
 * The gate that exists because three checks were correct and had never run.
 *
 * These cases prove the gate itself is not the fourth. Every one of them fails
 * a deliberately broken register or script graph, so a future edit that makes
 * the gate permissive is caught here rather than by a customer.
 */

const ROOT = 'root';
const WEB = '@rootlco/web';

describe('npm run edges', () => {
  it('follows a plain invocation', () => {
    expect(edgesOf('npm run lint', ROOT)).toEqual([key(ROOT, 'lint')]);
  });

  it('follows a chain', () => {
    expect(edgesOf('npm run a && npm run b', ROOT)).toEqual([key(ROOT, 'a'), key(ROOT, 'b')]);
  });

  it('sees through --silent, which CI uses', () => {
    expect(edgesOf('npm run --silent lint', ROOT)).toEqual([key(ROOT, 'lint')]);
  });

  it('retargets across a workspace boundary', () => {
    // The property that makes reachability cross from the root into apps/web.
    // Without it, every web command would look unreachable and the gate would
    // be permanently, uselessly red.
    expect(edgesOf('npm run build --workspace @rootlco/web', ROOT)).toEqual([key(WEB, 'build')]);
    expect(edgesOf('npm run build --workspace=@rootlco/web', ROOT)).toEqual([key(WEB, 'build')]);
  });

  it('ignores a shell word that merely contains "npm run"', () => {
    expect(edgesOf('echo "see npm run lint in the docs"', ROOT)).toEqual([key(ROOT, 'lint')]);
  });
});

describe('reachability', () => {
  const scripts = new Map([
    [key(ROOT, 'aggregate'), 'npm run a && npm run b'],
    [key(ROOT, 'a'), 'npm run c'],
    [key(ROOT, 'b'), 'node b.mjs'],
    [key(ROOT, 'c'), 'node c.mjs'],
    [key(ROOT, 'orphan'), 'node orphan.mjs'],
  ]);

  it('is transitive', () => {
    const reached = reachableFrom(scripts, key(ROOT, 'aggregate'));
    expect(reached.has(key(ROOT, 'c'))).toBe(true);
  });

  it('does not reach an orphan', () => {
    // The defect the whole gate exists for.
    const reached = reachableFrom(scripts, key(ROOT, 'aggregate'));
    expect(reached.has(key(ROOT, 'orphan'))).toBe(false);
  });

  it('terminates on a cycle', () => {
    const cyclic = new Map([
      [key(ROOT, 'x'), 'npm run y'],
      [key(ROOT, 'y'), 'npm run x'],
    ]);
    expect(reachableFrom(cyclic, key(ROOT, 'x')).size).toBe(2);
  });
});

describe('the verdict', () => {
  const base = {
    scripts: new Map([
      [key(ROOT, AGGREGATE), 'npm run gate'],
      [key(ROOT, 'gate'), 'node gate.mjs'],
    ]),
    workflowInvocations: new Set([key(ROOT, AGGREGATE)]),
    register: [
      { name: AGGREGATE, owner: ROOT, tier: 'required', why: 'aggregate' },
      { name: 'gate', owner: ROOT, tier: 'required', why: 'a gate' },
    ],
  };

  it('passes when every required command is reachable both ways', () => {
    expect(evaluate(base).failures).toEqual([]);
  });

  it('fails a required command no aggregate reaches', () => {
    const scripts = new Map(base.scripts);
    scripts.set(key(ROOT, 'orphan'), 'node orphan.mjs');
    const register = [
      ...base.register,
      { name: 'orphan', owner: ROOT, tier: 'required', why: 'x' },
    ];
    const { failures } = evaluate({ ...base, scripts, register });
    expect(failures.join('\n')).toMatch(/orphan is required but not reachable/);
  });

  it('fails a required command no workflow invokes', () => {
    const { failures } = evaluate({ ...base, workflowInvocations: new Set() });
    expect(failures.join('\n')).toMatch(/no hosted workflow invokes it/);
  });

  it('fails a script that nobody classified', () => {
    const scripts = new Map(base.scripts);
    scripts.set(key(ROOT, 'brand-new'), 'node new.mjs');
    const { failures } = evaluate({ ...base, scripts });
    expect(failures.join('\n')).toMatch(/brand-new is not in the register/);
  });

  it('fails a register entry whose script was deleted', () => {
    const register = [...base.register, { name: 'gone', owner: ROOT, tier: 'required', why: 'x' }];
    const { failures } = evaluate({ ...base, register });
    expect(failures.join('\n')).toMatch(/gone is registered but no such script exists/);
  });

  it('does not require an interactive command to run in CI', () => {
    const scripts = new Map(base.scripts);
    scripts.set(key(ROOT, 'dev'), 'next dev');
    const register = [
      ...base.register,
      { name: 'dev', owner: ROOT, tier: 'interactive', why: 'x' },
    ];
    expect(evaluate({ ...base, scripts, register }).failures).toEqual([]);
  });
});

describe('the live repository', () => {
  it('has no coverage gap', () => {
    const { failures } = evaluate({
      scripts: readScripts(),
      workflowInvocations: readWorkflowInvocations(),
    });
    expect(failures).toEqual([]);
  });

  it('classifies every web command as required, because none of them had ever run', () => {
    // P1-25-F-015. Downgrading any of these to informational would restore the
    // exact condition that let `lint:web` sit broken since the day it was added.
    const web = REGISTER.filter((entry) => entry.owner === WEB && entry.tier === 'required');
    expect(web.map((entry) => entry.name).sort()).toEqual([
      'build',
      'format:check',
      'lint',
      'style:check',
      'test',
      'test:e2e',
      'typecheck',
      'validate:boundary',
      'validate:brand',
      'validate:tokens',
    ]);
  });

  it('reaches every required command from the aggregate a developer actually runs', () => {
    const scripts = readScripts();
    const reached = reachableFrom(scripts, key(ROOT, AGGREGATE));
    const missing = REGISTER.filter(
      (entry) => entry.tier === 'required' && !reached.has(key(entry.owner, entry.name))
    );
    expect(missing.map((entry) => `${entry.owner}::${entry.name}`)).toEqual([]);
  });
});
