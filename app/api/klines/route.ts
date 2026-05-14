import { NextRequest, NextResponse } from "next/server";
import { fetchBinanceKlines } from "@/services/binance";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbol = searchParams.get("symbol") ?? "BTCUSDT";
  const interval = searchParams.get("interval") ?? "1h";
  const limitParam = Number(searchParams.get("limit") ?? "100");
  const limit = Number.isNaN(limitParam) ? 100 : Math.min(Math.max(limitParam, 1), 1000);

  try {
    const data = await fetchBinanceKlines(symbol, interval, limit);
    return NextResponse.json(data, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Binance data";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
