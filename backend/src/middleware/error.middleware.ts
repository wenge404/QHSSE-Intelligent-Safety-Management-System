import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { TransitionError, TransitionForbiddenError } from '../domain/stateMachine';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Route not found.' });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed.',
      details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  if (error instanceof TransitionError || error instanceof TransitionForbiddenError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  // Guards raised by the database triggers and CHECK constraints added in
  // migration 20260812160000_state_transition_guards. The API validates the
  // same rules first, so reaching here means something bypassed that path —
  // report it faithfully rather than as a generic 500.
  const dbGuard = translateDatabaseGuard(error);
  if (dbGuard) {
    res.status(dbGuard.status).json({ error: dbGuard.message, source: 'database-constraint' });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      res.status(409).json({ error: `A record with this ${target} already exists.` });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }
    if (error.code === 'P2003') {
      res.status(400).json({ error: 'Referenced record does not exist.' });
      return;
    }
  }

  // eslint-disable-next-line no-console
  console.error('[unhandled]', error);
  res.status(500).json({ error: 'Internal server error.' });
}

/**
 * Recognises the database-level guards.
 *
 * Prisma surfaces a trigger's RAISE EXCEPTION as an unknown request error with
 * the Postgres message embedded, so the marker prefixes written into the
 * migration are what make it identifiable. Matching on message text is
 * unattractive but it is the only handle Prisma exposes for a plpgsql raise;
 * the markers exist precisely so the match is on something deliberate rather
 * than on incidental wording.
 */
function translateDatabaseGuard(error: unknown): { status: number; message: string } | null {
  const raw = error instanceof Error ? error.message : '';
  if (!raw) return null;

  const transition = raw.match(/IQSMS_TRANSITION:\s*([^\n]+)/);
  if (transition) {
    return { status: 409, message: transition[1].trim() };
  }

  const immutable = raw.match(/IQSMS_IMMUTABLE:\s*([^\n]+)/);
  if (immutable) {
    return { status: 403, message: immutable[1].trim() };
  }

  if (raw.includes('corrective_actions_exactly_one_parent')) {
    return {
      status: 400,
      message:
        'A corrective action must have exactly one parent, matching its source: ' +
        'incidentId for INCIDENT, auditResponseId for AUDIT_RESPONSE.',
    };
  }

  if (raw.includes('incidents_non_negative_consequences')) {
    return { status: 400, message: 'Fatality, injury and evacuation counts cannot be negative.' };
  }

  return null;
}

/** Wraps an async route so rejected promises reach the error handler. */
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
