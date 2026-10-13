/**
 * P1-31 Owner decision D-18 — the rule that decides whether a document's category is
 * the approved identity-evidence category.
 *
 * The receiver-verification path refuses identity evidence unless this predicate
 * holds. The backend suite proves the reachable refusals against a database; this
 * suite proves the predicate itself, including the one branch a database cannot
 * reach without bypassing `shared.guard_document_category_scope`: a document whose
 * category is not visible at all, which arrives here as `null` and must fail closed.
 *
 * Every refused case differs from the approved one in exactly one fact, so a refusal
 * cannot be passing for a reason other than the fact it names.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RECEIVER_IDENTITY_EVIDENCE_CATEGORY,
  isApprovedIdentityEvidenceCategory,
  type EvidenceCategoryFacts,
} from '@/modules/delivery/domain/delivery';

const APPROVED: EvidenceCategoryFacts = Object.freeze({
  code: RECEIVER_IDENTITY_EVIDENCE_CATEGORY,
  scope: 'platform',
  status: 'active',
  deleted: false,
});

describe('isApprovedIdentityEvidenceCategory (D-18)', () => {
  it('accepts the platform-scoped, active, live identity-evidence category', () => {
    expect(isApprovedIdentityEvidenceCategory(APPROVED)).toBe(true);
  });

  it('fails closed when the category is missing or not visible', () => {
    expect(isApprovedIdentityEvidenceCategory(null)).toBe(false);
  });

  it.each([
    ['another code, even a reception identity category', { code: 'reception_vin' }],
    ['a tenant override that reuses the approved code', { scope: 'tenant' }],
    ['the approved category while it is disabled', { status: 'disabled' }],
    ['the approved category once it is soft-deleted', { deleted: true }],
  ] as const)('refuses %s', (_label, change) => {
    expect(isApprovedIdentityEvidenceCategory({ ...APPROVED, ...change })).toBe(false);
  });

  it('names the code the reference seed ships as a platform identity-purpose row', () => {
    const seed = readFileSync(
      join(process.cwd(), 'supabase', 'seeds', '05_shared_reference.sql'),
      'utf8'
    );
    const row = seed
      .split('\n')
      .find((line) => line.includes(`'${RECEIVER_IDENTITY_EVIDENCE_CATEGORY}'`));
    expect(row).toBeDefined();
    expect(row).toContain("'platform',NULL,");
    expect(row).toContain("'identity_document'");
    expect(row).toContain("'active'");
  });
});
