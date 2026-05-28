# TODO Features

## TODO-001: Ingest Progress as a Mario-like Level Clear

- **Status:** Done
- **Area:** UI / ingest job feedback
- **Idea:** Replace or augment the current ingest progress bar with a Super Mario-style level clear progress animation.
- **Implemented:** `ui/src/IngestLevelProgress.tsx`, wired into `ui/src/App.tsx`, covered by `tests/ingest-level-progress.test.tsx` and e2e.

### Desired Experience

During log ingest, show the job as a small side-scrolling course:

- The agent avatar moves from level start toward a finish flag.
- Processed files become passed tiles or cleared blocks.
- Changed files can appear as coins, bricks, or power-ups.
- Parse or worker errors appear as hazards.
- Completion raises the finish flag / level clear state.
- Failed ingest ends with a visible hazard/fail state and readable error detail.

### Data Mapping

- `processedFiles / totalFiles` -> course position.
- `changedFiles` -> collectible count.
- `skippedFiles` -> already-cleared blocks.
- `currentFile` -> current tile tooltip/detail.
- `phase` -> world segment: scanning, diffing, loading history, parsing, normalizing, writing.
- `errors.length` -> hazards count.

### Notes

Keep this as progress feedback, not decoration only. The animation should make ingest state easier to understand at a glance while preserving the exact numbers and error text already shown today.

## TODO-002: Daily Token Usage Chart Panel

- **Status:** Done
- **Area:** Analytics / project metrics
- **Idea:** Add a token statistics panel with daily bars/curve, hidden by default and expandable/collapsible on demand.
- **Implemented:** `GET /api/projects/:id/token-usage/daily`, `ui/src/DailyTokenUsagePanel.tsx`, wired into `ui/src/App.tsx`, covered by storage/API and e2e tests.

### Desired Experience

- Add a compact "Token usage by day" panel near the project metrics or timeline controls.
- Keep it collapsed by default so the conversation timeline remains the primary surface.
- When expanded, show daily token usage as a bar chart with an overlaid trend/curve.
- Support project/provider filtering consistently with the current project provider filter.
- Show totals and KV cache hit rate for the visible date range.

### Data Mapping

- Group `events.tokenUsage.total` by event day.
- Track daily `input`, `output`, `reasoning`, and `cachedInput`.
- Derive daily KV cache hit rate from `cachedInput / input`.
- Use project-local timeline date boundaries when a project is selected.

### Notes

The panel should explain token spend over time without crowding the main task thread. Default collapsed state is required.

## TODO-003: Blocking Loader During Long Operations

- **Status:** Done
- **Area:** UI / interaction safety
- **Idea:** Add a visible loading overlay/loader during long-running operations to prevent users from triggering conflicting actions mid-process.
- **Implemented:** scoped workspace blocking loader in `ui/src/App.tsx` / `ui/src/styles.css`, with conflicting scan/project/timeline controls disabled and e2e coverage.

### Desired Experience

- Show a loader when ingest, project refresh, timeline loading, or other blocking operations are in progress.
- Disable or visually block actions that would conflict with the current operation.
- Keep safe actions available where appropriate, such as theme switching or passive inspection.
- Provide short status text so users know what is happening.
- Avoid trapping the user forever if an operation fails; failed states must expose retry and error detail.

### Data Mapping

- `job.status === "running"` or `job.status === "queued"` -> ingest loader.
- `timelineLoading` -> timeline page loader.
- `loading` -> initial project index loader.
- `journeyLoadingIds` -> local inline loader for expanded task details.
- API errors -> loader exit plus error alert.

### Notes

Use this to protect app state from accidental double-clicks or navigation during mutation-heavy flows. Prefer scoped blocking for local loads and full-screen blocking only for operations that make the rest of the UI unsafe.
