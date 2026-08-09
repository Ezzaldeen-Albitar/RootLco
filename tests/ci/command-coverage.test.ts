import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGGREGATE,
  REGISTER,
  TIERS,
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

describe('the tier vocabulary is closed', () => {
  /*
   * `evaluate()` does `if (entry.tier !== 'required') continue`, so ANY string
   * that is not one of the four defined tiers means "not a gate". An adversarial
   * review found one entry registered `optional` — a fifth word, defined
   * nowhere, silently exempt — and observed that `requird` would unenforce a
   * real gate the same way. Nothing read the tier vocabulary at all.
   */
  it('registers every command under one of the four defined tiers', () => {
    const stray = REGISTER.filter((entry) => !TIERS.includes(entry.tier)).map(
      (entry) => `${entry.owner}::${entry.name} -> "${entry.tier}"`
    );
    expect(stray, 'an unrecognised tier is silently "not a gate"').toEqual([]);
  });

  it('has a vocabulary the docblock actually defines', () => {
    // Both directions: a tier used but undocumented is the defect above; a tier
    // documented but unusable would be a rule nobody can follow.
    const source = readFileSync(
      join(process.cwd(), 'scripts', 'ci', 'check-command-coverage.mjs'),
      'utf8'
    );
    for (const tier of TIERS) {
      expect(source, `${tier} is in the vocabulary and not described`).toContain(`*   ${tier}`);
    }
    expect(TIERS).toContain('required');
    expect(TIERS.length, 'the vocabulary is empty or unbounded').toBe(4);
  });

  it('still classifies at least one command under each tier it defines', () => {
    // A tier nothing uses is a tier nobody maintains, and it would drift into
    // the "unrecognised" case without anyone noticing.
    for (const tier of TIERS) {
      expect(
        REGISTER.some((entry) => entry.tier === tier),
        `no command is registered as ${tier}`
      ).toBe(true);
    }
  });
});

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
      // Added by the P1-27 Owner-acceptance remediation. `bg-brand-primary` and
      // six other invented colour names resolved to no CSS at all across
      // fourteen components, and every automated tier stayed green.
      'validate:theme',
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

/**
 * `P1-26-F-043` — the root formatter cannot see a workspace, and is named as
 * though it can.
 *
 * `npm run format:check` at the root is `prettier --check .`, which reads as
 * "check the repository". It is not: `.prettierignore` excludes `apps/`
 * outright, because each workspace ships its own prettier configuration and two
 * formatters disagreeing over the same file is a permanent conflict, not a
 * style preference.
 *
 * The consequence is that a green root `format:check` says nothing whatsoever
 * about `apps/web`. Sixteen unformatted web files passed it and then failed
 * hosted CI twice — once in `Web quality`, once inside the clean room, which
 * runs the same command through `verify:workspaces`.
 *
 * The command graph was never wrong: `check-command-coverage.mjs` already
 * required `@rootlco/web::format:check` and CI duly ran it. What was missing was
 * anything stating that the root command is *not* a substitute for it. These
 * cases are that statement, and they fail the moment either half of the
 * arrangement moves.
 */
describe('formatter scope', () => {
  const REPO = join(__dirname, '..', '..');
  const scripts = readScripts();
  const script = (owner: string, name: string) => scripts.get(key(owner, name)) ?? '';

  const ignoreEntries = readFileSync(join(REPO, '.prettierignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  it('reads a real ignore file, so the exclusion below is not imagined', () => {
    expect(ignoreEntries.length).toBeGreaterThan(5);
    expect(ignoreEntries).toContain('node_modules');
  });

  it('excludes every workspace from the root formatter', () => {
    expect(ignoreEntries).toContain('apps/');
  });

  it('hides real source by doing so — the exclusion is material, not cosmetic', () => {
    // If `apps/web/src` were empty the assertion above would be technically true
    // and practically meaningless. It is not empty: this is a live blind spot
    // over the entire Frontend.
    const webSource = join(REPO, 'apps', 'web', 'src');
    expect(existsSync(webSource)).toBe(true);
    expect(readdirSync(webSource).length).toBeGreaterThan(3);
  });

  it('gives the root and the workspace the SAME command name for different scopes', () => {
    // The trap in one line. Both are `prettier --check .`; only the working
    // directory differs, and the working directory is what decides coverage.
    expect(script(ROOT, 'format:check')).toBe('prettier --check .');
    expect(script(WEB, 'format:check')).toBe('prettier --check .');
  });

  it('names an aggregate that covers all three scopes', () => {
    const all = script(ROOT, 'format:check:all');
    expect(all).toContain('npm run format:check');
    expect(all).toContain('npm run format:check:api');
    expect(all).toContain('npm run format:check:web');
  });

  it('keeps each workspace formatter inside that workspace verification', () => {
    // `verify:web` is what a local run must use. Dropping `format:check:web`
    // from it would restore the blind spot while leaving the graph green.
    expect(script(ROOT, 'verify:web')).toContain('npm run format:check:web');
    expect(script(ROOT, 'verify:api')).toContain('npm run format:check:api');
  });

  it('reaches every workspace formatter from the full-workspace aggregate', () => {
    const reached = reachableFrom(scripts, key(ROOT, 'verify:workspaces'));
    expect(reached.has(key(WEB, 'format:check'))).toBe(true);
    expect(reached.has(key('@rootlco/api', 'format:check'))).toBe(true);
  });
});
