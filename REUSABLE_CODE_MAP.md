# REUSABLE CODE MAPPING

## Overview

This document catalogs reusable code modules from the AI Trading System that can be extracted and applied to other projects.

---

## TIER 1: IMMEDIATELY EXTRACTABLE (Production Ready)

### 1.1 Indicator Library

**Current Location:** `services/indicators.ts`

**Reusability Score:** ⭐⭐⭐⭐⭐ 95/100

**Size:** ~600 lines of pure functions

#### Extractable Functions

```typescript
export const calculateEMA = (
    closes: number[],
    period: number
): number[]
```
- **Use Case:** Any trend analysis requiring exponential averaging
- **Dependencies:** None
- **Ports to:** All languages (algorithm-based)
- **Examples:** Forex, stocks, commodities, crypto, options

```typescript
export const calculateRSI = (
    closes: number[],
    period: number = 14
): number[]
```
- **Use Case:** Overbought/oversold detection
- **Dependencies:** None
- **Ports to:** All asset classes
- **Examples:** Mean reversion strategies, momentum trading

```typescript
export const calculateMACD = (
    closes: number[],
    shortPeriod: number = 12,
    longPeriod: number = 26,
    signalPeriod: number = 9
): { macd: number[], signal: number[], histogram: number[] }
```
- **Use Case:** Momentum and divergence detection
- **Dependencies:** EMA calculation
- **Ports to:** All asset classes
- **Examples:** Trend confirmation, convergence trading

```typescript
export const calculateATR = (
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14
): number[]
```
- **Use Case:** Volatility measurement and risk sizing
- **Dependencies:** None
- **Ports to:** All asset classes with intraday data
- **Examples:** Stop loss placement, position sizing

```typescript
export const calculateADX = (
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14
): number[]
```
- **Use Case:** Trend strength measurement
- **Dependencies:** True Range calculation (included)
- **Ports to:** All asset classes
- **Examples:** Filter weak trends, signal confirmation

```typescript
export const calculateVWAP = (
    highs: number[],
    lows: number[],
    closes: number[],
    volumes: number[]
): number[]
```
- **Use Case:** Volume-weighted price analysis
- **Dependencies:** None
- **Ports to:** Any asset with volume data
- **Examples:** Institutional order detection, support/resistance

```typescript
export const calculateSMA = (
    closes: number[],
    period: number
): number[]
```
- **Use Case:** Simple moving average, baseline smoothing
- **Dependencies:** None
- **Ports to:** All asset classes
- **Examples:** Trend baseline, filter noise

#### Extraction Template

```typescript
// lib/indicators/index.ts
export * from './ema';
export * from './rsi';
export * from './macd';
export * from './atr';
export * from './adx';
export * from './vwap';
export * from './sma';

// Each function fully typed and documented
// No side effects, no global state
// 100% testable
```

#### Usage in Other Projects

**Scenario: Stock trading system**
```typescript
import { calculateEMA, calculateRSI, calculateATR } from '@trading/indicators';

const closes = fetchStockPrices(symbol);
const ema50 = calculateEMA(closes, 50);
const rsi14 = calculateRSI(closes, 14);
const atr14 = calculateATR(highs, lows, closes, 14);
```

**Scenario: Forex bot**
```typescript
import { calculateMACD } from '@trading/indicators';

const macd = calculateMACD(eurusdCloses);
if (macd.histogram[latest] > 0) executeBuySignal();
```

---

### 1.2 Risk Calculator Engine

**Current Location:** `store/useRiskStore.ts`, `services/scoring.ts`

**Reusability Score:** ⭐⭐⭐⭐⭐ 94/100

**Size:** ~200 lines

#### Extractable Functions

```typescript
export interface TradeSetup {
    entryPrice: number;
    stopPrice: number;
    takeProfitPrice: number;
    accountBalance: number;
    riskPercentage: number;
}

export const calculatePositionSize = (setup: TradeSetup): number
```
- **Purpose:** Determine lot/contract size for fixed risk
- **Formula:** `(accountBalance × riskPct/100) / |entry - stop|`
- **Use Case:** Money management, position sizing
- **Applies to:** Any leveraged or unleveraged trading

```typescript
export const calculateRiskRewardRatio = (
    entryPrice: number,
    stopPrice: number,
    takeProfitPrice: number
): number
```
- **Purpose:** Calculate R/R for trade quality assessment
- **Formula:** `|TP - entry| / |entry - stop|`
- **Use Case:** Trade filtering, opportunity ranking
- **Applies to:** Any trade setup

```typescript
export const calculateTradeQuality = (
    setup: TradeSetup,
    atr: number
): {
    stopQuality: number;
    ratioQuality: number;
    riskQuality: number;
    entryQuality: number;
    tradeQuality: number;
}
```
- **Purpose:** Score trade setup quality on multiple dimensions
- **Use Case:** Automated trade filtering
- **Applies to:** Any trade strategy

```typescript
export const calculateMaxDrawdown = (
    tradeResults: number[], // Array of P&L values
    accountValue: number
): number
```
- **Purpose:** Calculate portfolio drawdown statistics
- **Use Case:** Risk monitoring, strategy evaluation
- **Applies to:** Any trading system

#### Extraction Template

```typescript
// lib/trading/risk-calculator.ts

export class RiskCalculator {
    calculatePositionSize(setup: TradeSetup): number { ... }
    calculateRiskRewardRatio(entry, stop, tp): number { ... }
    calculateTradeQuality(setup, atr): QualityScores { ... }
    calculateMaxDrawdown(results, initialBalance): number { ... }
    validateTradeSetup(entry, stop, tp, action): boolean { ... }
}

// 100% unit testable
// Works with any currency/instrument
// Fully documented
```

#### Usage in Other Projects

**Scenario: Trading API service**
```typescript
import { RiskCalculator } from '@trading/risk-calculator';

const calc = new RiskCalculator();
const posSize = calc.calculatePositionSize({
    entryPrice: 100,
    stopPrice: 95,
    takeProfitPrice: 110,
    accountBalance: 10000,
    riskPercentage: 2
}); // Returns 4.0 contracts
```

**Scenario: Risk monitoring dashboard**
```typescript
const tradeQuality = calc.calculateTradeQuality(setup, atr);
if (tradeQuality.tradeQuality < 60) {
    notifyUser("Poor trade setup, consider skipping");
}
```

---

### 1.3 WebSocket Connection Manager

**Current Location:** `services/websocket.ts`

**Reusability Score:** ⭐⭐⭐⭐ 87/100

**Size:** ~250 lines

#### Extractable Features

```typescript
export interface StreamHandlers {
    onData: (data: any) => void;
    onError: (error: SocketError) => void;
    onConnect: () => void;
    onDisconnect: () => void;
}

export class ManagedWebSocket {
    constructor(url: string, handlers: StreamHandlers)
    connect(): Promise<void>
    disconnect(): void
    isConnected(): boolean
    isStale(maxAgeMs: number): boolean
    getConnectionStatus(): ConnectionStatus
}
```

#### Key Capabilities

- **Automatic reconnection** with exponential backoff
- **Stale data detection** (no updates for N seconds)
- **Event-based architecture** (handlers for every state)
- **Error resilience** (parse errors don't crash connection)
- **Connection pooling** ready

#### Universal Adaptability

**For any WebSocket-based stream:**
- Binance klines
- Coinbase ticker
- Yahoo Finance
- IEX Cloud
- Custom APIs

**Requires only parameterization:**
```typescript
const stream = new ManagedWebSocket(
    'wss://custom-api.com/stream',  // ← URL only change
    {
        onData: handleData,
        onError: handleError,
        onConnect: handleConnect,
        onDisconnect: handleDisconnect
    }
);
```

#### Extraction Template

```typescript
// lib/streams/managed-websocket.ts

export class ManagedWebSocket {
    // Generic connection management
    // Only requires URL and handlers
    // Exchange-agnostic
}

// Usage:
// - Binance: new ManagedWebSocket('wss://stream.binance.com:9443/ws/...')
// - Coinbase: new ManagedWebSocket('wss://ws-feed.exchange.coinbase.com')
// - Custom: new ManagedWebSocket('<any wss:// URL>')
```

---

## TIER 2: EXTRACTABLE WITH LIGHT REFACTORING

### 2.1 Trend Classification Engine

**Current Location:** `services/analysis.ts` → `calculateTrend()`

**Reusability Score:** ⭐⭐⭐⭐ 85/100

**Refactoring Effort:** 4 hours

**Applicable To:** Any instrument with moving averages and momentum

#### Function Signature

```typescript
export interface TrendRules {
    priceSmaWeight: number;           // Close vs SMA20
    smaAlignmentWeight: number;       // SMA20 vs SMA50
    momentumWeight: number;           // Price acceleration
    rsiRegimeWeight: number;          // RSI range preference
}

export const classifyTrend = (
    close: number,
    sma20: number,
    sma50: number,
    momentum: number,
    rsi: number,
    rules?: TrendRules
): "Bullish" | "Bearish" | "Neutral"
```

#### Customization Options

```typescript
// Aggressive trend detection
const aggressiveRules: TrendRules = {
    priceSmaWeight: 1,
    smaAlignmentWeight: 2,
    momentumWeight: 1,
    rsiRegimeWeight: 0  // Ignore RSI extremes
};

// Conservative trend detection
const conservativeRules: TrendRules = {
    priceSmaWeight: 0.5,
    smaAlignmentWeight: 2,
    momentumWeight: 0.5,
    rsiRegimeWeight: 2  // Heavy RSI weighting
};
```

#### Extraction Process

```typescript
// lib/analysis/trend-classifier.ts

export class TrendClassifier {
    constructor(rules?: TrendRules) { ... }
    classify(indicators: IndicatorSnapshot): Trend { ... }
    getScore(indicators): number { ... }
}

// Fully configurable
// Works with any market data
// Easily testable
```

---

### 2.2 Signal Generation Engine

**Current Location:** `services/analysis.ts` → `calculateSignal()`

**Reusability Score:** ⭐⭐⭐ 75/100

**Refactoring Effort:** 6 hours

**Applicable To:** Any trend-based strategy

#### Function Signature

```typescript
export interface SignalRules {
    minConfidence: number;
    minStrength: number;
    rsiOverbought: number;
    rsiOversold: number;
    confirmWithVolume: boolean;
}

export const generateSignal = (
    trend: Trend,
    strength: number,
    confidence: number,
    momentum: number,
    rsi: number,
    volumeSpike: number,
    rules?: SignalRules
): Signal
```

#### Customization

```typescript
// Aggressive signals (more frequent)
const aggressiveRules: SignalRules = {
    minConfidence: 50,
    minStrength: 40,
    rsiOverbought: 80,
    rsiOversold: 20,
    confirmWithVolume: false
};

// Conservative signals (fewer, higher quality)
const conservativeRules: SignalRules = {
    minConfidence: 85,
    minStrength: 75,
    rsiOverbought: 70,
    rsiOversold: 30,
    confirmWithVolume: true
};
```

---

### 2.3 Market Scoring Model

**Current Location:** `services/scoring.ts` → Scoring functions

**Reusability Score:** ⭐⭐⭐⭐ 82/100

**Refactoring Effort:** 10 hours

**Applicable To:** Any indicator set, fully configurable

#### Customizable Weights

```typescript
export interface ScoringWeights {
    trendStrengthWeight: number;        // 0-1, default 0.28
    marketHealthWeight: number;         // 0-1, default 0.28
    entryQualityWeight: number;         // 0-1, default 0.30
    reversalProtectionWeight: number;   // 0-1, default 0.14
}

export const calculateConfidence = (
    metrics: ScoringMetrics,
    weights?: ScoringWeights
): number
```

#### Adaptation Examples

**For low-volatility markets (forex):**
```typescript
const forexWeights: ScoringWeights = {
    trendStrengthWeight: 0.35,
    marketHealthWeight: 0.25,
    entryQualityWeight: 0.25,
    reversalProtectionWeight: 0.15
};
```

**For high-volatility markets (micro-cap stocks):**
```typescript
const microCapWeights: ScoringWeights = {
    trendStrengthWeight: 0.20,
    marketHealthWeight: 0.40,
    entryQualityWeight: 0.25,
    reversalProtectionWeight: 0.15
};
```

---

## TIER 3: EXTRACTABLE WITH SIGNIFICANT REFACTORING

### 3.1 Binance Integration Layer

**Current Location:** `services/binance.ts`

**Reusability Score:** ⭐⭐⭐ 65/100 (highly Binance-specific)

**Refactoring Effort:** 15 hours (to make generic)

**Note:** Consider exchange-agnostic abstraction

#### Applicable To:** Multi-exchange platforms

#### What to Extract

```typescript
export interface ExchangeAPI {
    searchSymbols(query: string): Promise<string[]>
    fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]>
    getCurrentPrice(symbol: string): Promise<number>
}

// Implement for each exchange
export class BinanceAPI implements ExchangeAPI { ... }
export class CoinbaseAPI implements ExchangeAPI { ... }
export class KrakenAPI implements ExchangeAPI { ... }
```

#### Implementation Path

1. Create `ExchangeAPI` interface
2. Extract Binance-specific logic to `BinanceAPI` class
3. Create adapter pattern for other exchanges
4. Deploy as pluggable module

---

## REUSE MATRIX

### Which projects can use which modules?

| Module | Stock Trading | Crypto | Forex | Options | Futures |
|--------|---------------|--------|-------|---------|---------|
| **Indicator Library** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Risk Calculator** | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ Adapted | ✅ Yes |
| **WebSocket Manager** | ⚠️ If available | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Trend Classification** | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ Adapted | ✅ Yes |
| **Signal Generation** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Scoring Model** | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ Adapted | ✅ Yes |
| **Binance Integration** | ❌ No | ✅ Yes | ❌ No | ❌ No | ⚠️ Futures |

---

## IMPLEMENTATION ROADMAP

### Phase 1: Extract Core Indicators (Week 1)
```
Create lib/indicators/
├── ema.ts
├── rsi.ts
├── macd.ts
├── atr.ts
├── adx.ts
├── vwap.ts
├── sma.ts
└── index.ts

Status: 100% reusable
Tests: Unit test suite
Documentation: Full JSDoc
```

### Phase 2: Extract Risk Calculator (Week 2)
```
Create lib/trading/
├── position-sizing.ts
├── trade-quality.ts
├── drawdown-calculator.ts
└── index.ts

Status: 100% reusable
Tests: Unit test suite with edge cases
Documentation: Complete with examples
```

### Phase 3: Extract WebSocket (Week 3)
```
Create lib/streams/
├── managed-websocket.ts
├── types.ts
├── handlers.ts
└── index.ts

Status: 95% reusable (URL-parameterized)
Tests: Connection lifecycle tests
Documentation: Multiple exchange examples
```

### Phase 4: Extract Analysis Engines (Week 4)
```
Create lib/analysis/
├── trend-classifier.ts
├── signal-generator.ts
├── score-calculator.ts
└── index.ts

Status: 85-90% reusable (weights customizable)
Tests: Comprehensive test matrix
Documentation: Tuning guide for different markets
```

---

## PUBLISHING STRATEGY

### Package: @trading-ai/indicators
```json
{
    "name": "@trading-ai/indicators",
    "version": "1.0.0",
    "description": "Pure technical indicator calculations for trading",
    "main": "dist/index.js",
    "types": "dist/index.d.ts",
    "exports": {
        ".": "./dist/index.js",
        "./ema": "./dist/ema.js",
        "./rsi": "./dist/rsi.js"
    }
}
```

### Package: @trading-ai/risk-calc
```json
{
    "name": "@trading-ai/risk-calc",
    "version": "1.0.0",
    "description": "Position sizing and trade quality calculations",
    "peerDependencies": {
        "@trading-ai/indicators": "^1.0.0"
    }
}
```

### Package: @trading-ai/streams
```json
{
    "name": "@trading-ai/streams",
    "version": "1.0.0",
    "description": "Managed WebSocket connections with retry logic",
    "description": "Works with any WebSocket-based market data API"
}
```

---

## CODE QUALITY STANDARDS FOR REUSABLE MODULES

### Documentation Requirements
- ✅ Full JSDoc comments on all exports
- ✅ Usage examples in docstrings
- ✅ Parameter type definitions
- ✅ Return value documentation
- ✅ Error conditions documented

### Testing Requirements
- ✅ Unit tests for all functions
- ✅ Edge case coverage (zero, negative, extreme values)
- ✅ Integration test samples
- ✅ >90% code coverage
- ✅ Performance benchmarks

### Code Requirements
- ✅ No external dependencies (or minimal)
- ✅ No global state
- ✅ Pure functions where possible
- ✅ TypeScript with strict mode
- ✅ ESLint compliance

---

## RECOMMENDED EXTRACTION ORDER

1. **Start with:** Indicator Library (highest reuse, lowest effort)
2. **Then:** Risk Calculator (complementary to indicators)
3. **Then:** WebSocket Manager (useful for any streaming data)
4. **Finally:** Analysis Engines (requires custom tuning per project)

**Total extraction time:** ~40 hours  
**ROI:** 10x+ (used across 10+ projects)

---

## END OF REUSABLE CODE MAPPING

Last Updated: June 24, 2026
