/**
 * The `tech.` request bodies, transcribed by hand from the shipped zod schemas.
 *
 * | operation                                     | body                                      |
 * | --------------------------------------------- | ----------------------------------------- |
 * | `tech.labor-session-correct`                  | `LaborSessionCorrectBody`                 |
 * | `tech.labor-session-start`                    | `LaborSessionStartBody`                   |
 * | `tech.technician-availability-record`         | `TechnicianAvailabilityRecordBody`        |
 * | `tech.technician-certification-detail-record` | `TechnicianCertificationDetailRecordBody` |
 * | `tech.technician-certification-record`        | `TechnicianCertificationRecordBody`       |
 * | `tech.technician-certification-update`        | `TechnicianCertificationUpdateBody`       |
 * | `tech.technician-create`                      | `TechnicianCreateBody`                    |
 * | `tech.technician-skill-set`                   | `TechnicianSkillSetBody`                  |
 * | `tech.technician-update`                      | `TechnicianUpdateBody`                    |
 *
 * ## Why this is written by hand and not generated
 *
 * `apps/web` may not import `apps/api` — `check-api-boundary.mjs` enforces it —
 * so nothing on this side can reach the zod schema that will judge its request.
 * This module is that schema restated, and a gate compares the two. A GENERATED
 * mirror would gate nothing: it would agree with the backend by construction and
 * keep agreeing through any drift. The value is that a hand-written one CAN be
 * wrong, and gets caught.
 *
 * ## One type per operation — never shared, even where two would be identical
 *
 * No type here is reused by a second operation. Two bodies that agree today are
 * two bodies that may diverge tomorrow, and the divergence would most likely be a
 * length limit, which TypeScript cannot express — so nothing would catch it and a
 * caller would be told a request is well formed that the API refuses. The
 * near-miss in this domain is `expiresOn`, which appears on both certification
 * bodies with different nullability; one shared type would have flattened that.
 *
 * ## What these types deliberately do NOT carry
 *
 * `minLength`, `maxLength` and `pattern` are absent, because an interface has
 * nowhere to put them. Every `string` below is narrower than `string` at the
 * boundary, and a type is not where a caller learns how much narrower. Where a
 * limit is worth knowing it is written in words rather than smuggled into the
 * shape: both `reason` fields here cap at 500, half of the 1000 the `wo.`
 * evidence body allows, so a `reason` that passes there is not portable to here.
 * The date and date-time fields are plain `string` for the same reason — the
 * schema pins the format, the type cannot.
 *
 * ## The three `tech.` writes that appear nowhere below
 *
 * `tech.labor-session-stop` takes no body: stopping a session needs no argument
 * beyond the session the path already names, and it is the only bodyless POST in
 * the surface. `tech.technician-availability-withdraw` and
 * `tech.technician-skill-withdraw` are `DELETE`s addressed by path, and carry
 * nothing. Their absence is the reason, not an omission.
 */

/**
 * A correction to a labor session's recorded interval.
 *
 * All three fields are required, so a correction restates the whole interval
 * rather than patching one end — there is no way to move `startedAt` and leave
 * `endedAt` to be inferred from what was already on record. `reason` is required
 * for the same purpose: a corrected interval that does not say why it was
 * corrected is indistinguishable from the original measurement.
 */
export interface LaborSessionCorrectBody {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly reason: string;
}

/** Starting a session names the technician; stopping one takes no body at all. */
export interface LaborSessionStartBody {
  readonly technicianProfileId: string;
}

/**
 * A window in which a technician is, or is not, available.
 *
 * `availabilityKind` is a CLOSED vocabulary — a check constraint, not a catalogue
 * a tenant can extend — so it is a union rather than `string`. `reason` is
 * optional because an ordinary available window explains itself; it is an absence
 * that usually wants the note.
 */
export interface TechnicianAvailabilityRecordBody {
  readonly from: string;
  readonly to: string;
  readonly availabilityKind: 'available' | 'unavailable';
  readonly reason?: string;
}

/** The issuer's own number for a certification already on record. */
export interface TechnicianCertificationDetailRecordBody {
  readonly certificateNumber: string;
}

/**
 * Attaching a certification to a technician.
 *
 * `expiresOn` is optional here but NOT nullable: omitting it is how a
 * certification that does not expire is recorded. Clearing an expiry already on
 * record is a different act and belongs to `TechnicianCertificationUpdateBody`,
 * where the same field name does accept `null`.
 */
export interface TechnicianCertificationRecordBody {
  readonly certificationId: string;
  readonly issuedOn: string;
  readonly expiresOn?: string;
}

/**
 * Amending a certification already attached.
 *
 * Every field is optional — this is a patch, and a body naming only `certStatus`
 * must leave the expiry untouched. That is exactly why `expiresOn` is nullable
 * here: omission already means "leave it", so an explicit `null` is the only way
 * left to say "it no longer expires". `certStatus` is a closed vocabulary, like
 * `availabilityKind`.
 */
export interface TechnicianCertificationUpdateBody {
  readonly certStatus?: 'active' | 'expired' | 'revoked';
  readonly expiresOn?: string | null;
}

/**
 * Creating a technician profile for an existing user.
 *
 * The body names `companyId` and `branchId` explicitly rather than deriving them
 * from the caller's session. `trade` and `employmentRef` are optional: a profile
 * is created against the user and its placement, and the shop's own labels for it
 * can arrive later through `TechnicianUpdateBody`.
 */
export interface TechnicianCreateBody {
  readonly userId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly trade?: string;
  readonly employmentRef?: string;
}

/** The level is the whole payload; the skill and the technician are in the path. */
export interface TechnicianSkillSetBody {
  readonly skillLevelId: string;
}

/**
 * Amending a technician profile.
 *
 * `trade` and `employmentRef` are nullable because they were optional at
 * creation, and a patch needs a way to say "remove the one I set" that is
 * distinct from "do not touch it".
 *
 * `retire` is `true` rather than `boolean` on purpose — the schema pins the
 * literal, so `retire: false` is refused rather than read as "do not retire".
 * Retiring is a request you either make or omit; `isActive` is the field that
 * toggles.
 */
export interface TechnicianUpdateBody {
  readonly trade?: string | null;
  readonly employmentRef?: string | null;
  readonly isActive?: boolean;
  readonly retire?: true;
}
