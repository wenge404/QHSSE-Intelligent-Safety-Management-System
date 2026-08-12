import { Router } from 'express';
import * as controller from '../controllers/incident.controller';
import { authenticate } from '../middleware/auth.middleware';

export const incidentsRouter = Router();
incidentsRouter.use(authenticate);

incidentsRouter.get('/', controller.list);
incidentsRouter.post('/', controller.create);
incidentsRouter.get('/:id', controller.detail);
incidentsRouter.patch('/:id', controller.update);
incidentsRouter.post('/:id/transition', controller.transition);
incidentsRouter.post('/:id/score', controller.score);
