import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export const NotesEditor = memo(function NotesEditor({
  value,
  onChange,
  placeholder = 'Add notes…',
}: Props) {
  const [focusedLine, setFocusedLine] = useState<number | null>(null);
  const inputRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const lines = value === '' ? [''] : value.split('\n');

  useEffect(() => {
    if (focusedLine == null) return;
    const el = inputRefs.current[focusedLine];
    if (el) {
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
      autoResize(el);
    }
  }, [focusedLine]);

  const updateLine = useCallback(
    (index: number, text: string) => {
      const current = value === '' ? [''] : value.split('\n');
      const next = [...current];
      next[index] = text;
      onChange(next.join('\n'));
    },
    [value, onChange],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const current = value === '' ? [''] : value.split('\n');

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const next = [...current];
        next.splice(index + 1, 0, '');
        onChange(next.join('\n'));
        setFocusedLine(index + 1);
      } else if (
        e.key === 'Backspace' &&
        current[index] === '' &&
        current.length > 1
      ) {
        e.preventDefault();
        const next = [...current];
        next.splice(index, 1);
        onChange(next.join('\n'));
        setFocusedLine(Math.max(0, index - 1));
      } else if (e.key === 'ArrowUp' && index > 0) {
        const el = inputRefs.current[index];
        if (el && el.selectionStart === 0) {
          e.preventDefault();
          setFocusedLine(index - 1);
        }
      } else if (e.key === 'ArrowDown' && index < current.length - 1) {
        const el = inputRefs.current[index];
        if (el && el.selectionStart === el.value.length) {
          e.preventDefault();
          setFocusedLine(index + 1);
        }
      }
    },
    [value, onChange],
  );

  return (
    <div
      className="notion-editor"
      onClick={() => {
        if (focusedLine == null) setFocusedLine(lines.length - 1);
      }}
    >
      {lines.map((line, index) =>
        focusedLine === index ? (
          <div key={index} className="notion-block">
            <textarea
              ref={el => {
                inputRefs.current[index] = el;
              }}
              className="notion-block__input"
              value={line}
              rows={1}
              onChange={e => {
                updateLine(index, e.target.value);
                autoResize(e.target);
              }}
              onKeyDown={e => handleKeyDown(index, e)}
              onBlur={() => setFocusedLine(null)}
            />
          </div>
        ) : (
          <div
            key={index}
            className="notion-block"
            onClick={e => {
              e.stopPropagation();
              setFocusedLine(index);
            }}
          >
            <div className="notion-block__render">
              {line === '' ? (
                index === 0 && lines.length === 1 ? (
                  <span className="notion-placeholder">{placeholder}</span>
                ) : (
                  <span className="notion-empty-line">&nbsp;</span>
                )
              ) : (
                <RenderedLine text={line} />
              )}
            </div>
          </div>
        ),
      )}
    </div>
  );
});

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function RenderedLine({ text }: { text: string }) {
  const trimmed = text.trim();
  if (trimmed.startsWith('# ')) {
    return <p className="notion-h1">{trimmed.slice(2)}</p>;
  }
  if (trimmed.startsWith('## ')) {
    return <p className="notion-h2">{trimmed.slice(3)}</p>;
  }
  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    return (
      <div className="notion-bullet">
        <span className="notion-bullet-dot">•</span>
        <span>{parseInline(trimmed.slice(2))}</span>
      </div>
    );
  }
  if (trimmed.startsWith('> ')) {
    return <p className="notion-blockquote">{trimmed.slice(2)}</p>;
  }
  return <p className="notion-paragraph">{parseInline(text)}</p>;
}

function parseInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      parts.push(
        <code key={key++} className="notion-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : parts;
}
