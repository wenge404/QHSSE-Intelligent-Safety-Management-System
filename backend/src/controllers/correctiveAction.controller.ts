import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { canVerifyAction, correctiveActionScope } from '../domain/rbac';
import { assertCorrectiveActionTransition } from '../domain/stateMachine';
import { formatReference, temporaryReference } from '../domain/references';
import { currentUser } from '../middleware/auth.middleware';
import { ApiError, asyncHandler } from '../middleware/error.middleware';
import { createCorrectiveActionSchema, transitionCorrectiveActionSchema } from '../schemas';
import { appendAuditLog, clientIp } from '../services/auditLog.service';
import { toPlain } from '../utils/serialize';

const include = {
  assignedTo: { select: { id: true, fullName: true, email: true } },
  verifiedBy: { select: { id: true, fullName: true } },
  incident: { select: { id: true, referenceNumber: true, title: true, status: true } },
  auditResponse: {
    select: {
      id: true,
      complianceStatus: true,
      checklistItem: { select: { itemText: true } },
      audit: { select: { id: true, referenceNumber: true } },
    },
  },
} satisfies Prisma.CorrectiveActionInclude;

export const list = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const mineOnly = req.query.mine === 'true';

    const where: Prisma.CorrectiveActionWhereInput = mineOnly
      ? { AND: [correctiveActionScope(user), { assignedToId: user.id }] }
      : correctiveActionScope(user);

    const actions = await prisma.correctiveAction.findMany({
      where,
      include,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    });

    res.json({ data: toPlain(actions) });
  });

export const create = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const body = createCorrectiveActionSchema.parse(req.body);

    // The parent must be inside the caller's scope, otherwise a corrective
    // action becomes a way to write into a record you cannot see.
    if (body.incidentId) {
      const parent = await prisma.incident.findFirst({
        where: { id: body.incidentId },
        select: { id: true, status: true },
      });
      if (!parent) throw new ApiError(404, 'Parent incident not found.');
      if (parent.status === 'CLOSED') {
        throw new ApiError(409, 'Cannot raise a corrective action against a closed incident.');
      }
    }
    if (body.auditResponseId) {
      const parent = await prisma.auditResponse.findUnique({
        where: { id: body.auditResponseId },
        select: { id: true },
      });
      if (!parent) throw new ApiError(404, 'Parent audit response not found.');
    }

    const assignee = await prisma.user.findFirst({
      where: { id: body.assignedToId, isActive: true },
      select: { id: true },
    });
    if (!assignee) throw new ApiError(404, 'Assignee not found or deactivated.');

    const created = await prisma.$transaction(async (tx) => {
      const action = await tx.correctiveAction.create({
        data: {
          referenceNumber: temporaryReference('CA'),
          description: body.description,
          source: body.source,
          incidentId: body.incidentId ?? null,
          auditResponseId: body.auditResponseId ?? null,
          assignedToId: body.assignedToId,
          dueDate: body.dueDate,
          status: 'OPEN',
        },
      });

      const withReference = await tx.correctiveAction.update({
        where: { id: action.id },
        data: { referenceNumber: formatReference('CA', action.id, action.createdAt) },
        include,
      });

      await appendAuditLog(tx, {
        userId: user.id,
        action: 'CORRECTIVE_ACTION_CREATED',
        entityType: 'CORRECTIVE_ACTION',
        entityId: action.id,
        newState: 'OPEN',
        detail: {
          referenceNumber: withReference.referenceNumber,
          source: body.source,
          assignedToId: body.assignedToId,
        },
        ipAddress: clientIp(req),
      });

      // Raising an action on an incident under investigation advances it.
      if (body.incidentId) {
        const incident = await tx.incident.findUniqueOrThrow({
          where: { id: body.incidentId },
          select: { status: true },
        });
        if (incident.status === 'UNDER_INVESTIGATION') {
          await tx.incident.update({
            where: { id: body.incidentId },
            data: { status: 'CORRECTIVE_ACTION_PENDING' },
          });
          await appendAuditLog(tx, {
            userId: user.id,
            action: 'INCIDENT_STATE_CHANGED',
            entityType: 'INCIDENT',
            entityId: body.incidentId,
            previousState: 'UNDER_INVESTIGATION',
            newState: 'CORRECTIVE_ACTION_PENDING',
            detail: { trigger: `corrective action ${withReference.referenceNumber} raised` },
            ipAddress: clientIp(req),
          });
        }
      }

      return withReference;
    });

    res.status(201).json(toPlain(created));
  });

export const transition = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const { status, note } = transitionCorrectiveActionSchema.parse(req.body);

    const existing = await prisma.correctiveAction.findFirst({
      where: { AND: [{ id }, correctiveActionScope(user)] },
    });
    if (!existing) throw new ApiError(404, 'Corrective action not found or outside your scope.');

    assertCorrectiveActionTransition(existing.status, status, user.role);

    // §9.3 "Approve & Verify Actions" — an auditor may only verify work that
    // came out of an audit, never an incident investigation.
    if (status === 'VERIFIED' && !canVerifyAction(user.role, existing.source)) {
      throw new ApiError(
        403,
        `Role ${user.role} may not verify ${existing.source.toLowerCase().replace('_', ' ')}-sourced actions.`,
      );
    }
    // Verification is a second pair of eyes; signing off your own work defeats it.
    if (status === 'VERIFIED' && existing.assignedToId === user.id && user.role !== 'SYSTEM_ADMIN') {
      throw new ApiError(403, 'You cannot verify a corrective action assigned to you.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.correctiveAction.update({
        where: { id },
        data: {
          status,
          completedDate:
            status === 'COMPLETED' ? (existing.completedDate ?? new Date()) : existing.completedDate,
          verifiedById: status === 'VERIFIED' ? user.id : existing.verifiedById,
          verifiedAt: status === 'VERIFIED' ? new Date() : existing.verifiedAt,
        },
        include,
      });

      await appendAuditLog(tx, {
        userId: user.id,
        action: 'CORRECTIVE_ACTION_STATE_CHANGED',
        entityType: 'CORRECTIVE_ACTION',
        entityId: id,
        previousState: existing.status,
        newState: status,
        detail: note ? { note } : undefined,
        ipAddress: clientIp(req),
      });

      return next;
    });

    res.json(toPlain(updated));
  });

/**
 * Sweeps OPEN / IN_PROGRESS actions past their due date into OVERDUE. Called
 * by the dashboard so the KPI figures reflect reality without needing a
 * background scheduler in this iteration.
 */
export const refreshOverdue = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const now = new Date();

    const stale = await prisma.correctiveAction.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lt: now } },
      select: { id: true, status: true },
    });

    if (stale.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.correctiveAction.updateMany({
          where: { id: { in: stale.map((s) => s.id) } },
          data: { status: 'OVERDUE' },
        });
        for (const item of stale) {
          await appendAuditLog(tx, {
            userId: user.id,
            action: 'CORRECTIVE_ACTION_STATE_CHANGED',
            entityType: 'CORRECTIVE_ACTION',
            entityId: item.id,
            previousState: item.status,
            newState: 'OVERDUE',
            detail: { trigger: 'due date elapsed' },
            ipAddress: clientIp(req),
          });
        }
      });
    }

    res.json({ markedOverdue: stale.length });
  });
