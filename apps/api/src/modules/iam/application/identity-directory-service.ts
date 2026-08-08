/**
 * Naming an actor, for the modules that hold an actor id (`P1-27-INT-026`).
 *
 * ## Why this is its own service and not a method on `UserAdministrationService`
 *
 * Not tidiness — a coupling.
 *
 * `UserAdministrationService` takes an `IdentityProvider`, so reaching it means
 * going through `iamModule()`, whose composition root calls
 * `installIamRuntime()`. That builds the Supabase adapter from configuration and
 * reads `clientEnv()`. The consequence is that ANY module composing IAM to ask
 * "what is this person called" makes its own read depend on
 * `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — and answer
 * `ERR-SYS-001` wherever those are unset. That was measured, not feared: wiring
 * the vehicle history read to `iamModule()` turned two green backend tests into
 * 500s.
 *
 * The repository already knew. `server/auth/authorization.ts:171-174` and
 * `:232-233` both refuse to route a permission check through `@/modules/iam`,
 * in prose, because "routing it through `@/modules/iam` would force that
 * module's composition root — including its Supabase client configuration — to
 * boot on any request that prices a discounted line, which is a coupling a
 * permission check has no business creating." Two phases hit this wall and
 * routed around it. This removes the wall for reads instead.
 *
 * So the directory holds exactly one dependency — the repository — and is
 * composed by `iamDirectory()`, which constructs no provider and installs no
 * authenticator. `iamModule()` is untouched: every existing consumer, and the
 * authentication bootstrap that depends on it, behaves exactly as before.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import type { IdentityRepository, UserDisplayIdentity } from '../data/identity-repository';

export class IdentityDirectoryService extends ApplicationService {
  protected readonly module = 'iam';

  constructor(private readonly identities: IdentityRepository) {
    super();
  }

  /**
   * Display identity for a set of actor ids.
   *
   * ## It narrows, and never widens
   *
   * `iam.user-detail` is guarded by `iam.user.read`; the reads that carry actor
   * ids are guarded by their own domain permission. Resolving for every caller
   * would hand a tenant-wide staff directory to anyone who can open a vehicle,
   * so the capability is checked first and an unentitled caller gets an EMPTY
   * map — no name, and nothing they did not already have.
   *
   * NOT "strictly less information than the uuid it used to print", which is
   * what this said before and is false: the actor id is still published
   * alongside the name, so the change is additive. What the caller's SCREEN
   * shows is the frontend's decision; this service publishes an absence.
   *
   * ## It does not throw
   *
   * An id this caller cannot resolve is simply absent from the map. Failing a
   * whole history because one actor could not be named would hide the record of
   * what happened to a vehicle, which is the thing the screen exists to show.
   */
  async resolveDisplayIdentities(
    db: DbHandle,
    userIds: readonly string[]
  ): Promise<ReadonlyMap<string, UserDisplayIdentity>> {
    if (userIds.length === 0) return new Map();
    if (!(await this.identities.mayReadUsers(db))) return new Map();
    return this.identities.findDisplayIdentities(db, userIds);
  }
}
