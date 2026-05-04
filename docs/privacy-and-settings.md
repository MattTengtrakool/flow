# Privacy And Settings

Flow is local-first for persisted work data. The Electron main process owns
settings, managed AI configuration, capture, storage, and model calls. The
renderer receives status only.

## Local Data

| File                                      | Purpose                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Application Support/Flow/event-log.json` | Append-only sessions, captures, observations, planner revisions, notes, and correction events |
| `Application Support/Flow/settings.json`  | Onboarding state, managed AI mode, privacy mode, and legacy encrypted key metadata            |

## AI Connection

- Flow uses Managed Flow AI through `FLOW_AI_PROXY_URL`. The desktop app calls the hosted
  relay, and the relay owns provider keys server-side.
- For local development before the relay is hosted, set `FLOW_AI_PROXY_URL=local`.
  Electron will keep the managed-only product path but run the relay adapter
  in-process with local `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` values.
- In managed mode, model inputs such as privacy-screened screenshots,
  sanitized metadata, planner clusters, and chat context are sent to the relay
  for processing. The local event log remains on-device.
- `FLOW_AI_PROXY_TOKEN` can be set by packaged builds when the relay expects an
  app-level bearer token. The renderer never receives this value.
- The desktop product does not ask users for model provider keys. Provider
  credentials live on the relay.
- Local Electron development reads `.env` from the repo root at launch. Set:
  - `FLOW_AI_PROXY_URL=local` for the in-process local adapter, or a hosted
    relay URL for production-like builds
  - `FLOW_AI_PROXY_TOKEN` when the relay requires an app-level bearer token

## Privacy Mode

Privacy mode pauses capture and observation. It also stops context monitoring
until privacy mode is turned off again. The status center and sidebar make the
paused state visible so the app never feels like it is silently watching.

## Corrections

User corrections are append-only events. Flow overlays corrected titles,
categories, notes, and feedback at read time; historical planner snapshots are
not rewritten.
