import { Router } from 'express';
import * as controller from '../controllers/audit.controller';
import { authenticate } from '../middleware/auth.middleware';

export const auditsRouter = Router();
auditsRouter.use(authenticate);

auditsRouter.get('/', controller.list);
auditsRouter.post('/', controller.create);
auditsRouter.get('/:id', controller.detail);
auditsRouter.post('/:id/responses', controller.submitResponses);
auditsRouter.post('/:id/transition', controller.transition);
