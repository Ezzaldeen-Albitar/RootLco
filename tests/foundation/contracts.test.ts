/**
 * Protects the honesty of the contract-only foundation services.
 *
 * The dangerous alternative is a stub that returns an empty success: a caller
 * would believe a document exists or a message was queued, and the defect would
 * surface much later as missing data with no failure anywhere in the trail. A
 * cataloged 501 is loud, correlated, and impossible to mistake for success.
 *
 * The method list is derived from the prototype rather than hand-written, so a
 * method added to the interface later cannot quietly ship without this guarantee.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  NotImplementedFileService,
  fileService,
  setFileService,
  __resetFileServiceForTests,
} from '@/server/contracts/file-service';
import {
  NotImplementedNotificationService,
  notificationService,
  setNotificationService,
  __resetNotificationServiceForTests,
} from '@/server/contracts/notification-service';
import { AppFailure, isAppFailure } from '@/server/errors/app-failure';

/** Every own prototype method, so a later addition is covered automatically. */
function methodNames(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .sort();
}

type NoArgMethod = () => Promise<unknown>;

async function expectNotImplemented(invoke: NoArgMethod, contract: string): Promise<void> {
  const thrown: unknown = await invoke().then(
    () => undefined,
    (error: unknown) => error
  );

  expect(isAppFailure(thrown)).toBe(true);
  const failure = thrown as AppFailure;
  expect(failure.code).toBe('ERR-STB-001');
  expect(failure.status).toBe(501);
  expect(failure.safeDetails.contract).toBe(contract);
}

afterEach(() => {
  __resetFileServiceForTests();
  __resetNotificationServiceForTests();
});

describe('NotImplementedFileService', () => {
  const stub = new NotImplementedFileService();

  it('exposes exactly the frozen interface surface', () => {
    expect(methodNames(NotImplementedFileService.prototype)).toEqual([
      'authorizeUpload',
      'registerVersion',
      'requestDownload',
    ]);
  });

  it.each([
    { name: 'authorizeUpload', invoke: (): Promise<unknown> => stub.authorizeUpload() },
    { name: 'registerVersion', invoke: (): Promise<unknown> => stub.registerVersion() },
    { name: 'requestDownload', invoke: (): Promise<unknown> => stub.requestDownload() },
  ])('rejects $name with ERR-STB-001 naming the contract', async ({ invoke }) => {
    await expectNotImplemented(invoke, 'FileService');
  });

  it('never resolves to an empty success that a caller could mistake for a result', async () => {
    await expect(stub.authorizeUpload()).rejects.toBeInstanceOf(AppFailure);
  });

  it('is the installed default and can be replaced by composition', () => {
    expect(fileService()).toBeInstanceOf(NotImplementedFileService);

    const replacement = new NotImplementedFileService();
    setFileService(replacement);
    expect(fileService()).toBe(replacement);

    __resetFileServiceForTests();
    expect(fileService()).not.toBe(replacement);
  });
});

describe('NotImplementedNotificationService', () => {
  const stub = new NotImplementedNotificationService();

  it('exposes exactly the frozen interface surface', () => {
    expect(methodNames(NotImplementedNotificationService.prototype)).toEqual(['queueMessage']);
  });

  it.each([{ name: 'queueMessage', invoke: (): Promise<unknown> => stub.queueMessage() }])(
    'rejects $name with ERR-STB-001 naming the contract',
    async ({ invoke }) => {
      await expectNotImplemented(invoke, 'NotificationService');
    }
  );

  it('is the installed default and can be replaced by composition', () => {
    expect(notificationService()).toBeInstanceOf(NotImplementedNotificationService);

    const replacement = new NotImplementedNotificationService();
    setNotificationService(replacement);
    expect(notificationService()).toBe(replacement);

    __resetNotificationServiceForTests();
    expect(notificationService()).not.toBe(replacement);
  });
});
