import AIAnalysis from "@/components/analysis/AIAnalysis";
import { CompactAIPanel } from "@/components/analysis/CompactAIPanel";
import TradingChart from "@/components/chart/TradingChart";
import ChartContainer from "@/components/layout/ChartContainer";
import Header from "@/components/layout/Header";
import { MarketSummary } from "@/components/layout/MarketSummary";
import MarketStatsRow from "@/components/layout/MarketStatsRow";
import { NewsTab } from "@/components/layout/NewsTab";
import TradeSetupPanel from "@/components/layout/TradeSetupPanel";
import AIPositionManager from "@/components/position-manager/AIPositionManager";
import Watchlist from "@/components/watchlist/Watchlist";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.dashboard}>
      <Header />

      <div className={styles.workspace}>
        <section className={styles.leftColumn} aria-label="Market chart and news">
          <div className={styles.chartPanel}>
            <ChartContainer>
              <TradingChart />
            </ChartContainer>
          </div>

          <MarketStatsRow />

          <section className={styles.panel}>
            <PanelHeading title="News Feed" />
            <div className={styles.newsViewport}>
              <NewsTab />
            </div>
          </section>
        </section>

        <aside className={styles.centerColumn} aria-label="Trade setup">
          <TradeSetupPanel />
          <AIPositionManager />
        </aside>

        <aside className={styles.rightColumn} aria-label="Analysis and watchlist">
          <AIAnalysis headless />
          <section className={styles.panel}>
            <CompactAIPanel />
          </section>
          <section className={styles.panel}>
            <Watchlist />
          </section>
          <MarketSummary />
        </aside>
      </div>
    </main>
  );
}

function PanelHeading({ title }: { title: string }) {
  return (
    <header className={styles.panelHeading}>
      <h2>{title}</h2>
    </header>
  );
}
