# Benchmarking

Flow's first benchmark harness evaluates planner output against human-labeled
gold worklog blocks. It is deterministic and fixture-based, so it can run in CI
without screenshots, API keys, or live model calls.

## Run

```bash
pnpm benchmark:planner
pnpm benchmark:planner -- --json
pnpm benchmark:planner -- --out benchmarks/latest-planner-report.json
```

By default, cases are loaded from `benchmarks/cases`. Each case directory needs:

- `event-log.json` with at least one `task_plan_revised` event, or
- `predicted-plan.json` containing a plan snapshot or block array
- `gold.json` containing human-labeled blocks

## Gold Format

```json
{
  "name": "PAY-193 retry flow",
  "blocks": [
    {
      "id": "gold_pay_193_retry_flow",
      "startAt": "2026-04-24T16:00:00.000Z",
      "endAt": "2026-04-24T16:20:00.000Z",
      "headline": "PAY-193 retry flow",
      "category": "coding",
      "artifacts": {
        "apps": ["Cursor"],
        "repositories": ["payments-service"],
        "tickets": ["PAY-193"],
        "documents": ["retry.ts"],
        "urls": [],
        "people": []
      }
    }
  ]
}
```

## Metrics

- **Block precision / recall / F1**: whether predicted blocks overlap gold
  blocks by at least 10% temporal IoU.
- **Temporal IoU**: overlap quality between matched predicted and gold blocks.
- **Boundary error**: mean absolute start/end error in minutes.
- **Category accuracy**: category match for matched blocks.
- **Artifact F1**: precision/recall over apps, repos, tickets, docs, URLs, and
  people.
- **Headline anchor pass rate**: whether the headline includes a gold anchor
  such as a ticket, repo, document, person, or enough task-title token overlap.
- **Over-merged / over-split blocks**: rough counts of blocks spanning multiple
  gold tasks or one gold task split across multiple predictions.

## Adding Cases

Start with redacted real sessions where the correct blocks are obvious. Prefer
small cases that isolate one failure mode: mixed research/coding, meeting plus
follow-up, brief lookup, task switch, duplicate frame skip, and ambiguous
screens that should not become confident blocks.
