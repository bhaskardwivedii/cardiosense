"""Autoencoder feature extractor usable as a scikit-learn pipeline step."""
from __future__ import annotations

import numpy as np
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.neural_network import MLPRegressor


class AutoencoderEncoder(BaseEstimator, TransformerMixin):
    """Trains a symmetric autoencoder (d -> hidden -> latent -> hidden -> d) and
    outputs the latent code. The decoder is used only during fit.
    """

    def __init__(self, hidden: int = 32, latent: int = 8, learning_rate: float = 1e-3,
                 batch_size: int = 256, max_iter: int = 200, random_state: int = 42):
        self.hidden = hidden
        self.latent = latent
        self.learning_rate = learning_rate
        self.batch_size = batch_size
        self.max_iter = max_iter
        self.random_state = random_state

    def fit(self, X, y=None):
        X = np.asarray(X, dtype=float)
        self.autoencoder_ = MLPRegressor(
            hidden_layer_sizes=(self.hidden, self.latent, self.hidden),
            activation="relu", solver="adam", learning_rate_init=self.learning_rate,
            batch_size=self.batch_size, max_iter=self.max_iter, early_stopping=True,
            n_iter_no_change=10, random_state=self.random_state,
        )
        self.autoencoder_.fit(X, X)
        self.n_features_in_ = X.shape[1]
        return self

    def transform(self, X):
        h = np.asarray(X, dtype=float)
        for W, b in zip(self.autoencoder_.coefs_[:2], self.autoencoder_.intercepts_[:2]):
            h = np.maximum(0.0, h @ W + b)
        return h

    def reconstruction_mse(self, X) -> float:
        X = np.asarray(X, dtype=float)
        return float(np.mean((self.autoencoder_.predict(X) - X) ** 2))

    def get_feature_names_out(self, input_features=None):
        return np.array([f"z{i}" for i in range(self.latent)])
