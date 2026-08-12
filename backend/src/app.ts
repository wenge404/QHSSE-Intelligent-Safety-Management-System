import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/env';
import { errorHandler, notFound } from './middleware/error.middleware';
import { adminRouter } from './routes/admin.routes';
import { auditsRouter } from './routes/audit.routes';
import { authRouter } from './routes/auth.routes';
import { correctiveActionsRouter } from './routes/correctiveAction.routes';
import { incidentsRouter } from './routes/incident.routes';
import { kpiRouter } from './routes/kpi.routes';
import { metaRouter } from './routes/meta.routes';
import { predictRouter } from './routes/predict.routes';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  if (!config.isProduction) app.use(morgan('dev'));

  app.get('/', (_req, res) => {
    res.json({ service: 'IQSMS API', version: '1.0.0', health: '/health' });
  });

  // Matches the scaffold's liveness contract in addition to
  // /api/v1/meta/health, which also reports the ML service.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'iqsms-backend' });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/meta', metaRouter);
  app.use('/api/v1/incidents', incidentsRouter);
  app.use('/api/v1/audits', auditsRouter);
  app.use('/api/v1/corrective-actions', correctiveActionsRouter);
  app.use('/api/v1/kpis', kpiRouter);
  app.use('/api/v1/predict', predictRouter);
  app.use('/api/v1/admin', adminRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
