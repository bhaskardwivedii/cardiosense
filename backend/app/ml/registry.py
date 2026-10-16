"""The seven model pipelines compared in the research paper."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

from .autoencoder import AutoencoderEncoder
from .features import FeatureBuilder

SEED = 42
MANUAL_DNN = {"hidden_layer_sizes": (64, 32), "learning_rate_init": 1e-3, "alpha": 1e-4, "batch_size": 256}

# PSO-selected configurations reported in the paper (Table 7). `train.py --run-pso`
# re-runs the search instead of using these.
PAPER_PSO_RAW = {"hidden_layer_sizes": (48,), "learning_rate_init": 0.01,
                 "alpha": 6.58239996526255e-06, "batch_size": 256}
PAPER_PSO_AE = {"hidden_layer_sizes": (93, 66, 62), "learning_rate_init": 0.000190586420071297,
                "alpha": 0.004011797956619872, "batch_size": 256}


def mlp(config: dict, seed: int = SEED) -> MLPClassifier:
    return MLPClassifier(activation="relu", solver="adam", max_iter=200, early_stopping=True,
                         validation_fraction=0.1, n_iter_no_change=10, random_state=seed, **config)


def _base(*steps) -> Pipeline:
    return Pipeline([("features", FeatureBuilder()), ("scale", StandardScaler()), *steps])


@dataclass(frozen=True)
class ModelSpec:
    key: str
    name: str
    family: str
    description: str
    build: Callable[..., Pipeline]


MODEL_SPECS: dict[str, ModelSpec] = {
    "logreg": ModelSpec("logreg", "Logistic Regression", "Classical ML",
                        "L2-regularised linear model on the 13 standardised features.",
                        lambda **kw: _base(("clf", LogisticRegression(max_iter=2000)))),
    "tree": ModelSpec("tree", "Decision Tree", "Classical ML",
                      "Single CART tree; depth chosen on the validation set.",
                      lambda depth=5, **kw: _base(("clf", DecisionTreeClassifier(max_depth=depth, random_state=SEED)))),
    "forest": ModelSpec("forest", "Random Forest", "Classical ML",
                        "300 trees, minimum 5 samples per leaf.",
                        lambda **kw: _base(("clf", RandomForestClassifier(n_estimators=300, min_samples_leaf=5,
                                                                          n_jobs=-1, random_state=SEED)))),
    "dnn": ModelSpec("dnn", "Deep Neural Network", "Deep learning",
                     "64-32 ReLU network, hand-chosen hyperparameters. Best model in the study.",
                     lambda **kw: _base(("clf", mlp(MANUAL_DNN)))),
    "ae_dnn": ModelSpec("ae_dnn", "Autoencoder + DNN", "Hybrid (ablation)",
                        "DNN on the 8-unit autoencoder code, manual configuration.",
                        lambda **kw: _base(("encoder", AutoencoderEncoder()), ("clf", mlp(MANUAL_DNN)))),
    "dnn_pso": ModelSpec("dnn_pso", "DNN + PSO", "Hybrid (ablation)",
                         "DNN on the 13 features with PSO-tuned hyperparameters.",
                         lambda config=PAPER_PSO_RAW, **kw: _base(("clf", mlp(config)))),
    "hybrid": ModelSpec("hybrid", "Hybrid (AE + DNN + PSO)", "Hybrid",
                        "Full proposed framework: autoencoder features, PSO-tuned DNN.",
                        lambda config=PAPER_PSO_AE, **kw: _base(("encoder", AutoencoderEncoder()), ("clf", mlp(config)))),
}

DEFAULT_MODEL = "dnn"
