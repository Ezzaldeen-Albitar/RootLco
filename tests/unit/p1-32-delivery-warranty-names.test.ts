import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The people on a handover and on a warranty's history are named beside their
 * ids (Owner directive, the delivery and warranty Material UI slice; browser QA
 * DEF-R2 and row 4.1b).
 *
 * The receiver read and both status-history reads used to publish only ids, so
 * the screens printed "Recorded by, employee reference e4065924-…". Each read now
 * adds the name beside the id, and ONLY through the owning module's own
 * capability-checked read: the CRM module's `resolveDisplayIdentities` (which
 * answers nothing to a caller without `crm.customer.read`) for the receiver, and
 * the identity directory (which answers nothing without `iam.user.read`) for the
 * people who confirmed and recorded. So a name is never shown to somebody the
 * owning module would not show it to, and the ids are published exactly as before.
 *
 * The repositories are stand-ins and both name lookups are replaced, so what is
 * observed is exactly what each read asks for and hands back. The scope check is
 * the real order: the record is read, then authorized, then named.
 */

const resolveUsers = vi.fn();
const resolvePartners = vi.fn();

vi.mock('@api/modules/iam', () => ({
  iamDirectory: () => ({ directory: { resolveDisplayIdentities: resolveUsers } }),
}));
vi.mock('@api/modules/crm', () => ({
  crmModule: () => ({ customerRead: { resolveDisplayIdentities: resolvePartners } }),
}));

const { DeliveryReadService } =
  await import('@api/modules/delivery/application/delivery-read-service');
const { WarrantyService } = await import('@api/modules/warranty/application/warranty-service');

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const DELIVERY = '33333333-3333-4333-8333-333333333333';
const WARRANTY = '44444444-4444-4444-8444-444444444444';
const PARTNER = '55555555-5555-4555-8555-555555555555';
const CONFIRMER = '66666666-6666-4666-8666-666666666666';
const RECORDER = '77777777-7777-4777-8777-777777777777';
const STRANGER = '88888888-8888-4888-8888-888888888888';

const db = {} as never;
const authorizeScope = vi.fn(async () => undefined);

const deliveryRow = {
  id: DELIVERY,
  companyId: COMPANY,
  branchId: BRANCH,
  workOrderId: '99999999-9999-4999-8999-999999999999',
  receptionVisitId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  vehicleId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  deliveringEmployeeId: CONFIRMER,
  deliveringEmployeeDisplayName: 'Rana Haddad',
  status: 'ready',
  deliveredAt: null,
  finalOdometerReadingId: null,
  idempotencyKey: null,
  recordVersion: 3,
};

const receiverRow = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  companyId: COMPANY,
  branchId: BRANCH,
  deliveryRecordId: DELIVERY,
  receiverPartnerId: PARTNER,
  identityEvidenceDocumentVersionId: null,
  verifiedBy: CONFIRMER,
  verifiedAt: new Date('2026-09-24T17:02:42Z'),
  recordVersion: 1,
};

const transition = (id: string, actorId: string) => ({
  id,
  deliveryRecordId: DELIVERY,
  fromStatus: null,
  toStatus: 'ready',
  reason: null,
  actorId,
  occurredAt: new Date('2026-09-24T17:04:00Z'),
});

function deliveryRepository(overrides: Record<string, unknown> = {}) {
  return {
    findDelivery: vi.fn(async () => deliveryRow),
    findReceiver: vi.fn(async () => receiverRow),
    listStatusHistory: vi.fn(async () => ({
      items: [transition('h1', RECORDER), transition('h2', RECORDER), transition('h3', STRANGER)],
      nextCursor: null,
      hasMore: false,
    })),
    ...overrides,
  } as never;
}

beforeEach(() => {
  resolveUsers.mockReset();
  resolvePartners.mockReset();
  authorizeScope.mockClear();
});

describe('sal.delivery-receiver-read names the receiver and the confirming user', () => {
  it('publishes both names beside the unchanged ids', async () => {
    resolvePartners.mockResolvedValue(
      new Map([[PARTNER, { id: PARTNER, displayName: 'Omar Khalil' }]])
    );
    resolveUsers.mockResolvedValue(
      new Map([[CONFIRMER, { id: CONFIRMER, displayName: 'Rana Haddad' }]])
    );
    const service = new DeliveryReadService(deliveryRepository());
    const envelope = await service.readReceiver(db, DELIVERY, authorizeScope);

    expect(envelope.receiver).toMatchObject({
      receiverPartnerId: PARTNER,
      receiverDisplayName: 'Omar Khalil',
      verifiedBy: CONFIRMER,
      verifiedByDisplayName: 'Rana Haddad',
    });
    // Each name comes from its owning module's own read, asked for exactly that id.
    expect(resolvePartners).toHaveBeenCalledWith(db, [PARTNER]);
    expect(resolveUsers).toHaveBeenCalledWith(db, [CONFIRMER]);
  });

  it('answers null names, never an id, when the owning module resolves nobody', async () => {
    // What either module answers a caller without its read code: an empty map.
    resolvePartners.mockResolvedValue(new Map());
    resolveUsers.mockResolvedValue(new Map());
    const service = new DeliveryReadService(deliveryRepository());
    const envelope = await service.readReceiver(db, DELIVERY, authorizeScope);

    expect(envelope.receiver?.receiverDisplayName).toBeNull();
    expect(envelope.receiver?.verifiedByDisplayName).toBeNull();
    expect(envelope.receiver?.receiverPartnerId).toBe(PARTNER);
    expect(envelope.receiver?.verifiedBy).toBe(CONFIRMER);
  });

  it('asks for no name before a receiver exists', async () => {
    const service = new DeliveryReadService(
      deliveryRepository({ findReceiver: vi.fn(async () => null) })
    );
    const envelope = await service.readReceiver(db, DELIVERY, authorizeScope);

    expect(envelope).toEqual({ deliveryId: DELIVERY, receiver: null });
    expect(resolvePartners).not.toHaveBeenCalled();
    expect(resolveUsers).not.toHaveBeenCalled();
  });

  it('names nobody for a delivery the caller may not read', async () => {
    const refused = new Error('refused');
    const service = new DeliveryReadService(deliveryRepository());
    await expect(
      service.readReceiver(db, DELIVERY, async () => {
        throw refused;
      })
    ).rejects.toBe(refused);
    expect(resolvePartners).not.toHaveBeenCalled();
    expect(resolveUsers).not.toHaveBeenCalled();
  });
});

describe('sal.delivery-status-history names each actor', () => {
  it('resolves the page in one lookup of its distinct actors and keeps every id', async () => {
    resolveUsers.mockResolvedValue(
      new Map([[RECORDER, { id: RECORDER, displayName: 'Sami Aziz' }]])
    );
    const service = new DeliveryReadService(deliveryRepository());
    const envelope = await service.readStatusHistory(db, DELIVERY, {}, authorizeScope);

    expect(resolveUsers).toHaveBeenCalledTimes(1);
    expect(resolveUsers).toHaveBeenCalledWith(db, [RECORDER, STRANGER]);
    expect(envelope.transitions.items.map((row) => [row.actorId, row.actorDisplayName])).toEqual([
      [RECORDER, 'Sami Aziz'],
      [RECORDER, 'Sami Aziz'],
      // An actor the directory did not resolve for this caller has no name.
      [STRANGER, null],
    ]);
  });

  it('names nobody for a delivery the caller may not read', async () => {
    const service = new DeliveryReadService(deliveryRepository());
    await expect(
      service.readStatusHistory(db, DELIVERY, {}, async () => {
        throw new Error('refused');
      })
    ).rejects.toThrow('refused');
    expect(resolveUsers).not.toHaveBeenCalled();
  });
});

describe('wty.warranty-status-history names each actor', () => {
  function warrantyRepository() {
    return {
      findWarrantyRecord: vi.fn(async () => ({
        record: { id: WARRANTY, companyId: COMPANY, branchId: BRANCH },
        items: [],
      })),
      listStatusHistory: vi.fn(async () => ({
        items: [
          {
            id: 'w1',
            warrantyRecordId: WARRANTY,
            fromStatus: null,
            toStatus: 'issued',
            reason: null,
            actorId: RECORDER,
            occurredAt: new Date('2026-09-24T17:05:00Z'),
          },
        ],
        nextCursor: null,
        hasMore: false,
      })),
    } as never;
  }

  it('publishes the name the identity directory resolved, beside the id', async () => {
    resolveUsers.mockResolvedValue(
      new Map([[RECORDER, { id: RECORDER, displayName: 'Sami Aziz' }]])
    );
    const service = new WarrantyService(warrantyRepository());
    const envelope = await service.readStatusHistory(db, WARRANTY, {}, authorizeScope);

    expect(resolveUsers).toHaveBeenCalledWith(db, [RECORDER]);
    expect(envelope.transitions.items[0]).toMatchObject({
      actorId: RECORDER,
      actorDisplayName: 'Sami Aziz',
    });
  });

  it('answers a null name to a caller the directory answers nothing', async () => {
    resolveUsers.mockResolvedValue(new Map());
    const service = new WarrantyService(warrantyRepository());
    const envelope = await service.readStatusHistory(db, WARRANTY, {}, authorizeScope);

    expect(envelope.transitions.items[0]?.actorDisplayName).toBeNull();
    expect(envelope.transitions.items[0]?.actorId).toBe(RECORDER);
  });
});

/**
 * The receptionist-facing manual describes the handover and warranty screens as
 * they now are: people and vehicles in words, no internal reference printed.
 *
 * Every catalogue key the manual anchors for a label on these screens must be a
 * key the delivery or warranty screens still render, so a passage describing a
 * retired label (the four summary references, the item source references) fails
 * here; and the retired wording itself — "employee reference", the sentence that
 * said references are shown as stored — must not come back.
 */
describe('the user manual describes the named handover and warranty screens', () => {
  const root = process.cwd();
  const manuals = [
    join(root, 'docs', 'user-manual', '04d-delivery-and-warranty.md'),
    join(root, 'docs', 'user-manual', 'first-login-and-first-working-day.md'),
  ].map((file) => ({ file, text: readFileSync(file, 'utf8') }));

  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) ? [readFileSync(full, 'utf8')] : [];
    });
  const screens = [
    ...sources(join(root, 'apps', 'web', 'src', 'features', 'delivery')),
    ...sources(join(root, 'apps', 'web', 'src', 'features', 'warranty')),
  ].join('\n');
  const rendered = (key: string) =>
    [`'${key}'`, `"${key}"`].some((quoted) => screens.includes(quoted));

  const LABEL_KEY =
    /^(?:delivery\.summary\.|delivery\.person\.|delivery\.receiver\.(?:partner|verifiedBy)$|delivery\.history\.actor|warranty\.summary\.|warranty\.items\.|warranty\.history\.actor)/;
  const anchoredKeys = (text: string): string[] =>
    [...text.matchAll(/<!--([^>]*?)-->/g)].flatMap((anchor) =>
      [...(anchor[1] ?? '').matchAll(/(?<![\w.])[a-z]+(?:\.\w+)+/g)].map((match) => match[0])
    );

  it('anchors only labels the screens still render', () => {
    for (const { file, text } of manuals) {
      const stale = anchoredKeys(text).filter((key) => LABEL_KEY.test(key) && !rendered(key));
      expect(stale, `${file} documents labels no screen renders`).toEqual([]);
    }
  });

  it('documents the names and the words said when a name cannot be shown', () => {
    const [handover] = manuals;
    const keys = anchoredKeys(handover?.text ?? '');
    for (const key of [
      'delivery.summary.deliveringEmployee',
      'delivery.person.notShown',
      'delivery.summary.finalOdometerNotShown',
      'warranty.history.actorNotShown',
    ]) {
      expect(rendered(key), `${key} is rendered`).toBe(true);
      expect(keys, `the manual anchors ${key}`).toContain(key);
    }
  });

  it('no longer says that people or the summary are shown as references', () => {
    for (const { file, text } of manuals) {
      expect(text, file).not.toMatch(/employee\s+reference/i);
      expect(text, file).not.toMatch(/each reference is shown exactly as it is stored/i);
      expect(text, file).not.toMatch(/show a bare reference/i);
    }
  });
});
