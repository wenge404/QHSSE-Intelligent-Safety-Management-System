import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { loginSchema } from '../schemas';
import { currentUser, signToken } from '../middleware/auth.middleware';
import { ApiError, asyncHandler } from '../middleware/error.middleware';
import { appendAuditLog, clientIp } from '../services/auditLog.service';
import { scopeLabel } from '../domain/rbac';

export const login = asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { zone: { select: { name: true } } },
    });

    // Same message and roughly the same work for both failure modes, so the
    // response does not reveal whether an address is registered.
    const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok || !user.isActive) {
      throw new ApiError(401, 'Invalid email or password.');
    }

    await appendAuditLog(prisma, {
      userId: user.id,
      action: 'LOGIN',
      entityType: 'AUTH',
      entityId: user.id,
      ipAddress: clientIp(req),
    });

    res.json({
      token: signToken(user.id, user.role),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        department: user.department,
        zoneId: user.zoneId,
        zoneName: user.zone?.name ?? null,
        scopeLabel: scopeLabel(user, user.zone?.name),
      },
    });
  });

export const me = asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      department: user.department,
      zoneId: user.zoneId,
      zoneName: req.user?.zoneName ?? null,
      scopeLabel: scopeLabel(user, req.user?.zoneName),
    });
  });
