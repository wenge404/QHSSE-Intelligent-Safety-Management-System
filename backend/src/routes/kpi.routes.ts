import { Router } from 'express';
import * as controller from '../controllers/kpi.controller';
import { authenticate } from '../middleware/auth.middleware';

export const kpiRouter = Router();
kpiRouter.use(authenticate);

kpiRouter.get('/', controller.summary);
kpiRouter.get('/corrective-actions', controller.correctiveActionRows);
