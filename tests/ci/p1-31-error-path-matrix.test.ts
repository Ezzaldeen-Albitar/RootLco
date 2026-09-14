/**
 * P1-31-QA-002 and P1-31-QA-003 — the error-path matrix and the two-layer isolation
 * matrix are GENERATED here, and the committed copies are diffed against the
 * derivation on every run.
 *
 * ## Why these two documents are generated rather than written
 *
 * Both are tables of citations: `docs/phase-1/phase-1-31/error-path-matrix.md` states,
 * for each of the phase's operations, the case that covers each refusal the platform
 * contract publishes, and `docs/phase-1/phase-1-31/isolation-matrix.md` states, per
 * table and per operation, the two proofs the isolation claim owes. A citation is a
 * FILE AND A LINE, and a line moves whenever anybody edits the file above it. A matrix
 * of four hundred hand-maintained line numbers is wrong within a sprint and — the part
 * that matters — wrong SILENTLY, which is precisely the failure a matrix of evidence
 * exists to prevent.
 *
 * So every citation below names a CASE TITLE, `at()` resolves it against the suite's
 * source at run time, and a title matching NO line or MORE THAN ONE is a thrown error
 * rather than a guess. That is the property the committed documents could not have on
 * their own, and it is why they are regenerated here instead of edited.
 *
 * Set `P1_31_MATRIX_WRITE=1` to rewrite both after a deliberate change. **The flag can
 * never produce a green run**: the write happens and the case then FAILS, telling the
 * caller to re-run without it. Writing and asserting in the same pass would have the
 * generator satisfy its own comparison, which is the shape of a check that cannot fail —
 * so the regeneration and the proof are deliberately two runs, and only the second one
 * counts.
 *
 * ## The three sources, and why each is the authority for its part
 *
 *  - the OPERATION SET comes from `declaredPermissions`, the permission-parity gate's
 *    own parser, run over the `route.ts` files of the eight P1-31 namespaces. The
 *    citation table is asserted to cover exactly that set, so an operation added to any
 *    of those namespaces fails this file rather than quietly missing a row;
 *  - the CITATIONS come from the case titles of the suites that own each operation. The
 *    suite decides where its case is; this file decides only which case answers which
 *    question;
 *  - the TABLE list for Layer 1 is the phase's own schema, each row carrying the
 *    migration that created it. It is stated here because a table is not derivable from
 *    a route parse, and it is checked by the isolation suites themselves rather than by
 *    this file.
 *
 * ## Passing on nothing is refused
 *
 * A generator that compares a rendered document to a missing file, or to an empty one,
 * reports agreement for the wrong reason. Both documents are asserted to exist and to
 * be non-trivial before either comparison runs, and the render is asserted to carry one
 * row per parsed operation and one per phase table — so an empty render matching an
 * empty document cannot be spelled as a pass.
 *
 * This file makes no database connection and drives no route: it is a statement about
 * source, and it belongs in the unit tier for that reason.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { declaredPermissions } from '../../scripts/ci/check-permission-parity.mjs';
import { parseModule } from '../../scripts/lib/typescript-source.mjs';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';

const ROOT = REPOSITORY_ROOT as string;
const API_V1 = join(ROOT, 'apps', 'api', 'src', 'app', 'api', 'v1');
const ERROR_PATH_MATRIX = join(ROOT, 'docs', 'phase-1', 'phase-1-31', 'error-path-matrix.md');
const ISOLATION_MATRIX = join(ROOT, 'docs', 'phase-1', 'phase-1-31', 'isolation-matrix.md');

/** The eight namespaces `security-and-qa-evidence.md:163` names as the phase surface. */
const P1_31_NAMESPACES = Object.freeze([
  'deliveries',
  'delivery-checklist-templates',
  'delivery-readiness',
  'org/employees',
  'report-configurations',
  'reports',
  'warranties',
  'warranty-policies',
] as const);

const EXPECTED_OPERATIONS = 47;
const EXPECTED_TABLES = 16;

// ---------------------------------------------------------------------------
// Citation resolution
// ---------------------------------------------------------------------------

const sources = new Map<string, readonly string[]>();

function linesOf(file: string): readonly string[] {
  const cached = sources.get(file);
  if (cached) return cached;
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  sources.set(file, lines);
  return lines;
}

/**
 * `file:line` for the ONE case whose title contains `title`.
 *
 * Zero matches and more than one are both thrown, never resolved to a best guess: a
 * citation that cannot be placed exactly is the defect this file exists to make
 * impossible, and a silent nearest-match would reintroduce it.
 */
function at(file: string, title: string): string {
  const lines = linesOf(file);
  const hits: number[] = [];
  lines.forEach((line, index) => {
    const isCase = /^\s*it(\.each\([^)]*\))?\s*\(/.test(line);
    const isTitleContinuation = /^\s*'/.test(line);
    if ((isCase || isTitleContinuation) && line.includes(title)) hits.push(index + 1);
  });
  if (hits.length !== 1) {
    throw new Error(
      `${file}: "${title}" matched ${String(hits.length)} line(s): ${hits.join(', ')}`
    );
  }
  return `${file}:${String(hits[0])}`;
}

const cite = (file: string, title: string): string => `\`${at(file, title)}\``;
const lineOf = (located: string): string => located.slice(located.lastIndexOf(':') + 1);

const ESC = 'tests/backend/p1-31-privilege-escalation.test.ts';
const DLV = 'tests/backend/p1-22-delivery.test.ts';
const WAR = 'tests/backend/p1-22-warranty.test.ts';
const WRS = 'tests/backend/p1-31-warranty-read-seam.test.ts';
const TPL = 'tests/backend/p1-31-delivery-checklist-template-seam.test.ts';
const CFG = 'tests/backend/p1-31-report-configuration-seam.test.ts';
const POL = 'tests/backend/p1-31-warranty-policy-seam.test.ts';
const EMP = 'tests/backend/p1-31-delivering-employee-seam.test.ts';
const CON = 'tests/backend/p1-31-concurrency-and-versioning.test.ts';
const P111 = 'tests/db/p1-11-isolation.test.ts';
const HARD = 'tests/db/shared-hardening.test.ts';

// ---------------------------------------------------------------------------
// The operation set, parsed
// ---------------------------------------------------------------------------

function routeFilesOf(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) routeFilesOf(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

const inPhaseNamespace = (relativePath: string): boolean =>
  P1_31_NAMESPACES.some(
    (namespace) => relativePath === namespace || relativePath.startsWith(`${namespace}/`)
  );

function parseOperationIds(): readonly string[] {
  const ids = new Set<string>();
  let malformed = 0;
  for (const absolute of routeFilesOf(API_V1)) {
    const relativePath = relative(API_V1, absolute).split(sep).join('/');
    if (!inPhaseNamespace(relativePath)) continue;
    const parsed = declaredPermissions(parseModule(readFileSync(absolute, 'utf8')));
    malformed += parsed.malformed.length;
    for (const reference of parsed.references) ids.add(String(reference.operation));
  }
  if (malformed > 0) throw new Error(`${String(malformed)} unreadable permission declaration(s)`);
  return [...ids].sort();
}

const OPERATION_IDS = parseOperationIds();

// ---------------------------------------------------------------------------
// Per-operation citations
// ---------------------------------------------------------------------------

const NA_NOT_GUARDED = 'not applicable — the operation is not version-guarded';
const NA_NOT_IDEM = 'not applicable — the operation is not idempotent';
const NA_NO_BODY = 'not applicable — the request carries no body';
const NA_READ = 'not applicable — a read carries no body to be invalid';
/** An operation SE-6 does not reach. The reason list is asserted in the suite itself. */
const NO_ROW = 'NO-ROW-TO-CROSS';
/** An operation SE-6 does reach, cited from the derived `it.each`. */
const SE6_ROW = 'SE-6';

interface Citations {
  /** 422 — an invalid request body, or the read's own path/query refusal. */
  readonly invalidBody: string;
  readonly missingIfMatch: string;
  readonly staleIfMatch: string;
  readonly replaySameKey: string;
  readonly replayDifferentBody: string;
  readonly crossTenant: string;
  /** The table the operation addresses, and its behavioural database negative. */
  readonly table: string;
  readonly databaseNegative: string;
}

function buildCitations(): Readonly<Record<string, Citations>> {
  const DB_SAL = cite('tests/db/sal-delivery.test.ts', 'none of a committed tenant-A handover');
  const DB_WTY = cite('tests/db/wty-warranty.test.ts', 'none of a committed tenant-A warranty');
  const DB_RPT = cite('tests/db/rpt-reporting.test.ts', 'none of a committed tenant-A definition');
  const DB_ORG = cite(
    'tests/db/org-employees.test.ts',
    'Tenant A cannot see an employee of Tenant B'
  );
  const SE6R = at(ESC, 'SE-6R rpt.report-run over');

  const read = (table: string, databaseNegative: string, crossTenant = SE6_ROW): Citations => ({
    invalidBody: NA_READ,
    missingIfMatch: NA_NOT_GUARDED,
    staleIfMatch: NA_NOT_GUARDED,
    replaySameKey: NA_NOT_IDEM,
    replayDifferentBody: NA_NOT_IDEM,
    crossTenant,
    table,
    databaseNegative,
  });

  return {
    'org.employee-create': {
      invalidBody: cite(EMP, 'P17-C8 refuses a user account that is not visible in this tenant'),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: cite(EMP, 'P17-C3 replays one idempotency key without creating a second'),
      replayDifferentBody: cite(EMP, 'P17-C4 refuses the same key with a DIFFERENT body'),
      crossTenant: SE6_ROW,
      table: 'org.employees',
      databaseNegative: DB_ORG,
    },
    'org.employee-detail': read('org.employees', DB_ORG),
    'org.employee-list': read('org.employees', DB_ORG),
    'org.employee-status-set': {
      invalidBody: cite(EMP, 'P17-S6 refuses a status the CHECK constraint does not admit'),
      missingIfMatch: cite(EMP, 'P17-S2 refuses a request with NO If-Match'),
      staleIfMatch: cite(EMP, 'P17-S3 refuses a STALE If-Match and burns no version'),
      replaySameKey: NA_NOT_IDEM,
      replayDifferentBody: NA_NOT_IDEM,
      crossTenant: SE6_ROW,
      table: 'org.employees',
      databaseNegative: DB_ORG,
    },
    'rpt.report-catalogue': read('rpt.report_configurations', DB_RPT, NO_ROW),
    'rpt.report-configuration-create': {
      invalidBody: cite(CFG, 'refuses a body that names id, status or ownerUserId'),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: cite(CFG, 'replays one idempotency key into one row and one audit record'),
      replayDifferentBody: cite(CFG, 'refuses the same key offered with a DIFFERENT body'),
      crossTenant: NO_ROW,
      table: 'rpt.report_configurations',
      databaseNegative: DB_RPT,
    },
    'rpt.report-configuration-list': {
      ...read('rpt.report_configurations', DB_RPT, NO_ROW),
      invalidBody: `${cite(CFG, 'refuses an unknown status filter and a malformed identifier')} (the unknown status filter)`,
    },
    'rpt.report-configuration-read': {
      ...read('rpt.report_configurations', DB_RPT),
      invalidBody: `${cite(CFG, 'refuses an unknown status filter and a malformed identifier')} (the malformed identifier)`,
    },
    'rpt.report-configuration-status-set': {
      invalidBody: cite(
        CFG,
        'refuses a status outside the schema vocabulary, and a stale If-Match'
      ),
      missingIfMatch: cite(CFG, 'refuses a status change with NO If-Match'),
      staleIfMatch: cite(
        CFG,
        'refuses a status outside the schema vocabulary, and a stale If-Match'
      ),
      replaySameKey: cite(CFG, 'replays one status key into one transition and one audit record'),
      replayDifferentBody: cite(CFG, 'refuses the same status key offered with a DIFFERENT status'),
      crossTenant: SE6_ROW,
      table: 'rpt.report_configurations',
      databaseNegative: DB_RPT,
    },
    'rpt.report-configuration-update': {
      invalidBody: cite(CFG, 'refuses an edit body that changes nothing'),
      missingIfMatch: cite(CFG, 'requires If-Match on the edit, refuses a stale one'),
      staleIfMatch: cite(CFG, 'requires If-Match on the edit, refuses a stale one'),
      replaySameKey: NA_NOT_IDEM,
      replayDifferentBody: NA_NOT_IDEM,
      crossTenant: SE6_ROW,
      table: 'rpt.report_configurations',
      databaseNegative: DB_RPT,
    },
    'rpt.report-configuration-version-create': {
      invalidBody: cite(CFG, 'bounds the parameter schema in shape and refuses what exceeds it'),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: cite(CFG, 'replays one version key into one version and one audit record'),
      replayDifferentBody: cite(CFG, 'refuses the same version key offered with a DIFFERENT'),
      crossTenant: SE6_ROW,
      table: 'rpt.report_configuration_versions',
      databaseNegative: DB_RPT,
    },
    'rpt.report-configuration-version-publish': {
      invalidBody: NA_NO_BODY,
      missingIfMatch: cite(CFG, 'publishes a draft under its own version counter'),
      staleIfMatch: cite(CFG, 'publishes a draft under its own version counter'),
      replaySameKey: NA_NOT_IDEM,
      replayDifferentBody: NA_NOT_IDEM,
      crossTenant: SE6_ROW,
      table: 'rpt.report_configuration_versions',
      databaseNegative: DB_RPT,
    },
    'rpt.report-read': read('rpt.report_configurations', DB_RPT),
    'rpt.report-export': {
      invalidBody: cite(
        'tests/backend/p1-31-report-engine-work-orders.test.ts',
        'rejects invalid export request fields before generating a file'
      ),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: NA_NOT_IDEM,
      replayDifferentBody: NA_NOT_IDEM,
      crossTenant: cite(
        'tests/backend/p1-31-report-engine-work-orders.test.ts',
        'refuses %s with no success audit'
      ),
      table: 'rpt.report_configurations',
      databaseNegative: DB_RPT,
    },
    'rpt.report-run': {
      ...read(
        'no rpt row of its own — the dataset reads wo, inv and sal',
        `${DB_RPT} for the definition; the ROWS are bounded by each source module’s own RLS`
      ),
      crossTenant: `\`${ESC}:${lineOf(SE6R)}\` (SE-6R: the rows, not the code — see the note below)`,
    },
    'sal.delivery-checklist-record': {
      invalidBody: cite(DLV, 'refuses a waiver with no reason AND a pass carrying a waiver reason'),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: cite(DLV, 'replays an idempotency key without writing a second result'),
      replayDifferentBody: cite(DLV, 'refuses the same key offered for a DIFFERENT item'),
      crossTenant: SE6_ROW,
      table: 'sal.delivery_checklist_results',
      databaseNegative: DB_SAL,
    },
    'sal.delivery-checklist-result-list': read('sal.delivery_checklist_results', DB_SAL),
    'sal.delivery-checklist-template-create': {
      invalidBody: cite(TPL, 'refuses a body that repeats an item code'),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: cite(TPL, 'replays an identical retry under one idempotency key'),
      replayDifferentBody: cite(TPL, 'refuses the same idempotency key offered with a DIFFERENT'),
      crossTenant: SE6_ROW,
      table: 'sal.delivery_checklist_templates',
      databaseNegative: DB_SAL,
    },
    'sal.delivery-checklist-template-item-create': {
      invalidBody: cite(TPL, 'refuses an item body the boundary schema does not admit'),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: cite(TPL, 'replays one item key into one item'),
      replayDifferentBody: cite(TPL, 'replays one item key into one item'),
      crossTenant: SE6_ROW,
      table: 'sal.delivery_checklist_template_items',
      databaseNegative: DB_SAL,
    },
    'sal.delivery-checklist-template-item-remove': {
      invalidBody: NA_NO_BODY,
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: NA_NOT_IDEM,
      replayDifferentBody: NA_NOT_IDEM,
      crossTenant: SE6_ROW,
      table: 'sal.delivery_checklist_template_items',
      databaseNegative: DB_SAL,
    },
    'sal.delivery-checklist-template-item-update': {
      invalidBody: cite(TPL, 'refuses an empty patch and an item that belongs to another template'),
      missingIfMatch: cite(TPL, 'refuses an item edit with NO If-Match'),
      staleIfMatch: cite(TPL, 'adds an item, edits only what was sent'),
      replaySameKey: NA_NOT_IDEM,
      replayDifferentBody: NA_NOT_IDEM,
      crossTenant: SE6_ROW,
      table: 'sal.delivery_checklist_template_items',
      databaseNegative: DB_SAL,
    },
    'sal.delivery-checklist-template-list': read(
      'sal.delivery_checklist_templates',
      DB_SAL,
      NO_ROW
    ),
    'sal.delivery-checklist-template-read': read('sal.delivery_checklist_templates', DB_SAL),
    'sal.delivery-checklist-template-rename': {
      invalidBody: cite(TPL, 'refuses a rename body the boundary schema does not admit'),
      missingIfMatch: cite(TPL, 'requires If-Match, refuses a stale one'),
      staleIfMatch: cite(TPL, 'requires If-Match, refuses a stale one'),
      replaySameKey: NA_NOT_IDEM,
      replayDifferentBody: NA_NOT_IDEM,
      crossTenant: SE6_ROW,
      table: 'sal.delivery_checklist_templates',
      databaseNegative: DB_SAL,
    },
    'sal.delivery-checklist-template-status-set': {
      invalidBody: cite(TPL, 'refuses a status the database would refuse'),
      missingIfMatch: cite(TPL, 'refuses a status flip with NO If-Match'),
      staleIfMatch: cite(TPL, 'refuses a status flip with NO If-Match'),
      replaySameKey: cite(TPL, 'retires and restores a template, and replays a retry'),
      replayDifferentBody: cite(TPL, 'refuses the same status key offered with a DIFFERENT body'),
      crossTenant: SE6_ROW,
      table: 'sal.delivery_checklist_templates',
      databaseNegative: DB_SAL,
    },
    'sal.delivery-complete': {
      invalidBody: cite(DLV, 'refuses an override with no reason'),
      missingIfMatch: cite(DLV, 'refuses a missing If-Match and a malformed odometer value'),
      staleIfMatch: cite(DLV, 'refuses a stale If-Match (stale-version)'),
      replaySameKey: cite(DLV, 'replays an idempotency key with no second event'),
      replayDifferentBody: cite(DLV, 'refuses the same key offered with a DIFFERENT odometer'),
      crossTenant: SE6_ROW,
      table: 'sal.delivery_records',
      databaseNegative: DB_SAL,
    },
    'sal.delivery-create': {
      invalidBody: cite(DLV, 'refuses a body that names vehicleId or receptionVisitId at all'),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: cite(DLV, 'replays an idempotency key without opening a second delivery'),
      replayDifferentBody: cite(DLV, 'refuses the same key offered for a DIFFERENT work order'),
      crossTenant: SE6_ROW,
      table: 'sal.delivery_records',
      databaseNegative: DB_SAL,
    },
    'sal.delivery-eligibility-read': {
      ...read('sal.delivery_records', DB_SAL),
      invalidBody: `${cite(DLV, 'refuses a malformed delivery id before reading anything')} (a malformed identifier)`,
    },
    'sal.delivery-list': read('sal.delivery_records', DB_SAL),
    'sal.delivery-read': read('sal.delivery_records', DB_SAL),
    'sal.delivery-readiness-list': read('sal.delivery_records', DB_SAL),
    'sal.delivery-receiver-read': read('sal.authorized_receivers', DB_SAL),
    'sal.delivery-receiver-verify': {
      invalidBody: cite(DLV, 'refuses a malformed body and an unknown field before writing'),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: cite(DLV, 'replays an idempotency key without recording a second receiver'),
      replayDifferentBody: cite(DLV, 'refuses the same key offered for a DIFFERENT receiver'),
      crossTenant: SE6_ROW,
      table: 'sal.authorized_receivers',
      databaseNegative: DB_SAL,
    },
    'sal.delivery-signature-attach': {
      invalidBody: cite(DLV, 'REJECTS a body carrying an extra signatureData field'),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: cite(DLV, 'replays an idempotency key without binding a second signature'),
      replayDifferentBody: cite(DLV, 'refuses the same key offered for a DIFFERENT signer role'),
      crossTenant: SE6_ROW,
      table: 'sal.delivery_signatures',
      databaseNegative: DB_SAL,
    },
    'sal.delivery-signature-list': read('sal.delivery_signatures', DB_SAL),
    'sal.delivery-status-history': read('sal.delivery_status_history', DB_SAL),
    'wty.warranty-coverage-create': {
      invalidBody: cite(POL, 'P10-A6 out-of-range terms are refused by the boundary'),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: cite(POL, 'P10-I2 a replayed coverage add returns the same row'),
      replayDifferentBody: cite(POL, 'P10-I4 the coverage add refuses its key offered with'),
      crossTenant: SE6_ROW,
      table: 'wty.warranty_coverage',
      databaseNegative: DB_WTY,
    },
    'wty.warranty-coverage-status-set': {
      invalidBody: cite(POL, 'P10-C7 the three remaining write bodies are bounded'),
      missingIfMatch: cite(POL, 'P10-C4 a coverage status without If-Match is refused'),
      staleIfMatch: cite(POL, 'P10-C3 the coverage If-Match is the COVERAGE version'),
      replaySameKey: NA_NOT_IDEM,
      replayDifferentBody: NA_NOT_IDEM,
      crossTenant: SE6_ROW,
      table: 'wty.warranty_coverage',
      databaseNegative: DB_WTY,
    },
    'wty.warranty-detail': {
      ...read('wty.warranty_records', DB_WTY),
      invalidBody: `${cite(WAR, 'refuses a malformed warranty id before reading anything')} (a malformed identifier)`,
    },
    'wty.warranty-generate': {
      invalidBody: cite(WAR, 'refuses to infer a policy when the company has more than one active'),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: cite(WAR, 'replays an idempotency key without issuing a second warranty'),
      replayDifferentBody: cite(WAR, 'refuses the same idempotency key with a different policy'),
      crossTenant: SE6_ROW,
      table: 'wty.warranty_records',
      databaseNegative: DB_WTY,
    },
    'wty.warranty-list': read('wty.warranty_records', DB_WTY),
    'wty.warranty-policy-create': {
      invalidBody: cite(POL, 'P10-A4 a body whose own two windows overlap is refused'),
      missingIfMatch: NA_NOT_GUARDED,
      staleIfMatch: NA_NOT_GUARDED,
      replaySameKey: cite(POL, 'P10-I1 a replayed create returns the same document'),
      replayDifferentBody: cite(POL, 'P10-I3 the create refuses its key offered with a DIFFERENT'),
      crossTenant: SE6_ROW,
      table: 'wty.warranty_policies',
      databaseNegative: DB_WTY,
    },
    'wty.warranty-policy-list': read('wty.warranty_policies', DB_WTY, NO_ROW),
    'wty.warranty-policy-read': read('wty.warranty_policies', DB_WTY),
    'wty.warranty-policy-rename': {
      invalidBody: cite(POL, 'P10-C7 the three remaining write bodies are bounded'),
      missingIfMatch: cite(POL, 'P10-C1 a rename without If-Match is refused'),
      staleIfMatch: cite(POL, 'P10-C2 a stale If-Match conflicts'),
      replaySameKey: NA_NOT_IDEM,
      replayDifferentBody: NA_NOT_IDEM,
      crossTenant: SE6_ROW,
      table: 'wty.warranty_policies',
      databaseNegative: DB_WTY,
    },
    'wty.warranty-policy-status-set': {
      invalidBody: cite(POL, 'P10-C7 the three remaining write bodies are bounded'),
      missingIfMatch: cite(POL, 'P10-C6 a policy status without If-Match is refused'),
      staleIfMatch: cite(POL, 'P10-C6 a policy status without If-Match is refused'),
      replaySameKey: cite(CON, 'C17-4 CONTROL: the idempotent sibling DOES reserve the key'),
      replayDifferentBody: cite(POL, 'P10-I5 the status flip refuses its key offered with'),
      crossTenant: SE6_ROW,
      table: 'wty.warranty_policies',
      databaseNegative: DB_WTY,
    },
    'wty.warranty-status-history': {
      ...read('wty.warranty_status_history', DB_WTY),
      invalidBody: `${cite(WRS, 'refuses a malformed cursor, an oversized page and a foreign cursor')} (the oversized page)`,
    },
  };
}

const CITATIONS = buildCitations();

/** The citation row for one operation. Absent is a thrown error, never an empty cell. */
function rowFor(id: string): Citations {
  const row = CITATIONS[id];
  if (!row) throw new Error(`no citation row for ${id}`);
  return row;
}

// ---------------------------------------------------------------------------
// The phase tables — Layer 1 of the isolation claim
// ---------------------------------------------------------------------------

const SAL_MIGRATION = '20260724094000_sal_delivery.sql';
const WTY_MIGRATION = '20260724095000_wty_warranty.sql';
const RPT_MIGRATION = '20260724096000_rpt_reporting.sql';

/** One case, named by the suite it lives in and the title it carries. */
interface CaseRef {
  readonly file: string;
  readonly title: string;
}

interface PhaseTable {
  readonly table: string;
  readonly migration: string;
  /** `structural: 'module'` reads the module-schema sweep instead of the sal/wty/rpt one. */
  readonly structural: 'schema' | 'module';
  /**
   * The behavioural read negative(s) for THIS table.
   *
   * Named per table rather than per schema, and every one is checked against the case's
   * own body: a case earns a citation only where it actually queries the table. The
   * first version of this file attributed by schema, so `p1-11-isolation.test.ts`'s
   * read negative — which queries `sal.invoices` and `rpt.report_configurations` and
   * nothing else — was cited for `rpt.report_configuration_versions` as well, a table
   * it never touches. That is the over-attribution a matrix of evidence exists to
   * prevent, committed by the document meant to prevent it.
   */
  readonly behavioural: readonly CaseRef[];
}

/**
 * The body of one case, from its `it(` line to the closing brace at the same depth.
 *
 * Used to CHECK an attribution rather than to make one: a citation is written by hand
 * above and then required to be about the table it claims.
 */
function caseBodyOf(file: string, title: string): string {
  const located = at(file, title);
  const lines = linesOf(file);
  const start = Number(lineOf(located)) - 1;
  const indent = /^\s*/.exec(lines[start] ?? '')?.[0].length ?? 0;
  const closing = new RegExp(`^\\s{0,${String(indent)}}\\}\\);\\s*$`);
  for (let end = start + 1; end < lines.length; end += 1) {
    if (closing.test(lines[end] ?? '')) return lines.slice(start, end + 1).join('\n');
  }
  throw new Error(`${file}: "${title}" has no closing brace`);
}

/** The four database suites that carry a behavioural cross-tenant read negative. */
const SAL_CASE: CaseRef = {
  file: 'tests/db/sal-delivery.test.ts',
  title: 'none of a committed tenant-A handover',
};
const WTY_CASE: CaseRef = {
  file: 'tests/db/wty-warranty.test.ts',
  title: 'none of a committed tenant-A warranty',
};
const RPT_CASE: CaseRef = {
  file: 'tests/db/rpt-reporting.test.ts',
  title: 'none of a committed tenant-A definition',
};
const ORG_CASE: CaseRef = {
  file: 'tests/db/org-employees.test.ts',
  title: 'Tenant A cannot see an employee of Tenant B',
};
const REVIEW_CASE: CaseRef = {
  file: 'tests/db/org-employees.test.ts',
  title: 'shows a runtime and a read-only session their own tenant row',
};
/**
 * P1-11's own read negative. It queries `sal.invoices` and `rpt.report_configurations`
 * and NOTHING else, so it is cited for that one `rpt` table and for no other.
 */
const P111_CASE: CaseRef = {
  file: 'tests/db/p1-11-isolation.test.ts',
  title: 'hides committed tenant-A rows from tenant B',
};

const PHASE_TABLES: readonly PhaseTable[] = Object.freeze([
  {
    table: 'sal.delivery_records',
    migration: SAL_MIGRATION,
    structural: 'schema',
    behavioural: [SAL_CASE],
  },
  {
    table: 'sal.authorized_receivers',
    migration: SAL_MIGRATION,
    structural: 'schema',
    behavioural: [SAL_CASE],
  },
  {
    table: 'sal.delivery_checklist_results',
    migration: SAL_MIGRATION,
    structural: 'schema',
    behavioural: [SAL_CASE],
  },
  {
    table: 'sal.delivery_signatures',
    migration: SAL_MIGRATION,
    structural: 'schema',
    behavioural: [SAL_CASE],
  },
  {
    table: 'sal.delivery_status_history',
    migration: SAL_MIGRATION,
    structural: 'schema',
    behavioural: [SAL_CASE],
  },
  {
    table: 'sal.delivery_checklist_templates',
    migration: SAL_MIGRATION,
    structural: 'schema',
    behavioural: [SAL_CASE],
  },
  {
    table: 'sal.delivery_checklist_template_items',
    migration: SAL_MIGRATION,
    structural: 'schema',
    behavioural: [SAL_CASE],
  },
  {
    table: 'sal.delivery_legacy_identity_review',
    migration: '20260910091000_sal_delivery_delivering_employee_identity.sql',
    structural: 'schema',
    behavioural: [REVIEW_CASE],
  },
  {
    table: 'wty.warranty_policies',
    migration: WTY_MIGRATION,
    structural: 'schema',
    behavioural: [WTY_CASE],
  },
  {
    table: 'wty.warranty_coverage',
    migration: WTY_MIGRATION,
    structural: 'schema',
    behavioural: [WTY_CASE],
  },
  {
    table: 'wty.warranty_records',
    migration: WTY_MIGRATION,
    structural: 'schema',
    behavioural: [WTY_CASE],
  },
  {
    table: 'wty.warranty_record_items',
    migration: WTY_MIGRATION,
    structural: 'schema',
    behavioural: [WTY_CASE],
  },
  {
    table: 'wty.warranty_status_history',
    migration: WTY_MIGRATION,
    structural: 'schema',
    behavioural: [WTY_CASE],
  },
  {
    table: 'rpt.report_configurations',
    migration: RPT_MIGRATION,
    structural: 'schema',
    behavioural: [RPT_CASE, P111_CASE],
  },
  {
    table: 'rpt.report_configuration_versions',
    migration: RPT_MIGRATION,
    structural: 'schema',
    behavioural: [RPT_CASE],
  },
  {
    table: 'org.employees',
    migration: '20260910090000_org_employees.sql',
    structural: 'module',
    behavioural: [ORG_CASE],
  },
]);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function prettify(markdown: string, filepath: string): Promise<string> {
  // Formatted with the repository's own Prettier configuration, because the committed
  // copies are tracked documents and `format:check` reads them like any other file.
  const options = await resolveConfig(filepath);
  return format(markdown, { ...options, filepath });
}

const applicable = (pick: (row: Citations) => string): number =>
  OPERATION_IDS.filter((id) => !pick(rowFor(id)).startsWith('not applicable')).length;

const covered = (pick: (row: Citations) => string): number =>
  OPERATION_IDS.filter((id) => pick(rowFor(id)).startsWith('`')).length;

const crossTenantApplicable = (): number =>
  OPERATION_IDS.filter((id) => rowFor(id).crossTenant !== NO_ROW).length;

async function renderErrorPathMatrix(): Promise<string> {
  const SE5 = cite(ESC, 'SE-5 $id refuses a caller holding every P1-31 code except its own');
  const SE6 = cite(ESC, 'SE-6 $id refuses a tenant-B caller holding all twelve codes');
  const SE6C = at(ESC, 'SE-6C $id reaches a real row for the tenant that owns it');
  const SE6R = at(ESC, 'SE-6R rpt.report-run over');
  const reasons = at(ESC, 'names a reason for every operation SE-6 and SE-7 do not reach');
  const structural = at(P111, 'forces RLS and a tenant/owner-scoped SELECT+INSERT policy');
  const spoof = at(P111, 'rejects a cross-tenant INSERT into every sal/wty/rpt table');
  const moduleSweep = at(HARD, 'enables and forces RLS on every module-schema table');
  const noRow = `not applicable — a tenant-wide list or a tenant-level create naming no row and no scope to cross with; the reason is itself asserted at \`${ESC}:${lineOf(reasons)}\``;

  const total = OPERATION_IDS.length;
  const lines: string[] = [];
  lines.push('# P1-31 error-path matrix');
  lines.push('');
  lines.push(
    'One row per P1-31 operation, one column per refusal the platform contract publishes.'
  );
  lines.push(
    'A cell carries the file and line of the case that covers it, or the word "not applicable"'
  );
  lines.push('with the reason. No cell says "covered" without a line.');
  lines.push('');
  lines.push(
    'GENERATED by `tests/ci/p1-31-error-path-matrix.test.ts`. Do not edit by hand — that test'
  );
  lines.push(
    'regenerates this file, resolves every citation from the case TITLE against the suite that'
  );
  lines.push('owns it, and fails on any difference.');
  lines.push('');
  lines.push('## How to read the columns');
  lines.push('');
  lines.push(
    `- **403** — the authority refusal. Every one of the ${String(total)} is covered by the same derived \`it.each\`, ${SE5}, whose case name is \`SE-5 <operation id>\`. The table does not repeat the citation per row.`
  );
  lines.push(
    '- **422** — an invalid request BODY, refused by the boundary schema before anything is written. A read carries no body, so the cell is "not applicable" unless the read validates a path parameter or a query value, in which case that case is cited instead.'
  );
  lines.push(
    '- **428 `ERR-CON-002`** — a version-guarded write with no `If-Match`. Only the 11 operations declaring `versionGuarded: true` have one.'
  );
  lines.push(
    '- **409 `ERR-CON-001`** — a version-guarded write carrying a stale `If-Match`. Same 11.'
  );
  lines.push(
    '- **replay same-key** — an identical retry under one `Idempotency-Key` answered with the stored document and executing nothing. Only the 16 operations declaring `idempotent: true` have one.'
  );
  lines.push(
    "- **replay different-body `ERR-INT-001`** — the SAME key offered with a different body, refused. The half a replay case cannot assert: a route storing the key alone passes the replay case and answers a second, different request with the first one's document."
  );
  lines.push(
    `- **cross-tenant** — a foreign tenant addressing this tenant's rows. Covered for ${String(crossTenantApplicable())} operations by ${SE6} (case name \`SE-6 <operation id>\`); its anti-vacuity control is \`${ESC}:${lineOf(SE6C)}\`. The five that name no row and no scope carry the reason instead, and the reason list is itself asserted at \`${ESC}:${lineOf(reasons)}\`.`
  );
  lines.push(
    `- **isolation (RLS)** — the DATABASE-layer proof that the row is hidden from another tenant, independent of the application. The structural half (RLS enabled and forced, a tenant-scoped SELECT and INSERT policy, a refused cross-tenant INSERT) is auto-enumerated over every \`sal\`, \`wty\` and \`rpt\` table by \`${P111}:${lineOf(structural)}\` and \`:${lineOf(spoof)}\`, and over every module schema by \`${HARD}:${lineOf(moduleSweep)}\`. The cell names the BEHAVIOURAL read negative for the table the operation addresses.`
  );
  lines.push('');
  lines.push('## The matrix');
  lines.push('');
  lines.push(
    '| Operation | 403 (SE-5) | 422 | 428 | 409 | replay same-key | replay different-body | cross-tenant (SE-6) | isolation (RLS) |'
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const id of OPERATION_IDS) {
    const row = rowFor(id);
    const cross =
      row.crossTenant === SE6_ROW ? SE6 : row.crossTenant === NO_ROW ? noRow : row.crossTenant;
    lines.push(
      `| \`${id}\` | ${SE5} | ${row.invalidBody} | ${row.missingIfMatch} | ${row.staleIfMatch} | ${row.replaySameKey} | ${row.replayDifferentBody} | ${cross} | ${row.databaseNegative} |`
    );
  }
  lines.push('');
  lines.push('## Notes on four cells that are not a plain citation');
  lines.push('');
  lines.push(
    `- \`rpt.report-run\` is addressed by a report CODE rather than by a row id, so the cross-tenant question is about the rows a run answers with rather than about reaching a record. \`${ESC}:${lineOf(SE6R)}\` (SE-6R) states both halves as OBSERVED behaviour: a tenant's own configuration code is not a runnable dataset and answers 404 to its own tenant, so that 404 carries no information about tenancy; a platform-registered dataset runs for both tenants and returns each caller's own rows, which for tenant B is none.`
  );
  lines.push(
    `- \`sal.delivery-checklist-template-item-create\` cites one case for both replay columns: ${cite(TPL, 'replays one item key into one item')} asserts the identical retry and the different-body refusal in sequence, because the second only means anything against a reservation the first established.`
  );
  lines.push(
    `- \`wty.warranty-policy-status-set\` takes its replay case from ${cite(CON, 'C17-4 CONTROL: the idempotent sibling DOES reserve the key')}, where it is the CONTROL that makes CC-17's "this sibling does not reserve" claim falsifiable. It is a replay of this operation either way, and duplicating it here would add a second copy of the same claim.`
  );
  lines.push(
    `- \`wty.warranty-status-history\` is the 46th operation, published by P-18 (§ 65). It is a GET, so five columns are inapplicable by declaration. Its 422 is the oversized page rather than a body, and beyond the SE-6 row its own seam pins the tenant boundary directly at ${cite(WRS, 'answers a foreign tenant ERR-RES-001 for a real id and for an invented one')} — 404 \`ERR-RES-001\` for a real id and for an invented one alike, so a foreign tenant cannot tell them apart.`
  );
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push('| Column | Applicable operations | Covered | Uncovered |');
  lines.push('| --- | --- | --- | --- |');
  const countRow = (label: string, pick: (row: Citations) => string): void => {
    const a = applicable(pick);
    const c = covered(pick);
    lines.push(`| ${label} | ${String(a)} | ${String(c)} | ${String(a - c)} |`);
  };
  lines.push(`| 403 | ${String(total)} | ${String(total)} | 0 |`);
  countRow('422', (row) => row.invalidBody);
  countRow('428', (row) => row.missingIfMatch);
  countRow('409', (row) => row.staleIfMatch);
  countRow('replay same-key', (row) => row.replaySameKey);
  countRow('replay different-body', (row) => row.replayDifferentBody);
  lines.push(
    `| cross-tenant | ${String(crossTenantApplicable())} | ${String(crossTenantApplicable())} | 0 |`
  );
  lines.push(`| isolation (RLS) | ${String(total)} | ${String(total)} | 0 |`);
  lines.push('');
  lines.push(
    'Every applicable cell carries a line. The uncovered count is zero in every column, which is the claim P1-31-QA-002 makes and this file is the evidence for.'
  );
  lines.push('');
  return prettify(lines.join('\n'), ERROR_PATH_MATRIX);
}

async function renderIsolationMatrix(): Promise<string> {
  const SE6 = cite(ESC, 'SE-6 $id refuses a tenant-B caller holding all twelve codes');
  const SE6C = at(ESC, 'SE-6C $id reaches a real row for the tenant that owns it');
  const SE6R = at(ESC, 'SE-6R rpt.report-run over');
  const reasons = at(ESC, 'names a reason for every operation SE-6 and SE-7 do not reach');
  const structural = `\`${P111}:${lineOf(at(P111, 'forces RLS and a tenant/owner-scoped SELECT+INSERT policy'))}\``;
  const spoof = at(P111, 'rejects a cross-tenant INSERT into every sal/wty/rpt table');
  const p111Read = at(P111, 'hides committed tenant-A rows from tenant B');
  const moduleSweep = `\`${HARD}:${lineOf(at(HARD, 'enables and forces RLS on every module-schema table'))}\``;

  const DB_SAL = cite('tests/db/sal-delivery.test.ts', 'none of a committed tenant-A handover');
  const DB_WTY = cite('tests/db/wty-warranty.test.ts', 'none of a committed tenant-A warranty');
  const DB_RPT = cite('tests/db/rpt-reporting.test.ts', 'none of a committed tenant-A definition');
  const DB_ORG = cite(
    'tests/db/org-employees.test.ts',
    'Tenant A cannot see an employee of Tenant B'
  );
  const behaviouralOf = (entry: PhaseTable): string =>
    entry.behavioural.map((ref) => cite(ref.file, ref.title)).join(', and ');

  const total = OPERATION_IDS.length;
  const noRow = 'not applicable — names no row and no scope to cross with';
  const lines: string[] = [];
  lines.push('# P1-31 two-layer isolation matrix');
  lines.push('');
  lines.push(
    'GENERATED by `tests/ci/p1-31-error-path-matrix.test.ts`, which renders this file and the'
  );
  lines.push('error-path matrix from the same sources and fails on any difference.');
  lines.push('');
  lines.push('P1-31-QA-003 claims that a tenant cannot reach another tenant’s delivery, warranty,');
  lines.push('report-definition or employee rows, and that the claim holds at BOTH layers: the');
  lines.push(
    'application refuses the request, and the database would hide the row from the request'
  );
  lines.push('even if the application did not. The two are separate proofs because they fail');
  lines.push(
    'separately — an application filter is a WHERE clause somebody can forget, and a policy'
  );
  lines.push('that exists is not a policy that hides.');
  lines.push('');
  lines.push('## Layer 1 — the database');
  lines.push('');
  lines.push('Each P1-31 table, the migration that created it, and the two proofs it owes.');
  lines.push('');
  lines.push(
    '**Structural** — row-level security enabled AND forced, with a tenant-scoped SELECT and'
  );
  lines.push('INSERT policy. Auto-enumerated from `information_schema`, so a new table without');
  lines.push('coverage fails the suite rather than passing unnoticed.');
  lines.push('');
  lines.push('**Behavioural read negative** — a COMMITTED row of tenant A, addressed by id from a');
  lines.push(
    'tenant-B session and from a session with no context, answers with nothing and updates'
  );
  lines.push(
    'nothing. Committed rather than in-transaction, because a row inside the writer’s own'
  );
  lines.push('transaction is invisible to a second session for a reason unrelated to tenancy.');
  lines.push('');
  lines.push(
    `A cross-tenant INSERT is refused on every \`sal\`, \`wty\` and \`rpt\` table by \`${P111}:${lineOf(spoof)}\`, which is auto-enumerated in the same way; it is not repeated per row below.`
  );
  lines.push('');
  lines.push('| Table | Migration | Structural | Behavioural read negative |');
  lines.push('| --- | --- | --- | --- |');
  for (const entry of PHASE_TABLES) {
    const structuralCell = entry.structural === 'module' ? moduleSweep : structural;
    lines.push(
      `| \`${entry.table}\` | \`supabase/migrations/${entry.migration}\` | ${structuralCell} | ${behaviouralOf(entry)} |`
    );
  }
  lines.push('');
  lines.push('## Layer 2 — the application');
  lines.push('');
  lines.push(
    'Per operation, the case that refuses a foreign tenant at the route, and the table its'
  );
  lines.push('refusal is about.');
  lines.push('');
  lines.push(
    `${String(crossTenantApplicable())} of the ${String(total)} are covered by one derived \`it.each\`, ${SE6}, whose case name is \`SE-6 <operation id>\`; its anti-vacuity control is \`${ESC}:${lineOf(SE6C)}\` (\`SE-6C\`), which re-issues the same request as the OWNING tenant against an equivalent row set and requires the refusal not to appear. Without that control a 404 would be equally consistent with the row never having existed.`
  );
  lines.push('');
  lines.push(
    `The five that carry no application-layer refusal are named below with the reason, and the reason list is itself asserted at \`${ESC}:${lineOf(reasons)}\`: a tenant-wide list and a tenant-level create name no row and no scope to cross with, so there is nothing for a foreign tenant to address. Their database layer still hides the rows, which is why the table column is filled for them all the same.`
  );
  lines.push('');
  lines.push('| Operation | Table it addresses | Application refusal | Database negative |');
  lines.push('| --- | --- | --- | --- |');
  for (const id of OPERATION_IDS) {
    const row = rowFor(id);
    const application = row.crossTenant === NO_ROW ? noRow : SE6;
    const database =
      id === 'rpt.report-run'
        ? `the source modules’ own RLS; the row-level answer is stated at \`${ESC}:${lineOf(SE6R)}\``
        : row.databaseNegative;
    lines.push(`| \`${id}\` | \`${row.table}\` | ${application} | ${database} |`);
  }
  lines.push('');
  lines.push('## What changed in this slice, and what was corrected');
  lines.push('');
  lines.push(
    `- \`tests/db/sal-delivery.test.ts\` and \`tests/db/wty-warranty.test.ts\` are CONSTRAINT suites. Every case in them ran as tenant A inside a rolled-back transaction and neither drove a cross-tenant negative of any kind. An index entry that read them as isolation evidence was reading the fixture tenant and not an assertion. Both now carry one — ${DB_SAL} and ${DB_WTY} — and the correction to the index is recorded in the change-control register rather than applied here, because the final integration owns that document.`
  );
  lines.push(
    `- \`rpt.report_configuration_versions\` had no read negative anywhere. ${DB_RPT} adds one, alongside the \`rpt.report_configurations\` negative \`${P111}:${lineOf(p111Read)}\` already carried.`
  );
  lines.push(
    `- \`org.employees\` was already proved at both layers before this slice — structurally at ${moduleSweep} and behaviourally at ${DB_ORG} — and is listed here for completeness rather than because anything was added.`
  );
  lines.push(
    `- \`wty.warranty_status_history\` gained its first READER in the same closure queue: \`wty.warranty-status-history\`, the 46th operation (P-18, § 65). The table was already inside this matrix's Layer 1 — the behavioural negative ${DB_WTY} enumerates it — so publishing the operation added a Layer 2 row and moved no Layer 1 proof.`
  );
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push('| Measure | Count |');
  lines.push('| --- | --- |');
  lines.push(`| P1-31 tables | ${String(PHASE_TABLES.length)} |`);
  lines.push(`| tables with a structural proof | ${String(PHASE_TABLES.length)} |`);
  lines.push(`| tables with a behavioural read negative | ${String(PHASE_TABLES.length)} |`);
  lines.push(`| operations | ${String(total)} |`);
  lines.push(
    `| operations with an application-layer refusal | ${String(crossTenantApplicable())} |`
  );
  lines.push(
    `| operations with a stated reason instead | ${String(total - crossTenantApplicable())} |`
  );
  lines.push('');
  return prettify(lines.join('\n'), ISOLATION_MATRIX);
}

const committed = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('P1-31-QA-002 / QA-003 the two matrices', () => {
  it('covers the parsed operation set exactly — no extra row, no missing one', () => {
    expect(OPERATION_IDS).toHaveLength(EXPECTED_OPERATIONS);
    expect(Object.keys(CITATIONS).sort()).toEqual([...OPERATION_IDS]);
    // And the phase's own schema, which a route parse cannot yield.
    expect(PHASE_TABLES).toHaveLength(EXPECTED_TABLES);
    expect(new Set(PHASE_TABLES.map((entry) => entry.table)).size).toBe(EXPECTED_TABLES);
    // Every table an operation addresses is one of them, apart from the one operation
    // that addresses no row of its own.
    const named = new Set(PHASE_TABLES.map((entry) => entry.table));
    const unknown = OPERATION_IDS.map((id) => rowFor(id).table).filter(
      (table) => !named.has(table) && !table.startsWith('no rpt row')
    );
    expect(unknown).toEqual([]);
  });

  it('cites a database case for a table only where that case queries the table', () => {
    /*
     * The check the first version of this file did not have. Attribution was by SCHEMA,
     * so `p1-11-isolation.test.ts`'s read negative — which queries `sal.invoices` and
     * `rpt.report_configurations` and nothing else — was cited for
     * `rpt.report_configuration_versions` too, a table it never touches. A citation that
     * names a case which does not assert on the row is worse than a blank cell: it reads
     * as evidence and is not.
     *
     * So every Layer-1 citation is read back out of the cited case's own BODY. The
     * mapping above is written by hand, because which case covers which table is a
     * judgement; whether the case is about that table is not, and that half is measured.
     */
    for (const entry of PHASE_TABLES) {
      expect({ table: entry.table, cases: entry.behavioural.length }).toEqual({
        table: entry.table,
        cases: entry.behavioural.length,
      });
      expect(entry.behavioural.length).toBeGreaterThan(0);
      for (const ref of entry.behavioural) {
        const body = caseBodyOf(ref.file, ref.title);
        expect({
          table: entry.table,
          case: ref.title,
          queries: body.includes(entry.table),
        }).toEqual({ table: entry.table, case: ref.title, queries: true });
      }
    }

    // And the falsifier: the case that used to be over-attributed does NOT name the
    // table it was cited for, so the check above would have caught it.
    const p111 = caseBodyOf(P111_CASE.file, P111_CASE.title);
    expect(p111.includes('rpt.report_configurations')).toBe(true);
    expect(p111.includes('rpt.report_configuration_versions')).toBe(false);
  });

  it('refuses a citation that resolves to no line or to more than one', () => {
    // The guarantee every cell rests on, exercised rather than described: `at` throws
    // both ways round. Without this the resolver could quietly return a first match and
    // the matrices would cite a line that means something else.
    expect(() => at(ESC, 'a case title no suite in this repository carries')).toThrow(
      /matched 0 line\(s\)/
    );
    // The ambiguous half, counted rather than pattern-matched: `'SE-` is the prefix of
    // every probe case name in that suite, so it names many and must name none.
    const ambiguous = ((): number => {
      try {
        at(ESC, "'SE-");
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        return Number(/matched (\d+) line\(s\)/.exec(message)?.[1] ?? '-1');
      }
      return 0;
    })();
    expect(ambiguous).toBeGreaterThan(1);
  });

  it('has both committed documents to compare against, and neither is trivial', () => {
    // A generator that agrees with a missing or empty file reports agreement for the
    // wrong reason. Both documents must exist, and each must carry one table row per
    // operation, before either comparison below can mean anything.
    for (const path of [ERROR_PATH_MATRIX, ISOLATION_MATRIX]) {
      expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
    }
    for (const path of [ERROR_PATH_MATRIX, ISOLATION_MATRIX]) {
      const rows = committed(path)
        .split('\n')
        .filter((line) => OPERATION_IDS.some((id) => line.startsWith(`| \`${id}\``)));
      expect({ path, rows: rows.length }).toEqual({ path, rows: EXPECTED_OPERATIONS });
    }
  });

  it('matches the committed error-path matrix exactly', async () => {
    const rendered = await renderErrorPathMatrix();
    if (process.env.P1_31_MATRIX_WRITE === '1') {
      writeFileSync(ERROR_PATH_MATRIX, rendered, 'utf8');
      // Never green under the flag: a pass here would be the generator agreeing with
      // what it has just written.
      expect.fail('documents regenerated; re-run without the flag');
    }
    expect(committed(ERROR_PATH_MATRIX)).toBe(rendered);
  });

  it('matches the committed isolation matrix exactly', async () => {
    const rendered = await renderIsolationMatrix();
    if (process.env.P1_31_MATRIX_WRITE === '1') {
      writeFileSync(ISOLATION_MATRIX, rendered, 'utf8');
      expect.fail('documents regenerated; re-run without the flag');
    }
    expect(committed(ISOLATION_MATRIX)).toBe(rendered);
  });
});
