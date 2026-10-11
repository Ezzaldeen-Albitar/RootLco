'use server';

import {
  branchTargetQuery,
  readOperation,
  type BranchTarget,
  type ReadState,
} from '@/lib/api/read-operation';
import type {
  TechnicianProfileDetail,
  TechnicianQueue,
  TechnicianRosterPage,
  TechnicianSkillCatalogue,
} from './roster-types';

/**
 * The technician roster's reads (`P1-32-PRE-OD-ADM2B`).
 *
 * Nothing here fetches directly: `readOperation` goes through the one network
 * owner in this application. Every read is `tech.technician.read`.
 */

/**
 * `GET /api/v1/technicians?companyId&branchId[&isActive]` — `tech.technician-list`.
 *
 * Keyset-paged over ONE branch: the pair is the operation's authorization
 * target and is required. `isActive` is the one filter the route publishes;
 * absent, the roster lists active and inactive technicians alike.
 */
export async function listTechnicians(
  target: BranchTarget,
  options: {
    readonly isActive: boolean | null;
    readonly cursor: string | null;
    readonly limit: number;
  }
): Promise<ReadState<TechnicianRosterPage>> {
  return readOperation<TechnicianRosterPage>(
    `/api/v1/technicians${branchTargetQuery(target, {
      isActive: options.isActive === null ? undefined : String(options.isActive),
      limit: options.limit,
      cursor: options.cursor,
    })}`
  );
}

/**
 * `GET /api/v1/technicians/{technicianProfileId}` — `tech.technician-detail`.
 *
 * The profile with its skills, certifications and upcoming availability. A
 * retired profile, one in another organisation and one that never existed are
 * one answer (`not-found`).
 */
export async function readTechnician(
  technicianProfileId: string
): Promise<ReadState<TechnicianProfileDetail>> {
  return readOperation<TechnicianProfileDetail>(
    `/api/v1/technicians/${encodeURIComponent(technicianProfileId)}`
  );
}

/**
 * `GET /api/v1/technicians/{technicianProfileId}/queue` — `tech.technician-queue`.
 *
 * Every active assignment of the technician; not paged.
 */
export async function readTechnicianQueue(
  technicianProfileId: string
): Promise<ReadState<TechnicianQueue>> {
  return readOperation<TechnicianQueue>(
    `/api/v1/technicians/${encodeURIComponent(technicianProfileId)}/queue`
  );
}

/**
 * `GET /api/v1/technician-skills` — `tech.skill-list`.
 *
 * The active skills and levels this organisation may give a technician: exactly
 * the set `tech.technician-skill-set` accepts.
 */
export async function readSkillCatalogue(): Promise<ReadState<TechnicianSkillCatalogue>> {
  return readOperation<TechnicianSkillCatalogue>('/api/v1/technician-skills');
}
