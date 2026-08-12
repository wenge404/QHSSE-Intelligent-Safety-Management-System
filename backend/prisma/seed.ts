/**
 * IQSMS demo seed.
 *
 * Operational records are synthetic and modelled on Gaz du Cameroun's Logbaba
 * fields (gas plant, pipeline sections A–C, PRMS stations) rather than GDC's
 * actual records, for the confidentiality reason given in proposal §10.1.
 *
 * The generator is seeded, so `npm run seed` produces the same dataset every
 * time — a demo that reshuffles itself between dry-run and defense is worse
 * than no demo.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Demo credentials. Documented in the README; not a production concern. */
const DEMO_PASSWORD = 'Password123!';

// --------------------------- deterministic RNG -----------------------------

let seed = 20260812;
function random(): number {
  // mulberry32 — small, fast, and reproducible across Node versions.
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}
function pickWeighted<T>(items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of items) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return items[items.length - 1][0];
}
function between(min: number, max: number): number {
  return min + random() * (max - min);
}
function intBetween(min: number, max: number): number {
  return Math.floor(between(min, max + 1));
}
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  console.log('Clearing existing data…');
  // TRUNCATE rather than deleteMany(), for two reasons:
  //
  //  1. The audit_log append-only trigger (migration
  //     20260812160000_state_transition_guards) refuses row-level DELETE, which
  //     is the whole point of §9.4. TRUNCATE does not fire row triggers, and it
  //     requires table-owner rights that a production application role would
  //     not be granted — so a dev reset stays possible without weakening the
  //     guarantee the platform actually ships.
  //  2. RESTART IDENTITY resets the sequences, so reference numbers come out
  //     identical on every seed. A demo that renumbers itself between the dry
  //     run and the defense is worse than no demo.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_log, attachments, corrective_actions, audit_responses, audits,
      checklist_items, checklist_templates, incidents, operational_hours,
      users, zones
    RESTART IDENTITY CASCADE
  `);

  // ----------------------------- Zones ------------------------------------

  console.log('Creating zones…');
  const zoneSpecs = [
    { name: 'Logbaba Gas Plant', zoneType: 'PROCESSING_FACILITY', department: 'Operations' },
    { name: 'Wellhead Cluster La-105', zoneType: 'WELLHEAD', department: 'Operations' },
    { name: 'Pipeline Section A — Logbaba to Bonaberi', zoneType: 'PIPELINE_SECTION', department: 'Pipeline Integrity' },
    { name: 'Pipeline Section B — Bonaberi Industrial Spur', zoneType: 'PIPELINE_SECTION', department: 'Pipeline Integrity' },
    { name: 'Pipeline Section C — Deido Lateral', zoneType: 'PIPELINE_SECTION', department: 'Pipeline Integrity' },
    { name: 'PRMS Station Bonaberi', zoneType: 'DISTRIBUTION_NETWORK', department: 'Distribution' },
    { name: 'PRMS Station Deido', zoneType: 'DISTRIBUTION_NETWORK', department: 'Distribution' },
    { name: 'Douala Head Office', zoneType: 'OFFICE', department: 'Corporate' },
  ] as const;

  const zones = [];
  for (const spec of zoneSpecs) {
    zones.push(
      await prisma.zone.create({
        data: {
          name: spec.name,
          zoneType: spec.zoneType,
          department: spec.department,
          notes: null,
        },
      }),
    );
  }
  const zoneByName = new Map(zones.map((z) => [z.name, z]));
  const fieldZones = zones.filter((z) => z.name !== 'Douala Head Office');

  // ----------------------------- Users ------------------------------------

  console.log('Creating users…');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const userSpecs = [
    {
      email: 'admin@gdc.cm',
      fullName: 'Amina Njoya',
      role: 'SYSTEM_ADMIN',
      department: 'Corporate',
      zone: null,
    },
    {
      email: 'lead.integrity@gdc.cm',
      fullName: 'Étienne Mbarga',
      role: 'DEPARTMENT_LEAD',
      department: 'Pipeline Integrity',
      zone: null,
    },
    {
      email: 'lead.distribution@gdc.cm',
      fullName: 'Clarisse Fotso',
      role: 'DEPARTMENT_LEAD',
      department: 'Distribution',
      zone: null,
    },
    {
      email: 'auditor.sectiona@gdc.cm',
      fullName: 'Serge Kamdem',
      role: 'QHSSE_AUDITOR',
      department: 'Pipeline Integrity',
      zone: 'Pipeline Section A — Logbaba to Bonaberi',
    },
    {
      email: 'auditor.prms@gdc.cm',
      fullName: 'Brenda Ekwalla',
      role: 'QHSSE_AUDITOR',
      department: 'Distribution',
      zone: 'PRMS Station Bonaberi',
    },
    {
      email: 'reporter.plant@gdc.cm',
      fullName: 'Joseph Tchoumi',
      role: 'FIELD_REPORTER',
      department: 'Operations',
      zone: 'Logbaba Gas Plant',
    },
    {
      email: 'reporter.field@gdc.cm',
      fullName: 'Marthe Ngassa',
      role: 'FIELD_REPORTER',
      department: 'Pipeline Integrity',
      zone: 'Pipeline Section B — Bonaberi Industrial Spur',
    },
    {
      email: 'reporter.dist@gdc.cm',
      fullName: 'Pascal Eboa',
      role: 'FIELD_REPORTER',
      department: 'Distribution',
      zone: 'PRMS Station Deido',
    },
  ] as const;

  const users = [];
  for (const spec of userSpecs) {
    users.push(
      await prisma.user.create({
        data: {
          email: spec.email,
          passwordHash,
          fullName: spec.fullName,
          role: spec.role,
          department: spec.department,
          zoneId: spec.zone ? (zoneByName.get(spec.zone)?.id ?? null) : null,
        },
      }),
    );
  }
  const admin = users[0];
  const leads = users.filter((u) => u.role === 'DEPARTMENT_LEAD');
  const auditors = users.filter((u) => u.role === 'QHSSE_AUDITOR');
  const reporters = users.filter((u) => u.role === 'FIELD_REPORTER');

  // ------------------------ Checklist templates ---------------------------

  console.log('Creating checklist templates…');
  const templateSpecs = [
    {
      name: 'Monthly Fire Safety Inspection',
      category: 'Fire & Emergency',
      isoClause: 'ISO 9001:2015 §9.2',
      description: 'Routine fire-protection readiness check for plant and station assets.',
      items: [
        'Fire extinguishers present, in date, and unobstructed',
        'Fire detection panel powered with no active faults',
        'Emergency assembly points signposted and clear',
        'Foam/dry-powder stock levels above minimum',
        'Emergency shutdown (ESD) button accessible and labelled',
        'Fire water pump test record completed this month',
      ],
    },
    {
      name: 'Pipeline Right-of-Way Patrol',
      category: 'Pipeline Integrity',
      isoClause: 'ISO 14001:2015 §6.1',
      description: 'Walked or driven inspection of the right-of-way for third-party interference.',
      items: [
        'Route markers visible and correctly positioned',
        'No unauthorised excavation within the easement',
        'No encroaching construction or permanent structures',
        'Vegetation clearance within specification',
        'No visible ground disturbance, subsidence or erosion',
        'Cathodic protection test posts intact',
        'No reported third-party damage since last patrol',
      ],
    },
    {
      name: 'PRMS Station Integrity Check',
      category: 'Distribution',
      isoClause: 'ISO 45001:2018 §10.2',
      description: 'Pressure regulating and metering station mechanical and safety inspection.',
      items: [
        'Station fence, gate and warning signage secure',
        'Regulator outlet pressure within set limits',
        'Relief valve set-point verified against MAOP',
        'No audible or detectable gas leak at joints',
        'Odorant injection level confirmed',
        'Station logbook up to date',
      ],
    },
    {
      name: 'Permit to Work Compliance Audit',
      category: 'Occupational Safety',
      isoClause: 'ISO 45001:2018 §8.1',
      description: 'Verification that active work permits meet the PTW procedure.',
      items: [
        'Permit displayed at the worksite',
        'Gas test recorded before hot work commenced',
        'Isolation certificate attached where required',
        'PPE matches the permit hazard assessment',
        'Standby person assigned for confined-space entry',
      ],
    },
  ] as const;

  const templates = [];
  for (const spec of templateSpecs) {
    templates.push(
      await prisma.checklistTemplate.create({
        data: {
          name: spec.name,
          category: spec.category,
          isoClause: spec.isoClause,
          description: spec.description,
          items: {
            create: spec.items.map((itemText, index) => ({
              itemText,
              category: spec.category,
              orderIndex: index,
            })),
          },
        },
        include: { items: { orderBy: { orderIndex: 'asc' } } },
      }),
    );
  }

  // --------------------------- Incidents ----------------------------------

  console.log('Creating incidents…');

  const incidentTemplates = [
    {
      title: 'Third-party excavation strike on distribution main',
      description:
        'A contractor operating a mini-excavator without a valid work permit struck a buried steel main during roadworks. Gas release was detected by the crew and the section was isolated at the upstream valve within 12 minutes.',
      causeCategory: 'EXCAVATION_DAMAGE',
      systemPart: 'MAIN',
      releaseType: 'MECHANICAL_PUNCTURE',
      pipeMaterial: 'STEEL',
      incidentAreaType: 'UNDERGROUND',
      locationType: 'PUBLIC_PROPERTY',
    },
    {
      title: 'External corrosion pinhole leak on service line',
      description:
        'Routine leak survey identified a soap-bubble indication at a service tee. Excavation confirmed external corrosion pitting beneath degraded wrap coating. Service was cut and re-laid in polyethylene.',
      causeCategory: 'CORROSION_FAILURE',
      systemPart: 'SERVICE',
      releaseType: 'LEAK',
      pipeMaterial: 'STEEL',
      incidentAreaType: 'UNDERGROUND',
      locationType: 'PRIVATE_PROPERTY',
    },
    {
      title: 'Regulator lock-up failure at PRMS outlet',
      description:
        'Station outlet pressure drifted above the set point during a low-demand period. The monitor regulator held and the relief did not lift, but the run was taken out of service pending diaphragm replacement.',
      causeCategory: 'EQUIPMENT_FAILURE',
      systemPart: 'DISTRICT_REGULATOR_METERING_STATION',
      releaseType: 'OTHER',
      pipeMaterial: 'STEEL',
      incidentAreaType: 'ABOVEGROUND',
      locationType: 'OPERATOR_CONTROLLED_PROPERTY',
    },
    {
      title: 'Vehicle impact on exposed riser',
      description:
        'A delivery vehicle reversing in a customer yard struck an unprotected service riser, bending the pipe above the transition fitting. No release was detected but the riser was replaced as a precaution.',
      causeCategory: 'OTHER_OUTSIDE_FORCE',
      systemPart: 'SERVICE_RISER',
      releaseType: 'OTHER',
      pipeMaterial: 'STEEL',
      incidentAreaType: 'ABOVEGROUND',
      locationType: 'PRIVATE_PROPERTY',
    },
    {
      title: 'Heavy rainfall erosion exposing pipeline section',
      description:
        'Sustained seasonal rainfall eroded cover over a low-lying stretch of the right-of-way, leaving approximately 6 m of pipe exposed. No damage to the coating was found. Cover was reinstated and erosion matting installed.',
      causeCategory: 'NATURAL_FORCE_DAMAGE',
      systemPart: 'MAIN',
      releaseType: 'OTHER',
      pipeMaterial: 'STEEL',
      incidentAreaType: 'UNDERGROUND',
      locationType: 'UTILITY_ROW_EASEMENT',
    },
    {
      title: 'Incorrect valve line-up during commissioning',
      description:
        'During recommissioning of a spur, a technician opened the wrong isolation valve, briefly pressurising a section that had not been purge-tested. The error was caught at the second check and the section was re-purged.',
      causeCategory: 'INCORRECT_OPERATION',
      systemPart: 'MAIN_VALVE',
      releaseType: 'OTHER',
      pipeMaterial: 'STEEL',
      incidentAreaType: 'ABOVEGROUND',
      locationType: 'OPERATOR_CONTROLLED_PROPERTY',
    },
    {
      title: 'Weld defect discovered on tie-in spool',
      description:
        'Radiographic inspection of a tie-in weld revealed incomplete penetration over a 40 mm length. The spool was cut out and re-welded before the section was returned to service.',
      causeCategory: 'PIPE_WELD_JOINT_FAILURE',
      systemPart: 'MAIN',
      releaseType: 'OTHER',
      pipeMaterial: 'STEEL',
      incidentAreaType: 'ABOVEGROUND',
      locationType: 'OPERATOR_CONTROLLED_PROPERTY',
    },
    {
      title: 'Odorant level below specification at station outlet',
      description:
        'Routine odorant sniff test at the station outlet returned a reading below the required detection threshold. The injection pump was found partially blocked and was cleaned and recalibrated.',
      causeCategory: 'EQUIPMENT_FAILURE',
      systemPart: 'OUTSIDE_METER_REGULATOR_SET',
      releaseType: 'OTHER',
      pipeMaterial: 'OTHER',
      incidentAreaType: 'ABOVEGROUND',
      locationType: 'OPERATOR_CONTROLLED_PROPERTY',
    },
    {
      title: 'Near-miss: unpermitted hot work adjacent to gas line',
      description:
        'A subcontractor was observed preparing to grind on a support bracket within 3 m of a live service, without a hot-work permit or gas test. Work was stopped before any ignition source was introduced.',
      causeCategory: 'INCORRECT_OPERATION',
      systemPart: 'SERVICE',
      releaseType: 'OTHER',
      pipeMaterial: 'STEEL',
      incidentAreaType: 'ABOVEGROUND',
      locationType: 'OPERATOR_CONTROLLED_PROPERTY',
    },
    {
      title: 'Near-miss: excavation within easement without notification',
      description:
        'A patrol found a third party excavating a drainage trench inside the pipeline easement with no prior notification to GDC. Work was halted; the pipe was located and confirmed undamaged.',
      causeCategory: 'EXCAVATION_DAMAGE',
      systemPart: 'MAIN',
      releaseType: 'OTHER',
      pipeMaterial: 'STEEL',
      incidentAreaType: 'UNDERGROUND',
      locationType: 'UTILITY_ROW_EASEMENT',
    },
    {
      title: 'Near-miss: unsecured station gate found open overnight',
      description:
        'The PRMS compound gate was found unlocked at the start of shift, with evidence it had been open overnight. No interference with station equipment was found on inspection.',
      causeCategory: 'OTHER_UNKNOWN',
      systemPart: 'DISTRICT_REGULATOR_METERING_STATION',
      releaseType: 'OTHER',
      pipeMaterial: 'OTHER',
      incidentAreaType: 'ABOVEGROUND',
      locationType: 'OPERATOR_CONTROLLED_PROPERTY',
    },
    {
      title: 'Near-miss: PPE non-compliance during purge operation',
      description:
        'Two operatives were observed conducting a nitrogen purge without flame-retardant coveralls. The task was suspended and restarted after a toolbox talk and correct PPE issue.',
      causeCategory: 'INCORRECT_OPERATION',
      systemPart: 'MAIN',
      releaseType: 'OTHER',
      pipeMaterial: 'STEEL',
      incidentAreaType: 'ABOVEGROUND',
      locationType: 'OPERATOR_CONTROLLED_PROPERTY',
    },
  ] as const;

  // Weighted so the workflow board has records at every stage rather than a
  // pile of drafts.
  const statusWeights = [
    ['CLOSED', 26],
    ['VERIFIED', 10],
    ['CORRECTIVE_ACTION_PENDING', 16],
    ['UNDER_INVESTIGATION', 16],
    ['SUBMITTED', 14],
    ['DRAFT', 8],
  ] as const;

  const createdIncidents = [];
  const INCIDENT_COUNT = 46;

  for (let i = 0; i < INCIDENT_COUNT; i += 1) {
    const spec = pick(incidentTemplates);
    const isNearMiss = spec.title.startsWith('Near-miss');
    const zone = pick(fieldZones);
    const reporter = pick([...reporters, ...auditors]);
    const occurredAt = daysAgo(intBetween(3, 350));

    // A near-miss by definition had no consequence; a real incident may have.
    const ignition = isNearMiss ? false : random() < 0.35;
    const explosion = ignition && random() < 0.3;
    const severity = isNearMiss
      ? pickWeighted([['LOW', 6], ['MEDIUM', 3], ['HIGH', 1]] as const)
      : pickWeighted([['LOW', 3], ['MEDIUM', 4], ['HIGH', 2], ['CRITICAL', 1]] as const);

    const status = pickWeighted(statusWeights);

    const incident = await prisma.incident.create({
      data: {
        referenceNumber: `INC-TMP-${i}`,
        type: isNearMiss ? 'NEAR_MISS' : 'INCIDENT',
        title: spec.title,
        description: spec.description,
        occurredAt,
        reportedAt: addDays(occurredAt, intBetween(0, 2)),
        reportedById: reporter.id,
        zoneId: zone.id,
        causeCategory: spec.causeCategory,
        causeDescription: null,
        systemPart: spec.systemPart,
        locationType: spec.locationType,
        linePressurePsig: new Prisma.Decimal(intBetween(4, 240)),
        pipeDiameterInches: random() < 0.62 ? new Prisma.Decimal(pick([1, 2, 3, 4, 6, 8, 12])) : null,
        ignitionOccurred: ignition,
        explosionOccurred: explosion,
        pipeMaterial: spec.pipeMaterial,
        releaseType: spec.releaseType,
        incidentAreaType: spec.incidentAreaType,
        yearInstalled: intBetween(1978, 2021),
        severity,
        fatalities: 0,
        injuries: isNearMiss ? 0 : (random() < 0.12 ? 1 : 0),
        propertyDamageCost: isNearMiss
          ? null
          : new Prisma.Decimal(Math.round(between(200_000, 24_000_000))),
        gasVolumeReleasedMcf: isNearMiss ? null : new Prisma.Decimal(between(0.4, 180).toFixed(2)),
        evacuationCount: isNearMiss ? 0 : (random() < 0.15 ? intBetween(2, 40) : 0),
        assetType: zone.zoneType === 'DISTRIBUTION_NETWORK' ? 'PRMS skid' : 'Buried pipeline',
        scadaPresent: random() < 0.6,
        scadaOperational: random() < 0.85,
        status,
      },
    });

    const withRef = await prisma.incident.update({
      where: { id: incident.id },
      data: { referenceNumber: `INC-${occurredAt.getFullYear()}-${String(incident.id).padStart(4, '0')}` },
    });
    createdIncidents.push(withRef);

    // Replay a plausible transition history into the immutable trail so the
    // audit-log screen has something real to show.
    await prisma.auditLog.create({
      data: {
        userId: reporter.id,
        action: 'INCIDENT_CREATED',
        entityType: 'INCIDENT',
        entityId: incident.id,
        newState: 'DRAFT',
        detail: { referenceNumber: withRef.referenceNumber, seeded: true },
        timestamp: withRef.reportedAt,
      },
    });

    const path = ['DRAFT', 'SUBMITTED', 'UNDER_INVESTIGATION', 'CORRECTIVE_ACTION_PENDING', 'VERIFIED', 'CLOSED'];
    const endIndex = path.indexOf(status);
    let cursor = withRef.reportedAt;
    for (let step = 1; step <= endIndex; step += 1) {
      cursor = addDays(cursor, intBetween(1, 9));
      if (cursor > new Date()) break;
      await prisma.auditLog.create({
        data: {
          userId: step <= 1 ? reporter.id : pick([...leads, ...auditors]).id,
          action: 'INCIDENT_STATE_CHANGED',
          entityType: 'INCIDENT',
          entityId: incident.id,
          previousState: path[step - 1],
          newState: path[step],
          detail: { seeded: true },
          timestamp: cursor,
        },
      });
    }
  }

  // ------------------------ Corrective actions ----------------------------

  console.log('Creating corrective actions…');

  const actionDescriptions = [
    'Re-brief all excavation contractors on the permit-to-dig procedure and record attendance.',
    'Install additional route markers at 50 m intervals along the affected section.',
    'Replace the degraded wrap coating on the adjacent 20 m of service line.',
    'Schedule a close-interval potential survey for the affected pipeline segment.',
    'Overhaul the regulator run and replace the monitor diaphragm.',
    'Fit vehicle-impact protection bollards around exposed risers in customer yards.',
    'Reinstate cover depth and install erosion matting over the exposed stretch.',
    'Update the valve line-up checklist to require independent second verification.',
    'Re-radiograph all tie-in welds completed by the same crew in this campaign.',
    'Recalibrate the odorant injection pump and add a weekly verification step.',
    'Issue a safety alert on hot-work permit requirements to all subcontractors.',
    'Repair the compound gate latch and add the gate to the daily security round.',
    'Replenish flame-retardant PPE stock and re-issue to the purge crew.',
    'Add the affected asset to the quarterly integrity inspection schedule.',
  ];

  // Only incidents that have progressed past investigation carry actions.
  const actionParents = createdIncidents.filter((incident) =>
    ['CORRECTIVE_ACTION_PENDING', 'VERIFIED', 'CLOSED'].includes(incident.status),
  );

  let actionCount = 0;
  for (const incident of actionParents) {
    const howMany = intBetween(1, 2);
    for (let n = 0; n < howMany; n += 1) {
      const raisedAt = addDays(incident.reportedAt, intBetween(2, 12));
      if (raisedAt > new Date()) continue;

      const dueDate = addDays(raisedAt, intBetween(14, 60));
      const assignee = pick(users.filter((u) => u.role !== 'SYSTEM_ADMIN'));
      const verifier = pick([...leads, ...auditors].filter((u) => u.id !== assignee.id));

      // A closed incident cannot have unverified actions — the API enforces
      // exactly this rule on the VERIFIED/CLOSED transition.
      const parentClosed = incident.status === 'CLOSED' || incident.status === 'VERIFIED';
      const status = parentClosed
        ? 'VERIFIED'
        : pickWeighted([
            ['OPEN', 4],
            ['IN_PROGRESS', 4],
            ['COMPLETED', 2],
            ['OVERDUE', 2],
          ] as const);

      const completedDate =
        status === 'COMPLETED' || status === 'VERIFIED'
          ? addDays(raisedAt, intBetween(5, 45))
          : null;
      const verifiedAt = status === 'VERIFIED' && completedDate
        ? addDays(completedDate, intBetween(1, 10))
        : null;

      const action = await prisma.correctiveAction.create({
        data: {
          referenceNumber: `CA-TMP-${actionCount}`,
          description: pick(actionDescriptions),
          source: 'INCIDENT',
          incidentId: incident.id,
          assignedToId: assignee.id,
          raisedAt,
          dueDate,
          status,
          completedDate,
          verifiedById: status === 'VERIFIED' ? verifier.id : null,
          verifiedAt,
        },
      });

      await prisma.correctiveAction.update({
        where: { id: action.id },
        data: {
          referenceNumber: `CA-${raisedAt.getFullYear()}-${String(action.id).padStart(4, '0')}`,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: pick(leads).id,
          action: 'CORRECTIVE_ACTION_CREATED',
          entityType: 'CORRECTIVE_ACTION',
          entityId: action.id,
          newState: 'OPEN',
          detail: { source: 'INCIDENT', incidentId: incident.id, seeded: true },
          timestamp: raisedAt,
        },
      });

      if (verifiedAt) {
        await prisma.auditLog.create({
          data: {
            userId: verifier.id,
            action: 'CORRECTIVE_ACTION_STATE_CHANGED',
            entityType: 'CORRECTIVE_ACTION',
            entityId: action.id,
            previousState: 'COMPLETED',
            newState: 'VERIFIED',
            detail: { seeded: true },
            timestamp: verifiedAt,
          },
        });
      }

      actionCount += 1;
    }
  }

  // ----------------------------- Audits -----------------------------------

  console.log('Creating audits…');

  const complianceWeights = [
    ['COMPLIANT', 68],
    ['OBSERVATION', 14],
    ['NON_COMPLIANT', 12],
    ['NOT_APPLICABLE', 6],
  ] as const;

  let auditCount = 0;
  for (let i = 0; i < 14; i += 1) {
    const template = pick(templates);
    const zone = pick(fieldZones);
    const conductor = pick([...auditors, ...leads]);
    const scheduledDate = daysAgo(intBetween(2, 300));
    const status = pickWeighted([
      ['COMPLETED', 8],
      ['IN_PROGRESS', 3],
      ['PLANNED', 3],
      ['CANCELLED', 1],
    ] as const);

    const audit = await prisma.audit.create({
      data: {
        referenceNumber: `AUD-TMP-${i}`,
        templateId: template.id,
        zoneId: zone.id,
        conductedById: conductor.id,
        scheduledDate,
        conductedDate: status === 'COMPLETED' ? addDays(scheduledDate, intBetween(0, 3)) : null,
        status,
      },
    });

    await prisma.audit.update({
      where: { id: audit.id },
      data: {
        referenceNumber: `AUD-${scheduledDate.getFullYear()}-${String(audit.id).padStart(4, '0')}`,
      },
    });

    // A COMPLETED audit must have every item answered — the same rule the API
    // enforces on the transition. IN_PROGRESS gets a partial set.
    const itemsToAnswer =
      status === 'COMPLETED'
        ? template.items
        : status === 'IN_PROGRESS'
          ? template.items.slice(0, Math.max(1, Math.floor(template.items.length / 2)))
          : [];

    for (const item of itemsToAnswer) {
      const complianceStatus = pickWeighted(complianceWeights);
      const response = await prisma.auditResponse.create({
        data: {
          auditId: audit.id,
          checklistItemId: item.id,
          complianceStatus,
          notes:
            complianceStatus === 'NON_COMPLIANT'
              ? 'Finding raised during inspection; corrective action required.'
              : null,
        },
      });

      // Non-conformities generate audit-sourced corrective actions — the
      // polymorphic branch of CorrectiveAction.
      if (complianceStatus === 'NON_COMPLIANT') {
        const raisedAt = audit.conductedDate ?? scheduledDate;
        const assignee = pick(users.filter((u) => u.role !== 'SYSTEM_ADMIN'));
        const caStatus = pickWeighted([
          ['VERIFIED', 4],
          ['IN_PROGRESS', 3],
          ['OPEN', 2],
          ['OVERDUE', 2],
        ] as const);
        const completedDate =
          caStatus === 'VERIFIED' ? addDays(raisedAt, intBetween(4, 40)) : null;

        const action = await prisma.correctiveAction.create({
          data: {
            referenceNumber: `CA-TMP-A-${actionCount}`,
            description: `Address non-conformity: ${item.itemText}`,
            source: 'AUDIT_RESPONSE',
            auditResponseId: response.id,
            assignedToId: assignee.id,
            raisedAt,
            dueDate: addDays(raisedAt, intBetween(14, 45)),
            status: caStatus,
            completedDate,
            verifiedById: caStatus === 'VERIFIED' ? conductor.id : null,
            verifiedAt: completedDate ? addDays(completedDate, intBetween(1, 8)) : null,
          },
        });

        await prisma.correctiveAction.update({
          where: { id: action.id },
          data: {
            referenceNumber: `CA-${raisedAt.getFullYear()}-${String(action.id).padStart(4, '0')}`,
          },
        });
        actionCount += 1;
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: conductor.id,
        action: 'AUDIT_CREATED',
        entityType: 'AUDIT',
        entityId: audit.id,
        newState: 'PLANNED',
        detail: { template: template.name, seeded: true },
        timestamp: scheduledDate,
      },
    });
    auditCount += 1;
  }

  // ------------------------ Operational hours -----------------------------

  // The NMFR denominator (§11). Roughly 180 operational staff at ~168 h/month.
  console.log('Creating operational hours…');
  for (let monthsBack = 11; monthsBack >= 0; monthsBack -= 1) {
    const start = new Date();
    start.setMonth(start.getMonth() - monthsBack, 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);

    await prisma.operationalHours.create({
      data: {
        periodStart: start,
        periodEnd: end,
        personHours: new Prisma.Decimal(Math.round(between(28_000, 32_000))),
      },
    });
  }

  // ------------------------------ Summary ---------------------------------

  const [incidentTotal, nearMissTotal, actionTotal, verifiedTotal, auditTotal, logTotal] =
    await Promise.all([
      prisma.incident.count(),
      prisma.incident.count({ where: { type: 'NEAR_MISS' } }),
      prisma.correctiveAction.count(),
      prisma.correctiveAction.count({ where: { status: 'VERIFIED' } }),
      prisma.audit.count(),
      prisma.auditLog.count(),
    ]);

  console.log('\nSeed complete.');
  console.table({
    zones: zones.length,
    users: users.length,
    templates: templates.length,
    incidents: incidentTotal,
    'of which near-misses': nearMissTotal,
    audits: auditTotal,
    'corrective actions': actionTotal,
    'of which verified': verifiedTotal,
    'audit-log entries': logTotal,
  });

  console.log(`\nAll demo accounts use the password: ${DEMO_PASSWORD}`);
  for (const user of users) {
    console.log(`  ${user.email.padEnd(30)} ${user.role}`);
  }
  console.log(`\nAdmin sign-in: ${admin.email}`);
  console.log(
    '\nNext: run `npm run score` to put a predicted risk band on these incidents.\n' +
      '(It needs the FastAPI service on :8000. `npm run seed:full` does both in one go.)',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
