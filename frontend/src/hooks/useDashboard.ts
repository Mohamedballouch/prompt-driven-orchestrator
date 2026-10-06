import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDashboard, fetchStatsCost } from "../api";
import type { DashboardSummary, StatsCost, WsMessage } from "../types";
import { dashboardWindow, utcDayKey, type DashboardPeriod } from "../lib/dashboardMetrics";

/** A daemon event refreshes the summary at most this often (docs/reference/dashboard-metrics.md « Freshness »). */
export const SUMMARY_REFRESH_DEBOUNCE_MS = 2000;

export interface UseDashboardOptions {
  /** Fetch and listen only while the Dashboard is on screen. */
  active: boolean;
  period: DashboardPeriod;
  project: string | null;
  subscribe: (handler: (msg: WsMessage) => void) => () => void;
}

export interface DashboardData {
  window: { from: string; to: string; days: string[] };
  summary: DashboardSummary | null;
  summaryError: string | null;
  /** The last request failed and `summary` is the previous answer. */
  summaryStale: boolean;
  summaryLoading: boolean;
  cost: StatsCost | null;
  costError: string | null;
  costLoading: boolean;
  /** Manual refresh: summary and cost. */
  refresh: () => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useDashboard({ active, period, project, subscribe }: UseDashboardOptions): DashboardData {
  // The window is recomputed per period, not per render, so `from`/`to` are stable keys.
  // (`range`, not `window`: never shadow the browser global.)
  // `today` is read during render, so the first render after 00:00 UTC (a refresh, a
  // reactivation, any re-render) moves the window and the effects below refetch.
  const today = utcDayKey();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `today` is the day key the window depends on.
  const range = useMemo(() => dashboardWindow(period), [period, today]);
  const key = `${range.from}|${range.to}|${project ?? ""}`;

  // Each answer is stored with the request key it answered; it is exposed only for that key.
  const [summaryAnswer, setSummaryAnswer] = useState<{ key: string; data: DashboardSummary } | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [costAnswer, setCostAnswer] = useState<{ key: string; data: StatsCost } | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const summarySeq = useRef(0);
  const costSeq = useRef(0);

  const loadSummary = useCallback(() => {
    const seq = ++summarySeq.current;
    setSummaryLoading(true);
    fetchDashboard(range.from, range.to, project)
      .then((data) => {
        if (seq !== summarySeq.current) return;
        setSummaryAnswer({ key, data });
        setSummaryError(null);
      })
      .catch((error) => {
        if (seq !== summarySeq.current) return;
        setSummaryError(message(error));
      })
      .finally(() => {
        if (seq === summarySeq.current) setSummaryLoading(false);
      });
  }, [range.from, range.to, project, key]);

  const loadCost = useCallback(() => {
    const seq = ++costSeq.current;
    setCostLoading(true);
    fetchStatsCost(range.from, range.to, "day", false, false, project)
      .then((data) => {
        if (seq !== costSeq.current) return;
        setCostAnswer({ key, data });
        setCostError(null);
      })
      .catch((error) => {
        if (seq !== costSeq.current) return;
        setCostError(message(error));
      })
      .finally(() => {
        if (seq === costSeq.current) setCostLoading(false);
      });
  }, [range.from, range.to, project, key]);

  useEffect(() => {
    if (!active) return;
    // Fetch-on-activate/-key-change: the setState calls are the loading flags of a request
    // started here, not derived state (same trade-off as FsExplorerModal).
    /* eslint-disable react-hooks/set-state-in-effect */
    loadSummary();
    loadCost();
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      // A response landing after deactivation or unmount is ignored.
      // The refs are request counters, not DOM nodes: reading `.current` now is the point.
      /* eslint-disable react-hooks/exhaustive-deps */
      summarySeq.current++;
      costSeq.current++;
      /* eslint-enable react-hooks/exhaustive-deps */
      setSummaryLoading(false);
      setCostLoading(false);
    };
  }, [active, loadSummary, loadCost]);

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        loadSummary();
      }, SUMMARY_REFRESH_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [active, subscribe, loadSummary]);

  const refresh = useCallback(() => {
    loadSummary();
    loadCost();
  }, [loadSummary, loadCost]);

  const summary = summaryAnswer?.key === key ? summaryAnswer.data : null;
  const cost = costAnswer?.key === key ? costAnswer.data : null;

  return {
    window: range,
    summary,
    summaryError,
    summaryStale: summaryError !== null && summary !== null,
    summaryLoading,
    cost,
    costError,
    costLoading,
    refresh,
  };
}
