# Contributing

Thanks for helping improve Flow.

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm native-capture:build
pnpm start
```

Set `GEMINI_API_KEY` in `.env` for observations, planner revisions, and chat.
Set `ANTHROPIC_API_KEY` when you want to exercise the Claude planner fallback.

## Quality Gates

Run these before opening a pull request:

```bash
pnpm native-capture:build
pnpm check
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
