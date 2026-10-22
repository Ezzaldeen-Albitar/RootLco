/**
 * The ONE place the export fixture's result field names are spelled.
 *
 * ## Why this file exists
 *
 * Two programs have to agree on one object and they live in different places. The writer is
 * `scripts/dev/owner-acceptance/export-fixture-setup.mjs`, which returns a result and nests it
 * under `result` in its evidence document. The reader is the acceptance companion, which is
 * held OUTSIDE this repository — for the reason the acceptance plan gives — spawns that command
 * and then reads keys off `parsed.result` with `?? null` defaults.
 *
 * `?? null` is what makes the disagreement silent. Rename a field in the writer and the reader
 * records `null` for it, the run finishes, and the evidence summary is a column of nulls that
 * nobody reads as a failure. The first version of the drift test could not catch that: it
 * compared a hand-written sample against a hand-copied key list, so both sides of the
 * comparison were typed out in the test and neither was the program under test.
 *
 * So the names live here, once, and both sides are held to this list:
 *
 *   - the writer builds its result through `buildExportFixtureResult`, which REFUSES an object
 *     whose keys are not exactly `EXPORT_FIXTURE_RESULT_FIELDS`. A rename in the writer is
 *     therefore a thrown error on the writer's own path, not a silent null downstream;
 *   - the reader imports this module out of the repository checkout it already resolves and
 *     validates the parsed object with `validateExportFixtureResult` before it summarises
 *     anything, so a missing field is a named fault in its ledger;
 *   - `tests/ci/p1-31-export-fixture-refusals.test.ts` drives the writer with a stub client and
 *     asserts the key set of the object it really returned equals this list.
 *
 * None of that needs a database, and none of it is a second copy of the names.
 *
 * ## Why the list is not derived from the writer
 *
 * Reading the keys off whatever the writer happens to return would make any rename agree with
 * itself. A contract that cannot disagree with its implementation is not a contract. This list
 * is therefore written down, and the writer is checked against it.
 */

/**
 * Every field the fixture's result carries, in the order the writer records them.
 *
 * The whole object, not only the part the reader consumes: the evidence file is a kept record,
 * and a field silently disappearing from it is the same defect as a field being renamed.
 */
export const EXPORT_FIXTURE_RESULT_FIELDS = Object.freeze([
  'kind',
  'outcome',
  'attempt',
  'attemptBound',
  'lease',
  'connectionRole',
  'dbTarget',
  'deferredConstraintsForced',
  'deferredConstraints',
  'tenantId',
  'tenantCode',
  'principal',
  'userId',
  'companyId',
  'branchId',
  'roleId',
  'roleCode',
  'grantId',
  'scope',
  'permissions',
  'validTo',
  'setupActor',
  'operatorAccountId',
  'approvalRef',
  'auditAction',
  'auditRecordId',
  'freshness',
]);

/**
 * The subset the companion actually reads off `parsed.result`.
 *
 * Held separately because the two questions are different. "Did the writer change shape?" is
 * asked of the whole list; "can the reader still do its job?" is asked of this one, and only
 * this one is worth failing a run over. Every name here is also in the list above, which
 * `assertContractIsInternallyConsistent` below checks at import time so the two cannot drift
 * apart inside this one file either.
 */
export const EXPORT_FIXTURE_RESULT_CONSUMED = Object.freeze([
  'kind',
  'outcome',
  'attempt',
  'lease',
  'connectionRole',
  'dbTarget',
  'deferredConstraintsForced',
  'roleId',
  'roleCode',
  'grantId',
  'scope',
  'validTo',
  'setupActor',
  'approvalRef',
  'auditAction',
  'auditRecordId',
  'permissions',
]);

function assertContractIsInternallyConsistent() {
  const declared = new Set(EXPORT_FIXTURE_RESULT_FIELDS);
  const unknown = EXPORT_FIXTURE_RESULT_CONSUMED.filter((field) => !declared.has(field));
  if (unknown.length > 0) {
    throw new Error(
      `The export fixture result contract is inconsistent: ${unknown.join(', ')} is consumed ` +
        'but is not one of the declared fields.'
    );
  }
}

assertContractIsInternallyConsistent();

/**
 * What a parsed `result` is missing, and what it carries that the contract does not name.
 *
 * Takes a plain parsed object — no class, no import of the writer — because the reader has
 * only JSON to work with. `missing` is the reader's problem: a field it needs is not there, so
 * its summary would record `null` for a fact it was asked to witness. `extra` is a weaker
 * signal, reported rather than enforced: a writer ahead of this contract is a drift to notice,
 * not a run to stop.
 */
export function validateExportFixtureResult(result) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return { missing: [...EXPORT_FIXTURE_RESULT_CONSUMED], extra: [] };
  }
  const present = new Set(Object.keys(result));
  const declared = new Set(EXPORT_FIXTURE_RESULT_FIELDS);
  return {
    missing: EXPORT_FIXTURE_RESULT_CONSUMED.filter((field) => !present.has(field)),
    extra: [...present].filter((field) => !declared.has(field)),
  };
}

/**
 * The result object itself, assembled from the contract and refused when it does not match.
 *
 * The writer passes its values in and gets back an object whose keys are exactly
 * `EXPORT_FIXTURE_RESULT_FIELDS`, in that order. A field the writer forgot, misspelled or
 * renamed is a thrown error here — on the writer's own path, before the transaction ends —
 * rather than a null in the reader's summary two programs later.
 *
 * A value of `null` or `undefined` is a legitimate value for some fields (`approvalRef` is
 * always null), so the check is on the KEY being present, not on the value being truthy.
 */
export function buildExportFixtureResult(values) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('The export fixture result must be built from an object of field values.');
  }
  const given = new Set(Object.keys(values));
  const missing = EXPORT_FIXTURE_RESULT_FIELDS.filter((field) => !given.has(field));
  const unknown = [...given].filter((field) => !EXPORT_FIXTURE_RESULT_FIELDS.includes(field));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      'The export fixture result does not match its contract ' +
        '(scripts/dev/owner-acceptance/export-fixture-result-contract.mjs): ' +
        `${missing.length > 0 ? `no ${missing.join(', ')}` : 'nothing missing'}; ` +
        `${unknown.length > 0 ? `unknown ${unknown.join(', ')}` : 'nothing unknown'}. ` +
        'The reader defaults every field it cannot find to null, so a rename here has to fail ' +
        'loudly rather than quietly.'
    );
  }
  const result = {};
  for (const field of EXPORT_FIXTURE_RESULT_FIELDS) result[field] = values[field];
  return result;
}
