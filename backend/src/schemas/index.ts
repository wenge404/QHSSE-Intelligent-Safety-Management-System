import {
  AuditStatus,
  CauseCategory,
  ComplianceStatus,
  CorrectiveActionSource,
  CorrectiveActionStatus,
  IncidentAreaType,
  IncidentStatus,
  IncidentType,
  LocationType,
  PipeMaterial,
  ReleaseType,
  RiskLevel,
  Role,
  SystemPart,
  ZoneType,
} from '@prisma/client';
import { z } from 'zod';

const dateish = z.coerce.date();
const optionalDate = z.coerce.date().nullish();

// ------------------------------- Auth --------------------------------------

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required.'),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  fullName: z.string().min(2),
  role: z.nativeEnum(Role),
  department: z.string().min(1).nullish(),
  zoneId: z.number().int().positive().nullish(),
});

export const updateUserSchema = createUserSchema
  .partial()
  .omit({ password: true })
  .extend({ isActive: z.boolean().optional() });

// ----------------------------- Incidents -----------------------------------

/**
 * Set A + set B model inputs are captured on the incident form itself, so a
 * logged incident can be scored without a second data-entry step. Consequence
 * fields (fatalities, injuries, cost) are captured too but are never sent to
 * the model — they are the fields the SIGNIFICANT label is derived from
 * (proposal §8.2, leakage control).
 */
export const createIncidentSchema = z.object({
  type: z.nativeEnum(IncidentType).default('INCIDENT'),
  title: z.string().min(4).max(200),
  description: z.string().min(10),
  occurredAt: dateish,
  zoneId: z.number().int().positive().nullish(),

  causeCategory: z.nativeEnum(CauseCategory).nullish(),
  causeDescription: z.string().nullish(),

  // Set A — circumstances
  systemPart: z.nativeEnum(SystemPart).nullish(),
  locationType: z.nativeEnum(LocationType).nullish(),
  linePressurePsig: z.coerce.number().min(0).max(5000).nullish(),
  pipeDiameterInches: z.coerce.number().min(0).max(120).nullish(),

  // Set B — incident characteristics
  ignitionOccurred: z.boolean().nullish(),
  explosionOccurred: z.boolean().nullish(),
  pipeMaterial: z.nativeEnum(PipeMaterial).nullish(),
  releaseType: z.nativeEnum(ReleaseType).nullish(),
  incidentAreaType: z.nativeEnum(IncidentAreaType).nullish(),
  yearInstalled: z.coerce.number().int().min(1900).max(2100).nullish(),

  // Consequences
  severity: z.nativeEnum(RiskLevel).default('LOW'),
  fatalities: z.coerce.number().int().min(0).default(0),
  injuries: z.coerce.number().int().min(0).default(0),
  propertyDamageCost: z.coerce.number().min(0).nullish(),
  gasVolumeReleasedMcf: z.coerce.number().min(0).nullish(),
  evacuationCount: z.coerce.number().int().min(0).default(0),

  assetType: z.string().nullish(),
  scadaPresent: z.boolean().nullish(),
  scadaOperational: z.boolean().nullish(),
});

export const updateIncidentSchema = createIncidentSchema.partial();

export const transitionIncidentSchema = z.object({
  status: z.nativeEnum(IncidentStatus),
  note: z.string().max(1000).optional(),
});

export const incidentQuerySchema = z.object({
  status: z.nativeEnum(IncidentStatus).optional(),
  type: z.nativeEnum(IncidentType).optional(),
  causeCategory: z.nativeEnum(CauseCategory).optional(),
  zoneId: z.coerce.number().int().positive().optional(),
  from: optionalDate,
  to: optionalDate,
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ------------------------------- Zones -------------------------------------

export const createZoneSchema = z.object({
  name: z.string().min(2),
  zoneType: z.nativeEnum(ZoneType),
  department: z.string().min(1).nullish(),
  notes: z.string().nullish(),
});

// ------------------------------ Audits -------------------------------------

export const createTemplateSchema = z.object({
  name: z.string().min(3),
  description: z.string().nullish(),
  category: z.string().nullish(),
  isoClause: z.string().nullish(),
  items: z
    .array(
      z.object({
        itemText: z.string().min(3),
        category: z.string().nullish(),
        orderIndex: z.number().int().min(0).optional(),
      }),
    )
    .min(1, 'A checklist template needs at least one item.'),
});

export const createAuditSchema = z.object({
  templateId: z.number().int().positive(),
  zoneId: z.number().int().positive().nullish(),
  scheduledDate: dateish,
  conductedById: z.number().int().positive().optional(),
});

export const transitionAuditSchema = z.object({
  status: z.nativeEnum(AuditStatus),
  note: z.string().max(1000).optional(),
});

export const submitResponsesSchema = z.object({
  responses: z
    .array(
      z.object({
        checklistItemId: z.number().int().positive(),
        complianceStatus: z.nativeEnum(ComplianceStatus),
        notes: z.string().nullish(),
      }),
    )
    .min(1),
});

// ------------------------- Corrective actions ------------------------------

/**
 * The polymorphic parent is validated here rather than in the database:
 * exactly one of incidentId / auditResponseId must be present, and it must
 * agree with the declared source. See schema.prisma design note 2.
 */
export const createCorrectiveActionSchema = z
  .object({
    description: z.string().min(5),
    source: z.nativeEnum(CorrectiveActionSource),
    incidentId: z.number().int().positive().nullish(),
    auditResponseId: z.number().int().positive().nullish(),
    assignedToId: z.number().int().positive(),
    dueDate: dateish,
  })
  .superRefine((value, ctx) => {
    const hasIncident = value.incidentId != null;
    const hasResponse = value.auditResponseId != null;
    if (hasIncident === hasResponse) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of incidentId or auditResponseId.',
        path: ['incidentId'],
      });
      return;
    }
    if (value.source === 'INCIDENT' && !hasIncident) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'source=INCIDENT requires incidentId.',
        path: ['incidentId'],
      });
    }
    if (value.source === 'AUDIT_RESPONSE' && !hasResponse) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'source=AUDIT_RESPONSE requires auditResponseId.',
        path: ['auditResponseId'],
      });
    }
  });

export const transitionCorrectiveActionSchema = z.object({
  status: z.nativeEnum(CorrectiveActionStatus),
  note: z.string().max(1000).optional(),
});

// ------------------------------- KPIs --------------------------------------

export const kpiQuerySchema = z.object({
  from: optionalDate,
  to: optionalDate,
  zoneId: z.coerce.number().int().positive().optional(),
});

export const operationalHoursSchema = z.object({
  periodStart: dateish,
  periodEnd: dateish,
  personHours: z.coerce.number().positive(),
  zoneId: z.number().int().positive().nullish(),
});

// ----------------------------- Prediction ----------------------------------

/**
 * Mirrors the FastAPI request body. Every field is optional because the model
 * pipeline imputes missing numerics and treats unseen categories as MISSING —
 * scoring a half-filled draft is a legitimate use.
 */
export const predictSchema = z.object({
  causeCategory: z.nativeEnum(CauseCategory).nullish(),
  systemPart: z.nativeEnum(SystemPart).nullish(),
  locationType: z.nativeEnum(LocationType).nullish(),
  linePressurePsig: z.coerce.number().nullish(),
  pipeDiameterInches: z.coerce.number().nullish(),
  ignitionOccurred: z.boolean().nullish(),
  explosionOccurred: z.boolean().nullish(),
  pipeMaterial: z.nativeEnum(PipeMaterial).nullish(),
  releaseType: z.nativeEnum(ReleaseType).nullish(),
  incidentAreaType: z.nativeEnum(IncidentAreaType).nullish(),
  pipeAgeYears: z.coerce.number().nullish(),
  featureSet: z.enum(['A', 'B']).default('B'),
});

export const auditLogQuerySchema = z.object({
  entityType: z.string().max(40).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
