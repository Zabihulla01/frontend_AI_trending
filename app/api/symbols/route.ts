import { NextRequest, NextResponse } from "next/server";
import { searchBinanceSymbols } from "@/services/binance";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q") ?? "";
  const limitParam = Number(searchParams.get("limit") ?? "10");
  const limit = Number.isNaN(limitParam) ? 10 : Math.min(Math.max(limitParam, 1), 20);

  try {
    const data = await searchBinanceSymbols(query, limit);

    return NextResponse.json(data, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to search Binance symbols";

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
