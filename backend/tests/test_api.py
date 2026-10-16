"""End-to-end API tests against the real trained models."""
import io
import os
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["SECRET_KEY"] = "test-secret-key-that-is-long-enough-for-hs256"
os.environ["ADMIN_EMAIL"] = "admin@test.io"
os.environ["ADMIN_PASSWORD"] = "AdminPass123"
os.environ["STATIC_DIR"] = f"{_tmp}/no-frontend"

import joblib  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

MODELS = Path(__file__).resolve().parents[1] / "models"
PATIENT = {"age": 55, "gender": "male", "height": 172, "weight": 88, "ap_hi": 145, "ap_lo": 92,
           "cholesterol": 2, "gluc": 1, "smoke": False, "alco": False, "active": True}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth(client, email="doc@test.io", name="Dr Test", password="Password123"):
    r = client.post("/api/auth/register", json={"email": email, "full_name": name, "password": password})
    if r.status_code == 409:
        r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code in (200, 201), r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_health_and_models(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["default_model"] == "dnn"
    m = client.get("/api/models").json()
    assert {x["key"] for x in m["models"]} == {"logreg", "tree", "forest", "dnn", "ae_dnn", "dnn_pso", "hybrid"}
    dnn = next(x for x in m["models"] if x["key"] == "dnn")
    assert abs(dnn["metrics"]["accuracy"] - 0.7346) < 0.002


def test_auth_required(client):
    assert client.post("/api/predict", json=PATIENT).status_code == 401
    assert client.get("/api/predictions").status_code == 401


def test_login_wrong_password(client):
    auth(client)
    r = client.post("/api/auth/login", json={"email": "doc@test.io", "password": "nope-nope"})
    assert r.status_code == 401


def test_predict_matches_model_and_shap_adds_up(client):
    h = auth(client)
    r = client.post("/api/predict", json={**PATIENT, "patient_ref": "P-1"}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    pipe = joblib.load(MODELS / "dnn.joblib")
    x = [55, 1, 172, 88, 145, 92, 2, 1, 0, 0, 1]
    assert abs(body["probability"] - pipe.predict_proba([x])[0, 1]) < 1e-9
    ex = body["explanation"]
    assert abs(ex["base_value"] + sum(c["shap"] for c in ex["contributions"]) - body["probability"]) < 1e-6
    assert body["risk_band"] == "Very high" and body["derived"]["bmi"] == 29.7
    assert body["recommendations"] and body["model_key"] == "dnn"


@pytest.mark.parametrize("key", ["logreg", "tree", "forest", "ae_dnn", "dnn_pso", "hybrid"])
def test_every_model_serves(client, key):
    r = client.post("/api/predict", json={**PATIENT, "model": key, "explain": False}, headers=auth(client))
    assert r.status_code == 200 and 0 <= r.json()["probability"] <= 1


def test_validation_errors(client):
    h = auth(client)
    assert client.post("/api/predict", json={**PATIENT, "ap_hi": 80, "ap_lo": 90}, headers=h).status_code == 422
    assert client.post("/api/predict", json={**PATIENT, "age": 7}, headers=h).status_code == 422
    assert client.post("/api/predict", json={**PATIENT, "model": "nope"}, headers=h).status_code == 400


def test_out_of_range_warning(client):
    r = client.post("/api/predict", json={**PATIENT, "age": 25, "explain": False}, headers=auth(client))
    assert any("Age" in w for w in r.json()["warnings"])


def test_compare(client):
    r = client.post("/api/predict/compare", json=PATIENT, headers=auth(client))
    assert r.status_code == 200 and len(r.json()) == 7


def test_history_report_and_isolation(client):
    h = auth(client)
    page = client.get("/api/predictions?limit=5", headers=h).json()
    assert page["total"] >= 1
    pid = page["items"][0]["id"]
    pdf = client.get(f"/api/predictions/{pid}/report", headers=h)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    other = auth(client, "other@test.io", "Dr Other")
    assert client.get(f"/api/predictions/{pid}", headers=other).status_code == 404
    assert client.get("/api/predictions", headers=other).json()["total"] == 0


def test_batch_upload_and_download(client):
    h = auth(client)
    csv = ("patient_ref,age,gender,height,weight,ap_hi,ap_lo,cholesterol,gluc,smoke,alco,active\n"
           "A,55,male,172,88,145,92,2,1,0,0,1\n"
           "B,43,female,160,61,118,76,1,1,0,0,1\n"
           "C,50,male,170,80,90,120,1,1,0,0,1\n")  # C has diastolic > systolic
    r = client.post("/api/batch", files={"file": ("cohort.csv", io.BytesIO(csv.encode()), "text/csv")},
                    data={"model": "forest"}, headers=h)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["n_rows"] == 3 and b["n_errors"] == 1 and b["errors"][0]["row"] == 4
    assert sum(b["band_counts"].values()) == 2
    d = client.get(f"/api/batch/{b['id']}/download", headers=h)
    assert d.status_code == 200 and "probability" in d.text and "not scored" in d.text
    # batch rows get explained on demand
    pid = b["preview"][0]["id"]
    assert client.get(f"/api/predictions/{pid}", headers=h).json()["explanation"] is not None


def test_batch_kaggle_format(client):
    csv = "id;age;gender;height;weight;ap_hi;ap_lo;cholesterol;gluc;smoke;alco;active\n0;18393;2;168;62;110;80;1;1;0;0;1\n"
    r = client.post("/api/batch", files={"file": ("k.csv", io.BytesIO(csv.encode()), "text/csv")},
                    headers=auth(client))
    assert r.status_code == 201 and r.json()["n_errors"] == 0


def test_batch_missing_columns(client):
    r = client.post("/api/batch", files={"file": ("x.csv", io.BytesIO(b"age,height\n50,170\n"), "text/csv")},
                    headers=auth(client))
    assert r.status_code == 400 and "Missing" in r.json()["detail"]


def test_admin(client):
    h = auth(client)
    assert client.get("/api/admin/users", headers=h).status_code == 403
    r = client.post("/api/auth/login", json={"email": "admin@test.io", "password": "AdminPass123"})
    ah = {"Authorization": f"Bearer {r.json()['access_token']}"}
    users = client.get("/api/admin/users", headers=ah).json()
    doc = next(u for u in users if u["email"] == "doc@test.io")
    assert client.patch(f"/api/admin/users/{doc['id']}", json={"is_active": False}, headers=ah).json()["is_active"] is False
    assert client.get("/api/auth/me", headers=h).status_code == 401  # deactivated user is locked out
    client.patch(f"/api/admin/users/{doc['id']}", json={"is_active": True}, headers=ah)
    assert client.get("/api/stats?scope=all", headers=ah).json()["total"] >= 1
