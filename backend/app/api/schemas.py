"""Request/response models."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class PatientInput(BaseModel):
    """Clinical inputs for one patient. Ranges match the cleaned training data limits."""
    age: float = Field(..., ge=18, le=100, description="Age in years")
    gender: Literal["female", "male"]
    height: float = Field(..., ge=120, le=220, description="Height in cm")
    weight: float = Field(..., ge=30, le=200, description="Weight in kg")
    ap_hi: int = Field(..., ge=80, le=220, description="Systolic blood pressure, mmHg")
    ap_lo: int = Field(..., ge=40, le=160, description="Diastolic blood pressure, mmHg")
    cholesterol: Literal[1, 2, 3] = Field(..., description="1 normal, 2 above normal, 3 well above normal")
    gluc: Literal[1, 2, 3] = Field(..., description="1 normal, 2 above normal, 3 well above normal")
    smoke: bool
    alco: bool
    active: bool

    @model_validator(mode="after")
    def _bp_order(self):
        if self.ap_hi <= self.ap_lo:
            raise ValueError("Systolic pressure (ap_hi) must be higher than diastolic pressure (ap_lo)")
        return self

    def to_vector(self) -> list[float]:
        return [self.age, 1.0 if self.gender == "male" else 0.0, self.height, self.weight,
                float(self.ap_hi), float(self.ap_lo), float(self.cholesterol), float(self.gluc),
                float(self.smoke), float(self.alco), float(self.active)]

    model_config = ConfigDict(json_schema_extra={"example": {
        "age": 55, "gender": "male", "height": 172, "weight": 88, "ap_hi": 145, "ap_lo": 92,
        "cholesterol": 2, "gluc": 1, "smoke": False, "alco": False, "active": True}})


class PredictRequest(PatientInput):
    model: str | None = Field(None, description="Model key; defaults to the best model (dnn)")
    patient_ref: str | None = Field(None, max_length=80, description="Optional patient identifier or label")
    explain: bool = True


class Contribution(BaseModel):
    feature: str
    label: str
    value: float
    display_value: str
    shap: float


class Explanation(BaseModel):
    base_value: float
    contributions: list[Contribution]
    method: str


class PredictionOut(BaseModel):
    id: int
    patient_ref: str | None
    model_key: str
    model_name: str
    probability: float
    risk_band: str
    inputs: dict
    derived: dict
    explanation: Explanation | None
    warnings: list[str]
    recommendations: list[str]
    created_at: datetime


class PredictionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_ref: str | None
    model_key: str
    probability: float
    risk_band: str
    batch_id: int | None
    created_at: datetime
    inputs: dict


class PredictionPage(BaseModel):
    items: list[PredictionSummary]
    total: int


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=120)
    password: str = Field(..., min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserUpdate(BaseModel):
    role: Literal["clinician", "admin"] | None = None
    is_active: bool | None = None


class BatchOut(BaseModel):
    id: int
    filename: str
    model_key: str
    n_rows: int
    n_errors: int
    errors: list[dict]
    band_counts: dict[str, int]
    mean_probability: float | None
    preview: list[PredictionSummary]
    created_at: datetime
