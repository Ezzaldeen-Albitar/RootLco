import { describe, expect, it } from 'vitest';
import {
  RULES,
  SESSION_COOKIE_AUTHORITY,
  evaluate,
  serverModuleViolations,
  stripComments,
} from '../../scripts/ci/check-p1-26-frontend.mjs';

/**
 * Mutation tests for the P1-26 frontend gate.
 *
 * A gate that has never failed is a gate nobody has proved works. Each block
 * below plants exactly one violation and asserts the gate catches THAT one, and
 * a clean fixture asserts it does not cry wolf.
 *
 * The two failure modes this file exists for, both bought with real defects
 * elsewhere in this repository:
 *
 *   - a rule that matches nothing and reports clean over an empty set (PR #161);
 *   - a scanner that reads comments and flags the documentation of a rule as a
 *     breach of it (found while writing this phase's own money rule).
 */

const clean = [
  {
    path: 'apps/web/src/features/administration/users/api.ts',
    source: `'use server';\nexport async function listUsers() { return []; }\n`,
  },
  {
    path: 'apps/web/src/features/authentication/actions/login.ts',
    source: `'use server';\nexport async function loginAction() { return null; }\n`,
  },
  {
    path: SESSION_COOKIE_AUTHORITY,
    source: `export const SESSION_COOKIE = 'rootlco.session';\n`,
  },
  {
    path: 'apps/web/src/lib/money.ts',
    source: `export function f(v: string) { return Number(v).toFixed(2); }\n`,
  },
  {
    path: 'apps/web/src/lib/use-persisted-flag.ts',
    source: `export function read() { return window.localStorage.getItem('k'); }\n`,
  },
  {
    path: 'apps/web/src/components/shell/AppShell.tsx',
    source: `export function AppShell() { return null; }\n`,
  },
];

const withFile = (path: string, source: string) => [...clean, { path, source }];

describe('the gate passes a clean tree', () => {
  it('reports no failure', () => {
    const { failures } = evaluate(clean);
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('counts the files it inspected, so a pass is not silence', () => {
    const { counts } = evaluate(clean);
    expect(counts.files).toBe(clean.length);
    expect(counts.serverModules).toBe(2);
  });
});

describe('anti-vacuity', () => {
  it('fails on an empty file set rather than reporting clean over nothing', () => {
    const { failures } = evaluate([]);
    expect(failures.join(' ')).toContain('no files were inspected');
  });

  it('fails a rule whose scope matches nothing', () => {
    // Every file outside `features/authentication/` — so the scoped
    // redirect rule inspects zero files and must say so.
    const withoutAuth = clean.filter(
      (file) => !file.path.startsWith('apps/web/src/features/authentication/')
    );
    const { failures } = evaluate(withoutAuth);
    expect(failures.join('\n')).toContain('auth-redirect-parameter: inspected 0 files');
  });

  it("fails when no 'use server' module exists at all", () => {
    const none = clean.filter((file) => !file.source.includes('use server'));
    const { failures } = evaluate(none);
    expect(failures.join('\n')).toContain("found no 'use server' module");
  });
});

describe('browser storage', () => {
  it('catches a session written to localStorage', () => {
    const { failures } = evaluate(
      withFile(
        'apps/web/src/features/authentication/actions/store.ts',
        `export function keep(t: string) { localStorage.setItem('t', t); }`
      )
    );
    expect(failures.join('\n')).toContain('browser-storage');
  });

  it('catches sessionStorage and IndexedDB too', () => {
    for (const api of ['sessionStorage.setItem("t", t)', 'indexedDB.open("t")']) {
      const { failures } = evaluate(
        withFile('apps/web/src/features/administration/x.ts', `export const f = () => ${api};`)
      );
      expect(failures.join('\n'), api).toContain('browser-storage');
    }
  });

  it('permits the one reviewed exception, and only that file', () => {
    const { failures } = evaluate(clean);
    expect(failures.join('\n')).not.toContain('browser-storage');
  });
});

describe('floating-point money', () => {
  it('catches parseFloat outside the money module', () => {
    const { failures } = evaluate(
      withFile(
        'apps/web/src/features/administration/access/actions.ts',
        `export const total = (v: string) => parseFloat(v) * 2;`
      )
    );
    expect(failures.join('\n')).toContain('float-money');
  });

  it('catches toFixed outside the money module', () => {
    const { failures } = evaluate(
      withFile('apps/web/src/features/x.ts', `export const show = (n: number) => n.toFixed(2);`)
    );
    expect(failures.join('\n')).toContain('float-money');
  });

  it('does not claim to catch Number(), which it deliberately does not', () => {
    // `Number()` is how a page size and a record version are read. A regex
    // cannot tell those from an amount, so the rule is narrower than the
    // temptation — and the header says so rather than promising more.
    const { failures } = evaluate(
      withFile('apps/web/src/features/x.ts', `export const n = Number('3');`)
    );
    expect(failures.join('\n')).not.toContain('float-money');
  });

  it('does NOT flag a comment explaining why parseFloat is not used', () => {
    // The exact false positive this gate's comment-stripping exists for. A
    // scanner that reads prose accuses the explanation of breaking the rule,
    // and the obvious "fix" is to delete the explanation.
    const { failures } = evaluate(
      withFile(
        'apps/web/src/features/administration/organization/types.ts',
        `// parseFloat('12abc') is 12, which is why it is never called.\nexport const x = 1;`
      )
    );
    expect(failures.join('\n')).not.toContain('float-money');
  });
});

describe('the authentication redirect rule', () => {
  it('catches a returnTo parameter in the authentication flow', () => {
    const { failures } = evaluate(
      withFile(
        'apps/web/src/features/authentication/actions/login.ts',
        `'use server';\nexport async function go(returnTo: string) { return returnTo; }`
      )
    );
    expect(failures.join('\n')).toContain('auth-redirect-parameter');
  });

  it('is scoped to authentication and does not police the whole tree', () => {
    // `redirectTo` is a legitimate word elsewhere; the rule is about the flow
    // that completes a credential change, not about a vocabulary ban.
    const { failures } = evaluate(
      withFile('apps/web/src/features/administration/x.ts', `export const redirectTo = 1;`)
    );
    expect(failures.join('\n')).not.toContain('auth-redirect-parameter');
  });
});

describe('the session-cookie authority', () => {
  it('catches the cookie name used outside its one file', () => {
    const { failures } = evaluate(
      withFile(
        'apps/web/src/features/authentication/actions/other.ts',
        `export const name = 'rootlco.session';`
      )
    );
    expect(failures.join('\n')).toContain('session-cookie-authority');
  });
});

describe('unsafe HTML', () => {
  it('catches dangerouslySetInnerHTML anywhere', () => {
    const { failures } = evaluate(
      withFile(
        'apps/web/src/components/x.tsx',
        `export const X = () => <div dangerouslySetInnerHTML={{}} />;`
      )
    );
    expect(failures.join('\n')).toContain('unsafe-html');
  });
});

describe("'use server' module exports", () => {
  it('catches an exported constant', () => {
    // The exact build failure this phase hit: Turbopack rejects the WHOLE module
    // and reports "the module has no exports at all", which sends the reader to
    // the importer rather than to the cause.
    expect(serverModuleViolations(`'use server';\nexport const DAYS = 7;`)).toEqual(['const DAYS']);
  });

  it('catches an exported sync function', () => {
    expect(
      serverModuleViolations(`'use server';\nexport function path(id: string) { return id; }`)
    ).toEqual(['sync function path']);
  });

  it('permits an async function', () => {
    expect(serverModuleViolations(`'use server';\nexport async function go() {}`)).toEqual([]);
  });

  it('permits a type or an interface, which are erased', () => {
    expect(
      serverModuleViolations(
        `'use server';\nexport type A = string;\nexport interface B { a: string }\nexport async function go() {}`
      )
    ).toEqual([]);
  });

  it('ignores a module that is not a server module', () => {
    expect(serverModuleViolations(`export const DAYS = 7;`)).toEqual([]);
  });

  it('is not fooled by the directive appearing inside a comment', () => {
    expect(
      serverModuleViolations(`// 'use server' is not declared here\nexport const A = 1;`)
    ).toEqual([]);
  });
});

describe('the comment stripper', () => {
  it('removes block and line comments', () => {
    expect(stripComments('a /* b */ c // d\ne')).not.toContain('b');
    expect(stripComments('a /* b */ c // d\ne')).not.toContain('d');
  });

  it('leaves code intact, so it is not a blindfold', () => {
    const stripped = stripComments('const x = parseFloat("1"); // note');
    expect(stripped).toContain('parseFloat');
  });
});

describe('the declared constants', () => {
  it('names the cookie authority', () => {
    expect(SESSION_COOKIE_AUTHORITY).toBe('apps/web/src/lib/api/session-cookie.ts');
  });

  it('exports no constant that no rule uses', () => {
    // A constant exported, documented as an enforced boundary and asserted by a
    // test, while no rule reads it, is scenery that reads as a control
    // (P1-26-F-037). Every rule's allow-list entry must be a real path.
    for (const rule of RULES) {
      for (const entry of rule.allow) {
        expect(typeof entry, rule.id).toBe('string');
        expect(entry.startsWith('apps/web/'), `${rule.id} → ${entry}`).toBe(true);
      }
    }
  });

  it('declares a rule set that is not empty', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(5);
    for (const rule of RULES) {
      expect(rule.id).toMatch(/^[a-z0-9-]+$/);
      expect(rule.what.length).toBeGreaterThan(10);
    }
  });
});
