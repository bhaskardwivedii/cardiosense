"""Train, evaluate and export all seven CVD models.

Usage:
    python -m app.ml.train --data ../data/cardio_train.csv --out models
    python -m app.ml.train --data ../data/cardio_train.csv --out models --run-pso   # re-run PSO (~15 min)
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score, precision_score,
                             recall_score, roc_auc_score, roc_curve)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

from .autoencoder import AutoencoderEncoder
from .features import ENGINEERED_FEATURES, RAW_FEATURES, FeatureBuilder, load_dataset
from .pso import pso_search
from .registry import MODEL_SPECS, PAPER_PSO_AE, PAPER_PSO_RAW, SEED, mlp

log = logging.getLogger("train")


def evaluate(y_true: np.ndarray, prob: np.ndarray) -> dict:
    pred = (prob >= 0.5).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred).ravel()
    fpr, tpr, _ = roc_curve(y_true, prob)
    grid = np.linspace(0, 1, 41)
    return {
        "accuracy": accuracy_score(y_true, pred),
        "precision": precision_score(y_true, pred),
        "recall": recall_score(y_true, pred),
        "specificity": tn / (tn + fp),
        "f1": f1_score(y_true, pred),
        "auc": roc_auc_score(y_true, prob),
        "confusion": {"tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn)},
        "roc": [{"fpr": float(g), "tpr": float(np.interp(g, fpr, tpr))} for g in grid],
    }


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="Path to cardio_train.csv")
    ap.add_argument("--out", default="models", help="Output directory for model artifacts")
    ap.add_argument("--run-pso", action="store_true", help="Re-run the PSO searches instead of using the paper's configs")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    X, y, report = load_dataset(args.data)
    log.info("Loaded %d clean rows (%s)", len(y), report.as_dict())
    Xa = X.to_numpy()
    X_tr, X_te, y_tr, y_te = train_test_split(Xa, y, test_size=0.15, stratify=y, random_state=SEED)
    X_tr, X_va, y_tr, y_va = train_test_split(X_tr, y_tr, test_size=0.15 / 0.85, stratify=y_tr, random_state=SEED)
    log.info("Split train/val/test = %d/%d/%d", len(y_tr), len(y_va), len(y_te))

    # Decision-tree depth chosen on validation accuracy
    best_depth = max(range(3, 16), key=lambda d: accuracy_score(
        y_va, MODEL_SPECS["tree"].build(depth=d).fit(X_tr, y_tr).predict(X_va)))

    pso_info: dict = {"source": "paper", "raw": PAPER_PSO_RAW, "ae": PAPER_PSO_AE}
    cfg_raw, cfg_ae = PAPER_PSO_RAW, PAPER_PSO_AE
    if args.run_pso:
        prep = Pipeline([("f", FeatureBuilder()), ("s", StandardScaler())]).fit(X_tr)
        S_tr, S_va = prep.transform(X_tr), prep.transform(X_va)
        enc = AutoencoderEncoder().fit(S_tr)
        r_raw = pso_search(lambda c: mlp(c), S_tr, y_tr, S_va, y_va)
        r_ae = pso_search(lambda c: mlp(c), enc.transform(S_tr), y_tr, enc.transform(S_va), y_va)
        cfg_raw, cfg_ae = r_raw.best_config, r_ae.best_config
        pso_info = {"source": "search", "raw": cfg_raw, "ae": cfg_ae,
                    "history_raw": r_raw.history_best, "history_ae": r_ae.history_best}

    kwargs = {"tree": {"depth": best_depth}, "dnn_pso": {"config": cfg_raw}, "hybrid": {"config": cfg_ae}}
    models_meta = []
    for key, spec in MODEL_SPECS.items():
        t0 = time.time()
        pipe = spec.build(**kwargs.get(key, {})).fit(X_tr, y_tr)
        fit_s = time.time() - t0
        prob = pipe.predict_proba(X_te)[:, 1]
        metrics = evaluate(y_te, prob)
        extra = {}
        if "encoder" in pipe.named_steps:
            Z = pipe[:-2].transform(X_te)  # features + scale
            extra["ae_reconstruction_mse"] = pipe.named_steps["encoder"].reconstruction_mse(Z)
        if key == "forest":
            imp = pipe.named_steps["clf"].feature_importances_
            extra["feature_importance"] = sorted(
                [{"feature": f, "importance": float(v)} for f, v in zip(ENGINEERED_FEATURES, imp)],
                key=lambda d: -d["importance"])
        clf = pipe.named_steps["clf"]
        params = {k: v for k, v in clf.get_params().items()
                  if k in ("hidden_layer_sizes", "learning_rate_init", "alpha", "batch_size", "max_depth",
                           "n_estimators", "min_samples_leaf", "C")}
        joblib.dump(pipe, out / f"{key}.joblib", compress=3)
        size_kb = (out / f"{key}.joblib").stat().st_size / 1024
        log.info("%-8s acc %.4f f1 %.4f auc %.4f (%.1fs, %.0f KB)", key, metrics["accuracy"],
                 metrics["f1"], metrics["auc"], fit_s, size_kb)
        models_meta.append({"key": key, "name": spec.name, "family": spec.family,
                            "description": spec.description, "params": params,
                            "fit_seconds": round(fit_s, 2), "metrics": metrics, **extra})

    # Background sample for SHAP and training ranges for out-of-distribution warnings
    rng = np.random.default_rng(SEED)
    background = X_tr[rng.choice(len(X_tr), size=200, replace=False)]
    np.save(out / "background.npy", background)
    ranges = {f: {"p01": float(np.percentile(X_tr[:, i], 1)), "p99": float(np.percentile(X_tr[:, i], 99)),
                  "min": float(X_tr[:, i].min()), "max": float(X_tr[:, i].max()),
                  "mean": float(X_tr[:, i].mean())}
              for i, f in enumerate(RAW_FEATURES)}

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "sklearn_version": sklearn.__version__,
        "dataset": {**report.as_dict(), "train": len(y_tr), "validation": len(y_va), "test": len(y_te)},
        "decision_tree_depth": best_depth,
        "pso": pso_info,
        "raw_features": RAW_FEATURES,
        "feature_ranges": ranges,
        "models": models_meta,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, default=lambda o: list(o) if isinstance(o, tuple) else str(o)))
    log.info("Wrote %d models and manifest to %s", len(models_meta), out)


if __name__ == "__main__":
    main()
