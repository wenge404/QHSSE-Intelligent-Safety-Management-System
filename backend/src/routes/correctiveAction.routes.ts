import { Router } from 'express';
import * as controller from '../controllers/correctiveAction.controller';
import { authenticate } from '../middleware/auth.middleware';

export const correctiveActionsRouter = Router();
correctiveActionsRouter.use(authenticate);

correctiveActionsRouter.get('/', controller.list);
correctiveActionsRouter.post('/', controller.create);

// Registered before '/:id/transition' so the literal segment is matched first.
correctiveActionsRouter.post('/refresh-overdue', controller.refreshOverdue);
correctiveActionsRouter.post('/:id/transition', controller.transition);
