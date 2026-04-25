# Flow

An AI worklog for macOS. Flow passively captures screen context, turns it into structured observations, and periodically writes a planner-backed calendar of what you worked on.

Flow sits quietly in your menu bar, captures what you're working on, and keeps a local event log that can be replayed into a daily work timeline.

## Features

- **Passive context capture** -- tracks the active app, window title, and screen region without interrupting your workflow
- **Precise mode** -- uses macOS Accessibility APIs for fine-grained window metadata when granted permission
- **AI-powered observations** -- sends screenshots and metadata through a strict JSON schema to produce structured, validated observations
- **Planner revisions** -- periodically condenses recent observations into calendar blocks with notes, artifacts, confidence, and provenance
- **Local-first storage** -- the event log and planner snapshots are persisted locally in Application Support

## Requirements

- macOS 14.0+
- Node.js 22+
- Xcode 15+
- CocoaPods

## Getting Started

```bash
# Install dependencies
npm install

# Install native pods
cd macos && pod install && cd ..

# Start Metro bundler
npm start
```

Then open `macos/Flow.xcworkspace` in Xcode, select the **Flow-macOS** scheme, and run.

On first launch, grant **Accessibility** and **Screen Recording** permissions when prompted.

## How It Works

```
Screen context -> Capture -> Observation -> Event log -> Planner -> Worklog UI
```

1. Flow monitors the frontmost application and window via macOS APIs.
2. Changed frames are captured with sanitized metadata and OCR text.
3. The observation engine returns structured JSON validated against a strict schema.
4. Observations are appended to the local event log.
5. The planner periodically rewrites the recent work window into calendar blocks.
6. Today, calendar, insights, chat, and settings screens read from the replayed timeline.

### Storage

All data stays on your machine:

| Boundary | Contents |
|---|---|
| Event log | Sessions, captures, observations, planner revisions, failures, and note edits |
| Capture previews | In-memory thumbnails for the current app session |
| Planner snapshots | Calendar blocks derived from recent observations |

## Project Structure

```
App.tsx                          React Native entry point
src/
  capture/
    useCaptureController.ts       Permissions, inspect, and capture commands
  observation/
    useObservationLab.ts          App-facing observation/timeline facade
    geminiObservationEngine.ts    Structured observation provider
    schema.ts                     Observation schema and validation
  planner/
    revisionEngine.ts             Planner revision engine
    providers/                    Gemini and Anthropic planner providers
    selectors.ts                  Worklog selectors over planner snapshots
    types.ts                      Plan block, snapshot, and usage types
  timeline/
    eventLog.ts                   Event types and replay logic
    useTimelineStore.ts           Timeline persistence and orchestration
  worklog/
    types.ts                      Worklog block and day view types
  storage/
    eventLogStorage.ts            JS bridge to native event log
  ui/
    screens/                      Today, chat, insights, search, settings
macos/
  Flow-macOS/
    AppDelegate.mm               Menu bar app setup
    EventLogStorage.mm           Native event log persistence
    ContextCaptureModule.mm      Screen context and capture engine
```

## License

License TBD.
