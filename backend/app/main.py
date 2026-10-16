"""CardioSense API entry point. Serves the REST API under /api and the built React app at /."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from .api.routes import router
from .core.config import settings
from .core.db import SessionLocal, User, init_db
from .core.security import hash_password
from .ml.service import ModelService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("cardiosense")


def seed_admin() -> None:
    with SessionLocal() as db:
        if not db.scalar(select(User).where(User.role == "admin")):
            db.add(User(email=settings.admin_email.lower(), full_name="Administrator",
                        password_hash=hash_password(settings.admin_password), role="admin"))
            db.commit()
            log.warning("Created admin account %s - change ADMIN_PASSWORD in production", settings.admin_email)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_admin()
    app.state.models = ModelService(settings.models_dir, settings.shap_background)
    yield


app = FastAPI(title="CardioSense API", version="1.0.0", lifespan=lifespan,
              description="Cardiovascular disease risk prediction with explainable machine learning.",
              docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(router)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Internal server error"}, status_code=500)


# Serve the single-page app (built frontend) when present.
if settings.static_dir.exists():
    assets = settings.static_dir / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        candidate = (settings.static_dir / path).resolve()
        if path and candidate.is_file() and settings.static_dir.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(settings.static_dir / "index.html")
