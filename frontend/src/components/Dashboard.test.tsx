import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSummary, StatsCost, WsMessage } from "../types";

vi.mock("../api", () => ({ fetchDashboard: vi.fn(), fetchStatsCost: vi.fn() }));
import { fetchDashboard, fetchStatsCost } from "../api";
import Dashboard from "./Dashboard";

const NO_SOCKET: (handler: (m: WsMessage) => void) => () => void = () => () => {};

function summary(over: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    computed_at: new Date().toISOString(), from: "f", to: "t", project: null,
    first_run_at: "2020-01-01T00:00:00.000Z",
    projects: [{ id: "/home/u/repo", name: "repo", runs: 3 }, { id: "p-web", name: "web", runs: 1 }],
    cohort: { started: 6, completed: 4, failed: 1, halted: 0, skipped: 1, archived: 0, running: 0, awaiting_user: 0, paused: 0 },
    completion: { completed: 4, eligible: 5, rate: 0.8 },
    completion_time: { measured: 4, median_ms: 754_000, p95_ms: null },
    live: { running: 1, awaiting_user: 1, paused: 0 },
    attention_total: 1,
    attention: [{
      kind: "waiting_for_user", run_id: "r-wait", run_name: "Fix login", pipeline_name: "impl",
      project_id: "/home/u/repo", project_name: "repo", node_id: "worker", node_name: "Worker",
      reason: "Which layout?", since: new Date(Date.now() - 20 * 60_000).toISOString(),
    }],
    active_total: 1,
    active: [{
      run_id: "r-live", run_name: null, pipeline_name: "impl", project_id: "/home/u/repo", project_name: "repo",
      status: "running", started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      current_nodes: [{ id: "a", name: "Build", status: "running" }, { id: "b", name: "Test", status: "running" }],
      cost_usd: null, cost_partial: false,
    }],
    recent_results: [{
      run_id: "r-done", run_name: "Add search", pipeline_name: "impl", project_id: "/home/u/repo",
      project_name: "repo", completed_at: new Date().toISOString(), duration_ms: 754_000, review_pending: 2,
    }],
    ...over,
  };
}

const COST = {
  harnesses: ["claude"],
  total: {
    usd: 12.5, average_usd: 3, median_usd: 3, estimated: true, partial: false, executions: 6, readable: 4,
    unknown: 2, unpriced_models: [], missing_reasons: [], harnesses: [], unit: "run",
    coverage: { complete: 4, partial: 1, unavailable: 1 },
  },
  by_period: [], by_pipeline: [], by_project: [], by_model: [], resolved: [],
  model_total: {
    usd: null, average_usd: null, median_usd: null, estimated: false, partial: false, executions: 0, readable: 0,
    unknown: 0, unpriced_models: [], missing_reasons: [], harnesses: [], unit: "slice",
    coverage: { complete: 0, partial: 0, unavailable: 0 },
  },
  model_total_by_period: [],
} as unknown as StatsCost;

function setup(props: Partial<React.ComponentProps<typeof Dashboard>> = {}) {
  const handlers = { onOpenRun: vi.fn(), onStartRun: vi.fn(), onOpenStats: vi.fn() };
  render(<Dashboard connection="connected" subscribe={NO_SOCKET} {...handlers} {...props} />);
  return handlers;
}

beforeEach(() => {
  vi.mocked(fetchDashboard).mockReset().mockResolvedValue(summary());
  vi.mocked(fetchStatsCost).mockReset().mockResolvedValue(COST);
});

describe("Dashboard (UI05)", () => {
  it("labels historical cards with the period and live cards as Live now", async () => {
    setup();
    await screen.findByTestId("dashboard-card-completed");
    expect(screen.getByTestId("dashboard-card-spend")).toHaveTextContent("Last 30 days");
    expect(screen.getByTestId("dashboard-card-spend")).toHaveTextContent("~$12.50");
    expect(screen.getByTestId("dashboard-card-spend")).toHaveTextContent("6 Runs: 4 complete · 1 partial · 1 unavailable");
    expect(screen.getByTestId("dashboard-card-completed")).toHaveTextContent("4 of 5");
    expect(screen.getByTestId("dashboard-card-completed")).toHaveTextContent("80%");
    expect(screen.getByTestId("dashboard-card-duration")).toHaveTextContent("12m 34s");
    expect(screen.getByTestId("dashboard-card-duration")).toHaveTextContent("4 completed Runs");
    expect(screen.getByTestId("dashboard-card-live")).toHaveTextContent("Live now");
    expect(screen.getByTestId("dashboard-card-attention")).toHaveTextContent("Live now");
  });

  it("opens the Run and Node behind an attention item without acting on it", async () => {
    const { onOpenRun } = setup();
    const item = await screen.findByTestId("dashboard-attention-item");
    expect(item).toHaveTextContent("Waiting for you");
    expect(item).toHaveTextContent("Fix login");
    expect(item).toHaveTextContent("Worker");
    expect(item).toHaveTextContent("Which layout?");
    expect(item).toHaveTextContent("20 min");
    await userEvent.click(within(item).getByRole("button", { name: "Open Fix login" }));
    expect(onOpenRun).toHaveBeenCalledWith("r-wait", "worker");
  });

  it("describes parallel work, unknown cost and status in words", async () => {
    setup();
    const row = await screen.findByTestId("dashboard-active-run");
    expect(row).toHaveTextContent("impl"); // run_name null → pipeline name
    expect(row).toHaveTextContent("2 steps in parallel");
    expect(row).toHaveTextContent("Running");
    expect(row).toHaveTextContent("—");
    expect(row).not.toHaveTextContent("$0");
  });

  it("offers Open result and Review changes for a completed Run", async () => {
    const { onOpenRun } = setup();
    const row = await screen.findByTestId("dashboard-result");
    expect(row).toHaveTextContent("2 review comments pending");
    const review = within(row).getByRole("link", { name: "Review changes" });
    expect(review).toHaveAttribute("href", "/runs/r-done/review");
    // A new browser tab: the editor tabs hidden under the Dashboard keep their unsaved edits.
    expect(review).toHaveAttribute("target", "_blank");
    expect(review).toHaveAttribute("rel", expect.stringContaining("noopener"));
    await userEvent.click(within(row).getByRole("button", { name: "Open result" }));
    expect(onOpenRun).toHaveBeenCalledWith("r-done", null);
  });

  it("refetches with the chosen Project id, path ids included", async () => {
    setup();
    await screen.findByTestId("dashboard-card-completed");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Project" }), "/home/u/repo");
    await waitFor(() => expect(vi.mocked(fetchDashboard).mock.lastCall?.[2]).toBe("/home/u/repo"));
    expect(vi.mocked(fetchStatsCost).mock.lastCall?.[5]).toBe("/home/u/repo");
  });

  it("keeps the cost card when the summary fails, and says so", async () => {
    vi.mocked(fetchDashboard).mockReset().mockRejectedValue(new Error("daemon said no"));
    setup();
    expect(await screen.findByText(/daemon said no/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("dashboard-card-spend")).toHaveTextContent("~$12.50"));
  });

  it("announces a daemon that dropped after being connected", async () => {
    const handlers = { onOpenRun: vi.fn(), onStartRun: vi.fn(), onOpenStats: vi.fn() };
    const { rerender } = render(<Dashboard connection="connected" subscribe={NO_SOCKET} {...handlers} />);
    await screen.findByTestId("dashboard-card-completed");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<Dashboard connection="reconnecting" subscribe={NO_SOCKET} {...handlers} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/daemon.*(disconnected|reconnecting)/i);
  });

  it("gives a socket that never connected a grace before announcing it", async () => {
    // The socket starts « disconnected » on every fresh load, before its first open.
    vi.useFakeTimers();
    try {
      setup({ connection: "disconnected" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_900);
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.getByRole("status")).toHaveTextContent(/daemon disconnected/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the stale warning up while a retry is in flight", async () => {
    vi.mocked(fetchDashboard)
      .mockReset()
      .mockResolvedValueOnce(summary())
      .mockRejectedValueOnce(new Error("boom"))
      .mockReturnValueOnce(new Promise(() => {}));
    setup();
    await screen.findByTestId("dashboard-card-completed");
    await userEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
    expect(await screen.findByText(/refresh failed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    expect(screen.getByText(/refresh failed/)).toBeInTheDocument();
  });

  it("titles an unnamed Run by its Pipeline and tells it apart by a short id", async () => {
    const base = summary();
    vi.mocked(fetchDashboard).mockReset().mockResolvedValue(summary({
      active: [{ ...base.active[0], run_id: "20330402-090000-abc1234", run_name: null }],
      recent_results: [{ ...base.recent_results[0], run_id: "20330401-080000-def5678", run_name: null }],
    }));
    setup();
    const active = await screen.findByTestId("dashboard-active-run");
    expect(active.textContent?.match(/impl/g)).toHaveLength(1);
    expect(active).toHaveTextContent("abc1234");
    const result = screen.getByTestId("dashboard-result");
    expect(result.textContent?.match(/impl/g)).toHaveLength(1);
    expect(result).toHaveTextContent("def5678");
  });

  it("says which lists the period does not narrow", async () => {
    setup();
    await screen.findByTestId("dashboard-card-completed");
    expect(screen.getByTestId("dashboard")).toHaveTextContent("Live now items ignore the period");
    expect(screen.getByRole("region", { name: "Needs attention" })).toHaveTextContent(
      "Live now · failures from the last 7 days",
    );
    expect(screen.getByRole("region", { name: "Recent results" })).toHaveTextContent("Latest 8 · any date");
  });

  it("names the row each repeated action belongs to", async () => {
    setup();
    const result = await screen.findByTestId("dashboard-result");
    expect(within(result).getByRole("button", { name: "Open result" })).toHaveAccessibleDescription("Add search");
    expect(within(result).getByRole("link", { name: "Review changes" })).toHaveAccessibleDescription("Add search");
    const item = screen.getByTestId("dashboard-attention-item");
    expect(within(item).getByRole("button", { name: "Open Fix login" })).toHaveAccessibleDescription("Fix login");
  });

  it("shows an empty instance plainly, with — instead of zeros", async () => {
    vi.mocked(fetchDashboard).mockReset().mockResolvedValue(summary({
      first_run_at: null, projects: [],
      cohort: { started: 0, completed: 0, failed: 0, halted: 0, skipped: 0, archived: 0, running: 0, awaiting_user: 0, paused: 0 },
      completion: { completed: 0, eligible: 0, rate: null },
      completion_time: { measured: 0, median_ms: null, p95_ms: null },
      live: { running: 0, awaiting_user: 0, paused: 0 },
      attention_total: 0, attention: [], active_total: 0, active: [], recent_results: [],
    }));
    vi.mocked(fetchStatsCost).mockReset().mockResolvedValue({
      ...COST, total: { ...COST.total, usd: null, executions: 0, readable: 0, unknown: 0, coverage: { complete: 0, partial: 0, unavailable: 0 } },
    } as StatsCost);
    setup();
    expect(await screen.findByText("Nothing needs your attention.")).toBeInTheDocument();
    expect(screen.getByText("No runs in progress.")).toBeInTheDocument();
    expect(screen.getByText("No completed runs yet.")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-card-completed")).toHaveTextContent("—");
    // One « — » for the whole figure, not a « — » count beside a « — » rate.
    expect(screen.getByTestId("dashboard-card-completed").textContent?.match(/—/g)).toHaveLength(1);
    expect(screen.getByTestId("dashboard-card-duration")).toHaveTextContent("—");
    expect(screen.getByTestId("dashboard-card-spend")).not.toHaveTextContent("$0");
    // No recorded spend: the axis names no maximum.
    expect(within(screen.getByTestId("dashboard-spend-trend")).queryByText("—")).not.toBeInTheDocument();
  });

  it("starts a run from a button whose name never collides with New Run", async () => {
    const { onStartRun } = setup();
    await screen.findByTestId("dashboard-card-completed");
    expect(screen.queryByRole("button", { name: /new run/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start a run" }));
    expect(onStartRun).toHaveBeenCalled();
  });

  it("marks an unknown spend day and a day outside the data window", async () => {
    vi.mocked(fetchDashboard).mockReset().mockResolvedValue(summary({ first_run_at: new Date().toISOString() }));
    setup();
    await screen.findByTestId("dashboard-spend-trend");
    const days = screen.getAllByTestId("dashboard-spend-day");
    expect(days.length).toBe(30);
    expect(days[0]).toHaveAttribute("data-state", "outside");
    expect(days[0]).toHaveAttribute("title", expect.stringMatching(/before the first recorded run/i));
  });

  it("marks a day whose Runs have no known cost as unknown", async () => {
    const today = new Date().toISOString().slice(0, 10);
    vi.mocked(fetchStatsCost).mockReset().mockResolvedValue({
      ...COST,
      by_period: [{
        ...COST.total, bucket: today, usd: null, partial: false, executions: 2, readable: 0, unknown: 2,
        coverage: { complete: 0, partial: 0, unavailable: 2 },
      }],
    } as StatsCost);
    setup();
    await waitFor(() =>
      expect(screen.getAllByTestId("dashboard-spend-day").some((d) => d.dataset.state === "unknown")).toBe(true),
    );
    const unknown = screen.getAllByTestId("dashboard-spend-day").filter((d) => d.dataset.state === "unknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toHaveAttribute("title", `${today}: cost unknown · 2 Runs`);
  });
});
