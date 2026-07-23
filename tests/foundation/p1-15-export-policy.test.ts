/**
 * Phase 1-15 unit suite: the export authorization policy.
 *
 * Bulk export is the highest-leverage read on the platform — one authorized call
 * can remove more data than a thousand screen reads — so the decisions that
 * bound it are made before any row is fetched and are proven here, without a
 * database. What is asserted is the *policy*: which resources exist, which
 * columns they may ever emit, what an empty field request means, and what
 * happens to a field the caller is not entitled to.
 *
 * Three claims carry most of the weight:
 *
 *  - **Omitting the field list must not widen the export.** A caller without
 *    `iam.sensitive.view` who sends no field list gets the non-sensitive columns,
 *    not the full column set. The opposite default would hand out restricted
 *    columns for leaving a parameter blank.
 *  - **A column that is not registered is not exportable.** That is how
 *    `storage_key`, `sha256`, `body_sha256`, `recipient_digest` and every column
 *    of `shared.file_scan_results` stay out of every export without a special
 *    case. The registry is asserted against a reviewed literal list so a new
 *    exportable column cannot appear without someone editing this file.
 *  - **Formula risk is a named, testable property.** P1-15 writes no file, so it
 *    cannot neutralise a `=`-leading cell; what it can do is publish one
 *    definition of "risky" that the eventual writer calls, and record which
 *    registered fields are free text.
 *
 * The database-side half of the contract — that every registered column actually
 * exists in protected schema — belongs to the database tier and is not attempted
 * here; this file deliberately makes no claim about the live schema.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPORT_PERMISSION,
  EXPORT_RESOURCES,
  SENSITIVE_FIELD_PERMISSION,
  findExportResource,
  formulaRiskyFields,
  isFormulaRiskyCell,
  resolveExportFields,
  type ExportResource,
} from '@/modules/shared-services/domain/export-policy';

const NO_PERMISSIONS: ReadonlySet<string> = new Set<string>();
const MAY_SEE_SENSITIVE: ReadonlySet<string> = new Set<string>([SENSITIVE_FIELD_PERMISSION]);

function requireResource(code: string): ExportResource {
  const resource = findExportResource(code);
  if (!resource) throw new Error(`Export resource "${code}" is not registered`);
  return resource;
}

const names = (fields: readonly { readonly name: string }[]): string[] =>
  fields.map((entry) => entry.name);

/**
 * The reviewed export surface, written out rather than derived.
 *
 * Deriving it from `EXPORT_RESOURCES` would assert nothing: a column added to
 * the registry would silently become "expected". Written out, adding an
 * exportable column requires editing a test, which is the review step.
 */
const REVIEWED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  documents: [
    'id',
    'title',
    'classification',
    'retentionClass',
    'status',
    'legalHold',
    'companyId',
    'branchId',
    'createdAt',
  ],
  outbound_messages: [
    'id',
    'channel',
    'purpose',
    'status',
    'retryCount',
    'failureClass',
    'queuedAt',
    'sentAt',
    'deliveredAt',
    'createdAt',
    'recipientUserId',
    'dedupeKey',
  ],
  branches: [
    'id',
    'branchCode',
    'name',
    'city',
    'countryCode',
    'timezoneName',
    'status',
    'companyId',
  ],
};

/** Free-text fields per resource, likewise written out rather than derived. */
const REVIEWED_FREE_TEXT: Readonly<Record<string, readonly string[]>> = {
  documents: ['title'],
  outbound_messages: ['dedupeKey'],
  branches: ['name', 'city'],
};

describe('export resource registry', () => {
  it('registers every resource with fields, a tenant column, a permission, and filters', () => {
    expect(EXPORT_RESOURCES.length).toBeGreaterThan(0);

    for (const resource of EXPORT_RESOURCES) {
      expect(resource.code).not.toBe('');
      expect(resource.table).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(resource.fields.length).toBeGreaterThan(0);
      expect(resource.tenantColumn).not.toBe('');
      expect(resource.permission).not.toBe('');
      // Without a filterable field the only possible export is "the whole
      // table", which is the shape the row bound exists to prevent.
      expect(resource.filterable.length).toBeGreaterThan(0);
      expect(resource.description.length).toBeGreaterThan(0);
      expect(['tenant', 'company', 'branch']).toContain(resource.scope);
      // A duplicate field name would make `resolveExportFields` resolve by
      // whichever entry happens to come first.
      expect(new Set(names(resource.fields)).size).toBe(resource.fields.length);
    }

    // Codes are the caller-facing handle; two resources sharing one would make
    // `findExportResource` non-deterministic from the caller's point of view.
    const codes = EXPORT_RESOURCES.map((resource) => resource.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('exposes exactly the reviewed field list for each resource', () => {
    expect(EXPORT_RESOURCES.map((resource) => resource.code).sort()).toEqual(
      Object.keys(REVIEWED_FIELDS).sort()
    );

    for (const resource of EXPORT_RESOURCES) {
      expect(names(resource.fields)).toEqual(REVIEWED_FIELDS[resource.code]);
    }
  });

  it('requires a resource permission distinct from the platform-wide export permission', () => {
    expect(EXPORT_PERMISSION).toBe('rpt.export');
    expect(SENSITIVE_FIELD_PERMISSION).toBe('iam.sensitive.view');
    expect(EXPORT_PERMISSION).not.toBe(SENSITIVE_FIELD_PERMISSION);

    for (const resource of EXPORT_RESOURCES) {
      // "as well as", not "instead of": if a resource permission were
      // `rpt.export`, revoking export would also revoke the operational grant,
      // and holding the operational grant would imply export.
      expect(resource.permission).not.toBe(EXPORT_PERMISSION);
      expect(resource.permission).not.toBe(SENSITIVE_FIELD_PERMISSION);
    }
  });

  it('offers only registered, non-sensitive, non-free-text fields as filters', () => {
    for (const resource of EXPORT_RESOURCES) {
      for (const filterable of resource.filterable) {
        const field = resource.fields.find((entry) => entry.name === filterable.name);
        // A filter on an unexported column is a read oracle over data the
        // caller cannot even see in the output.
        expect(field, `${resource.code}.${filterable.name} is not an exported field`).toBeDefined();
        expect(field?.column).toBe(filterable.column);
        expect(field?.sensitive).toBe(false);
        // A prefix filter on free text reads the value character by character.
        expect(field?.freeText).toBe(false);
        expect(filterable.operators.length).toBeGreaterThan(0);
      }
    }
  });

  it('resolves a registered code and returns undefined for an unregistered one', () => {
    expect(findExportResource('documents')?.table).toBe('shared.documents');
    expect(findExportResource('fx_not_a_resource')).toBeUndefined();
    // Not a near-miss either: the lookup is exact, not fuzzy or prefix-based.
    expect(findExportResource('document')).toBeUndefined();
    expect(findExportResource('')).toBeUndefined();
  });
});

describe('resolveExportFields with an empty request', () => {
  it('returns every non-sensitive field for a caller without iam.sensitive.view', () => {
    // Non-vacuous: at least one registered resource must actually have a
    // sensitive field, or this proves nothing.
    expect(
      EXPORT_RESOURCES.some((resource) => resource.fields.some((entry) => entry.sensitive))
    ).toBe(true);

    for (const resource of EXPORT_RESOURCES) {
      const decision = resolveExportFields(resource, [], NO_PERMISSIONS);
      expect(decision.unknown).toEqual([]);
      // Omitting the field list is not a denial: nothing is reported as denied,
      // the sensitive columns are simply not part of the default projection.
      expect(decision.denied).toEqual([]);
      expect(decision.resolved.every((entry) => !entry.sensitive)).toBe(true);
      expect(names(decision.resolved)).toEqual(
        names(resource.fields.filter((entry) => !entry.sensitive))
      );
    }

    // Written-out expectation for the one resource that has sensitive fields.
    const messages = requireResource('outbound_messages');
    expect(names(resolveExportFields(messages, [], NO_PERMISSIONS).resolved)).toEqual([
      'id',
      'channel',
      'purpose',
      'status',
      'retryCount',
      'failureClass',
      'queuedAt',
      'sentAt',
      'deliveredAt',
      'createdAt',
    ]);
  });

  it('returns every field, sensitive ones included, for a caller with iam.sensitive.view', () => {
    for (const resource of EXPORT_RESOURCES) {
      const decision = resolveExportFields(resource, [], MAY_SEE_SENSITIVE);
      expect(names(decision.resolved)).toEqual(names(resource.fields));
      expect(decision.unknown).toEqual([]);
      expect(decision.denied).toEqual([]);
    }

    const messages = requireResource('outbound_messages');
    const resolved = names(resolveExportFields(messages, [], MAY_SEE_SENSITIVE).resolved);
    expect(resolved).toContain('recipientUserId');
    expect(resolved).toContain('dedupeKey');
    expect(resolved).toEqual(REVIEWED_FIELDS['outbound_messages']);
  });

  it('reads the sensitive permission only, ignoring unrelated grants', () => {
    const messages = requireResource('outbound_messages');
    // Holding the resource permission and the export permission is not enough:
    // the sensitive columns need the sensitive grant specifically.
    const operational: ReadonlySet<string> = new Set<string>([
      EXPORT_PERMISSION,
      messages.permission,
      'iam.user.manage',
    ]);
    const resolved = names(resolveExportFields(messages, [], operational).resolved);
    expect(resolved).not.toContain('recipientUserId');
    expect(resolved).not.toContain('dedupeKey');
  });
});

describe('resolveExportFields with an explicit request', () => {
  it('places an unregistered field name in `unknown` and never in `resolved`', () => {
    const documents = requireResource('documents');
    // `storage_key` is the column this policy exists to keep out; asking for it
    // by either spelling must be a miss, not a resolution.
    const decision = resolveExportFields(
      documents,
      ['title', 'storage_key', 'storageKey', 'fx_no_such_field'],
      MAY_SEE_SENSITIVE
    );

    expect(names(decision.resolved)).toEqual(['title']);
    expect(decision.unknown).toEqual(['storage_key', 'storageKey', 'fx_no_such_field']);
    expect(decision.denied).toEqual([]);
  });

  it('places a requested sensitive field in `denied` without iam.sensitive.view', () => {
    const messages = requireResource('outbound_messages');
    const decision = resolveExportFields(
      messages,
      ['status', 'recipientUserId', 'dedupeKey'],
      NO_PERMISSIONS
    );

    // Denied, not silently dropped: the caller learns the column was withheld
    // rather than receiving a narrower file that looks complete.
    expect(decision.denied).toEqual(['recipientUserId', 'dedupeKey']);
    expect(names(decision.resolved)).toEqual(['status']);
    expect(decision.unknown).toEqual([]);
  });

  it('resolves the same sensitive fields for a caller with iam.sensitive.view', () => {
    const messages = requireResource('outbound_messages');
    const decision = resolveExportFields(
      messages,
      ['status', 'recipientUserId', 'dedupeKey'],
      MAY_SEE_SENSITIVE
    );

    expect(names(decision.resolved)).toEqual(['status', 'recipientUserId', 'dedupeKey']);
    expect(decision.denied).toEqual([]);
    expect(decision.unknown).toEqual([]);
  });

  it('classifies a mixed request field by field rather than failing whole', () => {
    const messages = requireResource('outbound_messages');
    const decision = resolveExportFields(
      messages,
      ['id', 'dedupeKey', 'fx_unknown_field', 'channel'],
      NO_PERMISSIONS
    );

    expect(names(decision.resolved)).toEqual(['id', 'channel']);
    expect(decision.denied).toEqual(['dedupeKey']);
    expect(decision.unknown).toEqual(['fx_unknown_field']);
    // The three buckets are disjoint: no name is both resolved and withheld.
    const resolvedNames = new Set(names(decision.resolved));
    for (const name of [...decision.denied, ...decision.unknown]) {
      expect(resolvedNames.has(name)).toBe(false);
    }
  });

  it('withholds every sensitive field of every resource when all fields are requested', () => {
    for (const resource of EXPORT_RESOURCES) {
      const decision = resolveExportFields(resource, names(resource.fields), NO_PERMISSIONS);
      expect(decision.denied).toEqual(names(resource.fields.filter((entry) => entry.sensitive)));
      expect(decision.resolved.some((entry) => entry.sensitive)).toBe(false);
      expect(decision.unknown).toEqual([]);
    }
  });
});

describe('columns that must never be exportable', () => {
  /**
   * Locators and integrity values. Each travels outside RLS the moment it is
   * written to a file, and none is business data.
   */
  const FORBIDDEN = [
    'storage_key',
    'storageKey',
    'sha256',
    'body_sha256',
    'bodySha256',
    'recipient_digest',
    'recipientDigest',
  ];

  /**
   * Columns unique to `shared.file_scan_results`.
   *
   * Its generic columns (`id`, `tenant_id`, `created_at`, `created_by`) are
   * deliberately not listed: they are shared with every other table, so
   * asserting their absence would assert nothing about scan results. The table
   * itself being unregistered is what closes that gap, and is asserted below.
   */
  const FILE_SCAN_ONLY = [
    'version_id',
    'versionId',
    'scan_status',
    'scanStatus',
    'scanner_code',
    'scannerCode',
    'threat_name',
    'threatName',
    'scanned_at',
    'scannedAt',
  ];

  it('never registers a storage key, an integrity hash, or a recipient digest', () => {
    for (const resource of EXPORT_RESOURCES) {
      for (const forbidden of FORBIDDEN) {
        expect(names(resource.fields), `${resource.code} fields`).not.toContain(forbidden);
        expect(
          resource.fields.map((entry) => entry.column),
          `${resource.code} columns`
        ).not.toContain(forbidden);
        // Filtering on a withheld column is a read oracle over it, so the
        // filter list has to be clean as well as the field list.
        expect(
          resource.filterable.map((entry) => entry.column),
          `${resource.code} filter columns`
        ).not.toContain(forbidden);
      }
    }

    // Non-vacuous: prove the request path treats these as unregistered too,
    // rather than the names merely being absent from a list nobody consults.
    const documents = requireResource('documents');
    expect(resolveExportFields(documents, ['storage_key'], MAY_SEE_SENSITIVE).unknown).toEqual([
      'storage_key',
    ]);
  });

  it('never registers a resource or a field belonging to shared.file_scan_results', () => {
    for (const resource of EXPORT_RESOURCES) {
      expect(resource.table).not.toBe('shared.file_scan_results');
      expect(resource.table).not.toContain('file_scan_results');

      for (const column of FILE_SCAN_ONLY) {
        expect(names(resource.fields), `${resource.code} fields`).not.toContain(column);
        expect(
          resource.fields.map((entry) => entry.column),
          `${resource.code} columns`
        ).not.toContain(column);
        expect(
          resource.filterable.map((entry) => entry.column),
          `${resource.code} filter columns`
        ).not.toContain(column);
      }
    }

    expect(findExportResource('file_scan_results')).toBeUndefined();
    expect(findExportResource('scan_results')).toBeUndefined();
  });
});

describe('formulaRiskyFields', () => {
  it('returns exactly the free-text fields of each resource', () => {
    for (const resource of EXPORT_RESOURCES) {
      const expected = REVIEWED_FREE_TEXT[resource.code];
      expect(expected, `${resource.code} has no reviewed free-text list`).toBeDefined();
      expect(formulaRiskyFields(resource)).toEqual(expected);

      // Every non-free-text field is absent, and every reported name is real.
      for (const name of formulaRiskyFields(resource)) {
        expect(resource.fields.find((entry) => entry.name === name)?.freeText).toBe(true);
      }
    }

    expect(formulaRiskyFields(requireResource('documents'))).toEqual(['title']);
    expect(formulaRiskyFields(requireResource('branches'))).toEqual(['name', 'city']);
  });

  it('reports a field that is both sensitive and free text', () => {
    // `dedupeKey` needs `iam.sensitive.view` to be exported at all — that is an
    // authorization decision and does not exempt the value from neutralisation
    // once an entitled caller does export it.
    const messages = requireResource('outbound_messages');
    expect(formulaRiskyFields(messages)).toEqual(['dedupeKey']);
    expect(messages.fields.find((entry) => entry.name === 'dedupeKey')?.sensitive).toBe(true);
  });
});

describe('isFormulaRiskyCell', () => {
  // Built, never typed: a raw tab or CR in a source literal is invisible in
  // review and the first reformatting run would eat it.
  const TAB = String.fromCharCode(9);
  const CR = String.fromCharCode(13);

  it('flags every leading character spreadsheet software treats as a formula', () => {
    expect(isFormulaRiskyCell('=1+1')).toBe(true);
    expect(isFormulaRiskyCell("=cmd|' /c calc'!A1")).toBe(true);
    expect(isFormulaRiskyCell('+44 7700 900000')).toBe(true);
    expect(isFormulaRiskyCell('-12.50')).toBe(true);
    expect(isFormulaRiskyCell('@SUM(A1:A9)')).toBe(true);
    expect(isFormulaRiskyCell(`${TAB}=1+1`)).toBe(true);
    expect(isFormulaRiskyCell(`${CR}=1+1`)).toBe(true);
    // The leading character alone is enough; no payload is required.
    expect(isFormulaRiskyCell('=')).toBe(true);
    expect(isFormulaRiskyCell(TAB)).toBe(true);
    expect(isFormulaRiskyCell(CR)).toBe(true);
  });

  it('accepts ordinary text, including risky characters that are not leading', () => {
    expect(isFormulaRiskyCell('Front brake pads')).toBe(false);
    expect(isFormulaRiskyCell('Invoice 2026-000123')).toBe(false);
    expect(isFormulaRiskyCell('a=b')).toBe(false);
    expect(isFormulaRiskyCell('Toyota Corolla + winter tyres')).toBe(false);
    expect(isFormulaRiskyCell(`code${TAB}value`)).toBe(false);
    expect(isFormulaRiskyCell(`line${CR}line`)).toBe(false);
    expect(isFormulaRiskyCell('')).toBe(false);
  });

  it('records the observed limits of the leading-character rule', () => {
    // These are pinned as *observations*, not endorsements. The documented set
    // is "= + - @ tab CR", and the implementation matches it exactly — but a
    // leading space or line feed defeats the test while some spreadsheet
    // software still parses the cell as a formula after trimming. A writer that
    // trims before calling this function would be safe; one that does not may
    // not be. Recorded here so a future change to either behaviour is visible
    // rather than silent.
    const LF = String.fromCharCode(10);
    expect(isFormulaRiskyCell(' =1+1')).toBe(false);
    expect(isFormulaRiskyCell(`${LF}=1+1`)).toBe(false);
  });
});
