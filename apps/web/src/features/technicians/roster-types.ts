/**
 * The technician roster's types (`P1-32-PRE-OD-ADM2B`).
 *
 * Separate from `roster-api.ts` and `roster-actions.ts` because both are
 * `'use server'`, and a Server Action module may export only async functions.
 *
 * Every shape below is the published response of the operation named beside
 * it — `TechnicianRosterEntry`, `TechnicianProfileDetail`, `HeldSkillRow`,
 * `HeldCertificationRow`, `AvailabilityWindowView` and
 * `TechnicianSkillCatalogue` in the technician module. Nothing here is invented.
 *
 * | operation                                     | method | path                                                        | permission                                   |
 * | --------------------------------------------- | ------ | ----------------------------------------------------------- | -------------------------------------------- |
 * | `tech.technician-list`                        | GET    | `/technicians`                                              | `tech.technician.read`                       |
 * | `tech.technician-create`                      | POST   | `/technicians`                                              | `tech.technician.manage`                     |
 * | `tech.technician-detail`                      | GET    | `/technicians/{id}`                                         | `tech.technician.read`                       |
 * | `tech.technician-update`                      | PATCH  | `/technicians/{id}`                                         | `tech.technician.manage`                     |
 * | `tech.technician-queue`                       | GET    | `/technicians/{id}/queue`                                   | `tech.technician.read`                       |
 * | `tech.technician-availability-record`         | POST   | `/technicians/{id}/availability`                            | `tech.technician.manage`                     |
 * | `tech.technician-availability-withdraw`       | DELETE | `/technicians/{id}/availability/{availabilityId}`           | `tech.technician.manage`                     |
 * | `tech.skill-list`                             | GET    | `/technician-skills`                                        | `tech.technician.read`                       |
 * | `tech.technician-skill-set`                   | PUT    | `/technicians/{id}/skills/{skillId}`                        | `tech.technician.manage`                     |
 * | `tech.technician-skill-withdraw`              | DELETE | `/technicians/{id}/skills/{skillId}`                        | `tech.technician.manage`                     |
 * | `tech.technician-certification-update`        | PATCH  | `/technicians/{id}/certifications/{certificationId}`        | `tech.technician.manage`                     |
 * | `tech.technician-certification-detail-record` | PUT    | `/technicians/{id}/certifications/{certificationId}/detail` | `tech.technician.manage`, `iam.sensitive.view` |
 *
 * ## What this module deliberately does NOT model
 *
 * - **Recording a new certification.** `tech.technician-certification-record`
 *   needs a certification id from the catalogue, and no operation publishes the
 *   certification catalogue. A screen that asked for one could only ask for a
 *   pasted reference, so none is offered and the gap is recorded.
 * - **Reading the certificate number.** It is restricted, and no operation
 *   answers it; the sensitive write records it and the screen never shows it.
 */

/** The codes the roster consults. Every one is declared by an operation above. */
export const TECHNICIAN_ROSTER_PERMISSIONS = {
  read: 'tech.technician.read',
  manage: 'tech.technician.manage',
  /** The person picker on "Add technician", and the names the roster shows. */
  userRead: 'iam.user.read',
  /** The certificate number, recorded alongside `manage`. */
  sensitiveView: 'iam.sensitive.view',
} as const;

/** The two availability kinds `tech.technician-availability-record` accepts. */
export const AVAILABILITY_KINDS = ['available', 'unavailable'] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];

/** The three certification states `tech.technician-certification-update` accepts. */
export const CERTIFICATION_STATUSES = ['active', 'expired', 'revoked'] as const;
export type CertificationStatus = (typeof CERTIFICATION_STATUSES)[number];

/** The route's own bounds, so a form refuses what the server would. */
export const MAX_TRADE = 64;
export const MAX_EMPLOYMENT_REF = 64;
export const MAX_AVAILABILITY_REASON = 500;
export const MAX_CERTIFICATE_NUMBER = 128;

/** A roster row as `tech.technician-list` and `tech.technician-detail` publish it. */
export interface TechnicianRosterEntry {
  readonly id: string;
  readonly userId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly trade: string | null;
  readonly employmentRef: string | null;
  readonly isActive: boolean;
  readonly recordVersion: number;
  /** Null when this session may not be told who the person is (no `iam.user.read`). */
  readonly displayName: string | null;
}

/** One page of the roster. */
export interface TechnicianRosterPage {
  readonly items: readonly TechnicianRosterEntry[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** A skill the technician holds, at a level. */
export interface HeldSkill {
  readonly skillId: string;
  readonly skillCode: string;
  readonly skillName: string;
  readonly skillLevelId: string;
  readonly skillLevelName: string;
  readonly rank: number;
}

/** A certification the technician holds. The number is never part of it. */
export interface HeldCertification {
  readonly certificationId: string;
  readonly certificationCode: string;
  readonly certificationName: string;
  /** The issue date as a calendar day, `YYYY-MM-DD`. */
  readonly issuedOnDay: string;
  /** A calendar day, or null when the credential does not lapse. */
  readonly expiresOn: string | null;
  readonly certStatus: string;
  readonly isSafetyCritical: boolean;
  readonly recordVersion: number;
}

/** One availability or unavailability window. Both ends are instants. */
export interface AvailabilityWindow {
  readonly id: string;
  readonly availableFrom: string;
  readonly availableTo: string;
  readonly availabilityKind: string;
  readonly reason: string | null;
  readonly recordVersion: number;
}

/** `tech.technician-detail`: one call, one screen. */
export interface TechnicianProfileDetail {
  readonly profile: TechnicianRosterEntry;
  readonly skills: readonly HeldSkill[];
  readonly certifications: readonly HeldCertification[];
  readonly availability: readonly AvailabilityWindow[];
}

/** One active assignment, as `tech.technician-queue` publishes it. */
export interface TechnicianQueueItem {
  readonly assignmentId: string;
  readonly jobId: string;
  readonly workOrderId: string;
  readonly assignmentRole: string;
  readonly validFrom: string;
  readonly jobTitle: string;
  readonly jobState: string;
  readonly workOrderState: string;
  readonly displayNumber: string | null;
}

/** `tech.technician-queue`: unpaged, every active assignment. */
export interface TechnicianQueue {
  readonly technicianProfileId: string;
  readonly items: readonly TechnicianQueueItem[];
}

/** A catalogue entry the skill picker offers. */
export interface SkillOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly discipline: string | null;
}

export interface SkillLevelOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly rank: number;
}

/** `tech.skill-list`. */
export interface TechnicianSkillCatalogue {
  readonly skills: readonly SkillOption[];
  readonly skillLevels: readonly SkillLevelOption[];
}
