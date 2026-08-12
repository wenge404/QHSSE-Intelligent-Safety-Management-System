# IQSMS ML service

Predictive risk classification for gas distribution incidents. Trained on the public PHMSA gas
distribution flagged file (2010–present, Form 7100.1) against PHMSA's own `SIGNIFICANT` incident
classification, and served to the backend over FastAPI.

## Setup

```bash
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
```

Place the PHMSA dataset at `data/gd2010toPresent.xlsx` — it is gitignored, so download it from
<https://www.phmsa.dot.gov/data-and-statistics> (Pipeline Incident Flagged Files → Gas
Distribution, 2010 to present). Then train and serve:

```bash
.venv/Scripts/python train.py && .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

On macOS/Linux replace `.venv/Scripts/python` with `.venv/bin/python`.

Health check: <http://localhost:8000/health>

## Layout

```
app/
  main.py       FastAPI service — /health, /api/v1/predict, /api/v1/models
  features.py   feature sets, leakage exclusions, IQSMS→PHMSA vocabulary
  pipeline.py   dataset loading and the sklearn pipeline
train.py        reproducible training, cross-validation and reporting
data/           PHMSA source files (gitignored)
models/         serialised pipelines (gitignored)
reports/        model_comparison.json and figures — committed as evidence
notebooks/      exploratory work
```

`app/features.py` is imported by both `train.py` and `app/main.py`. That shared import is what
stops the training vocabulary and the serving vocabulary drifting apart.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Which models are loaded |
| `GET /api/v1/models` | The full cross-validated comparison, as JSON |
| `POST /api/v1/predict` | Score one incident; `featureSet` selects A or B, default B |

## What the model claims

**Severity triage, not prevention.** It estimates whether an incident that has already occurred
meets PHMSA's `SIGNIFICANT` threshold, so investigation can be prioritised. It does not forecast
which pipeline segment will fail next.

| Set | Features | PRC-AUC | Status |
| --- | --- | --- | --- |
| A | cause, component, location, pressure, diameter | 0.746 | Null result — accuracy at the 0.680 majority baseline |
| B | A + ignition, explosion, material, release type, area, pipe age | 0.811 | Served |

`SIGNIFICANT` is computed from fatality count, injury count, 1984-dollar cost and the fire-first
indicator; all twenty such columns are excluded as leakage. An accuracy above ~0.95 on this
problem is a symptom of leakage, not success.

Full method: [`docs/ml-evaluation.md`](../docs/ml-evaluation.md).
