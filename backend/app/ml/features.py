"""Feature definitions, data loading/cleaning and the feature-engineering transformer.

The same code path is used for training and for live inference, so the model the API
serves always sees features built exactly the way they were built during training.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin

# Clinical inputs, in the order every model pipeline expects them.
RAW_FEATURES: list[str] = [
    "age",          # years
    "gender",       # 0 = female, 1 = male
    "height",       # cm
    "weight",       # kg
    "ap_hi",        # systolic blood pressure, mmHg
    "ap_lo",        # diastolic blood pressure, mmHg
    "cholesterol",  # 1 normal, 2 above normal, 3 well above normal
    "gluc",         # 1 normal, 2 above normal, 3 well above normal
    "smoke",        # 0/1
    "alco",         # 0/1
    "active",       # 0/1 physically active
]
ENGINEERED_FEATURES: list[str] = RAW_FEATURES + ["bmi", "pulse_pressure"]

FEATURE_LABELS: dict[str, str] = {
    "age": "Age",
    "gender": "Sex (male)",
    "height": "Height",
    "weight": "Weight",
    "ap_hi": "Systolic BP",
    "ap_lo": "Diastolic BP",
    "cholesterol": "Cholesterol",
    "gluc": "Glucose",
    "smoke": "Smoking",
    "alco": "Alcohol intake",
    "active": "Physical activity",
    "bmi": "BMI",
    "pulse_pressure": "Pulse pressure",
}

# Plausibility filters applied during cleaning (same as the research paper).
VALID_RANGES = {
    "ap_hi": (80, 220),
    "ap_lo": (40, 160),
    "height": (120, 220),
    "weight": (30, 200),
}


@dataclass
class CleaningReport:
    raw_rows: int
    removed_bp: int
    removed_body: int
    removed_duplicates: int
    clean_rows: int
    positive_rate: float

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def load_dataset(path: str | Path) -> tuple[pd.DataFrame, np.ndarray, CleaningReport]:
    """Load the Kaggle Cardiovascular Disease CSV (';' or ',' separated) and clean it."""
    path = Path(path)
    with open(path, encoding="utf-8") as fh:
        header = fh.readline()
    sep = ";" if header.count(";") > header.count(",") else ","
    df = pd.read_csv(path, sep=sep)
    raw_rows = len(df)

    df["age"] = df["age"] / 365.25  # days -> years
    bp_ok = (
        df.ap_hi.between(*VALID_RANGES["ap_hi"])
        & df.ap_lo.between(*VALID_RANGES["ap_lo"])
        & (df.ap_hi > df.ap_lo)
    )
    body_ok = df.height.between(*VALID_RANGES["height"]) & df.weight.between(*VALID_RANGES["weight"])
    removed_bp = int((~bp_ok).sum())
    removed_body = int((bp_ok & ~body_ok).sum())
    df = df[bp_ok & body_ok]
    if "id" in df.columns:
        df = df.drop(columns=["id"])
    before = len(df)
    df = df.drop_duplicates()
    removed_dupes = before - len(df)
    df["gender"] = (df["gender"] == 2).astype(int)  # Kaggle coding: 1 female, 2 male

    X = df[RAW_FEATURES].astype(float).reset_index(drop=True)
    y = df["cardio"].astype(int).to_numpy()
    report = CleaningReport(raw_rows, removed_bp, removed_body, removed_dupes, len(df), float(y.mean()))
    return X, y, report


class FeatureBuilder(BaseEstimator, TransformerMixin):
    """Adds BMI and pulse pressure to the 11 clinical inputs (11 -> 13 columns)."""

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        X = np.asarray(X, dtype=float)
        height_m = X[:, 2] / 100.0
        bmi = X[:, 3] / np.square(height_m)
        pulse_pressure = X[:, 4] - X[:, 5]
        return np.column_stack([X, bmi, pulse_pressure])

    def get_feature_names_out(self, input_features=None):
        return np.array(ENGINEERED_FEATURES)
