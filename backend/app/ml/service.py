"""Loads trained pipelines and serves predictions with explanations."""
from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np

from .features import FEATURE_LABELS, RAW_FEATURES
from .registry import DEFAULT_MODEL

log = logging.getLogger(__name__)

# Probability cut-offs for the four risk bands (not clinical thresholds; see README).
RISK_BANDS = [(0.30, "Low"), (0.50, "Moderate"), (0.70, "High"), (1.01, "Very high")]


def risk_band(p: float) -> str:
    for cut, name in RISK_BANDS:
        if p < cut:
            return name
    return RISK_BANDS[-1][1]


def display_value(feature: str, value: float) -> str:
    if feature == "age":
        return f"{value:.0f} yrs"
    if feature == "gender":
        return "Male" if value >= 0.5 else "Female"
    if feature == "height":
        return f"{value:.0f} cm"
    if feature == "weight":
        return f"{value:.1f} kg"
    if feature in ("ap_hi", "ap_lo"):
        return f"{value:.0f} mmHg"
    if feature in ("cholesterol", "gluc"):
        return {1: "Normal", 2: "Above normal", 3: "Well above normal"}.get(int(value), str(value))
    return "Yes" if value >= 0.5 else "No"


def derived_values(x: list[float]) -> dict:
    bmi = x[3] / (x[2] / 100) ** 2
    return {"bmi": round(bmi, 1), "pulse_pressure": round(x[4] - x[5], 1)}


def recommendations(x: list[float], band: str) -> list[str]:
    """General, guideline-style prompts tied to modifiable factors. Not medical advice."""
    age, _, _, _, sbp, dbp, chol, gluc, smoke, alco, active = x
    bmi = derived_values(x)["bmi"]
    out: list[str] = []
    if sbp >= 140 or dbp >= 90:
        out.append("Blood pressure is in the hypertensive range (>=140/90 mmHg); confirm with repeat readings and review management.")
    elif sbp >= 130 or dbp >= 80:
        out.append("Blood pressure is elevated (>=130/80 mmHg); lifestyle changes and periodic monitoring are advisable.")
    if chol >= 2:
        out.append("Cholesterol is above normal; a full lipid profile and dietary review are recommended.")
    if gluc >= 2:
        out.append("Glucose is above normal; consider HbA1c or fasting glucose testing to screen for diabetes.")
    if bmi >= 30:
        out.append(f"BMI is {bmi:.1f} (obese range); structured weight management would lower cardiovascular risk.")
    elif bmi >= 25:
        out.append(f"BMI is {bmi:.1f} (overweight); gradual weight reduction is beneficial.")
    if smoke >= 0.5:
        out.append("Smoking is a major modifiable risk factor; offer cessation support.")
    if alco >= 0.5:
        out.append("Reported alcohol intake; advise keeping consumption within recommended limits.")
    if active < 0.5:
        out.append("Patient reports no regular physical activity; aim for at least 150 minutes of moderate activity per week.")
    if band in ("High", "Very high"):
        out.insert(0, "Model estimates high cardiovascular risk; consider a full clinical cardiovascular assessment.")
    if not out:
        out.append("No modifiable risk factors flagged; continue routine screening.")
    return out


@dataclass
class LoadedModel:
    key: str
    meta: dict
    pipeline: object


class ModelService:
    def __init__(self, models_dir: Path, shap_background: int = 40):
        self.models_dir = Path(models_dir)
        self.manifest = json.loads((self.models_dir / "manifest.json").read_text())

        # Model pipelines are loaded lazily, on first use, and cached here. Some of
        # these artifacts (the Random Forest in particular: 300 unlimited-depth trees)
        # cost 100-300 MB of RAM once deserialized, far more than their file size
        # suggests. Loading all 7 eagerly at startup was enough on its own to exceed
        # a small instance's memory limit before a single request was even served.
        self.meta: dict[str, dict] = {}
        self._paths: dict[str, Path] = {}
        for meta in self.manifest["models"]:
            path = self.models_dir / f"{meta['key']}.joblib"
            if path.exists():
                self.meta[meta["key"]] = meta
                self._paths[meta["key"]] = path
            else:
                log.warning("Model artifact missing: %s", path)
        if not self._paths:
            raise RuntimeError(f"No model artifacts found in {self.models_dir}; run `python -m app.ml.train`")
        self._pipelines: dict[str, object] = {}
        bg = np.load(self.models_dir / "background.npy")
        self.background = bg[:shap_background]
        self.ranges = self.manifest["feature_ranges"]
        self._lock = threading.Lock()

        # Precompute the exact-Shapley machinery once: every feature subset, its size,
        # and its Shapley weight. Independent of which model is explained, so it is
        # shared across all 7 models and built only once at startup.
        n = len(RAW_FEATURES)
        subsets = np.arange(1 << n)
        self._n = n
        self._bits = ((subsets[:, None] >> np.arange(n)[None, :]) & 1).astype(float)
        self._popcount = self._bits.sum(axis=1).astype(int)
        fact = np.ones(n + 1)
        for i in range(1, n + 1):
            fact[i] = fact[i - 1] * i
        sizes = np.arange(n)
        self._coalition_weight = fact[sizes] * fact[n - sizes - 1] / fact[n]

        log.info("Model artifacts available: %s (loaded lazily on first use)", ", ".join(self._paths))

    @property
    def default_key(self) -> str:
        return DEFAULT_MODEL if DEFAULT_MODEL in self._paths else next(iter(self._paths))

    def resolve(self, key: str | None) -> LoadedModel:
        key = key or self.default_key
        if key not in self._paths:
            raise KeyError(key)
        pipeline = self._pipelines.get(key)
        if pipeline is None:
            with self._lock:
                pipeline = self._pipelines.get(key)  # re-check: another thread may have loaded it
                if pipeline is None:
                    pipeline = joblib.load(self._paths[key])
                    self._pipelines[key] = pipeline
                    log.info("Loaded model on demand: %s", key)
        return LoadedModel(key, self.meta[key], pipeline)

    def predict_proba(self, key: str | None, X: np.ndarray) -> np.ndarray:
        model = self.resolve(key)
        return model.pipeline.predict_proba(np.asarray(X, dtype=float))[:, 1]

    def warnings_for(self, x: list[float]) -> list[str]:
        out = []
        for f, v in zip(RAW_FEATURES, x):
            r = self.ranges.get(f)
            if r and f not in ("gender", "smoke", "alco", "active", "cholesterol", "gluc"):
                if v < r["p01"] or v > r["p99"]:
                    out.append(f"{FEATURE_LABELS[f]} ({display_value(f, v)}) is outside the range seen in "
                               f"99% of training patients ({display_value(f, r['p01'])} to {display_value(f, r['p99'])}); "
                               "the estimate is less reliable.")
        return out

    def explain(self, key: str | None, x: list[float]) -> dict:
        """Exact interventional Shapley values over the 11 clinical inputs, in probability
        units, via full coalition enumeration against the background set (2**11 = 2048
        subsets). This is the same math a Kernel SHAP run with a full-enumeration sample
        budget converges to, computed directly in NumPy so the service has no dependency
        on the `shap` package (whose numba/llvmlite JIT import is memory-heavy enough to
        crash a small instance)."""
        model = self.resolve(key)
        x_arr = np.asarray(x, dtype=float)
        n, bg = self._n, self.background
        bits = self._bits  # shape (2**n, n)

        # masked[S, b, :] = x where bit i of subset S is set, else background row b.
        masked = bits[:, None, :] * x_arr[None, None, :] + (1 - bits[:, None, :]) * bg[None, :, :]
        proba = model.pipeline.predict_proba(masked.reshape(-1, n))[:, 1]
        v = proba.reshape(len(bits), len(bg)).mean(axis=1)  # v[S], averaged over background

        phi = np.zeros(n)
        subset_idx = np.arange(len(bits))
        for i in range(n):
            without = subset_idx[bits[:, i] == 0]
            with_i = without | (1 << i)
            phi[i] = np.sum(self._coalition_weight[self._popcount[without]] * (v[with_i] - v[without]))

        contribs = [{"feature": f, "label": FEATURE_LABELS[f], "value": float(val),
                     "display_value": display_value(f, val), "shap": float(s)}
                    for f, val, s in zip(RAW_FEATURES, x_arr, phi)]
        contribs.sort(key=lambda c: -abs(c["shap"]))
        return {"base_value": float(v[0]), "contributions": contribs,
                "method": "Exact Shapley values (11 clinical inputs, probability scale)"}

    def public_models(self) -> list[dict]:
        """Metadata for every available model, without loading any pipeline into memory."""
        out = []
        for key, meta in self.meta.items():
            m = {k: v for k, v in meta.items()}
            m["default"] = key == self.default_key
            out.append(m)
        return out
