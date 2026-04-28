import {memo, useEffect, useRef} from 'react';

import type {ChatMessage} from '../../../src/chat/runChat';
import {MarkdownText} from '../components/MarkdownText';

const QUICK_PROMPTS = [
  "Give me standup notes for today's work.",
  'Summarize this week by project.',
  'How much time did I spend coding today?',
  'What did I learn from my recent work?',
];

export const ChatScreen = memo(function ChatScreen(props: {
  messages: ChatMessage[];
  loading: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => Promise<void>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [props.messages, props.loading]);

  const isEmpty = props.messages.length === 0 && !props.loading;

  return (
    <div className="chat-shell">
      <div className="chat-messages">
        {isEmpty ? (
          <div className="chat-empty">
            <div className="chat-empty__icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h2>Ask Flow</h2>
            <p>Turn your captured work history into answers.<br/>Ask for standup notes, summaries, or time breakdowns.</p>
          </div>
        ) : (
          props.messages.map(message => (
            <div
              key={message.id}
              className={`chat-bubble chat-bubble--${message.role}`}>
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
        {isEmpty && (
          <div className="quick-actions">
            {QUICK_PROMPTS.map(prompt => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  props.onDraftChange(prompt);
                  textareaRef.current?.focus();
                }}>
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
          }}>
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
            disabled={props.loading || props.draft.trim().length === 0}>
            {props.loading ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  );
});
