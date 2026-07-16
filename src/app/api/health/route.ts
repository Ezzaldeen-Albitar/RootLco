/**
 * GET /api/health
 *
 * P1-01-DO-002 (environment readiness) and the Docker container health check.
 *
 * Returns only safe information. It must never expose secrets, connection strings,
 * keys, or environment variable values. `configured` is a boolean derived from
 * schema validation -- it reports THAT configuration resolved, never WHAT it is.
 */
import { NextResponse } from 'next/server';
import { environmentIsConfigured } from '@/config/env';
import { APP_NAME, APP_VERSION, COMMIT_SHA } from '@/shared/constants/app';

// Health must reflect the live process, never a cached render.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export type HealthResponse = {
  status: 'ok' | 'degraded';
  service: string;
  environment: string;
  configured: boolean;
  version: string;
  commit: string;
  timestamp: string;
};

export function GET(): NextResponse<HealthResponse> {
  const configured = environmentIsConfigured();

  const body: HealthResponse = {
    // "degraded" rather than a hard failure: the container is alive and serving,
    // but its Supabase configuration has not resolved. Distinguishing the two is
    // what makes the Docker health check meaningful.
    status: configured ? 'ok' : 'degraded',
    service: APP_NAME,
    environment: process.env.NEXT_PUBLIC_APP_ENV ?? 'local',
    configured,
    version: APP_VERSION,
    commit: COMMIT_SHA,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: configured ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
