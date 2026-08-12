import { RiskLevel } from '@prisma/client';
import { config } from '../config/env';

/**
 * Thin client for the FastAPI predictive service (proposal §9.1, §8.2).
 *
 * The Express API calls this during incident data entry. A prediction failure
 * must never block a safety report from being filed, so every caller treats
 * the result as optional and the service is given a short timeout.
 */

export interface PredictRequest {
  causeCategory?: string | null;
  systemPart?: string | null;
  locationType?: string | null;
  linePressurePsig?: number | null;
  pipeDiameterInches?: number | null;
  ignitionOccurred?: boolean | null;
  explosionOccurred?: boolean | null;
  pipeMaterial?: string | null;
  releaseType?: string | null;
  incidentAreaType?: string | null;
  pipeAgeYears?: number | null;
  featureSet?: 'A' | 'B';
}

export interface PredictResponse {
  probability: number;
  riskLevel: RiskLevel;
  model: string;
  featureSet: 'A' | 'B';
  threshold: number;
  predictedSignificant: boolean;
  baseRate: number;
}

const TIMEOUT_MS = 4000;

/**
 * Probability bands for the four-level RiskLevel enum.
 *
 * These are set relative to the 0.68 base rate of the training data, not to an
 * abstract 0.25/0.5/0.75 grid: below the base rate the model is saying "less
 * likely than a typical incident to be significant", which is the honest
 * meaning of LOW here.
 */
export function toRiskLevel(probability: number): RiskLevel {
  if (probability < 0.5) return 'LOW';
  if (probability < 0.68) return 'MEDIUM';
  if (probability < 0.85) return 'HIGH';
  return 'CRITICAL';
}

export class MlServiceUnavailable extends Error {
  readonly status = 503;
  constructor(cause: string) {
    super(`Predictive service unavailable: ${cause}`);
    this.name = 'MlServiceUnavailable';
  }
}

export async function predictRisk(payload: PredictRequest): Promise<PredictResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${config.mlServiceUrl}/api/v1/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new MlServiceUnavailable(`HTTP ${response.status} ${body.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      probability: number;
      model: string;
      feature_set: 'A' | 'B';
      threshold: number;
      predicted_significant: boolean;
      base_rate: number;
    };

    return {
      probability: data.probability,
      riskLevel: toRiskLevel(data.probability),
      model: data.model,
      featureSet: data.feature_set,
      threshold: data.threshold,
      predictedSignificant: data.predicted_significant,
      baseRate: data.base_rate,
    };
  } catch (error) {
    if (error instanceof MlServiceUnavailable) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new MlServiceUnavailable(reason === 'The operation was aborted.' ? 'timed out' : reason);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The full cross-validated model comparison, proxied through Express so the
 * browser talks to exactly one origin and the FastAPI service does not need
 * its own CORS configuration.
 */
export async function modelReport(): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${config.mlServiceUrl}/api/v1/models`, { signal: controller.signal });
    if (!response.ok) throw new MlServiceUnavailable(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof MlServiceUnavailable) throw error;
    throw new MlServiceUnavailable(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

export async function mlServiceHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${config.mlServiceUrl}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    const body = (await response.json()) as { model?: string };
    return { ok: true, detail: body.model ?? 'loaded' };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
