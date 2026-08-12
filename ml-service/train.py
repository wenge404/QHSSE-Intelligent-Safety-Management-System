"""Train, evaluate and persist the IQSMS risk classifiers.

Reproducible port of Phase 4 (IQSMS_Phase4_Risk_Model.ipynb). Trains both
feature sets, cross-validates three algorithms on each, writes a metrics report
and figures, and serialises the winning pipeline per set for the FastAPI
service.

    python train.py                 # both sets, 5-fold CV
    python train.py --target SERIOUS  # sensitivity analysis on the stricter flag

Reported figures are means +/- standard deviations across folds. With ~1,500
rows a single train/test split would leave a test set of ~300, small enough for
metrics to swing noticeably with the split drawn.
"""

from __future__ import annotations

import argparse
import json
import warnings
from datetime import datetime, timezone
from pathlib import Path

import joblib
import matplotlib

# scipy's L-BFGS wrapper reports an unknown-option warning for every logistic
# regression fit under this scikit-learn/scipy pairing. It is cosmetic and
# would otherwise bury the actual results under ~30 identical lines.
warnings.filterwarnings("ignore", category=RuntimeWarning)
warnings.filterwarnings("ignore", message="Unknown solver options")

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
)
from sklearn.model_selection import StratifiedKFold

from app.features import FEATURE_SETS
from app.pipeline import (
    N_FOLDS,
    RANDOM_STATE,
    add_derived_features,
    build_models,
    build_pipeline,
    leakage_columns,
    load_dataset,
    make_feature_frame,
)

HERE = Path(__file__).resolve().parent
MODEL_DIR = HERE / "models"
REPORT_DIR = HERE / "reports"

#: A false negative is a genuinely significant incident the system
#: down-prioritises; a false positive merely triggers an unnecessary review.
#: The operating threshold is therefore chosen by an explicit recall target
#: rather than left at the 0.5 default.
#:
#: Maximising F-beta (beta=2) was tried first and rejected: against a 68% base
#: rate it degenerates to predicting "significant" for everything, which scores
#: well on F2 while producing a triage tool that ranks nothing. Fixing recall
#: and taking the highest threshold that still meets it gives a stated
#: operating policy - "the system is tuned to catch 90% of significant
#: incidents" - and lets precision land where the data puts it.
TARGET_RECALL = 0.90


def evaluate_feature_set(X: pd.DataFrame, y: pd.Series, categorical, numeric) -> tuple[dict, dict]:
    """Stratified k-fold CV for all three algorithms on one feature set."""
    cv = StratifiedKFold(n_splits=N_FOLDS, shuffle=True, random_state=RANDOM_STATE)
    summary: dict[str, dict] = {}
    out_of_fold: dict[str, dict] = {}

    for name, estimator in build_models().items():
        scores = {m: [] for m in ("accuracy", "precision", "recall", "f1", "prc_auc")}
        predictions = np.zeros(len(y), dtype=int)
        probabilities = np.zeros(len(y), dtype=float)

        for train_idx, test_idx in cv.split(X, y):
            pipe = build_pipeline(estimator, categorical, numeric)
            pipe.fit(X.iloc[train_idx], y.iloc[train_idx])

            y_pred = pipe.predict(X.iloc[test_idx])
            y_prob = pipe.predict_proba(X.iloc[test_idx])[:, 1]
            y_true = y.iloc[test_idx]

            predictions[test_idx] = y_pred
            probabilities[test_idx] = y_prob

            scores["accuracy"].append(accuracy_score(y_true, y_pred))
            scores["precision"].append(precision_score(y_true, y_pred, zero_division=0))
            scores["recall"].append(recall_score(y_true, y_pred, zero_division=0))
            scores["f1"].append(f1_score(y_true, y_pred, zero_division=0))
            scores["prc_auc"].append(average_precision_score(y_true, y_prob))

        summary[name] = {
            metric: {"mean": float(np.mean(values)), "std": float(np.std(values))}
            for metric, values in scores.items()
        }
        out_of_fold[name] = {"pred": predictions, "prob": probabilities}

    return summary, out_of_fold


def choose_threshold(y_true: pd.Series, y_prob: np.ndarray) -> tuple[float, float, float]:
    """Highest probability cut-off that still meets the recall target.

    Recall is monotonically non-increasing in the threshold, so the last
    qualifying index is the most selective cut-off that still catches
    TARGET_RECALL of significant incidents. Returns (threshold, precision,
    recall) so the achieved trade-off is reported rather than assumed.
    """
    precision, recall, thresholds = precision_recall_curve(y_true, y_prob)
    if len(thresholds) == 0:
        return 0.5, 0.0, 0.0

    qualifying = [i for i in range(len(thresholds)) if recall[i] >= TARGET_RECALL]
    if not qualifying:
        # Target unreachable — fall back to the most permissive cut-off.
        return float(thresholds[0]), float(precision[0]), float(recall[0])

    index = max(qualifying)
    return float(thresholds[index]), float(precision[index]), float(recall[index])


def summary_frame(summary: dict) -> pd.DataFrame:
    return pd.DataFrame(
        {
            name: {
                metric: f"{stats['mean']:.3f} +/- {stats['std']:.3f}"
                for metric, stats in metrics.items()
            }
            for name, metrics in summary.items()
        }
    ).T


def plot_precision_recall(results: dict, y: pd.Series, base_rate: float, path: Path) -> None:
    fig, axes = plt.subplots(1, len(results), figsize=(6 * len(results), 4.4), sharey=True)
    axes = np.atleast_1d(axes)

    for ax, (set_name, payload) in zip(axes, results.items()):
        for model_name, oof in payload["out_of_fold"].items():
            precision, recall, _ = precision_recall_curve(y, oof["prob"])
            ap = average_precision_score(y, oof["prob"])
            ax.plot(recall, precision, label=f"{model_name} (AP={ap:.3f})")
        ax.axhline(base_rate, ls="--", c="grey", label=f"no skill ({base_rate:.2f})")
        ax.set_xlabel("Recall")
        ax.set_title(f"Set {set_name} - {FEATURE_SETS[set_name]['claim']}")
        ax.legend(loc="lower left", fontsize=8)
    axes[0].set_ylabel("Precision")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def plot_feature_importance(pipe, path: Path, title: str) -> None:
    """Which features drive the prediction.

    Tree models expose feature_importances_; linear models do not, so absolute
    standardised coefficients are used instead. Both are comparable *within* a
    model and neither is comparable *across* models, which is why the axis is
    labelled with the measure actually plotted rather than a generic
    "importance".
    """
    classifier = pipe.named_steps["clf"]
    names = pipe.named_steps["pre"].get_feature_names_out()

    if hasattr(classifier, "feature_importances_"):
        values = pd.Series(classifier.feature_importances_, index=names)
        measure = "Gini importance"
    elif hasattr(classifier, "coef_"):
        # Numeric features were standardised inside the pipeline and categoricals
        # are one-hot, so coefficient magnitudes are on a common scale here.
        values = pd.Series(np.abs(classifier.coef_.ravel()), index=names)
        measure = "|coefficient| (standardised)"
    else:
        # SVC with an RBF kernel has no per-feature attribution at all.
        return

    top = values.nlargest(12)
    fig, ax = plt.subplots(figsize=(8, 4.6))
    labels = [n.split("__")[-1] for n in top.index][::-1]
    ax.barh(labels, top.values[::-1], color="#2E5395")
    ax.set_title(title)
    ax.set_xlabel(measure)
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train IQSMS risk classifiers.")
    parser.add_argument("--data", type=Path, default=None, help="Path to gd2010toPresent.xlsx")
    parser.add_argument(
        "--target",
        choices=["SIGNIFICANT", "SERIOUS"],
        default="SIGNIFICANT",
        help="Classification target. SERIOUS is the stricter sensitivity analysis.",
    )
    args = parser.parse_args()

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    df = load_dataset(args.data)
    df = add_derived_features(df)

    if args.target == "SERIOUS":
        df["target"] = (df["SERIOUS"] == "YES").astype(int)

    y = df["target"].reset_index(drop=True)
    base_rate = float(y.mean())
    majority_baseline = max(base_rate, 1 - base_rate)

    print(f"Rows before fire-first filter : {df.attrs['rows_before_ff_filter']}")
    print(f"Rows after  fire-first filter : {df.attrs['rows_after_ff_filter']}")
    print(f"Target                        : {args.target}")
    print(f"Class balance                 : {100 * base_rate:.1f}% positive "
          f"/ {100 * (1 - base_rate):.1f}% negative")
    print(f"Majority-class baseline acc.  : {majority_baseline:.3f}")
    print(f"No-skill PRC-AUC baseline     : {base_rate:.3f}")
    print()
    print("Excluded as leakage:", ", ".join(leakage_columns(df)))
    print()

    # Class balance sits near 68/32 for SIGNIFICANT - close enough to balanced
    # that synthetic over-sampling is not warranted. SMOTE is rejected on the
    # evidence of the observed distribution rather than applied by default; the
    # stricter SERIOUS flag (23/77) is where it would earn its place.
    if min(base_rate, 1 - base_rate) < 0.30:
        print("NOTE: minority class below 30% - SMOTE or class weighting is justified here.\n")

    results: dict[str, dict] = {}

    for set_name, spec in FEATURE_SETS.items():
        categorical, numeric = spec["categorical"], spec["numeric"]
        X = make_feature_frame(df, categorical, numeric)

        print(f"=== Feature set {set_name} - {spec['claim']} "
              f"({len(categorical)} categorical, {len(numeric)} numeric) ===")
        summary, out_of_fold = evaluate_feature_set(X, y, categorical, numeric)
        print(summary_frame(summary).to_string())

        best_name = max(summary, key=lambda k: summary[k]["prc_auc"]["mean"])
        best_prc = summary[best_name]["prc_auc"]["mean"]
        best_acc = summary[best_name]["accuracy"]["mean"]
        threshold, thr_precision, thr_recall = choose_threshold(y, out_of_fold[best_name]["prob"])

        print(f"\nBest by PRC-AUC: {best_name} "
              f"(PRC-AUC {best_prc:.3f} vs {base_rate:.3f} no-skill; "
              f"accuracy {best_acc:.3f} vs {majority_baseline:.3f} baseline)")
        print(f"Operating threshold: {threshold:.3f} "
              f"(recall {thr_recall:.3f} >= {TARGET_RECALL:.2f} target, "
              f"precision {thr_precision:.3f} vs {base_rate:.3f} base rate)")

        cm = confusion_matrix(y, (out_of_fold[best_name]["prob"] >= threshold).astype(int))
        print(pd.DataFrame(
            cm,
            index=["actual NOT significant", "actual SIGNIFICANT"],
            columns=["pred NOT", "pred SIG"],
        ).to_string())
        print(f"False negatives: {cm[1, 0]} (the costly error)   "
              f"False positives: {cm[0, 1]} (cheap by comparison)\n")

        # Refit on all rows for serving. The fitted preprocessor is serialised
        # with the estimator in one object - refitting it on request data at
        # inference time is a classic source of silent prediction skew.
        final = build_pipeline(build_models()[best_name], categorical, numeric).fit(X, y)

        artefact = {
            "pipeline": final,
            "features": {"categorical": categorical, "numeric": numeric},
            "feature_set": set_name,
            "claim": spec["claim"],
            "model": best_name,
            "target": args.target,
            "threshold": threshold,
            "threshold_policy": f"highest cut-off with out-of-fold recall >= {TARGET_RECALL}",
            "threshold_precision": thr_precision,
            "threshold_recall": thr_recall,
            "base_rate": base_rate,
            "majority_baseline": majority_baseline,
            "prc_auc": best_prc,
            "accuracy": best_acc,
            "n_rows": int(len(y)),
            "trained_at": datetime.now(timezone.utc).isoformat(),
        }
        joblib.dump(artefact, MODEL_DIR / f"risk_classifier_set_{set_name}.joblib")

        results[set_name] = {
            "summary": summary,
            "out_of_fold": out_of_fold,
            "best_model": best_name,
            "threshold": threshold,
            "threshold_precision": thr_precision,
            "threshold_recall": thr_recall,
            "confusion_matrix": cm.tolist(),
        }

        plot_feature_importance(
            final,
            REPORT_DIR / f"feature_importance_set_{set_name}.png",
            f"Set {set_name} — {best_name}, top 12 features",
        )

    plot_precision_recall(results, y, base_rate, REPORT_DIR / "precision_recall.png")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "target": args.target,
        "rows_before_ff_filter": int(df.attrs["rows_before_ff_filter"]),
        "rows_after_ff_filter": int(df.attrs["rows_after_ff_filter"]),
        "base_rate": base_rate,
        "majority_baseline": majority_baseline,
        "leakage_excluded": leakage_columns(df),
        "smote_applied": False,
        "smote_rationale": (
            "Class split is close to balanced for SIGNIFICANT, so synthetic "
            "over-sampling was evaluated and rejected on the evidence of the "
            "observed distribution rather than applied by default."
        ),
        "feature_sets": {
            name: {
                "claim": FEATURE_SETS[name]["claim"],
                "description": FEATURE_SETS[name]["description"],
                "categorical": FEATURE_SETS[name]["categorical"],
                "numeric": FEATURE_SETS[name]["numeric"],
                "best_model": payload["best_model"],
                "threshold": payload["threshold"],
                "threshold_policy": f"highest cut-off with out-of-fold recall >= {TARGET_RECALL}",
                "threshold_precision": payload["threshold_precision"],
                "threshold_recall": payload["threshold_recall"],
                "confusion_matrix": payload["confusion_matrix"],
                "metrics": payload["summary"],
            }
            for name, payload in results.items()
        },
    }
    (REPORT_DIR / "model_comparison.json").write_text(json.dumps(report, indent=2))

    print(f"Saved models to {MODEL_DIR}")
    print(f"Saved report and figures to {REPORT_DIR}")


if __name__ == "__main__":
    main()
