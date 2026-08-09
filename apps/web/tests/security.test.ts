import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectSourceOrigin, contentSecurityPolicy } from '@/lib/security/csp';
import { FORBIDDEN_URL_KEYS, toSearchParams } from '@/components/data-table/table-state';
import { NO_CAPABILITIES, hasPermission } from '@/lib/permissions';

/**
 * The frontend security baseline, asserted rather than described.
 *
 * Each case here corresponds to a rule that is easy to state, easy to agree
 * with, and easy to break in a single line six months from now.
 */

describe('content security policy', () => {
  // Built with a nonce, exactly as middleware does per request.
  const policy = contentSecurityPolicy({
    nonce: 'testnonce',
    apiOrigin: 'https://api.example.test',
  });

  it('scopes the dev-only eval concession so production can never receive it', () => {
    // React dev tooling needs eval(); the dev flag exists for that one purpose.
    // The DEFAULT policy (what production serves) must never carry it, and the
    // flag must be the only way in.
    const dev = contentSecurityPolicy({ nonce: 'n', dev: true });
    expect(dev).toContain("'unsafe-eval'");
    const prod = contentSecurityPolicy({ nonce: 'n', dev: false });
    expect(prod).not.toContain('unsafe-eval');
  });

  it("never permits 'unsafe-eval'", () => {
    // The single difference between a CSP that stops an injected script and one
    // that does not.
    expect(policy).not.toContain('unsafe-eval');
  });

  it("never permits 'unsafe-inline' for scripts", () => {
    const scriptSrc = policy.split('; ').find((directive) => directive.startsWith('script-src'));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain('unsafe-inline');
  });

  it("permits 'unsafe-inline' for styles ONLY, which Next requires", () => {
    const styleSrc = policy.split('; ').find((directive) => directive.startsWith('style-src'));
    expect(styleSrc).toContain("'unsafe-inline'");
    // A style injection cannot execute; a script injection can. The concession
    // must not spread.
    const inlineDirectives = policy
      .split('; ')
      .filter((directive) => directive.includes("'unsafe-inline'"));
    expect(inlineDirectives).toHaveLength(1);
  });

  it('uses no wildcard source', () => {
    // A wildcard connect-src lets an injected script exfiltrate anywhere.
    expect(policy).not.toMatch(/(^|\s)\*($|\s|;)/);
    // A BARE scheme source — `https:` on its own — permits every host on that
    // scheme and is a wildcard in all but spelling. A concrete origin such as
    // `https://api.example.test` is exactly what we want, so the assertion has
    // to distinguish the two rather than reject the substring.
    expect(policy).not.toMatch(/(^|\s)https?:($|\s|;)/);
  });

  it('forbids framing and object embedding outright', () => {
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
  });

  it('restricts connect-src to self plus the configured API origin', () => {
    const withApi = contentSecurityPolicy({ apiOrigin: 'https://api.example.test' });
    const connect = withApi.split('; ').find((directive) => directive.startsWith('connect-src'));
    expect(connect).toContain("'self'");
    expect(connect).not.toContain('*');
  });
});

/**
 * `P1-27-DO-002` — the sink a deployment configures is a sink the policy admits.
 *
 * ## The defect these cases exist for
 *
 * The monitoring adapter delivers with `navigator.sendBeacon`, which the browser
 * governs by `connect-src`. The policy named `'self'` and the API origin and had
 * no parameter for anything else, while TWO docblocks — `lib/env.ts` where the
 * variable is declared and `lib/observability/client-log.ts` where it is read —
 * told a deployment to allow the sink origin in the `connect-src` of
 * `src/proxy.ts`. That file contains no directive and could not be given one. So
 * the documented way to switch the feature on did not work, and the instruction
 * pointed at a file where the change could not be made.
 *
 * ## Why the last block is written against the SOURCE
 *
 * A behavioural case proves the CSP admits a sink; it cannot prove the two
 * docblocks still say so. Prose and code drifted apart here once already, and
 * the drift is what made a working adapter unusable. So the instruction is bound
 * to the code: the module the docblocks name is DERIVED from the source (the one
 * file that emits the directive) rather than written down here, and the wiring
 * each docblock claims — same variable, read in the proxy, passed to the builder
 * — is asserted file by file. Reverting either half of the fix fails a case.
 */

const WEB_SRC = join(__dirname, '..', 'src');

/** The variable the whole switch turns on. Asserted to be one name, everywhere. */
const SINK_VAR = 'NEXT_PUBLIC_CLIENT_MONITORING_URL';

const API_ORIGIN = 'https://api.example.test';
const SINK_URL = 'https://sink.example.test/events';
const SINK_ORIGIN = 'https://sink.example.test';

function readSource(...segments: string[]): string {
  return readFileSync(join(WEB_SRC, ...segments), 'utf8');
}

function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSource(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function directiveOf(policy: string, name: string): string {
  const found = policy.split('; ').find((part) => part.startsWith(`${name} `));
  expect(found, `${name} is missing from the policy`).toBeDefined();
  return found as string;
}

/** The policy exactly as it was before a sink could be configured. */
const noSinkPolicy = contentSecurityPolicy({ nonce: 'testnonce', apiOrigin: API_ORIGIN });

describe('a configured diagnostics sink is admitted by connect-src', () => {
  const policy = contentSecurityPolicy({
    nonce: 'testnonce',
    apiOrigin: API_ORIGIN,
    monitoringUrl: SINK_URL,
  });

  it('names the sink origin as a source', () => {
    expect(directiveOf(policy, 'connect-src')).toContain(SINK_ORIGIN);
  });

  it('emits the ORIGIN only, never the path', () => {
    // `https://sink.example.test/events` as a source expression matches nothing;
    // a source is scheme, host and port.
    expect(policy).not.toContain('/events');
    expect(directiveOf(policy, 'connect-src')).toBe(
      `connect-src 'self' ${API_ORIGIN} ${SINK_ORIGIN}`
    );
  });

  it('widens connect-src and nothing else', () => {
    const before = noSinkPolicy.split('; ');
    const changed = policy.split('; ').filter((part, index) => part !== before[index]);
    expect(changed).toEqual([`connect-src 'self' ${API_ORIGIN} ${SINK_ORIGIN}`]);
  });

  it('names an origin once when the sink IS the API', () => {
    const same = contentSecurityPolicy({
      nonce: 'testnonce',
      apiOrigin: API_ORIGIN,
      monitoringUrl: `${API_ORIGIN}/diagnostics`,
    });
    expect(same).toBe(noSinkPolicy);
  });

  it('still admits the sink when no API origin is configured', () => {
    const withoutApi = contentSecurityPolicy({ nonce: 'n', monitoringUrl: SINK_URL });
    expect(directiveOf(withoutApi, 'connect-src')).toBe(`connect-src 'self' ${SINK_ORIGIN}`);
  });
});

describe('an unconfigured sink changes the header not at all', () => {
  it('is byte identical when the variable is unset', () => {
    // Byte identical, not "contains": a policy that grew a trailing space or an
    // empty source when nobody configured anything is a changed header.
    expect(contentSecurityPolicy({ nonce: 'testnonce', apiOrigin: API_ORIGIN })).toBe(noSinkPolicy);
    expect(
      contentSecurityPolicy({ nonce: 'testnonce', apiOrigin: API_ORIGIN, monitoringUrl: undefined })
    ).toBe(noSinkPolicy);
    expect(directiveOf(noSinkPolicy, 'connect-src')).toBe(`connect-src 'self' ${API_ORIGIN}`);
  });

  it('is byte identical for every value that is not an http(s) URL', () => {
    // Fails closed. A value that reached the header unchecked would let a
    // mis-set variable widen the policy — and `javascript:` and `data:` have an
    // origin of the literal string "null", which must never be pasted in.
    for (const value of [
      '',
      '   ',
      'sink.example.test',
      '/events',
      'javascript:alert(1)',
      'data:text/plain,x',
      'ftp://sink.example.test',
      'not a url at all',
    ]) {
      const built = contentSecurityPolicy({
        nonce: 'testnonce',
        apiOrigin: API_ORIGIN,
        monitoringUrl: value,
      });
      expect(built, `"${value}" changed the header`).toBe(noSinkPolicy);
      expect(built).not.toContain('null');
    }
  });

  it('resolves the origin of a valid URL and rejects the rest', () => {
    expect(connectSourceOrigin(SINK_URL)).toBe(SINK_ORIGIN);
    expect(connectSourceOrigin('http://localhost:9000/ingest?x=1')).toBe('http://localhost:9000');
    expect(connectSourceOrigin(undefined)).toBeNull();
    expect(connectSourceOrigin('javascript:alert(1)')).toBeNull();
  });

  it('leaves every other directive alone in both states', () => {
    const withSink = contentSecurityPolicy({
      nonce: 'testnonce',
      apiOrigin: API_ORIGIN,
      monitoringUrl: SINK_URL,
    });
    for (const built of [noSinkPolicy, withSink]) {
      expect(built).not.toContain('unsafe-eval');
      expect(built).toContain("frame-ancestors 'none'");
      expect(built).not.toMatch(/(^|\s)\*($|\s|;)/);
      expect(built).not.toMatch(/(^|\s)https?:($|\s|;)/);
    }
  });
});

describe('the sink instruction is bound to the code, not to prose', () => {
  /**
   * The docblock immediately above a declaration, extracted from source.
   *
   * Anchored on the declaration rather than on a heading, so renaming a heading
   * does not silently exempt a file from these assertions.
   */
  function docblockAbove(source: string, declaration: string): string {
    const at = source.indexOf(declaration);
    expect(at, `${declaration} not found`).toBeGreaterThan(-1);
    const before = source.slice(0, at);
    const opened = before.lastIndexOf('/**');
    const closed = before.lastIndexOf('*/');
    expect(opened, `no docblock above ${declaration}`).toBeGreaterThan(-1);
    expect(closed).toBeGreaterThan(opened);
    return before.slice(opened, closed + 2);
  }

  /** The ONE module that emits the directive, found rather than assumed. */
  const builders = walkSource(WEB_SRC).filter((file) =>
    /`connect-src \$\{/.test(readFileSync(file, 'utf8'))
  );

  const envDoc = docblockAbove(readSource('lib', 'env.ts'), `${SINK_VAR}: z.`);
  const logDoc = docblockAbove(
    readSource('lib', 'observability', 'client-log.ts'),
    'export function installConfiguredMonitoringAdapter'
  );

  it('assembles connect-src in exactly one module', () => {
    expect(builders).toHaveLength(1);
  });

  it('finds that module where both docblocks say it is', () => {
    const builderPath = relative(join(WEB_SRC, '..'), builders[0] ?? '').replace(/\\/g, '/');
    expect(builderPath).toBe('src/lib/security/csp.ts');
    expect(envDoc).toContain(builderPath);
    expect(logDoc).toContain(builderPath);
  });

  it('no longer sends the reader to a file that holds no directive', () => {
    // The false instruction, in the two forms it was written in. `src/proxy.ts`
    // may still be named — it reads the variable — but not as the place a
    // directive is edited.
    for (const [name, doc] of [
      ['env.ts', envDoc],
      ['client-log.ts', logDoc],
    ] as const) {
      expect(doc, name).not.toMatch(/`connect-src`\s+in\s+`src\/proxy\.ts`/);
      expect(doc, name).not.toMatch(/connect-src[^.]{0,80}must (also )?appear in[^.]{0,40}proxy/i);
    }
    // And the claim is true of the file: its CODE sets no directive of its own,
    // so there was never a line in it to edit. Comments are stripped first —
    // `proxy.ts` explains the history in prose, which is not a directive.
    const proxyCode = readSource('proxy.ts')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(proxyCode).not.toContain('connect-src');
  });

  it('wires the one variable the docblocks name through every file that claims it', () => {
    // Declared in the schema, read by the proxy, passed to the builder, and read
    // by the adapter. Backing out any leg of that leaves a docblock describing a
    // switch that is no longer connected.
    expect(readSource('lib', 'env.ts')).toContain(`${SINK_VAR}: z.`);
    const proxy = readSource('proxy.ts');
    expect(proxy).toContain(`process.env.${SINK_VAR}`);
    expect(proxy).toMatch(/monitoringUrl:\s*process\.env\./);
    expect(readSource('lib', 'security', 'csp.ts')).toContain('monitoringUrl');
    expect(readSource('lib', 'observability', 'client-log.ts')).toContain(`env.${SINK_VAR}`);
  });

  it('states that the switch is taken at BUILD time, where the variable is declared', () => {
    // `NEXT_PUBLIC_*` is inlined by Next during `next build`, so setting this on
    // a running deployment does nothing. Neither docblock said so.
    expect(envDoc).toMatch(/BUILD[- ]time|build time/);
    expect(envDoc).toContain('next build');
    expect(logDoc).toMatch(/BUILD time|build time/);
  });
});

describe('client authorisation is usability only', () => {
  it('denies when the capability set is unknown', () => {
    // The failure mode of a permissive default is that a demo looks fine and
    // production leaks a menu.
    for (const capabilities of [null, undefined, NO_CAPABILITIES]) {
      expect(hasPermission(capabilities, 'iam.user.read')).toBe(false);
    }
  });

  it('has no role shortcut anywhere in the permission module', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'lib', 'permissions.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
    for (const shortcut of ['isAdmin', 'isOwner', 'role ===', 'superuser', 'bypass']) {
      expect(code, `${shortcut} must not appear`).not.toContain(shortcut);
    }
  });

  it('reads no tenant, company or branch identity from client state', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'lib', 'permissions.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/tenantId|companyId|branchId/);
  });
});

describe('nothing sensitive reaches a URL', () => {
  it('refuses every sensitive key name', () => {
    for (const key of ['search', 'phone', 'email', 'vin', 'plate', 'amount', 'sessionId']) {
      expect(FORBIDDEN_URL_KEYS).toContain(key.toLowerCase().replace(/[^a-z]/g, ''));
    }
  });

  it('produces an empty query for a request carrying only a search term', () => {
    const request = {
      page: 1,
      pageSize: 25,
      sort: null,
      filters: [],
      search: 'Layla Haddad 0791234567',
    };
    expect(toSearchParams(request, []).toString()).toBe('');
  });
});

describe('nothing sensitive reaches browser storage', () => {
  const SRC = join(__dirname, '..', 'src');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const files = walk(SRC);

  it('finds source to inspect, so this is not vacuous', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('touches localStorage in exactly one reviewed module', () => {
    // Every persisted value must go through `usePersistedFlag`, which documents
    // what may be stored: interface preferences, nothing that names a customer,
    // a tenant, a record or a permission.
    const writers = files.filter((file) => {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|\s)\/\/.*$/gm, '$1');
      return /localStorage|sessionStorage|indexedDB/.test(code);
    });
    expect(writers.map((file) => file.replace(SRC, '').replace(/\\/g, '/'))).toEqual([
      '/lib/use-persisted-flag.ts',
    ]);
  });

  it('stores only a boolean under a namespaced key', () => {
    const shell = readFileSync(join(SRC, 'components', 'shell', 'AppShell.tsx'), 'utf8');
    expect(shell).toContain("const COLLAPSE_KEY = 'rootlco.shell.sidebarCollapsed'");
  });
});

describe('no unsafe HTML anywhere in the application', () => {
  it('never uses dangerouslySetInnerHTML', () => {
    // There is no reviewed sanitiser in P1-25 and no approved use case, so the
    // answer is zero rather than "carefully".
    const roots = [join(__dirname, '..', 'src')];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const code = readFileSync(full, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|\s)\/\/.*$/gm, '$1');
          if (code.includes('dangerouslySetInnerHTML')) offenders.push(full);
        }
      }
    };
    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('the client bundle carries no server secret', () => {
  it('references no server-only environment variable in source', () => {
    const roots = [join(__dirname, '..', 'src')];
    const forbidden = [
      'SERVICE_ROLE',
      'SUPABASE_SERVICE',
      'DB_PASSWORD',
      'JWT_SECRET',
      'SECRET_KEY',
      'PRIVATE_KEY',
    ];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const code = readFileSync(full, 'utf8');
          for (const name of forbidden) if (code.includes(name)) offenders.push(`${full}: ${name}`);
        }
      }
    };
    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
  });
});
