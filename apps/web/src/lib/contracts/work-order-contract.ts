/**
 * Request-payload mirror for the `wo.` (work order) operations — P1-29, `BR-08c`.
 *
 * ## Why this is transcribed by hand
 *
 * `apps/web` may not import `apps/api` source — `check-api-boundary.mjs` fails
 * the build if it tries — so the shapes the routes validate with are copied
 * across the boundary by hand and a gate compares the copy against the zod
 * schemas themselves. A GENERATED mirror would gate nothing: it would agree with
 * its source by construction, and the gate would pass whatever the backend did.
 * The value is precisely that a hand copy CAN drift, and that the drift surfaces
 * on the next gate run instead of as a 422 in front of an operator.
 *
 * The operations appear here in the same order as the extracted schema document,
 * so the two can be read side by side without hunting.
 *
 * ## One type per operation, and never shared between two
 *
 * `JobTransitionBody`, `WorkOrderClosureBody` and `WorkOrderTransitionBody` are
 * byte-identical today, and collapsing them into one `TransitionBody` is the
 * obvious economy. It is refused, because nothing keeps them identical: they are
 * three transitions on two different aggregates, and the first divergence — a
 * longer `reason`, a required one, an extra field — would be invisible, since
 * TypeScript cannot tell the resulting types apart. A shared type would then
 * assert a shape for an operation nobody re-checked. Every operation gets its
 * own name, including the nested element types.
 *
 * ## Length and pattern limits are NOT in these types
 *
 * A TypeScript interface cannot carry `minLength`, `maxLength` or `pattern`, so
 * the gate does not compare them and this module does not pretend to. Branded
 * types would only move the lie. What the docblocks below DO record is the cases
 * where the same field name carries a different limit in two operations — those
 * are the places a reader would otherwise assume one rule and get another.
 *
 * ## `state` and `toState` are catalogue codes, not enums
 *
 * `wo.work_order_states` and its job counterpart are live, tenant-owned
 * catalogues. The vocabulary is a set of rows, not a frozen list, so these
 * fields are `string`; a union of literals here would be a second, rotting copy
 * of a tenant's own configuration and would reject codes the platform accepts.
 * The fields carrying a genuinely closed vocabulary — a `ck_` check constraint
 * rather than a table — are unions, and the difference is deliberate.
 */

/**
 * One supporting document attached to an approval decision.
 *
 * `note` is capped at 500 here, HALF of the 1000 the same field allows on
 * `JobEvidenceRecordBody`. Same three field names, different ceiling.
 */
export interface AdditionalWorkApprovalEvidence {
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note?: string;
}

/**
 * The customer's answer to an additional-work request, with the record of how it
 * was obtained: who decided, over which channel, and against what scope was put
 * to them. `decision` and `channel` are both closed vocabularies.
 */
export interface AdditionalWorkApprovalBody {
  readonly decision: 'approved' | 'rejected';
  readonly channel: 'in_person' | 'phone' | 'email' | 'sms' | 'portal' | 'other';
  readonly decidingPartyRoleId: string;
  readonly presentedScope: string;
  readonly evidence?: readonly AdditionalWorkApprovalEvidence[];
  readonly quotationRevisionRef?: string;
}

/**
 * The long-form detail of an additional-work request. `description` runs to 4000
 * — eight times the 500 the same field name allows on `RequiredPartRecordBody`
 * and `ServiceLineRecordBody`.
 */
export interface AdditionalWorkDetailRecordBody {
  readonly description: string;
}

/**
 * `reason` is optional for BOTH states. If a waiver demands one where a
 * fulfilment does not, that is a cross-field rule, and cross-field rules survive
 * neither the extraction nor an interface — so this mirror cannot say it.
 */
export interface AdditionalWorkFulfillmentBody {
  readonly fulfillmentState: 'fulfilled' | 'waived';
  readonly reason?: string;
}

/**
 * Raising additional work. Both origins are optional because the request may
 * come from a technician mid-job, from a diagnostic finding, or from neither.
 */
export interface AdditionalWorkRequestBody {
  readonly originatingJobId?: string;
  readonly originatingFindingId?: string;
  readonly summary: string;
  readonly isRequired?: boolean;
}

/**
 * `reason` is required here and optional on `AdditionalWorkFulfillmentBody` —
 * one field name, the opposite obligation. All seven `reason` fields in this
 * domain share a 500 limit; only the requiredness differs.
 */
export interface AdditionalWorkWithdrawBody {
  readonly reason: string;
}

/** A skill the assignment demands, at or above `minimumRank`. `minimumRank` is an integer. */
export interface JobAssignmentCreateRequiredSkill {
  readonly skillCode: string;
  readonly minimumRank: number;
}

/** The interval the assignment occupies. Both bounds are required, and both are instants. */
export interface JobAssignmentCreateWindow {
  readonly from: string;
  readonly to: string;
}

/**
 * Assigning a technician to a job. `requiredSkills` and
 * `requiredCertificationCodes` state what the JOB demands; they are not a copy
 * of the named technician's qualifications, which the platform already holds
 * against the profile.
 */
export interface JobAssignmentCreateBody {
  readonly technicianProfileId: string;
  readonly assignmentRole?: 'primary' | 'assist';
  readonly requiredSkills?: readonly JobAssignmentCreateRequiredSkill[];
  readonly requiredCertificationCodes?: readonly string[];
  readonly window: JobAssignmentCreateWindow;
}

export interface JobAssignmentEndBody {
  readonly reason: string;
}

/**
 * Adding a job to an existing work order.
 *
 * `state` is optional, and when sent it is a catalogue code, so the type is
 * `string` — see the module docblock. It is the only `state` in the domain that
 * is not a `toState`: there is none on `JobUpdateBody`, so once the job exists
 * its state moves only through `wo.job-transition`.
 */
export interface JobCreateBody {
  readonly title: string;
  readonly jobType?: string;
  readonly state?: string;
  readonly requiresDiagnostic?: boolean;
}

/**
 * Attaching evidence to a job. `note` allows 1000 characters — DOUBLE the 500 of
 * the identically-named field on `AdditionalWorkApprovalEvidence` and on the
 * diagnostics evidence body. The three shapes are otherwise the same, which is
 * exactly why they are three types.
 */
export interface JobEvidenceRecordBody {
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note?: string;
}

/** See `JobAssignmentCreateRequiredSkill`; a separate type because a separate operation. */
export interface JobReassignmentRequiredSkill {
  readonly skillCode: string;
  readonly minimumRank: number;
}

/** See `JobAssignmentCreateWindow`; a separate type because a separate operation. */
export interface JobReassignmentWindow {
  readonly from: string;
  readonly to: string;
}

/**
 * Moving a job to a different technician. It differs from
 * `JobAssignmentCreateBody` in BOTH directions: `reason` is added and required —
 * creating an assignment needs no justification, taking one away does — and
 * `assignmentRole` is gone, so a reassignment cannot change the role while
 * changing the person.
 */
export interface JobReassignmentBody {
  readonly technicianProfileId: string;
  readonly reason: string;
  readonly requiredSkills?: readonly JobReassignmentRequiredSkill[];
  readonly requiredCertificationCodes?: readonly string[];
  readonly window: JobReassignmentWindow;
}

/** `toState` is a catalogue code — see the module docblock. */
export interface JobTransitionBody {
  readonly toState: string;
  readonly reason?: string;
}

/**
 * Editing a job in place. `jobType` and `departmentId` are the two nullable
 * fields in this domain, and they do NOT behave the same way:
 *
 *   `jobType`      a full replacement — omitting it CLEARS the value.
 *   `departmentId` three-way — omitting it LEAVES the routing alone, `null`
 *                  clears it, a uuid sets it.
 *
 * The difference is deliberate. A supervisor renaming a job has not asked to
 * unroute it, so departmentId cannot inherit jobType's replacement contract.
 *
 * The job's state cannot be changed at all through this body.
 */
export interface JobUpdateBody {
  readonly title: string;
  readonly jobType?: string | null;
  /**
   * The organisational unit working this job (PRE-P1-29 BR-02). The department's
   * company and branch are NEVER sent: the server resolves them from the job, so
   * a client cannot route work into another branch by naming one.
   */
  readonly departmentId?: string | null;
  readonly requiresDiagnostic?: boolean;
}

/**
 * An append-only work-log entry. `loggedAt` exists so an entry can be recorded
 * against when the work happened rather than when it was typed; omitting it is
 * the ordinary case.
 */
export interface JobWorkLogRecordBody {
  readonly entry: string;
  readonly loggedAt?: string;
}

/**
 * A part the work needs.
 *
 * `quantity` is a decimal-formatted STRING, not a number — the wire format
 * preserves the exact scale a float would round away. `itemRef` points at the
 * inventory catalogue and is optional, because a part may be named before it is
 * identified.
 */
export interface RequiredPartRecordBody {
  readonly jobId?: string;
  readonly description: string;
  readonly quantity: string;
  readonly unit?: string;
  readonly itemRef?: string;
}

/**
 * A unit of labour the work needs. Shaped like `RequiredPartRecordBody` — down
 * to `quantity` being a decimal string — but referencing the service catalogue
 * rather than inventory.
 */
export interface ServiceLineRecordBody {
  readonly jobId?: string;
  readonly description: string;
  readonly quantity: string;
  readonly unit?: string;
  readonly serviceRef?: string;
}

/** `toState` is a catalogue code — see the module docblock. */
export interface WorkOrderClosureBody {
  readonly toState: string;
  readonly reason?: string;
}

/** `toState` is a catalogue code — see the module docblock. */
export interface WorkOrderTransitionBody {
  readonly toState: string;
  readonly reason?: string;
}
