import { ipcMain } from 'electron';

import {
  calendarEventOverlapsRange,
  isCalendarEventBusy,
} from '../../../src/calendar/calendarLogic';
import type {
  CalendarStatePayload,
  ExternalCalendarEventView,
} from '../../../src/calendar/types';
import type { PlanBlock } from '../../../src/planner/types';
import { normalizeProjects, normalizeTasks } from '../../../src/workArtifacts';
import {
  type ProactiveBriefRequest,
  type ProactiveInsight,
  type ProactiveInsightView,
  type ProactiveState,
} from '../../../src/proactive/types';
import {
  createDomainId,
  createOccurredAt,
  getCurrentContext,
  type DomainEvent,
  type TimelineView,
} from '../../../src/timeline/eventLog';
import type { ContextSnapshotPayload } from '../../../src/types/contextCapture';
import { generateManagedProactiveBrief } from '../ai/managedAiClient';
import { calendarService } from '../calendar/googleCalendarService';
import { syncCompanionWindow } from './companionWindow';
import { settingsService } from '../settings/settingsService';
import { timelineService } from '../timeline/timelineService';
import { sendToAllWindows } from '../windowRegistry';
import { showMainWindow } from '../windowRegistry';

const EVALUATE_INTERVAL_MS = 60_000;
const PRE_MEETING_WINDOW_MS = 10 * 60_000;
const PRE_MEETING_MIN_LEAD_MS = -1 * 60_000;
const PRE_MEETING_EXPIRY_MS = 20 * 60_000;
const POST_MEETING_MIN_AGE_MS = 2 * 60_000;
const POST_MEETING_WINDOW_MS = 20 * 60_000;
const RETURN_TO_TASK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const LOW_CONFIDENCE_WINDOW_MS = 24 * 60 * 60 * 1000;
const END_OF_DAY_START_MINUTES = 16 * 60 + 30;
const END_OF_DAY_END_MINUTES = 19 * 60 + 30;
const ACTIVE_RATE_WINDOW_MS = 60 * 60 * 1000;
const ACTIVE_LIMIT_BY_INTENSITY = {
  quiet: 1,
  balanced: 3,
  active: 6,
} as const;

type ProactiveCandidate = ProactiveInsight & {
  score: number;
};

class ProactiveService {
  private timer: NodeJS.Timeout | null = null;

  hydrate() {
    this.ensureTimer();
    calendarService.on('changed', () => {
      this.evaluate().catch(() => {});
    });
    settingsService.on('changed', () => {
      this.evaluate().catch(() => {});
      this.broadcast();
    });
    this.evaluate().catch(() => {});
  }

  async getState(): Promise<ProactiveState> {
    await this.evaluate();
    return this.publicState();
  }

  dismiss(insightId: string): ProactiveState {
    timelineService.appendProactiveEvents([
      {
        id: createDomainId('event'),
        type: 'proactive_insight_dismissed',
        insightId,
        occurredAt: createOccurredAt(),
      },
    ]);
    this.broadcast();
    return this.publicState();
  }

  snooze(insightId: string, minutes: number): ProactiveState {
    const snoozeMinutes = Number.isFinite(minutes)
      ? Math.max(5, Math.min(120, Math.round(minutes)))
      : 10;
    timelineService.appendProactiveEvents([
      {
        id: createDomainId('event'),
        type: 'proactive_insight_snoozed',
        insightId,
        snoozedUntil: new Date(
          Date.now() + snoozeMinutes * 60_000,
        ).toISOString(),
        occurredAt: createOccurredAt(),
      },
    ]);
    this.broadcast();
    return this.publicState();
  }

  action(insightId: string, actionId: string): ProactiveState {
    if (
      actionId === 'open_flow' ||
      actionId === 'open_block' ||
      actionId === 'open_notes' ||
      actionId === 'review_block'
    ) {
      showMainWindow();
    }
    timelineService.appendProactiveEvents([
      {
        id: createDomainId('event'),
        type: 'proactive_insight_actioned',
        insightId,
        actionId,
        occurredAt: createOccurredAt(),
      },
    ]);
    this.broadcast();
    return this.publicState();
  }

  private async evaluate() {
    const settings = settingsService.publicSettings();
    if (
      !settings.proactive.proactiveEnabled ||
      settings.privacyModeEnabled ||
      isQuietHoursActive()
    ) {
      return;
    }

    const now = new Date();
    const calendar = await calendarService.getState();
    const timeline = timelineService.getTimelineForServices();
    const blocks = recentPlanBlocks(timeline, now);
    const existing = timeline.proactiveInsightsById;
    const candidates = buildCandidates({
      calendar,
      timeline,
      blocks,
      now,
    })
      .filter(candidate => existing[candidate.id] == null)
      .sort((a, b) => b.score - a.score);
    const activeRemaining = activeInsightBudgetRemaining(timeline, now);

    const generated: DomainEvent[] = [];
    let activeGenerated = 0;
    for (const candidate of candidates) {
      const expandsCompanion = candidate.displayMode !== 'pill';
      if (expandsCompanion && activeGenerated >= activeRemaining) continue;
      const baseInsight = { ...candidate };
      delete (baseInsight as Partial<ProactiveCandidate>).score;
      const insight = await maybeGenerateBrief(baseInsight, calendar, blocks);
      generated.push({
        id: createDomainId('event'),
        type: 'proactive_insight_generated',
        insight,
        occurredAt: insight.generatedAt,
      });
      if (expandsCompanion) activeGenerated += 1;
    }

    if (generated.length > 0) {
      timelineService.appendProactiveEvents(generated);
      this.broadcast();
    }
  }

  private publicState(): ProactiveState {
    const settings = settingsService.publicSettings();
    const nowMs = Date.now();
    const timeline = timelineService.getTimelineForServices();
    const insights = timeline.proactiveInsightOrder
      .map(id => timeline.proactiveInsightsById[id])
      .filter((insight): insight is ProactiveInsightView => insight != null)
      .filter(
        insight =>
          insight.expiresAt == null || Date.parse(insight.expiresAt) > nowMs,
      )
      .map(insight =>
        insight.status === 'snoozed' &&
        insight.snoozedUntil != null &&
        Date.parse(insight.snoozedUntil) <= nowMs
          ? { ...insight, status: 'active' as const, snoozedUntil: undefined }
          : insight,
      )
      .sort(compareInsightsForDisplay);
    const quieted = settings.privacyModeEnabled || isQuietHoursActive();
    const activeInsight = quieted
      ? null
      : insights.find(
          insight =>
            insight.status === 'active' && insight.displayMode !== 'pill',
        ) ?? null;
    return {
      enabled: settings.proactive.proactiveEnabled,
      companionEnabled: settings.proactive.companionEnabled,
      quieted,
      settings: settings.proactive,
      insights,
      activeInsight,
    };
  }

  private broadcast() {
    const payload = this.publicState();
    syncCompanionWindow(payload);
    sendToAllWindows('flow:proactive:stateChanged', payload);
  }

  private ensureTimer() {
    if (this.timer != null) return;
    this.timer = setInterval(() => {
      this.evaluate().catch(() => {});
    }, EVALUATE_INTERVAL_MS);
  }
}

export const proactiveService = new ProactiveService();

export function registerProactiveIpcHandlers() {
  ipcMain.handle('flow:proactive:getState', () => proactiveService.getState());
  ipcMain.handle('flow:proactive:dismiss', (_event, insightId) =>
    proactiveService.dismiss(insightId),
  );
  ipcMain.handle('flow:proactive:snooze', (_event, insightId, minutes) =>
    proactiveService.snooze(insightId, minutes),
  );
  ipcMain.handle('flow:proactive:action', (_event, insightId, actionId) =>
    proactiveService.action(insightId, actionId),
  );
}

function buildCandidates(args: {
  calendar: CalendarStatePayload;
  timeline: TimelineView;
  blocks: PlanBlock[];
  now: Date;
}): ProactiveCandidate[] {
  const settings = settingsService.publicSettings().proactive;
  return [
    ...(settings.preMeetingBriefsEnabled
      ? buildPreMeetingCandidates(args.calendar, args.blocks, args.now)
      : []),
    ...(settings.postMeetingNotesEnabled
      ? buildPostMeetingCandidates(args.calendar, args.blocks, args.now)
      : []),
    ...(settings.returnToTaskEnabled
      ? buildReturnToTaskCandidates(args.timeline, args.blocks, args.now)
      : []),
    ...(settings.lowConfidenceCorrectionsEnabled
      ? buildLowConfidenceCandidates(args.blocks, args.now)
      : []),
    ...(settings.endOfDaySummaryEnabled
      ? buildEndOfDayCandidates(args.blocks, args.now)
      : []),
  ];
}

async function maybeGenerateBrief(
  insight: ProactiveInsight,
  calendar: CalendarStatePayload,
  blocks: PlanBlock[],
): Promise<ProactiveInsight> {
  if (
    insight.kind === 'return_to_task' ||
    insight.kind === 'low_confidence_block'
  ) {
    return insight;
  }

  try {
    const brief = await generateManagedProactiveBrief(
      buildBriefRequest(insight, calendar, blocks),
    );
    const title = brief.title.trim();
    const bullets = brief.bullets
      .map(bullet => trimSentence(bullet.trim(), 120))
      .filter(Boolean)
      .slice(0, 3);
    if (title.length === 0 && bullets.length === 0) return insight;
    return {
      ...insight,
      title: title.length > 0 ? title : insight.title,
      body: bullets.length > 0 ? bullets.join(' ') : insight.body,
    };
  } catch {
    return insight;
  }
}

function buildBriefRequest(
  insight: ProactiveInsight,
  calendar: CalendarStatePayload,
  blocks: PlanBlock[],
): ProactiveBriefRequest {
  const relatedBlocks = insight.relatedBlockIds
    .map(blockId => blocks.find(block => block.id === blockId))
    .filter((block): block is PlanBlock => block != null)
    .slice(0, 5);
  const eventId = insight.relatedCalendarEventIds[0];
  const event =
    eventId != null
      ? calendar.events.find(calendarEvent => calendarEvent.id === eventId)
      : null;
  return {
    kind: insight.kind,
    title: insight.title,
    reason: insight.reason,
    calendarEvent:
      event != null
        ? {
            id: event.id,
            title: event.title,
            startTime: event.startTime,
            endTime: event.endTime,
            attendeesCount: event.attendees.length,
            location: event.location,
          }
        : undefined,
    relatedBlocks: relatedBlocks.map(block => ({
      id: block.id,
      headline: block.headline,
      narrative: trimSentence(block.narrative, 240),
      notes: block.notes != null ? trimSentence(block.notes, 240) : undefined,
      nextActions: (block.nextActions ?? []).slice(0, 3),
      artifacts: artifactLabelsForBlock(block).slice(0, 8),
    })),
    artifacts: (insight.relatedArtifactIds ?? []).slice(0, 8),
  };
}

function buildPreMeetingCandidates(
  calendar: CalendarStatePayload,
  blocks: PlanBlock[],
  now: Date,
): ProactiveCandidate[] {
  const windowStartAt = new Date(
    now.getTime() + PRE_MEETING_MIN_LEAD_MS,
  ).toISOString();
  const windowEndAt = new Date(
    now.getTime() + PRE_MEETING_WINDOW_MS,
  ).toISOString();
  return calendar.events
    .filter(event => isCalendarEventBusy(event))
    .filter(event =>
      calendarEventOverlapsRange(
        event,
        Date.parse(windowStartAt),
        Date.parse(windowEndAt),
      ),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, 3)
    .map(event => buildPreMeetingInsight(event, blocks, now));
}

function buildPreMeetingInsight(
  event: ExternalCalendarEventView,
  blocks: PlanBlock[],
  now: Date,
): ProactiveCandidate {
  const startMs = Date.parse(event.startTime);
  const minutesUntil = Number.isFinite(startMs)
    ? Math.max(0, Math.round((startMs - now.getTime()) / 60_000))
    : 0;
  const relatedBlocks = findRelatedBlocksForText(
    [event.title, event.location, ...event.attendees].join(' '),
    blocks,
  ).slice(0, 3);
  const artifacts = artifactLabelsForBlocks(relatedBlocks).slice(0, 5);
  const title =
    event.visibility === 'private' || event.visibility === 'confidential'
      ? 'Private event coming up'
      : `Prep for ${event.title}`;
  const attendeeText =
    event.attendees.length > 0
      ? ` · ${event.attendees.length} attendee${
          event.attendees.length === 1 ? '' : 's'
        }`
      : '';
  const relatedText =
    relatedBlocks.length > 0
      ? ` Related: ${relatedBlocks
          .map(block => block.headline)
          .slice(0, 2)
          .join(', ')}.`
      : '';
  return {
    id: `proactive_pre_meeting_${event.id}_${event.startTime}`,
    kind: 'pre_meeting_brief',
    title,
    body: `Starts in ${minutesUntil} min${attendeeText}.${relatedText}`,
    reason:
      relatedBlocks.length > 0
        ? 'Upcoming calendar event overlaps recent Flow work.'
        : 'Upcoming busy calendar event.',
    priority: minutesUntil <= 5 ? 'high' : 'normal',
    relatedBlockIds: relatedBlocks.map(block => block.id),
    relatedCalendarEventIds: [event.id],
    relatedArtifactIds: artifacts,
    relatedObservationIds: sourceObservationIdsForBlocks(relatedBlocks),
    actions: [
      { id: 'open_flow', label: 'Open Flow', kind: 'open' },
      { id: 'snooze_10', label: 'Snooze', kind: 'snooze' },
      { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
    ],
    primaryAction: { id: 'open_flow', label: 'Open Flow', kind: 'open' },
    displayMode: minutesUntil <= 10 ? 'brief' : 'card',
    generatedAt: now.toISOString(),
    expiresAt: new Date(startMs + PRE_MEETING_EXPIRY_MS).toISOString(),
    score: relatedBlocks.length > 0 ? 0.92 : minutesUntil <= 5 ? 0.86 : 0.72,
  };
}

function buildPostMeetingCandidates(
  calendar: CalendarStatePayload,
  blocks: PlanBlock[],
  now: Date,
): ProactiveCandidate[] {
  const nowMs = now.getTime();
  return calendar.events
    .filter(event => isCalendarEventBusy(event))
    .filter(event => {
      const endMs = Date.parse(event.endTime);
      return (
        Number.isFinite(endMs) &&
        nowMs - endMs >= POST_MEETING_MIN_AGE_MS &&
        nowMs - endMs <= POST_MEETING_WINDOW_MS
      );
    })
    .map<ProactiveCandidate | null>(event => {
      const relatedBlocks = blocks
        .filter(block => blocksOverlapEvent(block, event))
        .slice(0, 4);
      if (relatedBlocks.length === 0) return null;
      return {
        id: `proactive_post_meeting_${event.id}_${event.endTime}`,
        kind: 'post_meeting_notes',
        title: `Save notes from ${event.title}`,
        body: summarizeBlocksForBody(relatedBlocks),
        reason: 'Flow captured work during this calendar window.',
        priority: 'normal',
        relatedBlockIds: relatedBlocks.map(block => block.id),
        relatedCalendarEventIds: [event.id],
        relatedArtifactIds: artifactLabelsForBlocks(relatedBlocks),
        relatedObservationIds: sourceObservationIdsForBlocks(relatedBlocks),
        actions: [
          { id: 'open_notes', label: 'Open notes', kind: 'review' },
          { id: 'snooze_10', label: 'Snooze', kind: 'snooze' },
          { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
        ],
        primaryAction: {
          id: 'open_notes',
          label: 'Open notes',
          kind: 'review',
        },
        displayMode: 'card',
        generatedAt: now.toISOString(),
        expiresAt: new Date(nowMs + 45 * 60_000).toISOString(),
        score: 0.78,
      } satisfies ProactiveCandidate;
    })
    .filter((candidate): candidate is ProactiveCandidate => candidate != null);
}

function buildReturnToTaskCandidates(
  timeline: TimelineView,
  blocks: PlanBlock[],
  now: Date,
): ProactiveCandidate[] {
  const currentContext = getCurrentContext(timeline);
  if (currentContext == null || currentContext.isIdle) return [];
  const contextText = contextSearchText(currentContext);
  if (contextText.length === 0) return [];
  const todayKey = localDateKey(now);
  const block = blocks
    .filter(
      candidate =>
        now.getTime() - Date.parse(candidate.endAt) <= RETURN_TO_TASK_WINDOW_MS,
    )
    .find(candidate => blockMatchesText(candidate, contextText));
  if (block == null) return [];
  const nextAction = block.nextActions?.[0] ?? null;
  return [
    {
      id: `proactive_return_to_task_${block.id}_${todayKey}`,
      kind: 'return_to_task',
      title: `Back on ${block.headline}`,
      body:
        nextAction != null
          ? `Last next step: ${nextAction}`
          : trimSentence(block.narrative, 120),
      reason: `Current window matches recent Flow work in ${
        currentContext.appName ?? 'this app'
      }.`,
      priority: 'normal',
      relatedBlockIds: [block.id],
      relatedCalendarEventIds: [],
      relatedArtifactIds: artifactLabelsForBlock(block),
      relatedObservationIds: block.sourceObservationIds,
      actions: [
        { id: 'open_block', label: 'Open block', kind: 'open' },
        { id: 'snooze_10', label: 'Snooze', kind: 'snooze' },
        { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
      ],
      primaryAction: { id: 'open_block', label: 'Open block', kind: 'open' },
      displayMode: 'card',
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
      score: 0.74,
    },
  ];
}

function buildLowConfidenceCandidates(
  blocks: PlanBlock[],
  now: Date,
): ProactiveCandidate[] {
  return blocks
    .filter(block => block.confidence > 0 && block.confidence < 0.55)
    .filter(
      block =>
        now.getTime() - Date.parse(block.endAt) <= LOW_CONFIDENCE_WINDOW_MS,
    )
    .slice(0, 2)
    .map(block => ({
      id: `proactive_low_confidence_${block.id}`,
      kind: 'low_confidence_block',
      title: 'Help label this work block',
      body: `${block.headline} has low planner confidence (${Math.round(
        block.confidence * 100,
      )}%).`,
      reason: 'A quick correction will improve future replans.',
      priority: 'low',
      relatedBlockIds: [block.id],
      relatedCalendarEventIds: [],
      relatedArtifactIds: artifactLabelsForBlock(block),
      relatedObservationIds: block.sourceObservationIds,
      actions: [
        { id: 'review_block', label: 'Review', kind: 'review' },
        { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
      ],
      primaryAction: { id: 'review_block', label: 'Review', kind: 'review' },
      displayMode: 'card',
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 12 * 60 * 60_000).toISOString(),
      score: 0.62,
    }));
}

function buildEndOfDayCandidates(
  blocks: PlanBlock[],
  now: Date,
): ProactiveCandidate[] {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (
    currentMinutes < END_OF_DAY_START_MINUTES ||
    currentMinutes > END_OF_DAY_END_MINUTES
  ) {
    return [];
  }
  const todayKey = localDateKey(now);
  const todayBlocks = blocks.filter(
    block => localDateKey(block.endAt) === todayKey,
  );
  if (todayBlocks.length < 2) return [];
  const settings = settingsService.publicSettings().proactive;
  return [
    {
      id: `proactive_end_of_day_${todayKey}`,
      kind: 'end_of_day_summary',
      title: 'Wrap up your day',
      body: `${todayBlocks.length} work blocks are ready for a quick summary.`,
      reason: 'It is late in the workday and Flow has enough captured work.',
      priority: settings.intensity === 'active' ? 'normal' : 'low',
      relatedBlockIds: todayBlocks.map(block => block.id).slice(0, 8),
      relatedCalendarEventIds: [],
      relatedArtifactIds: artifactLabelsForBlocks(todayBlocks).slice(0, 8),
      relatedObservationIds: sourceObservationIdsForBlocks(todayBlocks).slice(
        0,
        20,
      ),
      actions: [
        { id: 'open_flow', label: 'Open summary', kind: 'open' },
        { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
      ],
      primaryAction: {
        id: 'open_flow',
        label: 'Open summary',
        kind: 'open',
      },
      displayMode: settings.intensity === 'active' ? 'card' : 'pill',
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3 * 60 * 60_000).toISOString(),
      score: settings.intensity === 'active' ? 0.7 : 0.48,
    },
  ];
}

function isQuietHoursActive(): boolean {
  const proactive = settingsService.publicSettings().proactive;
  if (!proactive.quietHoursEnabled) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const start = parseClockMinutes(proactive.quietHoursStart);
  const end = parseClockMinutes(proactive.quietHoursEnd);
  if (start === end) return false;
  return start < end
    ? currentMinutes >= start && currentMinutes < end
    : currentMinutes >= start || currentMinutes < end;
}

function activeInsightBudgetRemaining(timeline: TimelineView, now: Date) {
  const settings = settingsService.publicSettings().proactive;
  const limit = ACTIVE_LIMIT_BY_INTENSITY[settings.intensity];
  const cutoffMs = now.getTime() - ACTIVE_RATE_WINDOW_MS;
  const recentExpandedCount = timeline.proactiveInsightOrder
    .map(id => timeline.proactiveInsightsById[id])
    .filter((insight): insight is ProactiveInsightView => insight != null)
    .filter(insight => insight.displayMode !== 'pill')
    .filter(insight => Date.parse(insight.generatedAt) >= cutoffMs).length;
  return Math.max(0, limit - recentExpandedCount);
}

function compareInsightsForDisplay(
  a: ProactiveInsightView,
  b: ProactiveInsightView,
) {
  const priorityDelta = priorityRank(b.priority) - priorityRank(a.priority);
  if (priorityDelta !== 0) return priorityDelta;
  const modeDelta =
    displayModeRank(b.displayMode) - displayModeRank(a.displayMode);
  if (modeDelta !== 0) return modeDelta;
  return b.generatedAt.localeCompare(a.generatedAt);
}

function priorityRank(priority: ProactiveInsightView['priority']) {
  if (priority === 'high') return 3;
  if (priority === 'normal') return 2;
  return 1;
}

function displayModeRank(mode: ProactiveInsightView['displayMode']) {
  if (mode === 'brief') return 3;
  if (mode === 'card') return 2;
  return 1;
}

function recentPlanBlocks(timeline: TimelineView, now: Date): PlanBlock[] {
  const seen = new Set<string>();
  const blocks: PlanBlock[] = [];
  const minStartMs = now.getTime() - RETURN_TO_TASK_WINDOW_MS;
  for (let i = timeline.planSnapshots.length - 1; i >= 0; i -= 1) {
    for (const block of timeline.planSnapshots[i].blocks) {
      if (seen.has(block.id)) continue;
      const blockEndMs = Date.parse(block.endAt);
      if (Number.isFinite(blockEndMs) && blockEndMs < minStartMs) continue;
      seen.add(block.id);
      blocks.push(block);
    }
  }
  return blocks.sort((a, b) => b.endAt.localeCompare(a.endAt));
}

function findRelatedBlocksForText(
  text: string,
  blocks: PlanBlock[],
): PlanBlock[] {
  const haystack = normalizeSearchText(text);
  if (haystack.length === 0) return [];
  return blocks
    .map(block => ({
      block,
      score: relationScore(haystack, block),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.block);
}

function relationScore(searchText: string, block: PlanBlock): number {
  let score = 0;
  for (const value of artifactLabelsForBlock(block)) {
    const normalized = normalizeSearchText(value);
    if (normalized.length > 0 && searchText.includes(normalized)) score += 3;
  }
  for (const token of meaningfulTokens(block.headline)) {
    if (searchText.includes(token)) score += 1;
  }
  return score;
}

function blockMatchesText(block: PlanBlock, searchText: string): boolean {
  const normalized = normalizeSearchText(searchText);
  if (normalized.length === 0) return false;
  return (
    relationScore(normalized, block) >= 3 ||
    artifactLabelsForBlock(block).some(value => {
      const artifact = normalizeSearchText(value);
      return artifact.length > 0 && normalized.includes(artifact);
    })
  );
}

function contextSearchText(context: ContextSnapshotPayload): string {
  return normalizeSearchText(
    [context.appName, context.windowTitle, context.bundleIdentifier].join(' '),
  );
}

function artifactLabelsForBlocks(blocks: PlanBlock[]): string[] {
  return dedupe(blocks.flatMap(block => artifactLabelsForBlock(block))).slice(
    0,
    12,
  );
}

function artifactLabelsForBlock(block: PlanBlock): string[] {
  return dedupe([
    ...normalizeTasks(block.artifacts),
    ...normalizeProjects(block.artifacts),
    ...block.artifacts.tickets,
    ...block.artifacts.repositories,
    ...block.artifacts.documents,
    ...block.artifacts.urls,
    ...block.artifacts.people,
    ...block.artifacts.apps,
  ]);
}

function sourceObservationIdsForBlocks(blocks: PlanBlock[]): string[] {
  return dedupe(blocks.flatMap(block => block.sourceObservationIds));
}

function summarizeBlocksForBody(blocks: PlanBlock[]): string {
  const titles = blocks.map(block => block.headline).slice(0, 2);
  const nextAction = blocks.flatMap(block => block.nextActions ?? [])[0];
  if (nextAction != null)
    return `Flow saw ${titles.join(', ')}. Next: ${nextAction}`;
  return `Flow saw ${titles.join(', ')} during this meeting window.`;
}

function blocksOverlapEvent(
  block: PlanBlock,
  event: ExternalCalendarEventView,
) {
  const blockStartMs = Date.parse(block.startAt);
  const blockEndMs = Date.parse(block.endAt);
  if (!Number.isFinite(blockStartMs) || !Number.isFinite(blockEndMs)) {
    return false;
  }
  return (
    blockStartMs < Date.parse(event.endTime) &&
    blockEndMs > Date.parse(event.startTime)
  );
}

function trimSentence(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trim()}...`;
}

function meaningfulTokens(value: string): string[] {
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter(token => token.length >= 4)
    .slice(0, 8);
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9#/-]+/g, ' ')
    .trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (trimmed.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function localDateKey(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return 'unknown';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseClockMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}
