// UI05 — the Dashboard: the landing view. What needs a decision now and what is
// running (Live now), beside the figures of the reporting period (period cohort).
// Every figure is defined in docs/reference/dashboard-metrics.md; the pure logic
// lives in lib/dashboardMetrics.ts, the data in hooks/useDashboard.ts, and the cost
// wording is the Stats one (lib/costLabel.ts). Inspection only: nothing here
// approves, retries, resumes or publishes — every action opens something.
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  MessageCircleQuestion,
  OctagonAlert,
  Play,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ConnectionStatus } from "../hooks/useDaemonSocket";
import { useDashboard } from "../hooks/useDashboard";
import {
  DASHBOARD_PERIODS,
  DEFAULT_DASHBOARD_PERIOD,
  formatAge,
  formatRate,
  periodLabel,
  spendTrend,
  type DashboardPeriod,
  type SpendDay,
} from "../lib/dashboardMetrics";
import { formatCostAmount, formatCoverage } from "../lib/costLabel";
import { formatDuration } from "../lib/runDuration";
import { reviewUrl } from "../lib/runRefs";
import { relativeTime } from "../lib/reviewComments";
import {
  runStatusLabel,
  type AttentionKind,
  type DashboardActiveRun,
  type DashboardAttentionItem,
  type DashboardProject,
  type DashboardResult,
  type RunStatus,
  type WsMessage,
} from "../types";

export interface DashboardProps {
  connection: ConnectionStatus;
  subscribe: (handler: (msg: WsMessage) => void) => () => void;
  onOpenRun: (runId: string, nodeId?: string | null) => void;
  onStartRun: () => void;
  onOpenStats: () => void;
  /** Present only when editor tabs are open behind the Dashboard. */
  onBackToEditor?: () => void;
}

/** Ages and « Updated … » move on their own between two refreshes. */
const CLOCK_TICK_MS = 15_000;

const FOCUS = "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-acc";
/** On an accent fill an accent ring would vanish: ring in the text colour, offset. */
const FOCUS_ON_ACC =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg-1";
const LINK = `rounded text-acc underline-offset-2 hover:underline ${FOCUS}`;
const SECONDARY_BUTTON = `flex items-center gap-1 rounded border border-line-strong bg-bg-3 px-2 py-1 text-fg-2 transition-colors hover:border-acc hover:text-fg ${FOCUS}`;
const SELECT = `rounded border border-line-strong bg-bg-3 px-2 py-1 text-fg-2 transition-colors hover:border-acc ${FOCUS}`;

const ATTENTION_KIND: Record<AttentionKind, { label: string; Icon: LucideIcon; tone: string }> = {
  waiting_for_user: { label: "Waiting for you", Icon: MessageCircleQuestion, tone: "text-st-await" },
  blocked: { label: "Blocked", Icon: OctagonAlert, tone: "text-st-blocked" },
  failed: { label: "Failed", Icon: CircleX, tone: "text-st-failed" },
};

/** The dot beside a live Run's status word (never the only carrier of it). */
const STATUS_DOT: Partial<Record<RunStatus, string>> = {
  running: "bg-st-running",
  awaiting_user: "bg-st-await",
  paused: "bg-st-paused",
};

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** « 20 min ago », « just now », « — » — `formatAge` with the tense. */
function ago(since: string | null, now: Date): string {
  const age = formatAge(since, now);
  return age === "—" || age === "just now" ? age : `${age} ago`;
}

function lastSegment(id: string): string {
  return id.split("/").filter(Boolean).pop() ?? id;
}

export default function Dashboard({
  connection,
  subscribe,
  onOpenRun,
  onStartRun,
  onOpenStats,
  onBackToEditor,
}: DashboardProps) {
  // Ephemeral filters (CONTEXT « Réglages de Stats éphémères »): defaults on every mount.
  const [period, setPeriod] = useState<DashboardPeriod>(DEFAULT_DASHBOARD_PERIOD);
  const [project, setProject] = useState<string | null>(null);
  // The component is mounted only while visible, so it is always active.
  const data = useDashboard({ active: true, period, project, subscribe });
  const { summary, cost } = data;
  const now = useNow(CLOCK_TICK_MS);

  // The summary is bound to its request: right after a Project or period change it
  // is null until the new answer lands. The Project list (all Projects, whatever the
  // filter) is kept from the last answer so the select never loses its options.
  const [knownProjects, setKnownProjects] = useState<DashboardProject[]>([]);
  if (summary && summary.projects !== knownProjects) setKnownProjects(summary.projects);
  const projectOptions =
    project && !knownProjects.some((p) => p.id === project)
      ? [...knownProjects, { id: project, name: lastSegment(project), runs: 0 }]
      : knownProjects;

  // The error is not bound to the request: only an error with nothing to show
  // (and no request in flight) is « unavailable ».
  const summaryUnavailable = data.summaryError !== null && !summary && !data.summaryLoading;
  const pendingText = summaryUnavailable ? "Unavailable" : "Loading…";
  const scope = periodLabel(period);

  return (
    <section
      data-testid="dashboard"
      aria-labelledby="dashboard-title"
      className="h-full overflow-y-auto bg-bg-1 px-5 py-4 text-fg"
      style={{ fontSize: "12px" }}
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4">
        <header className="flex flex-wrap items-center gap-3">
          <h1 id="dashboard-title" className="mr-1 font-semibold tracking-tight text-fg" style={{ fontSize: "18px" }}>
            Dashboard
          </h1>
          <select
            aria-label="Project"
            value={project ?? ""}
            onChange={(e) => setProject(e.target.value === "" ? null : e.target.value)}
            className={SELECT}
          >
            <option value="">All projects</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id} title={p.id}>
                {projectOptions.some((o) => o.id !== p.id && o.name === p.name) ? `${p.name} (${p.id})` : p.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Reporting period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as DashboardPeriod)}
            className={SELECT}
          >
            {DASHBOARD_PERIODS.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </select>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Freshness
              loading={data.summaryLoading}
              stale={data.summaryStale}
              computedAt={summary?.computed_at ?? null}
              now={now}
            />
            <button
              type="button"
              aria-label="Refresh dashboard"
              title="Refresh dashboard"
              onClick={data.refresh}
              className={`grid h-7 w-7 place-items-center rounded border border-line-strong bg-bg-3 text-fg-2 transition-colors hover:border-acc hover:text-fg ${FOCUS}`}
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
            {onBackToEditor && (
              <button type="button" onClick={onBackToEditor} className={SECONDARY_BUTTON}>
                <ArrowLeft size={12} aria-hidden="true" />
                Back to editor
              </button>
            )}
            <button
              type="button"
              onClick={onStartRun}
              className={`flex items-center gap-1 rounded bg-acc px-2.5 py-1 font-medium text-on-acc transition-colors hover:bg-acc-dim ${FOCUS_ON_ACC}`}
            >
              <Play size={12} aria-hidden="true" />
              Start a run
            </button>
          </div>
        </header>

        {connection !== "connected" && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-md border border-st-await bg-st-await-bg px-3 py-2 text-fg"
          >
            <TriangleAlert size={14} aria-hidden="true" className="shrink-0 text-st-await" />
            <span>
              Daemon {connection === "reconnecting" ? "reconnecting" : "disconnected"} — live data may be out of date.
            </span>
          </div>
        )}

        {summaryUnavailable && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 rounded-md border border-st-failed-border bg-st-failed-bg px-3 py-2 text-fg"
          >
            <span>Dashboard unavailable: {data.summaryError}</span>
            <button type="button" onClick={data.refresh} className={SECONDARY_BUTTON}>
              Retry
            </button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard
            testId="dashboard-card-spend"
            scope={scope}
            title="Recorded spend"
            value={
              cost
                ? formatCostAmount(cost.total.usd, cost.total.partial, cost.total.estimated)
                : data.costError && !data.costLoading
                  ? "—"
                  : "Loading…"
            }
            sub={
              cost
                ? cost.total.executions > 0
                  ? formatCoverage(cost.total.coverage, cost.total.unit)
                  : "No Runs in this period"
                : data.costError && !data.costLoading
                  ? `Cost unavailable: ${data.costError}`
                  : null
            }
            action={(describedBy) => (
              <button type="button" onClick={onOpenStats} aria-describedby={describedBy} className={LINK}>
                Open cost
              </button>
            )}
          />
          <SummaryCard
            testId="dashboard-card-completed"
            scope={scope}
            title="Completed runs"
            value={
              summary ? (
                <>
                  {summary.completion.eligible > 0
                    ? `${summary.completion.completed} of ${summary.completion.eligible}`
                    : "—"}
                  <span className="ml-2 text-fg-2" style={{ fontSize: "13px" }}>
                    {formatRate(summary.completion.rate)}
                  </span>
                </>
              ) : (
                "—"
              )
            }
            sub={
              summary
                ? `failed ${summary.cohort.failed} · stopped ${summary.cohort.halted} · skipped ${summary.cohort.skipped} · still running ${summary.cohort.running + summary.cohort.awaiting_user + summary.cohort.paused}`
                : pendingText
            }
            action={(describedBy) => (
              <button type="button" onClick={onOpenStats} aria-describedby={describedBy} className={LINK}>
                Open Stats
              </button>
            )}
          />
          <SummaryCard
            testId="dashboard-card-duration"
            scope={scope}
            title="Median completion time"
            value={summary ? (formatDuration(summary.completion_time.median_ms) ?? "—") : "—"}
            sub={
              summary
                ? `${summary.completion_time.measured} completed ${summary.completion_time.measured === 1 ? "Run" : "Runs"}${
                    summary.completion_time.p95_ms !== null
                      ? ` · p95 ${formatDuration(summary.completion_time.p95_ms) ?? "—"}`
                      : ""
                  }`
                : pendingText
            }
            action={(describedBy) => (
              <button type="button" onClick={onOpenStats} aria-describedby={describedBy} className={LINK}>
                Open Stats
              </button>
            )}
          />
          <SummaryCard
            testId="dashboard-card-live"
            scope="Live now"
            title="Running"
            value={summary ? String(summary.live.running) : "—"}
            sub={
              summary
                ? `${summary.live.awaiting_user} awaiting you · ${summary.live.paused} paused`
                : pendingText
            }
            action={() => (
              <a href="#dashboard-active" className={LINK}>
                View active work
              </a>
            )}
          />
          <SummaryCard
            testId="dashboard-card-attention"
            scope="Live now"
            title="Needs attention"
            value={summary ? String(summary.attention_total) : "—"}
            sub={summary ? "Waits, incidents and failures of the last 7 days" : pendingText}
            action={() => (
              <a href="#dashboard-attention" className={LINK}>
                View attention list
              </a>
            )}
          />
        </div>

        <Panel id="dashboard-attention" title="Needs attention" scope="Live now">
          {!summary ? (
            <EmptyLine>{pendingText}</EmptyLine>
          ) : summary.attention.length === 0 ? (
            <EmptyLine>Nothing needs your attention.</EmptyLine>
          ) : (
            <>
              <ul>
                {summary.attention.map((item) => (
                  <AttentionRow
                    key={`${item.kind}-${item.run_id}-${item.node_id ?? ""}`}
                    item={item}
                    now={now}
                    onOpenRun={onOpenRun}
                  />
                ))}
              </ul>
              {summary.attention_total > summary.attention.length && (
                <ShowingLine shown={summary.attention.length} total={summary.attention_total} />
              )}
            </>
          )}
        </Panel>

        <Panel id="dashboard-active" title="Active work" scope="Live now">
          {!summary ? (
            <EmptyLine>{pendingText}</EmptyLine>
          ) : summary.active.length === 0 ? (
            <EmptyLine>No runs in progress.</EmptyLine>
          ) : (
            <>
              <ul>
                {summary.active.map((run) => (
                  <ActiveRunRow key={run.run_id} run={run} now={now} onOpenRun={onOpenRun} />
                ))}
              </ul>
              {summary.active_total > summary.active.length && (
                <ShowingLine shown={summary.active.length} total={summary.active_total} />
              )}
            </>
          )}
        </Panel>

        <SpendTrend
          days={spendTrend(data.window.days, cost?.by_period ?? [], summary?.first_run_at ?? null)}
          scope={scope}
          costLoaded={cost !== null}
          costError={!cost && !data.costLoading ? data.costError : null}
        />

        <Panel id="dashboard-results" title="Recent results">
          {!summary ? (
            <EmptyLine>{pendingText}</EmptyLine>
          ) : summary.recent_results.length === 0 ? (
            <EmptyLine>No completed runs yet.</EmptyLine>
          ) : (
            <ul>
              {summary.recent_results.map((result) => (
                <ResultRow key={result.run_id} result={result} now={now} onOpenRun={onOpenRun} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}

function Freshness({
  loading,
  stale,
  computedAt,
  now,
}: {
  loading: boolean;
  stale: boolean;
  computedAt: string | null;
  now: Date;
}) {
  if (loading) return <span className="text-fg-3">Refreshing…</span>;
  if (stale && computedAt) {
    return (
      <span className="text-st-await">Showing data from {relativeTime(computedAt, now)} — refresh failed</span>
    );
  }
  if (computedAt) return <span className="text-fg-3">Updated {relativeTime(computedAt, now)}</span>;
  return null;
}

function ScopeTag({ children }: { children: ReactNode }) {
  return (
    <span
      className="w-fit rounded border border-line-strong px-1.5 py-px font-medium uppercase tracking-wide text-fg-3"
      style={{ fontSize: "10px" }}
    >
      {children}
    </span>
  );
}

function SummaryCard({
  testId,
  scope,
  title,
  value,
  sub,
  action,
}: {
  testId: string;
  scope: string;
  title: string;
  value: ReactNode;
  sub: ReactNode;
  /** Every card leads somewhere; `describedBy` names the card for a repeated link text. */
  action: (describedBy: string) => ReactNode;
}) {
  const titleId = useId();
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col rounded-md border border-line bg-bg-2 p-3">
      <ScopeTag>{scope}</ScopeTag>
      <div id={titleId} className="mt-2 font-medium text-fg-2">
        {title}
      </div>
      <div className="mt-1 break-words font-mono text-fg" style={{ fontSize: "20px", lineHeight: "28px" }}>
        {value}
      </div>
      {sub && (
        <div className="mt-1 break-words text-fg-3" style={{ fontSize: "11px" }}>
          {sub}
        </div>
      )}
      <div className="mt-auto pt-2" style={{ fontSize: "11px" }}>
        {action(titleId)}
      </div>
    </div>
  );
}

function Panel({
  id,
  title,
  scope,
  children,
}: {
  id: string;
  title: string;
  scope?: string;
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={titleId} className="scroll-mt-4 rounded-md border border-line bg-bg-2">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <h2 id={titleId} className="font-semibold text-fg" style={{ fontSize: "13px" }}>
          {title}
        </h2>
        {scope && <ScopeTag>{scope}</ScopeTag>}
      </div>
      {children}
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="border-t border-line px-3 py-3 text-fg-3">{children}</p>;
}

function ShowingLine({ shown, total }: { shown: number; total: number }) {
  return (
    <p className="border-t border-line px-3 py-2 text-fg-3" style={{ fontSize: "11px" }}>
      Showing {shown} of {total}
    </p>
  );
}

function AttentionRow({
  item,
  now,
  onOpenRun,
}: {
  item: DashboardAttentionItem;
  now: Date;
  onOpenRun: (runId: string, nodeId?: string | null) => void;
}) {
  const kind = ATTENTION_KIND[item.kind];
  const name = item.run_name ?? item.pipeline_name;
  return (
    <li data-testid="dashboard-attention-item" className="flex items-center gap-3 border-t border-line px-3 py-2">
      <kind.Icon size={16} aria-hidden="true" className={`shrink-0 ${kind.tone}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`font-medium ${kind.tone}`}>{kind.label}</span>
          <span className="truncate font-medium text-fg">{name}</span>
          <span className="text-fg-3">
            {item.pipeline_name}
            {item.node_name && ` · ${item.node_name}`}
          </span>
        </div>
        {item.reason && (
          <div className="truncate text-fg-2" title={item.reason}>
            {item.reason}
          </div>
        )}
      </div>
      <span
        className="shrink-0 font-mono text-fg-3"
        title={item.since ? `Since ${new Date(item.since).toLocaleString()}` : undefined}
      >
        {formatAge(item.since, now)}
      </span>
      <button
        type="button"
        aria-label={`Open ${name}`}
        onClick={() => onOpenRun(item.run_id, item.node_id)}
        className={`shrink-0 ${SECONDARY_BUTTON}`}
      >
        Open
      </button>
    </li>
  );
}

function currentStep(run: DashboardActiveRun): string {
  if (run.current_nodes.length === 0) return "—";
  if (run.current_nodes.length === 1) return run.current_nodes[0].name;
  return `${run.current_nodes.length} steps in parallel`;
}

function ActiveRunRow({
  run,
  now,
  onOpenRun,
}: {
  run: DashboardActiveRun;
  now: Date;
  onOpenRun: (runId: string, nodeId?: string | null) => void;
}) {
  const name = run.run_name ?? run.pipeline_name;
  const step = currentStep(run);
  return (
    <li data-testid="dashboard-active-run" className="border-t border-line">
      <button
        type="button"
        onClick={() => onOpenRun(run.run_id, null)}
        className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-bg-3 ${FOCUS} focus-visible:ring-inset`}
      >
        <span className="flex w-full min-w-0 items-baseline gap-2">
          <span className="truncate font-medium text-fg">{name}</span>
          <span className="truncate text-fg-3">{run.pipeline_name}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-fg-2">
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[run.status] ?? "bg-st-pending"}`} />
            {runStatusLabel(run.status)}
          </span>
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-0.5" style={{ fontSize: "11px" }}>
          <span className="min-w-0 truncate" title={run.current_nodes.map((n) => n.name).join(", ") || undefined}>
            <span className="text-fg-3">Step </span>
            <span className="text-fg-2">{step}</span>
          </span>
          <span>
            <span className="text-fg-3">Elapsed </span>
            <span className="font-mono text-fg-2">{formatAge(run.started_at, now)}</span>
          </span>
          <span>
            <span className="text-fg-3">Cost </span>
            <span className="font-mono text-fg-2">
              {run.cost_usd === null ? "—" : `${formatCostAmount(run.cost_usd, run.cost_partial, true)} so far`}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

function ResultRow({
  result,
  now,
  onOpenRun,
}: {
  result: DashboardResult;
  now: Date;
  onOpenRun: (runId: string, nodeId?: string | null) => void;
}) {
  const name = result.run_name ?? result.pipeline_name;
  return (
    <li data-testid="dashboard-result" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-3 py-2">
      <CircleCheck size={16} aria-hidden="true" className="shrink-0 text-st-done" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-fg">{name}</div>
        <div className="text-fg-3" style={{ fontSize: "11px" }}>
          {result.pipeline_name} · Completed {ago(result.completed_at, now)} · took{" "}
          <span className="font-mono">{formatDuration(result.duration_ms) ?? "—"}</span>
          {result.review_pending > 0 && (
            <span className="text-st-await">
              {" "}
              · {result.review_pending} review {result.review_pending === 1 ? "comment" : "comments"} pending
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={() => onOpenRun(result.run_id, null)} className={SECONDARY_BUTTON}>
          Open result
        </button>
        <a href={reviewUrl(result.run_id)} className={SECONDARY_BUTTON}>
          Review changes
        </a>
      </div>
    </li>
  );
}

function dayTitle(day: SpendDay): string {
  switch (day.state) {
    case "spend":
      return `${day.day}: ${formatCostAmount(day.usd, day.incomplete, true)} · ${day.runs} ${day.runs === 1 ? "Run" : "Runs"}`;
    case "unknown":
      return `${day.day}: cost unknown · ${day.runs} ${day.runs === 1 ? "Run" : "Runs"}`;
    case "no_activity":
      return `${day.day}: no Run started`;
    case "outside":
      return `${day.day}: before the first recorded run`;
  }
}

function SpendTrend({
  days,
  scope,
  costLoaded,
  costError,
}: {
  days: SpendDay[];
  scope: string;
  costLoaded: boolean;
  costError: string | null;
}) {
  const max = days.reduce((m, d) => (d.state === "spend" && d.usd !== null ? Math.max(m, d.usd) : m), 0);
  const hasSpend = days.some((d) => d.state === "spend");
  const count = (state: SpendDay["state"]) => days.filter((d) => d.state === state).length;
  return (
    <figure data-testid="dashboard-spend-trend" className="m-0 rounded-md border border-line bg-bg-2 px-3 pb-3 pt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <figcaption className="font-semibold text-fg" style={{ fontSize: "13px" }}>
          Recorded spend per day, USD — Runs started that day
        </figcaption>
        <ScopeTag>{scope}</ScopeTag>
        {!costLoaded && (
          <span className="text-fg-3">{costError ? `Cost unavailable: ${costError}` : "Loading cost…"}</span>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <div className="flex w-14 shrink-0 flex-col justify-between text-right font-mono text-fg-3" style={{ fontSize: "10px" }}>
          <span>{hasSpend ? `$${max.toFixed(2)}` : "—"}</span>
          <span aria-hidden="true">0</span>
        </div>
        <div className="flex h-28 min-w-0 flex-1 items-end gap-px border-b border-line-strong">
          {days.map((day) => (
            <div
              key={day.day}
              data-testid="dashboard-spend-day"
              data-state={day.state}
              title={dayTitle(day)}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <SpendBar day={day} max={max} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between pl-16 font-mono text-fg-3" style={{ fontSize: "10px" }}>
        <span>{days[0]?.day}</span>
        <span>{days[days.length - 1]?.day}</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-fg-3" style={{ fontSize: "11px" }}>
        <LegendItem swatch={<span className="h-2.5 w-2.5 rounded-sm bg-acc" />}>spend ({count("spend")})</LegendItem>
        <LegendItem swatch={<span className="h-2.5 w-2.5 rounded-sm border border-dashed border-st-await" />}>
          unknown ({count("unknown")})
        </LegendItem>
        <LegendItem swatch={<span className="h-px w-2.5 bg-fg-3" />}>no activity ({count("no_activity")})</LegendItem>
        <LegendItem swatch={<span className="h-2.5 w-2.5 rounded-sm border border-line-strong bg-bg-3" />}>
          before the first recorded run ({count("outside")})
        </LegendItem>
      </ul>
    </figure>
  );
}

function SpendBar({ day, max }: { day: SpendDay; max: number }) {
  switch (day.state) {
    case "spend": {
      const ratio = max > 0 && day.usd !== null ? day.usd / max : 0;
      return <div className="w-full rounded-t-sm bg-acc" style={{ height: `${Math.max(4, ratio * 100)}%` }} />;
    }
    case "unknown":
      return (
        <div className="grid h-2/5 w-full place-items-start justify-center rounded-t-sm border border-b-0 border-dashed border-st-await">
          <span aria-hidden="true" className="font-mono leading-none text-st-await" style={{ fontSize: "9px" }}>
            ?
          </span>
        </div>
      );
    case "no_activity":
      return <div className="h-px w-full bg-fg-3" />;
    case "outside":
      return <div className="h-full w-full bg-bg-3" />;
  }
}

function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className="flex h-2.5 items-center">
        {swatch}
      </span>
      {children}
    </li>
  );
}
