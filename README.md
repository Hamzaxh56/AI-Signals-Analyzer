# AI Market Signals V3

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Root Directory: empty
- Runtime: Node

## Fixed
- OHLC candlesticks are rendered from the returned market candles.
- Price and candles come from the same market response.
- Generate Signal requests fresh market data and recalculates the technical signal.
- WebSocket reconnects automatically.
- Better market-feed timeout/error handling.
- No OTCharts key required.

## Important
This uses public market data, not an exact Quotex/OTC feed. Public feeds can be delayed and signals are not guaranteed predictions.
