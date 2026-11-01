# Workbench UI Redesign

## Interaction Revision: 2026-11-01

- Replaced the tool card directory with full-row launch targets and removed empty project/activity columns.
- Added a searchable command dialog with arrow-key selection, Enter activation, Escape dismissal, and Ctrl/Cmd+K access.
- Added closable tool tabs. Vue KeepAlive retains editor history, selected views, text results, and time calculation state across tool navigation. Deactivated clocks stop their timers; returning refreshes the clock. Git project activation handles selection from the home page.
- Added JSON single-pane focus, animated mode indicators, editor focus outlines, result feedback, keyboard view navigation, and Ctrl+Enter formatting.
- Motion includes short page transitions, tab entrance/removal, filtered tool list movement, button press feedback, favorite state changes, mobile backdrop fade, time mode indicator movement, result appearance, and theme color transitions. Browsers with native view transitions use a snapshot crossfade; the in-app browser uses CSS theme transitions and a transform animation for sidebar resizing. Reduced-motion preference disables these transitions.
- In-app checks exercised command search/keyboard activation/empty results/dismissal, preserved JSON structure mode and undo availability, preserved text output, pane focus/restore, active-tab close fallback, mobile navigation, and the time mode indicator's measured alignment at 390px. The 240ms indicator transition and matching tab dimensions were inspected through rendered DOM.
- Standalone smoke coverage now includes command-based navigation, pane focus, and view/content retention. This script was not launched as a separate browser process.

## Earlier Layout Revision: 2026-11-01

- Before this revision, commit `ec8f894` was pushed to `origin/main` as the requested backup.
- Product Design guided direct implementation approved by the user: a 220px text sidebar, collapsible desktop navigation, a mobile drawer, quieter tool cards, and consistent toolbars and work surfaces.
- JSON uses segmented views and independently scrolling editors. Timestamp conversion and date calculations use aligned columns and responsive stacking. Settings have clearer labels and larger theme selectors.
- Fixed the settings theme selector falling out of sync when the top bar changes the theme; other settings drafts remain intact.
- Production build and both TypeScript checks passed. JSON tests: 4 passed. Timestamp tests: 6 passed.
- In-app browser checks covered the default 1280x720 viewport, 390x844 mobile, and 900x640 short windows. Captures verified home, JSON, timestamp, settings, and Git empty state; checked pages had no horizontal document overflow.
- Exercised JSON formatting with a large integer, line-number visibility, field key/value changes, and diff output; timestamp epoch and batch conversion; theme persistence after reload; settings draft isolation; desktop sidebar collapse and mobile navigation.
- Native Electron Git repository operations were not rerun in this revision. The existing standalone smoke script was updated for the new navigation and palette but was not launched; browser checks used the existing in-app preview.
- The following sections document the previous 2026-10-30 revision and its verification limits.

## Scope And Decision

- Date: 2026-10-30.
- Product: existing Windows desktop toolbox built with Electron and Vue.
- The user explicitly selected direct implementation without generated design options.
- The user subsequently selected compilation checks only and declined an additional browser verification run.
- The screenshots in `output/design/before-home.png` and `output/design/before-git.png` document the previous interface. They are not mockups of the new design.

## Implemented Direction

- Version 0.1.2 replaces the charcoal sidebar with a narrow neutral icon rail, blue active states, white work surfaces and semantic green/amber Git statuses.
- Removed the promotional banner and CSS branch illustration.
- Tool directory with search, category selection, favorites and recent tools.
- Home project and activity lists use existing saved application state.
- Git workspace uses a wider searchable project rail, compact repository metadata, and denser single-line branch names with full-name title text; smaller windows use a project selector.
- The application shell is bounded to the viewport. Project lists scroll in their own flex region; the Element Plus branch table has a bounded viewport and `height="100%"`, retaining its own header. Global navigation and repository controls stay outside these scroll regions.
- JSON and text editors also fill the remaining viewport with independently scrolling input and output panes. Other pages scroll inside the main content region.
- Shared tokens cover typography, spacing, inputs, dialogs, tables, light and dark themes.
- Existing Git safety rules and native IPC contracts are unchanged.

## Evidence And Limits

Version 0.1.2: Vue and Electron TypeScript checks and the Vite production build completed successfully. The user's two attached desktop screenshots informed the layout revision. No new browser, desktop window, screenshot capture or interaction test was launched for this revision, as requested. Runtime scrolling and final visual appearance remain unverified.

| Surface | Implementation | Validation |
| --- | --- | --- |
| Fonts and typography | Product headings, 13-14px body controls and smaller metadata | Compilation only; final visual review not performed |
| Spacing and layout | Removed banner, two-column tool grid, project rail and responsive breakpoints | Compilation only; no final viewport screenshots |
| Colors and tokens | Semantic palette with complete light/dark component variables | Compilation only; contrast not measured in a new browser run |
| Image quality | Reuses Lucide icons; no new raster assets or decorative drawings | Source inspection only |
| Copy and content | Existing tool names, real saved projects and activity | Source inspection only |
| Interaction | Existing tools plus direct home-project entry and project filtering | Types checked; new interactions not exercised end to end |

No generated mockup or final visual fidelity comparison is claimed. A desktop inspection attempt did not produce usable product evidence because other windows obscured the surface; it is not treated as a passing check.

## Handoff

The implementation may be reviewed through the existing local preview or the rebuilt Windows installer. Visual QA remains deferred at the user's request. No P0/P1/P2 visual pass is claimed.

final result: blocked

Reason: final browser capture and interaction verification were explicitly excluded by the user. Compilation and packaging do not substitute for visual QA.
