"""HTTP API routes."""
from __future__ import annotations

import io
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.db import Batch, Prediction, User, get_db
from ..core.security import (create_access_token, get_current_user, hash_password, require_admin,
                             verify_password)
from ..ml.features import RAW_FEATURES
from ..ml.service import ModelService, derived_values, recommendations, risk_band
from .report import build_report
from .schemas import (BatchOut, LoginRequest, PatientInput, PredictionOut, PredictionPage,
                      PredictionSummary, PredictRequest, TokenOut, UserCreate, UserOut, UserUpdate)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")
BANDS = ["Low", "Moderate", "High", "Very high"]


def get_service(request: Request) -> ModelService:
    return request.app.state.models


def _model_or_400(svc: ModelService, key: str | None):
    try:
        return svc.resolve(key)
    except KeyError:
        raise HTTPException(400, f"Unknown model '{key}'. Available: {', '.join(svc.meta)}")


def _to_out(p: Prediction, svc: ModelService) -> PredictionOut:
    x = [p.inputs[f] if f != "gender" else (1.0 if p.inputs["gender"] == "male" else 0.0) for f in RAW_FEATURES]
    x = [float(v) for v in x]
    name = svc.meta[p.model_key]["name"] if p.model_key in svc.meta else p.model_key
    return PredictionOut(id=p.id, patient_ref=p.patient_ref, model_key=p.model_key, model_name=name,
                         probability=p.probability, risk_band=p.risk_band, inputs=p.inputs,
                         derived=derived_values(x), explanation=p.explanation, warnings=p.warnings or [],
                         recommendations=recommendations(x, p.risk_band), created_at=p.created_at)


def _owned_prediction(db: Session, user: User, pred_id: int) -> Prediction:
    p = db.get(Prediction, pred_id)
    if not p or (p.user_id != user.id and user.role != "admin"):
        raise HTTPException(404, "Prediction not found")
    return p


# ---------------------------------------------------------------- health & models
@router.get("/health", tags=["system"])
def health(svc: ModelService = Depends(get_service)):
    return {"status": "ok", "models_available": list(svc.meta), "default_model": svc.default_key}


@router.get("/models", tags=["models"])
def list_models(svc: ModelService = Depends(get_service)):
    m = svc.manifest
    return {"default": svc.default_key, "dataset": m["dataset"], "pso": m["pso"],
            "decision_tree_depth": m["decision_tree_depth"], "feature_ranges": m["feature_ranges"],
            "models": svc.public_models()}


# ---------------------------------------------------------------- auth
@router.post("/auth/register", response_model=TokenOut, status_code=201, tags=["auth"])
def register(body: UserCreate, db: Session = Depends(get_db)):
    if not settings.allow_registration:
        raise HTTPException(403, "Self-registration is disabled; ask an administrator for an account")
    if db.scalar(select(User).where(func.lower(User.email) == body.email.lower())):
        raise HTTPException(409, "An account with this email already exists")
    user = User(email=body.email.lower(), full_name=body.full_name.strip(),
                password_hash=hash_password(body.password), role="clinician")
    db.add(user)
    db.commit()
    return TokenOut(access_token=create_access_token(user), user=UserOut.model_validate(user))


def _authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(func.lower(User.email) == email.lower()))
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    if not user.is_active:
        raise HTTPException(403, "This account has been deactivated")
    return user


@router.post("/auth/login", response_model=TokenOut, tags=["auth"])
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = _authenticate(db, body.email, body.password)
    return TokenOut(access_token=create_access_token(user), user=UserOut.model_validate(user))


@router.post("/auth/token", tags=["auth"], include_in_schema=False)
def token(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """OAuth2 password flow, used by the interactive /docs page."""
    user = _authenticate(db, form.username, form.password)
    return {"access_token": create_access_token(user), "token_type": "bearer"}


@router.get("/auth/me", response_model=UserOut, tags=["auth"])
def me(user: User = Depends(get_current_user)):
    return user


# ---------------------------------------------------------------- single prediction
@router.post("/predict", response_model=PredictionOut, tags=["predictions"])
def predict(body: PredictRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user),
            svc: ModelService = Depends(get_service)):
    model = _model_or_400(svc, body.model)
    x = body.to_vector()
    prob = float(svc.predict_proba(model.key, [x])[0])
    band = risk_band(prob)
    explanation = svc.explain(model.key, x) if body.explain else None
    inputs = PatientInput.model_validate(body.model_dump()).model_dump()
    p = Prediction(user_id=user.id, patient_ref=body.patient_ref, model_key=model.key, inputs=inputs,
                   probability=prob, risk_band=band, explanation=explanation, warnings=svc.warnings_for(x))
    db.add(p)
    db.commit()
    return _to_out(p, svc)


@router.post("/predict/compare", tags=["predictions"])
def compare(body: PatientInput, user: User = Depends(get_current_user), svc: ModelService = Depends(get_service)):
    """Score one patient with every model (nothing is saved)."""
    x = body.to_vector()
    out = []
    for k, m in svc.meta.items():
        prob = float(svc.predict_proba(k, [x])[0])
        out.append({"model_key": k, "model_name": m["name"], "probability": prob,
                    "risk_band": risk_band(prob), "test_accuracy": m["metrics"]["accuracy"],
                    "test_auc": m["metrics"]["auc"], "default": k == svc.default_key})
    return out


# ---------------------------------------------------------------- batch
COLUMN_ALIASES = {"sex": "gender", "systolic": "ap_hi", "sbp": "ap_hi", "diastolic": "ap_lo", "dbp": "ap_lo",
                  "glucose": "gluc", "smoking": "smoke", "alcohol": "alco", "physical_activity": "active",
                  "patient": "patient_ref", "patient_id": "patient_ref", "id": "patient_ref"}
TRUE = {"1", "true", "yes", "y", "t"}
FALSE = {"0", "false", "no", "n", "f"}


def _parse_row(row: dict) -> PatientInput:
    r = dict(row)
    g = str(r.get("gender", "")).strip().lower()
    r["gender"] = {"m": "male", "male": "male", "2": "male", "2.0": "male",
                   "f": "female", "female": "female", "1": "female", "1.0": "female"}.get(g, g)
    for b in ("smoke", "alco", "active"):
        v = str(r.get(b, "")).strip().lower()
        r[b] = True if v in TRUE or v == "1.0" else False if v in FALSE or v == "0.0" else v
    for n in ("cholesterol", "gluc", "ap_hi", "ap_lo"):
        try:
            r[n] = int(float(r[n]))
        except (KeyError, TypeError, ValueError):
            pass
    try:
        if float(r.get("age", 0)) > 150:  # Kaggle file stores age in days
            r["age"] = float(r["age"]) / 365.25
    except (TypeError, ValueError):
        pass
    return PatientInput.model_validate(r)


@router.get("/batch/template", tags=["batch"])
def batch_template():
    csv = ("patient_ref,age,gender,height,weight,ap_hi,ap_lo,cholesterol,gluc,smoke,alco,active\n"
           "P-001,55,male,172,88,145,92,2,1,0,0,1\n"
           "P-002,43,female,160,61,118,76,1,1,0,0,1\n")
    return Response(csv, media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=cardiosense_template.csv"})


@router.post("/batch", response_model=BatchOut, status_code=201, tags=["batch"])
async def batch_predict(file: UploadFile = File(...), model: str | None = Form(None),
                        db: Session = Depends(get_db), user: User = Depends(get_current_user),
                        svc: ModelService = Depends(get_service)):
    m = _model_or_400(svc, model)
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 10 MB)")
    try:
        text = raw.decode("utf-8-sig")
        sep = ";" if text.splitlines()[0].count(";") > text.splitlines()[0].count(",") else ","
        df = pd.read_csv(io.StringIO(text), sep=sep, dtype=str, keep_default_na=False)
    except Exception:
        raise HTTPException(400, "Could not read the file as CSV")
    df.columns = [COLUMN_ALIASES.get(c.strip().lower(), c.strip().lower()) for c in df.columns]
    missing = [c for c in RAW_FEATURES if c not in df.columns]
    if missing:
        raise HTTPException(400, f"Missing required columns: {', '.join(missing)}")
    if len(df) == 0:
        raise HTTPException(400, "The file has no data rows")
    if len(df) > settings.max_batch_rows:
        raise HTTPException(400, f"Too many rows ({len(df)}); the limit is {settings.max_batch_rows}")

    valid, errors = [], []
    for i, row in enumerate(df.to_dict(orient="records"), start=2):  # row 1 is the header
        try:
            valid.append((row.get("patient_ref") or None, _parse_row(row)))
        except ValidationError as e:
            msg = "; ".join(f"{'.'.join(str(l) for l in er['loc']) or 'row'}: {er['msg']}" for er in e.errors())
            errors.append({"row": i, "patient_ref": row.get("patient_ref") or None, "error": msg})

    batch = Batch(user_id=user.id, filename=(file.filename or "upload.csv")[:255], model_key=m.key,
                  n_rows=len(df), n_errors=len(errors), errors=errors[:500])
    db.add(batch)
    db.flush()
    preds: list[Prediction] = []
    if valid:
        X = np.array([p.to_vector() for _, p in valid])
        probs = svc.predict_proba(m.key, X)
        for (ref, pin), x, prob in zip(valid, X, probs):
            preds.append(Prediction(user_id=user.id, batch_id=batch.id, patient_ref=(ref or None) and str(ref)[:80],
                                    model_key=m.key, inputs=pin.model_dump(), probability=float(prob),
                                    risk_band=risk_band(float(prob)), explanation=None,
                                    warnings=svc.warnings_for(list(x))))
        db.add_all(preds)
    db.commit()
    return _batch_out(batch, preds)


def _batch_out(batch: Batch, preds: list[Prediction]) -> BatchOut:
    counts = Counter(p.risk_band for p in preds)
    ranked = sorted(preds, key=lambda p: -p.probability)
    return BatchOut(id=batch.id, filename=batch.filename, model_key=batch.model_key, n_rows=batch.n_rows,
                    n_errors=batch.n_errors, errors=batch.errors or [],
                    band_counts={b: counts.get(b, 0) for b in BANDS},
                    mean_probability=float(np.mean([p.probability for p in preds])) if preds else None,
                    preview=[PredictionSummary.model_validate(p) for p in ranked[:100]],
                    created_at=batch.created_at)


@router.get("/batch", tags=["batch"])
def list_batches(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = select(Batch).order_by(Batch.created_at.desc()).limit(50)
    if user.role != "admin":
        q = q.where(Batch.user_id == user.id)
    return [{"id": b.id, "filename": b.filename, "model_key": b.model_key, "n_rows": b.n_rows,
             "n_errors": b.n_errors, "created_at": b.created_at} for b in db.scalars(q)]


@router.get("/batch/{batch_id}", response_model=BatchOut, tags=["batch"])
def get_batch(batch_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    b = db.get(Batch, batch_id)
    if not b or (b.user_id != user.id and user.role != "admin"):
        raise HTTPException(404, "Batch not found")
    preds = list(db.scalars(select(Prediction).where(Prediction.batch_id == b.id)))
    return _batch_out(b, preds)


@router.get("/batch/{batch_id}/download", tags=["batch"])
def download_batch(batch_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    b = db.get(Batch, batch_id)
    if not b or (b.user_id != user.id and user.role != "admin"):
        raise HTTPException(404, "Batch not found")
    preds = db.scalars(select(Prediction).where(Prediction.batch_id == b.id).order_by(Prediction.id))
    rows = [{"patient_ref": p.patient_ref, **p.inputs, "probability": round(p.probability, 4),
             "risk_band": p.risk_band, "model": p.model_key, "notes": " | ".join(p.warnings or [])} for p in preds]
    rows += [{"patient_ref": e.get("patient_ref"), "notes": f"Row {e['row']} not scored: {e['error']}"}
             for e in (b.errors or [])]
    out = pd.DataFrame(rows).convert_dtypes().to_csv(index=False)
    name = b.filename.rsplit(".", 1)[0] + "_scored.csv"
    return Response(out, media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={name}"})


# ---------------------------------------------------------------- history & reports
@router.get("/predictions", response_model=PredictionPage, tags=["predictions"])
def list_predictions(limit: int = Query(25, ge=1, le=200), offset: int = Query(0, ge=0),
                     risk_band_filter: str | None = Query(None, alias="risk_band"),
                     q: str | None = Query(None, max_length=80), batch_id: int | None = None,
                     scope: str = Query("mine", pattern="^(mine|all)$"),
                     db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cond = []
    if scope == "mine" or user.role != "admin":
        cond.append(Prediction.user_id == user.id)
    if risk_band_filter:
        cond.append(Prediction.risk_band == risk_band_filter)
    if q:
        cond.append(Prediction.patient_ref.ilike(f"%{q}%"))
    if batch_id is not None:
        cond.append(Prediction.batch_id == batch_id)
    total = db.scalar(select(func.count(Prediction.id)).where(*cond)) or 0
    items = db.scalars(select(Prediction).where(*cond).order_by(Prediction.created_at.desc(), Prediction.id.desc())
                       .limit(limit).offset(offset))
    return PredictionPage(items=[PredictionSummary.model_validate(p) for p in items], total=total)


@router.get("/predictions/{pred_id}", response_model=PredictionOut, tags=["predictions"])
def get_prediction(pred_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user),
                   svc: ModelService = Depends(get_service)):
    p = _owned_prediction(db, user, pred_id)
    if p.explanation is None and p.model_key in svc.meta:  # batch rows: explain on demand
        x = [float(1.0 if p.inputs["gender"] == "male" else 0.0) if f == "gender" else float(p.inputs[f])
             for f in RAW_FEATURES]
        p.explanation = svc.explain(p.model_key, x)
        db.commit()
    return _to_out(p, svc)


@router.delete("/predictions/{pred_id}", status_code=204, tags=["predictions"])
def delete_prediction(pred_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(_owned_prediction(db, user, pred_id))
    db.commit()


@router.get("/predictions/{pred_id}/report", tags=["predictions"])
def prediction_report(pred_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user),
                      svc: ModelService = Depends(get_service)):
    out = get_prediction(pred_id, db, user, svc)
    pdf = build_report(out.model_dump(), user.full_name)
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=cardiosense_report_{pred_id}.pdf"})


@router.get("/stats", tags=["predictions"])
def stats(scope: str = Query("mine", pattern="^(mine|all)$"), db: Session = Depends(get_db),
          user: User = Depends(get_current_user)):
    cond = [] if (scope == "all" and user.role == "admin") else [Prediction.user_id == user.id]
    total = db.scalar(select(func.count(Prediction.id)).where(*cond)) or 0
    by_band = dict(db.execute(select(Prediction.risk_band, func.count()).where(*cond)
                              .group_by(Prediction.risk_band)).all())
    mean_p = db.scalar(select(func.avg(Prediction.probability)).where(*cond))
    since = datetime.now(timezone.utc) - timedelta(days=13)
    recent = db.scalars(select(Prediction.created_at).where(*cond, Prediction.created_at >= since.replace(
        hour=0, minute=0, second=0, microsecond=0)))
    per_day = Counter(d.date().isoformat() for d in recent)
    days = [(since + timedelta(days=i)).date().isoformat() for i in range(14)]
    latest = db.scalars(select(Prediction).where(*cond).order_by(Prediction.created_at.desc()).limit(6))
    return {"total": total, "by_band": {b: by_band.get(b, 0) for b in BANDS},
            "mean_probability": float(mean_p) if mean_p is not None else None,
            "high_risk": by_band.get("High", 0) + by_band.get("Very high", 0),
            "per_day": [{"date": d, "count": per_day.get(d, 0)} for d in days],
            "latest": [PredictionSummary.model_validate(p) for p in latest]}


# ---------------------------------------------------------------- admin
@router.get("/admin/users", response_model=list[UserOut], tags=["admin"])
def admin_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return list(db.scalars(select(User).order_by(User.created_at)))


@router.get("/admin/overview", tags=["admin"])
def admin_overview(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    rows = db.execute(select(User.id, func.count(Prediction.id)).join(Prediction, isouter=True)
                      .group_by(User.id)).all()
    return {"users": db.scalar(select(func.count(User.id))), "predictions": db.scalar(select(func.count(Prediction.id))),
            "batches": db.scalar(select(func.count(Batch.id))), "per_user": {uid: n for uid, n in rows}}


@router.patch("/admin/users/{user_id}", response_model=UserOut, tags=["admin"])
def admin_update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db),
                      admin: User = Depends(require_admin)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    if u.id == admin.id and (body.role == "clinician" or body.is_active is False):
        raise HTTPException(400, "You cannot demote or deactivate your own account")
    if body.role is not None:
        u.role = body.role
    if body.is_active is not None:
        u.is_active = body.is_active
    db.commit()
    return u
