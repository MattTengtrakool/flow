# Flow

A macOS menu bar app that passively observes your screen context and generates structured observations about your work using AI. Built with React Native macOS.

Flow sits quietly in your menu bar, captures what you're working on, and produces machine-readable observations that can power task clustering, time tracking, and work pattern analysis.

## Features

- **Passive context capture** -- tracks the active app, window title, and screen region without interrupting your workflow
- **Precise mode** -- uses macOS Accessibility APIs for fine-grained window metadata when granted permission
- **AI-powered observations** -- sends screenshots and metadata through a strict JSON schema to produce structured, validated observations
- **Fixture-based evaluation** -- save real captures as fixtures, re-run them later, and score observations for usefulness, confidence, and sensitivity
- **Local-first storage** -- all data (event log, settings, fixtures) is persisted locally in Application Support

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
Screen context  -->  Screenshot + metadata  -->  Observation engine  -->  Structured JSON
                                                      |
                                              Validated against
                                              a strict schema
```

1. Flow monitors the frontmost application and window via macOS APIs
2. On capture, it takes a screenshot of the target window or app
3. The screenshot and context metadata are sent to an observation engine
4. The engine returns structured JSON validated against a strict schema
5. Observations can be saved as fixtures for evaluation and scoring

### Storage

All data stays on your machine:

| Boundary | Contents |
|---|---|
| Event log | Append-only timeline of all context changes |
| Observation settings | API key, model preferences |
| Fixtures | Saved captures with scores for evaluation |

## Project Structure

```
App.tsx                          React Native entry point
src/
  observation/
    useObservationLab.ts         Observation lab UI hook
    openaiObservationEngine.ts   AI observation engine
    schema.ts                    Observation schema & validation
  state/
    eventLog.ts                  Event types and replay logic
    useEventSourcedTimeline.ts   App state and command handlers
  storage/
    eventLogStorage.ts           JS bridge to native event log
    observationLabStorage.ts     JS bridge to native observation storage
macos/
  Flow-macOS/
    AppDelegate.mm               Menu bar app setup
    EventLogStorage.mm           Native event log persistence
    ObservationLabStorage.mm     Native observation + fixture storage
    ContextCaptureModule.mm      Screen context and capture engine
```

## License

Private -- not yet licensed for distribution.
