import { NextRequest, NextResponse } from "next/server";
import { fetchBinanceKlines, isValidBinanceInterval, isValidBinanceSymbol } from "@/services/binance";
import { consumeRateLimit, parseBoundedInteger } from "@/services/requestGuard";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbol = searchParams.get("symbol") ?? "BTCUSDT";
  const interval = searchParams.get("interval") ?? "1h";
  const limit = parseBoundedInteger(searchParams.get("limit"), 100, 1, 1000);
  const rateLimit = consumeRateLimit(request, "klines", 60);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many market-data requests. Please retry shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } }
    );
  }

  if (!isValidBinanceSymbol(symbol) || !isValidBinanceInterval(interval) || limit === null) {
    return NextResponse.json({ error: "Invalid market-data parameters." }, { status: 400 });
  }

  try {
    const data = await fetchBinanceKlines(symbol, interval, limit);
    return NextResponse.json(data, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[api/klines] Binance request failed", error);
    return NextResponse.json({ error: "Market data is temporarily unavailable." }, { status: 502 });
  }
}
