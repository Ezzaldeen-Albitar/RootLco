/**
 * The technician module's LABEL port (Owner directive — the tenant dashboard).
 *
 * ## Why this exists at all
 *
 * `wo.job_assignments` carries a `technician_profile_id` and nothing readable: a
 * workload figure keyed on a UUID is a figure nobody can act on. The profile is
 * a `tech.*` row, private to this module (ADR-001 rule 3), so the mapping from
 * profile to person is this module's to perform and the consumer asks for it.
 *
 * ## Why a separate class rather than a method on the roster service
 *
 * `TechnicianRosterService` creates, updates and retires profiles, attaches
 * skills and records certifications. Handing it to a read-only dashboard under a
 * second name would hand that dashboard every roster write. This class holds one
 * read — the same argument `LaborReportPort`'s header makes, and the same shape.
 *
 * ## A null label is a REAL state, not a missing value
 *
 * This module holds no names: `tech.technician_profiles` carries `user_id` and
 * nothing human-readable, so a label comes from the iam directory. That
 * directory NARROWS and never widens — a caller without `iam.user.read` gets an
 * EMPTY map — so the label is `null` and the profile id is published beside it
 * either way. Null therefore means "this caller may not be told who that is",
 * which is rendered rather than invented, exactly as the labour report treats it.
 *
 * ## It performs NO authorization
 *
 * The caller has already evaluated its own permission against the company and
 * branches whose assignments it counted. Resolving a name is narrowed twice over
 * without any check here: RLS narrows `tech.technician_profiles` to the caller's
 * reach, and the directory refuses a caller that may not read users.
 */
import { ApplicationService } from '@/server/layering';
import { iamDirectory } from '@/modules/iam';
import type { DbHandle } from '@/server/db/transaction';
import type { TechnicianRosterRepository } from '../data/technician-roster-repository';

export class TechnicianLabelPort extends ApplicationService {
  protected readonly module = 'technician';

  constructor(private readonly roster: TechnicianRosterRepository) {
    super();
  }

  /**
   * A display name for each profile id, or null where one cannot be told.
   *
   * BATCHED — one statement for the profiles and one for the identities,
   * whatever the size of the input. A per-row lookup would make any consumer
   * that lists technicians an N+1, which is why `workOrdersForJobs` and
   * `jobsWithOpenSession` are both batched too.
   *
   * A profile id this caller cannot see is simply absent from the result. It is
   * not reported as an error and not filled with a placeholder: the honest
   * reading is that the consumer holds an id it may not resolve, and inventing a
   * label for it would be the platform making up a person.
   */
  async labelsForProfiles(
    db: DbHandle,
    technicianProfileIds: readonly string[]
  ): Promise<ReadonlyMap<string, string | null>> {
    if (technicianProfileIds.length === 0) return new Map();
    const profiles = await this.roster.userIdsForProfiles(db, technicianProfileIds);
    const identities = await iamDirectory().directory.resolveDisplayIdentities(
      db,
      profiles.map((profile) => profile.userId)
    );
    return new Map(
      profiles.map((profile) => [
        profile.technicianProfileId,
        identities.get(profile.userId)?.displayName ?? null,
      ])
    );
  }
}
