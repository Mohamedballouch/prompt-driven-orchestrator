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
