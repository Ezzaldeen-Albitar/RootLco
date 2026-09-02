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
    expect(summary.bodies).toBe(351);
    expect(summary.named).toBe(300);
    expect(summary.composed).toBe(51);
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
