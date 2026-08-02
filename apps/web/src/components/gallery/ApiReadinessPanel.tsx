import { translate, type Messages } from '@/i18n/get-messages';
import { ApiClient, assertBaseUrl } from '@/lib/api/client';
import { env } from '@/lib/env';

/**
 * The API/Web reference integration, made visible.
 *
 * A server component that calls `GET /api/v1/health/ready` through the one
 * `ApiClient` the web tier owns and renders the verdict. It exists so "API and
 * Web are connected" is something an owner can SEE on the gallery page rather
 * than something a document asserts.
 *
 * Deliberate choices:
 *
 * - **Server-side, not browser-side.** The call runs during the render, so the
 *   local topology needs no CORS surface at all — the browser only ever talks
 *   to the web origin. When a browser-originated call is introduced (P1-26
 *   authenticated screens), CORS becomes a real decision made on purpose, not
 *   a side effect of a status panel.
 * - **The readiness body is already a verdict, never a topology** (P1-15). We
 *   render its overall status and nothing else, so this panel cannot become
 *   the place where an internal detail leaks.
 * - **Failure is a first-class rendering,** distinguished the way the shared
 *   states are: unreachable is not the same as misconfigured, and neither is
 *   an error page.
 */

interface ReadinessBody {
  readonly status?: string;
}

export type ReadinessOutcome = 'ready' | 'degraded' | 'unavailable' | 'misconfigured';

export function classifyReadiness(
  result: { ok: true; data: unknown } | { ok: false; kind: string }
): ReadinessOutcome {
  if (!result.ok) return 'unavailable';
  const status = (result.data as ReadinessBody | null)?.status;
  return status === 'degraded' ? 'degraded' : 'ready';
}

const MESSAGE_KEY: Record<ReadinessOutcome, keyof Messages> = {
  ready: 'gallery.readiness.ready',
  degraded: 'gallery.readiness.degraded',
  unavailable: 'gallery.readiness.unavailable',
  misconfigured: 'gallery.readiness.misconfigured',
};

const TONE: Record<ReadinessOutcome, string> = {
  ready: 'text-success',
  degraded: 'text-warning',
  unavailable: 'text-error',
  misconfigured: 'text-error',
};

export async function ApiReadinessPanel({ messages }: { readonly messages: Messages }) {
  let outcome: ReadinessOutcome;
  try {
    const client = new ApiClient({ baseUrl: assertBaseUrl(env.NEXT_PUBLIC_API_BASE_URL) });
    // No retries: a status panel should show the truth of THIS moment, and the
    // gallery page render should not stall through a retry ladder.
    const result = await client.get<ReadinessBody>('/api/v1/health/ready', { retries: 0 });
    outcome = classifyReadiness(result);
  } catch {
    outcome = 'misconfigured';
  }

  return (
    <section
      aria-labelledby="api-readiness-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h3 id="api-readiness-heading" className="text-sm font-semibold text-text-primary">
        {translate(messages, 'gallery.readiness.title')}
      </h3>
      <p data-outcome={outcome} className={`mt-2 text-sm ${TONE[outcome]}`}>
        {translate(messages, MESSAGE_KEY[outcome])}
      </p>
    </section>
  );
}
