"""IQSMS predictive risk classification microservice.

Serves the models trained by train.py. Called by the Express API during
incident data entry (proposal 9.1). Run with:

    uvicorn app:app --port 8000

The serialised artefact contains the fitted preprocessor *and* the estimator in
one Pipeline object. Refitting the preprocessor on request data at inference
time is a classic source of silent prediction skew, so nothing here re-fits
anything - it only calls predict_proba.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .features import FEATURE_SETS, to_model_row

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
REPORT_PATH = Path(__file__).resolve().parent.parent / "reports" / "model_comparison.json"

MODELS: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    for set_name in FEATURE_SETS:
        path = MODEL_DIR / f"risk_classifier_set_{set_name}.joblib"
        if path.exists():
            MODELS[set_name] = joblib.load(path)
            print(f"Loaded set {set_name}: {MODELS[set_name]['model']} "
                  f"(PRC-AUC {MODELS[set_name]['prc_auc']:.3f})")
        else:
            print(f"WARNING: {path.name} not found - run `python train.py` first.")
    yield
    MODELS.clear()


app = FastAPI(
    title="IQSMS Predictive Risk Service",
    version="1.0.0",
    description=(
        "Severity triage for gas distribution incidents, trained on the PHMSA "
        "gas distribution flagged file (2010-present) against PHMSA's own "
        "SIGNIFICANT incident classification."
    ),
    lifespan=lifespan,
)


class PredictRequest(BaseModel):
    causeCategory: str | None = None
    systemPart: str | None = None
    locationType: str | None = None
    linePressurePsig: float | None = None
    pipeDiameterInches: float | None = None
    ignitionOccurred: bool | None = None
    explosionOccurred: bool | None = None
    pipeMaterial: str | None = None
    releaseType: str | None = None
    incidentAreaType: str | None = None
    pipeAgeYears: float | None = None
    featureSet: Literal["A", "B"] = Field(
        default="B",
        description=(
            "B (default) is the served triage model. A is the circumstances-only "
            "baseline, reported in the evaluation as a null result."
        ),
    )


class PredictResponse(BaseModel):
    probability: float
    predicted_significant: bool
    threshold: float
    model: str
    feature_set: str
    claim: str
    base_rate: float
    #: Fields the caller left blank. Surfaced so the UI can say "scored on 6 of
    #: 11 inputs" rather than presenting a thin prediction as a confident one.
    missing_inputs: list[str]


@app.get("/health")
def health() -> dict:
    if not MODELS:
        raise HTTPException(status_code=503, detail="No models loaded. Run train.py.")
    return {
        "status": "ok",
        "model": ", ".join(f"set {k}: {v['model']}" for k, v in MODELS.items()),
        "sets_loaded": sorted(MODELS),
    }


@app.get("/api/v1/models")
def models() -> dict:
    """The full cross-validated comparison, for the documentation page."""
    if not REPORT_PATH.exists():
        raise HTTPException(status_code=404, detail="No model report. Run train.py.")
    return json.loads(REPORT_PATH.read_text())


@app.post("/api/v1/predict", response_model=PredictResponse)
def predict(request: PredictRequest) -> PredictResponse:
    artefact = MODELS.get(request.featureSet)
    if artefact is None:
        raise HTTPException(
            status_code=503,
            detail=f"Model for feature set {request.featureSet} is not loaded.",
        )

    payload = request.model_dump()
    row = to_model_row(payload)

    categorical = artefact["features"]["categorical"]
    numeric = artefact["features"]["numeric"]
    frame = pd.DataFrame([{col: row.get(col) for col in categorical + numeric}])

    # Numerics are imputed inside the pipeline; categoricals arrive as MISSING,
    # a category the encoder was fitted on. Neither path needs special-casing
    # here, but the caller is told which inputs were blank.
    missing = [col for col in categorical if row.get(col) == "MISSING"]
    missing += [col for col in numeric if row.get(col) is None]

    probability = float(artefact["pipeline"].predict_proba(frame)[0, 1])
    threshold = float(artefact["threshold"])

    return PredictResponse(
        probability=probability,
        predicted_significant=probability >= threshold,
        threshold=threshold,
        model=artefact["model"],
        feature_set=artefact["feature_set"],
        claim=artefact["claim"],
        base_rate=float(artefact["base_rate"]),
        missing_inputs=missing,
    )
