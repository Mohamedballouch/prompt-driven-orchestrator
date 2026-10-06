import { describe, expect, it } from "vitest";
import {
  dashboardWindow, spendTrend, formatAge, formatRate, periodLabel, DEFAULT_DASHBOARD_PERIOD,
} from "./dashboardMetrics";
import type { StatsCostPeriod } from "../types";

const NOW = new Date("2033-04-07T15:30:00.000Z");

function period(bucket: string, usd: number | null, partial = false, unavailable = 0): StatsCostPeriod {
  return {
    bucket, usd, average_usd: usd, median_usd: usd, estimated: true, partial, executions: 1,
    readable: usd === null ? 0 : 1, unknown: usd === null ? 1 : 0, unpriced_models: [], missing_reasons: [],
    harnesses: [], unit: "run",
    coverage: { complete: usd === null || partial ? 0 : 1, partial: partial ? 1 : 0, unavailable },
  } as StatsCostPeriod;
}

describe("dashboardWindow", () => {
  it("spans whole UTC days ending today, `to` excluded at tomorrow 00:00Z", () => {
    const w = dashboardWindow("7d", NOW);
    expect(w.from).toBe("2033-04-01T00:00:00.000Z");
    expect(w.to).toBe("2033-04-08T00:00:00.000Z");
    expect(w.days).toEqual([
      "2033-04-01", "2033-04-02", "2033-04-03", "2033-04-04", "2033-04-05", "2033-04-06", "2033-04-07",
    ]);
    expect(dashboardWindow("30d", NOW).days).toHaveLength(30);
    expect(DEFAULT_DASHBOARD_PERIOD).toBe("30d");
    expect(periodLabel("90d")).toBe("Last 90 days");
  });
});

describe("spendTrend", () => {
  it("tells spend, unknown, no activity and outside the data window apart", () => {
    const days = dashboardWindow("7d", NOW).days;
    const trend = spendTrend(
      days,
      [period("2033-04-03", 2.5), period("2033-04-04", null, false, 1), period("2033-04-05", 1, true)],
      "2033-04-02T09:00:00.000Z",
    );
    expect(trend.map((d) => d.state)).toEqual([
      "outside", "no_activity", "spend", "unknown", "spend", "no_activity", "no_activity",
    ]);
    expect(trend[2]).toMatchObject({ day: "2033-04-03", usd: 2.5, incomplete: false });
    expect(trend[3].usd).toBeNull();
    expect(trend[4].incomplete).toBe(true);
  });

  it("reads every day as outside the window when nothing ever ran", () => {
    const trend = spendTrend(["2033-04-06", "2033-04-07"], [], null);
    expect(trend.every((d) => d.state === "outside")).toBe(true);
  });
});

describe("formatAge / formatRate", () => {
  it("formats an age from an ISO timestamp, and — for none", () => {
    expect(formatAge(null, NOW)).toBe("—");
    expect(formatAge("2033-04-07T15:29:40.000Z", NOW)).toBe("just now");
    expect(formatAge("2033-04-07T15:10:00.000Z", NOW)).toBe("20 min");
    expect(formatAge("2033-04-07T12:30:00.000Z", NOW)).toBe("3 h");
    expect(formatAge("2033-04-05T15:30:00.000Z", NOW)).toBe("2 d");
  });
  it("formats a rate as a whole percent, — when undefined", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(1 / 3)).toBe("33%");
    expect(formatRate(1)).toBe("100%");
  });
});
