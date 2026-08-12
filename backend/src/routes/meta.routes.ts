import { Router } from 'express';
import * as controller from '../controllers/meta.controller';
import { authenticate } from '../middleware/auth.middleware';

export const metaRouter = Router();

metaRouter.get('/enums', authenticate, controller.enums);
metaRouter.get('/workflow', authenticate, controller.workflow);

// Unauthenticated on purpose: a liveness probe that needs a token cannot tell
// you the service is up when authentication itself is what is broken.
metaRouter.get('/health', controller.health);
