import { asyncHandler } from '../middleware/error.middleware';
import { predictSchema } from '../schemas';
import { modelReport, predictRisk } from '../services/mlClient.service';

/** The cross-validated comparison behind the served model, for the docs page. */
export const models = asyncHandler(async (_req, res) => {
    res.json(await modelReport());
  });

/**
 * POST /api/v1/predict — the endpoint named in proposal §9.1.
 *
 * Ad-hoc scoring with no persistence: the incident form calls this as the user
 * types, before anything is saved. Persisted scoring happens through
 * POST /api/v1/incidents/:id/score.
 *
 * `featureSet` selects between the two models trained in Phase 4:
 *   A — cause, component, location, pressure, diameter. Reported in the
 *       evaluation as a null result (accuracy at the majority baseline) and
 *       served only as the documented baseline.
 *   B — A plus ignition, explosion, material, release type, area, pipe age.
 *       The default, and the one the UI uses.
 */
export const predict = asyncHandler(async (req, res) => {
    const body = predictSchema.parse(req.body);
    const prediction = await predictRisk(body);
    res.json(prediction);
  });
