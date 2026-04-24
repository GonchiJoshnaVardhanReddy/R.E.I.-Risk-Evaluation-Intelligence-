from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd
import requests
import streamlit as st

BASE_DIR = Path(__file__).resolve().parent
DETECTION_LOG_PATH = BASE_DIR / "detection_log.json"
REPUTATION_DB_PATH = BASE_DIR / "reputation_db.json"
API_BASE = "http://127.0.0.1:8000"

SUPPORTED_UPLOAD_TYPES = ["txt", "pdf", "docx", "html", "eml"]
PLATFORM_BUCKETS = ["whatsapp", "email", "file", "dashboard"]
RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"]


def load_json_file(path: Path, default_value: Any) -> Any:
    if not path.exists():
        return default_value
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            return data if data is not None else default_value
    except (json.JSONDecodeError, OSError, ValueError, TypeError):
        return default_value


def platform_bucket(platform_value: str) -> str:
    platform = (platform_value or "").strip().lower()
    if platform.startswith("file"):
        return "file"
    if platform in {"whatsapp", "email", "dashboard"}:
        return platform
    return "other"


def show_risk_alert(risk_level: str, title: str) -> None:
    if risk_level == "HIGH":
        st.error(title)
    elif risk_level == "MEDIUM":
        st.markdown(
            """
            <div style="
                background-color: orange;
                color: white;
                padding: 10px;
                border-radius: 6px;
                font-weight: 600;
                margin-bottom: 8px;
            ">
                ⚠ Suspicious signal detected
            </div>
            """,
            unsafe_allow_html=True,
        )


def safe_api_post_json(endpoint: str, payload: dict[str, Any]) -> tuple[bool, dict[str, Any] | str]:
    try:
        response = requests.post(f"{API_BASE}{endpoint}", json=payload, timeout=45)
        if response.status_code != 200:
            return False, f"API error {response.status_code}: {response.text}"
        return True, response.json()
    except requests.RequestException as exc:
        return False, f"API connection failed: {exc}"


def safe_api_post_file(endpoint: str, filename: str, file_bytes: bytes) -> tuple[bool, dict[str, Any] | str]:
    try:
        response = requests.post(
            f"{API_BASE}{endpoint}",
            files={"file": (filename, file_bytes, "application/octet-stream")},
            timeout=90,
        )
        if response.status_code != 200:
            return False, f"API error {response.status_code}: {response.text}"
        return True, response.json()
    except requests.RequestException as exc:
        return False, f"API connection failed: {exc}"


def render_scan_result(result: dict[str, Any]) -> None:
    risk_score = result.get("risk_score", 0.0)
    risk_level = str(result.get("risk_level", "LOW")).upper()
    explanations = result.get("explanations", [])

    st.write(f"**risk_score:** {risk_score}")
    st.write(f"**risk_level:** {risk_level}")
    st.write("**explanations:**")
    if isinstance(explanations, list) and explanations:
        for item in explanations:
            st.write(f"- {item}")
    else:
        st.write("- No explanations returned.")

    show_risk_alert(risk_level, "⚠ HIGH RISK DETECTION" if risk_level == "HIGH" else "")


def build_detection_dataframe() -> pd.DataFrame:
    logs = load_json_file(DETECTION_LOG_PATH, [])
    if not isinstance(logs, list) or not logs:
        return pd.DataFrame(columns=["timestamp", "platform", "risk_level", "risk_score", "sender"])

    df = pd.DataFrame(logs)
    for col in ["timestamp", "platform", "risk_level", "risk_score", "sender"]:
        if col not in df.columns:
            df[col] = ""

    df["timestamp_dt"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df["risk_level"] = df["risk_level"].astype(str).str.upper()
    df["risk_score"] = pd.to_numeric(df["risk_score"], errors="coerce").fillna(0.0)
    df = df.sort_values(by="timestamp_dt", ascending=False)
    display_df = df[["timestamp", "platform", "risk_level", "risk_score", "sender"]].head(20).copy()
    return display_df


def style_detection_rows(row: pd.Series) -> list[str]:
    level = str(row.get("risk_level", "")).upper()
    if level == "HIGH":
        return ["background-color: #ffcccc"] * len(row)
    if level == "MEDIUM":
        return ["background-color: #ffe5cc"] * len(row)
    return [""] * len(row)


def build_reputation_dataframe() -> pd.DataFrame:
    rep_data = load_json_file(REPUTATION_DB_PATH, {})
    if not isinstance(rep_data, dict) or not rep_data:
        return pd.DataFrame(columns=["sender_id", "count", "risk_boost"])

    rows = []
    for sender_id, payload in rep_data.items():
        payload_dict = payload if isinstance(payload, dict) else {}
        rows.append(
            {
                "sender_id": sender_id,
                "count": int(payload_dict.get("count", 0)),
                "risk_boost": float(payload_dict.get("risk_boost", 0.0)),
            }
        )
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=["sender_id", "count", "risk_boost"])
    df = df.sort_values(by="count", ascending=False)
    return df


def style_reputation_rows(row: pd.Series) -> list[str]:
    if int(row.get("count", 0)) >= 3:
        return ["background-color: #fff3cd"] * len(row)
    return [""] * len(row)


def scanner_status_online() -> bool:
    try:
        response = requests.get(f"{API_BASE}/docs", timeout=4)
        return response.status_code == 200
    except requests.RequestException:
        return False


st.set_page_config(page_title="R.E.I. Threat Intelligence Dashboard", layout="wide")

st.title("R.E.I. Threat Intelligence Dashboard")
st.subheader("Offline Multi-Channel Scam Detection Monitor")

st.markdown("---")
st.header("SECTION 1: MANUAL MESSAGE SCAN")
manual_text = st.text_area("Paste message to analyze", height=120)
if st.button("Analyze Message", type="primary"):
    if not manual_text.strip():
        st.warning("Please paste a message before analyzing.")
    else:
        ok, response = safe_api_post_json(
            "/analyze-text",
            {"text": manual_text, "sender": "manual_input", "platform": "dashboard"},
        )
        if not ok:
            st.error(str(response))
        else:
            render_scan_result(response)  # type: ignore[arg-type]

st.markdown("---")
st.header("SECTION 2: FILE SCAN TOOL")
uploaded_file = st.file_uploader("Upload file for scan", type=SUPPORTED_UPLOAD_TYPES)
if uploaded_file is not None:
    content = uploaded_file.read()
    signature = f"{uploaded_file.name}:{len(content)}"
    if st.session_state.get("last_upload_signature") != signature:
        st.session_state["last_upload_signature"] = signature
        ok, response = safe_api_post_file("/analyze-file", uploaded_file.name, content)
        if not ok:
            st.error(str(response))
        else:
            result = response  # type: ignore[assignment]
            st.write(f"**filename:** {result.get('filename', uploaded_file.name)}")
            render_scan_result(result)

st.markdown("---")
st.header("SECTION 3: RECENT DETECTIONS TABLE")
detection_df = build_detection_dataframe()
if detection_df.empty:
    st.info("No detections available yet.")
else:
    styled_detection = detection_df.style.apply(style_detection_rows, axis=1)
    st.dataframe(styled_detection, use_container_width=True, hide_index=True)

st.markdown("---")
st.header("SECTION 4: PLATFORM BREAKDOWN CHART")
if detection_df.empty:
    platform_counts = pd.DataFrame({"platform": PLATFORM_BUCKETS, "count": [0, 0, 0, 0]})
else:
    full_logs = load_json_file(DETECTION_LOG_PATH, [])
    full_df = pd.DataFrame(full_logs) if isinstance(full_logs, list) else pd.DataFrame()
    if "platform" not in full_df.columns:
        full_df["platform"] = ""
    bucketed = full_df["platform"].astype(str).map(platform_bucket)
    counts = bucketed.value_counts().to_dict()
    platform_counts = pd.DataFrame(
        {"platform": PLATFORM_BUCKETS, "count": [int(counts.get(key, 0)) for key in PLATFORM_BUCKETS]}
    )
st.bar_chart(platform_counts.set_index("platform"))

st.markdown("---")
st.header("SECTION 5: RISK DISTRIBUTION PIE CHART")
if detection_df.empty:
    risk_counts = pd.DataFrame({"risk_level": RISK_LEVELS, "count": [0, 0, 0]})
else:
    full_logs = load_json_file(DETECTION_LOG_PATH, [])
    full_df = pd.DataFrame(full_logs) if isinstance(full_logs, list) else pd.DataFrame()
    if "risk_level" not in full_df.columns:
        full_df["risk_level"] = "LOW"
    normalized = full_df["risk_level"].astype(str).str.upper()
    counts = normalized.value_counts().to_dict()
    risk_counts = pd.DataFrame(
        {"risk_level": RISK_LEVELS, "count": [int(counts.get(key, 0)) for key in RISK_LEVELS]}
    )
pie_data = {
    "values": risk_counts.to_dict("records"),
    "mark": {"type": "arc", "innerRadius": 0},
    "encoding": {
        "theta": {"field": "count", "type": "quantitative"},
        "color": {
            "field": "risk_level",
            "type": "nominal",
            "scale": {"domain": RISK_LEVELS, "range": ["#8fd19e", "#ffb84d", "#ff6666"]},
        },
        "tooltip": [{"field": "risk_level"}, {"field": "count"}],
    },
}
st.vega_lite_chart(pie_data, use_container_width=True)

st.markdown("---")
st.header("SECTION 6: SENDER REPUTATION MEMORY TABLE")
reputation_df = build_reputation_dataframe()
if reputation_df.empty:
    st.info("No sender reputation data available yet.")
else:
    styled_reputation = reputation_df.style.apply(style_reputation_rows, axis=1)
    st.dataframe(styled_reputation, use_container_width=True, hide_index=True)

st.markdown("---")
st.header("SECTION 7: LIVE STATUS INDICATOR")
if scanner_status_online():
    st.success("Scanner Online")
else:
    st.error("Scanner Offline")
