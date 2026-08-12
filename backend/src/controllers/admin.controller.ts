import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { canViewAuditLog } from '../domain/rbac';
import { currentUser } from '../middleware/auth.middleware';
import { ApiError, asyncHandler } from '../middleware/error.middleware';
import {
  auditLogQuerySchema,
  createTemplateSchema,
  createUserSchema,
  createZoneSchema,
  operationalHoursSchema,
  updateUserSchema,
} from '../schemas';
import { appendAuditLog, changedFields, clientIp } from '../services/auditLog.service';
import { toPlain } from '../utils/serialize';

// ------------------------------- Users -------------------------------------

/**
 * Every authenticated user can read the directory, because assigning a
 * corrective action requires picking an assignee. Only a System Admin can
 * write to it (§9.3, "user & template management").
 */
export const listUsers = asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        department: true,
        zoneId: true,
        zone: { select: { name: true } },
      },
      orderBy: { fullName: 'asc' },
    });
    res.json({ data: users });
  });

export const createUser = asyncHandler(async (req, res) => {
    const actor = currentUser(req);
    const body = createUserSchema.parse(req.body);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: body.email.toLowerCase(),
          passwordHash: await bcrypt.hash(body.password, 10),
          fullName: body.fullName,
          role: body.role,
          department: body.department ?? null,
          zoneId: body.zoneId ?? null,
        },
        select: { id: true, email: true, fullName: true, role: true, department: true, zoneId: true },
      });

      await appendAuditLog(tx, {
        userId: actor.id,
        action: 'USER_CREATED',
        entityType: 'USER',
        entityId: user.id,
        newState: user.role,
        detail: { email: user.email, role: user.role },
        ipAddress: clientIp(req),
      });

      return user;
    });

    res.status(201).json(created);
  });

export const updateUser = asyncHandler(async (req, res) => {
    const actor = currentUser(req);
    const id = Number(req.params.id);
    const body = updateUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'User not found.');

    // Removing the last active admin would lock everybody out of user management.
    if ((body.role && body.role !== 'SYSTEM_ADMIN') || body.isActive === false) {
      if (existing.role === 'SYSTEM_ADMIN') {
        const admins = await prisma.user.count({
          where: { role: 'SYSTEM_ADMIN', isActive: true, id: { not: id } },
        });
        if (admins === 0) {
          throw new ApiError(409, 'Cannot remove the last active System Admin.');
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          ...(body.email ? { email: body.email.toLowerCase() } : {}),
          ...(body.fullName ? { fullName: body.fullName } : {}),
          ...(body.role ? { role: body.role } : {}),
          ...(body.department !== undefined ? { department: body.department } : {}),
          ...(body.zoneId !== undefined ? { zoneId: body.zoneId } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          department: true,
          zoneId: true,
          isActive: true,
        },
      });

      await appendAuditLog(tx, {
        userId: actor.id,
        action: 'USER_UPDATED',
        entityType: 'USER',
        entityId: id,
        previousState: existing.role,
        newState: user.role,
        detail: changedFields(existing as never, body as never),
        ipAddress: clientIp(req),
      });

      return user;
    });

    res.json(updated);
  });

// ------------------------------- Zones -------------------------------------

export const listZones = asyncHandler(async (_req, res) => {
    const zones = await prisma.zone.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { incidents: true, audits: true } } },
    });
    res.json({ data: zones });
  });

export const createZone = asyncHandler(async (req, res) => {
    const body = createZoneSchema.parse(req.body);
    const zone = await prisma.zone.create({
      data: {
        name: body.name,
        zoneType: body.zoneType,
        department: body.department ?? null,
        notes: body.notes ?? null,
      },
    });
    res.status(201).json(zone);
  });

// --------------------------- Checklist templates ---------------------------

export const listTemplates = asyncHandler(async (_req, res) => {
    const templates = await prisma.checklistTemplate.findMany({
      include: { items: { orderBy: { orderIndex: 'asc' } }, _count: { select: { audits: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ data: templates });
  });

export const createTemplate = asyncHandler(async (req, res) => {
    const actor = currentUser(req);
    const body = createTemplateSchema.parse(req.body);

    const created = await prisma.$transaction(async (tx) => {
      const template = await tx.checklistTemplate.create({
        data: {
          name: body.name,
          description: body.description ?? null,
          category: body.category ?? null,
          isoClause: body.isoClause ?? null,
          items: {
            create: body.items.map((item, index) => ({
              itemText: item.itemText,
              category: item.category ?? null,
              orderIndex: item.orderIndex ?? index,
            })),
          },
        },
        include: { items: { orderBy: { orderIndex: 'asc' } } },
      });

      await appendAuditLog(tx, {
        userId: actor.id,
        action: 'TEMPLATE_CREATED',
        entityType: 'CHECKLIST_TEMPLATE',
        entityId: template.id,
        detail: { name: template.name, items: template.items.length },
        ipAddress: clientIp(req),
      });

      return template;
    });

    res.status(201).json(created);
  });

// -------------------------- Operational hours ------------------------------

export const listOperationalHours = asyncHandler(async (_req, res) => {
    const rows = await prisma.operationalHours.findMany({
      include: { zone: { select: { id: true, name: true } } },
      orderBy: { periodStart: 'desc' },
    });
    res.json({ data: toPlain(rows) });
  });

export const createOperationalHours = asyncHandler(async (req, res) => {
    const body = operationalHoursSchema.parse(req.body);
    if (body.periodEnd <= body.periodStart) {
      throw new ApiError(400, 'periodEnd must be after periodStart.');
    }
    const row = await prisma.operationalHours.create({
      data: {
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        personHours: body.personHours,
        zoneId: body.zoneId ?? null,
      },
    });
    res.status(201).json(toPlain(row));
  });

// ------------------------------ Audit log ----------------------------------

/**
 * Read-only by construction: this router exposes GET only. There is no PATCH
 * or DELETE route for audit_log anywhere in the API, which is what makes the
 * table insert-only at the application layer (§9.4).
 */
export const listAuditLog = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    if (!canViewAuditLog(user.role)) {
      throw new ApiError(403, 'Audit log access requires Department Lead or System Admin.');
    }

    const q = auditLogQuerySchema.parse(req.query);
    const where = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, role: true } } },
        orderBy: { timestamp: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    res.json({
      data: toPlain(rows),
      pagination: { page: q.page, pageSize: q.pageSize, total, pages: Math.ceil(total / q.pageSize) },
    });
  });
