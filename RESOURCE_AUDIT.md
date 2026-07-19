# Resource Audit

Date: 2026-06-01

Scope: npm packages, APIs, assets, and external services currently present in the frontend project.

## NPM Packages

| Name | License | Commercial safe? | Free? | Risk level |
|---|---|---:|---:|---|
| react | MIT | Yes | Yes | LOW |
| react-dom | MIT | Yes | Yes | LOW |
| next | MIT | Yes | Yes | LOW |
| zustand | MIT | Yes | Yes | LOW |
| lightweight-charts | Apache-2.0 | Yes, with license notice retention | Yes | LOW |
| axios | MIT | Yes | Yes | LOW |
| tailwindcss | MIT | Yes | Yes | LOW |
| @tailwindcss/postcss | MIT | Yes | Yes | LOW |
| postcss | MIT | Yes | Yes | LOW |
| autoprefixer | MIT | Yes | Yes | LOW |
| typescript | Apache-2.0 | Yes | Yes | LOW |
| eslint | MIT | Yes | Yes | LOW |
| eslint-config-next | MIT | Yes | Yes | LOW |
| @types/node | MIT | Yes | Yes | LOW |
| @types/react | MIT | Yes | Yes | LOW |
| @types/react-dom | MIT | Yes | Yes | LOW |

## APIs

| Name | License | Commercial safe? | Free? | Risk level |
|---|---|---:|---:|---|
| Binance Spot REST API: `https://api.binance.com/api/v3/klines` | Binance API/platform terms | Review for commercial redistribution/storage | Yes, rate-limited | MEDIUM |
| Binance Spot REST API: `https://api.binance.com/api/v3/exchangeInfo` | Binance API/platform terms | Review for commercial redistribution/storage | Yes, rate-limited | MEDIUM |
| Internal Next API: `/api/klines` | Own project code | Yes | Yes | LOW |
| Internal Next API: `/api/symbols` | Own project code | Yes | Yes | LOW |

## Assets

| Name | License | Commercial safe? | Free? | Risk level |
|---|---|---:|---:|---|
| `app/favicon.ico` | Create Next App template asset / unknown generated favicon provenance | Review before public commercial launch | Yes | MEDIUM |
| `public/next.svg` | Next.js/Vercel trademarked logo asset | Only for nominative/reference use; avoid product branding | Yes | MEDIUM |
| `public/vercel.svg` | Vercel trademarked logo asset | Only for nominative/reference use; avoid product branding | Yes | MEDIUM |
| `public/file.svg` | Create Next App template asset | Yes if used as generic template icon | Yes | LOW |
| `public/globe.svg` | Create Next App template asset | Yes if used as generic template icon | Yes | LOW |
| `public/window.svg` | Create Next App template asset | Yes if used as generic template icon | Yes | LOW |
| Inline SVG icons in React components | Own project UI paths | Yes | Yes | LOW |
| System fonts: Arial, Helvetica, SFMono, Consolas | System font licenses | Yes for normal system-font use | Yes | LOW |
| Static mock news text in `NewsTab` | Own project content | Yes, if internally authored | Yes | LOW |
| Root dashboard screenshots: `dashboard-*.png` | Local generated screenshots / provenance not fully documented | Review before publishing externally | N/A | MEDIUM |

## External Services

| Name | License | Commercial safe? | Free? | Risk level |
|---|---|---:|---:|---|
| Binance WebSocket Streams: `wss://stream.binance.com:9443/ws` | Binance API/platform terms | Review for commercial redistribution/storage | Yes, rate-limited | MEDIUM |
| TradingView Lightweight Charts package | Apache-2.0 | Yes, with license notice retention | Yes | LOW |
| TradingView Advanced Charts | Proprietary | Not used; requires separate license if added | Restricted | HIGH if introduced without license |
| TradingView Trading Platform | Proprietary | Not used; requires separate license if added | Restricted | HIGH if introduced without license |
| TradingView widgets / hosted market data | Proprietary service terms | Not used; requires terms review if added | Restricted | HIGH if introduced without review |

## Verification

| Check | Result |
|---|---|
| No proprietary TradingView libraries | PASS: only `lightweight-charts` is used. It is Apache-2.0. |
| No copyrighted assets | REVIEW: no referenced third-party copyrighted app assets were found, but template/trademark assets exist in `public/` and `app/favicon.ico`. |
| No unknown license packages | PASS: all top-level npm packages have MIT or Apache-2.0 licenses. |

## Flags

### LOW

- MIT and Apache-2.0 npm dependencies.
- `lightweight-charts` as an open-source package, provided license notices are retained.
- Internal APIs and own inline SVG icons.
- System font stack.

### MEDIUM

- Binance REST and WebSocket market data because commercial redistribution, storage, and regional restrictions should be reviewed before production.
- `app/favicon.ico`, `public/next.svg`, and `public/vercel.svg` because they are template/branded assets and should not be used as product branding.
- Root dashboard screenshots because provenance is not documented for external publication.

### HIGH

- TradingView Advanced Charts, Trading Platform, widgets, or TradingView-hosted market data if introduced without a separate license/terms review.

## Final Verdict

REVIEW REQUIRED

Reason: package licensing is safe for development, and no proprietary TradingView library is currently used. However, Binance market data terms and template/branded assets should be reviewed before commercial release or public redistribution.
