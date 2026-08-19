#!/usr/bin/env node
/**
 * P1-27 CRM and Vehicle Frontend quality gate — `P1-27-DO-001`.
 *
 * P1-26's gate covers what any Frontend must not do. This covers what **this
 * phase decided**, and every rule below encodes a decision that a test can be
 * deleted around but a gate cannot:
 *
 *   1. **No merge caller.** `P1-OD-017` — duplicate and merge rules — is an open
 *      Owner decision. Wave 6 shipped a working merge form anyway, and it passed
 *      review, typecheck, lint and 669 tests. The canonical plan requires the
 *      affordance to be *absent*, not disabled: a disabled button asserts the
 *      capability exists and this operator lacks permission, which is a
 *      different and false statement.
 *   2. **No duplicate-scan caller anywhere in these trees.** `crm.duplicate-scan`
 *      and `veh.vehicle-duplicate-scan` read like queries and are privileged
 *      audited **writes** — they create candidate rows, emit audit records and
 *      are throttled at 30/min. Neither has a call site in this phase: the
 *      creation-time duplicate warning arrives on the create RESPONSE as
 *      `possibleDuplicates`, and no scan is involved. A queue that "refreshed"
 *      by scanning would write audit history every time somebody looked at it.
 *      This header used to say the creation form calls the CRM one once, which
 *      was the justification for an allow-list entry the rule below records as
 *      never having been true.
 *   3. **No client-asserted scope.** Tenant, company and branch are resolved
 *      server-side from the session on every operation this platform publishes.
 *      ASSERTING a scope and DISPLAYING one are different acts, and the rule
 *      means only the first — see `assertedScopes()` below.
 *   4. **No invented total.** Every list operation returns
 *      `{ items, nextCursor, hasMore }` and no count. A `total` computed in the
 *      client is right on page one and wrong from page two, invisibly.
 *   5. **No upload path.** There is no vehicle media operation at all, and no
 *      screen in these trees may read a file's bytes or assemble a transport of
 *      its own. Six distinct constructs, not three — see
 *      `FILE_ACCESS_CONSTRUCTS`. The file input was the seventh until
 *      `P1-OD-025` resolved; it is rule 6 now, and the paragraph beside
 *      `FILE_INPUT_CONSTRUCTS` carries why it moved rather than being exempted.
 *   6. **No unapproved file input.** `P1-OD-025` is RESOLVED and reception
 *      capture ships, so `type="file"` had to become legal somewhere. It is
 *      legal in exactly one component — see `FILE_INPUT_ALLOW` — and the split
 *      is what keeps that allowance narrow: `allow` exempts a file from a WHOLE
 *      rule, so naming the capture component on rule 5 would have traded six
 *      prohibitions away to permit one construct.
 *   7. **No export surface.** The canonical plan's task table names the operation
 *      behind every one of the 29 Frontend tasks and not one of them is an
 *      export. `shared.export-authorize` and `shared.export-catalogue` ARE
 *      published by the platform, so this is restraint rather than a gap — and
 *      restraint that only a test asserts is restraint until somebody deletes the
 *      test. The rule fires on an export caller in either of its two forms: the
 *      operation itself, and the browser-side substitute (a blob, an object URL,
 *      a `download` attribute, a CSV or PDF assembly, a `Content-Disposition`).
 *   8. **No invented media limit.** Resolving `P1-OD-025` relaxed nothing here,
 *      and the reason is the same one §14's disposition gave while the decision
 *      was open: this is the half a well-meaning implementation breaks. A
 *      "sensible default" of 10 MB and JPEG/PNG looks like diligence and is a
 *      policy nobody decided, shown to an operator as though somebody had. The
 *      ceiling and the accepted types belong to the document category the SERVER
 *      publishes — the upload authorization answers with `maxBytes` — so a
 *      constant written in this tier is an invention whether or not a decision
 *      exists. The rule fires on a hard-coded byte size, an accepted-MIME list,
 *      an extension allow-list or an `accept=` attribute.
 *   9. **No console output.** A `console.log` in a Server Action prints server
 *      state into a log nobody is reading; in a client component it prints it
 *      into the browser.
 *
 * ## Three properties this gate is built around
 *
 * **Comments are stripped before scanning.** Every rule above names an operation
 * that this phase deliberately does not call, and the reason it does not call it
 * is written in a docblock naming that operation. A scanner that reads prose
 * accuses the explanation of breaking the rule, and the obvious "fix" is to
 * delete the only durable record of the decision. `apps/web/tests/p1-27-security.test.ts`
 * hit exactly this on its first run.
 *
 * **The stripper is proven, not assumed.** A stripper that removed too much
 * would make every rule pass on an empty string, and all nine would report clean
 * while measuring nothing. `selfTest()` runs on every invocation: the forbidden
 * names in a comment must vanish, and the same names in a string literal and a
 * URL must survive.
 *
 * **A rule that matches nothing fails.** Every rule declares the tree it expects
 * to inspect. A scan root that no longer matches reports clean over nothing,
 * which reads as evidence and is blindness.
 *
 * Usage: node scripts/ci/check-p1-27-frontend.mjs [--json]
 * Exit: 0 clean · 1 a violation · 2 the check could not run.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * THREE trees, because the canonical plan names three.
 *
 * `canonical-plan.md` §9 states where Frontend work lives:
 * `apps/web/src/features/crm/**`, `apps/web/src/features/vehicles/**` **and**
 * `apps/web/src/app/[locale]/(dashboard)/**`. This constant listed two of them
 * and the docblock above it said "the two feature trees this phase owns" — a
 * declaration contradicting the plan, in the gate whose whole purpose is to
 * enforce the plan.
 *
 * Measured at the head that carried the omission: 43 files scanned, 26
 * unscanned — 38% of the canonical Frontend surface, including
 * `crm/customers/[customerId]/page.tsx`, the file `SEC-001` and `SEC-003` are
 * about. Six rules reported clean over a tree they had never opened.
 *
 * `ROOT_SOURCES` records which document each root comes from, so a root cannot
 * be dropped without contradicting a citation. `tests/ci/p1-27-frontend-gate.test.ts`
 * re-derives the list from that document and fails if any of the three is
 * removed again.
 */
export const PLAN_ROOTS = [
  join('apps', 'web', 'src', 'features', 'crm'),
  join('apps', 'web', 'src', 'features', 'vehicles'),
  join('apps', 'web', 'src', 'app', '[locale]', '(dashboard)'),
];

/**
 * Trees a LATER phase opted into these rules, each with its own authority.
 *
 * `PLAN_ROOTS` is derived from P1-27's canonical plan and may not grow: the plan
 * is a closed phase's sealed artefact, and adding a tree to it would be asserting
 * that another phase's code is P1-27 Frontend work. That constraint used to end
 * the argument — `UNCOLLECTED_PHASE_MODULES` below records the reasoning, and it
 * is still correct about the plan.
 *
 * It was not correct about the RULES. `no-upload-path` and
 * `no-invented-media-limit` enforce the `P1-OD-025` disposition, which is a
 * standing product decision and not a P1-27 one; while the reception tree was
 * collected by no root, both reported clean over a tree they had never opened
 * and the only thing enforcing them there was one test file, which a single
 * commit can delete alongside the code it guards
 * (`apps/web/tests/p1-28-reception-media.test.ts` says so in its own docblock).
 *
 * So adoption is separated from the plan rather than smuggled into it: P1-28
 * declares its Frontend tree in ITS canonical plan, this constant records the
 * adoption with that document as the citation, and
 * `tests/ci/p1-27-frontend-gate.test.ts` checks each half against its own
 * authority. Neither document is made to say something it does not.
 *
 * @type {ReadonlyArray<{ root: string, authority: string, phase: string }>}
 */
export const ADOPTED_ROOTS = Object.freeze([
  /*
   * `P1-28-DO-001` and `P1-28-SEC-003`, which found the SAME omission
   * independently and each added an entry for it.
   *
   * P1-28's plan §9 names THREE trees — `features/appointments`,
   * `features/receptions` and `app/[locale]/(dashboard)` — and this constant
   * recorded one of them. The dashboard tree is already a `PLAN_ROOT`, so the
   * omission was `features/appointments` alone.
   *
   * Measured at the head that carried it: nine `.ts`/`.tsx` files — the whole
   * appointment surface, including the two screens that build a branch-target
   * query and the booking form that posts a company and a branch in its body —
   * were collected by no root. Seven rules reported clean over a tree they had
   * never opened, and the eighth (`no-client-asserted-scope`) was the only one
   * whose premise genuinely does not hold there. That is the same shape the
   * third `PLAN_ROOT` was added to fix — a gate contradicting its own authority
   * — and it is fixed the same way: by citation, not by opinion.
   *
   * ## Why this is ONE entry and briefly was two
   *
   * The two waves ran on separate branches and were merged without the whole
   * battery being re-run over the union, so `features/appointments` was adopted
   * TWICE. `tests/ci/p1-28-devops-gate.test.ts` compares the adopted set with
   * the set the plan owes as an equality and went red on the merge commit —
   * correctly, and to nobody, because the merge was the first head on which the
   * two changes existed together. A duplicate root is not harmless either:
   * `SCAN_ROOTS` is walked per entry, so every rule judged the appointment tree
   * twice and any violation there would have been reported twice.
   *
   * `tests/ci/p1-28-devops-gate.test.ts` derives the expected adopted set from
   * the P1-28 plan's §9 sentence, so a fourth tree cannot be forgotten the same
   * way and a third copy of an existing one cannot be added.
   */
  Object.freeze({
    root: join('apps', 'web', 'src', 'features', 'appointments'),
    authority: 'docs/phase-1/phase-1-28/canonical-plan.md',
    phase: 'P1-28',
  }),
  Object.freeze({
    root: join('apps', 'web', 'src', 'features', 'receptions'),
    authority: 'docs/phase-1/phase-1-28/canonical-plan.md',
    phase: 'P1-28',
  }),
]);

/** Every tree the gate opens: the plan's three, plus every adopted tree. */
export const SCAN_ROOTS = [...PLAN_ROOTS, ...ADOPTED_ROOTS.map((entry) => entry.root)];

/** Where the authority for `PLAN_ROOTS` is written down. */
export const ROOT_AUTHORITY = 'docs/phase-1/phase-1-27/canonical-plan.md';

/**
 * Phase modules that live OUTSIDE every scan root — DERIVED, not listed.
 *
 * ## The fact
 *
 * The D1 remediation moved shared code out of `features/` — `RecordForm` to
 * `@/components/forms`, the customer directory to `@/lib/customers`, the match
 * explanations and scores to `@/components/duplicates` and `@/lib/duplicates`,
 * the party widgets to `@/components/party`. Those files, imported directly by
 * the scanned trees, are unambiguously this phase's surface and are collected by
 * no root.
 *
 * ## Why the list used to be wrong, and why a list could not notice
 *
 * This constant WAS five directories, written by hand. Measured against the
 * imports the three trees scanned AT THAT TIME actually make, five was
 * **5 of 14** — a historical figure, kept because it is what the argument rests
 * on; two trees have been adopted since and a real run of this gate now reports
 * 18 imported modules across five. A hand-written list can only fail when one of
 * ITS entries goes missing; it can never fail because something was never added,
 * which is the failure that happened. The largest omission was
 * `components/data-table` — imported by 38
 * import statements across the scanned trees and holding `DataTable.tsx`, the
 * component that renders every customer and vehicle row an operator sees. It was
 * in neither this list nor the security suite's `MOVED_OUT`, which was a second
 * hand-written list of five, and the two did not even agree with each other.
 *
 * So the direction is now the other way round. `importedModuleDirectories()`
 * DERIVES the set from the source of the scanned trees, and
 * `MODULE_DISPOSITION` must carry a decision for every directory it returns and
 * for nothing else — asserted as an equality in both directions, by
 * `evaluateModuleDispositions()` on every real run of this gate. A new import
 * fails here and has to be decided, rather than being absent by construction and
 * invisible forever.
 *
 * ## Why these are not simply added to `SCAN_ROOTS`
 *
 * Because `SCAN_ROOTS` is not a free variable. It is bound in two directions by
 * documents this branch does not own:
 *
 *   - P1-27's `canonical-plan.md` §9 names the three trees `PLAN_ROOTS` holds,
 *     and `tests/ci/p1-27-frontend-gate.test.ts` re-derives that half of the
 *     root list from the text and asserts `PLAN_ROOTS` equals it — including
 *     that the plan declares exactly three. Adding a PLAN root without amending
 *     the plan makes the gate contradict its own authority, which is the defect
 *     the third root was added to fix, pointing the other way. `ADOPTED_ROOTS`
 *     is the other half and is checked against P1-28's plan instead, which is
 *     why `SCAN_ROOTS` is five while the P1-27 plan still names three.
 *   - `check-p1-27-doc-counts.mjs` publishes `p1-27-frontend-gate` (the file
 *     count) and `p1-27-frontend-gate:trees` (`SCAN_ROOTS.length`) as derived
 *     markers, and four documents carry them —
 *     `deliverable-manifest.md`, `open-decisions.md`,
 *     `owner-acceptance-fail-remediation.md` and `risk-register.md`. A real run
 *     of this gate at this head reports **126 files across 5 trees**, and those
 *     are the values the four documents carry; this sentence used to name 69 and
 *     3, which were the values when the second tree was adopted and had been
 *     wrong since, and then 123. Measured rather than reasoned about: the tree
 *     without reception capture's two new files reports 124, and adding
 *     `CaptureFileField.tsx` and `signature-capture.ts` takes it to 126. The
 *     markers themselves are re-derived on every run, so the documents cannot
 *     drift — only prose like this can, which is why the
 *     numbers here now say which run produced them.
 *
 * And a wider widening is worse, not better: measured across the `.ts`/`.tsx`
 * files under `apps/web/src` that no root collects, a rule fires in
 * `features/administration`, `features/authentication`, `lib/api`,
 * `components/gallery` and `lib/observability`. Those are other phases'
 * surfaces and several of those lines are correct. Widening to `apps/web/src`
 * turns correct lines red, which is how the last extension nearly went wrong
 * before `assertedScopes()` was written to tell an asserted scope from a
 * displayed one.
 *
 * ## What is done instead
 *
 * `tests/ci/p1-27-frontend-gate.test.ts` runs every rule over the `in-surface`
 * directories as they stand and asserts nothing fires — measured, not assumed.
 * So the coverage a fourth root would have bought is asserted, over exactly the
 * files it would have covered, without contradicting a document this branch
 * cannot amend. The day a violation lands there, the case goes red and the
 * extension becomes a conversation with evidence attached.
 *
 * This is a NARROWING of the residual exposure `risk-register.md:214` already
 * records, not a closure of it.
 */

/** The alias prefix the scanned trees import shared modules through. */
const MODULE_ALIAS = /['"`](@\/(?:components|lib)\/[^'"`]+)['"`]/g;

/** Where an aliased module resolves on disk. `@/x/y` → `apps/web/src/x/y`. */
export const MODULE_BASE = 'apps/web/src';

/**
 * Every `@/components/*` or `@/lib/*` module directory the given sources IMPORT.
 *
 * Read from the comment-STRIPPED source, so a docblock naming `@/lib/anything`
 * is not mistaken for an import of it. That matters here more than anywhere: the
 * docblocks in these trees name modules precisely when explaining why they are
 * NOT used.
 *
 * `@/lib/page-metadata` is a FILE, not a directory, and it is treated
 * identically — the first two segments are the module, and whether that resolves
 * to a directory or to a `.ts` is a fact about the filesystem rather than about
 * the import. `moduleSourceRoot()` is what settles it.
 *
 * @param {ReadonlyArray<{path: string, source: string}>} files
 * @returns {string[]} repository-relative, sorted, deduplicated
 */
export function importedModuleDirectories(files) {
  const found = new Set();
  for (const file of files) {
    for (const match of stripComments(file.source).matchAll(MODULE_ALIAS)) {
      const segments = String(match[1] ?? '').split('/');
      // `@/components/data-table/DataTable` → `components/data-table`. Not
      // named `module`: `@next/next/no-assign-module-variable` refuses that
      // identifier repository-wide, and `npm run lint` covers `scripts/`.
      const directory = segments.slice(1, 3).join('/');
      if (segments.length > 2 && directory) found.add(`${MODULE_BASE}/${directory}`);
    }
  }
  return [...found].sort();
}

/**
 * What was DECIDED about every module the scanned trees import.
 *
 * Nine of these were newly visible when the derivation replaced the hand-written
 * five, and each is a decision recorded here rather than an omission. The two
 * that are held OUT are held out for a measured reason, not a stated one:
 *
 *   - `lib/api` is the platform transport. `idempotent-operations.ts` is the
 *     GENERATED operation catalogue: it contains `/exports`,
 *     `download-authorizations` and the merge and duplicate-scan operation ids
 *     as DATA — the very operations rules 1, 2 and 7 prove this phase never
 *     calls. A gate that read the catalogue would accuse it of being the list it
 *     is. `read-operation.ts` names `tenantId` because it is the guard that
 *     REFUSES one, and `session-cookie.ts` because a server-side session
 *     legitimately holds the resolved scope.
 *   - `lib/observability` holds `client-log.ts`, which IS the structured logger
 *     the console rule tells people to use instead of `console.*`. Folding it in
 *     would turn the remedy red.
 *
 * Neither exclusion is taken on trust. `tests/ci/p1-27-frontend-gate.test.ts`
 * runs every rule over both directories and pins the exact files that match, so
 * a genuine violation landing in one of them goes red instead of hiding behind
 * the word "excluded".
 *
 * @type {Readonly<Record<string, 'in-surface' | 'platform-transport'>>}
 */
export const MODULE_DISPOSITION = Object.freeze({
  /** The P1-25 brand marks the dashboard shell renders. Clean, and scanned. */
  'apps/web/src/components/brand': 'in-surface',
  /** Renders every customer and vehicle row. Was in NO list, by either name. */
  'apps/web/src/components/data-table': 'in-surface',
  'apps/web/src/components/duplicates': 'in-surface',
  'apps/web/src/components/forms': 'in-surface',
  'apps/web/src/components/party': 'in-surface',
  /**
   * `action-notifications` — what a write's outcome becomes on screen. Newly
   * visible when the P1-28 reception tree adopted these rules; operator-facing,
   * so `in-surface` rather than transport.
   */
  'apps/web/src/components/notifications': 'in-surface',
  /**
   * The confirmation dialogs the appointment detail screen raises before it
   * cancels an appointment or records a no-show — both terminal, both
   * irreversible. Newly visible when the P1-28 appointment tree was adopted;
   * operator-facing, so `in-surface`.   */
  'apps/web/src/components/overlays': 'in-surface',
  /**
   * `PrintDocument`/`PrintTable` — the page geometry of the acknowledgement
   * sheet a customer is handed. Newly visible with the adopted tree, and about
   * as operator-facing as a surface gets.
   */
  'apps/web/src/components/print': 'in-surface',
  /** `Icon`, rendered inside P1-27 controls. */
  'apps/web/src/components/primitives': 'in-surface',
  /** `PageHeader`, and the locale switcher that carries table state across it. */
  'apps/web/src/components/shell': 'in-surface',
  /** `States` — every denial, error and empty state these screens render. */
  'apps/web/src/components/states': 'in-surface',
  /** The platform transport. Excluded, with the exclusion measured. */
  'apps/web/src/lib/api': 'platform-transport',
  'apps/web/src/lib/customers': 'in-surface',
  'apps/web/src/lib/duplicates': 'in-surface',
  /** `action-result` and `field-errors` — what a refused write becomes. */
  'apps/web/src/lib/forms': 'in-surface',
  /*
   * `intlLocale`, `formatDate`, `formatDateTime` — the product's one date and
   * clock convention. `in-surface` because it renders operator-visible text:
   * seven P1-27 components used to construct `Intl.DateTimeFormat` with the bare
   * locale, so an English operator saw `Mar 4, 2026, 12:14 PM` in Vehicle
   * History and `4 Mar 2026, 12:14` in the audit log. Routing them through this
   * module is what made it a newly imported dependency of a scanned tree.
   */
  'apps/web/src/lib/format': 'in-surface',
  /** The structured logger the console rule points at. Excluded, measured. */
  'apps/web/src/lib/observability': 'platform-transport',
  'apps/web/src/lib/page-metadata': 'in-surface',
});

/**
 * The modules this phase owns and no `SCAN_ROOT` collects, derived from the
 * decisions above. The name is kept because four documents and the security
 * suite refer to it; what changed is that it is no longer written by hand.
 */
export const UNCOLLECTED_PHASE_MODULES = Object.freeze(
  Object.entries(MODULE_DISPOSITION)
    .filter(([, disposition]) => disposition === 'in-surface')
    .map(([directory]) => directory)
    .sort()
);

/**
 * Where a recorded module resolves on disk — a DIRECTORY or a single FILE.
 *
 * `@/lib/page-metadata` is `src/lib/page-metadata.ts`. A consumer that assumed a
 * directory would throw `ENOENT` on it, and dropping it from the record to avoid
 * that would be exactly the omission the derivation exists to stop.
 *
 * @param {string} directory repository-relative, e.g. `apps/web/src/lib/forms`
 * @param {string} [root] repository root
 * @returns {string|null} an absolute path, or null when nothing resolves
 */
export function moduleSourceRoot(directory, root = process.cwd()) {
  const base = join(root, ...String(directory).split('/'));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Both directions of the derivation, as gate failures rather than as a test.
 *
 * An import with no recorded disposition fails as an addition; a disposition
 * naming a module nothing imports any more fails as a stale one. Run from
 * `main()` over the real scanned files — never from `evaluate()`, which is handed
 * synthetic fixtures that import nothing and would fail the anti-vacuity guard
 * below on every one of them.
 *
 * @param {ReadonlyArray<{path: string, source: string}>} files
 * @returns {{failures: string[], directories: string[]}}
 */
export function evaluateModuleDispositions(files) {
  const directories = importedModuleDirectories(files);
  const failures = [];

  if (directories.length === 0) {
    failures.push(
      'module-disposition: no `@/components/*` or `@/lib/*` import was discovered across the ' +
        'scanned trees — the derivation is broken and the equality below would compare two ' +
        'empty sets'
    );
    return { failures, directories };
  }

  const decided = Object.keys(MODULE_DISPOSITION).sort();
  for (const directory of directories) {
    if (!Object.hasOwn(MODULE_DISPOSITION, directory)) {
      failures.push(
        `module-disposition: ${directory} is imported by a scanned tree and has no entry in ` +
          'MODULE_DISPOSITION — decide it as `in-surface` or `platform-transport`'
      );
    }
  }
  for (const directory of decided) {
    if (!directories.includes(directory)) {
      failures.push(
        `module-disposition: ${directory} is recorded in MODULE_DISPOSITION and no scanned tree ` +
          'imports it — the record is stale'
      );
      continue;
    }
    if (moduleSourceRoot(directory) === null) {
      failures.push(
        `module-disposition: ${directory} resolves to nothing on disk — the record names a ` +
          'module that is not there'
      );
    }
  }
  return { failures, directories };
}

/**
 * The scope names this platform resolves server-side and the client must never
 * assert. Exported so the rule and its tests read one list.
 */
export const SCOPE_NAMES = Object.freeze([
  'tenantId',
  'companyId',
  'branchId',
  'tenant_id',
  'company_id',
  'branch_id',
]);

const SCOPE_SOURCE = `\\b(?:${SCOPE_NAMES.join('|')})\\b`;
/** Global, for the positional scan. Stateful — never share it with `.test()`. */
const SCOPE_SCAN = new RegExp(SCOPE_SOURCE, 'g');
/** Non-global, for the rule's `pattern` field. `.test()` on a `g` regex is stateful. */
const SCOPE_PATTERN = new RegExp(SCOPE_SOURCE);

/**
 * Every index that sits inside a string or template literal, at any nesting.
 *
 * The interpolation of a template is CODE, but for this rule it counts as
 * literal all the same: a scope value interpolated into a template is being
 * built into a URL, a query string or a body, which is the act the rule forbids.
 * So the mask covers the whole span from the opening quote to the closing one.
 *
 * Comments are stripped before this runs, so an apostrophe in prose cannot open
 * a phantom string.
 */
export function literalMask(source) {
  const inside = new Array(source.length).fill(false);
  /** @type {{kind: 'literal'|'code', quote?: string, depth: number}[]} */
  const stack = [];
  let i = 0;
  while (i < source.length) {
    const top = stack[stack.length - 1];
    const ch = source[i];
    if (!top || top.kind === 'code') {
      if (ch === "'" || ch === '"' || ch === '`') {
        stack.push({ kind: 'literal', quote: ch, depth: 0 });
        inside[i] = true;
        i += 1;
        continue;
      }
      if (top && ch === '{') {
        top.depth += 1;
        i += 1;
        continue;
      }
      if (top && ch === '}') {
        if (top.depth === 0) {
          stack.pop();
          inside[i] = true;
          i += 1;
          continue;
        }
        top.depth -= 1;
        i += 1;
        continue;
      }
      // Inside a template interpolation every character still belongs to the
      // template as far as this rule is concerned.
      if (top) inside[i] = true;
      i += 1;
      continue;
    }
    inside[i] = true;
    if (ch === '\\') {
      if (i + 1 < source.length) inside[i + 1] = true;
      i += 2;
      continue;
    }
    if (top.quote === '`' && ch === '$' && source[i + 1] === '{') {
      inside[i + 1] = true;
      stack.push({ kind: 'code', depth: 0 });
      i += 2;
      continue;
    }
    if (ch === top.quote) {
      stack.pop();
      i += 1;
      continue;
    }
    i += 1;
  }
  return inside;
}

/**
 * Scope names the source ASSERTS, as opposed to ones it merely DISPLAYS.
 *
 * ## Why the distinction has to exist
 *
 * Adding the dashboard tree made the previous form of this rule — any
 * occurrence of a scope name, anywhere — fire on
 * `apps/web/src/app/[locale]/(dashboard)/profile/page.tsx`:
 *
 *     value={session.tenantId}
 *
 * That is the profile screen showing the operator which tenant they are signed
 * in to. The value came FROM the server, in the session the server resolved; it
 * is read and rendered and goes nowhere near a request. Failing it would have
 * meant deleting a legitimate screen element to satisfy a rule about something
 * else — and the obvious alternative, an allow-list entry for that file, is how
 * this gate lost a rule before (see `no-duplicate-scan-on-a-queue` below).
 *
 * ## The line the rule actually draws
 *
 * The rule means: **never place a scope into a request.** So a scope name may
 * appear in exactly one position — as a property READ off an object, outside any
 * string or template:
 *
 *     session.tenantId        // display: reading what the server resolved
 *     account?.company_id     // display
 *
 * Every other position is an assertion, because every other position is a way of
 * putting the value somewhere:
 *
 *     { tenantId: x }                    // a body or query property
 *     query({ tenantId, cursor })        // a shorthand property
 *     `/api/v1/x?tenant_id=${id}`        // a query string
 *     params.set('branchId', id)         // a query parameter
 *     `${tenantId}`                      // interpolated into a path
 *
 * The default is therefore ASSERTION and the exemption is narrow, which is the
 * right way round for a gate: a construct nobody anticipated fails rather than
 * passes.
 *
 * @returns {{name: string, index: number, why: string}[]}
 */
export function assertedScopes(source) {
  const inside = literalMask(source);
  const found = [];
  SCOPE_SCAN.lastIndex = 0;
  let match;
  while ((match = SCOPE_SCAN.exec(source)) !== null) {
    const index = match.index;
    if (inside[index]) {
      found.push({
        name: match[0],
        index,
        why: 'built into a string, template, URL or query',
      });
      continue;
    }
    // A property read: the character before it, ignoring whitespace, is the
    // member operator. `?.` ends in `.` too, so one test covers both.
    const before = source.slice(0, index).replace(/\s+$/, '');
    if (before.endsWith('.')) continue;
    found.push({ name: match[0], index, why: 'placed into a value rather than read from one' });
  }
  return found;
}

/**
 * A rule whose pattern is assembled from NAMED constructs, each with a sample.
 *
 * ## Why the shape exists
 *
 * `no-upload-path` was `/new FormData\(\)|multipart\/form-data|type="file"/` —
 * three constructs — while `apps/web/tests/p1-27-security.test.ts` forbade seven
 * on the same surface. `FileReader`, a `.files` list, an `onDrop` target and a
 * `DataTransfer` were refused by a test file and by nothing in CI, and a test
 * can be deleted in the same commit as the code it guards. The gap was invisible
 * because the rule was one opaque regex: there was nothing to count.
 *
 * So each construct is named and carries the smallest source that constitutes
 * it. `tests/ci/p1-27-frontend-gate.test.ts` plants every sample through the
 * gate's own `evaluate()` and asserts the rule reports it — so a construct
 * cannot be added to the table without being proved to fire, and one that stops
 * firing fails by name rather than by silence.
 *
 * The samples are also the reason `/./` is not a rule: each table carries
 * `innocent` sources that must NOT fire, and the two sets are asserted disjoint.
 *
 * The key is `construct` and NOT `id`, which matters outside this file:
 * `apps/web/tests/p1-27-guidance-reconciliation.test.ts` finds this gate's rule
 * ids by scraping `id: '…',` lines out of the source, and asserts every one of
 * them has a sentence in the developer guide. A construct spelled `id` would be
 * read as a nineteenth rule and fail a guide that is not wrong.
 *
 * @param {ReadonlyArray<{construct: string, pattern: RegExp}>} constructs
 * @returns {RegExp} one pattern matching any of them
 */
export function anyOf(constructs) {
  return new RegExp(constructs.map((construct) => construct.pattern.source).join('|'));
}

/**
 * The six file-access constructs, mirroring what the security suite forbids.
 *
 * This was seven. The file input is the one that left, for
 * `no-unapproved-file-input` and `FILE_INPUT_CONSTRUCTS`, when `P1-OD-025`
 * resolved and the reception capture surface shipped — so the mirror is no
 * longer one-to-one, and the paragraph beside `FILE_INPUT_CONSTRUCTS` records
 * why splitting the rule was a NARROWER relaxation than allow-listing the
 * capture component here.
 *
 * The suite's `FILE_ACCESS` regex spells the file input twice (`type="file"` and
 * `type={'file'}`); both are one construct in the split-out table, generalised to
 * cover the backtick and double-quoted brace forms the suite's literal spelling
 * misses.
 *
 * `new FormData\(` deliberately drops the `\)` the old rule required:
 * `new FormData(existingForm)` is the same upload path and the old pattern let it
 * through.
 */
export const FILE_ACCESS_CONSTRUCTS = Object.freeze([
  {
    construct: 'form-data',
    pattern: /new FormData\(/,
    // The second sample is the one the old `new FormData\(\)` pattern let
    // through: the same upload path, constructed from an existing form.
    samples: ['const body = new FormData();', 'const body = new FormData(element);'],
  },
  {
    construct: 'multipart-encoding',
    pattern: /multipart\/form-data/,
    samples: ["headers.set('content-type', 'multipart/form-data');"],
  },
  {
    construct: 'file-reader',
    pattern: /\bFileReader\b/,
    samples: ['const reader = new FileReader();'],
  },
  { construct: 'file-list', pattern: /\.files\b/, samples: ['const chosen = input.files;'] },
  {
    construct: 'drop-target',
    pattern: /onDrop=|onDragOver=/,
    samples: ['<div onDrop={receive} />', '<div onDragOver={hold} />'],
  },
  {
    construct: 'data-transfer',
    pattern: /\bDataTransfer\b/,
    samples: ['const moved = event.dataTransfer as DataTransfer;'],
  },
]);

/** File-access-adjacent source that is NOT an upload path. */
export const FILE_ACCESS_INNOCENT = Object.freeze([
  'const fileName = customer.displayName;',
  '<input type="text" name="plate" />',
  'const profiles = record.profiles;',
  '<Menu onDropdownOpen={open} />',
  "const label = t('vehicles.documents.heading');",
]);

/**
 * The export constructs, in both of the two forms an export can take.
 *
 * The platform DOES publish `shared.export-authorize` and
 * `shared.export-catalogue`, which is what makes this rule restraint rather than
 * a sweep for something that does not exist. The second form matters just as
 * much: the way to export without an export operation is to assemble the bytes
 * in the browser from rows that were read one page at a time.
 */
export const EXPORT_CONSTRUCTS = Object.freeze([
  {
    construct: 'export-operation',
    pattern: /export-authorize|export-catalogue/,
    samples: ["const op = 'shared.export-authorize';", "const op = 'shared.export-catalogue';"],
  },
  {
    /*
     * An export CALLER by name or by path.
     *
     * `\bexport[A-Z]` cannot collide with the `export` keyword: every form of it
     * — `export const`, `export type`, `export default`, `export *`, `export {` —
     * continues in lower case or in punctuation, so only an identifier such as
     * `exportCustomers` matches. That matters in a tree where most lines begin
     * with the word.
     */
    construct: 'export-caller',
    pattern: /\bexport[A-Z]\w*|-export|\/export/,
    samples: [
      "await client.send('POST', '/api/v1/exports', {});",
      'const rows = await exportCustomers(criteria);',
      "const op = 'crm.customer-export';",
    ],
  },
  {
    construct: 'download-authorization',
    pattern: /attachment-download|download-authorizations/,
    samples: ["const op = 'shared.attachment-download-authorize';"],
  },
  {
    construct: 'download-construction',
    pattern: /\bdownload=|\bdownloadAll|createObjectURL|\bsaveAs\s*\(/,
    samples: ['<a download={name} href={href} />', 'const href = URL.createObjectURL(bytes);'],
  },
  { construct: 'client-blob', pattern: /new Blob\(/, samples: ['const bytes = new Blob([rows]);'] },
  {
    construct: 'tabular-assembly',
    pattern: /text\/csv|application\/pdf|application\/vnd\.ms-excel/,
    samples: ["const mime = 'text/csv';", "const mime = 'application/pdf';"],
  },
  {
    construct: 'content-disposition',
    pattern: /[Cc]ontent-[Dd]isposition/,
    samples: ["headers.set('Content-Disposition', 'attachment');"],
  },
]);

/**
 * Export-adjacent source that is NOT an export surface.
 *
 * The first entry is the one that matters: this rule lives in a tree where every
 * other line begins with the word `export`.
 */
export const EXPORT_INNOCENT = Object.freeze([
  'export const listVehicleDocuments = async () => rows;',
  'export default async function Page() { return null; }',
  'export type { VehicleDocuments } from "./documents-contract";',
  'const isDownloadable = record.canDownload;',
  "const accepted = 'application/json';",
  "const path = '/api/v1/vehicles/v1/documents';",
]);

/**
 * The invented-limit constructs — the second half of the `P1-OD-025` disposition.
 *
 * §14 says "keep upload acceptance blocked, do not invent limits". Rule 5
 * enforces the first clause; nothing enforced the second, and the second is the
 * one that gets broken by diligence rather than by carelessness. There is no
 * decision to derive a number or a type list from, so any of them here is an
 * invention presented to an operator as policy.
 */
export const INVENTED_MEDIA_LIMIT_CONSTRUCTS = Object.freeze([
  {
    construct: 'byte-size-limit',
    pattern: /MAX_(?:FILE|UPLOAD|IMAGE|MEDIA|ATTACHMENT)_|max(?:File|Upload|Image|Media)Size/,
    samples: ['const MAX_FILE_SIZE_BYTES = limit;', 'const maxFileSize = limit;'],
  },
  {
    construct: 'byte-arithmetic',
    pattern: /\b\d+\s*\*\s*1024\b/,
    samples: ['const limit = 5 * 1024 * 1024;'],
  },
  {
    construct: 'accepted-mime-list',
    pattern:
      /ACCEPTED_(?:FILE|MIME|IMAGE|TYPE)|accepted(?:Mime|File|Image)Types|allowedMimeTypes|image\/(?:jpe?g|png|heic|webp)|video\/(?:mp4|quicktime)/,
    samples: ["const types = ['image/jpeg', 'image/png'];", 'const ACCEPTED_MIME = types;'],
  },
  {
    construct: 'extension-allow-list',
    pattern:
      /ALLOWED_EXTENSIONS|allowedExtensions|acceptedExtensions|['"`]\.(?:jpe?g|png|heic|mp4|webp)['"`]/i,
    samples: ["const allowed = ['.jpg', '.png'];", 'const allowedExtensions = list;'],
  },
  { construct: 'accept-attribute', pattern: /accept=/, samples: ['<MediaField accept={types} />'] },
]);

/**
 * The file input, on its own, because its exemption has to be.
 *
 * ## Why it left `FILE_ACCESS_CONSTRUCTS`
 *
 * `P1-OD-025` is RESOLVED and the capture surface it blocked now ships, so a
 * rule that forbade every file input outright would refuse the thing the Owner
 * asked for. The block is CONVERTED rather than deleted, and the conversion is
 * structural: `allow` exempts a FILE from a whole rule, so allow-listing the
 * capture component against `no-upload-path` would have exempted it from
 * `FileReader`, `DataTransfer`, drop targets and hand-set multipart encoding
 * too — six prohibitions traded away to permit one construct.
 *
 * Splitting it means the exemption is scoped to the one construct that has to be
 * permitted, and the capture component remains subject to every other rule. That
 * is a NARROWER allowance than the one obvious edit would have produced.
 *
 * ## What is NOT relaxed
 *
 * `no-invented-media-limit` is untouched. The accepted content types and the
 * size ceiling belong to the category the SERVER publishes; the capture screen
 * renders and enforces those values and holds no constant of its own, so the
 * rule that fails a build over an invented ceiling still applies to it in full.
 */
export const FILE_INPUT_CONSTRUCTS = Object.freeze([
  {
    construct: 'file-input',
    pattern: /type=["']file["']|type=\{\s*["'`]file["'`]\s*\}/,
    samples: [
      '<input type="file" name="photo" />',
      '<input type={\'file\'} name="photo" />',
      '<input type={"file"} name="photo" />',
    ],
  },
]);

/**
 * The ONE component permitted to offer a file input.
 *
 * A path, not a directory: an allowance that covered a folder would grow with
 * whatever was put in it. `apps/web/tests/p1-28-reception-media.test.ts` asserts
 * this list has exactly one entry and that the file it names exists, so an
 * allowance for a deleted file cannot sit here looking legitimate.
 *
 * It named `steps/MediaStep.tsx` while reception evidence was the only thing
 * captured. `FE-018` then needed a signature image, and the cheap move was a
 * second entry — which would have turned "there is one approved capture
 * surface" into "there are the approved capture surfaces", one screen at a time,
 * with this list as the record of the decay. The input moved into a shared
 * `CaptureFileField` instead: both steps render it, this list still holds one
 * path, and a third capture surface widens nothing.
 */
export const FILE_INPUT_ALLOW = Object.freeze([
  'apps/web/src/features/receptions/components/CaptureFileField.tsx',
]);

/** Limit-adjacent source that invents no media policy. */
export const INVENTED_MEDIA_LIMIT_INNOCENT = Object.freeze([
  'const pageSize = 25;',
  'const ACCEPTED_STATUSES = ["active", "retired"];',
  '<Dialog onAccept={confirm} />',
  "const media = t('vehicles.media.blocked');",
  'const columns = rows.length * 2;',
  'export const MEDIA_STATUS = "blocked-on-p1-od-025";',
]);

export const RULES = [
  {
    id: 'no-merge-caller',
    pattern: /customer-merge|vehicle-merge|['"`][^'"`]*\/merge['"`]|merge[A-Z]\w*Action/,
    what: 'calls or exposes a merge operation while P1-OD-017 is an open Owner decision',
    allow: [],
  },
  {
    id: 'no-duplicate-scan-on-a-queue',
    pattern: /duplicate-scan|scanDuplicates/,
    what: 'fires a privileged audited duplicate scan from a review surface',
    /*
     * NO exemption, and the one that stood here was a live hole.
     *
     * It named `creation-actions.ts` and said "the CRM creation form calls
     * `crm.duplicate-scan` ONCE on explicit intent". That was never true: the
     * file contains no such call, and `crm-customer-create.dom.test.tsx` asserts
     * its absence deliberately. The creation-time duplicate warning arrives on
     * the create RESPONSE as `possibleDuplicates` — no scan is involved.
     *
     * `evaluate()` skips allow-listed files entirely and only fails a rule that
     * inspected zero files overall, so an unused entry is never reported. It cost
     * nothing today and would have cost everything tomorrow: a privileged audited
     * write added to that file would have passed the gate that exists to stop it.
     *
     * Both scans are `DELIBERATELY_ABSENT` in `canonical-write-reachability.json`
     * and neither has a legitimate call site in this phase, so the list is empty.
     */
    allow: [],
  },
  {
    id: 'no-client-asserted-scope',
    /*
     * POSITIONAL, not a bare name match.
     *
     * The rule is "never assert a scope to the API", and the previous pattern
     * read "never mention one". Those differ on exactly one construct that this
     * phase actually ships — a profile screen displaying the tenant the server
     * resolved — and the difference only became visible when the third canonical
     * tree was added to `SCAN_ROOTS`. `assertedScopes()` carries the reasoning
     * and the boundary; the pattern is kept beside it so a reader can see which
     * names are in scope without following the function.
     *
     * ## `roots`, and why it is not an allow-list wearing a hat
     *
     * This rule's premise — "scope is resolved server-side" — is a fact about
     * the CRM and Vehicle OPERATIONS, not about the platform. `rec.*` publishes
     * the opposite contract: `rec.reception-create` takes `companyId` and
     * `branchId` as REQUIRED body fields and `rec.reception-list` as a mandatory
     * query pair, because a reception visit is authorized against the branch it
     * is FOR (`P1-18-A-01`). A client sending them is not widening its own
     * access — the server checks the operator's permission IN that scope and
     * refuses — it is naming the resource, exactly as it names a vehicle.
     *
     * An `allow` entry would have been the wrong instrument, and this gate's own
     * tests make that expensive to ignore: `tests/ci/p1-27-frontend-gate.test.ts`
     * pins every allowance in the rule set to the exact rule and the exact path
     * that carries it, so adding one is a deliberate argued act and never a
     * quiet answer to a false positive. `allow` exempts FILES from a rule that
     * applies to them; `roots` says where the rule's premise is true at all. The
     * difference is visible the moment somebody adds a file: a new reception
     * screen is not something anyone has to remember to list, and a new CRM or
     * Vehicle screen is still caught.
     *
     * There is exactly ONE allowance in this file, on `no-unapproved-file-input`,
     * and its docblock carries the argument for it. This rule has none.
     *
     * What the narrowing gives up is measured rather than waved away.
     * `tenantId`/`tenant_id` is a published selector on NO operation anywhere, so
     * the gate suite sweeps every tree outside `roots` for those two names
     * specifically and fails if either appears in any position.
     */
    pattern: SCOPE_PATTERN,
    detect: (source) => assertedScopes(source).length > 0,
    what: 'asserts a scope to the API; scope is resolved server-side (displaying session scope is fine)',
    /** The trees whose operations resolve scope server-side. See above. */
    roots: PLAN_ROOTS.map((root) => root.split(sep).join('/')),
    allow: [],
  },
  {
    id: 'no-invented-total',
    pattern: /\btotal\s*[:=]\s*(?:rows|items|\w+\.length)/,
    what: 'computes a row total the operation does not publish',
    allow: [],
  },
  {
    id: 'no-upload-path',
    /*
     * SIX constructs, not three — and seven until the file input left.
     *
     * This read `/new FormData\(\)|multipart\/form-data|type="file"/` while
     * `apps/web/tests/p1-27-security.test.ts` refused seven on the same surface.
     * `FileReader`, an `input.files` list, an `onDrop` target and a
     * `DataTransfer` — every drag-and-drop upload is built out of the last three
     * and none of them needs a `<input type="file">` — were forbidden by a test
     * file and by nothing in CI. A test can be deleted in the same commit as the
     * code it guards; a gate cannot.
     *
     * `new FormData(form)` is also newly covered: the old pattern required the
     * empty parentheses, so the constructor's one-argument form passed.
     */
    pattern: anyOf(FILE_ACCESS_CONSTRUCTS),
    what: 'reads file bytes in the browser or builds its own upload transport',
    allow: [],
  },
  {
    id: 'no-unapproved-file-input',
    /*
     * The one construct `P1-OD-025` being RESOLVED makes legitimate, and the one
     * place it is legitimate. Its docblock beside `FILE_INPUT_CONSTRUCTS`
     * carries why this is a separate rule rather than an `allow` entry on the
     * one above: `allow` exempts a file from a WHOLE rule, and the capture
     * component must stay subject to the other six prohibitions.
     */
    pattern: anyOf(FILE_INPUT_CONSTRUCTS),
    what: 'offers a file input outside the single approved capture component',
    allow: [...FILE_INPUT_ALLOW],
  },
  {
    id: 'no-export-surface',
    /*
     * The absence made structural.
     *
     * `canonical-plan.md` §6 names the operation behind each of the 29 Frontend
     * tasks and not one of them is an export — `tests/ci/p1-27-frontend-gate
     * .test.ts` re-reads that table and asserts it, so this rule's authority is
     * derived from the plan rather than restated here.
     *
     * The platform DOES publish `shared.export-authorize` and
     * `shared.export-catalogue`, so the absence is a decision and not a gap; and
     * it was proved only by `p1-27-security.test.ts`, which is one file away from
     * being deleted. `SEC-002`'s export conjunct now fails in CI as well.
     *
     * Both forms of export are covered, because the second does not need the
     * operation: bulk extraction assembled in the browser out of pages that were
     * read one at a time is the same disclosure by a different route.
     */
    pattern: anyOf(EXPORT_CONSTRUCTS),
    what: 'builds an export or download path; P1-27 publishes no export surface',
    allow: [],
  },
  {
    id: 'no-invented-media-limit',
    /*
     * The other half of the `P1-OD-025` disposition.
     *
     * §14 says "Implement the safe UI foundation. Keep upload acceptance blocked.
     * Do not invent limits." `no-upload-path` enforces the second sentence.
     * Nothing enforced the third, and the third is the one broken by diligence
     * rather than by carelessness: a "sensible default" of 10 MB and JPEG/PNG
     * looks like care and is a policy the Owner has not decided, presented to an
     * operator as though it had been.
     *
     * A constant is enough to fail this, and resolving `P1-OD-025` did not soften
     * that. What changed is where the true numbers live, not whether this tier may
     * hold its own: the ceiling and the accepted types are published per document
     * category by the SERVER — the upload authorization answers with `maxBytes`,
     * and `CaptureFileField` takes the type list as a prop and holds none — so a
     * limit written here is still an invention, and now one that can silently
     * disagree with the value the server will actually enforce. That is worse than
     * the open-decision case, not better: it fails at the boundary rather than on
     * screen. `p1-27-security.test.ts` says so too, over the copy as well as the
     * code.
     */
    pattern: anyOf(INVENTED_MEDIA_LIMIT_CONSTRUCTS),
    what: 'invents a media size, type or extension policy the server does not publish',
    allow: [],
  },
  {
    id: 'no-console-output',
    /*
     * ANY console method, not the five obvious ones.
     *
     * This was a `log|info|debug|warn|error` allow-list while the developer
     * guide described it as "any `console.*`" — so `console.table(customer)`,
     * `console.trace()` and `console.dir(vehicle)` all passed a rule whose whole
     * point is that server state must not reach stdout or a browser. `table` and
     * `dir` are the two that print an object most legibly, which makes them the
     * ones a developer reaches for when debugging exactly the data this rule
     * exists to keep out of logs.
     *
     * Widened rather than narrowing the sentence, because the sentence was right
     * about the intent (`G-04`).
     */
    pattern: /console\.[A-Za-z]\w*\s*\(/,
    what: 'writes to the console; server state belongs in the structured logger, not stdout',
    allow: [],
  },
];

export const EXTENSIONS = /\.(ts|tsx)$/;
export const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage']);

/**
 * Would a real run of this gate COLLECT this path?
 *
 * ## Why the question needs an answer of its own
 *
 * `evaluate()` takes `{path, source}` pairs and applies every rule to every pair
 * it is handed. It does not, and should not, ask where the path came from — the
 * walker decides that. But that means an assertion of the form
 *
 *     evaluate([{ path: 'anything/at/all.ts', source: 'console.log(x)' }])
 *
 * proves the RULE fires and proves nothing whatever about whether CI would ever
 * open that file. Called with `apps/web/src/components/forms/RecordForm.tsx` and
 * `apps/web/src/lib/customers/directory.ts` — two files this phase owns and no
 * `SCAN_ROOT` contains — `evaluate()` reports violations for a gate run that
 * would never have seen either. A test written that way reads as coverage and is
 * a statement about a string.
 *
 * So the collection decision is exported. An assertion that wants to prove the
 * gate enforces something in CI asserts `collects(path)` as well as the rule.
 *
 * ## What it mirrors
 *
 * Exactly what `main()` and `walk()` do, and nothing else: a path under one of
 * the `SCAN_ROOTS`, with a `.ts` or `.tsx` extension, no segment of which is a
 * skipped directory. Separators are normalised, so a caller may pass either
 * form. Existence is deliberately NOT consulted — the question is whether the
 * gate's rules reach that location, which is answerable for a file that does not
 * exist yet, and that is the interesting case.
 *
 * @param {string} path repository-relative
 * @returns {boolean}
 */
export function collects(path) {
  const normalised = String(path ?? '')
    .split(/[\\/]/)
    .filter(Boolean);
  if (normalised.length === 0) return false;
  if (!EXTENSIONS.test(normalised[normalised.length - 1])) return false;
  if (normalised.some((segment) => SKIP_DIRS.has(segment))) return false;
  const asPosix = normalised.join('/');
  return SCAN_ROOTS.some((root) => asPosix.startsWith(`${root.split(sep).join('/')}/`));
}

/**
 * Source with comments removed.
 *
 * `//` is only a comment start when it is not preceded by `:`, so `https://`
 * inside a string literal is not truncated — which would hide a real match on
 * the rest of that line.
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/**
 * Proves the stripper both removes prose and preserves code.
 *
 * Runs on every invocation rather than only under test, because a stripper that
 * silently over-matched would make this entire gate report clean over empty
 * strings — the exact failure mode the anti-vacuity rules below exist to catch,
 * arriving through the one path they cannot see.
 */
export function selfTest() {
  // The fourth case proves a `//` preceded by `:` is not treated as a comment
  // start. It asserts on the TAIL (`/keep-me`) rather than on the whole URL: an
  // `includes()` of a full URL is `js/incomplete-url-substring-sanitization`,
  // which CodeQL raised as HIGH against this very function on PR #198. The rule
  // is right in general — a substring check on a URL is a broken host check —
  // and the property under test never needed the host anyway. What matters is
  // that the characters AFTER the `//` survived, which is exactly what the tail
  // shows and what a truncation at `https:` would destroy.
  const sample = [
    '// customer-merge named in a line comment',
    '/** vehicle-merge named in a docblock */',
    "const path = '/merge';",
    "const doc = 'https://example.test/keep-me';",
  ].join('\n');
  const stripped = stripComments(sample);
  const problems = [];
  if (stripped.includes('customer-merge')) problems.push('line comments survive stripping');
  if (stripped.includes('vehicle-merge')) problems.push('docblocks survive stripping');
  if (!stripped.includes("'/merge'")) problems.push('string literals are destroyed by stripping');
  if (!stripped.includes('/keep-me')) problems.push('a URL is truncated at its own //');
  return problems;
}

function allowed(relPath, allow) {
  return allow.some((entry) => relPath === entry || relPath.startsWith(entry));
}

/**
 * Is this file inside a tree the rule's premise holds over?
 *
 * A rule with no `roots` applies everywhere, which is the default and the case
 * for eight of the nine. `no-client-asserted-scope` is the exception and its
 * docblock carries the reason — the trees differ in what their OPERATIONS
 * publish, not in how carefully they are written.
 */
export function inRuleScope(rule, relPath) {
  if (!Array.isArray(rule.roots)) return true;
  return rule.roots.some((root) => relPath === root || relPath.startsWith(`${root}/`));
}

/**
 * Does this rule fire on this source?
 *
 * A rule may carry a `detect` function instead of relying on its `pattern`.
 * `no-client-asserted-scope` needs one because the question it asks is
 * positional — see `assertedScopes()`.
 */
export function fires(rule, source) {
  return rule.detect ? rule.detect(source) === true : rule.pattern.test(source);
}

/**
 * A directory symlink is REFUSED, not followed and not silently skipped.
 *
 * `Dirent.isDirectory()` is FALSE for a symlink that points at a directory —
 * `readdir` does not stat through the link — so `if (entry.isDirectory())` walks
 * past it, and the extension test then rejects it as a file. The tree beyond it
 * is never read and nothing says so. Five walkers in this phase shared that
 * blind spot (`QA005-12`).
 *
 * Following it instead would be worse: a link can point outside the tree or at
 * an ancestor, and a gate that scans an unbounded set is a gate that hangs.
 *
 * So the policy is to fail closed and name the path. A symlink inside a scanned
 * tree is a deliberate act; whoever made it can decide what the gate should do
 * about it, which is a conversation rather than a silent omission.
 */
export function assertNotSymlink(entry, path) {
  if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
    throw new Error(
      `${path} is a symbolic link. This gate refuses to walk symlinks: a link is invisible to ` +
        '`isDirectory()`, so following the tree past it would silently scan nothing. Remove the ' +
        'link, or decide the policy deliberately.'
    );
  }
}

/**
 * @param {ReadonlyArray<{path: string, source: string}>} files
 * @returns {{failures: string[], counts: Record<string, number>}}
 */
export function evaluate(files) {
  const failures = selfTest().map((problem) => `strip-comments: ${problem}`);
  const counts = { files: files.length };

  if (files.length === 0) {
    failures.push('no files were inspected — the scan root no longer matches the tree');
    return { failures, counts };
  }

  for (const rule of RULES) {
    let inspected = 0;
    for (const file of files) {
      if (allowed(file.path, rule.allow)) continue;
      if (!inRuleScope(rule, file.path)) continue;
      inspected += 1;
      if (fires(rule, stripComments(file.source))) {
        failures.push(`${rule.id}: ${file.path} ${rule.what}`);
      }
    }
    counts[rule.id] = inspected;
    if (inspected === 0) {
      failures.push(`${rule.id}: inspected 0 files — this rule is measuring nothing`);
    }
  }

  return { failures, counts };
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path, out);
    } else {
      // Checked on the non-directory branch, which is exactly where a directory
      // symlink lands: `isDirectory()` is false for it.
      assertNotSymlink(entry, path);
      if (EXTENSIONS.test(entry.name)) out.push(path);
    }
  }
  return out;
}

function main() {
  const root = process.cwd();
  const paths = [];
  for (const scanRoot of SCAN_ROOTS) {
    const dir = join(root, scanRoot);
    try {
      if (!statSync(dir).isDirectory()) throw new Error('not a directory');
      walk(dir, paths);
    } catch (error) {
      console.error(`P1-27 gate could not read ${scanRoot}: ${String(error)}`);
      process.exit(2);
    }
  }

  const files = paths.map((path) => ({
    path: relative(root, path).split(sep).join('/'),
    source: readFileSync(path, 'utf8'),
  }));

  const { failures: ruleFailures, counts } = evaluate(files);

  /*
   * The derivation runs HERE and not inside `evaluate()`, because `evaluate()` is
   * handed synthetic one-line fixtures by the test suite. Those import nothing,
   * so folding this in would make every planted-violation case fail on an
   * unrelated complaint about a broken derivation.
   */
  const { failures: moduleFailures, directories } = evaluateModuleDispositions(files);
  const failures = [...ruleFailures, ...moduleFailures];
  counts.modules = directories.length;
  counts['modules:in-surface'] = UNCOLLECTED_PHASE_MODULES.length;

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ counts, failures }, null, 2));
  } else {
    console.log(
      `P1-27 frontend gate: ${counts.files} file(s) across ${SCAN_ROOTS.length} tree(s), ` +
        `${RULES.length} rule(s), ${directories.length} imported module(s), ` +
        `${failures.length} failure(s).`
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
