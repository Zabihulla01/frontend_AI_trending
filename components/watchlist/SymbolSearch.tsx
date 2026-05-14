"use client";

import { ChangeEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useMarketStore } from "@/store/useMarketStore";

interface SymbolSuggestion {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
}

const SEARCH_DEBOUNCE_MS = 250;

export default function SymbolSearch() {
  const addSymbol = useMarketStore((state) => state.addSymbol);
  const registerValidSymbols = useMarketStore((state) => state.registerValidSymbols);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SymbolSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      return;
    }

    const abortController = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetch(
          `/api/symbols?q=${encodeURIComponent(normalizedQuery)}&limit=10`,
          { signal: abortController.signal }
        );

        if (!response.ok) {
          throw new Error(`Search failed with status ${response.status}`);
        }

        const data = (await response.json()) as SymbolSuggestion[];

        if (abortController.signal.aborted) {
          return;
        }

        registerValidSymbols(data.map((item) => item.symbol));
        setSuggestions(data);
        setIsOpen(true);
        setActiveIndex(data.length > 0 ? 0 : -1);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setSuggestions([]);
        setIsOpen(true);
        setActiveIndex(-1);
        setErrorMessage(error instanceof Error ? error.message : "Unable to search symbols");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      abortController.abort();
    };
  }, [query, registerValidSymbols]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextQuery = event.target.value.toUpperCase();

    setQuery(nextQuery);

    if (!nextQuery.trim()) {
      setSuggestions([]);
      setIsLoading(false);
      setIsOpen(false);
      setActiveIndex(-1);
      setErrorMessage(null);
      return;
    }

    setIsOpen(true);
  }

  function selectSuggestion(suggestion: SymbolSuggestion) {
    addSymbol(suggestion.symbol);
    setQuery("");
    setSuggestions([]);
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || suggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const suggestion = suggestions[activeIndex];

      if (suggestion) {
        selectSuggestion(suggestion);
      }
    }

    if (event.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  const showDropdown = isOpen && query.trim().length > 0;
  const showEmptyState = showDropdown && !isLoading && !errorMessage && suggestions.length === 0;

  return (
    <div className="relative">
      <label
        htmlFor="symbol-search"
        className="mb-2 block text-xs font-medium uppercase tracking-[0.22em] text-slate-500"
      >
        Symbol search
      </label>
      <input
        ref={inputRef}
        id="symbol-search"
        type="search"
        value={query}
        onChange={handleChange}
        onFocus={() => query.trim() && setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search BTC, ETH, SOL..."
        autoComplete="off"
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-medium text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls="symbol-search-results"
      />

      {showDropdown ? (
        <div
          id="symbol-search-results"
          className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-2xl shadow-black/40"
          role="listbox"
        >
          {isLoading ? (
            <div className="px-3 py-4 text-sm text-slate-400">Searching Binance symbols...</div>
          ) : null}

          {errorMessage ? (
            <div className="px-3 py-4 text-sm text-red-300">{errorMessage}</div>
          ) : null}

          {!isLoading &&
            !errorMessage &&
            suggestions.map((suggestion, index) => {
              const isActive = index === activeIndex;

              return (
                <button
                  key={suggestion.symbol}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                  className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 px-3 py-3 text-left transition ${
                    isActive ? "bg-emerald-400/10" : "hover:bg-slate-900"
                  }`}
                  role="option"
                  aria-selected={isActive}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">
                      {suggestion.symbol}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-400">
                      {suggestion.baseAsset} / {suggestion.quoteAsset}
                    </span>
                  </span>
                  <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200">
                    {suggestion.status}
                  </span>
                </button>
              );
            })}

          {showEmptyState ? (
            <div className="px-3 py-4">
              <p className="text-sm font-medium text-slate-200">No Binance USDT pairs found.</p>
              <p className="mt-1 text-xs text-slate-500">Try BTC, ETH, SOL, or XRP.</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
