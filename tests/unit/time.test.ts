import { describe, expect, it } from "vitest";
import { formatTime, parseTime } from "@/domain/time";

describe("time", () => {
  it("keeps unknown as unknown", () => {
    expect(parseTime("")).toBeNull();
    expect(parseTime(undefined)).toBeNull();
    expect(formatTime(null)).toBe("未知");
  });

  it("treats date-only input as a Beijing day and never invents a time of day", () => {
    const t = parseTime("2026-03-05")!;
    expect(t).toEqual({ iso: "2026-03-04T16:00:00.000Z", precision: "day" });
    expect(formatTime(t.iso, t.precision)).toBe("2026-03-05");
  });

  it("reads zoneless datetimes as Beijing time and keeps explicit zones", () => {
    expect(parseTime("2026-03-05 19:30")!.iso).toBe("2026-03-05T11:30:00.000Z");
    expect(parseTime("2026-03-05T19:30:00Z")!.iso).toBe("2026-03-05T19:30:00.000Z");
    expect(formatTime("2026-03-05T11:30:00.000Z")).toBe("2026-03-05 19:30");
  });

  it("rejects invalid dates", () => {
    expect(() => parseTime("2026-02-30")).toThrow();
    expect(() => parseTime("not a date")).toThrow();
  });
});
