/**
 * `platform` module — public surface.
 *
 * This file is the ONLY legal import path for this module (ADR-001). Everything
 * under `application/` and `data/` is internal: the boundary checker and the
 * ESLint rule both reject `@/modules/platform/<anything>`.
 *
 * The twentieth module, and the prefix carries meaning: these are the only
 * operations in the product that are not inside a tenant. Introducing an `org.`
 * prefix instead would have meant a module named for a schema rather than for an
 * authority boundary, and the boundary is the point — every other module's
 * reads are narrowed by `iam.current_tenant_id()`, and this one's are narrowed
 * by `iam.has_platform_authority` instead.
 */
import { composeModule } from '@/server/layering';
import { PlatformRepository } from './data/platform-repository';
import { OrganizationService } from './application/organization-service';

export type { OrganizationView } from './application/organization-service';

/** Composition root: constructs the module's services once per process. */
export const platformModule = composeModule({
  module: 'platform',
  create: () => ({
    organizations: new OrganizationService(new PlatformRepository()),
  }),
});
