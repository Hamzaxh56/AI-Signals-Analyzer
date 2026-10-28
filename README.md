# Quotex AI Signal Analyzer — Render build v2

Responsive technical-analysis dashboard for returned QuotexPy candles. Includes candlestick/Heikin Ashi display, EMA 9/21 trend, RSI, MACD, ATR, timeframe selection, signal-alignment score, and manual local win/loss records. It does not place trades.

## Render
- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn --bind 0.0.0.0:$PORT app:app` (or `python app.py`)
- Root directory: blank when files are at repository root.

## Environment
Set `QUOTEX_EMAIL` and `QUOTEX_PASSWORD` in Render Environment only. Do not commit credentials or send them in chat.

## Verify live data
1. `/api/health` confirms the web service is running, not that login works.
2. Test `/api/candles?symbol=EURUSD_otc&tf=60&limit=30`. Success requires real OHLC rows and `simulated_data: false`.
3. Compare timestamps and prices against Quotex. Community library compatibility can break when Quotex changes its private protocol.
4. Test on demo first. The alignment score is not a probability or verified win rate; no 90% win rate is promised.

Supported candle timeframe seconds: 5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600, 14400, 86400. No 0.5-second candles.
