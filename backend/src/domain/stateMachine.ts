import { AuditStatus, CorrectiveActionStatus, IncidentStatus, Role } from '@prisma/client';

/**
 * Proposal §9.2 — workflow state machine.
 *
 *   DRAFT → SUBMITTED → UNDER_INVESTIGATION → CORRECTIVE_ACTION_PENDING → VERIFIED / CLOSED
 *
 * Valid transitions are enforced here, at the application layer: the API
 * validates that a requested state change is allowed before writing it, and
 * every accepted transition is appended to the AuditLog (§9.4).
 *
 * The same rules are ALSO enforced at the database level by the triggers in
 * prisma/migrations/20260812160000_state_transition_guards/migration.sql
 * (proposal §13, delivered). The two are one rule expressed twice: the maps
 * below and the CASE arms in that migration must be changed together.
 *
 * The application layer is not redundant now that the trigger exists — it is
 * what produces a useful 409 with the list of reachable states, and what
 * applies the role gate below, which the database has no way to know about.
 * The trigger is the backstop for every writer that is not this API.
 */

export const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  DRAFT: ['SUBMITTED'],
  // A submitted report can be returned to the reporter for more detail.
  SUBMITTED: ['UNDER_INVESTIGATION', 'DRAFT'],
  // An investigation that finds nothing to correct may close directly.
  UNDER_INVESTIGATION: ['CORRECTIVE_ACTION_PENDING', 'CLOSED'],
  CORRECTIVE_ACTION_PENDING: ['VERIFIED'],
  VERIFIED: ['CLOSED'],
  CLOSED: [],
};

export const CORRECTIVE_ACTION_TRANSITIONS: Record<
  CorrectiveActionStatus,
  CorrectiveActionStatus[]
> = {
  OPEN: ['IN_PROGRESS', 'OVERDUE'],
  IN_PROGRESS: ['COMPLETED', 'OVERDUE'],
  OVERDUE: ['IN_PROGRESS', 'COMPLETED'],
  COMPLETED: ['VERIFIED', 'IN_PROGRESS'],
  VERIFIED: [],
};

export const AUDIT_TRANSITIONS: Record<AuditStatus, AuditStatus[]> = {
  PLANNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Which roles may drive which transition.
 *
 * Derived from the proposal §9.3 RBAC matrix: a Field Reporter can raise and
 * submit but never approves or verifies; verification is a Department Lead /
 * System Admin action; a QHSSE Auditor moves investigations forward and
 * verifies audit-sourced work.
 */
const APPROVER_ROLES: Role[] = ['DEPARTMENT_LEAD', 'SYSTEM_ADMIN'];
const INVESTIGATOR_ROLES: Role[] = ['QHSSE_AUDITOR', 'DEPARTMENT_LEAD', 'SYSTEM_ADMIN'];

export const INCIDENT_TRANSITION_ROLES: Record<IncidentStatus, Role[]> = {
  // Anyone who can create an incident can submit their own draft; ownership is
  // checked separately in the route.
  DRAFT: ['FIELD_REPORTER', 'QHSSE_AUDITOR', 'DEPARTMENT_LEAD', 'SYSTEM_ADMIN'],
  SUBMITTED: INVESTIGATOR_ROLES,
  UNDER_INVESTIGATION: INVESTIGATOR_ROLES,
  CORRECTIVE_ACTION_PENDING: APPROVER_ROLES,
  VERIFIED: APPROVER_ROLES,
  CLOSED: APPROVER_ROLES,
};

export class TransitionError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

export class TransitionForbiddenError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'TransitionForbiddenError';
  }
}

function assertTransition<T extends string>(
  map: Record<string, string[]>,
  from: T,
  to: T,
  label: string,
): void {
  const allowed = map[from] ?? [];
  if (from === to) {
    throw new TransitionError(`${label} is already in state ${from}.`);
  }
  if (!allowed.includes(to)) {
    const options = allowed.length ? allowed.join(', ') : 'none — this is a terminal state';
    throw new TransitionError(
      `Invalid ${label} transition ${from} → ${to}. Allowed from ${from}: ${options}.`,
    );
  }
}

export function assertIncidentTransition(
  from: IncidentStatus,
  to: IncidentStatus,
  role: Role,
): void {
  assertTransition(INCIDENT_TRANSITIONS, from, to, 'incident');
  // The role gate is keyed on the *departing* state: who is entitled to move a
  // record out of where it currently sits.
  if (!INCIDENT_TRANSITION_ROLES[from].includes(role)) {
    throw new TransitionForbiddenError(
      `Role ${role} may not move an incident out of ${from}.`,
    );
  }
}

export function assertCorrectiveActionTransition(
  from: CorrectiveActionStatus,
  to: CorrectiveActionStatus,
  role: Role,
): void {
  assertTransition(CORRECTIVE_ACTION_TRANSITIONS, from, to, 'corrective action');
  // Verification is the controlled step (§9.3 "Approve & Verify Actions").
  if (to === 'VERIFIED' && !INVESTIGATOR_ROLES.includes(role)) {
    throw new TransitionForbiddenError(`Role ${role} may not verify corrective actions.`);
  }
}

export function assertAuditTransition(from: AuditStatus, to: AuditStatus): void {
  assertTransition(AUDIT_TRANSITIONS, from, to, 'audit');
}

/** Exposed on /api/v1/meta/workflow so the UI can grey out impossible buttons. */
export const workflowDescriptor = {
  incident: { transitions: INCIDENT_TRANSITIONS, roles: INCIDENT_TRANSITION_ROLES },
  correctiveAction: { transitions: CORRECTIVE_ACTION_TRANSITIONS },
  audit: { transitions: AUDIT_TRANSITIONS },
};
