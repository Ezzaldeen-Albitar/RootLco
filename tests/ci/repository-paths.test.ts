import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_APP_ROOT,
  API_ROOT,
  API_ROUTES_ROOT,
  API_SRC_ROOT,
  APPS_ROOT,
  DOCS_ROOT,
  REPOSITORY_ROOT,
  SCRIPTS_ROOT,
  SUPABASE_ROOT,
  TESTS_ROOT,
  WEB_ROOT,
  WEB_SRC_ROOT,
  fromRoot,
  toRepositoryPath,
} from '../../scripts/lib/repository-paths.mjs';

/**
 * The path authority is tested BEFORE the backend moves, because it is the
 * thing that makes the move safe.
 *
 * The first migration attempt produced `apps/api/apps/api/src/app/api` by
 * rewriting path literals across 21 scripts. These tests pin the property that
 * failure violated: a repository path is built from the root exactly once.
 */
describe('repository path authority', () => {
  it('derives the root from the module, not from the working directory', () => {
    // The decisive property. `process.cwd()` is a property of the caller; the
    // repository root is not. Three validators previously disagreed about this.
    expect(existsSync(resolve(REPOSITORY_ROOT, 'package.json'))).toBe(true);
    expect(existsSync(resolve(REPOSITORY_ROOT, 'supabase'))).toBe(true);
    expect(existsSync(resolve(REPOSITORY_ROOT, '.github'))).toBe(true);
  });

  it('resolves identically from the repository root, apps/api and apps/web', () => {
    // Executed as real subprocesses with different cwds. A unit-level assertion
    // could not catch a cwd dependency, because the test runner has one cwd.
    const probe =
      "import('file://' + process.argv[1].replace(/\\\\/g,'/')).then(m => " +
      'process.stdout.write(m.REPOSITORY_ROOT + "|" + m.API_ROUTES_ROOT))';
    const helper = resolve(REPOSITORY_ROOT, 'scripts/lib/repository-paths.mjs');

    const cwds = [
      REPOSITORY_ROOT,
      resolve(REPOSITORY_ROOT, 'scripts'),
      resolve(REPOSITORY_ROOT, 'tests'),
    ];
    const results = cwds.map((cwd) =>
      execFileSync(process.execPath, ['-e', probe, helper], { cwd, encoding: 'utf8' })
    );

    expect(new Set(results).size, 'the helper must not depend on cwd').toBe(1);
    expect(results[0]).toContain('apps');
  });

  it('never double-prefixes an application path', () => {
    // The exact defect that reverted the first attempt.
    for (const p of [
      API_ROOT,
      API_SRC_ROOT,
      API_APP_ROOT,
      API_ROUTES_ROOT,
      WEB_ROOT,
      WEB_SRC_ROOT,
    ]) {
      const posix = p.split(sep).join('/');
      expect(posix.match(/apps\/api/g)?.length ?? 0, `double-prefixed: ${posix}`).toBeLessThan(2);
      expect(posix.match(/apps\/web/g)?.length ?? 0, `double-prefixed: ${posix}`).toBeLessThan(2);
    }
  });

  it('builds each application path from the root exactly once', () => {
    expect(API_SRC_ROOT).toBe(fromRoot('apps', 'api', 'src'));
    expect(API_ROUTES_ROOT).toBe(fromRoot('apps', 'api', 'src', 'app', 'api'));
    expect(WEB_SRC_ROOT).toBe(fromRoot('apps', 'web', 'src'));
    expect(APPS_ROOT).toBe(fromRoot('apps'));
  });

  it('keeps repository-owned directories at the root, not inside an application', () => {
    // tests/, scripts/, supabase/ and docs/ are repository-owned. If any of
    // these ever resolves under apps/, the ownership split has been broken.
    for (const p of [TESTS_ROOT, SCRIPTS_ROOT, SUPABASE_ROOT, DOCS_ROOT]) {
      expect(p.split(sep).join('/')).not.toContain('/apps/');
    }
  });

  it('emits repository-relative POSIX paths for evidence', () => {
    // A generated artefact containing an absolute path becomes a permanent diff
    // between a developer machine and a CI runner.
    const rendered = toRepositoryPath(API_ROUTES_ROOT);
    expect(rendered).toBe('apps/api/src/app/api');
    expect(rendered).not.toContain('\\');
    expect(rendered.startsWith('/')).toBe(false);
    expect(toRepositoryPath(SUPABASE_ROOT)).toBe('supabase');
  });
});

/**
 * The post-move shape.
 *
 * These are the assertions a transitional root-`src` fallback could not satisfy,
 * which is why the validator normalization, the API package, the move and the
 * resolver repairs had to land as one commit rather than four.
 */
describe('the API application lives in the workspace', () => {
  it('has its source, routes and package where the authority says', () => {
    expect(existsSync(API_ROUTES_ROOT)).toBe(true);
    expect(existsSync(resolve(API_ROOT, 'package.json'))).toBe(true);
    expect(existsSync(resolve(API_ROOT, 'next.config.ts'))).toBe(true);
    expect(existsSync(resolve(API_ROOT, 'tsconfig.json'))).toBe(true);
    expect(existsSync(resolve(API_ROOT, 'eslint.config.mjs'))).toBe(true);
  });

  it('left nothing behind at the repository root', () => {
    // A leftover copy is worse than a failed move: both trees would compile, and
    // the stale one would drift silently until something imported it.
    expect(existsSync(fromRoot('src')), 'root src/ still exists').toBe(false);
    expect(existsSync(fromRoot('public')), 'root public/ still exists').toBe(false);
    expect(existsSync(fromRoot('next.config.ts')), 'root next.config.ts still exists').toBe(false);
    expect(existsSync(fromRoot('web')), 'root web/ still exists').toBe(false);
  });

  it('carries exactly one lockfile, at the root', () => {
    expect(existsSync(fromRoot('package-lock.json'))).toBe(true);
    expect(existsSync(resolve(API_ROOT, 'package-lock.json'))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, 'package-lock.json'))).toBe(false);
  });

  it('discovers the whole route surface, and would notice one missing', () => {
    const routeFiles = walkRoutes(API_ROUTES_ROOT);
    // 199 after the three read-contract remediations. They added three route
    // MODULES that never existed — `customers/[customerId]`,
    // `customer-duplicates` and `vehicle-duplicates` — while every other read
    // they added was a GET on a route file that was already here. 204 through
    // the P1-27 vehicle-catalogue remediation. The apt/rec read-surface
    // remediation takes it to 216: twelve new route MODULES —
    // `appointments/[appointmentId]`, `receptions/[receptionId]`,
    // `receptions/[receptionId]/history`, the seven intake-catalogue reads,
    // and the two closure commands (`close-without-work`, `refuse`) — while the
    // five other reads it added are GETs on route files that were already here.
    // 230 through the intake-catalogue MANAGEMENT remediation (P1-27-INT-018):
    // fourteen new route modules, an id-addressed rename and a `/status`
    // lifecycle module for each of the seven catalogues. The seven creates move
    // this number not at all — each is a POST added to the catalogue's existing
    // collection route file, which the read remediation already counted.
    //
    // 237 with the seven ADMINISTRATIVE reads under `.../management/<catalogue>`.
    // They are their own modules rather than a query flag on the picker lists
    // because they answer to a different permission: the picker filters to
    // active entries for `apt.appointment.read` / `rec.reception.read`, and the
    // administrative read shows retired entries and their `recordVersion` to
    // `apt.catalogue.manage` / `rec.catalogue.manage`.
    //
    // 240 = 237 + three route MODULES that arrived on two branches and met here.
    //
    // FE-007 adds the receiving-employee picker
    // (`reception-catalogue/receiving-employees`), a module of its own because
    // it reads `iam.user_accounts` rather than a `rec` catalogue table and
    // therefore shares neither collection route file nor lifecycle with the
    // seven catalogues beside it.
    //
    // P1-OD-025 adds two evidence reads: `attachments/categories` publishes the
    // governed category policy a client must obey, and
    // `attachments/versions/{versionId}` publishes one immutable version and
    // its scan lifecycle. Neither path had a file.
    // 249 with the nine P1-18 evidence-contract modules: the evidence-binding trio,
    // the capture override, the signature event and list, and the capture-policy
    // and damage-map-template catalogues.
    //
    // 257 with the eight PRE-P1-29-BR-03 technician roster modules: the roster
    // collection, the profile, the held skill, the certification collection, the
    // held certification and its restricted detail sidecar, and the availability
    // collection and window.
    //
    // 258 with PRE-P1-29-BR-01's `technicians/me/queue`: one module, one
    // operation — the two counts move together here because the route publishes a
    // single verb, unlike the BR-03 modules above it.
    //
    // 270 with the six PRE-P1-29-BR-04 inspection-template modules:
    // `inspection-templates`, `inspection-templates/[templateId]`,
    // `inspection-templates/[templateId]/versions`,
    // `template-versions/[versionId]/items`,
    // `template-versions/[versionId]/status` and
    // `jobs/[jobId]/inspection-templates`.
    //
    // Six modules carry EIGHT operations, because the collection and the
    // id-addressed template each co-locate two verbs on one path — the same
    // reason BR-03's eight modules carried eleven, and the whole reason both
    // this number and the operation count below are asserted rather than one.
    //
    // This is deliberately NOT the path count that `validate:authorization-coverage`
    // and the OpenAPI document report. Those count PATHS; this walk counts every
    // `route.ts` under the API root, and the two differ by one — measured at 258
    // files against 257 paths before this slice, and 270 against 263 after, so
    // the gap is pre-existing and unchanged. Reconciling them by editing
    // whichever number looked wrong is how a real gap would get hidden.
    //
    // 293 with P1-30 A2's SIX new route modules: `price-lists/[priceListId]`,
    // `quotation-revisions/[revisionId]`, `stock-locations`,
    // `work-orders/[workOrderId]/invoice`, `work-orders/[workOrderId]/part-issues`
    // and `work-orders/[workOrderId]/quotations`.
    //
    // Six FILES for TWELVE operations, and the gap is the point of asserting both:
    // the other six A2 reads were added to route modules that already existed
    // (`services/[serviceId]`, `quotations/[quotationId]/revisions`,
    // `quotation-revisions/[revisionId]/decisions`, `stock-reservations`,
    // `payments`, and the price-rule collection), so a slice that published a read
    // by creating a redundant second module for a path would move this count and
    // not the other.
    expect(routeFiles.length).toBe(293);

    // Non-vacuity. A discovery assertion that only checks a count would pass
    // against a set with one route swapped for another, so the comparison that
    // the validators actually make — set equality — is exercised here too.
    const discovered = new Set(routeFiles);
    const missingOne = new Set(routeFiles.slice(1));
    expect(discovered.size).toBe(routeFiles.length);
    expect(missingOne.size).toBe(routeFiles.length - 1);
    expect([...discovered].every((f) => missingOne.has(f))).toBe(false);

    // Every discovered path is repository-relative POSIX under the API app —
    // never absolute, never Windows-separated, never double-prefixed.
    for (const file of routeFiles) {
      expect(file.startsWith('apps/api/src/app/api/'), file).toBe(true);
      expect(file).not.toContain('\\');
      expect(file).not.toContain('apps/api/apps/api');
      expect(/^[a-zA-Z]:/.test(file), `absolute path leaked: ${file}`).toBe(false);
    }
  });

  it('discovers the same 368 operations from the root, apps/api and apps/web', () => {
    // The decisive cwd proof, run against a REAL validator rather than the
    // helper alone: `check-authorization-coverage.mjs` derived the repository
    // from `process.cwd()` until this migration, so its answer used to depend on
    // where it was launched. Three real processes, because a unit assertion
    // cannot catch a cwd dependency — the runner has one cwd.
    const validator = resolve(REPOSITORY_ROOT, 'scripts/check-authorization-coverage.mjs');
    const results = [REPOSITORY_ROOT, API_ROOT, WEB_ROOT].map((cwd) =>
      execFileSync(process.execPath, [validator, '--json'], { cwd, encoding: 'utf8' })
    );

    expect(new Set(results).size, 'discovery must not depend on cwd').toBe(1);
    const report = JSON.parse(results[0] ?? '{}');
    // 261: the P1-16 customer-vehicle read (`crm.customer-vehicle-list`,
    // P1-27-INT-012) is a GET on the existing vehicles route module, so the
    // route-module count above does not move while the operation count does.
    // 282 through the intake-catalogue management remediation: 21 operations
    // over 14 new modules, because the seven creates are POSTs co-located with
    // the seven collection GETs. Operations and route modules move by different
    // amounts for that reason, which is exactly why both are asserted.
    // 289 with the seven administrative reads, which move both counts by seven
    // — one operation per new module. 292 with the FE-007 receiving-employee
    // picker (one) and the two P1-OD-025 evidence reads (two), each of which
    // moves both counts by one per new module, for the same reason.
    // 305: the same nine modules publish thirteen operations, because the catalogue
    // modules co-locate a read and a write on one path.
    // 316 with BR-03: eleven operations over eight modules, because the roster
    // collection, the profile and the held skill each co-locate two verbs on one
    // path — eight and eleven again moving by different amounts, which is the
    // whole reason both numbers are asserted rather than one.
    // 317 with BR-01: one operation over one module.
    // 325 with BR-04: eight operations over six modules — the inspection-template
    // collection and the id-addressed template each co-locate two verbs on one
    // path, so the module count moves by six while this one moves by eight.
    expect(report.operations).toHaveLength(368);

    // Three node processes, each loading the whole route surface, so the cost
    // grows with the surface. The budget was 30 s and began timing out inside the
    // full tier as PRE-P1-29 took the registry past 300 operations — a timeout,
    // not an assertion failure, and green on the hosted Linux runner throughout.
    // Raised to 120 s and still stated HERE rather than in `vitest.config.ts`, so
    // it cannot quietly cover a different test that has genuinely regressed.
  }, 120_000);

  it('refuses to answer for a tree that is not there', () => {
    // A path helper that silently returns a directory which does not exist is
    // worse than no helper: every downstream check then reports "0 files found",
    // which reads exactly like a clean result.
    //
    // Proven against a throwaway tree rather than by mutating this repository,
    // so the test cannot leave damage behind if it fails midway.
    const sandbox = mkdtempSync(join(tmpdir(), 'rootlco-layout-'));
    try {
      mkdirSync(join(sandbox, 'scripts', 'lib'), { recursive: true });
      mkdirSync(join(sandbox, 'apps', 'web', 'src'), { recursive: true });
      copyFileSync(
        resolve(REPOSITORY_ROOT, 'scripts/lib/repository-paths.mjs'),
        join(sandbox, 'scripts', 'lib', 'repository-paths.mjs')
      );

      const probe = [
        "const m = await import('file://' + process.argv[1].replace(/\\\\/g,'/'));",
        'try { m.assertLayout(); process.stdout.write("NO THROW"); }',
        'catch (e) { process.stdout.write(e.message); }',
      ].join('');

      const output = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          probe,
          join(sandbox, 'scripts', 'lib', 'repository-paths.mjs'),
        ],
        { cwd: sandbox, encoding: 'utf8' }
      );

      expect(output).not.toBe('NO THROW');
      expect(output).toContain('apps/api/src/app/api');
      expect(output).toContain('repository-paths.mjs');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

/** Every `route.ts` under the API tree, as a repository-relative POSIX path. */
function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkRoutes(full, out);
    else if (entry.name === 'route.ts') out.push(toRepositoryPath(full));
  }
  return out;
}
