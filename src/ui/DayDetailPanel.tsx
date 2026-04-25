import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Image, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {Text} from './Text';

import type {WorklogCalendarBlock} from '../worklog/types';
import type {ObservationView} from '../timeline/eventLog';
import {displayArtifact} from '../planner/artifactDisplay';
import {CloseIcon, PlayIcon, ShareIcon, SparkleIcon} from './icons';
import {NotesEditor} from './NotesEditor';

type DayDetailPanelProps = {
  selectedDateIso: string;
  dayBlocks: WorklogCalendarBlock[];
  selectedBlock: WorklogCalendarBlock | null;
  onSelectBlock: (blockId: string) => void;
  observationsById: Record<string, ObservationView>;
  getCapturePreview?: (observationId: string) => string | null;
  userBlockNotes?: Record<
    string,
    {notes: string; editedAt: string; lastBlockId: string | null}
  >;
  onUpdateBlockNotes?: (args: {
    notesKey: string;
    blockId: string | null;
    notes: string;
  }) => void;
  onClose?: () => void;
};

type TabKey = 'notes' | 'highlights';

function formatDateHeading(dateIso: string): string {
  const date = new Date(`${dateIso}T12:00:00.000Z`);
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTimeRange(block: WorklogCalendarBlock): string {
  const start = new Date(block.startTime).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const end = new Date(block.endTime).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const minutes = Math.max(
    0,
    Math.round((Date.parse(block.endTime) - Date.parse(block.startTime)) / 60000),
  );
  const duration =
    minutes < 60
      ? `${minutes}m`
      : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${start} – ${end} (${duration})`;
}

function formatClock(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function DayDetailPanel(props: DayDetailPanelProps) {
  const {
    selectedDateIso,
    dayBlocks,
    selectedBlock,
    observationsById,
    getCapturePreview,
    userBlockNotes,
    onUpdateBlockNotes,
    onClose,
  } = props;
  const [tab, setTab] = useState<TabKey>('notes');

  const highlights = useMemo(
    () => buildHighlights(selectedBlock, observationsById, getCapturePreview),
    [selectedBlock, observationsById, getCapturePreview],
  );

  const hasSession =
    selectedBlock != null &&
    selectedBlock.summary.provenance.supportedByObservationIds.length > 0;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.dateHeading}>{formatDateHeading(selectedDateIso)}</Text>
        {onClose ? (
          <Pressable
            onPress={onClose}
            style={({pressed}) => [
              styles.closeButton,
              pressed ? styles.closeButtonPressed : null,
            ]}>
            <CloseIcon size={12} color="#6b6b6b" />
          </Pressable>
        ) : null}
      </View>

      {selectedBlock == null ? (
        <View style={styles.emptyShell}>
          <Text style={styles.emptyTitle}>No task selected</Text>
          <Text style={styles.emptyBody}>
            {dayBlocks.length === 0
              ? 'No plan has been written for this day yet.'
              : 'Pick a task from the calendar to see notes and highlights.'}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{selectedBlock.title}</Text>
            <View style={styles.titleMetaRow}>
              <View style={styles.metaDot} />
              <Text style={styles.timeRange}>{formatTimeRange(selectedBlock)}</Text>
            </View>
          </View>

          <View style={styles.tabs}>
            <TabButton
              label="Notes"
              active={tab === 'notes'}
              onPress={() => setTab('notes')}
            />
            <TabButton
              label="Highlights"
              active={tab === 'highlights'}
              onPress={() => setTab('highlights')}
            />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {tab === 'notes' ? (
              <NotesTab
                block={selectedBlock}
                userNotes={
                  selectedBlock.notesKey != null
                    ? userBlockNotes?.[selectedBlock.notesKey]?.notes ?? null
                    : null
                }
                onSaveNotes={(notes: string) => {
                  if (selectedBlock.notesKey == null) return;
                  onUpdateBlockNotes?.({
                    notesKey: selectedBlock.notesKey,
                    blockId: selectedBlock.id,
                    notes,
                  });
                }}
              />
            ) : null}
            {tab === 'highlights' ? (
              <HighlightsTab highlights={highlights} />
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={({pressed}) => [
                styles.footerSecondary,
                pressed ? styles.buttonPressed : null,
              ]}>
              <ShareIcon size={13} color="#1a1a1a" />
              <Text style={styles.footerSecondaryLabel}>Share</Text>
            </Pressable>
            <Pressable
              disabled={!hasSession}
              style={({pressed}) => [
                styles.footerPrimary,
                !hasSession ? styles.buttonDisabled : null,
                pressed && hasSession ? styles.buttonPressed : null,
              ]}>
              <PlayIcon size={12} color="#ffffff" />
              <Text style={styles.footerPrimaryLabel}>Play recording</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

type Highlight = {
  id: string;
  timestamp: string;
  summary: string;
  imageDataUri: string | null;
};

function buildHighlights(
  block: WorklogCalendarBlock | null,
  observationsById: Record<string, ObservationView>,
  getCapturePreview?: (observationId: string) => string | null,
): Highlight[] {
  if (block == null) return [];
  const ids = block.summary.provenance.supportedByObservationIds;
  const items: Highlight[] = [];
  for (const id of ids) {
    const observation = observationsById[id];
    if (observation == null) continue;
    const summary =
      observation.structured?.taskHypothesis ??
      observation.structured?.summary ??
      observation.text;
    if (summary == null || summary.trim().length === 0) continue;
    const preview =
      getCapturePreview?.(id) ?? observation.capturePreviewDataUri ?? null;
    items.push({
      id,
      timestamp: observation.observedAt,
      summary: summary.trim(),
      imageDataUri: preview,
    });
  }
  return dedupeHighlights(items);
}

function dedupeHighlights(items: Highlight[]): Highlight[] {
  const seen = new Set<string>();
  const out: Highlight[] = [];
  for (const item of items) {
    const key = item.summary.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

type TabButtonProps = {
  label: string;
  active: boolean;
  onPress: () => void;
};

function TabButton({label, active, onPress}: TabButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [
        styles.tabButton,
        active ? styles.tabButtonActive : null,
        pressed ? styles.tabButtonPressed : null,
      ]}>
      <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>
        {label}
      </Text>
      {active ? <View style={styles.tabUnderline} /> : null}
    </Pressable>
  );
}

type NotesTabProps = {
  block: WorklogCalendarBlock;
  userNotes: string | null;
  onSaveNotes: (notes: string) => void;
};

const EDIT_SAVE_DEBOUNCE_MS = 450;

function NotesTab({block, userNotes, onSaveNotes}: NotesTabProps) {
  const topics = useMemo(() => buildTopics(block), [block]);
  const generatedNotes = useMemo(() => deriveGeneratedNotes(block), [block]);
  const initialValue = userNotes ?? generatedNotes;
  const isUserEdited = userNotes != null;

  const [draft, setDraft] = useState(initialValue);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBlockIdRef = useRef(block.id);
  const pendingLocalEditRef = useRef(false);

  // Reset the local draft when we switch blocks, or when the authoritative
  // value changes from outside the editor (e.g. a replan regenerated the
  // notes and the user hasn't overridden them). During active typing we leave
  // the draft alone so the editor's caret never jumps.
  useEffect(() => {
    if (lastBlockIdRef.current !== block.id) {
      lastBlockIdRef.current = block.id;
      pendingLocalEditRef.current = false;
      setDraft(initialValue);
      return;
    }
    if (!pendingLocalEditRef.current && initialValue !== draft) {
      setDraft(initialValue);
    }
  }, [block.id, initialValue, draft]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  function handleDraftChange(next: string) {
    pendingLocalEditRef.current = true;
    setDraft(next);
    if (saveTimerRef.current != null) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      onSaveNotes(next);
      pendingLocalEditRef.current = false;
    }, EDIT_SAVE_DEBOUNCE_MS);
  }

  function handleRevert() {
    if (saveTimerRef.current != null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingLocalEditRef.current = false;
    onSaveNotes(''); // clears the user override, restores auto-generated notes
    setDraft(generatedNotes);
  }

  return (
    <View style={styles.tabContent}>
      <View style={styles.notesCard}>
        <View style={styles.notesHeader}>
          <View style={styles.notesHeaderLeft}>
            <SparkleIcon size={13} color="#6f3bf5" />
            <Text style={styles.notesLabel}>Notes</Text>
            {isUserEdited ? (
              <View style={styles.editedBadge}>
                <Text style={styles.editedBadgeLabel}>Edited</Text>
              </View>
            ) : null}
          </View>
          {isUserEdited ? (
            <Pressable
              onPress={handleRevert}
              style={({pressed}) => [
                styles.notesLinkButton,
                pressed ? styles.buttonPressed : null,
              ]}>
              <Text style={styles.notesLinkButtonLabel}>Revert to auto</Text>
            </Pressable>
          ) : null}
        </View>

        <NotesEditor
          key={block.id}
          value={draft}
          onChange={handleDraftChange}
          placeholder="Write a note, or type '-' for a bullet"
        />
      </View>

      {topics.length > 0 ? (
        <View style={styles.sectionGroup}>
          <Text style={styles.sectionLabel}>Key topics</Text>
          <View style={styles.topicChips}>
            {topics.map(topic => (
              <View key={topic} style={styles.topicChip}>
                <Text style={styles.topicChipLabel} numberOfLines={1}>
                  {displayArtifact(topic)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function deriveGeneratedNotes(block: WorklogCalendarBlock): string {
  if (block.notes != null && block.notes.trim().length > 0) {
    return block.notes.trim();
  }
  // Legacy fallback: synthesize notes from narrative + keyActivities.
  const lines: string[] = [];
  const narrative = block.summary.narrative?.trim();
  if (narrative != null && narrative.length > 0) {
    lines.push(narrative);
  }
  for (const activity of block.keyActivities ?? []) {
    if (activity.trim().length === 0) continue;
    lines.push(`- ${activity.trim()}`);
  }
  return lines.join('\n');
}

function buildTopics(block: WorklogCalendarBlock): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    topics.push(trimmed);
  };
  block.repos.forEach(push);
  block.tickets.forEach(push);
  (block.keyActivities ?? []).forEach(activity => {
    const words = activity.split(/[,.:;]/)[0].trim();
    if (words.length > 0 && words.length < 40) push(words);
  });
  block.documents.forEach(push);
  (block.people ?? []).forEach(push);
  block.apps.forEach(push);
  return topics.slice(0, 8);
}

type HighlightsTabProps = {
  highlights: Highlight[];
};

function HighlightsTab({highlights}: HighlightsTabProps) {
  const withImages = highlights.filter(item => item.imageDataUri != null);
  if (withImages.length === 0) {
    return (
      <View style={styles.emptyTabState}>
        <Text style={styles.emptyTabText}>
          No highlights attached to this task yet.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.tabContent}>
      {withImages.map(item => (
        <View key={item.id} style={styles.highlightRow}>
          <Text style={styles.highlightTime}>{formatClock(item.timestamp)}</Text>
          {item.imageDataUri ? (
            <Image
              source={{uri: item.imageDataUri}}
              style={styles.highlightImage}
              resizeMode="cover"
            />
          ) : null}
          <Text style={styles.highlightSummary} numberOfLines={2}>
            {item.summary}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 340,
    borderLeftWidth: 1,
    borderLeftColor: '#ece7dd',
    backgroundColor: '#faf8f3',
    padding: 22,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateHeading: {
    fontSize: 13,
    color: '#6b6b6b',
    fontWeight: '500',
  },
  closeButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonPressed: {
    backgroundColor: '#ece7dd',
  },
  titleBlock: {
    gap: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.3,
  },
  titleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#6f3bf5',
  },
  timeRange: {
    fontSize: 13,
    color: '#3a3a3a',
  },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#ece7dd',
  },
  tabButton: {
    paddingHorizontal: 2,
    paddingVertical: 8,
    marginRight: 18,
    position: 'relative',
  },
  tabButtonActive: {},
  tabButtonPressed: {
    opacity: 0.8,
  },
  tabLabel: {
    fontSize: 13,
    color: '#8a8478',
    fontWeight: '500',
  },
  tabLabelActive: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  tabUnderline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -1,
    height: 2,
    backgroundColor: '#1a1a1a',
    borderRadius: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 16,
    gap: 16,
  },
  tabContent: {
    gap: 18,
  },
  notesCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ece7dd',
    padding: 14,
    gap: 10,
  },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notesHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  notesLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6f3bf5',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  notesActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  notesLinkButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  notesLinkButtonLabel: {
    fontSize: 12,
    color: '#6b6b6b',
    fontWeight: '500',
  },
  editedBadge: {
    borderRadius: 4,
    backgroundColor: '#f1ece1',
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  editedBadgeLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#8a8478',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionGroup: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b6b6b',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  topicChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  topicChip: {
    backgroundColor: '#e8eef9',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    maxWidth: 200,
  },
  topicChipLabel: {
    fontSize: 11,
    color: '#2a3a5f',
    fontWeight: '500',
  },
  highlightRow: {
    gap: 6,
  },
  highlightTime: {
    fontSize: 11,
    color: '#8a8478',
    fontWeight: '500',
  },
  highlightImage: {
    width: '100%',
    height: 130,
    borderRadius: 8,
    backgroundColor: '#2a2a2a',
  },
  highlightSummary: {
    fontSize: 12,
    color: '#3a3a3a',
    lineHeight: 17,
  },
  emptyShell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  emptyBody: {
    fontSize: 12,
    color: '#6b6b6b',
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyTabState: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyTabText: {
    fontSize: 12,
    color: '#8a8478',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#ece7dd',
  },
  footerSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#e0dccf',
    backgroundColor: '#ffffff',
  },
  footerSecondaryLabel: {
    fontSize: 13,
    color: '#1a1a1a',
    fontWeight: '600',
  },
  footerPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 9,
    backgroundColor: '#1a1a1a',
  },
  footerPrimaryLabel: {
    fontSize: 13,
    color: '#ffffff',
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
