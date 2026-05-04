import { memo, useEffect, useRef } from 'react';

import type { ChatMessage } from '../../../src/chat/runChat';
import type { WorklogCalendarBlock } from '../../../src/worklog/types';
import { MarkdownText } from '../components/MarkdownText';

export const ChatScreen = memo(function ChatScreen(props: {
  messages: ChatMessage[];
  loading: boolean;
  draft: string;
  allBlocks: WorklogCalendarBlock[];
  selectedBlock: WorklogCalendarBlock | null;
  selectedDateIso: string;
  onDraftChange: (value: string) => void;
  onSend: () => Promise<void>;
  onSelectCitation: (block: WorklogCalendarBlock) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: props.loading ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [props.messages, props.loading]);

  const isEmpty = props.messages.length === 0 && !props.loading;
  const prompts = quickPrompts(props.selectedDateIso, props.selectedBlock);
  const citedBlocks = collectCitedBlocks(props.messages, props.allBlocks);

  return (
    <div className="chat-shell">
      <div className="chat-messages">
        {isEmpty ? (
          <div className="chat-empty">
            <div className="chat-empty__icon" aria-hidden="true">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h2>Ask Flow</h2>
            <p>
              {props.allBlocks.length === 0
                ? 'Start a session first, then ask about your work history.'
                : 'Search the shape of the day, the week, or a project.'}
            </p>
          </div>
        ) : (
          props.messages.map(message => (
            <div
              key={message.id}
              className={`chat-bubble chat-bubble--${message.role}`}
            >
              <span className="chat-bubble__sender">
                {message.role === 'user' ? 'You' : 'Flow'}
              </span>
              <div className="chat-bubble__body">
                {message.role === 'assistant' ? (
                  <MarkdownText text={message.content} />
                ) : (
                  <p>{message.content}</p>
                )}
              </div>
            </div>
          ))
        )}
        {props.loading ? (
          <div className="chat-bubble chat-bubble--assistant">
            <span className="chat-bubble__sender">Flow</span>
            <div className="chat-bubble__body">
              <div className="chat-thinking">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className="chat-bottom">
        {citedBlocks.length > 0 ? (
          <div className="citation-row" aria-label="Referenced blocks">
            {citedBlocks.map(block => (
              <button
                key={block.id}
                type="button"
                onClick={() => props.onSelectCitation(block)}
              >
                {block.title}
              </button>
            ))}
          </div>
        ) : null}
        {isEmpty && (
          <div className="quick-actions">
            {prompts.map(prompt => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  props.onDraftChange(prompt);
                  textareaRef.current?.focus();
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        <form
          className="chat-form"
          onSubmit={event => {
            event.preventDefault();
            props.onSend().catch(() => {});
          }}
        >
          <textarea
            ref={textareaRef}
            value={props.draft}
            onChange={event => props.onDraftChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                props.onSend().catch(() => {});
              }
            }}
            placeholder="Ask anything about your worklog…"
            rows={1}
          />
          <button
            type="submit"
            disabled={props.loading || props.draft.trim().length === 0}
            aria-label={props.loading ? 'Waiting for response' : 'Send message'}
          >
            {props.loading ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  );
});

function quickPrompts(
  selectedDateIso: string,
  selectedBlock: WorklogCalendarBlock | null,
): string[] {
  const prompts = [
    `Summarize ${selectedDateIso}.`,
    'Give me standup notes for today.',
    'Break down this week by project.',
    'What did I learn from recent work?',
  ];
  if (selectedBlock != null) {
    prompts.unshift(`Tell me more about ${selectedBlock.title}.`);
  }
  return prompts.slice(0, 5);
}

function collectCitedBlocks(
  messages: ChatMessage[],
  allBlocks: WorklogCalendarBlock[],
): WorklogCalendarBlock[] {
  const byId = new Map(allBlocks.map(block => [block.id, block]));
  const found = new Map<string, WorklogCalendarBlock>();
  for (const message of messages) {
    for (const invocation of message.toolInvocations ?? []) {
      collectBlockIds(invocation.result).forEach(id => {
        const block = byId.get(id);
        if (block != null) found.set(id, block);
      });
    }
  }
  return Array.from(found.values()).slice(-6);
}

function collectBlockIds(value: unknown): string[] {
  if (value == null || typeof value !== 'object') return [];
  const result: string[] = [];
  if ('block' in value) {
    const block = (value as { block?: { id?: unknown } }).block;
    if (typeof block?.id === 'string') result.push(block.id);
  }
  if ('blocks' in value) {
    const blocks = (value as { blocks?: Array<{ id?: unknown }> }).blocks;
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (typeof block.id === 'string') result.push(block.id);
      }
    }
  }
  return result;
}
