"use client";

import { useEffect, useState } from "react";

type Price = {
  code: string;
  name: string;
  lastPrice: number | null;
  changeRatioPct: number | null;
  turnover: number | null;
  timestamp: string | null;
};

function formatTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  } catch {
    return iso;
  }
}

export function MarketBackground({ codes }: { codes: string[] }) {
  const [prices, setPrices] = useState<Price[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    // Only fetch for real A-share tickers
    const real = codes.filter((c) => /\.\w{2}$/.test(c));
    if (!real.length) return;
    fetch(`/api/prices?codes=${encodeURIComponent(real.join(","))}`)
      .then((r) => r.json())
      .then((d: { prices: Price[]; unavailable?: boolean }) => {
        setPrices(d.prices);
        setUnavailable(Boolean(d.unavailable));
      })
      .catch(() => setUnavailable(true));
  }, [codes.join(",")]);

  if (unavailable) return <p className="hint">Market data: not configured (set FUYAO_API_KEY).</p>;
  if (!prices) return null;
  if (prices.length === 0) return <p className="hint">No market data available for these tickers.</p>;

  return (
    <div>
      <ul style={{ listStyle: "none", padding: 0, display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
        {prices.map((p) => (
          <li
            key={p.code}
            style={{
              padding: "0.5rem 0.8rem",
              border: "1px solid var(--line)",
              background: "var(--card)",
              fontFamily: "var(--mono)",
              fontSize: "0.85rem",
            }}
          >
            <strong>{p.name || p.code}</strong>{" "}
            {p.lastPrice !== null && <span>{p.lastPrice.toFixed(2)}</span>}
            {p.changeRatioPct !== null && (
              <span style={{ color: p.changeRatioPct >= 0 ? "var(--s-supported)" : "var(--s-denied)", marginLeft: "0.4rem" }}>
                {p.changeRatioPct >= 0 ? "+" : ""}{p.changeRatioPct.toFixed(2)}%
              </span>
            )}
            {p.timestamp && <span className="meta" style={{ display: "block" }}>{formatTime(p.timestamp)}</span>}
          </li>
        ))}
      </ul>
      <p className="hint">Market data is for background only and is not used as evidence of event truth.</p>
    </div>
  );
}
