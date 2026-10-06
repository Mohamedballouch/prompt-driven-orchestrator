# Dashboard and analytics — UI01–UI05 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first useful release of the dashboard plan: trustworthy cost units and coverage (UI01–UI02), readable text and textual status (UI03), a bounded dashboard summary API (UI04), and a Dashboard destination that is the landing view on a fresh visit (UI05).

**Architecture:** The daemon keeps deriving every figure on read (ADR-0029). `stats.rs` gains an explicit unit and a complete/partial/unavailable coverage on every cost aggregate, a per-slice model-axis Total and an optional `project` cohort filter. A new sibling, `stats_dashboard.rs`, folds the same run projection `GET /runs` uses into a bounded `GET /stats/dashboard` response. The frontend reads the new fields in the Stats Cost tab, and a new `Dashboard` component, fed by a `useDashboard` hook, renders in the center panel. The editor stays mounted (hidden) underneath, so tabs, unsaved edits and terminals survive.

**Tech Stack:** Rust (axum 0.8, sqlx/SQLite, serde, chrono), React 19 + TypeScript 6 + Tailwind v4 tokens, Vitest + Testing Library (jsdom), Playwright e2e.

**Spec:** [docs/plans/dashboard-and-analytics.md](dashboard-and-analytics.md) (binding), with evidence in [docs/plans/dashboard-and-analytics-review.md](dashboard-and-analytics-review.md) and concept images under [docs/assets/dashboard-and-analytics/](../assets/dashboard-and-analytics/).

## Global Constraints

- Scope is UI01–UI05 only. No Analytics overview or shared Stats filters (UI06), no drill-downs or period comparisons (UI07), no launch-form or run-summary rework (UI08), no insight cards (UI09).
- Daemon JSON is snake_case (no `rename_all = "camelCase"` anywhere in stats types). Every API change is **additive**; existing consumers keep working.
- Unknown cost is `null` and renders `—`, never `$0` (ADR-0045/0052/0058). Use `formatCostAmount` (`frontend/src/lib/costLabel.ts`): `~` = estimated, `†` = lower bound.
- Cohort: Runs whose `run_started` timestamp is in the half-open window `[from, to)`, compared as UTC ISO strings ending in `Z`. The frontend sends UTC day starts.
- Aggregates are derived on read, never materialized (ADR-0029). No new DB tables, no new `EventKind`. Per-run cost goes through `run_cost::compute_run_cost_breakdown_cached` / `derive_run_cost` (memoized).
- `CONTEXT.md` and `docs/adr/**` have a single writer (the grilling session, `docs/agents/domain.md`). **Do not edit them.** Vocabulary proposals go in `docs/reference/dashboard-metrics.md` § "Glossary proposals for the next grilling".
- Module layout (`docs/agents/module-layout.md`): only the new files this plan lists. Ratchet changes in `scripts/layout-ratchet.sh` exactly as specified, each with a justification paragraph in its header.
- UI copy is English. Glossary terms keep their existing capitalisation in UI text ("Run", "Node", "Pipeline", "Stats").
- Stats settings stay ephemeral (CONTEXT « Réglages de Stats éphémères »). Dashboard filters are component state with defaults on every mount: period **30 days**, **All projects**. No localStorage.
- No dashboard control may have an accessible name containing the substring "new run" (e2e specs use `getByRole("button", { name: "New Run" })`, a case-insensitive substring match). The dashboard launch button is **"Start a run"**.
- Opening, refreshing or filtering the dashboard issues GET requests only. Inspection never approves, retries, resumes or publishes.
- Theme: use existing tokens (`text-fg`, `text-fg-2`, `text-fg-3`, `bg-bg-2/3/4`, `st-*`), no hex colours in components. Informative text uses `text-fg-3` or stronger; `text-fg-4` only for decorative or disabled text.
- Status is never conveyed by colour alone: every status dot this plan adds or touches carries a visible text label.
- Commits: `type(scope): description`, description in French like the history (e.g. `feat(stats): unité et couverture du coût`). Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run git from Git Bash on Windows, **never `git` inside WSL**. Never push, never merge, never amend existing commits.
- Toolchain: Rust and Node live in WSL Ubuntu-24.04. From the repo root in Git Bash:
  - repo root: `.superpowers/sdd/tools/wsl.sh <cmd…>`, e.g. `.superpowers/sdd/tools/wsl.sh cargo test -p pdo-daemon --lib stats::tests::`
  - `frontend/`: `.superpowers/sdd/tools/wslf.sh <cmd…>`, e.g. `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/components/StatsCharts.test.tsx`
  - Arguments pass verbatim. `CARGO_TARGET_DIR` is set by the wrapper. Never run `cargo`/`pnpm` on Windows directly.
- Before each task commit: the task's tests green, plus `.superpowers/sdd/tools/wsl.sh cargo check --workspace` if Rust changed and `.superpowers/sdd/tools/wslf.sh pnpm run typecheck` if the frontend changed. Use `PDO_SKIP_FRONTEND_BUILD=1` only when you know `frontend/dist` is current: `.superpowers/sdd/tools/wsl.sh env PDO_SKIP_FRONTEND_BUILD=1 cargo test …`.

## Review Focus

1. **Empty populations** (no Run in the period, a Project with no Runs, an instance with no Runs at all): every rate, median and amount reads `—`, never `0`, `NaN` or `$0.00`. Pinned in Task 2 (empty model-axis Total), Task 5 (empty cohort), Task 7 (empty dashboard).
2. **Partially known cost**: a Run whose node cost is read but whose infrastructure cost is not still contributes its known dollars and counts as *partial*, not unknown and not zero. Pinned in Task 2 (coverage fold) and Task 3 (coverage line).
3. **A failed or slow request while other data is fine**: the summary failing must not blank the cost card (and vice versa); a refetch failure keeps the last data visible and marked stale. Pinned in Task 6 (hook) and Task 7 (component).
4. **Project ids that are filesystem paths** (`/home/u/repo` when the repo belongs to no named Project): the filter round-trips through URL encoding and selects exactly that Project. Pinned in Task 2 (cost HTTP test) and Task 5 (dashboard HTTP test).
5. **Leaving and returning to the editor**: open tabs, unsaved edits, canvas and terminal survive a trip through the Dashboard, and editor keyboard shortcuts do not fire on the hidden canvas. Pinned in Task 7 (App navigation tests) and Task 8 (e2e).

---

### Task 1: Metric and population definitions (UI01)

**Files:**
- Create: `docs/reference/dashboard-metrics.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the contract every later task implements. Its constants (`FAILED_ATTENTION_DAYS = 7`, `P95_MIN_SAMPLES = 20`, `ATTENTION_LIMIT = 20`, `ACTIVE_LIMIT = 10`, `RECENT_LIMIT = 8`, eligible statuses, unit names `run|execution|slice`, coverage names `complete|partial|unavailable`) are used verbatim by Tasks 2–7.

- [ ] **Step 1: Write the document**

Create `docs/reference/dashboard-metrics.md` with exactly this content:

````markdown
# Dashboard and cost metrics

What every figure on the Dashboard and in Stats › Cost counts, over which Runs, and where it comes from. This is the contract for backlog items UI01–UI05 of the [dashboard and analytics plan](../plans/dashboard-and-analytics.md). Vocabulary follows [CONTEXT.md](../../CONTEXT.md); where this page needs a word the glossary does not have yet, it is listed under [Glossary proposals](#glossary-proposals-for-the-next-grilling) rather than added to the glossary.

## Populations

| Population | Definition | Used by |
| --- | --- | --- |
| **Period cohort** | Runs whose `run_started` timestamp falls in the half-open UTC window `[from, to)`. A Run's executions and its whole cost count in the period it started in, even work that finished after `to`. | Recorded spend, completed runs, median completion time, spend trend |
| **Live now** | Runs whose current status is `running`, `awaiting_user` or `paused`, whatever their start date. | Live counts, active work, attention (waits) |
| **Recent failures** | Runs with status `failed` whose failure was recorded within the last **7 days** (`FAILED_ATTENTION_DAYS`). | Attention (failures) |
| **Recent results** | The **8** most recently completed Runs (`RECENT_LIMIT`), whatever their start date. | Recent results |

Every population can be narrowed to one **Project**. A Run belongs to the Project that owns its primary repository; a Run whose repository belongs to no named Project is grouped under that repository's path, named after its last path segment (the same rule as Stats › Cost › By project). The period never hides a Live now item.

Periods are UTC calendar days: 7, 30 or 90 days ending today, `to` being tomorrow 00:00 UTC.

## Run status mapping

| Status | Live | Terminal | In the completion-rate denominator | Attention |
| --- | --- | --- | --- | --- |
| `running` | yes | — | no | — |
| `awaiting_user` | yes | — | no | *waiting for you*, or *blocked* when the wait is an incident |
| `paused` | yes | — | no | — |
| `completed` | — | yes | yes (numerator too) | — |
| `failed` | — | yes | yes | *failed*, for 7 days |
| `halted` (shown as "Stopped") | — | yes | yes | — |
| `skipped` | — | yes | **no**: a skipped Run had nothing to do, it did not attempt work | — |
| `archived` | — | yes | **no**: its outcome before archiving is not recorded on the status | — |

**Completion rate** = completed ÷ (completed + failed + halted) over the period cohort; `—` when that denominator is 0. Skipped, archived and still-live Runs are listed beside it, never folded in. A completed Run is not an accepted deliverable: nothing here reads acceptance.

## Cost

Cost is an **estimate** derived from local transcripts or reported by the harness (ADR-0022, ADR-0052), in USD. Unknown is `—`, never `$0`. `~` marks an estimate, `†` a lower bound (a model without a price).

### Units

Every cost aggregate on the wire carries `unit`, the thing its `executions`, `readable`, `unknown`, `coverage`, `average_usd` and `median_usd` count:

| `unit` | One sample is | Where |
| --- | --- | --- |
| `run` | one Run's whole recorded cost | `total`, `by_period`, pipeline and project rows and headlines |
| `execution` | one Node execution (a start; every loop lap and restart counts) | Node rows, Infrastructure and Unassigned rows |
| `slice` | one execution's spend on one model × effort; an execution that used two models is two slices | `by_model` and its levels, Node model pairs, `model_total` |

The UI says "per Run" for `run` and "per execution" for `execution` and `slice` (on the model axis one execution per model, ADR-0065 §3). Switching the grouping changes the label only when the population changes with it.

### Coverage

Every cost aggregate also carries `coverage = { complete, partial, unavailable }`, counted in its `unit` and always summing to `executions`:

- **complete**: every contribution of the sample was read, none is a lower bound;
- **partial**: some spend is known, but at least one contribution is unknown or a lower bound (`†`); its known dollars are included in the total;
- **unavailable**: no spend is known for the sample.

For a Run, the contributions are its Node executions, its Infrastructure contribution (manager and merge resolvers) and any Unassigned leftover (ADR-0058). Many Runs show *partial* only because their Infrastructure contribution has no attributable transcript ("no attributable infrastructure cost"); that is reported as is, not guessed to be zero.

### Figures

| Figure | Definition |
| --- | --- |
| **Recorded estimated spend** | Sum of every known contribution of the period cohort's Runs (`total.usd`), shown with its coverage. A partial Run adds its known dollars. Not an invoice. |
| **Median cost per Run** | R-7 median of the totals of the cohort Runs whose every contribution was read (`readable`). The sample size is shown. |
| **Median cost per execution** | R-7 median of the readable execution samples (a contribution's dollars spread evenly over its readable executions). Never a median of group medians. |
| **Model-axis Total** | `model_total`: the fold of every model × effort slice of the cohort, so it reconciles with the model rows below it. Its median is per slice ("per execution"). |

## Dashboard figures

| Card / list | Population | Definition | Source |
| --- | --- | --- | --- |
| Recorded spend | Period cohort | `total.usd` with `total.coverage` | `GET /stats/cost?…&project=` |
| Completed runs | Period cohort | `completion.completed` of `completion.eligible`, rate as above; failed, stopped, skipped and running listed beside it | `GET /stats/dashboard` `cohort`, `completion` |
| Median completion time | Completed Runs of the period cohort | Wall time `completed_at − started_at`, R-7 median; p95 only from **20** completed Runs (`P95_MIN_SAMPLES`); the count is shown. Parallel Node durations are never summed. | `completion_time` |
| Live now | Live now | Counts of running, awaiting user, paused | `live` |
| Needs attention | Live now + recent failures | Count of attention items | `attention_total` |
| Attention list | Live now + recent failures | Up to **20** items (`ATTENTION_LIMIT`): waits first, oldest first; then failures, newest first. Each item names its kind, Run, Pipeline, Node when known, reason and age, and opens that Run (and Node). | `attention` |
| Active work | Live now | Up to **10** Runs (`ACTIVE_LIMIT`), newest first: name, Pipeline, current Node or the number of Nodes running in parallel, elapsed wall time, cost so far | `active` |
| Spend trend | Period cohort | One bar per UTC calendar day in the period, in USD. A day with no Run started reads *no activity*; a day whose Runs have no known cost reads *unknown*; a day before the Project's first recorded Run reads *outside the data window*. | `by_period` of `GET /stats/cost?bucket=day`, `first_run_at` |
| Recent results | Recent results | Name, Pipeline, completion age, wall time, unresolved review comments; *Open result* and *Review changes* | `recent_results` |

### Attention rules

- *waiting for you*: a live Run in `awaiting_user` without an incident code. Its Node is the earliest-declared awaiting Node; the reason is that Node's question, else the Run's awaiting reason; the age runs from the declaration. A Run awaiting only because a child Run awaits (`child_awaiting`) is not listed: the child is.
- *blocked*: a live Run in `awaiting_user` with an incident code (`session_died`, `run_stalled`, `merge_conflict`, …). The reason is the Run's awaiting reason; the age runs from the Run's last event.
- *failed*: a Run failed within the last 7 days. Its Node is the first failed Node; the reason is the Run's failure reason; the age runs from the failure.
- Archived Runs are never attention items.

### Freshness

The summary is refetched at most every 2 seconds after a daemon event while the Dashboard is visible. Cost is refetched only on open, on a period or Project change and on Refresh (the cost fold is the heavy, memoized one). Each response carries `computed_at`; a failed refetch keeps the last data on screen, marked stale. A disconnected daemon is announced in a banner.

## Not shipped

No queue-time chart, spend forecast, accepted-output score, savings percentage, retry attribution or cost per completed outcome: their source data and calculation do not exist yet. The concept images' queue segments are illustrative.

## Glossary proposals for the next grilling

Implementation does not write `CONTEXT.md` (`docs/agents/domain.md`). These terms are used by the code and this page and are proposed for the next grilling:

- **Couverture du coût** *(coverage)*: complète / partielle / indisponible, comptée dans l'unité de l'agrégat. _Éviter_ : « runs sans coût calculable » quand une partie du coût est connue.
- **Unité d'un agrégat de coût** *(cost unit)*: Run, exécution, tranche modèle × effort.
- **Tableau de bord** *(Dashboard)*: l'accueil, ce qui demande une décision maintenant et ce qui tourne, à côté des chiffres de la période.
- **Attention** *(attention item)*: attente déclarée, attente sur incident (« bloqué »), échec récent.

## Decisions taken without a grilling

Each is cheap to change; each was decided for the first release and recorded here so it can be revisited:

1. Skipped and archived Runs are outside the completion-rate denominator.
2. Halted Runs are labelled "Stopped" and count as non-completed attempts.
3. Failures stay attention items for 7 days.
4. p95 completion time needs at least 20 completed Runs.
5. The Dashboard summary is a dedicated read-only endpoint, `GET /stats/dashboard`, rather than an extension of `/stats/overview` (whose cheap SQL contract, ADR-0029, it would break).
6. The model-axis Total is the fold of all slices (`model_total`), not the per-Run `total`.
````

- [ ] **Step 2: Check the links resolve**

Run (Git Bash, repo root): `ls docs/plans/dashboard-and-analytics.md CONTEXT.md` — both exist, so `../plans/dashboard-and-analytics.md` and `../../CONTEXT.md` from `docs/reference/` resolve.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/dashboard-metrics.md
git commit -m "docs(stats): définitions des métriques du tableau de bord (UI01)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cost unit, coverage, model-axis Total and Project filter in the daemon (UI02, backend)

**Files:**
- Modify: `crates/pdo-daemon/src/stats.rs` — `StatsQuery` (~line 35), `StatsHarnessCost` / `StatsCostAggregate` / `StatsCost` (~633-808), `CostMetricAcc` and its impls (~810-1060), `project_identity` (~277), `fold_harness_cost` (~1469), `stats_cost` (~1764), tests module (~1914+)
- Modify: `crates/pdo-daemon/src/lib.rs` — tests module only (one new HTTP test)

**Interfaces:**
- Consumes: nothing new.
- Produces (wire, consumed by Tasks 3, 6, 7):
  - `StatsCostAggregate` and `StatsHarnessCost` gain `unit: "run" | "execution" | "slice"` and `coverage: { complete: i64, partial: i64, unavailable: i64 }`.
  - `StatsCost` gains `model_total: StatsCostAggregate` (unit `slice`) and `model_total_by_period: Vec<StatsCostPeriod>`.
  - `GET /stats/cost` accepts `project=<project id>`; the cohort keeps only that Project's Runs.
  - Rust: `pub(crate) fn project_identity_for_root(root: &Path, projects: &[crate::project_store::Project]) -> (String, String)` in `stats.rs` (consumed by Task 5).

- [ ] **Step 1: Write the failing fold tests**

In `crates/pdo-daemon/src/stats.rs`, inside `mod tests`, next to the existing `node_run_row` / `claude_node_contribution` helpers (~line 2431), add these helpers and tests:

```rust
    fn infra_contribution(usd: Option<f64>) -> crate::run_cost::CostContribution {
        crate::run_cost::CostContribution {
            harness: "claude".to_string(),
            scope: crate::run_cost::CostScope::Infrastructure,
            node_id: None,
            executions: 1,
            readable_executions: i64::from(usd.is_some()),
            usd,
            form: usd.map(|_| crate::event_log::CostForm::Derived),
            reported_in_usd: false,
            partial: false,
            unpriced_models: Vec::new(),
            unavailable_reasons: usd
                .is_none()
                .then(|| "no attributable infrastructure cost".to_string())
                .into_iter()
                .collect(),
            model_slices: Vec::new(),
        }
    }

    fn priced_slice(model: &str, usd: Option<f64>, partial: bool) -> crate::run_cost::ModelEffortSlice {
        crate::run_cost::ModelEffortSlice {
            model: model.to_string(),
            model_observed: true,
            effort: None,
            effort_observed: None,
            provider: None,
            usd,
            estimated: true,
            partial,
            executions: 1,
            unpriced_models: if partial { vec![model.to_string()] } else { Vec::new() },
            missing_reasons: Vec::new(),
        }
    }

    fn cohort_row(run_id: &str, contributions: Vec<crate::run_cost::CostContribution>) -> CostRunRow {
        let mut row = node_run_row("2033-04-02", "worker", "Worker", contributions);
        row.run_id = run_id.to_string();
        row
    }

    #[test]
    fn run_level_aggregates_count_runs_with_contribution_coverage() {
        let mut lower_bound = claude_node_contribution("worker", Some(2.0), Vec::new());
        lower_bound.partial = true;
        lower_bound.unpriced_models = vec!["mystery".to_string()];
        let runs = vec![
            // every contribution read → complete
            cohort_row("complete", vec![
                claude_node_contribution("worker", Some(1.0), Vec::new()),
                infra_contribution(Some(0.5)),
            ]),
            // node read, infrastructure unknown → partial, its dollar still counts
            cohort_row("infra-unknown", vec![
                claude_node_contribution("worker", Some(3.0), Vec::new()),
                infra_contribution(None),
            ]),
            // a lower bound (unpriced model) → partial
            cohort_row("lower-bound", vec![lower_bound, infra_contribution(Some(0.0))]),
            // nothing known → unavailable
            cohort_row("unknown", vec![
                claude_node_contribution("worker", None, Vec::new()),
                infra_contribution(None),
            ]),
        ];

        let stats = fold_harness_cost(&runs, Vec::new(), &Default::default());

        assert_eq!(stats.total.unit, CostUnit::Run);
        assert_eq!(stats.total.executions, 4);
        assert_eq!(
            stats.total.coverage,
            CostCoverage { complete: 1, partial: 2, unavailable: 1 }
        );
        assert_eq!(stats.total.usd, Some(6.5));
        let claude = &stats.total.harnesses[0];
        assert_eq!(claude.unit, CostUnit::Run);
        assert_eq!(
            claude.coverage.complete + claude.coverage.partial + claude.coverage.unavailable,
            claude.executions
        );
        assert_eq!(stats.by_period[0].aggregate.unit, CostUnit::Run);
        assert_eq!(stats.by_pipeline[0].aggregate.unit, CostUnit::Run);
        // Node rows count executions, Infrastructure included.
        let pipeline = &stats.by_pipeline[0];
        let worker = pipeline.nodes.iter().find(|n| n.id == "worker").unwrap();
        assert_eq!(worker.aggregate.unit, CostUnit::Execution);
        assert_eq!(
            worker.aggregate.coverage,
            CostCoverage { complete: 2, partial: 1, unavailable: 1 }
        );
        let infra = pipeline.nodes.iter().find(|n| n.name == "Infrastructure").unwrap();
        assert_eq!(infra.aggregate.unit, CostUnit::Execution);
        assert_eq!(
            infra.aggregate.coverage,
            CostCoverage { complete: 2, partial: 0, unavailable: 2 }
        );
    }

    #[test]
    fn model_axis_total_folds_slices_and_reconciles_with_model_rows() {
        // Unequal samples: opus 3 slices ($1, $2, $3), sonnet 1 slice ($10).
        let runs = vec![
            cohort_row("a", vec![claude_node_contribution("worker", Some(1.0), vec![priced_slice("opus", Some(1.0), false)])]),
            cohort_row("b", vec![claude_node_contribution("worker", Some(2.0), vec![priced_slice("opus", Some(2.0), false)])]),
            cohort_row("c", vec![claude_node_contribution("worker", Some(3.0), vec![priced_slice("opus", Some(3.0), false)])]),
            cohort_row("d", vec![claude_node_contribution("worker", Some(10.0), vec![priced_slice("sonnet", Some(10.0), false)])]),
        ];

        let stats = fold_harness_cost(&runs, Vec::new(), &Default::default());

        assert_eq!(stats.model_total.unit, CostUnit::Slice);
        assert_eq!(stats.model_total.executions, 4);
        let rows_usd: f64 = stats.by_model.iter().map(|m| m.entity.aggregate.usd.unwrap()).sum();
        assert_eq!(stats.model_total.usd, Some(rows_usd));
        // R-7 median of [1, 2, 3, 10] — from the samples, not from the rows' medians.
        assert_eq!(stats.model_total.median_usd, Some(2.5));
        assert_eq!(stats.model_total.coverage, CostCoverage { complete: 4, partial: 0, unavailable: 0 });
        assert!(stats.by_model.iter().all(|m| m.entity.aggregate.unit == CostUnit::Slice));
        assert_eq!(stats.model_total_by_period.len(), 1);
        assert_eq!(stats.model_total_by_period[0].aggregate.unit, CostUnit::Slice);
        // The per-Run total is a different population, and says so.
        assert_eq!(stats.total.unit, CostUnit::Run);
    }

    #[test]
    fn empty_cohort_wires_an_empty_slice_total_never_zero() {
        let stats = fold_harness_cost(&[], Vec::new(), &Default::default());
        assert_eq!(stats.model_total.unit, CostUnit::Slice);
        assert_eq!(stats.model_total.executions, 0);
        assert_eq!(stats.model_total.usd, None);
        assert_eq!(stats.model_total.median_usd, None);
        assert_eq!(stats.model_total.coverage, CostCoverage::default());
        assert!(stats.model_total_by_period.is_empty());
        assert_eq!(stats.total.usd, None);
        assert_eq!(stats.total.coverage, CostCoverage::default());
    }

    #[test]
    fn a_slice_with_an_unpriced_model_is_partial_coverage() {
        let runs = vec![cohort_row(
            "a",
            vec![claude_node_contribution("worker", Some(1.0), vec![
                priced_slice("opus", Some(1.0), false),
                priced_slice("mystery", Some(0.0), true),
                priced_slice("ghost", None, false),
            ])],
        )];
        let stats = fold_harness_cost(&runs, Vec::new(), &Default::default());
        assert_eq!(
            stats.model_total.coverage,
            CostCoverage { complete: 1, partial: 1, unavailable: 1 }
        );
    }
```

If `ModelEffortSlice` or `CostContribution` has fields other than those used above, the compiler will name them. Fill them with the neutral value (`None`, `false`, empty `Vec`) and keep the assertions unchanged.

- [ ] **Step 2: Run the tests to see them fail**

Run: `.superpowers/sdd/tools/wsl.sh env PDO_SKIP_FRONTEND_BUILD=1 cargo test -p pdo-daemon --lib stats::tests:: 2>&1 | tail -20`
Expected: compile errors: `CostUnit`, `CostCoverage`, `unit`, `coverage`, `model_total` and `model_total_by_period` not found. (If `frontend/dist` does not exist yet, run `.superpowers/sdd/tools/wslf.sh pnpm run build` once first.)

- [ ] **Step 3: Add the wire types**

In `stats.rs`, just above `pub(crate) struct StatsHarnessCost`, add:

```rust
/// What one sample of a cost aggregate is (UI02, docs/reference/dashboard-metrics.md):
/// the unit its `executions`, `readable`, `unknown`, `coverage`, `average_usd` and
/// `median_usd` count. A Run on `total`, periods, Pipelines and Projects; a Node
/// execution on Node rows; a model × effort slice of one on the « By model » axis.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CostUnit {
    #[default]
    Run,
    Execution,
    Slice,
}

/// How completely each sample's cost is known (UI02), in the aggregate's `unit`:
/// `complete` — every contribution read and none a lower bound; `partial` — some
/// spend known, but a contribution is unknown or a lower bound (`†`); `unavailable`
/// — no spend known. The three always sum to `executions`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub(crate) struct CostCoverage {
    pub complete: i64,
    pub partial: i64,
    pub unavailable: i64,
}
```

Add these two fields at the end of **both** `StatsHarnessCost` (after `provider`) and `StatsCostAggregate` (after `harnesses`):

```rust
    /// UI02: what the counts and the median of this aggregate count.
    pub unit: CostUnit,
    /// UI02: complete / partial / unavailable samples, in `unit`.
    pub coverage: CostCoverage,
```

On `StatsCostAggregate`, replace the doc comment of `median_usd` (it currently says "Median cost per readable execution", which is false for Run-unit aggregates) with:

```rust
    /// R-7 median of the readable samples' cost, in `unit` (#811, UI02): per Run
    /// on Run aggregates, per execution on Node rows, per slice on the model axis.
```

Add to `StatsCost`, after `by_model`:

```rust
    /// UI02: the « By model » axis Total — every model × effort slice of the
    /// cohort, so it reconciles with the model rows (`total` is per Run).
    pub model_total: StatsCostAggregate,
    pub model_total_by_period: Vec<StatsCostPeriod>,
```

- [ ] **Step 4: Track unit and coverage in the accumulator**

In `struct CostMetricAcc`, add after `missing_reasons`:

```rust
    /// UI02: what one sample is, set by the first `add_*` — an accumulator only
    /// ever receives one kind of add. `None` (nothing added) wires as `Run`.
    unit: Option<CostUnit>,
    coverage: CostCoverage,
```

At the end of `add_contribution`, append:

```rust
        self.unit.get_or_insert(CostUnit::Execution);
        self.coverage.unavailable +=
            (contribution.executions - contribution.readable_executions).max(0);
        if contribution.partial {
            self.coverage.partial += contribution.readable_executions;
        } else {
            self.coverage.complete += contribution.readable_executions;
        }
```

In `add_run`, after the `for contribution in contributions { … }` loop and before `if all_readable {`, insert:

```rust
        self.unit.get_or_insert(CostUnit::Run);
        let any_known = contributions.iter().any(|c| c.usd.is_some());
        let any_lower_bound = contributions.iter().any(|c| c.partial);
        if all_readable && !any_lower_bound {
            self.coverage.complete += 1;
        } else if any_known {
            self.coverage.partial += 1;
        } else {
            self.coverage.unavailable += 1;
        }
```

At the end of `add_slice`, append:

```rust
        self.unit.get_or_insert(CostUnit::Slice);
        match (slice.usd.is_some(), slice.partial) {
            (true, false) => self.coverage.complete += slice.executions,
            (true, true) => self.coverage.partial += slice.executions,
            (false, _) => self.coverage.unavailable += slice.executions,
        }
```

In both `wire()` and `wire_harness()`, add to the struct literal:

```rust
            unit: self.unit.unwrap_or_default(),
            coverage: self.coverage,
```

In `impl CostAggregateAcc`, after `fn wire`, add:

```rust
    /// `wire`, for an accumulator whose unit is fixed even when it saw no sample:
    /// the model-axis Total of an empty cohort is still a slice aggregate.
    fn wire_as(&self, unit: CostUnit) -> StatsCostAggregate {
        let mut aggregate = self.wire();
        aggregate.unit = unit;
        for harness in &mut aggregate.harnesses {
            harness.unit = unit;
        }
        aggregate
    }
```

- [ ] **Step 5: Fold the model-axis Total**

In `fold_harness_cost`, next to `let mut models_axis = …`, add:

```rust
    let mut model_total = CostAggregateAcc::default();
    let mut model_total_periods = BTreeMap::<String, CostAggregateAcc>::new();
```

Inside `for slice in &contribution.model_slices {`, as the first statements of the loop body, add:

```rust
                // UI02: the « By model » Total folds the same slices as its rows.
                model_total.add_slice(&contribution.harness, slice);
                model_total_periods
                    .entry(run.bucket.clone())
                    .or_default()
                    .add_slice(&contribution.harness, slice);
```

In the final `StatsCost { … }` literal, add:

```rust
        model_total: model_total.wire_as(CostUnit::Slice),
        model_total_by_period: wire_periods(model_total_periods),
```

Fix every other place that builds a `StatsCostAggregate`, `StatsHarnessCost` or `StatsCost` literal (the compiler lists them; e.g. absorption or test code): add `unit: CostUnit::Run, coverage: CostCoverage::default()` to an aggregate, and `model_total: StatsCostAggregate`/`model_total_by_period: Vec::new()` to a `StatsCost`, choosing the unit that matches how the literal's figures were counted.

- [ ] **Step 6: Run the fold tests**

Run: `.superpowers/sdd/tools/wsl.sh env PDO_SKIP_FRONTEND_BUILD=1 cargo test -p pdo-daemon --lib stats:: 2>&1 | tail -20`
Expected: all `stats::` tests pass, including the four new ones. If an existing test asserts a full JSON/struct equality and now fails only because of the new fields, add the fields to its expectation with the values the fold produces. Do not change what it asserted before.

- [ ] **Step 7: Write the failing Project-filter HTTP test**

In `crates/pdo-daemon/src/lib.rs`, inside the `mod tests` module, right after the test `stats_overview_and_cost_share_the_completed_only_cohort`, add:

```rust
    #[tokio::test]
    async fn stats_cost_project_filter_keeps_only_that_projects_runs() {
        let state = test_state().await;
        let repo = state.repo_root.to_string_lossy().into_owned();

        async fn insert_event(db: &sqlx::SqlitePool, run: &str, ts: &str, kind: &str, payload: serde_json::Value) {
            sqlx::query(
                "INSERT INTO events (run_id, ts, kind, node_id, iter, payload) VALUES (?, ?, ?, NULL, NULL, ?)",
            )
            .bind(run)
            .bind(ts)
            .bind(kind)
            .bind(payload.to_string())
            .execute(db)
            .await
            .unwrap();
        }
        for (run, target) in [("proj-here", repo.as_str()), ("proj-other", "/tmp/pdo-other-repo")] {
            insert_event(
                &state.db,
                run,
                "2033-04-02T09:00:00.000Z",
                "run_started",
                serde_json::json!({
                    "pipeline_id": "p", "pipeline_name": "p", "target_repo": target, "harness": "claude",
                    "node_defs": [{"id": "worker", "name": "Worker", "node_type": "agent"}]
                }),
            )
            .await;
        }

        async fn call(state: &Arc<AppState>, uri: &str) -> serde_json::Value {
            let response = build_router(state.clone())
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{uri}");
            serde_json::from_slice(&axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
        }
        let base = "/stats/cost?from=2033-04-01T00:00:00.000Z&to=2033-04-03T00:00:00.000Z&bucket=day";

        let all = call(&state, base).await;
        assert_eq!(all["total"]["executions"], 2);
        assert_eq!(all["total"]["unit"], "run");
        assert!(all["model_total"].is_object());

        let other = call(&state, &format!("{base}&project=%2Ftmp%2Fpdo-other-repo")).await;
        assert_eq!(other["total"]["executions"], 1);
        let projects: Vec<&str> = other["by_project"].as_array().unwrap().iter()
            .map(|p| p["id"].as_str().unwrap()).collect();
        assert_eq!(projects, vec!["/tmp/pdo-other-repo"]);

        let none = call(&state, &format!("{base}&project=no-such-project")).await;
        assert_eq!(none["total"]["executions"], 0);
        assert_eq!(none["total"]["usd"], serde_json::Value::Null);
    }
```

Run: `.superpowers/sdd/tools/wsl.sh env PDO_SKIP_FRONTEND_BUILD=1 cargo test -p pdo-daemon --lib tests::stats_cost_project_filter_keeps_only_that_projects_runs 2>&1 | tail -15`
Expected: FAIL on the second call (`executions` is 2: the parameter is ignored).

- [ ] **Step 8: Implement the filter and the reusable identity**

In `StatsQuery` add, after `uncombined`:

```rust
    /// UI04: keep only the Runs of this Project (a Project id, or the repository
    /// path of a Run whose repository belongs to no named Project — the ids of
    /// `by_project`). Read by `/stats/cost`; `/stats/overview` does not filter.
    #[serde(default)]
    pub project: Option<String>,
```

Replace `fn project_identity` with:

```rust
fn project_identity(
    payload: &serde_json::Value,
    daemon_root: &Path,
    projects: &[crate::project_store::Project],
) -> (String, String) {
    project_identity_for_root(&cost_project_root(payload, daemon_root), projects)
}

/// The Project a repository root belongs to, as `(id, name)`: the named Project
/// whose members list the root verbatim, else the root path itself named after
/// its last segment. Shared by the cost fold and the Dashboard (UI04).
pub(crate) fn project_identity_for_root(
    root: &Path,
    projects: &[crate::project_store::Project],
) -> (String, String) {
    let root_text = root.to_string_lossy().into_owned();
    if let Some(project) = projects
        .iter()
        .find(|project| project.members.iter().any(|member| member == &root_text))
    {
        return (project.id.clone(), project.name.clone());
    }
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(&root_text)
        .to_string();
    (root_text, name)
}
```

In `stats_cost`, immediately after `let (project_id, project_name) = project_identity(&payload, &state.repo_root, &stored_projects);`, add:

```rust
        // UI04: one Project's cost — Runs are dropped before any transcript is read.
        if q.project.as_deref().is_some_and(|wanted| wanted != project_id) {
            continue;
        }
```

- [ ] **Step 9: Run the Rust tests for this task**

Run: `.superpowers/sdd/tools/wsl.sh env PDO_SKIP_FRONTEND_BUILD=1 cargo test -p pdo-daemon --lib stats 2>&1 | tail -5`
Expected: all pass (this runs `stats::tests::*` and the lib `tests::stats_*` HTTP tests).
Then: `.superpowers/sdd/tools/wsl.sh env PDO_SKIP_FRONTEND_BUILD=1 cargo check --workspace --all-targets`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add crates/pdo-daemon/src/stats.rs crates/pdo-daemon/src/lib.rs
git commit -m "feat(stats): unité et couverture de chaque agrégat de coût, Total de l'axe modèle, filtre Projet (UI02)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Cost tab reads units and coverage from the wire (UI02, frontend)

**Files:**
- Modify: `frontend/src/types.ts` (cost types ~1876-2000)
- Modify: `frontend/src/lib/costLabel.ts` (add two helpers)
- Modify: `frontend/src/components/StatsCharts.tsx` — `coverage()`, `HarnessCards`, `CostCell`, `CostTable` (unit prop), `CostTab` (~1294-1678)
- Modify tests: `frontend/src/lib/costLabel.test.ts`, `frontend/src/components/StatsCharts.test.tsx`, and every other test file whose cost fixtures stop type-checking (find them with the typecheck)

**Interfaces:**
- Consumes (Task 2 wire): `unit`, `coverage` on `StatsCostAggregate`/`StatsHarnessCost`; `model_total`, `model_total_by_period` on `StatsCost`.
- Produces:
  - `types.ts`: `export type CostUnit = "run" | "execution" | "slice";` and `export interface CostCoverage { complete: number; partial: number; unavailable: number }`
  - `costLabel.ts`: `export function costUnitNoun(unit: CostUnit, count?: number): string` and `export function formatCoverage(coverage: CostCoverage, unit: CostUnit): string` (Task 7 reuses both).

- [ ] **Step 1: Add the types**

In `frontend/src/types.ts`, above `export interface StatsHarnessCost`, add:

```ts
/** What one sample of a cost aggregate is (UI02, docs/reference/dashboard-metrics.md):
 *  the unit `executions`, `readable`, `unknown`, `coverage` and the median count. */
export type CostUnit = "run" | "execution" | "slice";

/** Complete / partial / unavailable samples, in the aggregate's `unit`; sums to `executions`. */
export interface CostCoverage {
  complete: number;
  partial: number;
  unavailable: number;
}
```

Add `unit: CostUnit;` and `coverage: CostCoverage;` to both `StatsHarnessCost` and `StatsCostAggregate`. Replace the `median_usd` doc comment on `StatsCostAggregate` ("Median cost per readable execution") with `/** R-7 median of the readable samples, in \`unit\` (per Run, per execution or per model slice). */`. Add to `StatsCost`:

```ts
  /** The « By model » axis Total: every model × effort slice (unit `slice`), so it reconciles with `by_model`. */
  model_total: StatsCostAggregate;
  model_total_by_period: StatsCostPeriod[];
```

- [ ] **Step 2: Write the failing helper tests**

Append to `frontend/src/lib/costLabel.test.ts`:

```ts
import { costUnitNoun, formatCoverage } from "./costLabel";

describe("costUnitNoun (UI02)", () => {
  it("names a Run sample per Run and a slice per execution", () => {
    expect(costUnitNoun("run")).toBe("Run");
    expect(costUnitNoun("run", 2)).toBe("Runs");
    expect(costUnitNoun("execution")).toBe("execution");
    expect(costUnitNoun("slice", 3)).toBe("executions");
  });
});

describe("formatCoverage (UI02)", () => {
  it("states the three coverage counts with their unit", () => {
    expect(formatCoverage({ complete: 3, partial: 1, unavailable: 1 }, "run")).toBe(
      "5 Runs: 3 complete · 1 partial · 1 unavailable",
    );
    expect(formatCoverage({ complete: 1, partial: 0, unavailable: 0 }, "execution")).toBe(
      "1 execution: 1 complete · 0 partial · 0 unavailable",
    );
  });
});
```

(If `costLabel.test.ts` already imports from `./costLabel`, merge the import instead of adding a second one.)

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/lib/costLabel.test.ts`
Expected: FAIL, `costUnitNoun` is not exported.

- [ ] **Step 3: Implement the helpers**

Append to `frontend/src/lib/costLabel.ts` (import `CostUnit`, `CostCoverage` as types from `../types`):

```ts
/** The noun a cost median or coverage is "per" (UI02). A model slice reads as an
 *  execution (ADR-0065 §3): on the model axis one execution counts once per model. */
export function costUnitNoun(unit: CostUnit, count = 1): string {
  const noun = unit === "run" ? "Run" : "execution";
  return count === 1 ? noun : `${noun}s`;
}

/** « 5 Runs: 3 complete · 1 partial · 1 unavailable » — the coverage line (UI02). */
export function formatCoverage(coverage: CostCoverage, unit: CostUnit): string {
  const total = coverage.complete + coverage.partial + coverage.unavailable;
  return `${total} ${costUnitNoun(unit, total)}: ${coverage.complete} complete · ${coverage.partial} partial · ${coverage.unavailable} unavailable`;
}
```

Run the same vitest command. Expected: PASS.

- [ ] **Step 4: Write the failing Cost tab tests**

In `frontend/src/components/StatsCharts.test.tsx`:

1. Give every cost fixture the new fields. Each `StatsCostAggregate` and `StatsHarnessCost` literal gets the `unit` matching where it sits (`"run"` for `total`, periods, pipeline/project rows; `"execution"` for node rows; `"slice"` for `by_model` levels and model pairs), and a `coverage` consistent with its counts (`{ complete: readable, partial: 0, unavailable: unknown }` unless the fixture is `partial: true`, then put the readable count in `partial`). Give `COST` (and every other `StatsCost` fixture) a `model_total` and `model_total_by_period`. For `COST`, use a slice aggregate whose median differs from `total`'s, so the tests below can tell them apart:

```ts
  model_total: {
    usd: 9, average_usd: 4.5, median_usd: 4.5, estimated: true, partial: false,
    executions: 2, readable: 2, unknown: 0, unpriced_models: [], missing_reasons: [],
    harnesses: [], unit: "slice", coverage: { complete: 2, partial: 0, unavailable: 0 },
  },
  model_total_by_period: [],
```

2. Replace the test "reads per execution on the model axis and per Run at Total on By pipeline" (~lines 939-955), which pins the bug, with:

```tsx
    it("labels every median with the unit of the figure it shows (UI02)", async () => {
      const user = userEvent.setup();
      render(<StatsCharts tab="cost" overview={null} cost={COST} costError={null} />);

      // By pipeline › Total: per Run.
      expect(screen.getByTestId("stats-selection-headline")).toHaveTextContent(/median per Run$/);

      // A Pipeline selected: its headline is still per Run, only its Node rows are per execution.
      await user.click(screen.getByRole("option", { name: /Implement loop/ }));
      expect(screen.getByTestId("stats-selection-headline")).toHaveTextContent(/median per Run$/);

      // By model › Total: the slice fold, never the per-Run total relabelled.
      await user.selectOptions(screen.getByRole("combobox", { name: "Cost grouping" }), "model");
      expect(screen.getByTestId("stats-selection-headline")).toHaveTextContent(
        "~$9.00 total · ~$4.50 median per execution",
      );
    });

    it("shows complete, partial and unavailable coverage instead of a bare unknown count (UI02)", () => {
      render(<StatsCharts tab="cost" overview={null} cost={COST} costError={null} />);
      expect(screen.getByTestId("stats-cost-coverage")).toHaveTextContent(
        formatCoverage(COST.total.coverage, "run"),
      );
      expect(screen.queryByText(/without computable cost/i)).not.toBeInTheDocument();
    });
```

Import `formatCoverage` from `../lib/costLabel` at the top of the test file. In the existing test "shows totals and readable-cost medians without presenting unknown cost as zero", replace `expect(screen.getByText(/1 Run without computable cost/i)).toBeInTheDocument();` with `expect(screen.getByTestId("stats-cost-coverage")).toHaveTextContent(/partial|unavailable/);`, and change the harness-card expectation `"~$1.75† median"` to `"~$1.75† median per Run"`. Adjust the `CostCell` tooltip expectations to the fixture's unit, e.g. `/1 readable cost of 2 executions/i` stays for Node rows.

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/components/StatsCharts.test.tsx`
Expected: FAIL on the new expectations.

- [ ] **Step 5: Implement in `StatsCharts.tsx`**

1. `coverage()`: drop the `unit` parameter and read the metric's own unit:

```ts
function coverage(metric: StatsHarnessCost): string {
  const parts = [
    `${metric.readable} readable ${metric.readable === 1 ? "cost" : "costs"} of ${metric.executions} ${costUnitNoun(metric.unit, metric.executions)}`,
  ];
  if (metric.unpriced_models.length) {
    parts.push(`Lower bound; unpriced: ${metric.unpriced_models.join(", ")}`);
  }
  if (metric.missing_reasons.length) parts.push(metric.missing_reasons.join("; "));
  return parts.join(". ");
}
```

2. `CostCell`: remove the `unit` prop; call `coverage(metric)`. Remove the `unit` prop from `CostTable` and from its call in `CostTab` (and from any other caller the typecheck reports).

3. `HarnessCards`: the sub-line becomes

```tsx
          <div className="mt-1 text-fg-3" style={{ fontSize: "10px" }}>
            {metric.median_usd === null
              ? `— median per ${costUnitNoun(metric.unit)}`
              : `${formatCostAmount(metric.median_usd, metric.partial, metric.estimated)} median per ${costUnitNoun(metric.unit)}`}
          </div>
```

4. In `CostTab`, replace the `aggregate`/`periods` computation and delete `atNodeLevel` and `detailUnit`:

```ts
  // UI02: the model axis has its own Total — the fold of every slice, which
  // reconciles with the model rows; `cost.total` is per Run.
  const aggregate =
    axis === "model"
      ? (modelPipeline ?? effort ?? model ?? cost.model_total)
      : (drilledPipeline ?? selected ?? cost.total);
  const periods =
    axis === "model"
      ? ((modelPipeline ?? effort ?? model)?.by_period ?? cost.model_total_by_period)
      : drilledPipeline
        ? drilledPipeline.by_period
        : selected
          ? selected.by_period
          : cost.by_period;
```

5. The headline names the aggregate's own unit: replace `median per {detailUnit}` with `median per {costUnitNoun(aggregate.unit)}`.

6. Replace the `aggregate.unknown > 0 && (…without computable cost…)` block with:

```tsx
        {aggregate.executions > 0 && (
          <div
            className={`mt-4 ${aggregate.coverage.partial + aggregate.coverage.unavailable > 0 ? "text-st-await" : "text-fg-3"}`}
            style={{ fontSize: "10.5px" }}
            data-testid="stats-cost-coverage"
          >
            Coverage: {formatCoverage(aggregate.coverage, aggregate.unit)}
          </div>
        )}
```

Import `costUnitNoun` and `formatCoverage` from `../lib/costLabel`.

- [ ] **Step 6: Fix every other cost fixture, then run the suite**

Run: `.superpowers/sdd/tools/wslf.sh pnpm run typecheck 2>&1 | grep "error TS" | head -40`
Every error points at a cost fixture or caller missing `unit`/`coverage`/`model_total`. Fix each as in Step 4.1 (e.g. `StatsModal.test.tsx`, `StatsAbsorption.test.tsx`, `useStats.test.ts`, `PipelineInfoPanel.stats.test.tsx` if they build cost objects). Repeat until the typecheck is clean.

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/components/StatsCharts.test.tsx src/components/StatsModal.test.tsx src/components/StatsAbsorption.test.tsx src/hooks/useStats.test.ts src/lib/costLabel.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "fix(stats): chaque médiane de coût nomme son unité, Total de l'axe modèle par exécution, couverture visible (UI02)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Readable explanatory text and textual run status (UI03)

**Files:**
- Modify: `frontend/src/index.css` (dark `--color-fg-3` in the `@theme` block, ~line 21-126)
- Modify: `frontend/src/themePalette.test.ts` (`DARK_DEBT`, new bg-4 test)
- Modify: `frontend/src/components/StatsCharts.tsx`, `frontend/src/components/StatsModal.tsx` (informative `text-fg-4` → `text-fg-3`)
- Modify: `frontend/src/types.ts` (export `RUN_STATUS_LABEL`, `runStatusLabel`)
- Modify: `frontend/src/components/OrchestrationTab.tsx` (import the shared label map)
- Modify: `frontend/src/components/UnifiedLeftPanel.tsx` (run row status text)
- Modify: `frontend/src/components/PipelineInfoPanel.tsx` (header status text)
- Test: `frontend/src/components/UnifiedLeftPanel.test.tsx`, a PipelineInfoPanel test file (the existing one that renders its header), `frontend/src/lib/runStatus.test.ts` is **not** created; put the label test in `frontend/src/types.test.ts` if it exists, else in `UnifiedLeftPanel.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `types.ts` exports `RUN_STATUS_LABEL: Record<RunStatus, string>` and `runStatusLabel(status: RunStatus, stalled?: boolean): string` (Task 7 uses them).

- [ ] **Step 1: Write the failing palette test**

In `frontend/src/themePalette.test.ts`, delete the line `"fg-3": 4.08,` from `DARK_DEBT`, and append:

```ts
describe("informative text on the Stats and Dashboard panes (UI03)", () => {
  it.each([
    ["dark", dark],
    ["light", light],
  ] as const)("%s: fg, fg-2 and fg-3 hold AA (4.5:1) on bg-4", (_name, palette) => {
    for (const token of ["fg", "fg-2", "fg-3"]) {
      expect(contrastRatio(palette[token], palette["bg-4"])).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});
```

(Use the palette variables the file already defines for the dark and light token maps. If they are named differently than `dark`/`light`, use those names.)

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/themePalette.test.ts`
Expected: FAIL. Dark `fg-3` (#767e8c) is 3.62:1 on bg-4 and 4.09:1 on bg-3.

- [ ] **Step 2: Raise dark `fg-3`**

In `frontend/src/index.css`, in the dark `@theme` block, change `--color-fg-3: #767e8c;` to:

```css
  /* UI03: 5.33:1 on bg-3, 4.72:1 on bg-4 (the Stats and Dashboard panes) — was
     #767e8c, declared debt at 4.08:1. Still one step below fg-2. */
  --color-fg-3: #8a92a0;
```

Do not touch the light theme (`fg-3` is already 6.28:1 there). Run the palette test again. Expected: PASS.

- [ ] **Step 3: Informative Stats text uses `text-fg-3`**

In `frontend/src/components/StatsCharts.tsx`, change `text-fg-4` to `text-fg-3` on exactly these informative texts (find them by their content):
- `CohortLine`: the `completedOnly ? "text-st-await" : "text-fg-4"` → `"text-fg-3"`
- the "Ranked by cost" label
- the model-axis hint ("Model ids verbatim, one row per id …")
- `Breadcrumb`'s non-current crumbs
- `CostCell`'s median button
- the "default: all runs" note

In `frontend/src/components/StatsModal.tsx`, change the computed-at text ("Computed …"/"Updated …", ~lines 371-374) from `text-fg-4` to `text-fg-3`.

Leave every other `text-fg-4` alone (icons, separators, disabled states).

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/components/StatsCharts.test.tsx src/components/StatsModal.test.tsx`
Expected: PASS. If a test asserted the `text-fg-4` class on the cohort line, update it to `text-fg-3`.

- [ ] **Step 4: Write the failing status-label tests**

In `frontend/src/components/UnifiedLeftPanel.test.tsx`, next to the existing status-dot tests (~lines 434-524), add a test that renders the panel the same way those tests do. Give it a failed run (`status: "failed"`), an awaiting run (`status: "awaiting_user"`), a halted run (`status: "halted"`) and a stalled running run (`status: "running", stalled: true`), then assert:

```tsx
    const labels = screen.getAllByTestId("run-status-label").map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Failed", "Awaiting user", "Stopped", "Stalled"]));
```

In the PipelineInfoPanel test that renders the header with a run (search for `info-panel-name` in `frontend/src/components/*.test.tsx`), add:

```tsx
    expect(screen.getByTestId("info-panel-status")).toHaveTextContent("Running");
```

(render with a run whose `status` is `"running"`.)

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/components/UnifiedLeftPanel.test.tsx` and the PipelineInfoPanel test file.
Expected: FAIL, no `run-status-label` / `info-panel-status` element.

- [ ] **Step 5: Share the label map**

In `frontend/src/types.ts`, after `isTerminalRun`, add:

```ts
/** The words for a Run status (UI03): a status dot never speaks by colour alone.
 *  `halted` reads "Stopped" — the user-facing word for a halted Run. */
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  awaiting_user: "Awaiting user",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  halted: "Stopped",
  paused: "Paused",
  archived: "Archived",
};

/** `RUN_STATUS_LABEL`, with the display-only stalled overlay winning (#UI03). */
export function runStatusLabel(status: RunStatus, stalled = false): string {
  return stalled ? "Stalled" : RUN_STATUS_LABEL[status];
}
```

In `frontend/src/components/OrchestrationTab.tsx`, delete the local `RUN_STATUS_LABEL` constant and import it from `../types`. The only visible change there is that `halted` now reads "Stopped": update any OrchestrationTab test asserting "Halted" to "Stopped".

- [ ] **Step 6: Render the labels**

In `UnifiedLeftPanel.tsx`, in the run row's secondary line, prefix the `run-pipeline-name` span:

```tsx
                <span data-testid="run-status-label" className="shrink-0 text-fg-3">
                  {runStatusLabel(run.status, run.stalled ?? false)}
                </span>
                <span aria-hidden="true" className="text-fg-4">·</span>
                <span className="truncate" data-testid="run-pipeline-name">{run.pipeline_name}</span>
```

Keep the existing `run-pipeline-name` span and its classes. If the secondary line is not a flex row, make its wrapper `flex min-w-0 items-center gap-1` so the pipeline name still truncates.

In `PipelineInfoPanel.tsx`, in the header row next to the status dot, after the `info-panel-name` block's container, render when `run` is defined:

```tsx
          {run && (
            <span data-testid="info-panel-status" className="shrink-0 text-fg-3" style={{ fontSize: "10.5px" }}>
              {runStatusLabel(run.status)}
            </span>
          )}
```

Import `runStatusLabel` from `../types` in both files.

- [ ] **Step 7: Run the affected suites and typecheck**

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/themePalette.test.ts src/components/UnifiedLeftPanel.test.tsx src/components/OrchestrationTab.test.tsx src/components/StatsCharts.test.tsx src/components/StatsModal.test.tsx` plus the PipelineInfoPanel test file(s).
Expected: all pass. Some existing tests may assert a row's full text and now see the status word: update those expectations to include it, never remove the label.
Run: `.superpowers/sdd/tools/wslf.sh pnpm run typecheck`. Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "fix(ui): texte explicatif lisible (fg-3 AA) et statut de Run en toutes lettres (UI03)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Bounded dashboard summary endpoint (UI04, backend)

**Files:**
- Create: `crates/pdo-daemon/src/stats_dashboard.rs`
- Modify: `crates/pdo-daemon/src/distribution.rs` (add `r7_percentile`)
- Modify: `crates/pdo-daemon/src/lib.rs` (`mod stats_dashboard;` next to `mod stats_performance;` ~line 91; route next to `/stats/performance` ~line 5500; one HTTP test in `mod tests`)
- Modify: `scripts/layout-ratchet.sh` (daemon baseline 93 → 94 with justification)

**Interfaces:**
- Consumes: `crate::stats::project_identity_for_root` (Task 2); existing `crate::load_all_run_ids`, `crate::load_events`, `crate::event_log::project`, `crate::child_awaiting::overlay`, `crate::effective_repo_root`, `crate::derive_run_cost`, `crate::project_store::list`, `crate::event_log::now_iso`.
- Produces: `GET /stats/dashboard?from=<iso>&to=<iso>[&project=<id>]` returning the JSON below, consumed by Task 6. All fields snake_case; `Option` fields serialize as `null`.

```text
{ computed_at, from, to, project: string|null, first_run_at: string|null,
  projects: [{ id, name, runs }],
  cohort: { started, completed, failed, halted, skipped, archived, running, awaiting_user, paused },
  completion: { completed, eligible, rate: number|null },
  completion_time: { measured, median_ms: number|null, p95_ms: number|null },
  live: { running, awaiting_user, paused },
  attention_total, attention: [{ kind: "waiting_for_user"|"blocked"|"failed", run_id, run_name, pipeline_name,
                                 project_id, project_name, node_id, node_name, reason, since }],
  active_total, active: [{ run_id, run_name, pipeline_name, project_id, project_name, status, started_at,
                           current_nodes: [{ id, name, status }], cost_usd: number|null, cost_partial }],
  recent_results: [{ run_id, run_name, pipeline_name, project_id, project_name, completed_at, duration_ms, review_pending }] }
```

- [ ] **Step 1: Add the percentile helper with its test**

In `crates/pdo-daemon/src/distribution.rs`, after `r7_distribution`, add:

```rust
/// The R-7 quantile at `p` ∈ [0, 1] of unordered `values`, `None` when empty —
/// the same estimator as [`r7_distribution`], for one percentile (UI04's p95).
pub(crate) fn r7_percentile(values: &[f64], p: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    Some(r7_quantile(&sorted, p))
}
```

and in its `#[cfg(test)] mod tests` (create one at the end of the file if there is none, with `use super::*;`):

```rust
    #[test]
    fn r7_percentile_interpolates_and_is_none_when_empty() {
        assert_eq!(r7_percentile(&[], 0.95), None);
        assert_eq!(r7_percentile(&[7.0], 0.95), Some(7.0));
        // h = 19 * 0.95 = 18.05 → 19 + 0.05 * (20 - 19)
        let values: Vec<f64> = (1..=20).map(f64::from).collect();
        assert!((r7_percentile(&values, 0.95).unwrap() - 19.05).abs() < 1e-9);
    }
```

Run: `.superpowers/sdd/tools/wsl.sh env PDO_SKIP_FRONTEND_BUILD=1 cargo test -p pdo-daemon --lib distribution:: 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 2: Create the module with its types, pure fold and failing tests**

Create `crates/pdo-daemon/src/stats_dashboard.rs`:

```rust
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
            "node_defs": [{"id": "worker", "name": "Worker", "node_type": "agent"},
                          {"id": "review", "name": "Review", "node_type": "agent"}],
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
```

If a name used above differs in the codebase (e.g. `NodeStatus` is not `Clone`/`Eq`, `RunState::review_comments` has another type, `node_defs` entries are named differently, `Option::is_none_or` is unavailable on the toolchain, or `chrono::Duration::days` is deprecated in favour of `chrono::TimeDelta::days`), adapt the code to the real name. Keep the behaviour and the assertions.

In `crates/pdo-daemon/src/lib.rs`, add `mod stats_dashboard;` after `mod stats_absorption;` and before `mod stats_performance;` (alphabetical), and register the route right after `/stats/performance`:

```rust
        // UI04: the Dashboard's bounded summary — live attention, active Runs,
        // recent results and the period's outcomes. Read-only.
        .route("/stats/dashboard", get(stats_dashboard::stats_dashboard))
```

Run: `.superpowers/sdd/tools/wsl.sh env PDO_SKIP_FRONTEND_BUILD=1 cargo test -p pdo-daemon --lib stats_dashboard:: 2>&1 | tail -20`
Expected: the tests compile and pass. If an assertion fails, first print the projected `RunState` of its fixture (`dbg!(&run.state.status, &run.state.awaiting_reason_code, &run.state.nodes)`). If the events project to a different state than the test assumes (e.g. the projection needs another payload field), fix the fixture events. If the projection is as assumed, the fold breaks a rule of the metric document (Task 1): fix the fold. Never change an expected value to whatever the code returns.

- [ ] **Step 3: Write and run the HTTP test**

In `lib.rs` `mod tests`, after the Task 2 test, add:

```rust
    #[tokio::test]
    async fn stats_dashboard_summarizes_the_cohort_and_live_attention() {
        let state = test_state().await;
        let repo = state.repo_root.to_string_lossy().into_owned();
        async fn insert_event(db: &sqlx::SqlitePool, run: &str, ts: &str, kind: &str, node: Option<&str>, payload: serde_json::Value) {
            sqlx::query("INSERT INTO events (run_id, ts, kind, node_id, iter, payload) VALUES (?, ?, ?, ?, ?, ?)")
                .bind(run).bind(ts).bind(kind).bind(node).bind(node.map(|_| 1_i64)).bind(payload.to_string())
                .execute(db).await.unwrap();
        }
        let started = |target: &str| serde_json::json!({
            "pipeline_id": "p", "pipeline_name": "impl", "target_repo": target, "harness": "claude",
            "node_defs": [{"id": "worker", "name": "Worker", "node_type": "agent"}]
        });
        insert_event(&state.db, "dash-done", "2033-04-02T09:00:00.000Z", "run_started", None, started(&repo)).await;
        insert_event(&state.db, "dash-done", "2033-04-02T09:20:00.000Z", "run_completed", None, serde_json::json!({})).await;
        insert_event(&state.db, "dash-wait", "2033-04-02T10:00:00.000Z", "run_started", None, started("/tmp/pdo-dash-other")).await;
        insert_event(&state.db, "dash-wait", "2033-04-02T10:01:00.000Z", "node_started", Some("worker"), serde_json::json!({"node_type": "agent"})).await;
        insert_event(&state.db, "dash-wait", "2033-04-02T10:02:00.000Z", "node_awaiting_user", Some("worker"),
                     serde_json::json!({"cause": "declared", "message": "Which layout?"})).await;

        async fn call(state: &Arc<AppState>, uri: &str) -> serde_json::Value {
            let response = build_router(state.clone())
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{uri}");
            serde_json::from_slice(&axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
        }
        let base = "/stats/dashboard?from=2033-04-01T00:00:00.000Z&to=2033-04-03T00:00:00.000Z";

        let all = call(&state, base).await;
        assert_eq!(all["cohort"]["started"], 2);
        assert_eq!(all["completion"]["completed"], 1);
        assert_eq!(all["completion_time"]["median_ms"], 20 * 60 * 1000);
        assert_eq!(all["live"]["awaiting_user"], 1);
        assert_eq!(all["attention"][0]["kind"], "waiting_for_user");
        assert_eq!(all["attention"][0]["reason"], "Which layout?");
        assert_eq!(all["recent_results"][0]["run_id"], "dash-done");
        assert!(all["computed_at"].is_string());

        let other = call(&state, &format!("{base}&project=%2Ftmp%2Fpdo-dash-other")).await;
        assert_eq!(other["project"], "/tmp/pdo-dash-other");
        assert_eq!(other["cohort"]["started"], 1);
        assert_eq!(other["recent_results"].as_array().unwrap().len(), 0);
        assert_eq!(other["projects"].as_array().unwrap().len(), 2);
    }
```

If the event kind strings differ (`node_awaiting_user`, `run_completed`), use the strings the existing lib tests insert (grep `"node_awaiting_user"` in `lib.rs`).

Run: `.superpowers/sdd/tools/wsl.sh env PDO_SKIP_FRONTEND_BUILD=1 cargo test -p pdo-daemon --lib stats_dashboard 2>&1 | tail -10`
Expected: all pass (unit + HTTP).

- [ ] **Step 4: Ratchet the daemon module count**

`git add crates/pdo-daemon/src/stats_dashboard.rs`, then run `bash scripts/layout-ratchet.sh` from Git Bash. Expected: FAIL for `crates/pdo-daemon/src` (94 > 93).

In `scripts/layout-ratchet.sh`, append to the header's justification paragraphs (same style as the existing `crates/pdo-daemon/src: 93 (#890…)` paragraph):

```bash
# crates/pdo-daemon/src: 94 (UI04, docs/plans/dashboard-and-analytics.md) admits
# stats_dashboard.rs — ONE concern: the Dashboard's summary of run outcomes and
# live attention, folded from the run projection. It is neither cost (stats.rs)
# nor execution performance (stats_performance.rs), and it consumes both's
# shared identity rule (stats::project_identity_for_root) instead of copying it.
```

and change the baseline line `crates/pdo-daemon/src 93` to `crates/pdo-daemon/src 94`. Run `bash scripts/layout-ratchet.sh` again. Expected: PASS.

- [ ] **Step 5: Check and commit**

Run: `.superpowers/sdd/tools/wsl.sh env PDO_SKIP_FRONTEND_BUILD=1 cargo check --workspace --all-targets` (clean) and `.superpowers/sdd/tools/wsl.sh env PDO_SKIP_FRONTEND_BUILD=1 cargo clippy -p pdo-daemon --all-targets -- -D warnings 2>&1 | grep -A5 stats_dashboard` (no warnings in the new code).

```bash
git add crates/pdo-daemon/src/stats_dashboard.rs crates/pdo-daemon/src/distribution.rs crates/pdo-daemon/src/lib.rs scripts/layout-ratchet.sh
git commit -m "feat(stats): résumé borné du tableau de bord, GET /stats/dashboard (UI04)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dashboard data layer in the frontend (UI04, frontend)

**Files:**
- Modify: `frontend/src/types.ts` (dashboard types)
- Modify: `frontend/src/api.ts` (`fetchDashboard`; `project` parameter on `fetchStatsCost`)
- Create: `frontend/src/lib/dashboardMetrics.ts`, `frontend/src/lib/dashboardMetrics.test.ts`
- Create: `frontend/src/hooks/useDashboard.ts`, `frontend/src/hooks/useDashboard.test.ts`

(`lib/` and `hooks/` are not ratcheted.)

**Interfaces:**
- Consumes: Task 5's `GET /stats/dashboard` JSON; Task 2's `project` parameter on `/stats/cost`; `WsMessage` from `types.ts`.
- Produces (consumed by Task 7):
  - types `DashboardSummary`, `DashboardAttentionItem`, `DashboardActiveRun`, `DashboardResult`, `DashboardProject`, `AttentionKind`
  - `fetchDashboard(from: string, to: string, project: string | null): Promise<DashboardSummary>`
  - `fetchStatsCost(from, to, bucket, completedOnly = false, uncombined = false, project: string | null = null)`
  - `lib/dashboardMetrics.ts`: `type DashboardPeriod = "7d" | "30d" | "90d"`, `DASHBOARD_PERIODS`, `DEFAULT_DASHBOARD_PERIOD`, `dashboardWindow(period, now?) → { from, to, days: string[] }`, `type SpendDay`, `spendTrend(days, periods, firstRunAt) → SpendDay[]`, `formatAge(since, now?) → string`, `formatRate(rate) → string`, `periodLabel(period) → string`
  - `hooks/useDashboard.ts`: `useDashboard(options) → DashboardData` (shapes below)

- [ ] **Step 1: Add the types and API functions**

Append to `frontend/src/types.ts`:

```ts
// ---- Dashboard (UI04, docs/reference/dashboard-metrics.md) ----
export type AttentionKind = "waiting_for_user" | "blocked" | "failed";
export interface DashboardProject { id: string; name: string; runs: number }
export interface DashboardCohort {
  started: number; completed: number; failed: number; halted: number; skipped: number;
  archived: number; running: number; awaiting_user: number; paused: number;
}
export interface DashboardCompletion { completed: number; eligible: number; rate: number | null }
export interface DashboardCompletionTime { measured: number; median_ms: number | null; p95_ms: number | null }
export interface DashboardLive { running: number; awaiting_user: number; paused: number }
export interface DashboardAttentionItem {
  kind: AttentionKind; run_id: string; run_name: string | null; pipeline_name: string;
  project_id: string; project_name: string; node_id: string | null; node_name: string | null;
  reason: string | null; since: string | null;
}
export interface DashboardNodeRef { id: string; name: string; status: NodeStatus }
export interface DashboardActiveRun {
  run_id: string; run_name: string | null; pipeline_name: string; project_id: string; project_name: string;
  status: RunStatus; started_at: string | null; current_nodes: DashboardNodeRef[];
  cost_usd: number | null; cost_partial: boolean;
}
export interface DashboardResult {
  run_id: string; run_name: string | null; pipeline_name: string; project_id: string; project_name: string;
  completed_at: string; duration_ms: number | null; review_pending: number;
}
export interface DashboardSummary {
  computed_at: string; from: string; to: string; project: string | null; first_run_at: string | null;
  projects: DashboardProject[]; cohort: DashboardCohort; completion: DashboardCompletion;
  completion_time: DashboardCompletionTime; live: DashboardLive;
  attention_total: number; attention: DashboardAttentionItem[];
  active_total: number; active: DashboardActiveRun[]; recent_results: DashboardResult[];
}
```

In `frontend/src/api.ts`, give `fetchStatsCost` a sixth parameter `project: string | null = null` and add `...(project ? { project } : {}),` to its `query`. After `fetchStatsCost`, add:

```ts
/**
 * The Dashboard's bounded summary (UI04): live attention, active Runs, recent
 * results and the outcomes of the Runs started in `[from, to)`. Read-only.
 */
export function fetchDashboard(
  from: string,
  to: string,
  project: string | null,
): Promise<DashboardSummary> {
  return request<DashboardSummary>("GET", "/stats/dashboard", {
    query: { from, to, ...(project ? { project } : {}) },
  });
}
```

(import the `DashboardSummary` type with the other type imports.)

- [ ] **Step 2: Write the failing lib tests**

Create `frontend/src/lib/dashboardMetrics.test.ts`:

```ts
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
```

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/lib/dashboardMetrics.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/dashboardMetrics.ts`**

```ts
import type { StatsCostPeriod } from "../types";

/** Dashboard reporting periods (UI05): whole UTC days ending today. */
export type DashboardPeriod = "7d" | "30d" | "90d";
export const DASHBOARD_PERIODS: DashboardPeriod[] = ["7d", "30d", "90d"];
export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = "30d";
const PERIOD_DAYS: Record<DashboardPeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;

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
```

Run the lib test. Expected: PASS.

- [ ] **Step 4: Write the failing hook tests**

Create `frontend/src/hooks/useDashboard.test.ts`:

```ts
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
      { initialProps: { project: null } },
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
```

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/hooks/useDashboard.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 5: Implement `hooks/useDashboard.ts`**

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDashboard, fetchStatsCost } from "../api";
import type { DashboardSummary, StatsCost, WsMessage } from "../types";
import { dashboardWindow, type DashboardPeriod } from "../lib/dashboardMetrics";

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
  const range = useMemo(() => dashboardWindow(period), [period]);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [cost, setCost] = useState<StatsCost | null>(null);
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
        setSummary(data);
        setSummaryError(null);
      })
      .catch((error) => {
        if (seq !== summarySeq.current) return;
        setSummaryError(message(error));
      })
      .finally(() => {
        if (seq === summarySeq.current) setSummaryLoading(false);
      });
  }, [range.from, range.to, project]);

  const loadCost = useCallback(() => {
    const seq = ++costSeq.current;
    setCostLoading(true);
    fetchStatsCost(range.from, range.to, "day", false, false, project)
      .then((data) => {
        if (seq !== costSeq.current) return;
        setCost(data);
        setCostError(null);
      })
      .catch((error) => {
        if (seq !== costSeq.current) return;
        setCostError(message(error));
      })
      .finally(() => {
        if (seq === costSeq.current) setCostLoading(false);
      });
  }, [range.from, range.to, project]);

  useEffect(() => {
    if (!active) return;
    loadSummary();
    loadCost();
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
```

Note the debounce coalesces bursts: the first event arms a single 2 s timer and later events inside it ride on it.

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/hooks/useDashboard.test.ts src/lib/dashboardMetrics.test.ts`
Expected: PASS. Then `.superpowers/sdd/tools/wslf.sh pnpm run typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/lib/dashboardMetrics.ts frontend/src/lib/dashboardMetrics.test.ts frontend/src/hooks/useDashboard.ts frontend/src/hooks/useDashboard.test.ts
git commit -m "feat(ui): données du tableau de bord — types, API, fenêtre de période, hook (UI04)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Dashboard view and navigation (UI05)

**Files:**
- Create: `frontend/src/components/Dashboard.tsx`, `frontend/src/components/Dashboard.test.tsx`
- Create: `frontend/src/App.dashboard.test.tsx` (App-level navigation; `src/` root is not ratcheted)
- Modify: `frontend/src/App.tsx` (dashboard state, center panel, TopBar button, keyboard guards, handlers)
- Modify: `scripts/layout-ratchet.sh` (components 206 → 208 with justification)

**Interfaces:**
- Consumes: Task 6 (`useDashboard`, `dashboardMetrics`, dashboard types), Task 3 (`formatCoverage`, `costUnitNoun`), Task 4 (`runStatusLabel`), existing `formatCostAmount` (`lib/costLabel.ts`), `formatDuration` (`lib/runDuration.ts`), `reviewUrl` (`lib/runRefs.ts`), `ConnectionStatus` (`hooks/useDaemonSocket.ts`).
- Produces: `export default function Dashboard(props: DashboardProps)` with

```ts
export interface DashboardProps {
  connection: ConnectionStatus;
  subscribe: (handler: (msg: WsMessage) => void) => () => void;
  onOpenRun: (runId: string, nodeId?: string | null) => void;
  onStartRun: () => void;
  onOpenStats: () => void;
  /** Present only when editor tabs are open behind the Dashboard. */
  onBackToEditor?: () => void;
}
```

**Visual direction:** look at `docs/assets/dashboard-and-analytics/dashboard-concept.png` for hierarchy, spacing and contrast only. Keep PDO's identity and tokens; copy no invented logo, numbers or queue metric (spec § Design references). `.agents/skills/design-taste-frontend/SKILL.md` may be read for general layout taste; this plan and the tokens win where they differ. Layout must work at 1280×720 inside the center panel: one column of sections below a responsive grid of summary cards (`grid gap-3 sm:grid-cols-2 xl:grid-cols-5`). The page scrolls inside the panel (`h-full overflow-y-auto`).

- [ ] **Step 1: Write the failing component tests**

Create `frontend/src/components/Dashboard.test.tsx`:

```tsx
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSummary, StatsCost, WsMessage } from "../types";

vi.mock("../api", () => ({ fetchDashboard: vi.fn(), fetchStatsCost: vi.fn() }));
import { fetchDashboard, fetchStatsCost } from "../api";
import Dashboard from "./Dashboard";

const NO_SOCKET = (_h: (m: WsMessage) => void) => () => {};

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
```

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/components/Dashboard.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement `components/Dashboard.tsx`**

Build the component to satisfy the tests and the metric document (Task 1 § Dashboard figures). Required structure, test ids and copy:

- Root: `<section data-testid="dashboard" aria-labelledby="dashboard-title" className="h-full overflow-y-auto bg-bg-1 px-5 py-4">`.
- Local state: `const [period, setPeriod] = useState<DashboardPeriod>(DEFAULT_DASHBOARD_PERIOD)`, `const [project, setProject] = useState<string | null>(null)`. Data: `const data = useDashboard({ active: true, period, project, subscribe })`. The component is mounted only while visible, so `active` is always true.
- **Header** (`<header className="flex flex-wrap items-center gap-3">`):
  - `<h1 id="dashboard-title">Dashboard</h1>`
  - `<select aria-label="Project">`: option `""` "All projects", then one option per `summary.projects` (`value={p.id}`, text `p.name`). Changing it sets `project` (`""` → `null`).
  - `<select aria-label="Reporting period">` over `DASHBOARD_PERIODS` with `periodLabel` text.
  - Freshness text: "Updated <relative time>" from `summary.computed_at` (use `relativeTime` from `lib/reviewComments.ts`), "Refreshing…" while `summaryLoading`, and, when `summaryStale`, "Showing data from <relative time> — refresh failed" in `text-st-await`.
  - `<button aria-label="Refresh dashboard">` → `data.refresh()`.
  - `<button>Start a run</button>` → `onStartRun()` (primary style: `bg-acc` text on accent like the existing New Run button).
  - When `onBackToEditor` is given: `<button>Back to editor</button>`.
- **Connection banner**: when `connection !== "connected"`, `<div role="status" className="… border-st-await …">Daemon {connection === "reconnecting" ? "reconnecting" : "disconnected"} — live data may be out of date.</div>`.
- **Summary error**: when `summaryError` and no `summary`, show `<div role="alert">Dashboard unavailable: {summaryError} <button>Retry</button></div>`. When stale, the freshness text above is enough. The cost card renders from `cost` regardless.
- **Summary cards** (`grid gap-3 sm:grid-cols-2 xl:grid-cols-5`), each a `div` with a small uppercase scope tag (`periodLabel(period)` or "Live now"), a title, a value (`font-mono`, ~20px, `text-fg`) and a sub-line (`text-fg-3`):
  1. `data-testid="dashboard-card-spend"`, title "Recorded spend", value `formatCostAmount(cost.total.usd, cost.total.partial, cost.total.estimated)`, sub `formatCoverage(cost.total.coverage, cost.total.unit)` when `executions > 0`, else "No Runs in this period". While loading with no data: "Loading…"; on `costError` with no data: "Cost unavailable" plus the message. A link-style `<button>Open cost</button>` → `onOpenStats()`.
  2. `data-testid="dashboard-card-completed"`, title "Completed runs", value `` `${completion.completed} of ${completion.eligible}` `` when `eligible > 0`, else `—`; second value `formatRate(completion.rate)`; sub `` `failed ${cohort.failed} · stopped ${cohort.halted} · skipped ${cohort.skipped} · still running ${cohort.running + cohort.awaiting_user + cohort.paused}` ``.
  3. `data-testid="dashboard-card-duration"`, title "Median completion time", value `formatDuration(completion_time.median_ms) ?? "—"`, sub `` `${measured} completed ${measured === 1 ? "Run" : "Runs"}` `` plus `` ` · p95 ${formatDuration(p95_ms)}` `` when `p95_ms !== null`.
  4. `data-testid="dashboard-card-live"`, scope "Live now", title "Running", value `live.running`, sub `` `${live.awaiting_user} awaiting you · ${live.paused} paused` ``.
  5. `data-testid="dashboard-card-attention"`, scope "Live now", title "Needs attention", value `attention_total`.
  - Every card leads somewhere (spec Phase 2): cards 1–3 end with a link-style `<button>` ("Open cost", "Open Stats", "Open Stats") → `onOpenStats()`; cards 4 and 5 are in-page links (`<a href="#dashboard-active">` / `<a href="#dashboard-attention">`) to their sections, whose `<section>` elements carry those ids.
- **Attention** section (`<h2>Needs attention</h2>` with a "Live now" tag). Each item is `<li data-testid="dashboard-attention-item">` with:
  - a kind label in words: "Waiting for you" / "Blocked" / "Failed", plus an icon with `aria-hidden`, coloured `text-st-await` / `text-st-blocked` / `text-st-failed`;
  - the Run name (`run_name ?? pipeline_name`), the Pipeline, `node_name` when present, `reason` (truncated, full text in `title`), and `formatAge(since)`;
  - `<button aria-label={`Open ${name}`}>Open</button>` → `onOpenRun(run_id, node_id)`.
  - When `attention_total > attention.length`: "Showing {n} of {total}". Empty: "Nothing needs your attention."
- **Active work** (`<h2>Active work</h2>` + "Live now"): `<li data-testid="dashboard-active-run">` with name (`run_name ?? pipeline_name`), Pipeline, `runStatusLabel(status)`, the current step (one node → its name; several → `${n} steps in parallel`; none → "—"), elapsed `formatAge(started_at)`, and cost `formatCostAmount(cost_usd, cost_partial, true)` followed by "so far" (`—` when null). The row is a button → `onOpenRun(run_id, null)`. When `active_total > active.length`: "Showing {n} of {total}". Empty: "No runs in progress."
- **Spend trend** (`<figure data-testid="dashboard-spend-trend">`, `<figcaption>Recorded spend per day, USD — Runs started that day</figcaption>`): `spendTrend(data.window.days, cost?.by_period ?? [], summary?.first_run_at ?? null)` rendered as a flex row of bars, `<div data-testid="dashboard-spend-day" data-state={day.state} title={…}>`. Height is proportional to `usd / max(usd)` with a minimum visible height for `spend`. `unknown` gets a hatched or outlined bar with a "?" glyph, `no_activity` a thin baseline tick, `outside` a dimmed `bg-bg-3` slot. `title` text: spend → `` `${day}: ${formatCostAmount(usd, incomplete, true)} · ${runs} Runs` ``; unknown → `` `${day}: cost unknown · ${runs} Runs` ``; no_activity → `` `${day}: no Run started` ``; outside → `` `${day}: before the first recorded run` ``. Below: a legend in words ("spend", "unknown", "no activity", "before the first recorded run") and the axis maximum in USD (`$X.XX`). While cost loads, show the bars from the calendar alone (all `outside`/`no_activity`) with "Loading cost…".
- **Recent results** (`<h2>Recent results</h2>`): `<li data-testid="dashboard-result">` with name, Pipeline, `formatAge(completed_at)` + " ago", `formatDuration(duration_ms) ?? "—"`, "{n} review comments pending" when `review_pending > 0` ("1 review comment pending" when 1), `<button>Open result</button>` → `onOpenRun(run_id, null)`, `<a href={reviewUrl(run_id)}>Review changes</a>`. Empty: "No completed runs yet."
- All informative text uses `text-fg-3` or stronger; keyboard order follows the visual order; every button has a visible focus style (use the existing `focus-visible:` ring classes from neighbouring buttons).

Run the component tests until they pass: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/components/Dashboard.test.tsx`.

- [ ] **Step 3: Write the failing App navigation tests**

Read `frontend/src/App.settingsClose.test.tsx` for the full-App harness (FakeWebSocket, ResizeObserver stub, the `vi.mock("./api", …)` factory listing every API function App touches). Create `frontend/src/App.dashboard.test.tsx` with the same harness. Add `fetchDashboard` and `fetchStatsCost` to the api mock factory, resolving to a minimal empty `DashboardSummary` / `StatsCost`, and make `fetchRuns` return one run `{ run_id: "r1", pipeline_name: "impl", status: "running", started_at: "2033-04-02T09:00:00.000Z", effective_repo: "/repo" }` plus whatever `fetchRun("r1")` the harness needs to open a run tab (mirror how the existing App tests or `UnifiedLeftPanel` select a run). Tests:

```tsx
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
  await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
  expect(screen.getByTestId("center-editor")).not.toBeVisible();
  expect(useEditStore.getState().openTabs.length).toBe(tabsBefore);
  await userEvent.click(screen.getByRole("button", { name: "Back to editor" }));
  await waitFor(() => expect(screen.getByTestId("center-editor")).toBeVisible());
});

it("editor shortcuts do not reach the hidden canvas", async () => {
  render(<App />);
  await screen.findByTestId("dashboard");
  await userEvent.click(await screen.findByTestId("run-display-label"));
  await waitFor(() => expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument());
  const undo = vi.spyOn(useEditStore.getState(), "undo");
  await userEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  await userEvent.keyboard("{Control>}z{/Control}");
  expect(undo).not.toHaveBeenCalled();
});
```

Adapt selectors to what the harness actually renders (e.g. if the run row's click target is `[data-run-row="r1"]`). If spying on the store action is not possible because App captured it earlier, assert instead that the edit store's `history` for the tab is unchanged. Keep the intent: no undo while the Dashboard is shown.

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/App.dashboard.test.tsx`
Expected: FAIL (no dashboard in App).

- [ ] **Step 4: Wire the Dashboard into `App.tsx`**

1. Import `Dashboard` and the `LayoutDashboard` icon from `lucide-react`.
2. State, near `statsOpen`:

```ts
  // UI05: the Dashboard is the landing view. It shows whenever no editor tab is
  // open, and on demand over open tabs, which stay mounted (hidden) underneath
  // so unsaved edits, the canvas viewport and terminals survive the trip.
  const [dashboardOpen, setDashboardOpen] = useState(true);
```

After `hasEditTab` is defined:

```ts
  const dashboardVisible = !hasEditTab || dashboardOpen;
  // Activating another tab (a pipeline opened from the library, a run tab)
  // leaves the Dashboard; the first render's id is not a navigation.
  const lastActiveTabRef = useRef(editActiveTabId);
  useEffect(() => {
    if (editActiveTabId && editActiveTabId !== lastActiveTabRef.current) setDashboardOpen(false);
    lastActiveTabRef.current = editActiveTabId;
  }, [editActiveTabId]);
```

3. In `handleSelectRun`, add `setDashboardOpen(false);` as the first statement.
4. Add a handler for the Dashboard's open action:

```ts
  const handleOpenFromDashboard = useCallback(
    async (runId: string, nodeId?: string | null) => {
      await handleSelectRun(runId);
      if (nodeId) setSelection({ kind: "node", id: nodeId });
    },
    [handleSelectRun, setSelection],
  );
```

5. Guard the editor shortcuts: in the Ctrl/Cmd+S effect change `if (!hasEditTab || isActiveRunArchived || runLocked) return;` to `if (!hasEditTab || dashboardVisible || isActiveRunArchived || runLocked) return;` and add `dashboardVisible` to its deps. Do the same in the undo/redo effect: `if (!hasEditTab || dashboardVisible || isActiveRunArchived) return;`, deps updated.
6. Replace the center panel's `{hasEditTab ? (<div className="flex h-full min-w-0 flex-col">…</div>) : (<div …>Select a run or open a pipeline to get started</div>)}` with:

```tsx
            {hasEditTab && (
              <div hidden={dashboardVisible} className="h-full" data-testid="center-editor">
                <div className="flex h-full min-w-0 flex-col">
                  {/* unchanged: TabBar, orchestrator back bar, EditCanvas */}
                </div>
              </div>
            )}
            {dashboardVisible && (
              <Dashboard
                connection={status}
                subscribe={subscribe}
                onOpenRun={handleOpenFromDashboard}
                onStartRun={() => openNewRunModal({ kind: "run" })}
                onOpenStats={() => openStats()}
                onBackToEditor={hasEditTab ? () => setDashboardOpen(false) : undefined}
              />
            )}
```

Keep `id="center"` on the `ResizablePanel` (the overview tour targets `[data-panel]#center`). `status` and `subscribe` are App's existing `useDaemonSocket()` values (`const { status, subscribe } = useDaemonSocket();`).

7. TopBar: add props `onOpenDashboard: () => void; dashboardActive: boolean;` and, as the first button of the right-aligned group:

```tsx
        <button
          onClick={onOpenDashboard}
          aria-label="Dashboard"
          aria-pressed={dashboardActive}
          data-testid="open-dashboard"
          className="grid h-6 w-6 place-items-center rounded text-fg-3 transition-colors hover:bg-bg-5 hover:text-fg aria-pressed:text-fg"
        >
          <LayoutDashboard size={15} />
        </button>
```

and pass `onOpenDashboard={() => setDashboardOpen(true)}` and `dashboardActive={dashboardVisible}` where `<TopBar` is rendered.

- [ ] **Step 5: Ratchet the components count**

`git add frontend/src/components/Dashboard.tsx frontend/src/components/Dashboard.test.tsx`, run `bash scripts/layout-ratchet.sh`: it fails (208 > 206). In `scripts/layout-ratchet.sh` append the paragraph:

```bash
# frontend/src/components: 208 (UI05, docs/plans/dashboard-and-analytics.md) admits
# Dashboard.tsx and its test — ONE concern: the landing view of live attention,
# active work, recorded spend and recent results. Its pure logic lives in
# lib/dashboardMetrics.ts and its data in hooks/useDashboard.ts; it reuses the
# Stats cost formatting (lib/costLabel.ts) instead of a parallel analytics stack.
```

and change `frontend/src/components 206` to `frontend/src/components 208`. Re-run the script. Expected: PASS.

- [ ] **Step 6: Run the affected suites**

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec vitest run src/components/Dashboard.test.tsx src/App.dashboard.test.tsx src/App.settingsClose.test.tsx src/components/UnifiedLeftPanel.test.tsx src/lib/tours`
Expected: all pass. `App.settingsClose.test.tsx` now also renders the Dashboard on mount, so add `fetchDashboard`/`fetchStatsCost` to its api mock factory if it throws on first access.
Then run the whole frontend suite once: `.superpowers/sdd/tools/wslf.sh pnpm test 2>&1 | tail -15`. Expected: green. Any other App-mounting test failing on a missing api mock gets the two functions added to its factory.
Then `.superpowers/sdd/tools/wslf.sh pnpm run typecheck` and `.superpowers/sdd/tools/wslf.sh pnpm run lint`. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src scripts/layout-ratchet.sh
git commit -m "feat(ui): tableau de bord comme accueil, sans démonter l'éditeur (UI05)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end dashboard journey and regression run (UI05 validation)

**Files:**
- Create: `frontend/e2e/dashboard.spec.ts`
- Modify: only e2e specs that break **because of this plan's changes** (e.g. a spec that expected the old empty landing). Never weaken an assertion about behaviour this plan did not change.

**Interfaces:**
- Consumes: the running app (Tasks 2–7). `frontend/playwright.config.ts` starts an isolated daemon (`cargo run -p pdo-daemon -- daemon --port …`) with stubbed harness sessions (`PDO_TMUX_CMD_OVERRIDE`). Helpers live in `frontend/e2e/helpers.ts` (`cleanupRuns`, run-creation helpers used by other specs).
- Produces: nothing consumed later.

The controller has installed tmux and Playwright's Chromium dependencies in WSL before this task. If `tmux -V` or the browser launch fails, report BLOCKED with the error. Do not install system packages yourself.

- [ ] **Step 1: Write the spec**

Create `frontend/e2e/dashboard.spec.ts`. Reuse the run-creation helper the other specs use (read `e2e/helpers.ts` and one spec that creates a run, e.g. `failed-node.spec.ts` or `terminal-preview.spec.ts`), and clean up with `cleanupRuns` in `afterEach` as they do. Cover:

```ts
import { expect, test } from "@playwright/test";
// import the helpers the neighbouring specs use

test.describe("Dashboard (UI05)", () => {
  test("lands on the Dashboard, opens a live Run from Active work, and comes back to it", async ({ page, request }) => {
    // 1. create a Run through the same helper/API the other specs use (its Nodes stay running under the stub)
    // 2. land
    await page.goto("/");
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    // 3. the live Run is listed under Active work (summary refreshes within ~2 s of daemon events)
    const row = page.getByTestId("dashboard-active-run").first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    // 4. opening it shows the canvas and hides the Dashboard
    await row.click();
    await expect(page.getByTestId("dashboard")).toHaveCount(0);
    await expect(page.locator("[data-panel]#center .react-flow")).toBeVisible();
    // 5. the top-bar Dashboard button returns; the editor is hidden, not gone
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page.getByTestId("center-editor")).toBeHidden();
    // 6. Back to editor restores the same tab
    await page.getByRole("button", { name: "Back to editor" }).click();
    await expect(page.getByTestId("center-editor")).toBeVisible();
  });

  test("the spend card opens Stats on its cost data", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("dashboard-card-spend").getByRole("button", { name: "Open cost" }).click();
    await expect(page.getByTestId("stats-tab-cost").or(page.getByRole("dialog"))).toBeVisible();
  });

  test("announces a daemon it cannot hear", async ({ page }) => {
    await page.routeWebSocket(/.*/, (ws) => ws.close());
    await page.goto("/");
    await expect(page.getByTestId("dashboard").getByRole("status")).toContainText(/daemon/i);
  });
});
```

Adjust selectors to the real DOM (e.g. the Stats surface's actual test id, the canvas root class). Keep each assertion's intent. If `page.routeWebSocket` is unavailable in the installed Playwright version, block the socket another way (e.g. `page.addInitScript` replacing `window.WebSocket` with a class whose instances immediately close).

- [ ] **Step 2: Run the new spec**

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec playwright test e2e/dashboard.spec.ts --reporter=line 2>&1 | tail -30`
Expected: 3 passed. The first run builds the daemon (`cargo run`), which can take several minutes.

- [ ] **Step 3: Run the specs most exposed to the landing change**

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec playwright test e2e/smoke.spec.ts e2e/cold-start-integration.spec.ts e2e/new-run-attachments.spec.ts e2e/recent-repos.spec.ts e2e/remote-branches.spec.ts e2e/repo-explorer-pick.spec.ts e2e/right-pane-collapse.spec.ts e2e/resizable-panels.spec.ts e2e/tabbar-overflow.spec.ts e2e/review-page-fp.spec.ts --reporter=line 2>&1 | tail -40`
Expected: all pass.

- [ ] **Step 4: Run the full e2e suite once**

Run: `.superpowers/sdd/tools/wslf.sh pnpm exec playwright test --reporter=line 2>&1 | tail -60` (long: let it finish).
For every failure, decide whether this plan caused it. Check out the base commit of the branch in a scratch worktree only if needed; usually reading the failure is enough. Fix only regressions caused by this plan, in the product code if the product is wrong, or in the spec if the spec encoded the old landing. List pre-existing failures (with their error line) in your report without touching them.

- [ ] **Step 5: Capture the review screenshots (UI05 completion evidence)**

Add to `dashboard.spec.ts` a test gated on an environment variable, so the normal suite skips it:

```ts
test("captures the review screenshots", async ({ page }) => {
  test.skip(!process.env.PDO_DASHBOARD_SHOTS, "set PDO_DASHBOARD_SHOTS=1 to capture");
  const out = "../docs/assets/dashboard-and-analytics";
  for (const [w, h] of [[1280, 720], [1440, 900]] as const) {
    for (const theme of ["dark", "light"] as const) {
      await page.addInitScript((t) => localStorage.setItem("pdo.ui.theme", t), theme);
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/");
      await expect(page.getByTestId("dashboard-card-completed")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${out}/implemented-dashboard-${w}x${h}-${theme}.png` });
    }
  }
});
```

Capture it twice: once with no Run in the e2e database (run `cleanupRuns` first; rename the files with an `-empty` suffix), and once with one live Run created by the helper (`-populated` suffix). Use the run-creation helper inside the test when the env var is set. Run `PDO_DASHBOARD_SHOTS=1` through the wrapper: `.superpowers/sdd/tools/wslf.sh env PDO_DASHBOARD_SHOTS=1 pnpm exec playwright test e2e/dashboard.spec.ts -g "captures" --reporter=line`. Open two of the images (Read tool) and check them yourself: no overflow, readable text in both themes, nothing cut off at 1280×720. Fix the component if not.

Add a section to `docs/assets/dashboard-and-analytics/README.md`:

```markdown
## Implemented screens (1.120.0)

Captured from the isolated e2e daemon (stubbed sessions, no user data) at 1280×720 and 1440×900, dark and light: `implemented-dashboard-<size>-<theme>-<empty|populated>.png`. These show the shipped Dashboard (UI05), not the concept.
```

- [ ] **Step 6: Commit**

```bash
git add frontend/e2e docs/assets/dashboard-and-analytics
git commit -m "test(e2e): parcours du tableau de bord — accueil, Run actif, retour à l'éditeur, coût, daemon muet (UI05)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Release 1.120.0 and the repository gate

**Files:**
- Modify: `Cargo.toml` (`[workspace.package] version`), `Cargo.lock` (the `pdo-daemon` package version), `CHANGELOG.md`, `docs/plans/dashboard-and-analytics.md` (Status line only)

**Interfaces:**
- Consumes: everything above.
- Produces: the release commit.

- [ ] **Step 1: Bump the version**

In `Cargo.toml`, `version = "1.119.1"` → `version = "1.120.0"` (a `feat` is a minor bump, `docs/agents/git-flow.md`). Run `.superpowers/sdd/tools/wsl.sh env PDO_SKIP_FRONTEND_BUILD=1 cargo check --workspace` so `Cargo.lock` updates the `pdo-daemon` entry to `1.120.0`. Confirm with `git diff Cargo.lock`: only that version line changes.

- [ ] **Step 2: CHANGELOG**

`CHANGELOG.md` records only breaking changes and notes that do not follow from a commit title (read its header and the `## 1.119.1` entry for the style, in French). Add above `## 1.119.1`:

```markdown
## 1.120.0

**Tableau de bord** (plan [dashboard-and-analytics](docs/plans/dashboard-and-analytics.md), UI01–UI05) : PDO s'ouvre désormais sur un tableau de bord — ce qui attend une décision, ce qui tourne, la dépense enregistrée de la période et les derniers résultats. Les onglets ouverts restent montés derrière lui ; le bouton **Dashboard** de la barre du haut y revient. Définitions : [docs/reference/dashboard-metrics.md](docs/reference/dashboard-metrics.md).

**À noter**
- Chaque agrégat de `GET /stats/cost` porte désormais `unit` (`run` / `execution` / `slice`) et `coverage` (`complete` / `partial` / `unavailable`) ; l'axe « By model » a son propre Total (`model_total`), par exécution. La ligne « N Runs without computable cost » devient une ligne de couverture : un Run dont seule l'infrastructure est inconnue compte comme **partiel**, sa dépense connue reste dans le total.
- Nouveau `GET /stats/dashboard` (lecture seule) et paramètre `project` sur `GET /stats/cost`.
- Thème sombre : `fg-3` passe à `#8a92a0` (AA sur les panneaux Stats) ; un Run arrêté (`halted`) se lit « Stopped ».
```

- [ ] **Step 3: Mark the plan's status**

In `docs/plans/dashboard-and-analytics.md`, replace the line starting `**Status:** proposed implementation plan;` with:

```markdown
**Status:** UI01–UI05 implemented in 1.120.0 ([task plan](dashboard-and-analytics-tasks-ui01-ui05.md), [metric definitions](../reference/dashboard-metrics.md)); UI06–UI10 remain proposed.  
```

- [ ] **Step 4: Run the repository gate**

Run, in order (each must pass; long ones run to completion):
- `.superpowers/sdd/tools/wsl.sh make check`, the gate before `main` moves (`cargo check` + frontend typecheck + harness support table)
- `.superpowers/sdd/tools/wsl.sh make lint` (clippy `-D warnings` + eslint)
- `.superpowers/sdd/tools/wsl.sh make test` (nextest + doctests + vitest + readme-media node tests)
- `bash scripts/layout-ratchet.sh` (Git Bash)

If `make test` shows failures, compare with the base commit before concluding they are new: run the failing test alone on this branch, then read its history. Fix regressions caused by this branch. Report pre-existing failures verbatim without touching them.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock CHANGELOG.md docs/plans/dashboard-and-analytics.md
git commit -m "chore(release): 1.120.0 — tableau de bord et coûts lisibles (UI01–UI05)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
