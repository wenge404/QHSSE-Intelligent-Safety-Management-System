import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { config } from '../config/env';
import { prisma } from '../config/prisma';
import type { Principal } from '../domain/rbac';
import { ApiError } from './error.middleware';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: Principal & { email: string; fullName: string; zoneName: string | null };
    }
  }
}

export interface TokenPayload {
  sub: number;
  role: Role;
}

export function signToken(userId: number, role: Role): string {
  return jwt.sign({ sub: userId, role } satisfies TokenPayload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

/**
 * The role and scope keys are re-read from the database on every request
 * rather than trusted from the token body. A token issued before a
 * demotion would otherwise keep its old privileges until expiry.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new ApiError(401, 'Missing bearer token.');
    }

    let payload: TokenPayload;
    try {
      // jwt.verify is typed as string | JwtPayload; the double assertion is the
      // documented way to narrow it to our own claim shape.
      payload = jwt.verify(header.slice(7), config.jwtSecret) as unknown as TokenPayload;
    } catch {
      throw new ApiError(401, 'Invalid or expired token.');
    }

    const user = await prisma.user.findUnique({
      where: { id: Number(payload.sub) },
      include: { zone: { select: { name: true } } },
    });

    if (!user || !user.isActive) {
      throw new ApiError(401, 'Account not found or deactivated.');
    }

    req.user = {
      id: user.id,
      role: user.role,
      department: user.department,
      zoneId: user.zoneId,
      email: user.email,
      fullName: user.fullName,
      zoneName: user.zone?.name ?? null,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new ApiError(401, 'Not authenticated.'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, `Requires one of: ${roles.join(', ')}.`));
    }
    next();
  };
}

export function currentUser(req: Request): Principal & { email: string; fullName: string } {
  if (!req.user) throw new ApiError(401, 'Not authenticated.');
  return req.user;
}
