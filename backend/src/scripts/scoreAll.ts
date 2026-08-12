/**
 * Score every unscored incident through the predictive service.
 *
 *     npm run score            # only incidents with no score yet
 *     npm run score -- --all   # re-score everything (after retraining)
 *
 * Run separately from the seed because it needs the FastAPI service to be up.
 * The seed calls it best-effort at the end; if the service was not running,
 * this script backfills without needing a full re-seed.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { predictRisk } from '../services/mlClient.service';

async function main() {
  const rescoreAll = process.argv.includes('--all');

  const incidents = await prisma.incident.findMany({
    where: rescoreAll ? {} : { predictedRiskScore: null },
    select: {
      id: true,
      referenceNumber: true,
      occurredAt: true,
      causeCategory: true,
      systemPart: true,
      locationType: true,
      linePressurePsig: true,
      pipeDiameterInches: true,
      ignitionOccurred: true,
      explosionOccurred: true,
      pipeMaterial: true,
      releaseType: true,
      incidentAreaType: true,
      yearInstalled: true,
    },
  });

  if (incidents.length === 0) {
    console.log('Nothing to score.');
    return;
  }

  console.log(`Scoring ${incidents.length} incident(s)…`);
  let scored = 0;
  let failed = 0;

  for (const incident of incidents) {
    const age =
      incident.yearInstalled != null
        ? incident.occurredAt.getFullYear() - incident.yearInstalled
        : null;

    try {
      const prediction = await predictRisk({
        causeCategory: incident.causeCategory,
        systemPart: incident.systemPart,
        locationType: incident.locationType,
        linePressurePsig: incident.linePressurePsig?.toNumber() ?? null,
        pipeDiameterInches: incident.pipeDiameterInches?.toNumber() ?? null,
        ignitionOccurred: incident.ignitionOccurred,
        explosionOccurred: incident.explosionOccurred,
        pipeMaterial: incident.pipeMaterial,
        releaseType: incident.releaseType,
        incidentAreaType: incident.incidentAreaType,
        pipeAgeYears: age != null && age >= 0 && age <= 150 ? age : null,
        featureSet: 'B',
      });

      await prisma.incident.update({
        where: { id: incident.id },
        data: {
          predictedRiskLevel: prediction.riskLevel,
          predictedRiskScore: new Prisma.Decimal(prediction.probability.toFixed(4)),
          predictedByModel: `${prediction.model} (set ${prediction.featureSet})`,
          predictedAt: new Date(),
        },
      });
      scored += 1;
    } catch (error) {
      failed += 1;
      if (failed === 1) {
        console.warn(
          `  Could not reach the predictive service: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        console.warn('  Start it with:  cd services/ml && .venv/Scripts/python -m uvicorn app:app --port 8000');
        break;
      }
    }
  }

  const distribution = await prisma.incident.groupBy({
    by: ['predictedRiskLevel'],
    _count: { _all: true },
  });

  console.log(`Scored ${scored}, failed ${failed}.`);
  console.table(
    Object.fromEntries(
      distribution.map((row) => [row.predictedRiskLevel ?? 'UNSCORED', row._count._all]),
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
