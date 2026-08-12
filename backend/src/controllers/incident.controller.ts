import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { incidentScope } from '../domain/rbac';
import { assertIncidentTransition } from '../domain/stateMachine';
import { formatReference, temporaryReference } from '../domain/references';
import { currentUser } from '../middleware/auth.middleware';
import { ApiError, asyncHandler } from '../middleware/error.middleware';
import {
  createIncidentSchema,
  incidentQuerySchema,
  transitionIncidentSchema,
  updateIncidentSchema,
} from '../schemas';
import { appendAuditLog, changedFields, clientIp } from '../services/auditLog.service';
import { MlServiceUnavailable, predictRisk } from '../services/mlClient.service';
import { toPlain } from '../utils/serialize';

const listInclude = {
  reportedBy: { select: { id: true, fullName: true, email: true, role: true } },
  zone: { select: { id: true, name: true, zoneType: true, department: true } },
  _count: { select: { correctiveActions: true } },
} satisfies Prisma.IncidentInclude;

const detailInclude = {
  reportedBy: { select: { id: true, fullName: true, email: true, role: true } },
  zone: { select: { id: true, name: true, zoneType: true, department: true } },
  correctiveActions: {
    include: { assignedTo: { select: { id: true, fullName: true } } },
    orderBy: { dueDate: 'asc' },
  },
  attachments: true,
} satisfies Prisma.IncidentInclude;

/** Editing is closed once a record reaches a state that has been signed off. */
const EDITABLE_STATES = ['DRAFT', 'SUBMITTED', 'UNDER_INVESTIGATION'] as const;

// ------------------------------- List --------------------------------------

export const list = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const q = incidentQuerySchema.parse(req.query);

    const filters: Prisma.IncidentWhereInput[] = [incidentScope(user)];
    if (q.status) filters.push({ status: q.status });
    if (q.type) filters.push({ type: q.type });
    if (q.causeCategory) filters.push({ causeCategory: q.causeCategory });
    if (q.zoneId) filters.push({ zoneId: q.zoneId });
    if (q.from) filters.push({ occurredAt: { gte: q.from } });
    if (q.to) filters.push({ occurredAt: { lte: q.to } });
    if (q.search) {
      filters.push({
        OR: [
          { title: { contains: q.search, mode: 'insensitive' } },
          { description: { contains: q.search, mode: 'insensitive' } },
          { referenceNumber: { contains: q.search, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.IncidentWhereInput = { AND: filters };

    const [total, rows] = await Promise.all([
      prisma.incident.count({ where }),
      prisma.incident.findMany({
        where,
        include: listInclude,
        orderBy: { occurredAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    res.json({
      data: toPlain(rows),
      pagination: { page: q.page, pageSize: q.pageSize, total, pages: Math.ceil(total / q.pageSize) },
    });
  });

// ------------------------------ Detail -------------------------------------

export const detail = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);

    const incident = await prisma.incident.findFirst({
      where: { AND: [{ id }, incidentScope(user)] },
      include: detailInclude,
    });
    if (!incident) throw new ApiError(404, 'Incident not found or outside your access scope.');

    const history = await prisma.auditLog.findMany({
      where: { entityType: 'INCIDENT', entityId: id },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { timestamp: 'asc' },
    });

    res.json({ ...toPlain(incident), history: toPlain(history) });
  });

// ------------------------------ Create -------------------------------------

export const create = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const body = createIncidentSchema.parse(req.body);

    const created = await prisma.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          ...body,
          referenceNumber: temporaryReference('INC'),
          reportedById: user.id,
          status: 'DRAFT',
        },
      });

      const withReference = await tx.incident.update({
        where: { id: incident.id },
        data: { referenceNumber: formatReference('INC', incident.id, incident.createdAt) },
        include: detailInclude,
      });

      await appendAuditLog(tx, {
        userId: user.id,
        action: 'INCIDENT_CREATED',
        entityType: 'INCIDENT',
        entityId: incident.id,
        newState: 'DRAFT',
        detail: { referenceNumber: withReference.referenceNumber, title: withReference.title },
        ipAddress: clientIp(req),
      });

      return withReference;
    });

    // Scoring is best-effort: a predictive-service outage must never stop a
    // safety report from being filed.
    const scored = await scoreAndPersist(created.id, req).catch(() => null);

    res.status(201).json(toPlain(scored ?? created));
  });

// ------------------------------ Update -------------------------------------

export const update = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const body = updateIncidentSchema.parse(req.body);

    const existing = await prisma.incident.findFirst({
      where: { AND: [{ id }, incidentScope(user)] },
    });
    if (!existing) throw new ApiError(404, 'Incident not found or outside your access scope.');

    if (!EDITABLE_STATES.includes(existing.status as (typeof EDITABLE_STATES)[number])) {
      throw new ApiError(409, `An incident in ${existing.status} can no longer be edited.`);
    }

    const isOwner = existing.reportedById === user.id;
    const isApprover = user.role === 'DEPARTMENT_LEAD' || user.role === 'SYSTEM_ADMIN';
    const isInvestigator = isApprover || user.role === 'QHSSE_AUDITOR';

    if (existing.status === 'DRAFT' && !isOwner && !isApprover) {
      throw new ApiError(403, 'Only the reporter may edit a draft.');
    }
    if (existing.status !== 'DRAFT' && !isInvestigator) {
      throw new ApiError(403, 'Only investigators may edit a submitted incident.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.incident.update({
        where: { id },
        data: body,
        include: detailInclude,
      });
      await appendAuditLog(tx, {
        userId: user.id,
        action: 'INCIDENT_UPDATED',
        entityType: 'INCIDENT',
        entityId: id,
        previousState: existing.status,
        newState: next.status,
        detail: changedFields(existing as never, body as never),
        ipAddress: clientIp(req),
      });
      return next;
    });

    // Any edit can change the model inputs, so re-score.
    const scored = await scoreAndPersist(id, req).catch(() => null);

    res.json(toPlain(scored ?? updated));
  });

// ---------------------------- Transition -----------------------------------

export const transition = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const { status, note } = transitionIncidentSchema.parse(req.body);

    const existing = await prisma.incident.findFirst({
      where: { AND: [{ id }, incidentScope(user)] },
    });
    if (!existing) throw new ApiError(404, 'Incident not found or outside your access scope.');

    // Throws TransitionError (409) or TransitionForbiddenError (403).
    assertIncidentTransition(existing.status, status, user.role);

    // Submitting your own draft is the one transition tied to ownership.
    if (existing.status === 'DRAFT' && existing.reportedById !== user.id && user.role !== 'SYSTEM_ADMIN') {
      throw new ApiError(403, 'Only the reporter may submit their own draft.');
    }

    // Closing out an incident that still has unfinished corrective actions
    // would make the CACR KPI meaningless.
    if (status === 'VERIFIED' || status === 'CLOSED') {
      const open = await prisma.correctiveAction.count({
        where: { incidentId: id, status: { notIn: ['VERIFIED'] } },
      });
      if (open > 0) {
        throw new ApiError(
          409,
          `${open} corrective action(s) on this incident are not yet verified.`,
        );
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.incident.update({
        where: { id },
        data: { status },
        include: detailInclude,
      });
      await appendAuditLog(tx, {
        userId: user.id,
        action: 'INCIDENT_STATE_CHANGED',
        entityType: 'INCIDENT',
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

// ------------------------------ Scoring ------------------------------------

export const score = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);

    const exists = await prisma.incident.findFirst({
      where: { AND: [{ id }, incidentScope(user)] },
      select: { id: true },
    });
    if (!exists) throw new ApiError(404, 'Incident not found or outside your access scope.');

    const scored = await scoreAndPersist(id, req);
    res.json(toPlain(scored));
  });

/**
 * Runs the incident through the predictive service and writes the result back.
 * Only pre-consequence fields are sent: fatalities, injuries and cost are the
 * fields SIGNIFICANT is derived from, and passing them would be target
 * leakage (proposal §8.2).
 */
async function scoreAndPersist(id: number, req: Parameters<typeof clientIp>[0]) {
  const incident = await prisma.incident.findUniqueOrThrow({ where: { id } });

  const pipeAgeYears =
    incident.yearInstalled != null
      ? incident.occurredAt.getFullYear() - incident.yearInstalled
      : null;

  const prediction = await predictRisk({
    causeCategory: incident.causeCategory,
    systemPart: incident.systemPart,
    locationType: incident.locationType,
    linePressurePsig: incident.linePressurePsig?.toNumber() ?? null,
    pipeDiameterInches: incident.pipeDiameterInches?.toNumber() ?? null,
    ignitionOccurred: incident.ignitionOccurred,
    explosionOccurred: incident.explosionOccurred,
    pipeMaterial: incident.pipeMaterial,
    releaseType: incident.releaseType,
    incidentAreaType: incident.incidentAreaType,
    pipeAgeYears: pipeAgeYears != null && pipeAgeYears >= 0 && pipeAgeYears <= 150 ? pipeAgeYears : null,
    featureSet: 'B',
  });

  return prisma.incident.update({
    where: { id },
    data: {
      predictedRiskLevel: prediction.riskLevel,
      predictedRiskScore: new Prisma.Decimal(prediction.probability.toFixed(4)),
      predictedByModel: `${prediction.model} (set ${prediction.featureSet})`,
      predictedAt: new Date(),
    },
    include: detailInclude,
  });
}

export { MlServiceUnavailable };
