# Frontend Cleanup Report

## Verification

- `npm.cmd run lint`: passed
- `npm.cmd run build`: passed

## Dependency Tree

```text
app/page.tsx
  components/analysis/AIAnalysis.tsx
    services/binance.ts
    services/analysis.ts
      services/indicators.ts
      services/scoring.ts
        services/indicators.ts
        store/useRiskStore.ts
    services/websocket.ts
      services/binance.ts
    store/useAnalysisStore.ts
    store/useMarketStore.ts
    store/useRiskStore.ts
    store/useTradeStore.ts
  components/analysis/CompactAIPanel.tsx
    store/useAnalysisStore.ts
  components/chart/TradingChart.tsx
    services/binance.ts
    services/indicators.ts
    services/websocket.ts
    store/useIndicatorStore.ts
    store/useMarketStore.ts
    store/useRiskStore.ts
    store/useTradeStore.ts
  components/layout/ChartContainer.tsx
    components/layout/ChartContainer.module.css
  components/layout/Header.tsx
    store/useMarketStore.ts
    components/layout/Header.module.css
  components/layout/MarketSummary.tsx
    store/useAnalysisStore.ts
  components/layout/MarketStatsRow.tsx
    store/useIndicatorStore.ts
  components/layout/NewsTab.tsx
    components/analysis/SentimentBadge.tsx
    components/analysis/ImpactScore.tsx
  components/layout/TradeSetupPanel.tsx
    store/useRiskStore.ts
    components/layout/TradeSetupPanel.module.css
  components/watchlist/Watchlist.tsx
    components/watchlist/SymbolSearch.tsx
    store/useMarketStore.ts
```

## Removed Files

These files were not reachable from `app/page.tsx`, `app/layout.tsx`, or API routes:

- `components/alerts/AlertPanel.tsx`
- `components/analysis/CryptoHeatmap.tsx`
- `components/analysis/HeatMeter.tsx`
- `components/analysis/ProbabilityBar.tsx`
- `components/analysis/TradeQualityGauge.tsx`
- `components/layout/AnalysisTab.tsx`
- `components/layout/BottomTabs.tsx`
- `components/layout/ChartToolbar.tsx`
- `components/layout/ChartToolbar.module.css`
- `components/layout/CollapsibleAlerts.tsx`
- `components/layout/DashboardLayout.tsx`
- `components/layout/DashboardLayout.module.css`
- `components/layout/FloatingTools.tsx`
- `components/layout/IndicatorGrid.tsx`
- `components/layout/MiniToolbar.tsx`
- `components/layout/PortfolioTab.tsx`
- `components/layout/RiskTab.tsx`
- `components/layout/SearchCard.tsx`
- `components/layout/Sidebar.test.tsx`
- `components/layout/Sidebar.tsx`
- `components/layout/Sidebar.module.css`
- `components/layout/SidebarBadge.tsx`
- `components/layout/SidebarItem.tsx`
- `components/layout/SidebarPanels.tsx`
- `components/layout/SidebarPanels.module.css`
- `components/layout/SignalsTab.tsx`
- `components/layout/TopToolbar.tsx`
- `components/layout/TradePanel.tsx`
- `components/layout/TradePanel.module.css`
- `components/layout/TradeTab.tsx`
- `components/risk/RiskCalculator.tsx`
- `services/alerts.ts`
- `services/websocketManager.ts`
- `store/useAlertStore.ts`
- `store/useLatencyDiagnosticsStore.ts`
- `store/useSidebarStore.ts`
- `store/useSocketStatusStore.ts`

## Removed Imports And Dead Code

- Removed `useLatencyDiagnosticsStore` and `MarketDataStatus` imports from `components/chart/TradingChart.tsx`.
- Removed unused `IndicatorSnapshot` and `createAtrTradePlan` imports from `components/chart/TradingChart.tsx`.
- Removed unused `MarketTrendState` import from `components/analysis/AIAnalysis.tsx`.
- Removed unused helpers from `AIAnalysis.tsx`: `getMarketTrendBadgeClasses`, `getStrengthLabel`, and `displayMarketTrend`.
- Removed temporary chart diagnostics UI and render/latency measurement state updates.
- Removed temporary `console.info("TradeSetup Result")` logging from `store/useRiskStore.ts`.
- Removed temporary `chartOnly` / `doNotAnalyze` constants from the live candle handler.

## Refactored Components

- `TradingChart.tsx`
  - Removed diagnostic-store subscriptions that caused extra render updates.
  - Kept Binance history fetch, websocket updates, chart rendering, indicators, trade lifecycle checks, and risk-store synchronization intact.
  - Narrowly documented existing effect-based state synchronization for React Hooks lint compatibility.
- `ChartContainer.tsx`
  - Replaced `React.FC<React.PropsWithChildren<{}>>` with `PropsWithChildren`.
- `AIAnalysis.tsx`
  - Removed unused market-trend display code without changing displayed metrics.

## Stores And Services

- Removed unreferenced services: `services/alerts.ts`, `services/websocketManager.ts`.
- Removed unreferenced stores: `useAlertStore`, `useLatencyDiagnosticsStore`, `useSidebarStore`, `useSocketStatusStore`.
- Remaining `services/` and `store/` files are referenced by the current application graph.

## Bundle Size Improvements

- Removed 37 orphan source files from the build graph or lint surface.
- Removed chart diagnostics subscriptions and UI, reducing client component work per render.
- Next 16 build output in this project did not emit per-route JavaScript byte totals, so exact before/after bundle byte deltas are not available from the final command output.

## Remaining Technical Debt

- `TradingChart.tsx` is still a large component with chart setup, data loading, websocket handling, risk synchronization, and trade display in one file. It would benefit from future extraction into focused hooks once behavior tests exist.
- React Hooks `set-state-in-effect` suppressions remain around intentional synchronization effects in `TradingChart.tsx`; replacing them safely would require a deeper chart state-machine refactor.
- There is no dedicated test runner script for component behavior; current verification is lint plus production build.
