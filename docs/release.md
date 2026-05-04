# Release

## Local Build

```bash
pnpm native-capture:build
pnpm check
pnpm electron:build
pnpm electron:dist
```

`pnpm electron:dist` produces an app directory and zip. It bundles
`electron/native-capture/build/FlowNativeCapture` as an extra resource.

## DMG Build

```bash
pnpm electron:dist:dmg
```

DMG generation uses macOS `hdiutil`. If `hdiutil` reports `Resource temporarily
unavailable`, retry after detaching stale mounted images or rebooting. The app
directory and zip path are the reliable local validation targets.

## Signing And Notarization

Production distribution needs a Developer ID Application certificate and
notarization credentials. The current local build falls back to ad-hoc signing
when no identity is configured.

Before release, verify:

- `Flow.app` is signed with the Developer ID identity.
- The bundled `native-capture/FlowNativeCapture` helper is signed with a
  compatible identity.
- Notarization succeeds.
- Screen Recording and Accessibility permissions are granted to the packaged
  app/helper identity that actually performs capture.

## Packaged Permission Smoke

From a packaged build:

1. Launch `release/mac-arm64/Flow.app`.
2. Grant Accessibility and Screen Recording.
3. Quit and relaunch if macOS requires it.
4. Run a manual capture from Settings.
5. Start a session and confirm continuous capture produces events.
