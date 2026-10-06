import { render, screen, within, waitFor } from "@testing-library/react";
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
    expect(within(row).getByRole("link", { name: "Review changes" })).toHaveAttribute("href", "/runs/r-done/review");
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

  it("announces a disconnected daemon", async () => {
    setup({ connection: "reconnecting" });
    expect(await screen.findByRole("status")).toHaveTextContent(/daemon.*(disconnected|reconnecting)/i);
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
    expect(screen.getByTestId("dashboard-card-duration")).toHaveTextContent("—");
    expect(screen.getByTestId("dashboard-card-spend")).not.toHaveTextContent("$0");
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
});
