# IQSMS ML Service

Risk-classification microservice. Trains on the public PHMSA gas-pipeline incident dataset and serves severity predictions to the backend.

## Layout

```
app/          FastAPI application
notebooks/    EDA and model training notebooks
data/         Raw + cleaned datasets (gitignored)
models/       Serialized models (gitignored)
```

## Run

```bash
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Check it's alive: `curl http://localhost:8000/health`
Interactive API docs: http://localhost:8000/docs

## Endpoints

| Method | Path | Status |
|---|---|---|
| GET | `/health` | Working |
| POST | `/api/v1/predict` | Contract defined, returns 503 until a model is trained |

## Phase 4 order of work

1. Download the PHMSA incident data into `data/` and profile it.
2. Build the severity index (damage cost, injuries/fatalities, gas released) and pick the classification cutoff **from the observed distribution** — do not reuse PHMSA's own reportability thresholds, since every record in the dataset already clears them and the resulting label would barely separate the classes.
3. Confirm the real class split, then choose SMOTE, class-weighting, or both.
4. Train Logistic Regression, Random Forest, and SVM. Keep every result — the losing models are the comparison table in your report.
5. Evaluate on accuracy, precision, recall, F1, confusion matrix, and PRC-AUC.
6. Save the winning estimator **and its fitted preprocessor** to `models/`, then implement the inference path in `app/main.py`.
7. Smoke-test the endpoint standalone before wiring it into the backend.
