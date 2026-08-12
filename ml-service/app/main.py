"""
IQSMS predictive risk-classification microservice.

Phase 4 deliverable. This file currently exposes the API contract only —
/api/v1/predict returns 503 until a trained model is dropped into models/.
The contract is defined up front so the backend integration (Phase 5) can be
written against a stable shape rather than being blocked on model training.
"""

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(
    title="IQSMS Risk Classification Service",
    description="Predicts incident severity risk for the QHSSE platform.",
    version="0.1.0",
)

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"


class PredictionRequest(BaseModel):
    """
    Mirrors the PHMSA-derived feature mapping in proposal Section 10.2.

    Field names here are provisional — confirm them against the real PHMSA
    columns during Phase 0 data profiling and update both this model and the
    proposal's mapping table together, so they never drift apart.
    """

    system_part_involved: str = Field(..., description="Component type: pipeline, valve, compressor, PRMS")
    cause_category: str = Field(..., description="Primary hazard cause")
    location_type: str = Field(..., description="Environmental location")
    operating_pressure: float = Field(..., description="Line pressure (PSI)")
    pipe_nominal_size: Optional[float] = Field(None, description="Nominal diameter (inches)")


class PredictionResponse(BaseModel):
    risk_level: str
    risk_score: float
    model_name: str


def load_model():
    """Return the trained estimator, or None if none has been saved yet."""
    candidates = sorted(MODEL_DIR.glob("*.joblib"))
    if not candidates:
        return None
    import joblib  # imported lazily so the service starts without scikit-learn present

    return joblib.load(candidates[-1])


@app.get("/health")
def health():
    return {"status": "ok", "service": "iqsms-ml", "model_loaded": load_model() is not None}


@app.post("/api/v1/predict", response_model=PredictionResponse)
def predict(request: PredictionRequest):
    model = load_model()
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="No trained model available. Complete Phase 4 training and save a .joblib file to models/.",
        )

    # Phase 4: apply the same encoding/scaling pipeline used at training time.
    # Persist the fitted preprocessor alongside the estimator so the transform
    # applied here is identical to training — refitting it on request data is
    # the classic source of silent prediction skew.
    raise HTTPException(status_code=501, detail="Inference pipeline not yet implemented.")
