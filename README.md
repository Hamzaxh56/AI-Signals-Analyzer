# Quotex Style AI Analyzer V5.3 — Trade Signal Dashboard

Render deployment:
- Build: `npm install`
- Start: `npm start`

Features:
- Separate 1-minute and 5-minute technical signals.
- Trade cards show direction (BUY/SELL/WAIT), confidence, entry price, expiry and countdown.
- Quotex current-price synchronization endpoint: `POST /api/quotex-sync` with `{symbol, price, timestamp}`.
- No Quotex password, cookies, or session tokens are collected.
- Historical candles/indicators use the public Biquote feed unless an authorized Quotex data integration supplies them.

Important: This project does not claim that a third-party feed is an exact Quotex quote. Exact Quotex/OTC quotes require an authorized Quotex data integration. Signals are technical analysis only and are not guaranteed. Trades are manual; the app does not place trades in a Quotex account.
