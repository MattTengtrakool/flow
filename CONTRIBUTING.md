# Contributing

Thanks for helping improve Flow.

## Setup

```bash
pnpm install
pnpm native-capture:build
pnpm start
```

## Quality Gates

Run these before opening a pull request:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm native-capture:build
pnpm electron:build
```

For release-oriented changes, also run:

```bash
pnpm electron:dist
```

## Architecture

- Electron main owns storage, native capture orchestration, observations, planner revisions, and timeline broadcasts.
- Electron renderer is a subscriber/command surface.
- `src/` contains shared domain logic: event replay, planner, observation schemas, chat tools, privacy redaction, and worklog types.
- Native macOS capture lives in `electron/native-capture/`.

See `docs/architecture.md` for more detail.
