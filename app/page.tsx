import Header from "@/components/layout/Header";
import TradingChart from "@/components/chart/TradingChart";
import Watchlist from "@/components/watchlist/Watchlist";
import AIAnalysis from "@/components/analysis/AIAnalysis";
import AlertPanel from "@/components/alerts/AlertPanel";
import RiskCalculator from "@/components/risk/RiskCalculator";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#020617] text-white">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <Header />
        <section className="rounded-3xl border border-slate-800 bg-slate-950/90 p-6 shadow-2xl shadow-slate-900/40">
          <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-slate-500">Trading dashboard</p>
              <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">
                Live candlestick chart
              </h1>
            </div>
            <p className="max-w-xl text-sm leading-6 text-slate-400">
              Select a symbol and interval, then apply the settings to refresh the chart.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-6">
              <Watchlist />
              <AlertPanel />
              <RiskCalculator />
              <AIAnalysis />
            </div>
            <TradingChart />
          </div>
        </section>
      </div>
    </main>
  );
}
