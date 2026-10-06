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

  it("moves the window to the new UTC day on the first render after midnight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2033-04-07T23:59:50.000Z"));
    vi.mocked(fetchDashboard).mockResolvedValue(summary("a"));
    vi.mocked(fetchStatsCost).mockResolvedValue(cost);
    const s = socket();
    const { result, rerender } = renderHook(() =>
      useDashboard({ active: true, period: "7d", project: null, subscribe: s.subscribe }),
    );
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetchDashboard).mock.calls[0][1]).toBe("2033-04-08T00:00:00.000Z");
    vi.setSystemTime(new Date("2033-04-08T00:00:10.000Z"));
    rerender();
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(2));
    const [from, to] = vi.mocked(fetchDashboard).mock.calls[1];
    expect(from).toBe("2033-04-02T00:00:00.000Z");
    expect(to).toBe("2033-04-09T00:00:00.000Z");
    expect(result.current.window.days.at(-1)).toBe("2033-04-08");
  });

  it("never shows the previous key's data as the new key's", async () => {
    vi.mocked(fetchDashboard).mockResolvedValueOnce(summary("a")).mockRejectedValueOnce(new Error("nope"));
    vi.mocked(fetchStatsCost).mockResolvedValue(cost);
    const s = socket();
    const { result, rerender } = renderHook(
      (props: { project: string | null }) =>
        useDashboard({ active: true, period: "30d", project: props.project, subscribe: s.subscribe }),
      { initialProps: { project: null as string | null } },
    );
    await waitFor(() => expect(result.current.summary?.computed_at).toBe("a"));
    rerender({ project: "p2" });
    await waitFor(() => expect(result.current.summaryError).toBe("nope"));
    expect(result.current.summary).toBeNull();
    expect(result.current.summaryStale).toBe(false);
  });

  it("ignores a response that lands after deactivation", async () => {
    let resolveFirst: (s: DashboardSummary) => void = () => {};
    vi.mocked(fetchDashboard).mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    vi.mocked(fetchStatsCost).mockResolvedValue(cost);
    const s = socket();
    const { result, rerender } = renderHook(
      (props: { active: boolean }) =>
        useDashboard({ active: props.active, period: "30d", project: null, subscribe: s.subscribe }),
      { initialProps: { active: true } },
    );
    rerender({ active: false });
    act(() => resolveFirst(summary("late")));
    await Promise.resolve();
    expect(result.current.summary).toBeNull();
    expect(result.current.summaryLoading).toBe(false);
  });

  it("clears the debounce timer and unsubscribes on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fetchDashboard).mockResolvedValue(summary("a"));
    vi.mocked(fetchStatsCost).mockResolvedValue(cost);
    const s = socket();
    const unsub = vi.fn();
    const subscribe = (fn: (msg: WsMessage) => void) => { const off = s.subscribe(fn); return () => { unsub(); off(); }; };
    const { unmount } = renderHook(() => useDashboard({ active: true, period: "30d", project: null, subscribe }));
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(1));
    act(() => s.emit({ type: "event" } as WsMessage));
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(fetchDashboard).toHaveBeenCalledTimes(1);
    expect(unsub).toHaveBeenCalled();
  });

  it("a cost failure leaves the summary intact", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(summary("a"));
    vi.mocked(fetchStatsCost).mockRejectedValue(new Error("cost down"));
    const s = socket();
    const { result } = renderHook(() =>
      useDashboard({ active: true, period: "30d", project: null, subscribe: s.subscribe }),
    );
    await waitFor(() => expect(result.current.costError).toBe("cost down"));
    expect(result.current.cost).toBeNull();
    expect(result.current.summary?.computed_at).toBe("a");
  });

  it("does nothing while inactive", () => {
    const s = socket();
    renderHook(() => useDashboard({ active: false, period: "30d", project: null, subscribe: s.subscribe }));
    expect(fetchDashboard).not.toHaveBeenCalled();
    expect(fetchStatsCost).not.toHaveBeenCalled();
  });
});
