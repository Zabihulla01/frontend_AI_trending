# Current Implementation Status

This note reflects the current repository state. Older audit and phase documents are historical records and may describe files or checks that no longer exist.

## Verified

- ESLint passes.
- TypeScript typecheck passes.
- Next.js production build passes.
- Analysis uses completed candles for signal updates.
- `Wait` is preserved as a non-trade state when applying a plan.
- Selected symbol/timeframe is used consistently by the summary panels.
- Kline streams are shared between chart and analysis subscribers.
- Stale WebSocket streams close and reconnect with backoff.
- API query limits, request rates, upstream payloads, and response errors are guarded.

## Important limitations

- Rate limiting is in-memory and per process. Production deployments should enforce a distributed limit at the edge or gateway.
- Binance data is external and may be delayed, unavailable, or subject to provider limits.
- Position sizing is advisory and does not apply exchange-specific tick size, lot size, fees, or slippage.
- Confidence and probability values are heuristic scores, not statistically calibrated probabilities.
- Position monitoring runs in the browser for the currently selected symbol and timeframe; it is not an exchange-connected execution service.
