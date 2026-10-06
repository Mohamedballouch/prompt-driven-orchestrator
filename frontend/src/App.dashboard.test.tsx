// UI05 — the Dashboard is the landing view, and a trip through it never costs the
// editor anything: open tabs stay mounted (hidden) underneath, and the editor's
// keyboard shortcuts stay off while the canvas is not on screen.
//
// Mounts the REAL App with the harness of App.settingsClose.test.tsx (FakeWebSocket,
// ResizeObserver stub, an explicit `./api` factory that throws on an unlisted export).
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const realResizeObserver = globalThis.ResizeObserver;

// A never-opening socket keeps App in `disconnected` state (a cold start).
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  readyState = FakeWebSocket.CONNECTING;
  private handlers = new Map<string, Set<(e: unknown) => void>>();
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, cb: (e: unknown) => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(cb);
  }
  removeEventListener(type: string, cb: (e: unknown) => void) {
    this.handlers.get(type)?.delete(cb);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    for (const cb of this.handlers.get("close") ?? []) cb({});
  }
  send() {}
}

beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  vi.stubGlobal("WebSocket", FakeWebSocket);
  Element.prototype.scrollIntoView ??= () => {};
});

afterAll(() => {
  if (realResizeObserver) globalThis.ResizeObserver = realResizeObserver;
  vi.unstubAllGlobals();
});

vi.mock("./api", () => {
  const emptyAggregate = {
    usd: null,
    average_usd: null,
    median_usd: null,
    estimated: false,
    partial: false,
    executions: 0,
    readable: 0,
    unknown: 0,
    unpriced_models: [],
    missing_reasons: [],
    harnesses: [],
    unit: "run",
    coverage: { complete: 0, partial: 0, unavailable: 0 },
  };
  const run = {
    run_id: "r1",
    pipeline_name: "impl",
    status: "running",
    started_at: "2033-04-02T09:00:00.000Z",
    effective_repo: "/repo",
  };
  const runState = {
    run_id: "r1",
    status: "running",
    pipeline_name: "impl",
    name: null,
    input: null,
    started_at: "2033-04-02T09:00:00.000Z",
    completed_at: null,
    nodes: {},
    edges: [],
    node_defs: [],
    start_node: null,
    end_node: null,
    merge_resolver: null,
  };

  return new Proxy(
    {
      fetchRuns: vi.fn().mockResolvedValue([run]),
      fetchRun: vi.fn().mockResolvedValue(runState),
      fetchRunPipeline: vi.fn().mockResolvedValue({
        pipeline: { name: "impl", version: "1.0", variables: {}, nodes: [], edges: [] },
        prompts: {},
        diagnostics: [],
      }),
      // A template tab runs the library assistant's lifecycle (ADR-0048) — kept idle.
      putLibassistFocus: vi.fn().mockResolvedValue(undefined),
      closeLibraryAssistant: vi.fn().mockResolvedValue(undefined),
      openLibraryAssistant: vi.fn().mockReturnValue(new Promise(() => {})),
      // A template opened as a tab (library row, Trigger): named after its id.
      fetchPipeline: vi.fn().mockImplementation((id: string) =>
        Promise.resolve({
          scope: "repo",
          pipeline: { name: id, version: "1.0", variables: {}, nodes: [], edges: [] },
          prompts: {},
          diagnostics: [],
        }),
      ),
      fetchSessions: vi.fn().mockResolvedValue({ live: 0, cap: 20, version: "9.9.9-test" }),
      fetchTriggers: vi.fn().mockResolvedValue([]),
      fetchTriggersHealth: vi.fn().mockResolvedValue({
        last_tick_at: null,
        tick_interval_secs: 30,
        paused: false,
      }),
      fetchProjects: vi.fn().mockResolvedValue([]),
      pauseTriggers: vi.fn().mockResolvedValue(undefined),
      fetchUpdateStatus: vi.fn().mockResolvedValue({
        installed_version: "9.9.9-test",
        latest_version: null,
        newer_available: false,
        checked_at: null,
        source: "GitHub Releases",
        source_url: "https://example.invalid/releases/latest",
        check_enabled: true,
        install_method: "unknown",
        manual_command: "Build from source, then restart the daemon.",
        supervision: "none",
        reason: "Not checked yet.",
        last_error: null,
        active_runs: 0,
        can_apply: true,
        apply_blocked_reason: null,
        last_attempt: null,
      }),
      fetchLibrary: vi.fn().mockResolvedValue([]),
      fetchLibraryPipelines: vi.fn().mockResolvedValue([]),
      fetchPipelines: vi.fn().mockResolvedValue([]),
      listBranches: vi.fn().mockResolvedValue([]),
      fetchStatsAbsorptions: vi.fn().mockResolvedValue({ absorptions: [] }),
      // The run tab's panels (Run info, inspector) read these once r1 is open.
      fetchAgentProfiles: vi.fn().mockResolvedValue({ profiles: [] }),
      fetchSkillBank: vi.fn().mockResolvedValue({ skills: [], folders: [], root_path: "/home/user/.pdo/skills" }),
      fetchSourceDrift: vi.fn().mockRejectedValue(new Error("no drift in this test")),
      // UI05: the Dashboard's two reads — an instance with nothing to report.
      fetchDashboard: vi.fn().mockResolvedValue({
        computed_at: "2033-04-02T09:00:00.000Z",
        from: "2033-03-04T00:00:00.000Z",
        to: "2033-04-03T00:00:00.000Z",
        project: null,
        first_run_at: null,
        projects: [],
        cohort: {
          started: 0, completed: 0, failed: 0, halted: 0, skipped: 0,
          archived: 0, running: 0, awaiting_user: 0, paused: 0,
        },
        completion: { completed: 0, eligible: 0, rate: null },
        completion_time: { measured: 0, median_ms: null, p95_ms: null },
        live: { running: 0, awaiting_user: 0, paused: 0 },
        attention_total: 0,
        attention: [],
        active_total: 0,
        active: [],
        recent_results: [],
      }),
      fetchStatsCost: vi.fn().mockResolvedValue({
        harnesses: [],
        total: emptyAggregate,
        by_period: [],
        by_pipeline: [],
        by_model: [],
        by_project: [],
        resolved: [],
        model_total: { ...emptyAggregate, unit: "slice" },
        model_total_by_period: [],
      }),
    },
    {
      // Vitest 4's loud-failure contract (see App.settingsClose.test.tsx): an api
      // function nobody listed fails the test by name instead of answering silently.
      get(target: Record<string, unknown>, prop: string | symbol) {
        if (typeof prop !== "string") return target[prop as never];
        if (prop in target) return target[prop];
        if (prop === "__esModule") return false;
        if (prop === "then") return undefined;
        throw new Error(
          `No "${prop}" export is defined in the ./api mock of App.dashboard.test.tsx — add it explicitly.`,
        );
      },
    },
  );
});

// The canvas is outside the paths under test; no real ReactFlow measurement under jsdom.
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    ReactFlow: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="reactflow-stub">{children}</div>
    ),
  };
});

import App from "./App";
import { useEditStore } from "./stores/editStore";

describe("App — the Dashboard (UI05)", () => {
  beforeEach(() => {
    // The fixture has a Run, so no welcome modal — answered anyway, these tests
    // are about navigation, not tours.
    localStorage.setItem("pdo.tour.offered", "1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useEditStore.setState({ openTabs: [], activeTabId: null, selection: { kind: "none", id: null } });
  });

  it("lands on the Dashboard on a fresh visit", async () => {
    render(<App />);
    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Select a run or open a pipeline to get started")).not.toBeInTheDocument();
  });

  it("selecting a Run shows its canvas; the Dashboard button returns, keeping the tab", async () => {
    render(<App />);
    await screen.findByTestId("dashboard");
    await userEvent.click(await screen.findByTestId("run-display-label")); // the r1 row
    await waitFor(() => expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument());
    const tabsBefore = useEditStore.getState().openTabs.length;
    expect(tabsBefore).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("center-editor")).not.toBeVisible();
    expect(useEditStore.getState().openTabs.length).toBe(tabsBefore);
    await userEvent.click(screen.getByRole("button", { name: "Back to editor" }));
    await waitFor(() => expect(screen.getByTestId("center-editor")).toBeVisible());
  }, 20_000);

  it("folds the right pane away under the Dashboard, without unmounting it, and brings it back", async () => {
    render(<App />);
    await screen.findByTestId("dashboard");
    await userEvent.click(await screen.findByTestId("run-display-label"));
    await waitFor(() => expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument());
    const right = () => document.querySelector("[data-panel]#right")!;
    await waitFor(() => expect(screen.getByTestId("pipeline-info-panel")).toBeInTheDocument());
    expect(right()).not.toHaveAttribute("data-collapsed");

    await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    await screen.findByTestId("dashboard");
    expect(right()).toHaveAttribute("data-collapsed", "true");
    // Collapsed, not unmounted: the Run panel (and any terminal in it) is still there.
    expect(screen.getByTestId("pipeline-info-panel")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back to editor" }));
    await waitFor(() => expect(right()).not.toHaveAttribute("data-collapsed"));
  }, 20_000);

  it("opening a pipeline from the fresh-visit Dashboard shows its canvas", async () => {
    render(<App />);
    await screen.findByTestId("dashboard");
    await act(() => useEditStore.getState().openPipeline("tpl"));
    await waitFor(() => expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument());
    expect(screen.getByTestId("center-editor")).toBeVisible();
  }, 20_000);

  it("re-opening the pipeline already active behind the Dashboard leaves the Dashboard", async () => {
    render(<App />);
    await screen.findByTestId("dashboard");
    await act(() => useEditStore.getState().openPipeline("tpl"));
    await waitFor(() => expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    await screen.findByTestId("dashboard");
    expect(useEditStore.getState().activeTabId).toBe("tpl");

    await act(() => useEditStore.getState().openPipeline("tpl"));
    await waitFor(() => expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument());
    expect(screen.getByTestId("center-editor")).toBeVisible();
  }, 20_000);

  it("closing the active tab under the Dashboard keeps the Dashboard", async () => {
    render(<App />);
    await screen.findByTestId("dashboard");
    await act(() => useEditStore.getState().openPipeline("tpl"));
    await act(() => useEditStore.getState().openPipeline("tpl2"));
    await waitFor(() => expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    await screen.findByTestId("dashboard");

    // A neighbour is promoted programmatically — not a user opening a tab.
    act(() => useEditStore.getState().closeTab("tpl2"));
    expect(useEditStore.getState().activeTabId).toBe("tpl");
    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("center-editor")).not.toBeVisible();
  }, 20_000);

  it("editor shortcuts do not reach the hidden canvas", async () => {
    render(<App />);
    await screen.findByTestId("dashboard");
    await userEvent.click(await screen.findByTestId("run-display-label"));
    await waitFor(() => expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument());
    const undo = vi.spyOn(useEditStore.getState(), "undo");
    await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(undo).not.toHaveBeenCalled();
  }, 20_000);
});
