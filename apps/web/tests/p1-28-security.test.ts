import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holds } from '@/features/crm/permissions';
import {
  APPOINTMENT_OPERATIONS,
  APPOINTMENT_PERMISSIONS,
} from '@/features/appointments/appointments-contract';
import {
  RECEPTION_OPERATIONS,
  RECEPTION_PERMISSIONS,
} from '@/features/receptions/receptions-contract';
import { WORK_ORDER_READ_PERMISSION } from '@/features/receptions/work-order-contract';
import {
  EVIDENCE_ROW_FIELDS,
  RESTRICTED_NARRATIVE_KINDS,
  isRestrictedNarrative,
} from '@/features/receptions/check-in/evidence';
import {
  NARRATIVE_CAPTURE_PERMISSION,
  SENSITIVE_NARRATIVE_PERMISSION,
  narrativeDenialKey,
  narrativeGate,
} from '@/features/receptions/check-in/sensitive';
import {
  RECEIVING_EMPLOYEE_CROSS_BRANCH_PERMISSION,
  RECEIVING_EMPLOYEE_NOTICE_KEY,
  RECEIVING_EMPLOYEE_OPERATION,
  RECEIVING_EMPLOYEE_PERMISSION,
  RECEIVING_EMPLOYEE_SCOPE,
  RECEIVING_EMPLOYEE_SUPERSEDED,
} from '@/features/receptions/people/receiving-employee-directory';
import {
  USER_DIRECTORY_ACTOR_OPERATION,
  USER_DIRECTORY_BOOTSTRAP_OPERATION,
  USER_DIRECTORY_FORBIDDEN_OPERATION,
  USER_DIRECTORY_OPERATIONS,
  USER_DIRECTORY_PERMISSION,
  USER_DIRECTORY_SCOPE,
} from '@/features/receptions/people/user-directory';
import type { CheckInCapabilities } from '@/features/receptions/check-in/wizard';
import { branchTargetQuery, query } from '@/lib/api/read-operation';
import enMessages from '../src/i18n/messages/en.json';
import arMessages from '../src/i18n/messages/ar.json';

/**
 * `P1-28-SEC-001` · `SEC-002` · `SEC-003` — the security obligations of this
 * phase, asserted against the source that shipped rather than against a
 * description of it.
 *
 * Every citation below is READ and checked. P1-27 learned the reason three
 * times: a citation nobody re-reads is a sentence, and three of its own named a
 * file that never mentioned the thing it claimed to prove.
 */

const cookieJar = vi.hoisted(() => ({ token: 'session-token-for-tenant-a' }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.token === null ? undefined : { name, value: cookieJar.token },
  }),
}));

const EN = enMessages as Record<string, string>;
const AR = arMessages as Record<string, string>;

const WEB_ROOT = process.cwd();
const REPO_ROOT = join(WEB_ROOT, '..', '..');

/** A repository file, read for a citation this suite refuses to take on trust. */
function repoFile(...parts: string[]): string {
  return readFileSync(join(REPO_ROOT, ...parts), 'utf8');
}

/** A file under `apps/web/src`. */
function webFile(...parts: string[]): string {
  return readFileSync(join(WEB_ROOT, 'src', ...parts), 'utf8');
}

interface RegisterOperation {
  readonly id: string;
  readonly method: string;
  readonly route: string;
  readonly permissions: readonly string[];
  readonly scope: string;
}

/** The P1-24 operation register — what the platform actually publishes. */
const REGISTER: readonly RegisterOperation[] = JSON.parse(
  repoFile('docs', 'phase-1', 'phase-1-24', 'evidence', 'operation-register.json')
).operations;

function operation(id: string): RegisterOperation {
  const found = REGISTER.find((entry) => entry.id === id);
  // Thrown, never undefined: a case that asserts a property of "the operation"
  // must not be able to pass by asserting it of nothing.
  if (!found) throw new Error(`${id} is not in the P1-24 operation register`);
  return found;
}

/* ------------------------------------------------------------------ *
 * P1-28-SEC-001 — least privilege and resolved scope
 * ------------------------------------------------------------------ */

describe('P1-28-SEC-001 — the permission surface is the operations, and no wider', () => {
  it('found a register to make claims against', () => {
    // Without this every derivation below compares two empty sets.
    expect(REGISTER.length).toBeGreaterThan(200);
    expect(REGISTER.filter((entry) => /^apt\./.test(entry.id)).length).toBeGreaterThanOrEqual(9);
    expect(REGISTER.filter((entry) => /^rec\./.test(entry.id)).length).toBeGreaterThanOrEqual(20);
  });

  it('checks a permission by exact membership, never by prefix', () => {
    // A prefix test would let `rec.reception.read` satisfy a control that needs
    // `rec.reception.read.sensitive`, and the direction of that mistake is
    // always toward showing more. The pairs below are the ones this phase would
    // actually get wrong: `approve` is a prefix of nothing, but `manage` is a
    // suffix of `party.manage` and of `evidence.manage`.
    expect(holds(['rec.reception.read'], RECEPTION_PERMISSIONS.read)).toBe(true);
    expect(holds(['rec.reception.party.manage'], RECEPTION_PERMISSIONS.manage)).toBe(false);
    expect(holds(['rec.reception.manage'], RECEPTION_PERMISSIONS.evidenceManage)).toBe(false);
    expect(holds(['apt.appointment.manage'], APPOINTMENT_PERMISSIONS.lifecycleManage)).toBe(false);
    expect(holds(['apt.appointment.lifecycle.manage'], APPOINTMENT_PERMISSIONS.manage)).toBe(false);
    expect(holds([], RECEPTION_PERMISSIONS.read)).toBe(false);
  });

  it('mirrors the published permission of every apt/rec operation, in BOTH directions', () => {
    /*
     * The contract layer is the interface's only statement about which code
     * gates which operation, and a mirror that only checks one direction is
     * satisfied by a subset. So: every row's permission equals the register's,
     * and every apt/rec code the register publishes is named by a contract map.
     * A backend code the interface never learned about is a screen that will
     * deny for a reason nobody wrote down.
     */
    for (const row of [...APPOINTMENT_OPERATIONS, ...RECEPTION_OPERATIONS]) {
      const published = operation(row.operationId);
      expect(published.permissions, row.operationId).toEqual([row.permission]);
      expect(published.method, row.operationId).toBe(row.method);
    }

    const mapped = new Set<string>([
      ...Object.values(APPOINTMENT_PERMISSIONS),
      ...Object.values(RECEPTION_PERMISSIONS),
    ]);
    const publishedCodes = new Set(
      REGISTER.filter((entry) => /^(apt|rec)\./.test(entry.id)).flatMap(
        (entry) => entry.permissions
      )
    );
    expect([...publishedCodes].sort(), 'an apt/rec code no P1-28 contract map names').toEqual(
      [...mapped].sort()
    );
  });

  it('keeps ARRANGING, ENDING and every reception authority on separate codes', () => {
    /*
     * The least-privilege property stated as the distinctions that carry it. One
     * blanket code would make "cancel this appointment" reachable from "book an
     * appointment", and "approve this visit for work" reachable from "record a
     * dent".
     */
    const appointment = new Set(Object.values(APPOINTMENT_PERMISSIONS));
    expect(appointment.size, 'a code was reused across two authorities').toBe(
      Object.keys(APPOINTMENT_PERMISSIONS).length
    );
    expect(APPOINTMENT_PERMISSIONS.manage).not.toBe(APPOINTMENT_PERMISSIONS.lifecycleManage);

    const reception = Object.values(RECEPTION_PERMISSIONS);
    expect(new Set(reception).size).toBe(reception.length);
    expect(reception.length).toBeGreaterThanOrEqual(9);
    // The three closing authorities are three, deliberately: an operator may
    // hold any one without the others.
    for (const pair of [
      [RECEPTION_PERMISSIONS.approve, RECEPTION_PERMISSIONS.convert],
      [RECEPTION_PERMISSIONS.approve, RECEPTION_PERMISSIONS.close],
      [RECEPTION_PERMISSIONS.convert, RECEPTION_PERMISSIONS.close],
    ]) {
      expect(pair[0]).not.toBe(pair[1]);
    }
    // And the conversion RESULT is read under a work-order code from another
    // module — P1-29's domain, borrowed read-only (WF-12).
    expect(WORK_ORDER_READ_PERMISSION).toBe(operation('wo.work-order-detail').permissions[0]);
    expect(WORK_ORDER_READ_PERMISSION.startsWith('wo.')).toBe(true);
    expect(reception).not.toContain(WORK_ORDER_READ_PERMISSION);
  });

  it('names the tiers that actually decide scope, read from their own source', () => {
    /*
     * The client cannot prove a server-side refusal, and this suite does not
     * pretend otherwise. What it CAN do is check that the chain it relies on is
     * still there — because the whole `SEC-003` posture rests on the server
     * deciding the branch, and a chain nobody re-reads is a paragraph.
     */
    const appointments = repoFile(
      'apps',
      'api',
      'src',
      'app',
      'api',
      'v1',
      'appointments',
      'route.ts'
    );
    // The create is authorized against the branch named in its BODY.
    expect(appointments).toContain("scope: 'branch'");
    expect(appointments).toContain('scopeTargetOption(body)');
    expect(appointments).toContain('iam.has_permission_in_scope');

    const receptions = repoFile('apps', 'api', 'src', 'app', 'api', 'v1', 'receptions', 'route.ts');
    expect(receptions).toContain('authorizationTarget');
    expect(receptions).toContain('iam.has_permission_in_scope');

    // And the tenant applied to the transaction comes from the resolved
    // PRINCIPAL, never from anything the request carried.
    expect(repoFile('apps', 'api', 'src', 'server', 'db', 'transaction.ts')).toContain(
      "['app.tenant_id', context.principal.tenantId]"
    );
  });
});

describe('P1-28-SEC-001 — the receiving-employee picker, and what iam.user.read is still spent on', () => {
  it('reads the BRANCH-eligible picker, at the code that opens a check-in', () => {
    /*
     * The narrowing, on every axis at once. This case is the whole of SEC-001
     * after `DBCR-P1-18-002`: the picker no longer reads a tenant-wide account
     * directory, so the disposition it needed is gone rather than restated.
     */
    expect(RECEIVING_EMPLOYEE_OPERATION).toBe('rec.receiving-employee-list');
    expect(RECEIVING_EMPLOYEE_PERMISSION).toBe('rec.reception.manage');
    expect(RECEIVING_EMPLOYEE_SCOPE).toBe('branch');

    const published = operation(RECEIVING_EMPLOYEE_OPERATION);
    expect(published.permissions).toEqual([RECEIVING_EMPLOYEE_PERMISSION]);
    expect(published.scope).toBe(RECEIVING_EMPLOYEE_SCOPE);
    expect(published.method).toBe('GET');

    // The SAME code the create costs. A screen that cannot open a visit cannot
    // read who might have received one, and that is checked rather than assumed.
    expect(operation('rec.reception-create').permissions).toContain(RECEIVING_EMPLOYEE_PERMISSION);
  });

  it('the picker is REACHABLE — the adapter and the screen both call it', () => {
    /*
     * The conjunct this suite used to record as outstanding, in the words it
     * used: "the wizard has not been moved onto the narrow read yet". It has.
     * Asserting the operation is published would have gone on passing while the
     * screen still read the directory, which is the shape that kept FE-007
     * PARTIAL, so the call site is what is checked.
     */
    const adapter = webFile('features', 'receptions', 'support-api.ts');
    expect(adapter).toContain('/api/v1/reception-catalogue/receiving-employees');
    expect(adapter).toContain('branchTargetQuery');

    const screen = webFile('features', 'receptions', 'components', 'CheckInStartScreen.tsx');
    expect(screen).toContain('listReceivingEmployeeCandidates');
  });

  it('NO P1-28 surface reads the tenant-wide account list any more', () => {
    /*
     * The removal, made falsifiable. `iam.user-list` still exists and the
     * administration screens still use it legitimately; what may not happen is a
     * reception or appointment surface reading it, which is what this phase did
     * and stopped doing.
     */
    expect(USER_DIRECTORY_FORBIDDEN_OPERATION).toBe('iam.user-list');
    expect(operation(USER_DIRECTORY_FORBIDDEN_OPERATION).scope).toBe(USER_DIRECTORY_SCOPE);
    expect(USER_DIRECTORY_SCOPE).toBe('tenant');

    for (const file of [
      ['features', 'receptions', 'support-api.ts'],
      ['features', 'receptions', 'api.ts'],
      ['features', 'receptions', 'components', 'CheckInStartScreen.tsx'],
      ['features', 'appointments', 'api.ts'],
    ] as const) {
      expect(webFile(...file), `${file.join('/')} reads the tenant-wide user list`).not.toMatch(
        /\/api\/v1\/iam\/users(?!\/)/
      );
    }
  });

  it('what it REPLACED is recorded, so the narrowing cannot be quietly undone', () => {
    // A removed disclosure that nothing remembers is one waiting to be re-added
    // by somebody who was not here. Each recorded axis is checked against the
    // register, so the record cannot drift into flattery.
    expect(RECEIVING_EMPLOYEE_SUPERSEDED.operation).toBe('iam.user-list');
    expect(RECEIVING_EMPLOYEE_SUPERSEDED.permission).toBe('iam.user.read');
    expect(RECEIVING_EMPLOYEE_SUPERSEDED.scope).toBe('tenant');

    const before = operation(RECEIVING_EMPLOYEE_SUPERSEDED.operation);
    expect(before.permissions).toContain(RECEIVING_EMPLOYEE_SUPERSEDED.permission);
    expect(before.scope).toBe(RECEIVING_EMPLOYEE_SUPERSEDED.scope);
    // Narrower on the axis that matters, not merely by name.
    expect(operation(RECEIVING_EMPLOYEE_OPERATION).scope).not.toBe(before.scope);
  });

  it('does NOT widen for the cross-branch permission — that is an administrative act', () => {
    /*
     * The Owner's decision, and the reason it is a permission no operation
     * declares: a picker that silently grew under a capability the operator
     * cannot see would reintroduce the disclosure this change removed. The
     * authority is spent inside `rec.stamp_receiving_employee_identity()`.
     */
    expect(RECEIVING_EMPLOYEE_CROSS_BRANCH_PERMISSION).toBe(
      'rec.reception.receiving_employee.assign_any'
    );
    expect(
      REGISTER.filter((entry) =>
        entry.permissions.includes(RECEIVING_EMPLOYEE_CROSS_BRANCH_PERMISSION)
      ),
      'the cross-branch authority is declared by an operation; it belongs in the database'
    ).toEqual([]);

    const migration = repoFile(
      'supabase',
      'migrations',
      '20260815093000_rec_receiving_employee_identity.sql'
    );
    expect(migration).toContain(RECEIVING_EMPLOYEE_CROSS_BRANCH_PERMISSION);

    const route = repoFile(
      'apps',
      'api',
      'src',
      'app',
      'api',
      'v1',
      'reception-catalogue',
      'receiving-employees',
      'route.ts'
    );
    expect(route).not.toContain(RECEIVING_EMPLOYEE_CROSS_BRANCH_PERMISSION.replace(/^rec\./, "'"));
  });

  it('says it ON SCREEN, in both catalogues, from the module that carries the decision', () => {
    for (const catalogue of [EN, AR]) {
      expect(Object.keys(catalogue)).toContain(RECEIVING_EMPLOYEE_NOTICE_KEY);
      expect(catalogue[RECEIVING_EMPLOYEE_NOTICE_KEY]?.length ?? 0).toBeGreaterThan(80);
    }
    // Real Arabic, not the English string copied across.
    expect(AR[RECEIVING_EMPLOYEE_NOTICE_KEY]).not.toBe(EN[RECEIVING_EMPLOYEE_NOTICE_KEY]);
    expect(AR[RECEIVING_EMPLOYEE_NOTICE_KEY]).toMatch(/[؀-ۿ]/);

    // The notice must describe THIS read. The sentence it replaced said the
    // control searches the whole workspace directory, and that would now be a
    // false statement rendered to an operator.
    expect(EN[RECEIVING_EMPLOYEE_NOTICE_KEY]).toMatch(/branch/i);
    expect(EN[RECEIVING_EMPLOYEE_NOTICE_KEY]).not.toMatch(/whole workspace|every account/i);

    // The screen renders it through the constant, so the statement an operator
    // reads and the one this suite checks cannot drift apart.
    const screen = webFile('features', 'receptions', 'components', 'CheckInStartScreen.tsx');
    expect(screen).toContain('RECEIVING_EMPLOYEE_NOTICE_KEY');
    expect(screen).toContain("from '../people/receiving-employee-directory'");
  });

  it('iam.user.read is still spent — on ACTOR names, and the bootstrap is still why', () => {
    /*
     * The old disposition is not deleted, it is narrowed to the population that
     * genuinely has no snapshot: who recorded an inspection, who bound evidence,
     * who signed. Those are audit identifiers already on the page.
     */
    expect(USER_DIRECTORY_PERMISSION).toBe('iam.user.read');
    expect(USER_DIRECTORY_ACTOR_OPERATION).toBe('iam.user-detail');
    expect(operation(USER_DIRECTORY_ACTOR_OPERATION).permissions).toContain(
      USER_DIRECTORY_PERMISSION
    );

    expect(USER_DIRECTORY_OPERATIONS.length).toBe(3);
    for (const id of USER_DIRECTORY_OPERATIONS) {
      expect(operation(id).permissions, id).toContain(USER_DIRECTORY_PERMISSION);
    }
    // Nothing else in the platform registers it, so the disposition is complete
    // rather than a sample of what the code opens.
    const everywhere = REGISTER.filter((entry) =>
      entry.permissions.includes(USER_DIRECTORY_PERMISSION)
    ).map((entry) => entry.id);
    expect(everywhere.sort()).toEqual([...USER_DIRECTORY_OPERATIONS].sort());

    // The argument that makes the code universal, unchanged and still load-bearing.
    expect(USER_DIRECTORY_BOOTSTRAP_OPERATION).toBe('iam.auth-session');
    expect(operation('iam.auth-session').permissions).toContain(USER_DIRECTORY_PERMISSION);
  });

  it('G-EMP is CLOSED, and the closure is read from the migration rather than asserted', () => {
    /*
     * The debt this section used to keep named. It was: `receiving_employee_id`
     * has no foreign key and no employee master exists, so any uuid at all was a
     * legal custodian. Three artefacts of `DBCR-P1-18-002` end it, and each is
     * opened here rather than described — a closure recorded only in prose is
     * how a stale justification survives.
     */
    const migration = repoFile(
      'supabase',
      'migrations',
      '20260815093000_rec_receiving_employee_identity.sql'
    );
    expect(migration).toContain('fk_reception_visits_receiving_employee');
    expect(migration).toContain('receiving_employee_display_name');
    expect(migration).toContain('rec.stamp_receiving_employee_identity');

    // The snapshot is what the read-back surfaces render, so the wizard header
    // and the customer's sheet cannot be moved back onto a live directory read.
    for (const file of [
      ['features', 'receptions', 'components', 'CheckInWizardShell.tsx'],
      ['features', 'receptions', 'components', 'AcknowledgementDocument.tsx'],
    ] as const) {
      expect(webFile(...file), file.join('/')).toContain('receivingEmployeeDisplayName');
      expect(webFile(...file), file.join('/')).not.toContain('readUserIdentity');
    }
  });
});

/* ------------------------------------------------------------------ *
 * P1-28-SEC-002 — the restricted narratives
 * ------------------------------------------------------------------ */

describe('P1-28-SEC-002 — WF-27, the permission the operation does not declare', () => {
  it('reads the database policy that creates the obligation, rather than describing it', () => {
    /*
     * The premise of this whole section is a row-level policy, so the policy is
     * opened. Both narrative tables, both INSERT policies, both ending in the
     * sensitive capability — and the SELECT policies too, which is why the
     * read-back cannot return what was typed.
     */
    const complaints = repoFile('supabase', 'migrations', '20260721099000_rec_complaints.sql');
    expect(complaints).toContain('CREATE POLICY ins_complaint_details_gated');
    expect(complaints).toContain('CREATE POLICY sel_complaint_details_gated');
    expect(complaints).toContain(`iam.has_permission('${SENSITIVE_NARRATIVE_PERMISSION}')`);

    const contents = repoFile('supabase', 'migrations', '20260721103000_rec_vehicle_contents.sql');
    expect(contents).toContain('CREATE POLICY ins_vehicle_content_details_gated');
    expect(contents).toContain('CREATE POLICY sel_vehicle_content_details_gated');
    expect(contents).toContain(`iam.has_permission('${SENSITIVE_NARRATIVE_PERMISSION}')`);
  });

  it('confirms the OPERATION declares only the other code — which is the trap', () => {
    // If the operation declared both, the application check would refuse first
    // and there would be no WF-27. It declares one.
    const published = operation('rec.reception-condition-evidence');
    expect(published.permissions).toEqual([NARRATIVE_CAPTURE_PERMISSION]);
    expect(published.permissions).not.toContain(SENSITIVE_NARRATIVE_PERMISSION);
    expect(NARRATIVE_CAPTURE_PERMISSION).toBe(RECEPTION_PERMISSIONS.evidenceManage);

    // And the service maps the database's refusal to an authorization outcome
    // rather than a fault, which is what makes it reach a screen as a denial.
    const service = repoFile(
      'apps',
      'api',
      'src',
      'modules',
      'reception',
      'application',
      'reception-evidence-service.ts'
    );
    expect(service).toContain('SQLSTATE.insufficientPrivilege');
    expect(service).toContain("new AppFailure('ERR-IAM-001'");
  });

  it('gates exactly the two restricted kinds, and no others', () => {
    expect([...RESTRICTED_NARRATIVE_KINDS].sort()).toEqual(['complaint', 'contents']);
    const capabilities = fullCapabilities({ viewSensitiveNarratives: false });

    for (const kind of RESTRICTED_NARRATIVE_KINDS) {
      expect(narrativeGate(kind, capabilities, false)).toEqual({
        status: 'no-narrative',
        noticeKey: 'receptions.evidence.sensitiveRequired',
      });
    }
    // A damage mark or a warning light carries no personal narrative and must
    // NOT require a sensitive-data capability to record — the backend says so
    // deliberately, and folding it in here would be a tightening nobody decided.
    for (const kind of ['inspection', 'condition_item', 'damage_mark', 'leak'] as const) {
      expect(isRestrictedNarrative(kind)).toBe(false);
      expect(narrativeGate(kind, capabilities, false)).toEqual({ status: 'open', noticeKey: null });
    }
  });

  it('orders the three refusals by what is most true', () => {
    const held = fullCapabilities({});
    // A visit that has ended refuses every write, whatever anyone holds.
    expect(narrativeGate('complaint', held, true).noticeKey).toBe('receptions.evidence.lockedNote');
    // Then the operation's own capability …
    expect(
      narrativeGate('complaint', fullCapabilities({ manageEvidence: false }), false).noticeKey
    ).toBe('receptions.evidence.readOnly');
    // … and only then the database's.
    expect(narrativeGate('complaint', held, false)).toEqual({ status: 'open', noticeKey: null });
  });

  it('names the pair after a refusal and DIAGNOSES nothing', () => {
    /*
     * Holding the code is necessary, never sufficient: `iam.has_permission` is
     * scope-aware, so a grant that does not reach this visit's branch is refused
     * with the code held. A screen that answered "you are missing
     * iam.sensitive.view" would therefore be wrong in exactly the case an
     * operator most needs the truth.
     */
    const denied = { status: 'denied' as const, messageKey: 'state.denied.title' };
    expect(narrativeDenialKey('complaint', denied)).toBe('receptions.evidence.sensitiveDenied');
    expect(narrativeDenialKey('contents', denied)).toBe('receptions.evidence.sensitiveDenied');
    // Not on a kind that writes no narrative …
    expect(narrativeDenialKey('damage_mark', denied)).toBeNull();
    // … and not on an outcome that is not a permission problem. Saying "you may
    // be missing a permission" beside a typo sends an operator to an
    // administrator over a blank field.
    for (const status of ['idle', 'success', 'invalid', 'conflict', 'unavailable'] as const) {
      expect(narrativeDenialKey('complaint', { status })).toBeNull();
    }
  });

  it('publishes both statements in both catalogues, and neither is a copy of the other', () => {
    for (const key of [
      'receptions.evidence.sensitiveRequired',
      'receptions.evidence.sensitiveDenied',
      'receptions.evidence.restrictedReadBack',
    ]) {
      for (const catalogue of [EN, AR]) {
        expect(Object.keys(catalogue), key).toContain(key);
        expect((catalogue[key] ?? '').length, key).toBeGreaterThan(40);
      }
      expect(AR[key], key).not.toBe(EN[key]);
      expect(AR[key], key).toMatch(/[؀-ۿ]/);
    }
    // The refusal supplement must not claim which half was missing.
    expect(EN['receptions.evidence.sensitiveDenied']?.toLowerCase()).toContain('does not say');
  });

  it('proves the read-back genuinely cannot return the narrative — as a field asymmetry', () => {
    /*
     * The honest-labelling obligation rests on a fact about the published union,
     * so the fact is asserted rather than the label. The two write inputs carry
     * the narrative; the two read rows do not.
     */
    const complaintFields = EVIDENCE_ROW_FIELDS.complaint.map((field) => field.field);
    expect(complaintFields).not.toContain('complaintText');
    expect(complaintFields).toContain('category');

    const contentsFields = EVIDENCE_ROW_FIELDS.contents.map((field) => field.field);
    for (const absent of ['itemDescription', 'declaredValue', 'declaredCurrency']) {
      expect(contentsFields, absent).not.toContain(absent);
    }
    expect(contentsFields).toEqual(['quantity', 'location']);

    // And the WRITE side really does carry them, so the asymmetry is a property
    // of the platform and not of a contract module that forgot two fields.
    const contract = webFile('features', 'receptions', 'receptions-contract.ts');
    expect(contract).toContain('complaintText');
    expect(contract).toContain('itemDescription');

    // The repository read excludes the two tables deliberately, and says so.
    const repository = repoFile(
      'apps',
      'api',
      'src',
      'modules',
      'reception',
      'data',
      'reception-read-repository.ts'
    );
    expect(repository).toContain(SENSITIVE_NARRATIVE_PERMISSION);
  });

  it('states the restriction on every restricted panel, from ONE string', () => {
    // The statement is rendered by the shared panel for `isRestrictedNarrative`
    // kinds, so a ninth evidence kind added to that set inherits it rather than
    // shipping a thin row with no explanation.
    const panels = webFile('features', 'receptions', 'components', 'steps', 'EvidencePanels.tsx');
    expect(panels).toContain('isRestrictedNarrative(kind)');
    expect(panels).toContain('receptions.evidence.restrictedReadBack');
  });
});

/* ------------------------------------------------------------------ *
 * P1-28-SEC-003 — scope hygiene and the abuse cases
 * ------------------------------------------------------------------ */

const SCOPE_SPELLINGS = [
  'tenantId',
  'companyId',
  'branchId',
  'tenant_id',
  'company_id',
  'branch_id',
] as const;

interface CapturedRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly body: string;
}

const captured: CapturedRequest[] = [];

function onlyRequest(): CapturedRequest {
  const first = captured[0];
  if (!first) throw new Error('the adapter issued no request at all');
  return first;
}

/** A backend answering `status`, recording exactly what it was asked. */
function backendAnswering(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
        },
      });
    })
  );
}

const TABLE_REQUEST = { page: 1, pageSize: 25, sort: null, filters: [], search: '' } as const;

/** The branch a hostile operator names — not one their session resolves to. */
const FORGED = {
  companyId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
} as const;

describe('P1-28-SEC-003 — the ONE door, and the abuse cases that try the walls', () => {
  beforeEach(() => {
    captured.length = 0;
    cookieJar.token = 'session-token-for-tenant-a';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records the exception honestly: the pair is a REQUIRED field, not a client claim', () => {
    /*
     * `P1-27-SEC-001` says "no client-asserted scope". Its premise is false for
     * `apt.*`/`rec.*`, and pretending otherwise would be the more comfortable
     * lie: `rec.reception-create` takes `companyId` and `branchId` as REQUIRED
     * BODY fields and both list reads as a mandatory query pair, because a visit
     * is authorized against the branch it is FOR (`P1-18-A-01`).
     *
     * A client sending them is not widening its own access — the server checks
     * the operator's permission IN that scope and refuses — it is naming the
     * resource, exactly as it names a vehicle.
     */
    for (const id of ['apt.appointment-create', 'rec.reception-create']) {
      expect(operation(id).scope, id).toBe('branch');
    }
    for (const id of ['apt.appointment-list', 'rec.reception-list']) {
      expect(operation(id).scope, id).toBe('branch');
    }

    const appointments = repoFile(
      'apps',
      'api',
      'src',
      'app',
      'api',
      'v1',
      'appointments',
      'route.ts'
    );
    // The mandatory pair, in the body schema and in the list query schema.
    expect(appointments).toMatch(/companyId:\s*schemas\.uuid,/);
    expect(appointments).toMatch(/branchId:\s*schemas\.uuid,/);
  });

  it('is narrowed in the gate by a rule-level distinction, never by an exemption', () => {
    /*
     * How the narrowing is EXPRESSED matters as much as that it is correct. The
     * repository's own gate suite refuses `allow` entries precisely so a false
     * positive is answered with a distinction rather than an escape hatch, and
     * this phase followed that discipline twice: once when the reception tree
     * was adopted, and again here when the appointment tree was.
     */
    const gate = repoFile('scripts', 'ci', 'check-p1-27-frontend.mjs');
    expect(gate).toContain("id: 'no-client-asserted-scope'");
    expect(gate).toContain('roots: PLAN_ROOTS');
    expect(gate).toContain("join('apps', 'web', 'src', 'features', 'appointments')");
    expect(gate).toContain("join('apps', 'web', 'src', 'features', 'receptions')");

    // And the narrowing gives something up, which is measured rather than waved
    // away: a second gate re-applies the half whose premise survives.
    const access = repoFile('scripts', 'ci', 'check-p1-28-access.mjs');
    expect(access).toContain('no-scope-in-a-url');
    expect(access).toContain('P1-18-A-01');
  });

  it('1/3 forged branch: the request carries the named pair, and NOTHING about the caller', async () => {
    /*
     * The uncomfortable half first, as P1-27's escalation case did: the request
     * goes out. A multi-branch session resolves to no single branch, so the
     * screen lets the operator TYPE one, and nothing client-side can refuse an
     * id they are not entitled to. What stops the abuse is the server deciding
     * against exactly that pair — and what the interface owes is to send the
     * pair and no claim about who the caller is.
     */
    backendAnswering(403, {
      type: 'urn:rootlco:error:ERR-IAM-001',
      code: 'ERR-IAM-001',
      status: 403,
    });
    const { listAppointments } = await import('@/features/appointments/api');
    const page = await listAppointments(FORGED, { status: 'confirmed' }, TABLE_REQUEST, null);

    const { url, headers, body } = onlyRequest();
    const parameters = new URL(url).searchParams;
    expect(parameters.get('companyId')).toBe(FORGED.companyId);
    expect(parameters.get('branchId')).toBe(FORGED.branchId);
    // No tenant, in any spelling, anywhere in the request.
    for (const spelling of ['tenantId', 'tenant_id'] as const) {
      expect(parameters.has(spelling), spelling).toBe(false);
    }
    expect(body, 'a read carried a body').toBe('');
    const scopeHeaders: string[] = [];
    headers.forEach((_value, name) => {
      if (/tenant|company|branch/i.test(name)) scopeHeaders.push(name);
    });
    expect(scopeHeaders, 'the forged read asserted a scope in a header').toEqual([]);
    // The caller is identified by the bearer, and by nothing else.
    expect(headers.get('authorization')).toBe('Bearer session-token-for-tenant-a');

    // And the refusal reaches the screen AS a refusal. An operator must never
    // read "you may not see this branch" as "this branch has nothing booked".
    expect(page.status, 'a refusal was rendered as an empty calendar').toBe('denied');
    expect(page.rows).toEqual([]);
  });

  it('1/3 control: the same call reports ok when the server allows it', async () => {
    // Without this, "denied" above is equally consistent with an adapter that
    // reports denied whatever the server says.
    backendAnswering(200, { items: [], nextCursor: null, hasMore: false });
    const { listAppointments } = await import('@/features/appointments/api');
    const page = await listAppointments(FORGED, {}, TABLE_REQUEST, null);
    expect(page.status).toBe('ok');
  });

  it('2/3 smuggling: a scope key among ordinary filters is refused at the call site', () => {
    /*
     * The target has ONE door. A caller that could pass `companyId` as an
     * ordinary filter would have a second, and a duplicate would silently
     * prefer one of the two values — which is how a request ends up authorized
     * against a branch nobody chose.
     */
    const target = { companyId: 'c1', branchId: 'b1' };
    for (const spelling of SCOPE_SPELLINGS) {
      expect(() => branchTargetQuery(target, { [spelling]: 'x' }), spelling).toThrow(spelling);
      expect(() => query({ [spelling]: 'x' }), spelling).toThrow(spelling);
    }
    // An ordinary criterion still rides through beside the pair, so the refusal
    // above is about the NAMES and not about a builder that refuses everything.
    expect(branchTargetQuery(target, { vehicleId: 'v1', status: 'opened' })).toBe(
      '?companyId=c1&branchId=b1&vehicleId=v1&status=opened'
    );
    // Both halves or neither: an undefined half would be serialised as the
    // literal string "undefined" and travel looking like an assertion.
    expect(() => branchTargetQuery({ companyId: 'c1' } as never)).toThrow(/branchId/);
    expect(() => branchTargetQuery({ companyId: '', branchId: 'b1' })).toThrow(/companyId/);
  });

  it('2/3 smuggling, driven through the real adapter — where the control is an ALLOW-LIST', async () => {
    /*
     * This case was written expecting the builder's throw and it failed, which
     * is the more useful outcome: the throw is never reached, because the
     * adapters do not pass a criteria OBJECT to the query builder at all. Each
     * one names the filters it forwards, field by field, so a key nobody listed
     * is dropped before the builder ever sees it.
     *
     * That is a stronger control than the throw, not a weaker one — a caller
     * cannot reach the guard because it cannot reach the query — but it is a
     * DIFFERENT control, and stating the wrong one would leave the real
     * mechanism unasserted and free to be replaced by a spread.
     *
     * Both layers are therefore checked: the smuggled branch does not travel
     * (driven), and the reason it cannot is structural (read).
     */
    backendAnswering(200, { items: [], nextCursor: null, hasMore: false });
    const { listReceptions } = await import('@/features/receptions/api');
    const page = await listReceptions(
      { companyId: 'c1', branchId: 'b1' },
      { branchId: FORGED.branchId, vehicleId: 'v1' } as never,
      TABLE_REQUEST,
      null
    );
    expect(page.status).toBe('ok');

    const parameters = new URL(onlyRequest().url).searchParams;
    // The target won, and the smuggled value did not appear at all — not as a
    // second `branchId` and not as anything else.
    expect(parameters.getAll('branchId')).toEqual(['b1']);
    expect(onlyRequest().url).not.toContain(FORGED.branchId);
    // The allow-listed filter beside it DID travel, so the absence above is a
    // fact about the scope key rather than about a request that carried nothing.
    expect(parameters.get('vehicleId')).toBe('v1');

    // And the structure that makes it so: every criterion is named. A spread of
    // the criteria object would put the guard back in the path — which would
    // still be safe — but a spread of anything WIDER would not, and this is the
    // line that would change.
    const source = webFile('features', 'receptions', 'api.ts');
    expect(source).toContain('status: criteria.status');
    expect(source).toContain('vehicleId: criteria.vehicleId');
    expect(source, 'the criteria object is spread into the query builder').not.toMatch(
      /branchTargetQuery\(\s*target,\s*\{\s*\.\.\.criteria/
    );
  });

  it('3/3 cursor: the client forwards the server’s token and mints none of its own', async () => {
    /*
     * A cursor is opaque and is issued FOR an ordering contract in a scope. Two
     * client-side properties have to hold, and both are checked here rather than
     * asserted about the server:
     *
     *   - the cursor travels exactly as it arrived, so nothing here can craft
     *     one that addresses another scope's page;
     *   - the cursor is not a filter, so it cannot be smuggled into the target.
     */
    backendAnswering(200, { items: [], nextCursor: null, hasMore: false });
    const { listReceptions } = await import('@/features/receptions/api');
    const issued = 'eyJvIjoiMjAyNi0wOC0xMyIsImkiOiJhYmMifQ==';
    await listReceptions({ companyId: 'c1', branchId: 'b1' }, {}, TABLE_REQUEST, issued);

    const parameters = new URL(onlyRequest().url).searchParams;
    expect(parameters.get('cursor'), 'the cursor was rewritten in flight').toBe(issued);
    expect(parameters.get('companyId')).toBe('c1');
    expect(parameters.get('branchId')).toBe('b1');

    // No adapter in these trees constructs, decodes or edits a cursor: it is
    // read from the response and handed back. A client that understood the
    // token would be a client that could forge one.
    for (const relative of [
      ['features', 'appointments', 'api.ts'],
      ['features', 'receptions', 'api.ts'],
      ['features', 'receptions', 'support-api.ts'],
    ]) {
      const source = webFile(...relative);
      expect(source, relative.join('/')).not.toMatch(/atob\(|Buffer\.from\(|JSON\.parse\(cursor/);
    }
  });

  it('3/3 cursor: a target change RESTARTS the table instead of paging the old scope', () => {
    /*
     * The abuse this closes is not hostile — it is the ordinary one. An operator
     * pages branch A to page three, changes the branch and presses Show: a table
     * that kept its cursor would send A's token with B's target, and the server
     * would refuse it as a cursor issued for a different ordering contract. Both
     * list screens mount the results component under a key derived from the
     * WHOLE submission, so a new target is a new table with no cursor at all.
     */
    for (const relative of [
      ['features', 'appointments', 'components', 'AppointmentCalendarScreen.tsx'],
      ['features', 'receptions', 'components', 'ReceptionQueueScreen.tsx'],
    ]) {
      const source = webFile(...relative);
      expect(source, relative.join('/')).toContain('key={JSON.stringify(submitted)}');
      // And the submission that keys it carries the target, so a branch change
      // really does change the key.
      expect(source, relative.join('/')).toMatch(/target:\s*\{\s*companyId/);
    }
  });

  it('3/3 cursor: a refused cursor surfaces as an error with a reference, never as “empty”', async () => {
    // `ERR-CUR-001` is a 400 — "issued for a different ordering contract". The
    // web client maps 400 to `validation` and the read layer maps that to
    // `error`; what must never happen is an empty page, which reads to an
    // operator as "this branch has nothing".
    backendAnswering(400, {
      type: 'urn:rootlco:error:ERR-CUR-001',
      code: 'ERR-CUR-001',
      status: 400,
      correlationId: 'corr-cursor',
    });
    const { listReceptions } = await import('@/features/receptions/api');
    const page = await listReceptions(
      { companyId: 'c1', branchId: 'b1' },
      {},
      TABLE_REQUEST,
      'a-cursor-from-another-scope'
    );
    expect(page.status).toBe('error');
    expect(page.rows).toEqual([]);
    expect(page.correlationId, 'a refused page carries no reference to quote').toBeTruthy();
  });
});

/** Every capability held, unless a case withholds one on purpose. */
function fullCapabilities(over: Partial<CheckInCapabilities>): CheckInCapabilities {
  return {
    manageParties: true,
    verifyAuthorizations: true,
    readCustomers: true,
    readVehicles: true,
    manageEvidence: true,
    viewSensitiveNarratives: true,
    manageSignatures: true,
    recordOdometer: true,
    approveReceptions: true,
    convertReceptions: true,
    closeReceptions: true,
    readWorkOrders: true,
    readStaffDirectory: true,
    ...over,
  };
}
