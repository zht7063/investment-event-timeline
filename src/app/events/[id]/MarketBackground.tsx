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

type Instrument = { code: string; name: string };

function formatTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  } catch {
    return iso;
  }
}

/** Display name: prefer the instrument name stored in event_instruments over the upstream name (often empty). */
function displayName(p: Price, nameMap: Map<string, string>): string {
  return nameMap.get(p.code) || p.name || p.code;
}

export function MarketBackground({ instruments }: { instruments: Instrument[] }) {
  const [prices, setPrices] = useState<Price[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const codes = instruments.filter((i) => /\.\w{2}$/.test(i.code)).map((i) => i.code);
  const nameMap = new Map(instruments.map((i) => [i.code, i.name]));

  useEffect(() => {
    if (!codes.length) return;
    fetch(`/api/prices?codes=${encodeURIComponent(codes.join(","))}`)
      .then((r) => r.json())
      .then((d: { prices: Price[]; unavailable?: boolean }) => {
        setPrices(d.prices);
        setUnavailable(Boolean(d.unavailable));
      })
      .catch(() => setUnavailable(true));
  }, [codes.join(",")]);

  if (unavailable) return <p className="hint">行情数据未配置（请设置 FUYAO_API_KEY）。</p>;
  if (!prices) return null;
  if (prices.length === 0) return <p className="hint">暂无行情数据。</p>;

  return (
    <div>
      <ul className="market-prices">
        {prices.map((p) => (
          <li key={p.code} className="market-price-card">
            <strong>{displayName(p, nameMap)}</strong>{" "}
            {p.lastPrice !== null && <span>{p.lastPrice.toFixed(2)}</span>}
            {p.changeRatioPct !== null && (
              <span className={p.changeRatioPct >= 0 ? "price-up" : "price-down"}>
                {p.changeRatioPct >= 0 ? "+" : ""}{p.changeRatioPct.toFixed(2)}%
              </span>
            )}
            {p.timestamp && <span className="meta">{formatTime(p.timestamp)}</span>}
          </li>
        ))}
      </ul>
      <p className="hint">行情数据仅作背景参考，不作事件真实性证据。</p>
    </div>
  );
}
