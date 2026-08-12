import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { auditScope } from '../domain/rbac';
import { assertAuditTransition } from '../domain/stateMachine';
import { formatReference, temporaryReference } from '../domain/references';
import { currentUser } from '../middleware/auth.middleware';
import { ApiError, asyncHandler } from '../middleware/error.middleware';
import { createAuditSchema, submitResponsesSchema, transitionAuditSchema } from '../schemas';
import { appendAuditLog, clientIp } from '../services/auditLog.service';
import { toPlain } from '../utils/serialize';

const detailInclude = {
  template: { include: { items: { orderBy: { orderIndex: 'asc' } } } },
  zone: { select: { id: true, name: true, zoneType: true, department: true } },
  conductedBy: { select: { id: true, fullName: true, email: true } },
  responses: {
    include: {
      checklistItem: true,
      correctiveActions: { include: { assignedTo: { select: { id: true, fullName: true } } } },
    },
  },
} satisfies Prisma.AuditInclude;

export const list = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const audits = await prisma.audit.findMany({
      where: auditScope(user),
      include: {
        template: { select: { id: true, name: true, isoClause: true, _count: { select: { items: true } } } },
        zone: { select: { id: true, name: true } },
        conductedBy: { select: { id: true, fullName: true } },
        _count: { select: { responses: true } },
      },
      orderBy: [{ status: 'asc' }, { scheduledDate: 'desc' }],
    });
    res.json({ data: toPlain(audits) });
  });

export const detail = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);

    const audit = await prisma.audit.findFirst({
      where: { AND: [{ id }, auditScope(user)] },
      include: detailInclude,
    });
    if (!audit) throw new ApiError(404, 'Audit not found or outside your access scope.');

    const history = await prisma.auditLog.findMany({
      where: { entityType: 'AUDIT', entityId: id },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { timestamp: 'asc' },
    });

    res.json({ ...toPlain(audit), history: toPlain(history) });
  });

export const create = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const body = createAuditSchema.parse(req.body);

    const template = await prisma.checklistTemplate.findUnique({ where: { id: body.templateId } });
    if (!template) throw new ApiError(404, 'Checklist template not found.');
    if (!template.isActive) throw new ApiError(409, 'That checklist template is archived.');

    // Only an admin may schedule an audit for somebody else.
    const conductedById =
      body.conductedById && user.role === 'SYSTEM_ADMIN' ? body.conductedById : user.id;

    const created = await prisma.$transaction(async (tx) => {
      const audit = await tx.audit.create({
        data: {
          referenceNumber: temporaryReference('AUD'),
          templateId: body.templateId,
          zoneId: body.zoneId ?? null,
          scheduledDate: body.scheduledDate,
          conductedById,
          status: 'PLANNED',
        },
      });

      const withReference = await tx.audit.update({
        where: { id: audit.id },
        data: { referenceNumber: formatReference('AUD', audit.id, audit.createdAt) },
        include: detailInclude,
      });

      await appendAuditLog(tx, {
        userId: user.id,
        action: 'AUDIT_CREATED',
        entityType: 'AUDIT',
        entityId: audit.id,
        newState: 'PLANNED',
        detail: { referenceNumber: withReference.referenceNumber, template: template.name },
        ipAddress: clientIp(req),
      });

      return withReference;
    });

    res.status(201).json(toPlain(created));
  });

/**
 * Bulk upsert of checklist answers. Responses are keyed on
 * (auditId, checklistItemId) so re-submitting an item corrects the earlier
 * answer instead of creating a duplicate row.
 */
export const submitResponses = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const { responses } = submitResponsesSchema.parse(req.body);

    const audit = await prisma.audit.findFirst({
      where: { AND: [{ id }, auditScope(user)] },
      include: { template: { include: { items: { select: { id: true } } } } },
    });
    if (!audit) throw new ApiError(404, 'Audit not found or outside your access scope.');
    if (audit.status === 'COMPLETED' || audit.status === 'CANCELLED') {
      throw new ApiError(409, `Cannot record answers against a ${audit.status} audit.`);
    }

    const validItemIds = new Set(audit.template.items.map((item) => item.id));
    const stray = responses.filter((r) => !validItemIds.has(r.checklistItemId));
    if (stray.length > 0) {
      throw new ApiError(
        400,
        `Checklist item(s) ${stray.map((s) => s.checklistItemId).join(', ')} do not belong to this audit's template.`,
      );
    }

    const saved = await prisma.$transaction(async (tx) => {
      for (const response of responses) {
        await tx.auditResponse.upsert({
          where: {
            auditId_checklistItemId: { auditId: id, checklistItemId: response.checklistItemId },
          },
          create: {
            auditId: id,
            checklistItemId: response.checklistItemId,
            complianceStatus: response.complianceStatus,
            notes: response.notes ?? null,
          },
          update: {
            complianceStatus: response.complianceStatus,
            notes: response.notes ?? null,
          },
        });
      }

      // Recording the first answer moves a planned audit into progress.
      if (audit.status === 'PLANNED') {
        await tx.audit.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
        await appendAuditLog(tx, {
          userId: user.id,
          action: 'AUDIT_STATE_CHANGED',
          entityType: 'AUDIT',
          entityId: id,
          previousState: 'PLANNED',
          newState: 'IN_PROGRESS',
          detail: { trigger: 'first response recorded' },
          ipAddress: clientIp(req),
        });
      }

      await appendAuditLog(tx, {
        userId: user.id,
        action: 'AUDIT_RESPONSES_RECORDED',
        entityType: 'AUDIT',
        entityId: id,
        detail: { count: responses.length },
        ipAddress: clientIp(req),
      });

      return tx.audit.findUniqueOrThrow({ where: { id }, include: detailInclude });
    });

    res.json(toPlain(saved));
  });

export const transition = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const { status, note } = transitionAuditSchema.parse(req.body);

    const audit = await prisma.audit.findFirst({
      where: { AND: [{ id }, auditScope(user)] },
      include: { template: { include: { items: { select: { id: true } } } }, responses: true },
    });
    if (!audit) throw new ApiError(404, 'Audit not found or outside your access scope.');

    assertAuditTransition(audit.status, status);

    // A "completed" audit with unanswered items is not evidence of anything,
    // which matters because these records back an ISO 9001 §9.2 claim.
    if (status === 'COMPLETED' && audit.responses.length < audit.template.items.length) {
      throw new ApiError(
        409,
        `${audit.template.items.length - audit.responses.length} checklist item(s) still unanswered.`,
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.audit.update({
        where: { id },
        data: {
          status,
          conductedDate: status === 'COMPLETED' ? new Date() : audit.conductedDate,
        },
        include: detailInclude,
      });
      await appendAuditLog(tx, {
        userId: user.id,
        action: 'AUDIT_STATE_CHANGED',
        entityType: 'AUDIT',
        entityId: id,
        previousState: audit.status,
        newState: status,
        detail: note ? { note } : undefined,
        ipAddress: clientIp(req),
      });
      return next;
    });

    res.json(toPlain(updated));
  });
