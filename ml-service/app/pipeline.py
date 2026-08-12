"""Dataset loading and the estimator pipeline.

The preprocessing steps live *inside* the sklearn Pipeline so that median
imputation, rare-category collapsing and scaling are fitted on each training
fold only. Fitting them on the full dataset before cross-validation is a subtle
and common form of leakage that quietly inflates the reported scores.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVC

from .features import LEAKAGE_COLUMNS, MISSING, TARGET_COLUMN

RANDOM_STATE = 42
N_FOLDS = 5
SHEET_NAME = "gd2010toPresent"

#: ml-service/data/ — gitignored, see the repository .gitignore.
DEFAULT_DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "gd2010toPresent.xlsx"


def build_models() -> dict:
    """The three classifiers the proposal commits to comparing (4.2, 7)."""
    return {
        "Logistic Regression": LogisticRegression(max_iter=2000, random_state=RANDOM_STATE),
        "Random Forest": RandomForestClassifier(
            n_estimators=300, min_samples_leaf=3, random_state=RANDOM_STATE, n_jobs=-1
        ),
        "SVM (RBF)": SVC(kernel="rbf", probability=True, random_state=RANDOM_STATE),
    }


def load_dataset(path: Path | str | None = None) -> pd.DataFrame:
    """Load the gas distribution flagged file and apply the fire-first rule.

    PHMSA excludes fire-first (``FF = YES``) incidents from the significant
    incident definition, so every such row is labelled NO regardless of its
    other attributes. ``FF`` is itself a leakage column and cannot be given to
    the model, which makes those rows unlearnable - the model has no way to know
    they are fire-first, so it can only be penalised for them. They are dropped,
    which is what PHMSA does in its own significant-incident analysis.
    """
    source = Path(path) if path else DEFAULT_DATA_PATH
    if not source.exists():
        raise FileNotFoundError(
            f"PHMSA dataset not found at {source}. Extract "
            "PHMSA_Pipeline_Safety_Flagged_Incidents.zip into ml-service/data/."
        )

    raw = pd.read_excel(source, sheet_name=SHEET_NAME)
    df = raw[raw["FF"] == "NO"].copy()
    df["target"] = (df[TARGET_COLUMN] == "YES").astype(int)
    df.attrs["rows_before_ff_filter"] = len(raw)
    df.attrs["rows_after_ff_filter"] = len(df)
    return df


def leakage_columns(df: pd.DataFrame) -> list[str]:
    """Named leakage columns plus every EST_COST* variant present in the file."""
    return LEAKAGE_COLUMNS + [c for c in df.columns if c.startswith("EST_COST")]


def add_derived_features(df: pd.DataFrame) -> pd.DataFrame:
    """Pipe age at time of incident - a genuine pre-incident circumstance."""
    install = pd.to_numeric(df["INSTALLATION_YEAR"], errors="coerce")
    df["PIPE_AGE"] = df["IYEAR"] - install
    # Negative ages and implausible centuries are data-entry noise, not signal.
    df.loc[(df["PIPE_AGE"] < 0) | (df["PIPE_AGE"] > 150), "PIPE_AGE"] = np.nan
    return df


def collapse_rare(series: pd.Series, min_count: int = 10, label: str = "OTHER") -> pd.Series:
    counts = series.value_counts()
    return series.where(~series.isin(counts[counts < min_count].index), label)


def make_feature_frame(
    df: pd.DataFrame, categorical: list[str], numeric: list[str]
) -> pd.DataFrame:
    """Assemble the model matrix.

    Note the fillna-before-astype ordering. Doing it the other way round turns
    NaN into the literal string "nan" and means the placeholder the serving code
    sends for an unfilled field is a category the encoder never saw, so it is
    silently dropped. Filling first makes MISSING a genuine, learned category.
    """
    frame = df[categorical + numeric].copy()
    for column in categorical:
        frame[column] = collapse_rare(frame[column].fillna(MISSING).astype(str))
    for column in numeric:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.reset_index(drop=True)


def build_pipeline(estimator, categorical: list[str], numeric: list[str]) -> Pipeline:
    preprocessor = ColumnTransformer(
        [
            ("cat", OneHotEncoder(handle_unknown="ignore", drop="first"), categorical),
            (
                "num",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="median")),
                        ("scale", StandardScaler()),
                    ]
                ),
                numeric,
            ),
        ]
    )
    return Pipeline([("pre", preprocessor), ("clf", estimator)])
