/**
 * `meta` module — public surface.
 *
 * This file is the ONLY legal import path for this module (ADR-001). Everything
 * under `application/`, `domain/`, and `data/` is internal: the boundary checker
 * and the ESLint rule both reject `@/modules/meta/<anything>`.
 *
 * A module exports *behaviour and types*, never its repositories. Handing out a
 * repository would let a caller run SQL under someone else's module identity and
 * bypass that module's invariants.
 */
import { composeModule } from '@/server/layering';
import { MetaRepository } from './data/meta-repository';
import { PingPolicy } from './domain/ping-policy';
import { PingService } from './application/ping-service';

export type { PingResult } from './application/ping-service';

/** Composition root: constructs the module's services once per process. */
export const metaModule = composeModule({
  module: 'meta',
  create: () => ({
    ping: new PingService(new MetaRepository(), new PingPolicy()),
  }),
});
