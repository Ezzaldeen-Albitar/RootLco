/**
 * Promotion-source policy (ADR-006 §45, §47).
 *
 * The four cases the governance gate names, plus the fail-closed path. Each is
 * a behaviour someone could plausibly break: the third and fourth exist because
 * the cheapest wrong implementation of this rule — "reject anything that is not
 * develop" — would break every ordinary pull request in the repository.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluatePromotionSource,
  PROMOTION_SOURCE,
  PROMOTION_TARGET,
} from '../../scripts/ci/check-promotion-source.mjs';

describe('promotion source policy', () => {
  it('allows develop -> main, the approved promotion', () => {
    const verdict = evaluatePromotionSource({ baseRef: 'develop', headRef: 'develop' });
    expect(verdict.allowed).toBe(true);
  });

  it('allows the promotion pair named by ADR-006', () => {
    const verdict = evaluatePromotionSource({
      baseRef: PROMOTION_TARGET,
      headRef: PROMOTION_SOURCE,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toContain('approved promotion');
  });

  it('rejects a feature branch targeting main', () => {
    const verdict = evaluatePromotionSource({
      baseRef: 'main',
      headRef: 'feature/p1-24-something',
    });
    expect(verdict.allowed).toBe(false);
    // The message must tell the author what to do, not merely that they failed.
    expect(verdict.reason).toContain('Merge');
    expect(verdict.reason).toContain('develop');
  });

  it('rejects a documentation branch targeting main directly', () => {
    // Documentation is the most tempting exception and gets none: a docs branch
    // that lands straight on main makes main a tree develop has never held.
    const verdict = evaluatePromotionSource({ baseRef: 'main', headRef: 'docs/p1-24-notes' });
    expect(verdict.allowed).toBe(false);
  });

  it('allows a documentation promotion that goes through develop', () => {
    const verdict = evaluatePromotionSource({ baseRef: 'main', headRef: 'develop' });
    expect(verdict.allowed).toBe(true);
  });

  it.each([
    ['a feature branch', 'feature/p1-24-something'],
    ['a fix branch', 'fix/p1-23-review-findings'],
    ['a gate branch', 'gate/p1-23-documents-notifications-reporting-backend'],
    ['a Dependabot branch', 'dependabot/npm_and_yarn/pino-10.0.0'],
    ['a chore branch', 'chore/main-governance-ruleset-alignment'],
  ])('leaves %s targeting develop completely unaffected', (_label, headRef) => {
    const verdict = evaluatePromotionSource({ baseRef: 'develop', headRef });
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toContain('does not apply');
  });

  it('does not constrain Dependabot on any base other than main', () => {
    const verdict = evaluatePromotionSource({
      baseRef: 'develop',
      headRef: 'dependabot/github_actions/actions/checkout-7.0.1',
    });
    expect(verdict.allowed).toBe(true);
  });

  it('rejects Dependabot targeting main, like any other non-develop source', () => {
    // Dependabot is not exempt. A dependency bump reaching main without passing
    // through develop is the same hole whoever opened it.
    const verdict = evaluatePromotionSource({
      baseRef: 'main',
      headRef: 'dependabot/npm_and_yarn/pino-10.0.0',
    });
    expect(verdict.allowed).toBe(false);
  });

  it.each([
    ['both refs missing', {}],
    ['no base', { headRef: 'develop' }],
    ['no head', { baseRef: 'main' }],
    ['blank strings', { baseRef: '   ', headRef: '   ' }],
  ])('fails CLOSED when %s', (_label, input) => {
    // A gate that cannot read the event must not report success. Defaulting to
    // "allowed" here would mean an event-shape change silently disables the rule.
    const verdict = evaluatePromotionSource(input);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('must not report success');
  });

  it('fails closed on a null input rather than throwing', () => {
    expect(evaluatePromotionSource(null).allowed).toBe(false);
    expect(evaluatePromotionSource(undefined).allowed).toBe(false);
  });
});
