# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What Flow Is

Flow is a macOS menu bar app (Electron) that passively captures screen context, generates structured AI observations, and maintains a local worklog calendar. All data stays on-device.

Pipeline: `Native capture helper → Electron main → Observation engine → Event log → Planner → Renderer UI`

## Commands

```bash
pnpm install                  # Install dependencies
pnpm native-capture:build     # Compile the macOS ScreenCaptureKit/Vision helper (requires Xcode CLT)
pnpm electron:dev             # Build main process + start Vite dev server + launch Electron
pnpm electron:dist            # Full production build + package as macOS dir/zip
pnpm electron:dist:dmg        # Full production build + package as DMG

pnpm test                     # Run all Jest tests
pnpm lint                     # ESLint
pnpm typecheck                # tsc --noEmit for both tsconfig.json and electron/tsconfig.json
pnpm format                   # Prettier write
```

Run a single test file:
```bash
pnpm test __tests__/eventLog.test.ts
```

**Required env vars** (set before running):
- `GEMINI_API_KEY` — used by the observation engine and default planner provider
- `ANTHROPIC_API_KEY` — used by the Anthropic planner provider

## Architecture

### Process boundary

| Process | Entry point | Role |
|---|---|---|
| Native helper | `electron/native-capture/FlowNativeCapture.mm` | ScreenCaptureKit capture, Vision OCR, hashing |
| Electron main | `electron/main/main.ts` | IPC registration, tray, window, storage |
| Electron preload | `electron/preload/index.ts` | Bridges `window.flow` API via `contextBridge` |
| Electron renderer | `electron/renderer/` | React DOM app (Vite, port 5173 in dev) |

The renderer never imports Node or Electron APIs directly — it calls `window.flow.*` (typed as `FlowElectronApi` in `electron/shared/flowApi.ts`).

### IPC channel naming

All channels are prefixed `flow:` and registered in the main process. The preload exposes them as typed async methods. Channel names follow `flow:<domain>:<action>` (e.g. `flow:timeline:startSession`).

### Event log and timeline (`src/timeline/eventLog.ts`)

The event log is the single source of persistence. It is an append-only array of `DomainEvent` objects saved to `Application Support`. On boot, `replayEventLog()` folds all events into a `TimelineView` — the read model consumed by everything else. `stepEvent()` applies one event immutably. Never mutate `TimelineView` directly; always go through `appendEvents` in `ElectronTimelineService`.

### Timeline service (`electron/main/timeline/timelineService.ts`)

`ElectronTimelineService` is the central coordinator in the main process. It owns:
- Hydration from disk
- Continuous capture timer (1 s interval while a session is active)
- Observation generation (calls Gemini, skips duplicate frames by hash)
- Planner revision scheduling
- Broadcasting state to all renderer windows via `flow:timeline:stateChanged`

### Observation engine (`src/observation/`)

`runObservationForCapture.ts` is the entry point. It passes a screenshot + metadata to `geminiObservationEngine.ts`, which returns a `StructuredObservation` validated against the schema in `schema.ts`. The schema is strict — changes to it affect what the planner can read.

### Planner (`src/planner/`)

`revisionEngine.ts` orchestrates revision: it selects recent observations via `condenseObservations.ts`, calls either `geminiReplanEngine.ts` or `anthropicReplanEngine.ts`, and produces `task_plan_revised` or `task_plan_revision_failed` events. The UI reads plan data only through `selectors.ts` — never from raw events.

### Privacy (`src/privacy/redaction.ts`)

All data written to the event log is passed through sanitize helpers before `appendEvents` is called. Do not bypass these.

### Two tsconfigs

- `tsconfig.json` — covers `src/` and `electron/renderer/` (DOM lib, bundler module resolution, no emit)
- `electron/tsconfig.json` — covers `electron/main/` and `electron/preload/` (Node target, CommonJS emit to `dist-electron/`)

### Tests (`__tests__/`)

Tests are Jest + babel-jest (no ts-jest). Node environment only. Tests cover event log replay, observation schema validation, privacy redaction, planner revision logic, and Electron integration contracts (storage, native capture, context monitoring, migration regression).
