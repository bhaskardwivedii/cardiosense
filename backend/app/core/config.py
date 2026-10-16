"""Runtime settings, read from environment variables."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    app_name: str = "CardioSense"
    environment: str = os.getenv("ENVIRONMENT", "development")
    database_url: str = os.getenv("DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'cardiosense.db'}")
    secret_key: str = os.getenv("SECRET_KEY", "")
    access_token_minutes: int = int(os.getenv("ACCESS_TOKEN_MINUTES", "720"))
    models_dir: Path = Path(os.getenv("MODELS_DIR", str(BACKEND_DIR / "models")))
    static_dir: Path = Path(os.getenv("STATIC_DIR", str(BACKEND_DIR.parent / "frontend" / "dist")))
    admin_email: str = os.getenv("ADMIN_EMAIL", "admin@cardiosense.app")
    admin_password: str = os.getenv("ADMIN_PASSWORD", "ChangeMe!2026")
    allow_registration: bool = _bool("ALLOW_REGISTRATION", True)
    cors_origins: list[str] = field(default_factory=lambda: [
        o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()])
    max_batch_rows: int = int(os.getenv("MAX_BATCH_ROWS", "10000"))
    shap_background: int = int(os.getenv("SHAP_BACKGROUND", "40"))

    def __post_init__(self) -> None:
        if not self.secret_key:
            if self.environment == "production":
                raise RuntimeError("SECRET_KEY must be set in production")
            self.secret_key = secrets.token_urlsafe(48)  # dev only: tokens reset on restart
        # Render/Heroku style postgres URLs
        if self.database_url.startswith("postgres://"):
            self.database_url = self.database_url.replace("postgres://", "postgresql+psycopg://", 1)
        elif self.database_url.startswith("postgresql://"):
            self.database_url = self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)


settings = Settings()
