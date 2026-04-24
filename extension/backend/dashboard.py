import streamlit as st
import requests
import pandas as pd
from datetime import datetime

st.set_page_config(
    page_title="Aegis AI - Risk Intel",
    page_icon="🛡️",
    layout="wide"
)

# Dark Theme Styles
st.markdown("""
<style>
    .main { background-color: #0e1117; }
    .stMetric { background-color: #1a1c24; padding: 15px; border-radius: 10px; border-left: 4px solid #00f2ff; }
    .risk-high { color: #ff4b4b; font-weight: bold; }
    .risk-med { color: #ffa500; font-weight: bold; }
    .risk-low { color: #00ff88; font-weight: bold; }
</style>
""", unsafe_allow_html=True)

st.title("🛡️ AEGIS AI: REAL-TIME INTELLIGENCE")

# Fetch Real Data
try:
    stats_response = requests.get("http://localhost:8000/stats")
    stats_data = stats_response.json()
except Exception:
    stats_data = {"total_scanned": 0, "threats_blocked": 0, "recent_history": []}
    st.error("⚠️ Connection to Aegis Scanner Engine failed. Please start main.py")

col1, col2, col3 = st.columns(3)
with col1:
    st.metric("Total Scanned", stats_data["total_scanned"])
with col2:
    st.metric("Threats Blocked", stats_data["threats_blocked"], delta_color="inverse")
with col3:
    safety_pct = 100 if stats_data["total_scanned"] == 0 else round((1 - stats_data["threats_blocked"]/stats_data["total_scanned"])*100, 1)
    st.metric("Safety Index", f"{safety_pct}%")

tabs = st.tabs(["Real-time History", "Manual Diagnostics", "System Health"])

with tabs[0]:
    st.subheader("Live Detection Logs")
    if stats_data["recent_history"]:
        df = pd.DataFrame(stats_data["recent_history"])
        df['time'] = pd.to_datetime(df['time']).dt.strftime('%H:%M:%S')
        st.table(df)
    else:
        st.info("No scan history found in database.")

with tabs[1]:
    st.subheader("Analyze Text Payload")
    msg = st.text_area("Input message for investigation:", height=100)
    if st.button("RUN ANALYSIS"):
        if msg:
            res = requests.post("http://localhost:8000/analyze", json={"text": msg}).json()
            st.divider()
            c1, c2 = st.columns(2)
            with c1:
                st.write(f"**Risk Level:** {res['risk_level']}")
                st.progress(res['score']/100)
            with c2:
                st.write("**Security Indicators:**")
                for r in res['reasons']:
                    st.write(f"- {r}")
        else:
            st.warning("Please enter text.")

with tabs[2]:
    st.subheader("Model Performance")
    st.json({
        "engine": "Aegis Heuristic v1.2",
        "database": "scam_detections.db",
        "last_sync": datetime.now().isoformat()
    })
