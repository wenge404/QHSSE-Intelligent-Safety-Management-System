import { Router } from 'express';
import * as controller from '../controllers/admin.controller';
import { authenticate, requireRole } from '../middleware/auth.middleware';

export const adminRouter = Router();
adminRouter.use(authenticate);

/** User and checklist-template management is System Admin only (proposal §9.3). */
const adminOnly = requireRole('SYSTEM_ADMIN');

// Any authenticated user may read the directory — assigning a corrective
// action requires picking an assignee.
adminRouter.get('/users', controller.listUsers);
adminRouter.post('/users', adminOnly, controller.createUser);
adminRouter.patch('/users/:id', adminOnly, controller.updateUser);

adminRouter.get('/zones', controller.listZones);
adminRouter.post('/zones', adminOnly, controller.createZone);

adminRouter.get('/templates', controller.listTemplates);
adminRouter.post('/templates', adminOnly, controller.createTemplate);

adminRouter.get('/operational-hours', controller.listOperationalHours);
adminRouter.post(
  '/operational-hours',
  requireRole('SYSTEM_ADMIN', 'DEPARTMENT_LEAD'),
  controller.createOperationalHours,
);

/**
 * The only audit-log route. No POST, PATCH, PUT or DELETE exists — that
 * absence is what makes the table insert-only at the application layer
 * (proposal §9.4), and the database trigger added in migration
 * `20260812_state_transition_guards` enforces the same rule below it.
 */
adminRouter.get('/audit-log', controller.listAuditLog);
