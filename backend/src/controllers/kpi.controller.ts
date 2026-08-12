import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { auditScope, correctiveActionScope, incidentScope, scopeLabel } from '../domain/rbac';
import { currentUser } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { kpiQuerySchema } from '../schemas';
import { toPlain } from '../utils/serialize';

/**
 * Proposal §11 — standardised KPIs.
 *
 * Every figure is computed from the Incident / Audit / CorrectiveAction tables
 * at request time. Nothing is stored redundantly, so the dashboard can never
 * show a stale number.
 *
 * Definitions used here, stated explicitly because "closed" is ambiguous in a
 * five-state action lifecycle:
 *
 *   CACR = VERIFIED actions / all raised actions x 100
 *          VERIFIED is the terminal state; COMPLETED means the assignee says
 *          it is done but nobody independent has confirmed it, which is not
 *          closure in an ISO sense.
 *
 *   MTTC = mean(verifiedAt - raisedAt) in days, over VERIFIED actions only.
 *
 *   NMFR = (near-misses / person-hours) x 200,000, the OSHA normalisation
 *          constant (100 FTE x 2,000 h/yr).
 */

const NMFR_CONSTANT = 200_000;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const summary = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const q = kpiQuerySchema.parse(req.query);

    const from = q.from ?? new Date(Date.now() - 365 * MS_PER_DAY);
    const to = q.to ?? new Date();

    const incidentWhere: Prisma.IncidentWhereInput = {
      AND: [
        incidentScope(user),
        { occurredAt: { gte: from, lte: to } },
        ...(q.zoneId ? [{ zoneId: q.zoneId }] : []),
      ],
    };
    const actionWhere: Prisma.CorrectiveActionWhereInput = {
      AND: [correctiveActionScope(user), { raisedAt: { gte: from, lte: to } }],
    };
    const auditWhere: Prisma.AuditWhereInput = {
      AND: [auditScope(user), { scheduledDate: { gte: from, lte: to } }],
    };

    const [
      totalIncidents,
      nearMisses,
      incidentsByStatus,
      incidentsByCause,
      incidentsByRisk,
      totalActions,
      verifiedActions,
      overdueActions,
      verifiedRows,
      auditsTotal,
      auditsCompleted,
      hoursRows,
      monthlyRows,
      zoneRows,
    ] = await Promise.all([
      prisma.incident.count({ where: incidentWhere }),
      prisma.incident.count({ where: { AND: [incidentWhere, { type: 'NEAR_MISS' }] } }),
      prisma.incident.groupBy({ by: ['status'], where: incidentWhere, _count: { _all: true } }),
      prisma.incident.groupBy({
        by: ['causeCategory'],
        where: incidentWhere,
        _count: { _all: true },
      }),
      prisma.incident.groupBy({
        by: ['predictedRiskLevel'],
        where: incidentWhere,
        _count: { _all: true },
      }),
      prisma.correctiveAction.count({ where: actionWhere }),
      prisma.correctiveAction.count({ where: { AND: [actionWhere, { status: 'VERIFIED' }] } }),
      prisma.correctiveAction.count({ where: { AND: [actionWhere, { status: 'OVERDUE' }] } }),
      prisma.correctiveAction.findMany({
        where: { AND: [actionWhere, { status: 'VERIFIED' }, { verifiedAt: { not: null } }] },
        select: { raisedAt: true, verifiedAt: true },
      }),
      prisma.audit.count({ where: auditWhere }),
      prisma.audit.count({ where: { AND: [auditWhere, { status: 'COMPLETED' }] } }),
      prisma.operationalHours.findMany({
        where: {
          periodStart: { gte: from },
          periodEnd: { lte: to },
          ...(q.zoneId ? { zoneId: q.zoneId } : {}),
        },
        select: { personHours: true },
      }),
      prisma.incident.findMany({
        where: incidentWhere,
        select: { occurredAt: true, type: true },
        orderBy: { occurredAt: 'asc' },
      }),
      prisma.incident.groupBy({
        by: ['zoneId'],
        where: incidentWhere,
        _count: { _all: true },
      }),
    ]);

    // --- CACR -------------------------------------------------------------
    const cacr = totalActions > 0 ? (verifiedActions / totalActions) * 100 : null;

    // --- MTTC -------------------------------------------------------------
    const mttc =
      verifiedRows.length > 0
        ? verifiedRows.reduce(
            (sum, row) => sum + (row.verifiedAt!.getTime() - row.raisedAt.getTime()) / MS_PER_DAY,
            0,
          ) / verifiedRows.length
        : null;

    // --- NMFR -------------------------------------------------------------
    const personHours = hoursRows.reduce((sum, row) => sum + row.personHours.toNumber(), 0);
    const nmfr = personHours > 0 ? (nearMisses / personHours) * NMFR_CONSTANT : null;

    // --- Supporting series ------------------------------------------------
    const monthly = buildMonthlySeries(monthlyRows, from, to);

    const zoneNames = await prisma.zone.findMany({
      where: { id: { in: zoneRows.map((r) => r.zoneId).filter((z): z is number => z !== null) } },
      select: { id: true, name: true },
    });
    const zoneNameById = new Map(zoneNames.map((z) => [z.id, z.name]));

    res.json({
      period: { from, to },
      scope: scopeLabel(user, req.user?.zoneName),
      kpis: {
        cacr: {
          value: cacr,
          unit: '%',
          label: 'Corrective Action Closure Rate',
          formula: '(closed corrective actions / total raised) x 100',
          numerator: verifiedActions,
          denominator: totalActions,
          note: totalActions === 0 ? 'No corrective actions raised in this period.' : null,
        },
        mttc: {
          value: mttc,
          unit: 'days',
          label: 'Mean Time to Close',
          formula: 'mean(closure date - date raised) over closed actions',
          sampleSize: verifiedRows.length,
          note: verifiedRows.length === 0 ? 'No actions have been closed in this period.' : null,
        },
        nmfr: {
          value: nmfr,
          unit: 'per 200,000 person-hours',
          label: 'Near-Miss Frequency Rate',
          formula: '(near-misses / person-hours) x 200,000',
          nearMisses,
          personHours,
          note:
            personHours === 0
              ? 'No operational person-hours logged for this period — record them under Admin.'
              : null,
        },
      },
      counts: {
        totalIncidents,
        nearMisses,
        actualIncidents: totalIncidents - nearMisses,
        totalActions,
        verifiedActions,
        overdueActions,
        auditsTotal,
        auditsCompleted,
        auditCompletionRate: auditsTotal > 0 ? (auditsCompleted / auditsTotal) * 100 : null,
      },
      breakdowns: {
        byStatus: incidentsByStatus.map((r) => ({ key: r.status, count: r._count._all })),
        byCause: incidentsByCause.map((r) => ({
          key: r.causeCategory ?? 'UNSPECIFIED',
          count: r._count._all,
        })),
        byPredictedRisk: incidentsByRisk.map((r) => ({
          key: r.predictedRiskLevel ?? 'UNSCORED',
          count: r._count._all,
        })),
        byZone: zoneRows
          .map((r) => ({
            key: r.zoneId ? (zoneNameById.get(r.zoneId) ?? `Zone ${r.zoneId}`) : 'Unassigned',
            count: r._count._all,
          }))
          .sort((a, b) => b.count - a.count),
        monthly,
      },
    });
  });

function buildMonthlySeries(
  rows: { occurredAt: Date; type: string }[],
  from: Date,
  to: Date,
): { month: string; incidents: number; nearMisses: number }[] {
  const buckets = new Map<string, { incidents: number; nearMisses: number }>();

  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cursor <= end) {
    buckets.set(monthKey(cursor), { incidents: 0, nearMisses: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  for (const row of rows) {
    const key = monthKey(row.occurredAt);
    const bucket = buckets.get(key) ?? { incidents: 0, nearMisses: 0 };
    if (row.type === 'NEAR_MISS') bucket.nearMisses += 1;
    else bucket.incidents += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, ...value }));
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Raw rows behind the KPI tiles, for the "show me the working" drill-down. */
export const correctiveActionRows = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const rows = await prisma.correctiveAction.findMany({
      where: correctiveActionScope(user),
      select: {
        id: true,
        referenceNumber: true,
        status: true,
        raisedAt: true,
        dueDate: true,
        completedDate: true,
        verifiedAt: true,
        source: true,
      },
      orderBy: { raisedAt: 'desc' },
      take: 200,
    });
    res.json({ data: toPlain(rows) });
  });
