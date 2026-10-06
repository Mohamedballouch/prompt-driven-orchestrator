# Dashboard and analytics design assets

These local assets accompany the [implementation plan](../../plans/dashboard-and-analytics.md) and [live review evidence](../../plans/dashboard-and-analytics-review.md). All document image references are repository-relative and render without an external image host.

## Generated concepts

| File | Purpose |
| --- | --- |
| [dashboard-concept.png](dashboard-concept.png) | Dashboard hierarchy and visual direction |
| [cost-performance-concept.png](cost-performance-concept.png) | Analytics hierarchy and visual direction |
| [design-prompts.txt](design-prompts.txt) | Original prompts and generation provenance |

Created on 6 October 2026 using built-in image generation. These are proposals, not actual product screenshots. Sample run counts, dates, states, percentages, and time breakdowns are illustrative. Some spending values draw on the earlier review but are not a synchronized dataset. Preserve the existing PDO branding; the generated logos are not a requested brand change.

Implementation follows the plan's metric and navigation contracts when they differ from the images. In particular, retain Triggers, keep the existing library, label every population, and omit queue-time or outcome metrics without supported source data.

## Live captures

| File | Source view |
| --- | --- |
| [baseline-home.jpg](baseline-home.jpg) | Landing screen |
| [baseline-cost.jpg](baseline-cost.jpg) | Cost by pipeline |
| [baseline-performance.jpg](baseline-performance.jpg) | Performance with completed-only filter |
| [baseline-model-total.jpg](baseline-model-total.jpg) | Model-axis Total |
| [baseline-model-detail.jpg](baseline-model-detail.jpg) | Individual model detail |
| [baseline-performance-all-runs.jpg](baseline-performance-all-runs.jpg) | Performance with all run statuses |
| [baseline-run.jpg](baseline-run.jpg) | Run canvas and information panel |
| [baseline-new-run.jpg](baseline-new-run.jpg) | New-run form |

Captured on 6 October 2026 from the user's local PDO instance at `http://localhost:5172`, version `1.110.0`, viewport 1280×720. The captures include local workflow names and paths visible in that instance. They were copied without image alteration. The target fork is version `1.119.1`; the baseline captures do not claim to show that version.

These files are planning references. They do not replace the production README media or the existing exported design bundle under `docs/design/`.
