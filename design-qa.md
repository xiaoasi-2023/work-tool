# Workbench UI Redesign

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
