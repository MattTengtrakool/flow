# Granolav2

This workspace now uses the React Native macOS app directly at the repo root.

## Run the app

1. Open Terminal.
2. `cd /Users/matthewtengtrakool/Desktop/Granolav2`
3. Make sure Node 22 is active:
   `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`
4. Verify it:
   `node -v`
5. Start Metro:
   `npm start`
6. In another Terminal tab, run:
   `open /Users/matthewtengtrakool/Desktop/Granolav2/macos/Granolav2RN.xcworkspace`
7. In Xcode, select the `Granolav2RN-macOS` scheme and run it on `My Mac`.

If `npm start` ever mentions `styleText`, your shell is still on the wrong Node version.

## Current Stage

- The app launches as a macOS debug-first menu bar app.
- Passive context, precise mode, target inspection, and one-shot capture are wired up.
- The debug window is now a focused observation lab instead of the earlier all-in-one debug surface.
- Real observations are generated from screenshot plus metadata through a strict JSON schema.
- Fixtures can be saved locally, rerun later, and manually scored for usefulness, confidence, and sensitivity.
- The older append-only event log is still present behind the scenes and continues to persist locally.

## Stage 8 Test Loop

1. Start Metro and run the macOS app from Xcode.
2. In the app, grant `Accessibility` and `Screen Recording`.
3. Paste an OpenAI API key into the observation settings box and save it locally.
4. Click `Inspect Capture Target`, then `Capture Now`.
5. Click `Observe Last Capture` and review the strict JSON output.
6. Save good screenshots as fixtures.
7. Run saved fixtures again and score:
   - usefulness
   - confidence
   - sensitivity
8. Once you have 50-100 fixtures, the fixture summary becomes the quick signal for whether the observation schema is good enough for clustering.

## Architecture

- Source of truth for timeline history: append-only event log
- Derived view: current in-memory timeline rebuilt from the event log
- Real observation path: screenshot + capture metadata + context metadata -> strict JSON observation
- Evaluation path: save fixture -> rerun fixture -> score usefulness/confidence/sensitivity
- Local storage boundaries:
  - event log
  - observation settings
  - saved fixtures

The mental model is:

1. Capture a screenshot.
2. Send the screenshot plus metadata to the observation engine.
3. Validate the returned JSON against the strict schema.
4. Save fixtures that represent real work.
5. Re-run fixtures and score them.
6. Use those scores to decide whether observations are good enough for task clustering.

## Main Files

- Native menu bar startup: `macos/Granolav2RN-macOS/AppDelegate.mm`
- Native event-log persistence: `macos/Granolav2RN-macOS/EventLogStorage.mm`
- Native observation settings + fixture storage: `macos/Granolav2RN-macOS/ObservationLabStorage.mm`
- React Native observation lab UI: `App.tsx`
- Observation lab hook: `src/observation/useObservationLab.ts`
- Observation engine: `src/observation/openaiObservationEngine.ts`
- Observation schema and validation: `src/observation/schema.ts`
- Event types and replay logic: `src/state/eventLog.ts`
- App state hook and command handlers: `src/state/useEventSourcedTimeline.ts`
- JS storage boundary: `src/storage/eventLogStorage.ts`
- JS observation storage boundary: `src/storage/observationLabStorage.ts`
- React Native macOS workspace: `macos/Granolav2RN.xcworkspace`
