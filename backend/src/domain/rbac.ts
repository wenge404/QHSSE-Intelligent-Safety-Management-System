import { Prisma, Role } from '@prisma/client';

/**
 * Proposal §9.3 — Role-Based Access Control matrix.
 *
 *  Role             | Create Incident/Audit | Dashboard visibility        | Approve & verify
 *  -----------------|-----------------------|-----------------------------|------------------------------
 *  FIELD_REPORTER   | Yes                   | Own submissions only        | No
 *  QHSSE_AUDITOR    | Yes                   | Zone-level                  | Audit-sourced actions only
 *  DEPARTMENT_LEAD  | Yes                   | Department-level (all zones)| All actions in department
 *  SYSTEM_ADMIN     | Yes                   | Organisation-wide           | All, plus user & template mgmt
 *
 * Visibility is implemented as Prisma `where` fragments rather than by
 * filtering in memory, so a user can never over-fetch and have rows stripped
 * after the fact — the restriction is part of the SQL.
 */

export interface Principal {
  id: number;
  role: Role;
  department: string | null;
  zoneId: number | null;
}

/** Every role may create incidents and audits (§9.3, column 1). */
export function canCreate(_role: Role): boolean {
  return true;
}

/** User and checklist-template management is System Admin only. */
export function canManagePlatform(role: Role): boolean {
  return role === 'SYSTEM_ADMIN';
}

export function canViewAuditLog(role: Role): boolean {
  return role === 'SYSTEM_ADMIN' || role === 'DEPARTMENT_LEAD';
}

/**
 * "Approve & Verify Actions" column. A QHSSE Auditor may only verify actions
 * that originated from an audit response, never incident-sourced ones.
 */
export function canVerifyAction(role: Role, source: 'INCIDENT' | 'AUDIT_RESPONSE'): boolean {
  switch (role) {
    case 'FIELD_REPORTER':
      return false;
    case 'QHSSE_AUDITOR':
      return source === 'AUDIT_RESPONSE';
    case 'DEPARTMENT_LEAD':
    case 'SYSTEM_ADMIN':
      return true;
  }
}

/**
 * Scope reaches through the *reporter* as well as the zone.
 *
 * Zone is optional on an incident — a report filed from the field before the
 * asset has been identified has no zone yet. Keying visibility on zone alone
 * made those records invisible to everyone but their author and the admin,
 * which is precisely backwards: an unlocated gas release is the one a lead
 * most needs to see. Matching on the reporter's own department (or home zone,
 * for an auditor) closes that hole, and reads correctly as a rule in its own
 * right: you are accountable for what your people report as well as for what
 * happens on your patch.
 */
export function incidentScope(user: Principal): Prisma.IncidentWhereInput {
  switch (user.role) {
    case 'SYSTEM_ADMIN':
      return {};
    case 'DEPARTMENT_LEAD':
      return user.department
        ? {
            OR: [
              { zone: { department: user.department } },
              { reportedBy: { department: user.department } },
              { reportedById: user.id },
            ],
          }
        : { reportedById: user.id };
    case 'QHSSE_AUDITOR':
      return user.zoneId
        ? {
            OR: [
              { zoneId: user.zoneId },
              { reportedBy: { zoneId: user.zoneId } },
              { reportedById: user.id },
            ],
          }
        : { reportedById: user.id };
    case 'FIELD_REPORTER':
      return { reportedById: user.id };
  }
}

export function auditScope(user: Principal): Prisma.AuditWhereInput {
  switch (user.role) {
    case 'SYSTEM_ADMIN':
      return {};
    case 'DEPARTMENT_LEAD':
      return user.department
        ? {
            OR: [
              { zone: { department: user.department } },
              { conductedBy: { department: user.department } },
              { conductedById: user.id },
            ],
          }
        : { conductedById: user.id };
    case 'QHSSE_AUDITOR':
      return user.zoneId
        ? {
            OR: [
              { zoneId: user.zoneId },
              { conductedBy: { zoneId: user.zoneId } },
              { conductedById: user.id },
            ],
          }
        : { conductedById: user.id };
    case 'FIELD_REPORTER':
      return { conductedById: user.id };
  }
}

/**
 * Corrective actions are polymorphic (incident- or audit-sourced), so the
 * scope has to reach through both parents. An action assigned to you is always
 * visible regardless of where it came from — otherwise people could not see
 * their own work queue.
 */
export function correctiveActionScope(user: Principal): Prisma.CorrectiveActionWhereInput {
  if (user.role === 'SYSTEM_ADMIN') return {};

  const mine: Prisma.CorrectiveActionWhereInput[] = [
    { assignedToId: user.id },
    { incident: { reportedById: user.id } },
    { auditResponse: { audit: { conductedById: user.id } } },
  ];

  if (user.role === 'FIELD_REPORTER') return { OR: mine };

  if (user.role === 'QHSSE_AUDITOR') {
    if (!user.zoneId) return { OR: mine };
    return {
      OR: [
        ...mine,
        { incident: { zoneId: user.zoneId } },
        { incident: { reportedBy: { zoneId: user.zoneId } } },
        { auditResponse: { audit: { zoneId: user.zoneId } } },
      ],
    };
  }

  // DEPARTMENT_LEAD
  if (!user.department) return { OR: mine };
  return {
    OR: [
      ...mine,
      { incident: { zone: { department: user.department } } },
      { incident: { reportedBy: { department: user.department } } },
      { auditResponse: { audit: { zone: { department: user.department } } } },
      { auditResponse: { audit: { conductedBy: { department: user.department } } } },
    ],
  };
}

/** Human-readable label for the dashboard header, e.g. "Zone: Pipeline Section A". */
export function scopeLabel(user: Principal, zoneName?: string | null): string {
  switch (user.role) {
    case 'SYSTEM_ADMIN':
      return 'Organisation-wide';
    case 'DEPARTMENT_LEAD':
      return user.department ? `Department: ${user.department}` : 'Own submissions only';
    case 'QHSSE_AUDITOR':
      return zoneName ? `Zone: ${zoneName}` : 'Own submissions only';
    case 'FIELD_REPORTER':
      return 'Own submissions only';
  }
}
