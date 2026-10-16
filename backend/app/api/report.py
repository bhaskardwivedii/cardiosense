"""Per-patient PDF risk report (ReportLab)."""
from __future__ import annotations

import io
from datetime import datetime

from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle)

BAND_COLORS = {"Low": colors.HexColor("#2e7d5b"), "Moderate": colors.HexColor("#b7791f"),
               "High": colors.HexColor("#c2410c"), "Very high": colors.HexColor("#b42318")}
INK = colors.HexColor("#1f2933")
MUTED = colors.HexColor("#616e7c")
RULE = colors.HexColor("#d9dee4")
UP = colors.HexColor("#c2410c")
DOWN = colors.HexColor("#2b6cb0")


def _risk_bar(prob: float, band: str, width: float = 170 * mm) -> Drawing:
    d = Drawing(width, 34)
    segs = [(0.0, 0.30, "#e3f1ea"), (0.30, 0.50, "#fbf0d9"), (0.50, 0.70, "#fde4d6"), (0.70, 1.0, "#f9d6d3")]
    for a, b, c in segs:
        d.add(Rect(a * width, 10, (b - a) * width, 12, fillColor=colors.HexColor(c), strokeColor=None))
    for a, label in [(0.0, "0%"), (0.30, "30%"), (0.50, "50%"), (0.70, "70%"), (1.0, "100%")]:
        d.add(String(min(a * width, width - 18), 0, label, fontSize=7, fontName="Helvetica", fillColor=MUTED))
    x = prob * width
    d.add(Line(x, 6, x, 26, strokeColor=BAND_COLORS.get(band, INK), strokeWidth=2.5))
    return d


def _shap_chart(contribs: list[dict], width: float = 170 * mm) -> Drawing:
    rows = contribs[:8]
    h = 18 * len(rows) + 10
    d = Drawing(width, h)
    label_w, mid = 52 * mm, 52 * mm + (width - 52 * mm - 30 * mm) / 2
    scale_max = max(abs(c["shap"]) for c in rows) or 1
    half = (width - 52 * mm - 30 * mm) / 2
    d.add(Line(mid, 0, mid, h, strokeColor=RULE))
    for i, c in enumerate(rows):
        y = h - 16 - i * 18
        d.add(String(0, y + 2, f"{c['label']} = {c['display_value']}", fontSize=8, fontName="Helvetica", fillColor=INK))
        w = abs(c["shap"]) / scale_max * half
        x = mid if c["shap"] >= 0 else mid - w
        d.add(Rect(x, y, w, 10, fillColor=UP if c["shap"] >= 0 else DOWN, strokeColor=None))
        sign = "+" if c["shap"] >= 0 else "-"
        d.add(String(mid + half + 6, y + 2, f"{sign}{abs(c['shap']) * 100:.1f} pts", fontSize=8, fontName="Helvetica", fillColor=MUTED))
    return d


def build_report(pred: dict, user_name: str) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                            topMargin=18 * mm, bottomMargin=18 * mm,
                            title=f"CardioSense risk report #{pred['id']}", author="CardioSense")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=18, textColor=INK, alignment=0, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12, textColor=INK, spaceBefore=10, spaceAfter=4)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=9.5, leading=13, textColor=INK)
    small = ParagraphStyle("s", parent=body, fontSize=8, leading=11, textColor=MUTED)
    band = pred["risk_band"]
    created = pred["created_at"]
    created_s = created.strftime("%d %b %Y, %H:%M UTC") if isinstance(created, datetime) else str(created)

    story = [Paragraph("CardioSense &middot; Cardiovascular risk report", h1),
             Paragraph(f"Report #{pred['id']} &nbsp;|&nbsp; Patient: {pred.get('patient_ref') or 'not specified'}"
                       f" &nbsp;|&nbsp; Generated {created_s} by {user_name}", small),
             Spacer(1, 8)]

    pct = pred["probability"] * 100
    big = ParagraphStyle("big", parent=body, leading=30)
    story += [Paragraph(f"<font size=22 color='{BAND_COLORS.get(band, INK).hexval()}'><b>{pct:.0f}%</b></font>"
                        f"&nbsp;&nbsp;<font size=13><b>{band} risk</b></font>", big),
              Spacer(1, 4),
              Paragraph(f"Estimated probability of cardiovascular disease from the {pred['model_name']} model.", small),
              Spacer(1, 4), _risk_bar(pred["probability"], band)]

    inp, der = pred["inputs"], pred["derived"]
    rows = [["Age", f"{inp['age']:.0f} years", "Systolic / diastolic BP", f"{inp['ap_hi']} / {inp['ap_lo']} mmHg"],
            ["Sex", inp["gender"].capitalize(), "Pulse pressure", f"{der['pulse_pressure']:.0f} mmHg"],
            ["Height / weight", f"{inp['height']:.0f} cm / {inp['weight']:.1f} kg", "BMI", f"{der['bmi']:.1f} kg/m<super>2</super>"],
            ["Cholesterol", ["Normal", "Above normal", "Well above normal"][inp["cholesterol"] - 1],
             "Glucose", ["Normal", "Above normal", "Well above normal"][inp["gluc"] - 1]],
            ["Smoking", "Yes" if inp["smoke"] else "No", "Alcohol intake", "Yes" if inp["alco"] else "No"],
            ["Physically active", "Yes" if inp["active"] else "No", "", ""]]
    cell = ParagraphStyle("cell", parent=body, fontSize=9, leading=11)
    rows = [[Paragraph(str(c), cell) if "<super>" in str(c) else c for c in r] for r in rows]
    t = Table(rows, colWidths=[35 * mm, 50 * mm, 40 * mm, 45 * mm])
    t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                           ("TEXTCOLOR", (0, 0), (0, -1), MUTED), ("TEXTCOLOR", (2, 0), (2, -1), MUTED),
                           ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story += [Paragraph("Patient measurements", h2), t]

    if pred.get("explanation"):
        ex = pred["explanation"]
        story += [KeepTogether([
            Paragraph("What drives this estimate", h2),
            Paragraph(f"Average risk across reference patients is {ex['base_value'] * 100:.0f}%. Bars show how many "
                      "percentage points each measurement adds (orange) or removes (blue) for this patient "
                      "(Kernel SHAP).", small),
            Spacer(1, 6), _shap_chart(ex["contributions"])])]

    if pred.get("warnings"):
        story += [Paragraph("Reliability notes", h2)] + [Paragraph(f"&bull; {w}", body) for w in pred["warnings"]]

    story += [Paragraph("Suggested follow-up", h2)] + [Paragraph(f"&bull; {r}", body) for r in pred["recommendations"]]
    story += [Spacer(1, 14), Paragraph(
        "This report is produced by a machine-learning model trained on 68,576 examination records "
        "(test accuracy about 73%, AUC 0.80). It is a decision-support aid for qualified clinicians, not a "
        "diagnosis, and must be interpreted together with clinical judgement.", small)]
    doc.build(story)
    return buf.getvalue()
