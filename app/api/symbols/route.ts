import { NextRequest, NextResponse } from "next/server";
import { searchBinanceSymbols } from "@/services/binance";
import { consumeRateLimit, parseBoundedInteger } from "@/services/requestGuard";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q") ?? "";
  const limit = parseBoundedInteger(searchParams.get("limit"), 10, 1, 20);
  const rateLimit = consumeRateLimit(request, "symbols", 30);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many symbol-search requests. Please retry shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } }
    );
  }

  if (limit === null) {
    return NextResponse.json({ error: "Invalid search parameters." }, { status: 400 });
  }

  try {
    const data = await searchBinanceSymbols(query, limit);

    return NextResponse.json(data, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[api/symbols] Binance request failed", error);
    return NextResponse.json({ error: "Symbol search is temporarily unavailable." }, { status: 502 });
  }
}
