import { Router } from 'express';
import * as controller from '../controllers/predict.controller';
import { authenticate } from '../middleware/auth.middleware';

export const predictRouter = Router();
predictRouter.use(authenticate);

predictRouter.get('/models', controller.models);
predictRouter.post('/', controller.predict);
