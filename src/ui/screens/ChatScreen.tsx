import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, TextInput, View} from 'react-native';
import {Text} from '../Text';

import {
  createUserMessage,
  runChatTurn,
  type ChatMessage,
} from '../../chat/runChat';
import type {TimelineView} from '../../timeline/eventLog';
import {SparkleIcon} from '../icons';
import {Markdown} from '../Markdown';

export type ChatScreenProps = {
  timeline: TimelineView;
  timezone: string;
};

const COLUMN_MAX_WIDTH = 760;

const QUICK_ACTIONS: Array<{label: string; prompt: string}> = [
  {
    label: "Today's standup",
    prompt:
      "Give me standup notes for today's work — 4-7 bullets covering what shipped, what's in progress, and any notable conversations.",
  },
  {
    label: 'This week recap',
    prompt:
      'Summarize what I worked on this week. Group by project. Total time per project. Highlight anything that shipped.',
  },
  {
    label: 'Time on a project',
    prompt: 'How much time did I spend on ',
  },
  {
    label: 'What did I learn about…',
    prompt: 'What did I learn about ',
  },
];

const EMPTY_EXAMPLES: string[] = [
  'What did I work on yesterday?',
  'How much time on Hestia this week?',
  'Give me standup notes for today.',
  'What did I learn about POS-2212 last month?',
];

export function ChatScreen({timeline, timezone}: ChatScreenProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // The composer is intentionally an *uncontrolled* TextInput. On
  // react-native-macos, passing `value={draft}` round-trips every keystroke
  // through a native setTextAndSelection command, which in this RN version can
  // drop first-responder status on whitespace keys (the "space kicks me out"
  // bug). We instead mirror the text into a ref + a lightweight boolean state
  // (for the Send button's enabled-ness), and bump `composerKey` to force a
  // remount when we need to programmatically set or clear the text.
  const draftRef = useRef('');
  const [hasContent, setHasContent] = useState(false);
  const [composerKey, setComposerKey] = useState(0);

  const scrollRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({animated: true});
    });
  }, [messages, isLoading]);

  const syncDraft = useCallback((text: string) => {
    draftRef.current = text;
    const next = text.trim().length > 0;
    setHasContent(prev => (prev === next ? prev : next));
  }, []);

  const resetComposer = useCallback((seed: string = '') => {
    draftRef.current = seed;
    setHasContent(seed.trim().length > 0);
    setComposerKey(k => k + 1);
  }, []);

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (trimmed.length === 0 || isLoading) return;

      const userMessage = createUserMessage(trimmed);
      const conversationBeforeTurn = messages;
      setMessages(prev => [...prev, userMessage]);
      resetComposer('');
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const {assistantMessage} = await runChatTurn({
          conversation: conversationBeforeTurn,
          userMessage: trimmed,
          timeline,
          timezone,
        });
        setMessages(prev => [...prev, assistantMessage]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Chat request failed.';
        setErrorMessage(message);
      } finally {
        setIsLoading(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [isLoading, messages, resetComposer, timeline, timezone],
  );

  function handleQuickAction(prompt: string) {
    if (prompt.endsWith(' ')) {
      resetComposer(prompt);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    send(prompt).catch(() => {});
  }

  function handleSubmit() {
    send(draftRef.current).catch(() => {});
  }

  function handleClear() {
    setMessages([]);
    setErrorMessage(null);
    resetComposer('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const hasMessages = messages.length > 0;

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <View style={styles.topBarColumn}>
          <Text style={styles.topBarTitle}>Chat</Text>
          {hasMessages ? (
            <Pressable
              onPress={handleClear}
              style={({pressed}) => [
                styles.topBarAction,
                pressed ? styles.pressed : null,
              ]}>
              <Text style={styles.topBarActionLabel}>New chat</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {!hasMessages ? (
          <View style={styles.welcomeWrap}>
            <View style={styles.welcomeColumn}>
              <View style={styles.welcomeBadge}>
                <SparkleIcon size={16} color="#6f3bf5" />
              </View>
              <Text style={styles.welcomeHeading}>
                Ask anything about your work
              </Text>
              <Text style={styles.welcomeSubheading}>
                I have access to your blocks, time, notes, and screen
                observations. I cite real PRs, tickets, and files.
              </Text>
              <View style={styles.quickActionsRow}>
                {QUICK_ACTIONS.map(action => (
                  <Pressable
                    key={action.label}
                    onPress={() => handleQuickAction(action.prompt)}
                    disabled={isLoading}
                    style={({pressed}) => [
                      styles.quickActionChip,
                      isLoading ? styles.disabled : null,
                      pressed && !isLoading ? styles.pressed : null,
                    ]}>
                    <Text style={styles.quickActionLabel}>{action.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.examplesDivider} />
              <Text style={styles.examplesHeading}>Or try an example</Text>
              <View style={styles.examplesList}>
                {EMPTY_EXAMPLES.map(example => (
                  <Pressable
                    key={example}
                    onPress={() => {
                      send(example).catch(() => {});
                    }}
                    disabled={isLoading}
                    style={({pressed}) => [
                      styles.exampleCard,
                      pressed ? styles.pressed : null,
                    ]}>
                    <Text style={styles.exampleText}>{example}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.turnsColumn}>
            {messages.map(message => (
              <Turn key={message.id} message={message} />
            ))}
            {isLoading ? <ThinkingTurn /> : null}
            {errorMessage != null ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>Something went wrong</Text>
                <Text style={styles.errorBody} selectable>
                  {errorMessage}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <View style={styles.composerWrap}>
        <View style={styles.composerColumn}>
          <View
            style={[
              styles.composer,
              hasContent ? styles.composerActive : null,
            ]}>
            <TextInput
              // Bumping composerKey remounts the TextInput with a new
              // `defaultValue`. This is how we programmatically clear it on
              // send or pre-fill it from a quick-action chip, without ever
              // writing the text back through a controlled `value` prop.
              key={composerKey}
              ref={inputRef}
              defaultValue={draftRef.current}
              onChangeText={syncDraft}
              onSubmitEditing={handleSubmit}
              placeholder="Message your work history…"
              placeholderTextColor="#a59e8c"
              multiline
              // Keep the input editable during loading so focus never gets
              // stripped by AppKit turning the NSTextView non-editable.
              style={styles.composerInput}
              // Keep focus on submit — user should be able to keep typing.
              blurOnSubmit={false}
              // Explicitly scope submission to Enter only. Without this,
              // react-native-macos's multiline TextInput can route other
              // keystrokes through the submit path and blur the input.
              // @ts-ignore – macOS-only prop (`SubmitKeyEvent[]`).
              submitKeyEvents={[{key: 'Enter'}]}
              // Silence every word-boundary text service that AppKit runs on
              // space (autocorrect, smart-insert/delete, spell/grammar check,
              // auto-cap) — any one of them can steal first-responder status.
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              // @ts-ignore – macOS-only prop.
              grammarCheck={false}
              // @ts-ignore – macOS-only prop.
              smartInsertDelete={false}
              // Suppress the native blue focus halo.
              // @ts-ignore – macOS-only prop.
              enableFocusRing={false}
            />
            <Pressable
              onPress={handleSubmit}
              disabled={isLoading || !hasContent}
              style={({pressed}) => [
                styles.sendButton,
                isLoading || !hasContent ? styles.sendButtonDisabled : null,
                pressed && !isLoading ? styles.pressed : null,
              ]}>
              <Text selectable={false} style={styles.sendButtonGlyph}>
                {isLoading ? '…' : '↑'}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.composerHint}>
            Enter to send · Shift+Enter for a new line
          </Text>
        </View>
      </View>
    </View>
  );
}

function Turn({message}: {message: ChatMessage}) {
  if (message.role === 'user') {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{message.content}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantAvatar}>
        <SparkleIcon size={13} color="#6f3bf5" />
      </View>
      <View style={styles.assistantBody}>
        <Markdown source={message.content} emptyPlaceholder="(no response)" />
        {message.toolInvocations != null &&
        message.toolInvocations.length > 0 ? (
          <View style={styles.toolStripRow}>
            {message.toolInvocations.map((invocation, index) => (
              <View key={`${invocation.name}-${index}`} style={styles.toolChip}>
                <Text style={styles.toolChipLabel}>{invocation.name}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ThinkingTurn() {
  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantAvatar}>
        <SparkleIcon size={13} color="#6f3bf5" />
      </View>
      <View style={styles.assistantBody}>
        <View style={styles.thinkingRow}>
          <View style={[styles.thinkingDot, styles.thinkingDot1]} />
          <View style={[styles.thinkingDot, styles.thinkingDot2]} />
          <View style={[styles.thinkingDot, styles.thinkingDot3]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  topBar: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#ece7dd',
    alignItems: 'center',
  },
  topBarColumn: {
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  topBarAction: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0dccf',
    backgroundColor: '#ffffff',
  },
  topBarActionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  transcript: {
    flex: 1,
  },
  transcriptContent: {
    alignItems: 'center',
    paddingBottom: 40,
  },
  turnsColumn: {
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 20,
  },

  /* ---------- User turn ---------- */
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  userBubble: {
    maxWidth: '85%',
    backgroundColor: '#f1ece1',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: {
    fontSize: 15,
    color: '#1a1a1a',
    lineHeight: 22,
  },

  /* ---------- Assistant turn ---------- */
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  assistantAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f5f0ff',
    borderWidth: 1,
    borderColor: '#e0d5ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  assistantBody: {
    flex: 1,
    gap: 12,
    paddingTop: 2,
  },
  toolStripRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  toolChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#f4f4f4',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  toolChipLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#6b6b6b',
    fontFamily: 'Menlo',
  },

  /* ---------- Thinking indicator ---------- */
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
  },
  thinkingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#c0b9a5',
  },
  thinkingDot1: {
    opacity: 0.4,
  },
  thinkingDot2: {
    opacity: 0.65,
  },
  thinkingDot3: {
    opacity: 0.9,
  },

  /* ---------- Welcome / empty state ---------- */
  welcomeWrap: {
    width: '100%',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  welcomeColumn: {
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
  },
  welcomeBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f5f0ff',
    borderWidth: 1,
    borderColor: '#e0d5ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  welcomeHeading: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  welcomeSubheading: {
    fontSize: 14,
    color: '#6b6b6b',
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 480,
  },
  quickActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 18,
  },
  quickActionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    backgroundColor: '#ffffff',
  },
  quickActionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  examplesDivider: {
    width: 40,
    height: 1,
    backgroundColor: '#ece7dd',
    marginVertical: 22,
  },
  examplesHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8a8478',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  examplesList: {
    width: '100%',
    maxWidth: 520,
    gap: 6,
  },
  exampleCard: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ece7dd',
    backgroundColor: '#ffffff',
  },
  exampleText: {
    fontSize: 13,
    color: '#3a3a3a',
  },

  /* ---------- Composer ---------- */
  composerWrap: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 16,
    paddingHorizontal: 0,
    backgroundColor: '#ffffff',
  },
  composerColumn: {
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    paddingHorizontal: 20,
    gap: 6,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#e0dccf',
    backgroundColor: '#ffffff',
    minHeight: 52,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 2},
  },
  composerActive: {
    borderColor: '#c9b59b',
  },
  composerInput: {
    flex: 1,
    minHeight: 36,
    maxHeight: 160,
    fontSize: 15,
    color: '#1a1a1a',
    lineHeight: 21,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#d9d4c7',
  },
  sendButtonGlyph: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    lineHeight: 20,
  },
  composerHint: {
    fontSize: 11,
    color: '#a59e8c',
    textAlign: 'center',
  },

  /* ---------- Error ---------- */
  errorCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e89c9c',
    backgroundColor: '#fff0f0',
    gap: 4,
  },
  errorTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b1a1a',
  },
  errorBody: {
    fontSize: 12,
    color: '#6b1a1a',
    lineHeight: 17,
  },

  /* ---------- Utility ---------- */
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.85,
  },
});
