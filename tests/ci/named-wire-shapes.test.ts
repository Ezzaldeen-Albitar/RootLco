/**
 * No route may serialise an anonymous type to the wire.
 *
 * ## What was wrong
 *
 * Route handlers returned `Promise<{ … }>` declared inline, so the shape a client
 * receives had no name anywhere in the tree: it could not be imported, referenced
 * by a contract, or changed in one place. `BR-08b` named six response envelopes
 * because its contract enumerated six, and defended the remainder with a claim it
 * had not measured — that the other anonymous returns never reach the wire.
 * Thirteen did.
 *
 * ## Why the count moved from eight to thirteen
 *
 * The census that raised `RES-04` recorded eight and called itself a lower bound
 * because 47 call sites were UNRESOLVED. It was a text scanner, and it was wrong
 * four separate ways: it could not read a one-line signature, nor a barrel binding
 * a service to a `const`, nor a `body:` that is not the first token on its line,
 * and it parsed a wrapped `): Promise<{` as the literal string `"Promise<"` and
 * called it named. Two of those hid four more shapes; the last hid a live one on
 * `/notifications/{id}/deliveries` while the gate reported `0 anonymous`.
 *
 * So the gate reads the AST now, like its three sibling gates, and these cases pin
 * the properties that text scanning kept losing.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { census, UNRESOLVED_CEILING } from '../../scripts/ci/check-named-wire-shapes.mjs';

const { summary, anonymous, named, composed, unresolved } = census();

const typeOf = (qualified: string) => {
  const [cls, method] = qualified.split('.');
  return [...new Set(named.filter((r) => r.cls === cls && r.method === method).map((r) => r.type))];
};

/** Every `route.ts` under the versioned API, read independently of the gate. */
function routeSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'route.ts') out.push(readFileSync(full, 'utf8'));
    }
  };
  walk('apps/api/src/app/api/v1');
  return out;
}

describe('every route body serialises a named type', () => {
  it('leaves no anonymous shape on the wire', () => {
    // Listed, not counted: a bare count tells the next reader nothing about which
    // route to open.
    expect(anonymous.map((r) => `${r.route}:${r.line} ${r.cls}.${r.method}`)).toEqual([]);
  });

  it('resolves every call site, so the anonymous count has no blind spot behind it', () => {
    // The decisive property. `anonymous: 0` beside a non-empty `unresolved` is the
    // state this gate shipped in first, and it was hiding a live anonymous shape.
    expect(unresolved.map((r) => `${r.route}:${r.line} ${r.why}`)).toEqual([]);
    expect(UNRESOLVED_CEILING).toBe(0);
  });

  it('accounts for every response body, dropping none', () => {
    // Not a vacuous pass, and not a pass that trusts the gate's own arithmetic:
    // the four buckets must re-add to the total, and the total is cross-checked
    // against an INDEPENDENT count below.
    expect(summary.named + summary.anonymous + summary.composed + summary.unresolved).toBe(
      summary.bodies
    );
    // 368 bodies with P1-30 A2's twelve published reads. Every one resolves to a
    // NAMED interface, so `named` moves by twelve and `composed` does not — the
    // two buckets are re-pinned independently rather than by adding twelve to a
    // total, because a read whose body is an inline object literal lands in
    // `composed` (or, worse, `anonymous`) and the totals alone would not say so.
    // One did: `PriceListService.listRules` returned an anonymous shape and this
    // gate named it, which is why `PriceListRulesView` exists.
    // 373 with the P1-30 inventory master data (#322): the category list and
    // create, the item create and the location create serialise named views
    // (`named` +4); the units-of-measure list answers `{ items }` composed in
    // the route from `UnitOfMeasureView[]` (`composed` +1).
    // 375 with the P1-30 opening-batch reads (S-17): the list serialises
    // `Page<OpeningBatchListView>` and the detail `OpeningBatchDetailView`, both
    // NAMED interfaces, so `named` moves by two and `composed` does not.
    // 381 with the P1-31 delivery read seam (P-2 … P-5): six GETs, every one of
    // them NAMED, so `named` moves by six and `composed` does not. Four of the
    // six needed a named envelope minted for them — `DeliveryReceiverEnvelope`,
    // `DeliveryChecklistResultsEnvelope`, `DeliverySignaturesEnvelope` and
    // `DeliveryStatusHistoryEnvelope` exist because THIS gate refused the inline
    // return types the slice first wrote, which is the gate doing its job.
    // 382 with the P1-31 warranty list (P-6): one GET serialising
    // `Page<WarrantyRecordListView>`, a NAMED interface, so `named` moves by one
    // and `composed` does not.
    // 389 with the P1-31 warranty POLICY and COVERAGE seam (P-10): seven
    // operations, two GETs and five writes, every one of them NAMED, so `named`
    // moves by seven and `composed` does not. `WarrantyPolicyListView` and
    // `WarrantyPolicyDetailView` exist because this gate refuses an inline return
    // type; the five commands serialise `WarrantyPolicySummaryView` and
    // `WarrantyCoverageTermsView`, which is the same pair the reads publish.
    // 397 with the P1-31 checklist TEMPLATE seam (P-9) merged alongside it: eight
    // further operations, two GETs and six writes, every one of them NAMED, so
    // `named` moves by eight again and `composed` still does not.
    // `ChecklistTemplateListView` and `ChecklistTemplateDetailView` exist because
    // this gate refuses an inline return type; the six commands serialise
    // `ChecklistTemplateView` and `ChecklistTemplateItemView`, which is the same
    // pair the reads publish.
    // 404 with the P1-31 report CONFIGURATION seam (P-11): seven operations, two
    // GETs and five writes, every one of them NAMED, so `named` moves by seven and
    // `composed` does not. `ReportConfigurationListView` and
    // `ReportConfigurationDetailView` exist because this gate refuses an inline
    // return type; the five commands serialise `ReportConfigurationSummaryView` and
    // `ReportConfigurationVersionView`, which is the same pair the reads publish.
    // 405 with the P1-31 delivery-readiness queue (Owner decision D-3): ONE
    // further operation, a GET returning `Page<DeliveryReadinessRowView>` — a
    // NAMED interface, because this gate refuses an inline return type — so
    // `named` moves by one again and `composed` still does not.
    // The delivery list adds one named 200 body on an existing route module.
    // 406 with the P1-31 delivery-readiness queue merged on develop: the
    // delivery-record list (#358) and the readiness queue are separate
    // operations on separate route modules, so both count, `named` moves by one
    // for each and `composed` still does not.
    // 407 with the P1-31 report ENGINE (P-11) merged alongside it: one GET
    // serialising `ReportRunView`, a NAMED interface, so `named` moves by one
    // and `composed` does not. The envelope exists BECAUSE this gate refuses an
    // inline return type, and naming it is what let the cell, column and period
    // shapes be named as well.
    // 411 with the P1-31 employee register (P-17): four operations, two GETs and
    // two writes, every one of them serialising `EmployeeView` or
    // `Page<EmployeeView>` — a NAMED interface either way — so `named` moves by
    // four and `composed` does not.
    // 412 with the P1-31 warranty status-history read (P-18): ONE GET serialising
    // `WarrantyStatusHistoryEnvelope`, a NAMED interface — it exists because this
    // gate refuses an inline return type, and naming it is what let the row shape
    // be named `WarrantyStatusHistoryEntryView` as well — so `named` moves by one
    // and `composed` does not.
    // P1-31 P-12 adds the named ReportExportView response.
    // 426 with the P1-32 Platform Owner Console backend: thirteen new bodies,
    // every one a NAMED service return type, so `named` moves by thirteen — and
    // by one more, because `platform.organization-read` now serialises the named
    // `Page<OrganizationView>` from its service where it used to compose
    // `{ items }` in the route, which is also why `composed` falls by one.
    // 429 with the Owner directive organisation administration: the company
    // create serialises `CompanyResult`, the branch create `BranchResult` and the
    // capacity read `CapacityResult` — all NAMED — so `named` moves by three and
    // `composed` does not.
    // 432 with the P1-32-PRE-151 organisation growth: the company add serialises
    // `CompanyAddedView`, the branch add `BranchAddedView` and the administrator
    // setup `AdministratorSetupResultView` — all NAMED, all carrying the target
    // organisation beside the row, so `named` moves by three and `composed` does
    // not.
    // 431 with the P1-32 preparatory inventory slice: eighteen operations —
    // transfers, goods receipts, the cost history, adjustments and counts — and
    // every one serialises a NAMED view or `Page<…>` of one, so `named` moves by
    // eighteen and `composed` does not.
    // 437 with P1-32 preparatory slice 2: six identifier operations, each a NAMED
    // view, so `named` moves by six and `composed` does not.
    // 444 with the rest of that slice: the two item-price operations, the two
    // counter-sale operations and the three return operations — again every one a
    // named view or a `Page<…>` of one, so `named` moves by seven and `composed`
    // does not.
    // 459 with P1-32 preparatory slice 3b: fifteen operations, every one serialising
    // a NAMED view or a `Page<…>` of one, so `named` moves by fifteen and `composed`
    // does not.
    // 463 with P1-32 preparatory slice 3c: the re-check and cancellation of a
    // requirement answer its NAMED view, and the closure and cancellation of a
    // request a NAMED request view, so `named` moves by four and `composed` does not.
    // 465 with P1-32-PRE-141: the settlement list answers a `Page<…>` of a NAMED
    // settlement view and the settlement read that view, so `named` moves by two.
    // 468 with the Owner directive organisation administration merged in: the
    // company create serialises `CompanyResult`, the branch create `BranchResult`
    // and the capacity read `CapacityResult` — all NAMED — so `named` moves by
    // three and `composed` does not.
    // 484 with the Owner directive inventory operations merged into the Platform
    // Owner Console line: the two branches move different route modules, so the
    // console's sixteen bodies and this branch's fifty-two add without overlap;
    // `named` moves by seventeen and by fifty-two, and `composed` falls by one
    // for the console's `platform.organization-read` alone.
    // 492 with the Owner directive operational stock alerts: eight operations —
    // the three reorder-level ones, the four stock alerts and the tenant capacity
    // alert — each serialising a NAMED view, so `named` moves by eight and
    // `composed` does not move at all.
    expect(summary.bodies).toBe(492);
    expect(summary.named).toBe(440);
    expect(summary.composed).toBe(52);
    expect(summary.anonymous).toBe(0);
    expect(summary.unresolved).toBe(0);
  });

  it('agrees with a count taken a different way', () => {
    // Two independent measurements of the same population. If the AST walk
    // silently stopped visiting routes, its buckets would still re-add to their
    // own total and the case above would pass; this one would not.
    const byText = routeSources().reduce((total, source) => {
      const hits = source
        .split('\n')
        .filter((line) => /(^\s*body:|,\s*body:|\{\s*body:)/.test(line))
        .filter((line) => !/body:\s*z\./.test(line) && !/body:\s*input\.body/.test(line));
      return total + hits.length;
    }, 0);
    expect(byText).toBe(summary.bodies);
  });

  it('resolves each of the thirteen to the interface that replaced it', () => {
    expect(typeOf('AccessAdministrationService.issueGrant')).toEqual([
      'Promise<AccessRecordCreated>',
    ]);
    expect(typeOf('AccessAdministrationService.addScope')).toEqual([
      'Promise<AccessRecordCreated>',
    ]);
    expect(typeOf('AccessAdministrationService.addRolePermission')).toEqual([
      'Promise<AccessRecordCreated>',
    ]);
    expect(typeOf('AccessAdministrationService.createApprovalLimit')).toEqual([
      'Promise<AccessRecordCreated>',
    ]);
    expect(typeOf('TechnicianRosterService.withdrawSkill')).toEqual(['Promise<HoldingWithdrawn>']);
    expect(typeOf('TechnicianRosterService.withdrawAvailability')).toEqual([
      'Promise<HoldingWithdrawn>',
    ]);
    expect(typeOf('StatusTransitionService.describe')).toEqual(['Promise<StatusDescription>']);
    expect(typeOf('TemplateService.previewVersion')).toEqual(['Promise<RenderedPreview>']);
    expect(typeOf('TemplateService.createTemplate')).toEqual(['Promise<TemplateCreated>']);
    expect(typeOf('AttachmentService.rejectVersion')).toEqual(['Promise<VersionRejected>']);
    expect(typeOf('AttachmentService.link')).toEqual(['Promise<DocumentLinkRef>']);
    expect(typeOf('AttachmentService.unlink')).toEqual(['Promise<DocumentLinkRef>']);
    expect(typeOf('NotificationReadService.readDeliveries')).toEqual(['Promise<DeliveryHistory>']);
  });

  it('reads a signature whatever width prettier gave it', () => {
    // Which method has which spelling is deliberately NOT asserted: prettier picks
    // by line width alone, so naming a return type can collapse a wrapped
    // signature onto one line. That is not hypothetical — `describe` did exactly
    // that mid-slice and vanished from the text scanner's view. Both spellings
    // must simply resolve.
    const spellings = named.map((row) => {
      const [file, line] = [row.at.slice(0, row.at.lastIndexOf(':')), row.at.split(':').pop()];
      const text = readFileSync(file, 'utf8').split('\n')[Number(line) - 1] ?? '';
      return /^\s*\)/.test(text) ? 'wrapped' : 'inline';
    });
    expect(spellings.filter((s) => s === 'inline').length).toBeGreaterThan(0);
    expect(spellings.filter((s) => s === 'wrapped').length).toBeGreaterThan(0);
  });

  it('reads both ways a barrel can bind a service', () => {
    // `attachments` is bound to a const and returned shorthand; reading only the
    // inline `accessor: new Service(...)` form left seven routes unresolved, five
    // of them attachments, and three anonymous shapes hidden behind them.
    const barrel = readFileSync('apps/api/src/modules/shared-services/index.ts', 'utf8');
    expect(/const attachments = new AttachmentService\(/.test(barrel)).toBe(true);
    expect(/^\s*attachments,\s*$/m.test(barrel)).toBe(true);
    expect(typeOf('AttachmentService.link')).toEqual(['Promise<DocumentLinkRef>']);
  });

  it('counts a body composed by the route, rather than ignoring it', () => {
    // `composed` is a stated scope limit, not a blind spot: these are object
    // literals the route assembles itself, so no declared type exists to name.
    // They are counted and reported. A body that is a CALL is never filed here —
    // that would let a broken resolver reclassify every service call as "the
    // route authored it" and pass while blind.
    expect(composed.length).toBeGreaterThan(0);
    expect(composed.every((r) => r.kind !== 'CallExpression')).toBe(true);
    expect(composed.every((r) => typeof r.route === 'string' && r.line > 0)).toBe(true);
  });

  it('exports every interface it now names, so a client can import it', () => {
    const exported = (file: string, name: string) =>
      new RegExp(`^export interface ${name} \\{`, 'm').test(
        readFileSync(`apps/api/src/modules/${file}`, 'utf8')
      );
    expect(
      exported('iam/application/access-administration-service.ts', 'AccessRecordCreated')
    ).toBe(true);
    expect(
      exported('technician/application/technician-roster-service.ts', 'HoldingWithdrawn')
    ).toBe(true);
    expect(
      exported('shared-services/application/status-transition-service.ts', 'StatusDescription')
    ).toBe(true);
    expect(exported('shared-services/application/template-service.ts', 'RenderedPreview')).toBe(
      true
    );
    expect(exported('shared-services/application/template-service.ts', 'TemplateCreated')).toBe(
      true
    );
    expect(exported('shared-services/application/attachment-service.ts', 'VersionRejected')).toBe(
      true
    );
    expect(exported('shared-services/application/attachment-service.ts', 'DocumentLinkRef')).toBe(
      true
    );
    expect(
      exported('shared-services/application/notification-read-service.ts', 'DeliveryHistory')
    ).toBe(true);
  });
});
