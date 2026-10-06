//! The Dashboard's summary (UI04, docs/reference/dashboard-metrics.md): what needs
//! a human now, what is running, what finished, and how the Runs started in the
//! period ended. One concern — run outcomes and live attention — read off the
//! same projection `GET /runs` folds, derived on read (ADR-0029). Cost stays in
//! `stats.rs`; only the bounded active list reads the memoized per-Run cost.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::event_log::{NodeStatus, RunState, RunStatus};
use crate::AppState;

pub(crate) const ATTENTION_LIMIT: usize = 20;
pub(crate) const ACTIVE_LIMIT: usize = 10;
pub(crate) const RECENT_LIMIT: usize = 8;
/// A failed Run stays an attention item this many days after it failed.
pub(crate) const FAILED_ATTENTION_DAYS: i64 = 7;
/// p95 completion time is reported only from this many completed Runs up.
pub(crate) const P95_MIN_SAMPLES: usize = 20;

#[derive(Debug, Deserialize)]
pub(crate) struct DashboardQuery {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub project: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct DashboardSummary {
    pub computed_at: String,
    pub from: String,
    pub to: String,
    pub project: Option<String>,
    /// The earliest start of a Run in the Project scope (all time) — the spend
    /// trend's « outside the data window » boundary.
    pub first_run_at: Option<String>,
    pub projects: Vec<DashboardProject>,
    pub cohort: DashboardCohort,
    pub completion: DashboardCompletion,
    pub completion_time: DashboardCompletionTime,
    pub live: DashboardLive,
    pub attention_total: usize,
    pub attention: Vec<DashboardAttentionItem>,
    pub active_total: usize,
    pub active: Vec<DashboardActiveRun>,
    pub recent_results: Vec<DashboardResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct DashboardProject {
    pub id: String,
    pub name: String,
    pub runs: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub(crate) struct DashboardCohort {
    pub started: u64,
    pub completed: u64,
    pub failed: u64,
    pub halted: u64,
    pub skipped: u64,
    pub archived: u64,
    pub running: u64,
    pub awaiting_user: u64,
    pub paused: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct DashboardCompletion {
    pub completed: u64,
    /// completed + failed + halted: skipped and archived Runs are not attempts
    /// that ended (docs/reference/dashboard-metrics.md).
    pub eligible: u64,
    pub rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct DashboardCompletionTime {
    pub measured: u64,
    pub median_ms: Option<i64>,
    pub p95_ms: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub(crate) struct DashboardLive {
    pub running: u64,
    pub awaiting_user: u64,
    pub paused: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AttentionKind {
    WaitingForUser,
    Blocked,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct DashboardAttentionItem {
    pub kind: AttentionKind,
    pub run_id: String,
    pub run_name: Option<String>,
    pub pipeline_name: String,
    pub project_id: String,
    pub project_name: String,
    pub node_id: Option<String>,
    pub node_name: Option<String>,
    pub reason: Option<String>,
    pub since: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct DashboardNodeRef {
    pub id: String,
    pub name: String,
    pub status: NodeStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct DashboardActiveRun {
    pub run_id: String,
    pub run_name: Option<String>,
    pub pipeline_name: String,
    pub project_id: String,
    pub project_name: String,
    pub status: RunStatus,
    pub started_at: Option<String>,
    pub current_nodes: Vec<DashboardNodeRef>,
    pub cost_usd: Option<f64>,
    pub cost_partial: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct DashboardResult {
    pub run_id: String,
    pub run_name: Option<String>,
    pub pipeline_name: String,
    pub project_id: String,
    pub project_name: String,
    pub completed_at: String,
    pub duration_ms: Option<i64>,
    /// Review comments sent and not resolved (CONTEXT « Accès rapide Review »).
    pub review_pending: u64,
}

/// One projected Run plus what the fold needs beyond its state.
pub(crate) struct DashboardRun {
    pub state: RunState,
    pub project_id: String,
    pub project_name: String,
    /// The timestamp of the Run's last event — the age of an incident wait.
    pub last_event_ts: Option<String>,
}

fn millis_between(start: &str, end: &str) -> Option<i64> {
    let start = chrono::DateTime::parse_from_rfc3339(start).ok()?;
    let end = chrono::DateTime::parse_from_rfc3339(end).ok()?;
    let ms = (end - start).num_milliseconds();
    (ms >= 0).then_some(ms)
}

fn node_name(state: &RunState, node_id: &str) -> String {
    state
        .node_defs
        .iter()
        .find(|def| def.id == node_id)
        .and_then(|def| def.name.clone())
        .unwrap_or_else(|| node_id.to_string())
}

/// The attention item a Run raises, if any (docs/reference/dashboard-metrics.md
/// « Attention rules »). `failed_cutoff` is `now - FAILED_ATTENTION_DAYS`, as an
/// ISO string comparable with event timestamps.
fn attention_of(run: &DashboardRun, failed_cutoff: &str) -> Option<DashboardAttentionItem> {
    let state = &run.state;
    let item = |kind, node_id: Option<String>, reason: Option<String>, since: Option<String>| {
        DashboardAttentionItem {
            kind,
            run_id: state.run_id.clone(),
            run_name: state.name.clone(),
            pipeline_name: state.pipeline_name.clone(),
            project_id: run.project_id.clone(),
            project_name: run.project_name.clone(),
            node_name: node_id.as_deref().map(|id| node_name(state, id)),
            node_id,
            reason,
            since,
        }
    };
    match state.status {
        RunStatus::AwaitingUser => {
            let mut awaiting: Vec<(&String, &crate::event_log::AwaitingInfo)> = state
                .nodes
                .iter()
                .filter(|(_, node)| node.status == NodeStatus::AwaitingUser)
                .filter_map(|(id, node)| node.awaiting.as_ref().map(|info| (id, info)))
                .collect();
            awaiting.sort_by(|a, b| a.1.since.cmp(&b.1.since).then_with(|| a.0.cmp(b.0)));
            if state.awaiting_reason_code.is_some() {
                let node = awaiting.first().map(|(id, _)| (*id).clone());
                return Some(item(
                    AttentionKind::Blocked,
                    node,
                    state.awaiting_reason.clone(),
                    run.last_event_ts.clone(),
                ));
            }
            let own: Vec<_> = awaiting
                .iter()
                .filter(|(_, info)| info.cause != crate::event_log::AWAITING_CAUSE_CHILD_AWAITING)
                .collect();
            if own.is_empty() && !awaiting.is_empty() {
                // Lifted only by an awaiting child: the child is the item.
                return None;
            }
            match own.first() {
                Some((id, info)) => Some(item(
                    AttentionKind::WaitingForUser,
                    Some((*id).clone()),
                    info.message.clone().or_else(|| state.awaiting_reason.clone()),
                    Some(info.since.clone()),
                )),
                None => Some(item(
                    AttentionKind::WaitingForUser,
                    None,
                    state.awaiting_reason.clone(),
                    run.last_event_ts.clone(),
                )),
            }
        }
        RunStatus::Failed => {
            let failed_at = state.completed_at.clone()?;
            if failed_at.as_str() < failed_cutoff {
                return None;
            }
            let mut failed_nodes: Vec<&String> = state
                .nodes
                .iter()
                .filter(|(_, node)| node.status == NodeStatus::Failed)
                .map(|(id, _)| id)
                .collect();
            failed_nodes.sort();
            Some(item(
                AttentionKind::Failed,
                failed_nodes.first().map(|id| (*id).clone()),
                state.failure_reason.clone(),
                Some(failed_at),
            ))
        }
        _ => None,
    }
}

/// Fold the projected Runs into the summary. Pure: `now` is injected, and the
/// active Runs' cost is left `None` for the handler to fill.
pub(crate) fn fold_dashboard(
    runs: &[DashboardRun],
    from: &str,
    to: &str,
    project: Option<&str>,
    now: chrono::DateTime<chrono::Utc>,
) -> DashboardSummary {
    let mut projects = BTreeMap::<String, DashboardProject>::new();
    for run in runs {
        projects
            .entry(run.project_id.clone())
            .or_insert_with(|| DashboardProject {
                id: run.project_id.clone(),
                name: run.project_name.clone(),
                runs: 0,
            })
            .runs += 1;
    }
    let mut projects: Vec<DashboardProject> = projects.into_values().collect();
    projects.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));

    let scoped: Vec<&DashboardRun> = runs
        .iter()
        .filter(|run| project.is_none_or(|wanted| wanted == run.project_id))
        .collect();

    let first_run_at = scoped.iter().filter_map(|run| run.state.started_at.clone()).min();

    let mut cohort = DashboardCohort::default();
    let mut durations = Vec::new();
    for run in scoped.iter().filter(|run| {
        run.state
            .started_at
            .as_deref()
            .is_some_and(|started| started >= from && started < to)
    }) {
        cohort.started += 1;
        match run.state.status {
            RunStatus::Completed => {
                cohort.completed += 1;
                if let (Some(start), Some(end)) = (&run.state.started_at, &run.state.completed_at) {
                    if let Some(ms) = millis_between(start, end) {
                        durations.push(ms as f64);
                    }
                }
            }
            RunStatus::Failed => cohort.failed += 1,
            RunStatus::Halted => cohort.halted += 1,
            RunStatus::Skipped => cohort.skipped += 1,
            RunStatus::Archived => cohort.archived += 1,
            RunStatus::Running => cohort.running += 1,
            RunStatus::AwaitingUser => cohort.awaiting_user += 1,
            RunStatus::Paused => cohort.paused += 1,
        }
    }
    let eligible = cohort.completed + cohort.failed + cohort.halted;
    let completion = DashboardCompletion {
        completed: cohort.completed,
        eligible,
        rate: (eligible > 0).then(|| cohort.completed as f64 / eligible as f64),
    };
    let completion_time = DashboardCompletionTime {
        measured: durations.len() as u64,
        median_ms: crate::distribution::r7_percentile(&durations, 0.5).map(|v| v.round() as i64),
        p95_ms: (durations.len() >= P95_MIN_SAMPLES)
            .then(|| crate::distribution::r7_percentile(&durations, 0.95))
            .flatten()
            .map(|v| v.round() as i64),
    };

    let mut live = DashboardLive::default();
    for run in &scoped {
        match run.state.status {
            RunStatus::Running => live.running += 1,
            RunStatus::AwaitingUser => live.awaiting_user += 1,
            RunStatus::Paused => live.paused += 1,
            _ => {}
        }
    }

    let failed_cutoff = (now - chrono::Duration::days(FAILED_ATTENTION_DAYS))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut attention: Vec<DashboardAttentionItem> = scoped
        .iter()
        .filter_map(|run| attention_of(run, &failed_cutoff))
        .collect();
    attention.sort_by(|a, b| {
        let group = |item: &DashboardAttentionItem| u8::from(item.kind == AttentionKind::Failed);
        group(a).cmp(&group(b)).then_with(|| {
            if a.kind == AttentionKind::Failed {
                b.since.cmp(&a.since) // newest failure first
            } else {
                match (&a.since, &b.since) {
                    (Some(x), Some(y)) => x.cmp(y), // oldest wait first
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => std::cmp::Ordering::Equal,
                }
            }
            .then_with(|| a.run_id.cmp(&b.run_id))
        })
    });
    let attention_total = attention.len();
    attention.truncate(ATTENTION_LIMIT);

    let mut active: Vec<DashboardActiveRun> = scoped
        .iter()
        .filter(|run| run.state.status.is_live())
        .map(|run| {
            let mut current_nodes: Vec<DashboardNodeRef> = run
                .state
                .nodes
                .iter()
                .filter(|(_, node)| matches!(node.status, NodeStatus::Running | NodeStatus::AwaitingUser))
                .map(|(id, node)| DashboardNodeRef {
                    id: id.clone(),
                    name: node_name(&run.state, id),
                    status: node.status.clone(),
                })
                .collect();
            current_nodes.sort_by(|a, b| a.id.cmp(&b.id));
            DashboardActiveRun {
                run_id: run.state.run_id.clone(),
                run_name: run.state.name.clone(),
                pipeline_name: run.state.pipeline_name.clone(),
                project_id: run.project_id.clone(),
                project_name: run.project_name.clone(),
                status: run.state.status.clone(),
                started_at: run.state.started_at.clone(),
                current_nodes,
                cost_usd: None,
                cost_partial: false,
            }
        })
        .collect();
    active.sort_by(|a, b| b.started_at.cmp(&a.started_at).then_with(|| a.run_id.cmp(&b.run_id)));
    let active_total = active.len();
    active.truncate(ACTIVE_LIMIT);

    let mut recent_results: Vec<DashboardResult> = scoped
        .iter()
        .filter(|run| run.state.status == RunStatus::Completed)
        .filter_map(|run| {
            let completed_at = run.state.completed_at.clone()?;
            Some(DashboardResult {
                run_id: run.state.run_id.clone(),
                run_name: run.state.name.clone(),
                pipeline_name: run.state.pipeline_name.clone(),
                project_id: run.project_id.clone(),
                project_name: run.project_name.clone(),
                duration_ms: run
                    .state
                    .started_at
                    .as_deref()
                    .and_then(|start| millis_between(start, &completed_at)),
                completed_at,
                review_pending: run
                    .state
                    .review_comments
                    .iter()
                    .filter(|comment| comment.status != crate::review_comments::ReviewCommentStatus::Resolved)
                    .count() as u64,
            })
        })
        .collect();
    recent_results.sort_by(|a, b| b.completed_at.cmp(&a.completed_at).then_with(|| a.run_id.cmp(&b.run_id)));
    recent_results.truncate(RECENT_LIMIT);

    DashboardSummary {
        computed_at: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        from: from.to_string(),
        to: to.to_string(),
        project: project.map(str::to_string),
        first_run_at,
        projects,
        cohort,
        completion,
        completion_time,
        live,
        attention_total,
        attention,
        active_total,
        active,
        recent_results,
    }
}

fn internal_error(error: impl std::fmt::Display) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": format!("stats dashboard failed: {error}") })),
    )
        .into_response()
}

/// `GET /stats/dashboard` (UI04): read-only, bounded lists, no transcript read
/// except the memoized cost of the ≤ `ACTIVE_LIMIT` active Runs.
pub(crate) async fn stats_dashboard(
    State(state): State<Arc<AppState>>,
    Query(q): Query<DashboardQuery>,
) -> Response {
    let run_ids = match crate::load_all_run_ids(&state.db).await {
        Ok(ids) => ids,
        Err(error) => return internal_error(error),
    };
    let stored_projects = match crate::project_store::list(&state.db).await {
        Ok(projects) => projects,
        Err(error) => return internal_error(error),
    };

    let mut states = Vec::new();
    let mut last_event_ts = Vec::new();
    let mut live_events = HashMap::new();
    for run_id in run_ids {
        let Ok(events) = crate::load_events(&state.db, &run_id).await else {
            continue;
        };
        if let Some(run_state) = crate::event_log::project(&events) {
            last_event_ts.push(events.last().map(|event| event.ts.clone()));
            if run_state.status.is_live() {
                live_events.insert(run_id.clone(), events);
            }
            states.push(run_state);
        }
    }
    // #588 / ADR-0069 §4: the same child overlay as `GET /runs`.
    crate::child_awaiting::overlay(&mut states);

    let runs: Vec<DashboardRun> = states
        .into_iter()
        .zip(last_event_ts)
        .map(|(run_state, last)| {
            let (project_id, project_name) = crate::stats::project_identity_for_root(
                &crate::effective_repo_root(&state, &run_state),
                &stored_projects,
            );
            DashboardRun { state: run_state, project_id, project_name, last_event_ts: last }
        })
        .collect();

    let mut summary = fold_dashboard(&runs, &q.from, &q.to, q.project.as_deref(), chrono::Utc::now());

    for active in &mut summary.active {
        let Some(run) = runs.iter().find(|run| run.state.run_id == active.run_id) else {
            continue;
        };
        let Some(events) = live_events.get(&active.run_id) else {
            continue;
        };
        if let Some(cost) = crate::derive_run_cost(&state, &run.state, events) {
            let uncosted = !cost.uncosted_harnesses.is_empty();
            active.cost_usd = (!(uncosted && cost.usd == 0.0)).then_some(cost.usd);
            active.cost_partial = cost.partial || uncosted;
        }
    }

    Json(summary).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_log::{Event, EventKind};
    use pretty_assertions::assert_eq;

    const FROM: &str = "2033-04-01T00:00:00.000Z";
    const TO: &str = "2033-04-08T00:00:00.000Z";

    fn now() -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339("2033-04-07T12:00:00.000Z").unwrap().with_timezone(&chrono::Utc)
    }

    fn ev(run: &str, ts: &str, kind: EventKind, node: Option<&str>, payload: Option<serde_json::Value>) -> Event {
        Event {
            id: None,
            run_id: run.into(),
            ts: ts.into(),
            kind,
            node_id: node.map(str::to_string),
            iter: node.map(|_| 1),
            payload,
        }
    }

    fn started(run: &str, ts: &str) -> Event {
        ev(run, ts, EventKind::RunStarted, None, Some(serde_json::json!({
            "pipeline_name": "impl",
            "name": format!("{run} name"),
            "node_defs": [{"id": "worker", "name": "Worker", "node_type": "agent", "inputs": [], "outputs": []},
                          {"id": "review", "name": "Review", "node_type": "agent", "inputs": [], "outputs": []}],
        })))
    }

    fn dash(project: &str, events: Vec<Event>) -> DashboardRun {
        let last_event_ts = events.last().map(|e| e.ts.clone());
        DashboardRun {
            state: crate::event_log::project(&events).unwrap(),
            project_id: project.into(),
            project_name: project.into(),
            last_event_ts,
        }
    }

    fn completed(run: &str, start: &str, end: &str) -> DashboardRun {
        dash("repo", vec![started(run, start), ev(run, end, EventKind::RunCompleted, None, None)])
    }

    #[test]
    fn cohort_is_half_open_and_completion_rate_excludes_skipped_and_archived() {
        let runs = vec![
            completed("at-from", FROM, "2033-04-01T00:10:00.000Z"),
            completed("at-to", TO, "2033-04-08T00:10:00.000Z"),
            completed("before", "2033-03-31T23:59:59.999Z", "2033-04-01T00:10:00.000Z"),
            dash("repo", vec![started("failed", "2033-04-02T09:00:00.000Z"),
                              ev("failed", "2033-04-02T09:30:00.000Z", EventKind::RunFailed, None, Some(serde_json::json!({"reason": "boom"})))]),
            dash("repo", vec![started("halted", "2033-04-02T09:00:00.000Z"),
                              ev("halted", "2033-04-02T09:30:00.000Z", EventKind::RunHalted, None, Some(serde_json::json!({"message": "stop"})))]),
            dash("repo", vec![started("skipped", "2033-04-02T09:00:00.000Z"),
                              ev("skipped", "2033-04-02T09:01:00.000Z", EventKind::RunSkipped, None, None)]),
        ];
        let summary = fold_dashboard(&runs, FROM, TO, None, now());
        assert_eq!(summary.cohort.started, 4);
        assert_eq!(summary.cohort.completed, 1);
        assert_eq!(summary.cohort.failed, 1);
        assert_eq!(summary.cohort.halted, 1);
        assert_eq!(summary.cohort.skipped, 1);
        assert_eq!(summary.completion.eligible, 3);
        assert_eq!(summary.completion.rate, Some(1.0 / 3.0));
    }

    #[test]
    fn an_empty_cohort_has_no_rate_and_no_durations() {
        let summary = fold_dashboard(&[], FROM, TO, None, now());
        assert_eq!(summary.cohort, DashboardCohort::default());
        assert_eq!(summary.completion.rate, None);
        assert_eq!(summary.completion_time, DashboardCompletionTime { measured: 0, median_ms: None, p95_ms: None });
        assert_eq!(summary.first_run_at, None);
        assert!(summary.projects.is_empty() && summary.attention.is_empty() && summary.active.is_empty());
    }

    #[test]
    fn completion_time_is_wall_time_with_p95_only_from_twenty_runs() {
        let few = vec![
            completed("a", "2033-04-02T09:00:00.000Z", "2033-04-02T09:10:00.000Z"),
            completed("b", "2033-04-02T09:00:00.000Z", "2033-04-02T09:20:00.000Z"),
            completed("c", "2033-04-02T09:00:00.000Z", "2033-04-02T09:30:00.000Z"),
        ];
        let summary = fold_dashboard(&few, FROM, TO, None, now());
        assert_eq!(summary.completion_time.measured, 3);
        assert_eq!(summary.completion_time.median_ms, Some(20 * 60 * 1000));
        assert_eq!(summary.completion_time.p95_ms, None);

        let many: Vec<DashboardRun> = (1..=20)
            .map(|minutes| completed(&format!("r{minutes}"), "2033-04-02T09:00:00.000Z",
                                     &format!("2033-04-02T09:{minutes:02}:00.000Z")))
            .collect();
        let summary = fold_dashboard(&many, FROM, TO, None, now());
        assert_eq!(summary.completion_time.measured, 20);
        assert_eq!(summary.completion_time.p95_ms, Some(1_143_000)); // R-7: 19.05 min
    }

    #[test]
    fn attention_lists_waits_oldest_first_then_failures_newest_first_within_seven_days() {
        let wait = |run: &str, since: &str, msg: &str| dash("repo", vec![
            started(run, "2033-04-02T09:00:00.000Z"),
            ev(run, "2033-04-02T09:01:00.000Z", EventKind::NodeStarted, Some("worker"), None),
            ev(run, since, EventKind::NodeAwaitingUser, Some("worker"),
               Some(serde_json::json!({"cause": "declared", "message": msg}))),
        ]);
        let failure = |run: &str, at: &str| dash("repo", vec![
            started(run, "2033-03-20T09:00:00.000Z"),
            ev(run, at, EventKind::RunFailed, None, Some(serde_json::json!({"reason": format!("{run} broke")}))),
        ]);
        let runs = vec![
            wait("late-wait", "2033-04-06T10:00:00.000Z", "Which layout?"),
            wait("early-wait", "2033-04-05T10:00:00.000Z", "Ship it?"),
            failure("recent-failure", "2033-04-06T08:00:00.000Z"),
            failure("older-failure", "2033-04-03T08:00:00.000Z"),
            failure("stale-failure", "2033-03-29T08:00:00.000Z"), // > 7 days before now()
            completed("done", "2033-04-02T09:00:00.000Z", "2033-04-02T09:10:00.000Z"),
        ];
        let summary = fold_dashboard(&runs, FROM, TO, None, now());
        let order: Vec<(&str, AttentionKind)> =
            summary.attention.iter().map(|i| (i.run_id.as_str(), i.kind)).collect();
        assert_eq!(order, vec![
            ("early-wait", AttentionKind::WaitingForUser),
            ("late-wait", AttentionKind::WaitingForUser),
            ("recent-failure", AttentionKind::Failed),
            ("older-failure", AttentionKind::Failed),
        ]);
        assert_eq!(summary.attention_total, 4);
        let first = &summary.attention[0];
        assert_eq!(first.node_id.as_deref(), Some("worker"));
        assert_eq!(first.node_name.as_deref(), Some("Worker"));
        assert_eq!(first.reason.as_deref(), Some("Ship it?"));
        assert_eq!(first.since.as_deref(), Some("2033-04-05T10:00:00.000Z"));
        assert_eq!(summary.attention[2].reason.as_deref(), Some("recent-failure broke"));
    }

    #[test]
    fn an_incident_wait_is_blocked_with_its_reason() {
        let runs = vec![dash("repo", vec![
            started("incident", "2033-04-02T09:00:00.000Z"),
            ev("incident", "2033-04-02T09:01:00.000Z", EventKind::NodeStarted, Some("worker"), None),
            ev("incident", "2033-04-02T09:05:00.000Z", EventKind::RunInterrupted, None,
               Some(serde_json::json!({"reason": "the worker session died", "reason_code": "session_died"}))),
        ])];
        let summary = fold_dashboard(&runs, FROM, TO, None, now());
        assert_eq!(summary.attention.len(), 1);
        assert_eq!(summary.attention[0].kind, AttentionKind::Blocked);
        assert_eq!(summary.attention[0].reason.as_deref(), Some("the worker session died"));
        assert_eq!(summary.attention[0].since.as_deref(), Some("2033-04-02T09:05:00.000Z"));
    }

    #[test]
    fn project_scope_narrows_everything_but_the_project_list() {
        let mut other = completed("other", "2033-04-02T09:00:00.000Z", "2033-04-02T09:10:00.000Z");
        other.project_id = "/srv/other".into();
        other.project_name = "other".into();
        let runs = vec![
            completed("mine", "2033-04-02T09:00:00.000Z", "2033-04-02T09:10:00.000Z"),
            other,
            dash("repo", vec![started("live", "2033-04-06T09:00:00.000Z"),
                              ev("live", "2033-04-06T09:01:00.000Z", EventKind::NodeStarted, Some("worker"), None)]),
        ];
        let summary = fold_dashboard(&runs, FROM, TO, Some("/srv/other"), now());
        assert_eq!(summary.projects.len(), 2);
        assert_eq!(summary.cohort.started, 1);
        assert_eq!(summary.live, DashboardLive::default());
        assert_eq!(summary.recent_results.iter().map(|r| r.run_id.as_str()).collect::<Vec<_>>(), vec!["other"]);
        assert_eq!(summary.first_run_at.as_deref(), Some("2033-04-02T09:00:00.000Z"));
    }

    #[test]
    fn active_runs_name_their_current_nodes_newest_first() {
        let runs = vec![
            dash("repo", vec![started("older", "2033-04-05T09:00:00.000Z"),
                              ev("older", "2033-04-05T09:01:00.000Z", EventKind::NodeStarted, Some("worker"), None)]),
            dash("repo", vec![started("newer", "2033-04-06T09:00:00.000Z"),
                              ev("newer", "2033-04-06T09:01:00.000Z", EventKind::NodeStarted, Some("worker"), None),
                              ev("newer", "2033-04-06T09:02:00.000Z", EventKind::NodeStarted, Some("review"), None)]),
        ];
        let summary = fold_dashboard(&runs, FROM, TO, None, now());
        assert_eq!(summary.active_total, 2);
        assert_eq!(summary.active[0].run_id, "newer");
        let names: Vec<&str> = summary.active[0].current_nodes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["Review", "Worker"]);
        assert_eq!(summary.live.running, 2);
        assert_eq!(summary.active[0].cost_usd, None);
    }
}
