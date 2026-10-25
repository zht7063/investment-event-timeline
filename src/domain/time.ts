import type { Precision } from "./types";

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

/**
 * Parse user/provider input into UTC ISO + precision. Date-only strings are Beijing calendar days.
 * Returns null for empty input: unknown times stay unknown.
 */
export function parseTime(input: string | null | undefined): { iso: string; precision: Precision } | null {
  const s = input?.trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    return { iso: beijingToIso(+m[1], +m[2], +m[3]), precision: "day" };
  }
  if ((m = s.match(/^(\d{4})-(\d{2})$/))) return { iso: beijingToIso(+m[1], +m[2], 1), precision: "month" };
  if ((m = s.match(/^(\d{4})$/))) return { iso: beijingToIso(+m[1], 1, 1), precision: "year" };
  // Datetime without zone is Beijing time; with zone is taken as given.
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  const d = new Date(hasZone ? s : `${s.replace(" ", "T")}+08:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`无法解析时间：${s}`);
  return { iso: d.toISOString(), precision: "datetime" };
}

function beijingToIso(y: number, mo: number, d: number): string {
  const t = Date.UTC(y, mo - 1, d) - BEIJING_OFFSET_MS;
  const back = new Date(t + BEIJING_OFFSET_MS);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) throw new Error(`无效日期：${y}-${mo}-${d}`);
  return new Date(t).toISOString();
}

/** Display in Beijing time at the stored precision; never invents a time of day. */
export function formatTime(iso: string | null | undefined, precision: Precision = "datetime"): string {
  if (!iso) return "未知";
  const b = new Date(new Date(iso).getTime() + BEIJING_OFFSET_MS).toISOString();
  const [date, time] = [b.slice(0, 10), b.slice(11, 16)];
  switch (precision) {
    case "year":
      return `${date.slice(0, 4)}年`;
    case "quarter":
      return `${date.slice(0, 4)}年Q${Math.floor((+date.slice(5, 7) - 1) / 3) + 1}`;
    case "month":
      return date.slice(0, 7);
    case "day":
      return date;
    default:
      return `${date} ${time}`;
  }
}

export const isAtOrBefore = (iso: string | null, asOf: string) => iso !== null && iso <= asOf;
