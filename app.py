import asyncio
import os
import re
import sys

# Ensure local project packages are importable on Render.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flask import Flask, jsonify, request, send_from_directory
from quotexpy import Quotex

app = Flask(__name__, static_folder="static", static_url_path="/static")
SYMBOL_RE = re.compile(r"^[A-Za-z0-9_#-]{1,40}$")
ALLOWED_TF = {5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600, 14400, 86400}

@app.get("/")
def index():
    return send_from_directory("static", "index.html")

@app.get("/favicon.ico")
def favicon():
    return ("", 204)

@app.get("/api/health")
def health():
    configured = bool(os.getenv("QUOTEX_EMAIL", "").strip() and os.getenv("QUOTEX_PASSWORD"))
    return jsonify({
        "status": "ok",
        "service": "quotex-render-adapter",
        "simulated_data": False,
        "credentials_configured": configured,
        "adapter_ready": True,
        "connection_verified": False,
        "note": "Connector code is installed. Credentials configured does not mean Quotex login or candle retrieval succeeded. A successful /api/candles response is required to verify live access."
    })

async def fetch_candles(symbol, timeframe, limit):
    email = os.getenv("QUOTEX_EMAIL", "").strip()
    password = os.getenv("QUOTEX_PASSWORD", "")
    if not email or not password:
        raise RuntimeError("Set QUOTEX_EMAIL and QUOTEX_PASSWORD in Render Environment.")
    client = Quotex(email=email, password=password)
    try:
        connected = await asyncio.wait_for(client.connect(), timeout=25)
        if not connected or not client.is_connected:
            raise RuntimeError("QuotexPy could not establish a connection. Check Render logs and account verification.")
        raw = await asyncio.wait_for(
            client.get_candles(symbol, offset=min(timeframe * limit, 86400), period=timeframe),
            timeout=20
        )
        if not raw:
            raise RuntimeError("No candles were returned for this symbol/timeframe.")
        # QuotexPy candle rows are normally [timestamp, open, close, high, low].
        normalized = []
        for item in raw:
            if isinstance(item, dict):
                row = item
                ts = row.get("time", row.get("timestamp", row.get("from")))
                op = row.get("open", row.get("o"))
                cl = row.get("close", row.get("c"))
                hi = row.get("high", row.get("max", row.get("h")))
                lo = row.get("low", row.get("min", row.get("l")))
            elif isinstance(item, (list, tuple)) and len(item) >= 5:
                ts, op, cl, hi, lo = item[:5]
            else:
                continue
            try:
                normalized.append({"time": int(float(ts)), "open": float(op), "close": float(cl), "high": float(hi), "low": float(lo)})
            except (TypeError, ValueError, OverflowError):
                continue
        # Reject impossible OHLC rows and duplicate timestamps before returning them.
        cleaned = {}
        for candle in normalized:
            o, c, h, l = candle["open"], candle["close"], candle["high"], candle["low"]
            if min(o, c, h, l) <= 0 or h < max(o, c, l) or l > min(o, c, h):
                continue
            cleaned[candle["time"]] = candle
        normalized = sorted(cleaned.values(), key=lambda candle: candle["time"])
        if not normalized:
            raise RuntimeError("Quotex returned no valid OHLC candle rows for this symbol/timeframe.")
        return normalized[-limit:]
    finally:
        try:
            ws = getattr(client, "websocket", None)
            if ws:
                ws.close()
        except Exception:
            pass

@app.get("/api/candles")
def candles():
    symbol = request.args.get("symbol", "EURUSD_otc")
    try:
        tf = int(request.args.get("tf", "60"))
        limit = int(request.args.get("limit", "100"))
    except ValueError:
        return jsonify({"error": "tf and limit must be integers", "simulated_data": False}), 400
    if not SYMBOL_RE.fullmatch(symbol):
        return jsonify({"error": "Invalid symbol", "simulated_data": False}), 400
    if tf not in ALLOWED_TF:
        return jsonify({"error": "Unsupported timeframe for this adapter.", "supported_timeframes_seconds": sorted(ALLOWED_TF), "simulated_data": False}), 400
    if not 20 <= limit <= 300:
        return jsonify({"error": "limit must be 20-300 for analysis", "simulated_data": False}), 400
    try:
        raw = asyncio.run(fetch_candles(symbol, tf, limit))
        return jsonify({"symbol": symbol, "timeframe_seconds": tf, "count": len(raw), "candles": raw, "source": "QuotexPy", "simulated_data": False})
    except Exception as exc:
        app.logger.exception("Live candle request failed")
        return jsonify({"error": "Live candle request failed. No simulated data was returned.", "detail": str(exc)[:250], "simulated_data": False}), 502

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "10000")))
