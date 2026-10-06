import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSummary, StatsCost, WsMessage } from "../types";

vi.mock("../api", () => ({
  fetchDashboard: vi.fn(),
  fetchStatsCost: vi.fn(),
}));
import { fetchDashboard, fetchStatsCost } from "../api";
import { useDashboard } from "./useDashboard";

const summary = (computed_at: string): DashboardSummary => ({
  computed_at, from: "f", to: "t", project: null, first_run_at: null, projects: [],
  cohort: { started: 0, completed: 0, failed: 0, halted: 0, skipped: 0, archived: 0, running: 0, awaiting_user: 0, paused: 0 },
  completion: { completed: 0, eligible: 0, rate: null },
  completion_time: { measured: 0, median_ms: null, p95_ms: null },
  live: { running: 0, awaiting_user: 0, paused: 0 },
  attention_total: 0, attention: [], active_total: 0, active: [], recent_results: [],
});
const cost = { total: { usd: 1 } } as unknown as StatsCost;

function socket() {
  let handler: ((msg: WsMessage) => void) | null = null;
  return {
    subscribe: (fn: (msg: WsMessage) => void) => { handler = fn; return () => { handler = null; }; },
    emit: (msg: WsMessage) => handler?.(msg),
  };
}

beforeEach(() => {
  vi.mocked(fetchDashboard).mockReset();
  vi.mocked(fetchStatsCost).mockReset();
});
afterEach(() => vi.useRealTimers());

describe("useDashboard (UI04)", () => {
  it("loads the summary and the cost of the window, with the Project filter", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(summary("a"));
    vi.mocked(fetchStatsCost).mockResolvedValue(cost);
    const s = socket();
    const { result } = renderHook(() =>
      useDashboard({ active: true, period: "7d", project: "/home/u/repo", subscribe: s.subscribe }),
    );
    await waitFor(() => expect(result.current.summary?.computed_at).toBe("a"));
    await waitFor(() => expect(result.current.cost).toBe(cost));
    const [from, to, project] = vi.mocked(fetchDashboard).mock.calls[0];
    expect(project).toBe("/home/u/repo");
    expect(vi.mocked(fetchStatsCost)).toHaveBeenCalledWith(from, to, "day", false, false, "/home/u/repo");
  });

  it("keeps the last summary and flags it stale when a refetch fails; the cost stays", async () => {
    vi.mocked(fetchDashboard).mockResolvedValueOnce(summary("a")).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(fetchStatsCost).mockResolvedValue(cost);
    const s = socket();
    const { result } = renderHook(() =>
      useDashboard({ active: true, period: "30d", project: null, subscribe: s.subscribe }),
    );
    await waitFor(() => expect(result.current.summary?.computed_at).toBe("a"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.summaryError).toBe("boom"));
    expect(result.current.summary?.computed_at).toBe("a");
    expect(result.current.summaryStale).toBe(true);
    expect(result.current.cost).toBe(cost);
  });

  it("refreshes only the summary, debounced, after daemon events", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fetchDashboard).mockResolvedValue(summary("a"));
    vi.mocked(fetchStatsCost).mockResolvedValue(cost);
    const s = socket();
    renderHook(() => useDashboard({ active: true, period: "30d", project: null, subscribe: s.subscribe }));
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(1));
    act(() => {
      s.emit({ type: "event" } as WsMessage);
      s.emit({ type: "event" } as WsMessage);
      s.emit({ type: "resync" } as WsMessage);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(fetchDashboard).toHaveBeenCalledTimes(2);
    expect(fetchStatsCost).toHaveBeenCalledTimes(1);
  });

  it("drops a stale response that lands after a newer request", async () => {
    let resolveFirst: (s: DashboardSummary) => void = () => {};
    vi.mocked(fetchDashboard)
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce(summary("second"));
    vi.mocked(fetchStatsCost).mockResolvedValue(cost);
    const s = socket();
    const { result, rerender } = renderHook(
      (props: { project: string | null }) =>
        useDashboard({ active: true, period: "30d", project: props.project, subscribe: s.subscribe }),
      { initialProps: { project: null as string | null } },
    );
    rerender({ project: "p2" });
    await waitFor(() => expect(result.current.summary?.computed_at).toBe("second"));
    act(() => resolveFirst(summary("first")));
    await Promise.resolve();
    expect(result.current.summary?.computed_at).toBe("second");
  });

  it("does nothing while inactive", () => {
    const s = socket();
    renderHook(() => useDashboard({ active: false, period: "30d", project: null, subscribe: s.subscribe }));
    expect(fetchDashboard).not.toHaveBeenCalled();
    expect(fetchStatsCost).not.toHaveBeenCalled();
  });
});
