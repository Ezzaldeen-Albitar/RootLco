/**
 * `scripts/ci/landing-guard.mjs`: the landing owner's assigned-PR and
 * approved-head check, against an in-memory GitHub.
 */
import { describe, expect, it } from 'vitest';
import {
  LandingRefused,
  REVIEW_CONTEXT,
  landingRefusals,
  parseArguments,
  runLandingGuard,
} from '../../scripts/ci/landing-guard.mjs';

const HEAD = 'c'.repeat(40);
const OTHER = 'd'.repeat(40);
const OPTIONS = { pr: 600, approvedHead: HEAD, markReviewed: true, repository: 'owner/repo' };

const pull = (overrides: Record<string, unknown> = {}) => ({
  number: 600,
  state: 'open',
  merged: false,
  draft: false,
  base: { ref: 'develop' },
  head: { sha: HEAD },
  ...overrides,
});

function recordingApi(reads: unknown[]) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (method === 'GET') return reads.shift();
    return {};
  };
  return { api, calls };
}

describe('the landing guard refuses', () => {
  it.each([
    ['a closed pull request', { state: 'closed' }, /not open/],
    ['a merged pull request', { merged: true }, /already merged/],
    ['a draft', { draft: true }, /is a draft/],
    ['a pull request into main', { base: { ref: 'main' } }, /based on 'main', not develop/],
    ['a head that is not the approved head', { head: { sha: OTHER } }, /not the approved head/],
    ['an answer for another pull request', { number: 503 }, /answered for #503/],
  ])('%s', (_label, overrides, reason) => {
    expect(landingRefusals(pull(overrides), OPTIONS).join('; ')).toMatch(reason);
  });

  it('and sets no status when it refuses', async () => {
    const { api, calls } = recordingApi([pull({ head: { sha: OTHER } })]);
    await expect(runLandingGuard(OPTIONS, api)).rejects.toBeInstanceOf(LandingRefused);
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('when the head moves while the status is being set', async () => {
    const { api } = recordingApi([pull(), pull({ head: { sha: OTHER } })]);
    await expect(runLandingGuard(OPTIONS, api)).rejects.toThrow(
      /changed while it was being marked/
    );
  });
});

describe('the landing guard passes', () => {
  it('an open pull request into develop at the approved head, and marks that head', async () => {
    const { api, calls } = recordingApi([pull(), pull()]);
    await expect(runLandingGuard(OPTIONS, api)).resolves.toEqual({ statusSet: true });
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe(`repos/owner/repo/statuses/${HEAD}`);
    expect(post?.body).toMatchObject({ state: 'success', context: REVIEW_CONTEXT });
  });

  it('without marking when --mark-reviewed is absent', async () => {
    const { api, calls } = recordingApi([pull()]);
    await expect(runLandingGuard({ ...OPTIONS, markReviewed: false }, api)).resolves.toEqual({
      statusSet: false,
    });
    expect(calls).toHaveLength(1);
  });
});

describe('arguments', () => {
  it('require a pull request number and a full approved head', () => {
    expect(() => parseArguments(['--approved-head', HEAD], {})).toThrow(/--pr/);
    expect(() => parseArguments(['--pr', '600', '--approved-head', 'c0ffee'], {})).toThrow(
      /40-character/
    );
    expect(() => parseArguments(['--pr', 'x', '--approved-head', HEAD], {})).toThrow(/--pr/);
    expect(parseArguments(['--pr', '600', '--approved-head', HEAD, '--mark-reviewed'], {})).toEqual(
      { pr: 600, approvedHead: HEAD, markReviewed: true, repository: 'Ezzaldeen-Albitar/RootLco' }
    );
  });
});
