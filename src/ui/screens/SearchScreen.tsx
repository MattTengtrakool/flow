import React, {useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, TextInput, View} from 'react-native';
import {Text} from '../Text';

import type {WorklogCalendarBlock} from '../../worklog/types';
import {SearchIcon} from '../icons';

export type SearchScreenProps = {
  allBlocks: WorklogCalendarBlock[];
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string, dateIso: string) => void;
};

function formatAbsolute(block: WorklogCalendarBlock): string {
  const date = new Date(block.startTime);
  return date.toLocaleDateString([], {
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
  return `${start} – ${end}`;
}

function searchScore(block: WorklogCalendarBlock, query: string): number {
  if (query.length === 0) return 0;
  const q = query.toLowerCase();
  let score = 0;
  if (block.title.toLowerCase().includes(q)) score += 10;
  if (block.summary.narrative.toLowerCase().includes(q)) score += 5;
  for (const artifact of block.summary.provenance.keyArtifacts) {
    if (artifact.toLowerCase().includes(q)) score += 4;
  }
  for (const item of block.repos) {
    if (item.toLowerCase().includes(q)) score += 3;
  }
  for (const item of block.tickets) {
    if (item.toLowerCase().includes(q)) score += 3;
  }
  for (const item of block.documents) {
    if (item.toLowerCase().includes(q)) score += 2;
  }
  for (const item of block.apps) {
    if (item.toLowerCase().includes(q)) score += 1;
  }
  for (const activity of block.keyActivities ?? []) {
    if (activity.toLowerCase().includes(q)) score += 2;
  }
  return score;
}

export function SearchScreen(props: SearchScreenProps) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return props.allBlocks.slice().reverse().slice(0, 20);
    }
    return props.allBlocks
      .map(block => ({block, score: searchScore(block, trimmed)}))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(entry => entry.block);
  }, [query, props.allBlocks]);

  const isEmptyQuery = query.trim().length === 0;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.overline}>SEARCH</Text>
        <Text style={styles.heading}>Find anything you worked on</Text>
        <View style={styles.searchFieldRow}>
          <View style={styles.searchIcon}>
            <SearchIcon size={14} color="#8a8478" />
          </View>
          <TextInput
            autoFocus
            placeholder="Search by task, repo, ticket, file, person…"
            placeholderTextColor="#a59e8c"
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
            // macOS: suppress the native blue focus halo around NSTextField.
            // @ts-ignore – `enableFocusRing` is a react-native-macos-only prop.
            enableFocusRing={false}
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              style={({pressed}) => [
                styles.clearButton,
                pressed ? styles.buttonPressed : null,
              ]}>
              <Text style={styles.clearButtonLabel}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.hint}>
          {isEmptyQuery
            ? 'Recent blocks shown below. Start typing to filter.'
            : results.length === 0
              ? 'No blocks match that search.'
              : `${results.length} ${results.length === 1 ? 'match' : 'matches'}`}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {results.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {isEmptyQuery ? 'No tracked work yet' : 'No matches'}
            </Text>
            <Text style={styles.emptyBody}>
              {isEmptyQuery
                ? 'Once Flow writes a few plans, you can search them here.'
                : 'Try a shorter query, a ticket ID, a repo name, or a person.'}
            </Text>
          </View>
        ) : (
          results.map(block => {
            const isSelected = block.id === props.selectedBlockId;
            const dateIso = block.startTime.slice(0, 10);
            return (
              <Pressable
                key={block.id}
                onPress={() => props.onSelectBlock(block.id, dateIso)}
                style={({pressed}) => [
                  styles.resultRow,
                  isSelected ? styles.resultRowSelected : null,
                  pressed ? styles.buttonPressed : null,
                ]}>
                <View style={styles.resultDateColumn}>
                  <Text style={styles.resultDate}>{formatAbsolute(block)}</Text>
                  <Text style={styles.resultTime}>{formatTimeRange(block)}</Text>
                </View>
                <View style={styles.resultBody}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {block.title}
                  </Text>
                  <Text style={styles.resultNarrative} numberOfLines={2}>
                    {block.summary.narrative}
                  </Text>
                  {block.summary.provenance.keyArtifacts.length > 0 ? (
                    <View style={styles.chipRow}>
                      {block.summary.provenance.keyArtifacts
                        .slice(0, 4)
                        .map(artifact => (
                          <View key={artifact} style={styles.chip}>
                            <Text style={styles.chipLabel} numberOfLines={1}>
                              {artifact}
                            </Text>
                          </View>
                        ))}
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 32,
    paddingTop: 24,
    paddingBottom: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ece7dd',
  },
  overline: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8478',
    letterSpacing: 1.4,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.3,
  },
  searchFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#e0dccf',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchIcon: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#1a1a1a',
  },
  clearButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#f1ece1',
  },
  clearButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5a5a5a',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  hint: {
    fontSize: 12,
    color: '#8a8478',
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    gap: 10,
  },
  emptyState: {
    marginTop: 40,
    alignItems: 'center',
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
    maxWidth: 360,
    lineHeight: 18,
  },
  resultRow: {
    flexDirection: 'row',
    gap: 14,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ece7dd',
    backgroundColor: '#ffffff',
  },
  resultRowSelected: {
    borderColor: '#1a1a1a',
  },
  resultDateColumn: {
    width: 90,
    gap: 2,
  },
  resultDate: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  resultTime: {
    fontSize: 11,
    color: '#8a8478',
  },
  resultBody: {
    flex: 1,
    gap: 5,
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  resultNarrative: {
    fontSize: 12,
    lineHeight: 18,
    color: '#3a3a3a',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  chip: {
    backgroundColor: '#f1ece1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    maxWidth: 200,
  },
  chipLabel: {
    fontSize: 11,
    color: '#5a5a5a',
    fontWeight: '500',
  },
});
