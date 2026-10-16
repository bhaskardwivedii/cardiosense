"""Particle Swarm Optimization over DNN hyperparameters (Kennedy & Eberhart, 1995;
linearly decreasing inertia after Shi & Eberhart, 1998)."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from sklearn.metrics import accuracy_score

log = logging.getLogger(__name__)

# Particle dimensions: [n_layers 1-3, units1, units2, units3 (8-128),
#                       log10 lr (-4..-2), log10 alpha (-6..-2), log2 batch (6..9)]
LOWER = np.array([1, 8, 8, 8, -4, -6, 6], dtype=float)
UPPER = np.array([3.999, 128, 128, 128, -2, -2, 9.999], dtype=float)


def decode(position: np.ndarray) -> dict:
    n_layers = int(position[0])
    units = tuple(int(round(u)) for u in position[1:1 + n_layers])
    return {
        "hidden_layer_sizes": units,
        "learning_rate_init": float(10 ** position[4]),
        "alpha": float(10 ** position[5]),
        "batch_size": int(2 ** int(position[6])),
    }


@dataclass
class PSOResult:
    best_config: dict
    best_score: float
    history_best: list[float] = field(default_factory=list)
    history_mean: list[float] = field(default_factory=list)


def pso_search(make_model: Callable[[dict], object], X_train, y_train, X_val, y_val,
               n_particles: int = 12, iterations: int = 12, w_start: float = 0.9,
               w_end: float = 0.4, c1: float = 1.5, c2: float = 1.5,
               subset: int = 20000, seed: int = 42) -> PSOResult:
    """Maximise validation accuracy of `make_model(config)` trained on a fixed subset."""
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(y_train), size=min(subset, len(y_train)), replace=False)
    Xs, ys = X_train[idx], y_train[idx]

    def fitness(p: np.ndarray) -> float:
        model = make_model(decode(p)).fit(Xs, ys)
        return 1.0 - accuracy_score(y_val, model.predict(X_val))

    pos = rng.uniform(LOWER, UPPER, size=(n_particles, len(LOWER)))
    vel = np.zeros_like(pos)
    pbest, pval = pos.copy(), np.array([fitness(p) for p in pos])
    g, gval = pbest[pval.argmin()].copy(), float(pval.min())
    result = PSOResult({}, 0.0, [1 - gval], [float(1 - pval.mean())])
    vmax = (UPPER - LOWER) * 0.3

    for it in range(iterations):
        w = w_start - (w_start - w_end) * it / max(1, iterations - 1)
        r1, r2 = rng.random(pos.shape), rng.random(pos.shape)
        vel = np.clip(w * vel + c1 * r1 * (pbest - pos) + c2 * r2 * (g - pos), -vmax, vmax)
        pos = np.clip(pos + vel, LOWER, UPPER)
        vals = np.array([fitness(p) for p in pos])
        improved = vals < pval
        pbest[improved], pval[improved] = pos[improved], vals[improved]
        if pval.min() < gval:
            gval, g = float(pval.min()), pbest[pval.argmin()].copy()
        result.history_best.append(1 - gval)
        result.history_mean.append(float(1 - vals.mean()))
        log.info("PSO iter %d/%d best val acc %.4f %s", it + 1, iterations, 1 - gval, decode(g))

    result.best_config, result.best_score = decode(g), 1 - gval
    return result
