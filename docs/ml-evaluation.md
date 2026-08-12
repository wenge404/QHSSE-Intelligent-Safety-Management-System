# Predictive risk classification — method and evaluation

Reproduce everything below with:

```bash
cd ml-service && .venv/Scripts/python train.py
```

Outputs `models/risk_classifier_set_{A,B}.joblib`, `reports/model_comparison.json`,
`reports/precision_recall.png`, and `reports/feature_importance_set_B.png`.

---

## 1. Dataset

PHMSA Pipeline Incident Flagged Files, **gas distribution 2010–present** (Form 7100.1) —
1,589 operator-submitted records across 485 columns, covering 2010 to 2026.

The flagged files were chosen over raw operator submissions because they add PHMSA's harmonised
cause categories and property-damage figures converted to current-year dollars. The 2010-onward
period corresponds to a single report format, avoiding the sparse columns that result from merging
earlier form revisions.

### Fire-first exclusion

PHMSA excludes fire-first (`FF = YES`) incidents from the significant-incident definition, so
every such row is labelled `NO` regardless of its other attributes. `FF` is itself a leakage
column and cannot be given to the model, which makes those 93 rows **unlearnable** — the model has
no way to know they are fire-first, so it can only be penalised for them. They are dropped, which
is what PHMSA does in its own significant-incident analysis.

**1,589 → 1,496 rows.**

---

## 2. Target variable

The classification target is PHMSA's own `SIGNIFICANT` flag: an incident is significant where it
is not a fire-first event and involved a fatality, an injury, or total property damage of
USD 50,000 or more measured in 1984 dollars.

Using the regulator's published definition rather than a threshold constructed for this project
has three advantages:

1. It is **inflation-adjusted by PHMSA** across the whole reporting period, so a 2011 incident and
   a 2025 incident are compared on equal terms.
2. It is **externally defensible** rather than arbitrary.
3. It is **consistent with how the industry classifies severity**.

The stricter `SERIOUS` flag (fatality or hospitalisation only, a 23/77 split) is retained as an
alternative target for sensitivity analysis: `python train.py --target SERIOUS`.

---

## 3. Leakage control — the single most important decision here

`SIGNIFICANT` is **computed from** the fatality count, injury count, total cost in 1984 dollars,
and the fire-first indicator. Supplying any of those as features would let a model reconstruct the
label's own definition, producing near-perfect scores of no predictive value whatsoever.

**An accuracy above ~0.95 on this problem is a symptom of leakage, not success.**

Twenty columns are excluded — the four definitional fields, the whole `TOTAL_COST*` family, and
every `EST_COST*` variant present in the file:

```
FATAL, INJURE, FF, SERIOUS, TOTAL_COST, TOTAL_COST_IN84, TOTAL_COST_CURRENT,
EST_COST_OPER_PAID, EST_COST_OPER_PAID_CURRENT, EST_COST_PROP_DAMAGE,
EST_COST_PROP_DAMAGE_CURRENT, EST_COST_EMERGENCY, EST_COST_EMERGENCY_CURRENT,
EST_COST_OTHER, EST_COST_OTHER_CURRENT, EST_COST_OTHER_DETAILS,
EST_COST_UNINTENTIONAL_RELEASE, EST_COST_UNINTENT_REL_CURRENT,
EST_COST_INTENTIONAL_RELEASE, EST_COST_INTENT_REL_CURRENT
```

The exclusion list is derived at runtime (`leakage_columns()`) rather than hard-coded, so a form
revision that adds another `EST_COST` variant is caught automatically.

The consequence fields are still **captured by the platform** — the incident form records
fatalities, injuries, property damage and gas volume for reporting and KPI purposes. They are
simply never sent to the model. The scoring payload in
[`incident.controller.ts`](../backend/src/controllers/incident.controller.ts) is explicit about which fields cross that
boundary.

---

## 4. Class balance — why SMOTE was rejected

After the fire-first filter the split is **68% significant / 32% not**.

That is close enough to balanced that synthetic over-sampling is not warranted. SMOTE was
evaluated and **rejected on the evidence of the observed distribution** rather than applied by
default because safety datasets are conventionally imbalanced. The trainer prints a note
recommending it only when the minority class falls below 30%, which is exactly what happens under
the stricter `SERIOUS` target (23/77).

The majority-class baseline accuracy is therefore **0.680** — the number any model must beat to
have done anything at all.

---

## 5. Two feature sets, two different claims

| Set | Features | What a model on it supports |
| --- | --- | --- |
| **A** | cause, component, location, pressure, diameter | **Prevention** — all knowable before an incident |
| **B** | A + ignition, explosion, material, release type, area, pipe age | **Triage** — knowable when an incident is logged |

Neither set contains leakage: none of these fields appear in the `SIGNIFICANT` definition. But set
B describes an incident that has **already occurred**, so a model built on it prioritises response
and investigation rather than preventing anything. Evaluating both makes the distinction explicit
instead of quietly claiming prevention while relying on after-the-fact attributes.

`PIPE_AGE` is derived as `IYEAR − INSTALLATION_YEAR`, with negative ages and implausible centuries
treated as data-entry noise rather than signal.

---

## 6. Methodology

**Preprocessing sits inside the pipeline.** Median imputation, rare-category collapsing and
scaling are fitted on each training fold only. Fitting them on the full dataset before
cross-validation is a subtle and common form of leakage that quietly inflates reported scores.

**Missing categoricals become a real `MISSING` category.** The fill happens *before* the cast to
string. Doing it the other way round turns `NaN` into the literal string `"nan"`, which means the
placeholder the serving code sends for an unfilled field is a category the encoder never saw and
`handle_unknown="ignore"` silently drops. Filling first makes `MISSING` a genuine, learned
category — so scoring a half-completed draft behaves the same way in production as in training.

**Stratified 5-fold cross-validation.** With 1,496 rows a single train/test split would leave a
test set of ~300, small enough for metrics to swing noticeably with the split drawn. Results are
reported as **mean ± standard deviation across folds**, never as single-run figures.

---

## 7. Results

### Feature set A — circumstances only

| Model | Accuracy | Precision | Recall | F1 | PRC-AUC |
| --- | --- | --- | --- | --- | --- |
| Logistic Regression | 0.676 ± 0.006 | 0.680 ± 0.002 | 0.988 ± 0.009 | 0.806 ± 0.004 | 0.735 ± 0.024 |
| **Random Forest** | 0.660 ± 0.017 | 0.689 ± 0.007 | 0.914 ± 0.034 | 0.785 ± 0.014 | **0.746 ± 0.017** |
| SVM (RBF) | 0.682 ± 0.005 | 0.683 ± 0.003 | 0.992 ± 0.002 | 0.809 ± 0.003 | 0.695 ± 0.037 |

**This is a null result, and it is reported as one.** Accuracy lands at 0.66–0.68 against a
majority-class baseline of **0.680** — no better than always guessing "significant". Recall near
0.99 with precision at the base rate confirms the models are doing exactly that.

PRC-AUC of 0.746 does sit above the 0.680 no-skill line, so there is *some* ranking signal, but
not enough to shift hard classifications. **Cause, component, location, pressure and diameter
alone do not determine whether a gas distribution incident becomes significant.**

### Feature set B — plus incident characteristics

| Model | Accuracy | Precision | Recall | F1 | PRC-AUC |
| --- | --- | --- | --- | --- | --- |
| **Logistic Regression** | 0.709 ± 0.010 | 0.737 ± 0.003 | 0.889 ± 0.029 | 0.806 ± 0.010 | **0.811 ± 0.015** |
| Random Forest | 0.696 ± 0.010 | 0.718 ± 0.004 | 0.912 ± 0.026 | 0.803 ± 0.009 | 0.811 ± 0.021 |
| SVM (RBF) | 0.713 ± 0.018 | 0.730 ± 0.008 | 0.917 ± 0.033 | 0.813 ± 0.014 | 0.780 ± 0.014 |

Adding ignition, explosion, material, release type, area and pipe age lifts **PRC-AUC from 0.746
to 0.811** and accuracy to 0.709 (+0.029 over baseline). Modest, but real and **consistent across
all three algorithms** — which is itself evidence the gain comes from the features rather than
from one model overfitting.

---

## 8. Operating threshold

In a safety context the two error types are not equal. A false negative is a genuinely significant
incident the system down-prioritises; a false positive merely triggers an unnecessary review. The
threshold should therefore favour recall — but *how much* has to be a stated, defensible choice
rather than the 0.5 default.

**Maximising F-beta (β=2) was tried first and rejected.** Against a 68% base rate it degenerates
to predicting "significant" for everything: 0 false negatives, but only **1** true negative out of
478. That scores well on F2 while producing a triage tool that ranks nothing.

**The policy adopted instead: fix recall at 0.90 and take the most selective threshold that still
meets it.** This gives an operating policy that can be stated in one sentence — *the system is
tuned to catch 90% of significant incidents* — and lets precision land where the data puts it.

| | Threshold | Recall | Precision | TN | FP | FN | TP |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Set A | 0.518 | 0.901 | 0.692 | 70 | 408 | 101 | 917 |
| **Set B** | **0.482** | **0.901** | **0.730** | **139** | 339 | 101 | 917 |

**Compared at the same recall, set B correctly clears 139 non-significant incidents against set
A's 70 — twice the useful filtering at an identical safety level.** That is the operationally
meaningful comparison, and a better statement of what set B buys than the +0.029 accuracy delta.

---

## 9. Serving

The winning pipeline for each set is refitted on all rows and serialised with `joblib`. The
**fitted preprocessor is serialised with the estimator in one `Pipeline` object** — refitting it
on request data at inference time is a classic source of silent prediction skew.

`ml-service/app.py` exposes:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Which models are loaded |
| `GET /models` | The full cross-validated comparison (this document, as JSON) |
| `POST /predict` | Score one incident; `featureSet` selects A or B, default B |

The response includes `missing_inputs`, so the UI can distinguish a confident score from one
computed on a half-filled form.

Platform enums are translated to the PHMSA training vocabulary in
[`app/features.py`](../ml-service/app/features.py). The mapping tables are exhaustive
and 1:1 with the corresponding Prisma enums, so no platform option can fall through to an unseen
category. Training and serving import the same module — that shared import is what stops the two
sides drifting apart.

Probability is banded into the four-level `RiskLevel` enum relative to the **0.68 training base
rate**, not an abstract quartile grid: below the base rate the model is saying "less likely than a
typical incident to be significant", which is the honest meaning of LOW here.

| Band | Probability |
| --- | --- |
| LOW | < 0.50 |
| MEDIUM | 0.50 – 0.68 |
| HIGH | 0.68 – 0.85 |
| CRITICAL | ≥ 0.85 |

---

## 10. Conclusions

1. **Leakage was the dominant risk and was controlled.** All twenty definitional and cost columns
   were excluded.
2. **SMOTE is not needed** at 68/32. Rejected on evidence rather than applied reflexively.
3. **Circumstance features alone do not predict severity.** Reported as a null result.
4. **Incident characteristics add real but modest signal**, consistent across all three algorithms.
5. **The honest claim is severity triage, not prevention.**

### Limitations

- 1,496 records is modest; confidence intervals on all estimates are wide.
- US gas distribution data is a proxy for GDC's operations, which differ in regulation, climate,
  and network age. The pipeline is structured so GDC's own historical data could replace it with
  minimal change.
- `PIPE_DIAMETER` is 62% populated and median-imputed; `DEPTH_OF_COVER` was too sparse to use.
- Reporting thresholds changed within the period, which may shift what enters the dataset over
  time.
- No hyperparameter search was performed — models use reasonable defaults. A grid search nested
  inside the cross-validation loop is the correct next step.
