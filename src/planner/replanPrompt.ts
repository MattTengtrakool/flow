import type { ReplanInput } from './replanTypes';
import type { CondensedObservationEntry, PlanBlock } from './types';

type PromptPreviousBlock = {
  startAt: string;
  endAt: string;
  headline: string;
  narrative: string;
  label: PlanBlock['label'];
  category: PlanBlock['category'];
  confidence: number;
};

export function buildReplanPrompt(input: ReplanInput): string {
  const prevBlocks: PromptPreviousBlock[] =
    input.previousSnapshot?.blocks.map(block => ({
      startAt: block.startAt,
      endAt: block.endAt,
      headline: block.headline,
      narrative:
        block.narrative.length > 240
          ? `${block.narrative.slice(0, 240)}…`
          : block.narrative,
      label: block.label,
      category: block.category,
      confidence: block.confidence,
    })) ?? [];

  const promptClusters = input.clusters.map(cluster => ({
    id: cluster.clusterId,
    startAt: cluster.earliestAt,
    endAt: cluster.latestAt,
    count: cluster.occurrenceCount,
    activity: cluster.activityType,
    hypothesis: cluster.taskHypothesis,
    taskAnchors: extractClusterAnchors(cluster),
    summaries: cluster.representativeSummaries,
    nextActions: cluster.nextActions,
    artifacts: cluster.artifacts,
  }));

  const lines = [
    'You are building a personal task calendar from desktop observations.',
    'Produce a list of time blocks covering the requested window.',
    'Each block is ONE task the person was working on.',
    '',
    '═══════════════════════════════════════════════════',
    'THE #1 RULE: HEADLINES NAME TASKS, NOT ACTIVITIES.',
    '═══════════════════════════════════════════════════',
    '',
    'A TASK is what the person was trying to accomplish - a specific feature,',
    'ticket, PR, document, or meeting. An ACTIVITY is the mechanics of HOW',
    '(reviewing, debugging, configuring, rebasing, refactoring, typing).',
    'Headlines MUST name tasks. Activities go in the narrative, never the title.',
    '',
    'BAD HEADLINES (describe activity or are generic):',
    '  ✗ "Git Rebase & Launch Workflow Reviews"  — "git rebase" is a mechanic',
    '  ✗ "Developing & Reviewing Launch Workflows" — "workflows" is abstract',
    '  ✗ "Configuring Olympus Environment & Git"   — "configuring" is activity',
    '  ✗ "Refactoring & Code Review"               — two activities joined',
    '  ✗ "Debugging and testing"                   — all verbs, no noun',
    '  ✗ "Code changes and PR feedback"            — no concrete task',
    '  ✗ "Working on Launch"                       — generic',
    '',
    'GOOD HEADLINES (anchor on a specific thing):',
    '  ✓ "PAY-193 retry flow"                         (ticket anchor)',
    '  ✓ "Pre-consultation form for launch portal"    (named feature)',
    '  ✓ "Brand dedup by viewer role (PR #34603)"     (named PR + intent)',
    '  ✓ "Olympus .env.development config"            (specific artifact)',
    '  ✓ "hestia PR #34619 review"                    (specific PR)',
    '  ✓ "Q2 strategy brief"                          (named doc)',
    '  ✓ "Weekly Launch Product Sync"                 (named meeting)',
    '  ✓ "listBr... role arrays refactor (PR #34609)" (file + PR)',
    '',
    'HEADLINE RULES (all must hold):',
    '1. NEVER start with a gerund (word ending in -ing): Reviewing, Debugging,',
    '   Configuring, Developing, Refactoring, Implementing, Writing, Testing,',
    '   Managing, Setting, Handling, Working, Investigating, Browsing.',
    '2. NEVER use "&" or "and" to join two activities. A block is ONE task.',
    '3. The headline MUST anchor on ONE identifier visible in the clusters.',
    '   Use this priority order:',
    '     (a) Ticket ID from taskAnchors.tickets  (e.g. POS-2221, PAY-193)',
    '     (b) PR reference from taskAnchors.prs   (e.g. #34619, PR #34603)',
    '     (c) Named meeting (if activityType is meeting and a meeting title',
    '         is visible in summaries or hypothesis)',
    '     (d) Specific feature or component name, inferred from the most',
    '         distinctive file in taskAnchors.files (e.g. "dedupeAssignmentsByBrand",',
    '         "pre-consultation form", "listBr role arrays")',
    '     (e) Repo name from taskAnchors.repos if nothing else is specific',
    '4. NEVER use these words alone as a headline: "workflow", "workflows",',
    '   "environment", "config", "setup", "updates", "code", "changes", "work".',
    '5. 3 to 8 words max. Optionally one parenthetical with a PR or ticket ID.',
    '',
    'If you truly cannot identify ONE task the cluster was about, the block',
    'should not exist - lower the confidence to 0 and omit it, leaving the',
    'time as a gap. Do NOT invent a vague headline to cover unclear work.',
    '',
    '═══════════════════════════════════════════════════',
    'BLOCK STRUCTURE — merging AND splitting rules',
    '═══════════════════════════════════════════════════',
    '',
    '- At most 12 blocks total.',
    '- If the person switches activity but stays on the same task (coded, then',
    '  reviewed the PR for the same task, then tested it) — ONE block.',
    '- NEVER emit two adjacent blocks sharing the same ticket, PR, repo, or',
    '  primary file. Merge them.',
    '- Prefer 30-120 min blocks with rich narratives over many small ones.',
    '',
    'BUT — do NOT over-merge. Distinct work belongs in distinct blocks:',
    '',
    '- If two clusters have DIFFERENT primary entities (different repos,',
    '  different tickets, different files, different companies being',
    '  researched, different meetings, different URL hosts) and neither',
    "  cluster references the other's entities, they are SEPARATE blocks.",
    '- Temporal proximity alone is NOT a reason to merge. Two things that',
    '  happened 3 minutes apart but are about different topics remain TWO',
    '  blocks, not one.',
    '- Wrong example: a cluster about researching Cognition (Google searches,',
    '  cognition.ai, Wikipedia) + a cluster about authenticating to GitHub',
    '  Enterprise (logging in, 2FA, opening a PR) = TWO blocks, not one.',
    '  The entities do not overlap. Label them separately.',
    '- Wrong example: "Reviewing stage 1 plan in Cursor" + "Researching',
    '  Cognition company" = TWO blocks. Same time window, different topics.',
    '- Right example: "Coding auth flow" + "Reviewing PR #34619 for that same',
    '  auth flow" + "Testing the login against staging" = ONE block, because',
    '  they all anchor on the same feature/PR/ticket.',
    '',
    'TIME-SPAN RULES (critical):',
    '',
    "- A block's startAt should be at or just before the FIRST observation",
    '  in its clusters. Its endAt should be at or just after the LAST',
    '  observation. Do NOT extend a block past the last observation to fill',
    '  empty time — if there are no observations for 30 minutes, the person',
    '  was away from the desk, not still on the task.',
    '- Minimum 10 min applies to tasks with continuous observation coverage.',
    '  For short bursts (a quick 2-minute lookup), emit a short block with',
    '  confidence ≥ 0.7, not a padded 10-minute block.',
    '- If a cluster has only 1-3 observations in a single minute, the block',
    '  is roughly that minute plus a small buffer — not 40 minutes.',
    '',
    '═══════════════════════════════════════════════════',
    'NARRATIVE (short preview, shown on cards)',
    '═══════════════════════════════════════════════════',
    '',
    '- 2 sentences max. Past tense, verb-first. Serves as the card preview.',
    '- Name 1-2 concrete artifacts.',
    '',
    '═══════════════════════════════════════════════════',
    'NOTES (Notion-style page, markdown bullets)',
    '═══════════════════════════════════════════════════',
    '',
    'This is the primary body of the block — think Notion-style notes:',
    'clean bullets, hierarchical, written so the reader gets a sharp picture',
    'of what was done. Format as GITHUB-FLAVORED MARKDOWN bullets only.',
    '',
    'CONTENT AND ORDER:',
    '- Bullets are time-ordered (events flow from start of block to end), but',
    '  do NOT include explicit timestamps. No "9:43 AM —" prefixes. Just write',
    '  the bullets in the order they happened.',
    '- 4 to 10 top-level bullets. Pick the number based on what actually',
    '  happened — short blocks may need only 3 strong bullets, long blocks',
    '  with many distinct steps can use 8-10.',
    '- Each top-level bullet is ONE coherent action, decision, artifact, or',
    '  topic. Past tense, verb-first.',
    '- Use nested sub-bullets (indent 2 spaces) for related context: file',
    '  paths, PR numbers, ticket IDs, decisions, follow-ups, blockers.',
    '- Use **bold** for the key names (PR #s, ticket IDs, files, people,',
    '  docs, meetings). Use `code` only for actual file paths or identifiers.',
    '',
    'EXAMPLES — write notes like this:',
    '',
    'Example 1 — hestia PR #34619 review (a 30-minute block):',
    '  - Opened **PR #34619** in `hestia` to review the caching + `todos` cleanup',
    '    - Skimmed the diff and outstanding review threads',
    '    - Flagged cache-TTL concern in `AuthProvider.tsx`',
    '    - Left feedback on `todos` naming inconsistency',
    '  - Scanned failing CI checks and requested a rerun',
    '  - Messaged **Alex** in Slack about the missing test coverage',
    '',
    'Example 2 — Brand dedup by viewer role / PR #34603 (a 75-minute block):',
    '  - Refactored `dedupeAssignmentsByBrand.ts` so viewer role takes',
    '    priority over admin',
    '    - Reused the existing role hierarchy from `roles.ts`',
    '    - Hit a Vite compile error from a stale `AssignmentContext` barrel',
    '      export — fixed by re-exporting the new helpers',
    '  - Ran the full test suite locally; everything green',
    '  - Pushed the branch and opened **PR #34603**',
    '  - Cross-referenced **CBO-96** ticket notes to confirm scope coverage',
    '',
    'Example 3 — Weekly Launch ↔ Product Sync (a meeting block):',
    '  - **Website 2.0** rollout — walked through the updated timeline',
    '  - **Menu Agent** beta results — conversions came in lower than expected',
    '    - Discussed possible causes (search ranking + onboarding copy)',
    '  - Action item: pull KPI numbers from the PostHog dashboard before next sync',
    '  - Side check: Gemini API status mid-meeting (no incidents)',
    '',
    'AVOID in notes:',
    '- Explicit timestamps at the start of bullets — you no longer use them.',
    '- Grouping bullets by topic in a way that breaks chronological flow.',
    '- Generic filler ("worked on stuff", "discussed things").',
    '- Bullets that just describe activity ("Did some coding") with no object.',
    '- Window titles or app chrome as bullet content.',
    '- Wrapping the entire notes in a code block or quote.',
    '- Markdown headers (#, ##) — notes are just bullets.',
    '',
    '═══════════════════════════════════════════════════',
    'REMAINING NARRATIVE RULES',
    '═══════════════════════════════════════════════════',
    '',
    '- Narrative and notes both stay past tense, outcome-focused.',
    '- Describe what was ACCOMPLISHED, not what was observed.',
    '- Prefer outcome verbs: fixed, merged, drafted, replied, reviewed,',
    '  implemented, shipped, deployed, rebased.',
    '',
    '═══════════════════════════════════════════════════',
    'OTHER FIELDS',
    '═══════════════════════════════════════════════════',
    '',
    '- keyActivities: 2-4 bullets, each under 12 words. Specific actions.',
    '- nextActions: 0-3 concrete follow-up actions visible or strongly implied.',
    '- calendarEventIds: calendar context event ids that directly overlapped',
    '  or named this work. Empty array when no calendar event helped.',
    '- artifacts: real work artifacts only. Ticket IDs in "tickets", repo',
    '  names in "repositories", file paths in "documents", links in "urls".',
    '  NO window titles, app chrome, or breadcrumbs like "Owner.com | Launch".',
    '  Max 6 per list.',
    '- label: worked_on | reviewed | drafted | likely_completed | confirmed_completed.',
    '- category: coding | research | review | writing | communication | planning |',
    '  browsing | file_management | meeting | other.',
    '- confidence: 0.9 for a clearly-identified task, 0.7 with minor noise,',
    '  0.5 for mixed. Below 0.35 → omit the block.',
    '- reasonCodes: 1-4 short tags.',
    '- sourceClusterIds: every cluster.id that contributed. Only real ids.',
    '',
    'CALENDAR CONTEXT:',
    '- Calendar events express scheduled intent, not proof of completed work.',
    '- Treat scheduled/context calendar items separately from observed desktop',
    '  work. Calendar-only time must remain uncompleted unless observations',
    '  support actual work.',
    '- Use overlapping scheduled events to name and bound meeting observations.',
    '- Preserve confirmed calendar links when observations support the same',
    '  work. Do not mark calendar-only time completed without desktop',
    '  observations. If a busy event overlaps a work block, avoid stretching',
    '  observed work through busy time unless observations support it.',
    '',
    'Context:',
    JSON.stringify(
      {
        windowStartAt: input.windowStartAt,
        windowEndAt: input.windowEndAt,
        clusters: promptClusters,
        calendarContext:
          input.calendarContext != null &&
          input.calendarContext.events.length > 0
            ? input.calendarContext
            : null,
        previousPlan:
          prevBlocks.length > 0
            ? {
                note: 'Previous plan blocks for reference only. Freely rewrite or delete based on new clusters and the headline rules above.',
                blocks: prevBlocks,
              }
            : null,
        userCorrections:
          input.correctionHints != null && input.correctionHints.length > 0
            ? {
                note: 'User corrections are authoritative product feedback. Preserve corrected titles/categories when the same source observations still describe the same task. If markedWrong is true, avoid repeating the same mistaken block framing.',
                corrections: input.correctionHints,
              }
            : null,
      },
      null,
      2,
    ),
  ];

  return lines.join('\n');
}

const TICKET_PATTERN = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;
const PR_PATTERN = /#(\d{2,7})\b|\bpull\/(\d{2,7})\b/gi;

type ClusterAnchors = {
  tickets: string[];
  prs: string[];
  files: string[];
  repos: string[];
};

function extractClusterAnchors(
  cluster: CondensedObservationEntry,
): ClusterAnchors {
  const textPool = [
    cluster.taskHypothesis ?? '',
    ...cluster.representativeSummaries,
    ...cluster.nextActions,
  ].join(' ');

  const tickets = new Set<string>();
  const prs = new Set<string>();

  for (const ticket of cluster.artifacts.tickets) {
    tickets.add(ticket.trim());
  }
  let ticketMatch: RegExpExecArray | null = TICKET_PATTERN.exec(textPool);
  while (ticketMatch != null) {
    tickets.add(`${ticketMatch[1]}-${ticketMatch[2]}`);
    ticketMatch = TICKET_PATTERN.exec(textPool);
  }
  TICKET_PATTERN.lastIndex = 0;

  let prMatch: RegExpExecArray | null = PR_PATTERN.exec(textPool);
  while (prMatch != null) {
    const num = prMatch[1] ?? prMatch[2];
    if (num != null) prs.add(`#${num}`);
    prMatch = PR_PATTERN.exec(textPool);
  }
  PR_PATTERN.lastIndex = 0;
  for (const url of cluster.artifacts.urls) {
    const urlPr = /\bpull\/(\d{2,7})\b/i.exec(url);
    if (urlPr != null) prs.add(`#${urlPr[1]}`);
  }

  const distinctiveFiles: string[] = [];
  for (const candidate of cluster.artifacts.documents) {
    if (isDistinctiveFile(candidate)) {
      distinctiveFiles.push(candidate);
    }
  }

  return {
    tickets: Array.from(tickets).slice(0, 4),
    prs: Array.from(prs).slice(0, 4),
    files: distinctiveFiles.slice(0, 4),
    repos: cluster.artifacts.repositories.slice(0, 3),
  };
}

function isDistinctiveFile(path: string): boolean {
  if (!path.includes('/') && !/\.[a-z0-9]{1,6}$/i.test(path)) return false;
  const basename = path.split('/').pop() ?? path;
  if (/^package(-lock)?\.json$/i.test(basename)) return false;
  if (/^\.env/i.test(basename)) return true;
  if (/^(readme|changelog|license)/i.test(basename)) return false;
  return true;
}
