# Electron Parity QA

Use this checklist before shipping a release.

## Automated Gates

Run:

```bash
pnpm native-capture:build
pnpm check
pnpm electron:build
pnpm electron:dist
```

Optional DMG validation, when `hdiutil` is not resource-locked:

```bash
pnpm electron:dist:dmg
```

## Native Capture Checks

- `electron/native-capture/build/FlowNativeCapture getPermissionsStatus` returns Accessibility and Screen Recording status.
- `electron/native-capture/build/FlowNativeCapture currentContextSnapshot` returns active app, idle, source, permission, and timestamp fields.
- `electron/native-capture/build/FlowNativeCapture inspectCaptureTarget` returns candidates and a chosen target when Screen Recording is granted.
- `electron/native-capture/build/FlowNativeCapture captureNow` returns:
  - `metadata.status: "captured"`
  - `metadata.targetType`
  - `metadata.width` and `metadata.height`
  - `metadata.frameHash`
  - `metadata.perceptualHash`
  - `metadata.previewByteLength <= 524288`
  - `metadata.privacyRedaction.version: "capture-privacy-v1"`
  - `previewBase64`
  - `previewMimeType: "image/jpeg"`

## Release Workflow

1. First launch with no permissions.
2. Grant Accessibility.
3. Grant Screen Recording.
4. Start a session.
5. Switch active apps and windows.
6. Run manual capture.
7. Let continuous capture tick.
8. Verify duplicate frame skip by `frameHash`.
9. Generate an observation.
10. Run a planner revision.
11. Force a planner failure and retry.
12. Stop the session.
13. Relaunch with an unfinished session.
14. Edit notes.
15. Ask chat for today's standup.
16. Inspect Settings cost/performance data.

## Release Criteria

- Capture payloads match `src/types/contextCapture.ts`.
- Privacy screening happens before observation generation.
- Same event log produces the same worklog blocks.
- Existing `~/Library/Application Support/Flow/event-log.json` loads in Electron.
- Notes edits persist and survive relaunch.
- Packaged app can call the bundled native helper.
