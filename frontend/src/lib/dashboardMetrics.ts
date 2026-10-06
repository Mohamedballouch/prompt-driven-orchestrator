import type { StatsCostPeriod } from "../types";

/** Dashboard reporting periods (UI05): whole UTC days ending today. */
export type DashboardPeriod = "7d" | "30d" | "90d";
export const DASHBOARD_PERIODS: DashboardPeriod[] = ["7d", "30d", "90d"];
export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = "30d";
const PERIOD_DAYS: Record<DashboardPeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;

/** The UTC calendar day of `now` (`YYYY-MM-DD`): the key a window is valid for. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function periodLabel(period: DashboardPeriod): string {
  return `Last ${PERIOD_DAYS[period]} days`;
}

/** `[from, to)` in UTC ISO strings, `to` = tomorrow 00:00Z, and the calendar days in it. */
export function dashboardWindow(
  period: DashboardPeriod,
  now: Date = new Date(),
): { from: string; to: string; days: string[] } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const count = PERIOD_DAYS[period];
  const start = today - (count - 1) * DAY_MS;
  const days = Array.from({ length: count }, (_, i) => new Date(start + i * DAY_MS).toISOString().slice(0, 10));
  return {
    from: new Date(start).toISOString(),
    to: new Date(today + DAY_MS).toISOString(),
    days,
  };
}

/** One calendar day of the spend trend (docs/reference/dashboard-metrics.md). */
export interface SpendDay {
  day: string;
  state: "spend" | "unknown" | "no_activity" | "outside";
  usd: number | null;
  /** Some of the day's spend is unknown or a lower bound. */
  incomplete: boolean;
  runs: number;
}

export function spendTrend(
  days: string[],
  periods: StatsCostPeriod[],
  firstRunAt: string | null,
): SpendDay[] {
  const byDay = new Map(periods.map((p) => [p.bucket, p]));
  const firstDay = firstRunAt ? firstRunAt.slice(0, 10) : null;
  return days.map((day) => {
    const p = byDay.get(day);
    if (p) {
      return {
        day,
        state: p.usd === null ? "unknown" : "spend",
        usd: p.usd,
        incomplete: p.coverage.partial + p.coverage.unavailable > 0 || p.partial,
        runs: p.executions,
      };
    }
    const outside = firstDay === null || day < firstDay;
    return { day, state: outside ? "outside" : "no_activity", usd: null, incomplete: false, runs: 0 };
  });
}

/** « just now » / « 20 min » / « 3 h » / « 2 d »; « — » without a timestamp. */
export function formatAge(since: string | null, now: Date = new Date()): string {
  if (!since) return "—";
  const t = Date.parse(since);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} d`;
}

export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}
