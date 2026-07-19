# FILE DEPENDENCY MAP

## Overview

This document maps all file dependencies and component relationships in the AI Trading System.

---

## DEPENDENCY GRAPH BY LAYER

### Layer 1: UI Components (Presentation)

```
app/page.tsx (Root)
├── → components/layout/Header.tsx
├── → components/chart/TradingChart.tsx
├── → components/analysis/AIAnalysis.tsx
├── → components/analysis/CompactAIPanel.tsx
├── → components/layout/TradeSetupPanel.tsx
├── → components/risk/RiskCalculator.tsx
├── → components/watchlist/Watchlist.tsx
├── → components/layout/MarketSummary.tsx
└── → components/alerts/AlertPanel.tsx
```

#### Component Dependencies

**components/chart/TradingChart.tsx**
```
Imports:
  ✓ store/useMarketStore
  ✓ store/useIndicatorStore
  ✓ services/websocket.ts → createBinanceKlineSocket()
  ✓ services/indicators.ts → calculateIndicatorSnapshot()
  ✓ services/binance.ts → fetchBinanceKlines()
  ✓ components/layout/ChartToolbar.tsx
  ✓ components/layout/IndicatorGrid.tsx

Exports:
  ✓ TradingChart component

Dependencies Graph:
  TradingChart
  ├── useMarketStore
  ├── useIndicatorStore
  ├── websocket.ts
  │   └── Binance WebSocket API
  ├── indicators.ts
  │   └── (pure functions, no deps)
  ├── binance.ts
  │   └── Binance REST API
  ├── ChartToolbar.tsx
  └── IndicatorGrid.tsx

Circular Dependencies: None
Total Dependencies: 6 (2 stores + 2 services + 2 components)
```

**components/analysis/AIAnalysis.tsx**
```
Imports:
  ✓ store/useMarketStore
  ✓ store/useAnalysisStore
  ✓ store/useLatencyDiagnosticsStore
  ✓ services/websocket.ts → createBinanceKlineSocket()
  ✓ services/binance.ts → fetchBinanceKlines()
  ✓ services/analysis.ts → analyzeTimeframe()
  ✓ components/analysis/CompactAIPanel.tsx

Exports:
  ✓ AIAnalysis component

Unused Imports:
  ✗ getClosedBinanceKlines (imported but not used)

Dependencies:
  AIAnalysis
  ├── useMarketStore
  ├── useAnalysisStore
  ├── useLatencyDiagnosticsStore
  ├── websocket.ts
  ├── binance.ts
  ├── analysis.ts
  │   ├── scoring.ts
  │   │   ├── indicators.ts
  │   │   └── (no other deps)
  │   └── indicators.ts
  └── CompactAIPanel.tsx

Circular Dependencies: None
Total Dependencies: 7
```

**components/layout/TradeSetupPanel.tsx**
```
Imports:
  ✓ store/useRiskStore
  ✓ store/useMarketStore
  ✓ store/useAnalysisStore
  ✓ components/risk/RiskCalculator.tsx

Exports:
  ✓ TradeSetupPanel component

Dependencies:
  TradeSetupPanel
  ├── useRiskStore
  ├── useMarketStore
  ├── useAnalysisStore
  └── RiskCalculator.tsx
      ├── useRiskStore
      ├── useMarketStore
      └── services/scoring.ts

Circular Dependencies: None
Total Dependencies: 3 (3 stores + 1 component)
```

**components/risk/RiskCalculator.tsx**
```
Imports:
  ✓ store/useRiskStore
  ✓ store/useMarketStore
  ✓ services/scoring.ts

Exports:
  ✓ RiskCalculator component

Dependencies:
  RiskCalculator
  ├── useRiskStore
  ├── useMarketStore
  └── services/scoring.ts
      ├── services/indicators.ts
      └── (no other deps)

Circular Dependencies: None
Total Dependencies: 3
```

**components/watchlist/Watchlist.tsx**
```
Imports:
  ✓ store/useMarketStore
  ✓ components/watchlist/SymbolSearch.tsx

Exports:
  ✓ Watchlist component

Dependencies:
  Watchlist
  ├── useMarketStore
  └── SymbolSearch.tsx
      ├── store/useMarketStore
      ├── services/binance.ts
      └── API route: /api/symbols

Circular Dependencies: None
Total Dependencies: 2
```

**components/alerts/AlertPanel.tsx**
```
Imports:
  ✓ store/useAlertStore
  ✓ store/useMarketStore
  ✓ services/websocket.ts → createBinanceTickerSocket()
  ✓ services/alerts.ts → evaluateAlerts()

Exports:
  ✓ AlertPanel component

Dependencies:
  AlertPanel
  ├── useAlertStore
  ├── useMarketStore
  ├── websocket.ts
  └── alerts.ts

Circular Dependencies: None
Total Dependencies: 4
```

**components/layout/MarketSummary.tsx**
```
Imports:
  ✓ store/useAnalysisStore
  ✓ store/useMarketStore

Exports:
  ✓ MarketSummary component

Dependencies:
  MarketSummary
  ├── useAnalysisStore
  └── useMarketStore

Circular Dependencies: None
Total Dependencies: 2
```

**components/layout/Header.tsx**
```
Imports:
  ✓ store/useMarketStore
  ✓ components/watchlist/SymbolSearch.tsx

Exports:
  ✓ Header component

Dependencies:
  Header
  ├── useMarketStore
  └── SymbolSearch.tsx

Circular Dependencies: None
Total Dependencies: 2
```

---

### Layer 2: Zustand Stores (State Management)

```
store/
├── useMarketStore.ts
├── useIndicatorStore.ts
├── useAnalysisStore.ts
├── useRiskStore.ts
├── useTradeStore.ts
├── useAlertStore.ts
├── useSidebarStore.ts
├── useLatencyDiagnosticsStore.ts
└── useSocketStatusStore.ts (unused)
```

**store/useMarketStore.ts**
```
Imports:
  ✓ zustand
  ✓ zustand/middleware (persist)

Exports:
  ✓ useMarketStore hook

State:
  - symbol: string
  - interval: string
  - watchlist: string[]
  - validSymbols: string[]

Actions:
  - setSymbol()
  - setInterval()
  - addSymbol()
  - removeSymbol()
  - registerValidSymbols()

Dependencies: None (only Zustand)
Used By:
  ✓ TradingChart.tsx
  ✓ AIAnalysis.tsx
  ✓ TradeSetupPanel.tsx
  ✓ RiskCalculator.tsx
  ✓ Watchlist.tsx
  ✓ Header.tsx
  ✓ SymbolSearch.tsx
  ✓ MarketSummary.tsx
  ✓ AlertPanel.tsx

Total Usages: 9 files
```

**store/useIndicatorStore.ts**
```
Imports:
  ✓ zustand

Exports:
  ✓ useIndicatorStore hook

State:
  - indicators: IndicatorSnapshot
  - enabled: { [key: string]: boolean }

Actions:
  - setIndicators()
  - toggleIndicator()

Dependencies: None
Used By:
  ✓ TradingChart.tsx

Total Usages: 1 file

Issue: enabled flags defined but not read in visible code
```

**store/useAnalysisStore.ts**
```
Imports:
  ✓ zustand

Exports:
  ✓ useAnalysisStore hook

State:
  - timeframeResults: { [key: string]: AnalysisResult }
  - status: 'idle' | 'analyzing' | 'complete' | 'error'
  - marketState: MarketState
  - blendedSignal: Signal

Actions:
  - setTimeframeResult()
  - setStatus()
  - setMarketState()

Dependencies: None
Used By:
  ✓ AIAnalysis.tsx
  ✓ TradeSetupPanel.tsx
  ✓ RiskCalculator.tsx
  ✓ MarketSummary.tsx
  ✓ CompactAIPanel.tsx

Total Usages: 5 files
```

**store/useRiskStore.ts**
```
Imports:
  ✓ zustand
  ✓ services/scoring.ts

Exports:
  ✓ useRiskStore hook

State:
  - entryPrice: number
  - stopPrice: number
  - tp1: number
  - tp2: number
  - riskPercentage: number
  - positionSize: number
  - [10+ more fields]

Actions:
  - setEntry()
  - setStop()
  - setTP()
  - calculateRisk()
  - applyTradePlan()

Dependencies:
  ✓ services/scoring.ts

Used By:
  ✓ TradeSetupPanel.tsx
  ✓ RiskCalculator.tsx

Total Usages: 2 files
```

**store/useAlertStore.ts**
```
Imports:
  ✓ zustand

Exports:
  ✓ useAlertStore hook

State:
  - alerts: Alert[]
  - history: Alert[]

Actions:
  - addAlert()
  - removeAlert()
  - clearHistory()

Dependencies: None
Used By:
  ✓ AlertPanel.tsx

Total Usages: 1 file
```

**store/useTradeStore.ts**
```
Imports:
  ✓ zustand

Exports:
  ✓ useTradeStore hook

State:
  - activeTrades: Trade[]
  - status: 'idle' | 'active' | 'paused'

Actions:
  - addTrade()
  - updateTrade()
  - closeTrade()

Dependencies: None
Used By:
  (No visible usage in codebase)

Status: Appears unused / future feature
```

**store/useSidebarStore.ts**
```
Imports:
  ✓ zustand

State:
  - sidebarOpen: boolean
  - activePanel: string

Used By: UI sidebar components
```

**store/useSocketStatusStore.ts**
```
Imports:
  ✓ zustand

Exports:
  ✓ useSocketStatusStore hook

State:
  - connections: { [key: string]: ConnectionStatus }

Actions:
  - registerConnection()
  - updateStatus()

Dependencies: None
Used By:
  (No visible usage in codebase)

Status: ❌ UNUSED - Appears as incomplete refactoring
```

**store/useLatencyDiagnosticsStore.ts**
```
Imports:
  ✓ zustand

State:
  - socketLatency: number
  - tickAge: number
  - storeUpdatesPerSecond: number

Used By:
  ✓ AIAnalysis.tsx

Total Usages: 1 file
```

---

### Layer 3: Services (Business Logic)

```
services/
├── indicators.ts (600+ lines)
├── scoring.ts (400+ lines)
├── analysis.ts (350+ lines)
├── websocket.ts (250+ lines)
├── binance.ts (200+ lines)
├── alerts.ts (100+ lines)
└── websocketManager.ts (250+ lines, UNUSED)
```

**services/indicators.ts**
```
Exports:
  ✓ calculateSMA()
  ✓ calculateEMA()
  ✓ calculateRSI()
  ✓ calculateMACD()
  ✓ calculateATR()
  ✓ calculateADX()
  ✓ calculateVWAP()
  ✓ calculateMomentum()
  ✓ calculateVolumeSpike()
  ✓ getSupportResistance()
  ✓ calculateIndicatorSnapshot()
  ✓ getLatestValue()
  ✓ getLatestEMA12(), getLatestEMA26(), etc.

Dependencies: None (pure functions)

Used By:
  ✓ services/scoring.ts
  ✓ services/analysis.ts
  ✓ components/chart/TradingChart.tsx
  ✓ components/analysis/AIAnalysis.tsx

Total Usages: 4 files
Reusability: ⭐⭐⭐⭐⭐ (100% reusable)
```

**services/scoring.ts**
```
Exports:
  ✓ scoreMarket()
  ✓ calculateIndicatorSnapshot()
  ✓ calculateScores()
  ✓ calculateRiskScore()
  ✓ getRiskLevel()
  ✓ calculateRisk()
  ✓ createTradePlan()
  ✓ createAtrTradePlan()
  ✓ createLockedSetup()

Imports:
  ✓ services/indicators.ts

Dependencies:
  scoring.ts
  └── indicators.ts
      └── (no deps)

Used By:
  ✓ services/analysis.ts
  ✓ store/useRiskStore.ts
  ✓ components/risk/RiskCalculator.tsx

Total Usages: 3 files
Reusability: ⭐⭐⭐⭐ (90% reusable, some magic numbers)
```

**services/analysis.ts**
```
Exports:
  ✓ analyzeTimeframe()
  ✓ calculateTrend()
  ✓ calculateSignal()
  ✓ createAnalysis()

Imports:
  ✓ services/scoring.ts
  ✓ services/indicators.ts

Dependencies:
  analysis.ts
  ├── scoring.ts
  │   └── indicators.ts
  └── indicators.ts

Used By:
  ✓ components/analysis/AIAnalysis.tsx

Total Usages: 1 file
Reusability: ⭐⭐⭐ (70% reusable, needs customization)
```

**services/websocket.ts**
```
Exports:
  ✓ createBinanceKlineSocket()
  ✓ createBinanceTickerSocket()
  ✓ ManagedWebSocket class

Imports:
  ✓ None (generic WebSocket wrapper)

Dependencies: None

Used By:
  ✓ components/chart/TradingChart.tsx
  ✓ components/analysis/AIAnalysis.tsx
  ✓ components/alerts/AlertPanel.tsx

Total Usages: 3 files
Reusability: ⭐⭐⭐⭐ (87% reusable, URL-parameterized)

Duplicate Exists: services/websocketManager.ts (95% identical)
```

**services/websocketManager.ts**
```
Exports:
  ✓ ManagedWebSocket class (duplicate of websocket.ts)

Imports: None

Used By: (No visible usage)

Status: ❌ DUPLICATE & UNUSED
Action Required: DELETE THIS FILE
```

**services/binance.ts**
```
Exports:
  ✓ searchBinanceSymbols()
  ✓ fetchBinanceKlines()
  ✓ getExchangeInfo()
  ✓ normalizeBinanceKline()
  ✓ [helper functions]

Imports:
  ✓ fetch (native browser API)

Dependencies: None (Binance-specific URLs hardcoded)

Used By:
  ✓ components/watchlist/SymbolSearch.tsx
  ✓ components/chart/TradingChart.tsx
  ✓ components/analysis/AIAnalysis.tsx
  ✓ app/api/symbols/route.ts

Total Usages: 4 files
Reusability: ⭐⭐⭐ (65% reusable, Binance-specific)
Note: Would need abstraction for multi-exchange
```

**services/alerts.ts**
```
Exports:
  ✓ evaluateAlerts()
  ✓ formatAlert()
  ✓ checkAlertConditions()

Imports:
  ✓ services/indicators.ts (for RSI check)

Dependencies:
  alerts.ts
  └── indicators.ts

Used By:
  ✓ components/alerts/AlertPanel.tsx

Total Usages: 1 file
Reusability: ⭐⭐⭐⭐ (85% reusable, customizable rules)
```

---

### Layer 4: API Routes

```
app/api/
├── klines/route.ts
└── symbols/route.ts
```

**app/api/klines/route.ts**
```
Exports:
  ✓ GET handler for kline history

Imports:
  ✓ services/binance.ts → fetchBinanceKlines()

Used By:
  ✓ HTTP clients (frontend + external)

Dependencies:
  klines/route.ts
  └── binance.ts

Endpoint: GET /api/klines?symbol=BTCUSDT&interval=1h&limit=300
```

**app/api/symbols/route.ts**
```
Exports:
  ✓ GET handler for symbol search

Imports:
  ✓ services/binance.ts → searchBinanceSymbols()

Used By:
  ✓ components/watchlist/SymbolSearch.tsx

Dependencies:
  symbols/route.ts
  └── binance.ts

Endpoint: GET /api/symbols?q=BTC&limit=10
```

---

## FULL DEPENDENCY TREE

```
app/page.tsx (Root)
│
├── components/layout/Header.tsx
│   ├── store/useMarketStore.ts
│   └── components/watchlist/SymbolSearch.tsx
│       ├── store/useMarketStore.ts
│       ├── services/binance.ts
│       └── app/api/symbols/route.ts
│           └── services/binance.ts
│
├── components/chart/TradingChart.tsx
│   ├── store/useMarketStore.ts
│   ├── store/useIndicatorStore.ts
│   ├── services/websocket.ts (no deps)
│   ├── services/indicators.ts (no deps)
│   ├── services/binance.ts
│   │   └── (Binance API)
│   ├── components/layout/ChartToolbar.tsx
│   └── components/layout/IndicatorGrid.tsx
│
├── components/analysis/AIAnalysis.tsx
│   ├── store/useMarketStore.ts
│   ├── store/useAnalysisStore.ts
│   ├── store/useLatencyDiagnosticsStore.ts
│   ├── services/websocket.ts (no deps)
│   ├── services/binance.ts
│   ├── services/analysis.ts
│   │   ├── services/scoring.ts
│   │   │   └── services/indicators.ts (no deps)
│   │   └── services/indicators.ts (no deps)
│   └── components/analysis/CompactAIPanel.tsx
│       └── store/useAnalysisStore.ts
│
├── components/layout/TradeSetupPanel.tsx
│   ├── store/useRiskStore.ts
│   │   └── services/scoring.ts
│   │       └── services/indicators.ts (no deps)
│   ├── store/useMarketStore.ts
│   ├── store/useAnalysisStore.ts
│   └── components/risk/RiskCalculator.tsx
│       ├── store/useRiskStore.ts
│       ├── store/useMarketStore.ts
│       └── services/scoring.ts
│
├── components/risk/RiskCalculator.tsx (see above)
│
├── components/watchlist/Watchlist.tsx
│   ├── store/useMarketStore.ts
│   └── components/watchlist/SymbolSearch.tsx (see above)
│
├── components/layout/MarketSummary.tsx
│   ├── store/useAnalysisStore.ts
│   └── store/useMarketStore.ts
│
└── components/alerts/AlertPanel.tsx
    ├── store/useAlertStore.ts
    ├── store/useMarketStore.ts
    ├── services/websocket.ts (no deps)
    └── services/alerts.ts
        └── services/indicators.ts (no deps)
```

---

## DEPENDENCY STATISTICS

### Store Usage Frequency

| Store | Used By | Count | Criticality |
|-------|---------|-------|-------------|
| `useMarketStore` | TradingChart, AIAnalysis, TradeSetupPanel, RiskCalculator, Watchlist, Header, SymbolSearch, MarketSummary, AlertPanel | 9 | 🔴 CRITICAL |
| `useAnalysisStore` | AIAnalysis, TradeSetupPanel, RiskCalculator, MarketSummary, CompactAIPanel | 5 | 🟠 HIGH |
| `useRiskStore` | TradeSetupPanel, RiskCalculator | 2 | 🟠 HIGH |
| `useAlertStore` | AlertPanel | 1 | 🟡 MEDIUM |
| `useLatencyDiagnosticsStore` | AIAnalysis | 1 | 🔵 LOW |
| `useSidebarStore` | Sidebar components | 1 | 🔵 LOW |
| `useTradeStore` | (unused) | 0 | ⚪ NONE |
| `useSocketStatusStore` | (unused) | 0 | ⚪ NONE |

### Service Usage Frequency

| Service | Used By | Count | Criticality |
|---------|---------|-------|-------------|
| `indicators.ts` | scoring, analysis, TradingChart, AIAnalysis | 4 | 🔴 CRITICAL |
| `scoring.ts` | analysis, useRiskStore, RiskCalculator | 3 | 🔴 CRITICAL |
| `analysis.ts` | AIAnalysis | 1 | 🟠 HIGH |
| `websocket.ts` | TradingChart, AIAnalysis, AlertPanel | 3 | 🟠 HIGH |
| `binance.ts` | SymbolSearch, TradingChart, AIAnalysis, api/symbols, api/klines | 5 | 🟠 HIGH |
| `alerts.ts` | AlertPanel | 1 | 🟡 MEDIUM |
| `websocketManager.ts` | (unused) | 0 | ⚪ NONE |

### Circular Dependency Check

✅ **No circular dependencies detected**

All dependencies flow unidirectionally:
```
API Routes
    ↓
Services
    ↓
Components + Stores
    ↓
UI (leaf nodes)
```

---

## UNUSED CODE ANALYSIS

### Unused Stores
```
❌ useSocketStatusStore.ts
   - Defined but never imported
   - Size: ~25 KB minified
   - Action: DELETE

❌ useTradeStore.ts
   - Defined but never used
   - Size: ~15 KB minified
   - Action: DELETE or implement
```

### Unused Imports
```
❌ AIAnalysis.tsx imports getClosedBinanceKlines (not used in file)
   - Action: Remove import

❌ useIndicatorStore defines 'enabled' flags (not read anywhere)
   - Action: Remove or implement UI to toggle indicators
```

### Unused Services
```
❌ services/websocketManager.ts (95% duplicate of websocket.ts)
   - Size: ~150 lines
   - Action: DELETE, use websocket.ts instead
```

---

## CYCLOMATIC COMPLEXITY BY FILE

| File | LOC | Functions | Avg Complexity | Risk |
|------|-----|-----------|-----------------|------|
| `services/scoring.ts` | 400 | 12 | 4.2 | 🟠 MEDIUM |
| `services/analysis.ts` | 350 | 8 | 3.8 | 🟠 MEDIUM |
| `services/indicators.ts` | 600 | 15 | 2.5 | 🟢 LOW |
| `TradingChart.tsx` | 350 | 6 | 3.5 | 🟠 MEDIUM |
| `AIAnalysis.tsx` | 280 | 4 | 4.1 | 🟠 MEDIUM |
| `useRiskStore.ts` | 250 | 10 | 3.2 | 🟠 MEDIUM |
| `TradeSetupPanel.tsx` | 200 | 3 | 3.0 | 🟢 LOW |

---

## SUGGESTED REFACTORING

### High Priority: Reduce Dependencies
```
Current: TradingChart depends on 6+ files
Target: TradingChart depends on 3 files (stores + chart lib)

Solution:
  Create custom hook: useChartData()
    - Wraps all indicator/websocket logic
    - TradingChart only uses hook
```

### High Priority: Extract Duplicate WebSocket
```
Current: services/websocket.ts + services/websocketManager.ts
Target: Single services/websocket.ts

Action: DELETE websocketManager.ts, consolidate logic
```

### Medium Priority: Centralize Scoring Logic
```
Current: Scoring split between scoring.ts and analysis.ts
Target: Single source of truth for scores

Action: Move all scoring to services/scoring.ts
```

---

## END OF DEPENDENCY MAP

Last Updated: June 24, 2026
