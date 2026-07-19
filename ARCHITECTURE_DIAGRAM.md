```mermaid
graph TB
    subgraph UI["UI Components"]
        Home["Home<br/>app/page.tsx"]
        Header["Header"]
        Chart["TradingChart"]
        AI["AIAnalysis"]
        Setup["TradeSetupPanel"]
        Risk["RiskCalculator"]
        Watchlist["Watchlist"]
        Alerts["AlertPanel"]
        Summary["MarketSummary"]
    end

    subgraph State["Zustand Stores"]
        Market["useMarketStore<br/>symbol, interval,<br/>watchlist"]
        Indicator["useIndicatorStore<br/>current indicators,<br/>enabled flags"]
        Analysis["useAnalysisStore<br/>timeframe results,<br/>confidence, signals"]
        RiskStore["useRiskStore<br/>entry, stop, TP,<br/>position size"]
        Trade["useTradeStore<br/>active trades,<br/>metrics"]
        Alerts2["useAlertStore<br/>active alerts"]
        Sidebar["useSidebarStore<br/>UI state"]
    end

    subgraph Services["Service Layer"]
        Indicators["indicators.ts<br/>EMA, RSI, MACD,<br/>ATR, ADX, VWAP"]
        Analysis2["analysis.ts<br/>Multi-timeframe<br/>Trend, Signal,<br/>Confidence"]
        Scoring["scoring.ts<br/>Market scoring,<br/>Risk scoring,<br/>Trade plans"]
        WebSocket["websocket.ts<br/>Managed live<br/>streams"]
        Binance["binance.ts<br/>Symbol search,<br/>Kline fetch"]
        Alerts3["alerts.ts<br/>Alert eval,<br/>formatting"]
    end

    subgraph API["External APIs"]
        BinanceRest["Binance REST API<br/>exchangeInfo, klines"]
        BinanceWS["Binance WebSocket<br/>klines, tickers"]
    end

    Home --> Header
    Home --> Chart
    Home --> AI
    Home --> Setup
    Home --> Risk
    Home --> Watchlist
    Home --> Alerts
    Home --> Summary

    Chart --> Indicator
    Chart --> Market
    AI --> Analysis
    AI --> Market
    Setup --> RiskStore
    Risk --> RiskStore
    Watchlist --> Market
    Alerts --> Alerts2
    Summary --> Analysis

    Indicator --> Indicators
    Analysis --> Analysis2
    Analysis --> Scoring
    Analysis2 --> Indicators
    Scoring --> Indicators
    
    Chart --> WebSocket
    AI --> WebSocket
    Alerts --> WebSocket

    Market --> Binance
    Market --> WebSocket
    WebSocket --> BinanceWS
    Binance --> BinanceRest
    
    Analysis2 --> Scoring
    Scoring --> Binance

    Alerts3 --> WebSocket
    Alerts --> Alerts3

    style UI fill:#e1f5ff
    style State fill:#f3e5f5
    style Services fill:#e8f5e9
    style API fill:#fff3e0
```

## Architecture Layers

### Presentation Layer (UI Components)
- **Home**: Root component, orchestrates all sections
- **TradingChart**: Interactive candlestick chart with indicators
- **AIAnalysis**: Multi-timeframe analysis display
- **TradeSetupPanel**: Trade entry/stop/TP configuration
- **RiskCalculator**: Position size and risk assessment
- **Watchlist**: Symbol selection and watchlist management
- **AlertPanel**: Real-time alert display
- **MarketSummary**: Market metrics and overview

### State Management Layer (Zustand Stores)
- **useMarketStore**: Market symbol and interval selection
- **useIndicatorStore**: Current indicator values snapshot
- **useAnalysisStore**: Analysis results for all timeframes
- **useRiskStore**: Trade setup inputs and calculations
- **useTradeStore**: Active trade lifecycle management
- **useAlertStore**: Alert management
- **useSidebarStore**: UI sidebar state
- **useSocketStatusStore**: Connection status (unused)
- **useLatencyDiagnosticsStore**: Performance telemetry

### Service Layer (Business Logic)
- **indicators.ts**: Pure technical indicator calculations
- **analysis.ts**: Multi-timeframe analysis engine
- **scoring.ts**: Market scoring and trade plan generation
- **websocket.ts**: Managed WebSocket connections
- **binance.ts**: Binance API integration
- **alerts.ts**: Alert evaluation and formatting
- **websocketManager.ts**: Duplicate unused socket manager

### Data Layer (External APIs)
- **Binance REST API**: Historical data, symbol information
- **Binance WebSocket**: Live candlestick and ticker streams

## Data Flow Diagram

```mermaid
sequenceDiagram
    participant User
    participant UI as UI Components
    participant Store as Zustand Stores
    participant Service as Services
    participant API as Binance API

    User->>UI: Select Symbol/Interval
    UI->>Store: setSymbol()
    Store->>Service: Fetch historical candles
    Service->>API: GET klines
    API-->>Service: OHLCV data
    Service->>Store: Update indicators
    Store->>UI: Render chart

    Note over Service: WebSocket connected
    Service->>API: Subscribe to live klines
    API-->>Service: Kline updates (real-time)
    Service->>Store: Update indicator snapshot
    Store->>UI: Auto re-render

    User->>UI: Trigger AI Analysis
    UI->>Service: analyzeTimeframe()
    Service->>Service: Calculate all indicators
    Service->>Service: Calculate scores
    Service->>Service: Generate signals
    Service->>Store: Update analysis results
    Store->>UI: Display analysis

    UI->>Service: createTradePlan()
    Service->>Service: Calculate risk/reward
    Service->>Store: Update trade setup
    Store->>UI: Display trade plan
```

## Component Interaction Map

```mermaid
graph LR
    Chart -->|indicator snapshot| Indicator[useIndicatorStore]
    AI -->|analysis results| Analysis[useAnalysisStore]
    Setup -->|trade inputs| RiskStore[useRiskStore]
    Risk -->|position sizing| RiskStore
    Watchlist -->|symbol/interval| Market[useMarketStore]
    Header -->|symbol| Market
    
    Indicator -->|enabled flags| Chart
    Indicator -->|enabled flags| AI
    
    Analysis -->|confidence,signal| Setup
    Analysis -->|confidence,signal| AI
    
    RiskStore -->|entry,stop,tp| Setup
    RiskStore -->|risk metrics| Risk
    
    Market -->|symbol| Chart
    Market -->|symbol| AI
    Market -->|watchlist| Watchlist
```

## Technology Stack by Layer

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Presentation** | React 18 + TypeScript | UI components, type safety |
| **Styling** | CSS Modules | Scoped component styles |
| **State** | Zustand | State management |
| **Charts** | TradingView Lightweight Charts | OHLC visualization |
| **Framework** | Next.js 14 | Server/client, SSR |
| **Real-time** | WebSocket | Live data streaming |
| **API** | Binance REST + WebSocket | Market data |
| **Build** | ESLint, PostCSS, TypeScript | Code quality |

## Performance Characteristics

### Component Rendering
- **TradingChart**: O(n) on candle count, memoized for chart library
- **AIAnalysis**: O(n×3) for 3 timeframes, runs in parallel
- **TradeSetupPanel**: O(1) static form, no recalculation
- **Watchlist**: O(n log n) sorting on watchlist length

### Data Flow Latency
- **Historical data fetch**: ~500ms (Binance API)
- **Live kline update**: <100ms (WebSocket)
- **Indicator recalculation**: ~180ms (full snapshot)
- **UI re-render**: <50ms (Chrome, modern device)

### Memory Usage
- **Candle history**: ~100 KB per symbol (300 candles × 8 fields)
- **Indicator cache**: ~50 KB per indicator
- **Store state**: ~150 KB total
- **Total estimated**: ~800 KB - 1 MB at runtime

## Scalability Considerations

### Current Limitations
- **Single symbol analysis** (no portfolio view)
- **Single timeframe stream** (one WebSocket per chart)
- **Binance-only** (hardcoded API endpoints)
- **Browser-based** (no backend caching)

### Bottlenecks
- **API rate limits**: 1200 requests/minute
- **WebSocket connections**: Limited by browser (6-10 concurrent)
- **Calculation speed**: Indicator calc is CPU-bound
- **Memory**: Large candle histories consume RAM

### Scaling Strategy
1. **Exchange abstraction**: Create adapter pattern for multi-exchange
2. **Backend compute**: Move indicator calcs to server
3. **Caching layer**: Redis for historical data
4. **Connection pooling**: Reuse WebSocket streams across components
5. **Lazy loading**: Load candle history on-demand by timeframe
