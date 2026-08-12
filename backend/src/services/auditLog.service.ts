import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { Tx } from '../config/prisma';

/**
 * Proposal §9.4 — insert-only audit trail.
 *
 * Every state mutation across the platform is appended here. There is
 * deliberately no update or delete helper in this module and no route that
 * exposes one; the table is immutable at the application layer.
 */

export interface AuditLogEntry {
  userId: number | null;
  action: string;
  entityType: 'INCIDENT' | 'AUDIT' | 'CORRECTIVE_ACTION' | 'USER' | 'CHECKLIST_TEMPLATE' | 'AUTH';
  entityId: number;
  previousState?: string | null;
  newState?: string | null;
  detail?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

export async function appendAuditLog(tx: Tx, entry: AuditLogEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      previousState: entry.previousState ?? null,
      newState: entry.newState ?? null,
      detail: entry.detail,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}

export function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? null;
}

/**
 * Shallow diff used as the `detail` payload on update actions, so the trail
 * records what actually changed rather than a full row snapshot.
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Prisma.InputJsonValue {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const from = before[key];
    const to = after[key];
    if (to === undefined) continue;
    const same =
      from instanceof Date && to instanceof Date
        ? from.getTime() === to.getTime()
        : String(from) === String(to);
    if (!same) diff[key] = { from: serialise(from), to: serialise(to) };
  }
  return diff as Prisma.InputJsonValue;
}

function serialise(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return String(value);
  return value as string | number | boolean;
}
