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
import type { Request, Response } from 'express';
import { workflowDescriptor } from '../domain/stateMachine';
import { asyncHandler } from '../middleware/error.middleware';
import { mlServiceHealth } from '../services/mlClient.service';

/**
 * The frontend builds its dropdowns from this endpoint rather than hard-coding
 * option lists, so the enum vocabulary has exactly one source of truth: the
 * Prisma schema. Adding a cause category is then a one-file change.
 */
export const enums = (_req: Request, res: Response) => {
  res.json({
    Role,
    ZoneType,
    IncidentType,
    IncidentStatus,
    CauseCategory,
    RiskLevel,
    AuditStatus,
    ComplianceStatus,
    CorrectiveActionSource,
    CorrectiveActionStatus,
    LocationType,
    SystemPart,
    ReleaseType,
    IncidentAreaType,
    PipeMaterial,
  });
};

export const workflow = (_req: Request, res: Response) => {
  res.json(workflowDescriptor);
};

export const health = asyncHandler(async (_req, res) => {
    const ml = await mlServiceHealth();
    res.json({ api: 'ok', mlService: ml });
  });
