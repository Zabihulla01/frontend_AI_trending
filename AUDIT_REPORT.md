# Full Project Audit

Audit date: 2026-06-09

Scope: all tracked and untracked application source, configuration, assets, `package.json`, `package-lock.json`, installed packages, API integrations, trading logic, and production checks. Existing user code was not modified.

## Deployment Verdict

**SAFE TO DEPLOY = NO**

**Confidence: 94%**

| Area | Verdict | Reason |
|---|---|---|
| Legal | NO | Required TradingView Lightweight Charts attribution is absent; Binance commercial/redistribution rights are not established; no financial-risk disclaimer or terms/privacy disclosure exists. |
| Security | NO | Public proxy routes have no application rate limiting, request timeout, or abuse controls; security headers/CSP are absent. |
| Architecture | NO | WebSockets do not reconnect after Binance's mandatory disconnect; quality gates fail; duplicated indicator logic and disconnected modules increase operational risk. |
| Data Sources | NO | Binance is the sole live source, has no fallback, and its terms/regional availability have not been contractually cleared. |
| Dependencies | NO | `npm audit` reports two moderate vulnerabilities; required third-party notices are not shipped; test dependencies are missing. |

No hardcoded secrets, API keys, passwords, unsafe `eval`, raw HTML injection, unsafe dynamic import path, local/session storage leak, SQL/command injection, or circular dependency was found.

This is an engineering audit, not legal advice. Commercial-use conclusions that depend on provider contracts must be confirmed by qualified counsel and, where necessary, Binance.

## CRITICAL

No confirmed critical-severity issue was found.

## HIGH

### H-1: Live-candle repainting can create and reverse automated trade signals

- **File:** `components/analysis/AIAnalysis.tsx`
- **Line:** 434-461
- **Problem:** Every WebSocket update, including updates to an unclosed candle, is inserted into history and analyzed. The `isClosed` flag supplied by `createBinanceKlineSocket` is ignored. The chart does the same at `components/chart/TradingChart.tsx:620-630`.
- **Impact:** EMA crossover, RSI, MACD, support/resistance, confidence, and auto-trade decisions can change before candle close. Signals are repainting and are unsuitable as verified trading or backtest results.
- **Fix:** Separate provisional display candles from decision candles. Generate entries and update confirmed indicators only when `isClosed === true`; document any intrabar strategy explicitly and test it with tick/intrabar data.

### H-2: Trade outcomes use sampled close price instead of candle high/low

- **File:** `components/chart/TradingChart.tsx`
- **Line:** 746-767
- **Problem:** TP/SL is evaluated only against `latestPrice`, which is the throttled current close. Candle high and low are ignored.
- **Impact:** Stops and targets touched intrabar can be missed. If both are touched, execution order is unknowable. Displayed trade outcomes and any derived performance can be materially false.
- **Fix:** Evaluate closed-candle high/low with an explicit same-bar fill policy, or use trade/tick data. Include spread, slippage, fees, latency, and gap handling.

### H-3: Position sizing overstates executable size and profit

- **File:** `store/useRiskStore.ts`
- **Line:** 431-465
- **Problem:** `positionSize = maxLoss / priceDistance` assumes linear spot units and frictionless fills. It ignores fees, slippage, spread, leverage/liquidation, lot size, tick size, minimum notional, quote/base precision, and available balance.
- **Impact:** Users can be advised to take a position that risks more than selected, cannot be placed, or has overstated reward. This is direct financial and consumer-protection exposure.
- **Fix:** Model instrument metadata and execution costs, round down to exchange filters, cap by available capital/leverage, and label results as estimates until order-preview validation succeeds.

### H-4: Required Lightweight Charts attribution is absent

- **File:** `package.json`
- **Line:** 13
- **Problem:** The application uses TradingView Lightweight Charts, but no user-visible TradingView attribution/link or distributed NOTICE was found. Chart creation at `components/chart/TradingChart.tsx:336-368` does not provide an alternative attribution.
- **Impact:** Distribution may violate the library's Apache-2.0 NOTICE/attribution conditions and TradingView's documented link requirement.
- **Fix:** Add the required attribution notice and link to `https://www.tradingview.com/` on a user-visible page, retain applicable license/NOTICE text in distributions, and have counsel review trademark presentation.

### H-5: Binance proxy endpoints are publicly abusable

- **File:** `app/api/klines/route.ts`
- **Line:** 4-19
- **Problem:** Anonymous callers can cause Binance requests for many symbol/interval/limit combinations. There is no per-IP/user rate limit, request budget, bot control, concurrency limit, or bounded cache policy. `app/api/symbols/route.ts:4-20` is also unrestricted.
- **Impact:** Upstream bans, degraded service, unexpected hosting cost, cache pressure, and denial of service are possible.
- **Fix:** Add edge/gateway rate limiting, strict allowlists, quotas, bounded caching, monitoring, and a circuit breaker. Return `429` with retry guidance.

### H-6: Live streams permanently stop after provider disconnect

- **File:** `services/websocket.ts`
- **Line:** 51-137
- **Problem:** No `onclose`, reconnect, backoff, jitter, stale-data timer, or resubscription exists. Binance documents that a connection is valid for only 24 hours and can also shut down earlier.
- **Impact:** Charts, alerts, and automated analysis silently become stale or unusable until a component remount/page refresh.
- **Fix:** Implement one managed connection layer with reconnect/backoff, stale-state detection, 24-hour rotation, visibility/network handling, and subscription multiplexing.

### H-7: Financial product presentation lacks legal safeguards

- **File:** `app/layout.tsx`
- **Line:** 4-7
- **Problem:** The product is branded "AI Trader Dashboard" and emits `LONG`, `SHORT`, confidence, position-size, TP and SL outputs, but no risk warning, methodology disclosure, "not investment advice" notice, jurisdiction restriction, terms, or privacy notice was found.
- **Impact:** Marketing and automated recommendation behavior can create regulatory, consumer-protection, suitability, and liability exposure, especially if commercially offered.
- **Fix:** Obtain jurisdiction-specific legal review. Add accurate methodology/limitations, risk and performance disclaimers, terms/privacy, data-provider disclosure, and avoid claims that imply validated AI or guaranteed outcomes.

## MEDIUM

### M-1: Current dependency advisory remains unresolved

- **File:** `package-lock.json`
- **Line:** package entry `node_modules/next/node_modules/postcss`
- **Problem:** `npm audit` reports GHSA-qx2v-qp2m-jg93 in PostCSS `<8.5.10`, reached through Next.js 16.2.6. Total: 0 critical, 0 high, 2 moderate.
- **Impact:** XSS is possible if attacker-controlled CSS is stringified into a style context. Current application exposure appears limited, but the vulnerable package is shipped.
- **Fix:** Upgrade Next.js when it carries a fixed nested PostCSS version; verify with `npm audit`. Do not force the suggested downgrade to Next 9.3.3.

### M-2: No CSP or baseline production security headers

- **File:** `next.config.js`
- **Line:** 2-8
- **Problem:** No Content-Security-Policy, frame protection, referrer policy, permissions policy, HSTS plan, or MIME-sniffing protection is configured.
- **Impact:** A future injection defect has a larger blast radius; clickjacking and browser-policy weaknesses remain unmitigated.
- **Fix:** Add environment-appropriate response headers, beginning with a tested CSP and `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.

### M-3: Upstream requests have no timeout or response schema validation

- **File:** `services/binance.ts`
- **Line:** 60-75, 93-105
- **Problem:** Fetches can wait until platform timeout. Kline tuples are accepted by type assertion without validating length, types, ordering, OHLC consistency, or timestamps.
- **Impact:** Hung requests consume capacity; malformed/provider-changed data can contaminate indicators and recommendations.
- **Fix:** Use `AbortSignal.timeout`, validate payloads at runtime, reject non-finite/inconsistent candles, and log provider failures without exposing internals.

### M-4: Standalone TypeScript and ESLint quality gates fail

- **File:** `components/layout/Sidebar.test.tsx`
- **Line:** 1-7
- **Problem:** Testing Library and test-runner types/config are missing. `npx tsc --noEmit` fails. ESLint reports 7 errors and 14 warnings, including React Compiler memoization/effect errors in `TradingChart.tsx`.
- **Impact:** CI cannot reliably enforce correctness. A successful `next build` masks repository-wide test TypeScript failures.
- **Fix:** Add a supported test runner and dependencies/config or exclude test files intentionally; add `lint`, `typecheck`, and `test` scripts and make all pass in CI.

### M-5: No executable tests for financial calculations or data lifecycles

- **File:** `package.json`
- **Line:** 5-8
- **Problem:** No test script exists. The only test file targets a sidebar and cannot run. Indicators, sizing, signal gates, candle-close behavior, websocket cleanup, and API validation are untested.
- **Impact:** Small changes can silently alter financial outputs or create leaks and outages.
- **Fix:** Add deterministic unit/property tests with known indicator vectors, long/short fee-aware sizing cases, intrabar TP/SL cases, API abuse tests, and WebSocket reconnect/cleanup tests.

### M-6: Binance commercial and redistribution rights are not established

- **File:** `services/binance.ts`
- **Line:** 1, 59-63, 93-96
- **Problem:** Public market data is consumed and presented commercially-capable, but no contract, permission record, attribution rule, retention policy, or regional compliance decision is present.
- **Impact:** Terms, data redistribution, storage, branding, and geographic restrictions may block commercial launch even though endpoints are public and free to call.
- **Fix:** Obtain written legal/provider clearance for the exact product, users, regions, caching, derived analytics, and redistribution model. Preserve a dated terms review.

### M-7: Alerts and state are ephemeral and cannot be relied on operationally

- **File:** `store/useAlertStore.ts`
- **Line:** 36-124
- **Problem:** Alerts, history, trades, and watchlists exist only in memory. Closing/reloading the page loses them; background browser throttling and sleep interrupt monitoring.
- **Impact:** Users may believe an alert is durable when it is not, creating missed-action and support liability.
- **Fix:** Clearly label browser-only behavior or move monitoring to a durable server worker with persistence, delivery receipts, health checks, and user notification preferences.

### M-8: Client connects directly to Binance, creating privacy/regional exposure

- **File:** `services/websocket.ts`
- **Line:** 49, 58, 108
- **Problem:** End-user browsers disclose IP address and connection metadata directly to Binance. No privacy disclosure, consent analysis, region routing, or fallback endpoint exists.
- **Impact:** Privacy notices may be incomplete; regional blocking can break the product; users may unknowingly contact a third party.
- **Fix:** Disclose the third party and data flow, assess applicable privacy law, consider a licensed server-side feed, and implement region/error handling.

## LOW

### L-1: Audio contexts are never closed

- **File:** `components/alerts/AlertPanel.tsx`
- **Line:** 65-84
- **Problem:** Each alert creates a new `AudioContext` and never closes it.
- **Impact:** Repeated alerts can consume browser audio resources and eventually fail.
- **Fix:** Reuse one context or close it after playback completes.

### L-2: Duplicated indicator implementations can diverge

- **File:** `services/analysis.ts`
- **Line:** 98-155
- **Problem:** Momentum, EMA, and average-volume logic duplicate functions in `services/indicators.ts`.
- **Impact:** Fixes or formula changes can produce inconsistent chart and analysis results.
- **Fix:** Use one tested indicator implementation.

### L-3: Dead/disconnected code and unused package increase maintenance surface

- **File:** `package.json`
- **Line:** 12
- **Problem:** Axios is installed but unused. Multiple exported layout/analysis components are not reachable from `app/page.tsx`; ESLint also reports unused code.
- **Impact:** Larger dependency/maintenance surface and confusion over which UI is production behavior.
- **Fix:** Remove unused dependencies and archive or connect modules intentionally after confirming product requirements.

### L-4: Package roles are misclassified

- **File:** `package.json`
- **Line:** 11, 15
- **Problem:** Autoprefixer and direct PostCSS are build tooling but are listed as production dependencies.
- **Impact:** Production install surface and supply-chain exposure are larger than necessary.
- **Fix:** Move build-only tooling to `devDependencies` if the deployment model permits.

### L-5: Template/branded assets and screenshots have undocumented provenance

- **File:** `public/next.svg`
- **Line:** 1
- **Problem:** Next/Vercel logo assets, favicon, and dashboard screenshots are present without an asset manifest or publication decision.
- **Impact:** Accidental use as product branding or external marketing can create trademark/provenance questions.
- **Fix:** Remove unused template assets and record author/source/license for every shipped or published asset.

## Architecture Results

| Check | Result |
|---|---|
| Circular dependencies | No cycle found in the application import graph. |
| Memory/resource leaks | One AudioContext leak; chart observers/listeners and current timers are otherwise cleaned up. |
| WebSocket leaks | Cleanup exists on unmount/dependency change, but there is no reconnect, multiplexing, or stale detection. |
| Interval leaks | No application `setInterval` usage found. |
| Event-listener leaks | Chart resize listener and observer have cleanup. |
| Dead code | Unused Axios, unused local symbols, and several disconnected components found. |
| SSR/hydration | No confirmed hydration mismatch; browser APIs are inside client components/effects. |
| Build | `npm run build` passed on 2026-06-09. |
| TypeScript | Standalone `npx tsc --noEmit` failed because test tooling/types are absent and test code has errors. |
| ESLint | Failed with 7 errors and 14 warnings. |

## Trading Audit

| Check | Result |
|---|---|
| Future repainting | **FAIL:** unclosed live candles drive signals and auto-trades. |
| Lookahead bias | No explicit future-index access found; no real backtest engine exists to validate. |
| Backtest validity | **FAIL/NOT IMPLEMENTED:** trade status simulation is not a valid backtest and ignores intrabar path. |
| Target realism | **FAIL:** fixed ATR/RR targets omit execution constraints and costs. |
| Risk calculations | Basic arithmetic is internally consistent for a frictionless linear instrument, but is not exchange-executable risk sizing. |
| Probability/confidence | Heuristic scores are presented as percentages without calibration, validation dataset, out-of-sample testing, or uncertainty intervals. |

## External Data Sources

| Source | URL | Free/Paid | Commercial use | License/terms | Attribution | Rate/operational limits | Risk |
|---|---|---|---|---|---|---|---|
| Binance Spot REST klines | `https://api.binance.com/api/v3/klines` | Free, rate-limited | **Not cleared for this product** | Binance Terms and Spot API rules | Provider/terms review required | Request-weight/IP limits; application has no local quota | HIGH |
| Binance Spot REST exchange info | `https://api.binance.com/api/v3/exchangeInfo` | Free, rate-limited | **Not cleared for this product** | Binance Terms and Spot API rules | Provider/terms review required | Cached 1 hour, but public route remains unrestricted | MEDIUM |
| Binance Spot WebSocket kline | `wss://stream.binance.com:9443/ws/<symbol>@kline_<interval>` | Free, rate-limited | **Not cleared for this product** | Binance Terms and WebSocket rules | Provider/terms review required | 24-hour connection lifetime; 300 connection attempts/5 min/IP; no reconnect implemented | HIGH |
| Binance Spot WebSocket mini ticker | `wss://stream.binance.com:9443/ws/<symbol>@miniTicker` | Free, rate-limited | **Not cleared for this product** | Binance Terms and WebSocket rules | Provider/terms review required | Same connection limits; one socket per active symbol | HIGH |
| TradingView Lightweight Charts | `https://github.com/tradingview/lightweight-charts` | Free/open source | Allowed if license/NOTICE obligations are met | Apache-2.0 plus documented attribution/link requirement | **Missing** | Local rendering, no hosted TradingView data | HIGH until fixed |
| Static mock news | Local `components/layout/NewsTab.tsx` | Internal | Allowed only if text is internally authored | Project-owned/unknown provenance | None identified | Not live data; can be mistaken for current news | MEDIUM |

No TradingView Advanced Charts, proprietary Charting Library, hosted widget, or TradingView market-data service was found.

## Dependency and License Summary

- Lockfile packages examined: 445.
- License counts: MIT 355, Apache-2.0 32, ISC 17, MPL-2.0 13, LGPL-3.0-or-later 10, mixed Apache/LGPL 4, BSD-2-Clause 7, BSD-3-Clause 2, and one each of BlueOak-1.0.0, Python-2.0, CC-BY-4.0, CC0-1.0, and 0BSD.
- No AGPL, GPL-only, SSPL, BUSL, or declared commercial-only npm package was found.
- LGPL-family entries are optional Sharp/libvips platform binaries. Dynamic use is generally commercially compatible, but required notices, relinking rights, and source obligations must be handled by counsel/release engineering.
- No direct dependency appears abandoned. `lightweight-charts` 4.1.1 is substantially behind maintained 5.2.0; Axios is maintained but unused.

See `DEPENDENCY_REPORT.md` for the dependency-by-dependency result.

## Sources

- Binance Spot REST documentation: https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md
- Binance WebSocket documentation: https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md
- Binance Terms: https://www.binance.com/en/terms
- Lightweight Charts repository/license guidance: https://github.com/tradingview/lightweight-charts
- Lightweight Charts Apache license: https://github.com/tradingview/lightweight-charts/blob/master/LICENSE
- Lightweight Charts attribution documentation: https://tradingview.github.io/lightweight-charts/docs/5.1/api/interfaces/LayoutOptions
- npm advisory GHSA-qx2v-qp2m-jg93: https://github.com/advisories/GHSA-qx2v-qp2m-jg93
