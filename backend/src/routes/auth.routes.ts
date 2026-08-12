import { Router } from 'express';
import * as controller from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

export const authRouter = Router();

authRouter.post('/login', controller.login);
authRouter.get('/me', authenticate, controller.me);
