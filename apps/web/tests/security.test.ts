import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../next.config';
import { FORBIDDEN_URL_KEYS, toSearchParams } from '@/components/data-table/table-state';
import { NO_CAPABILITIES, hasPermission } from '@/lib/permissions';

/**
 * The frontend security baseline, asserted rather than described.
 *
 * Each case here corresponds to a rule that is easy to state, easy to agree
 * with, and easy to break in a single line six months from now.
 */

describe('content security policy', () => {
  const policy = contentSecurityPolicy();

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
    expect(policy).not.toContain('https:');
    expect(policy).not.toContain('http:');
  });

  it('forbids framing and object embedding outright', () => {
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
  });

  it('restricts connect-src to self plus the configured API origin', () => {
    const withApi = contentSecurityPolicy();
    const connect = withApi.split('; ').find((directive) => directive.startsWith('connect-src'));
    expect(connect).toContain("'self'");
    expect(connect).not.toContain('*');
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
    for (const shortcut of ['isAdmin', 'isOwner', "role ===", 'superuser', 'bypass']) {
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
    const shell = readFileSync(
      join(SRC, 'components', 'shell', 'AppShell.tsx'),
      'utf8'
    );
    expect(shell).toContain("const COLLAPSE_KEY = 'rootlco.shell.sidebarCollapsed'");
  });
});

describe('no unsafe HTML anywhere in the application', () => {
  it('never uses dangerouslySetInnerHTML', () => {
    // There is no reviewed sanitiser in P1-25 and no approved use case, so the
    // answer is zero rather than "carefully".
    const roots = [join(__dirname, '..', 'src'), join(__dirname, '..', 'app')];
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
    const roots = [join(__dirname, '..', 'src'), join(__dirname, '..', 'app')];
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
