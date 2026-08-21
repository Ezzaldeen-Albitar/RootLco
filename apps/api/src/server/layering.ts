/**
 * Application- and domain-service layering (P1-13-BE-002).
 *
 * Three layers, each with one job:
 *
 *  - **Application service** — the use case. Orchestrates: opens nothing, but
 *    receives the transaction handle, calls domain services and repositories in
 *    order, publishes events, emits audit. Knows about the request; knows
 *    nothing about HTTP.
 *  - **Domain service** — the rules. Pure decision-making over values it is
 *    given. It must not touch the database: `DomainService` has no access to a
 *    `DbHandle` in its signature, and the boundary checker forbids
 *    a module's `domain` directory from importing `@/server/db`. Rules that can be
 *    unit-tested without a database get unit-tested without a database.
 *  - **Repository** — the SQL, behind the context guard (`db/repository.ts`).
 *
 * Route Handlers and Server Actions hold none of this: they parse, call one
 * application service, and return. The layering is enforced by the boundary
 * checker rather than by review habit.
 */
import type { DbHandle } from './db/transaction';
import type { RequestContext } from './context/request-context';

/**
 * Base for an application service.
 *
 * The transaction handle is passed per call rather than held on the instance:
 * a service instance may outlive a request (it is cheap and stateless), and
 * holding a handle would let one request's transaction leak into another's.
 */
export abstract class ApplicationService {
  /** Owning module. Used in logs, audit references, and boundary checks. */
  protected abstract readonly module: string;

  /** Convenience accessor; also documents that context comes from the handle. */
  protected contextOf(db: DbHandle): RequestContext {
    return db.context;
  }
}

/**
 * Base for a domain service. Deliberately has no database access of any kind —
 * not even an injected one. A rule that needs to read state receives that state
 * as an argument from the application service.
 */
export abstract class DomainService {
  protected abstract readonly module: string;
}

/**
 * Minimal composition root per module.
 *
 * Full dependency-injection containers are avoided on purpose: they trade
 * explicit wiring for runtime resolution, and the failure mode is a missing
 * binding discovered in production. A module exposes a factory that constructs
 * its services with their dependencies, and the type system checks the wiring.
 */
export interface ModuleComposition<TServices> {
  readonly module: string;
  /** Builds the module's public services. Called once per process. */
  create(): TServices;
}

/** Memoises a module composition so services are constructed once. */
export function composeModule<TServices>(
  composition: ModuleComposition<TServices>
): () => TServices {
  let instance: TServices | undefined;
  return () => {
    if (instance === undefined) instance = composition.create();
    return instance;
  };
}
