import React, {useMemo} from 'react';
import {StyleSheet, View, type TextStyle} from 'react-native';
import {Text} from './Text';

/**
 * A small, purpose-built markdown renderer for block notes.
 *
 * Supports only what our prompt asks the model to produce:
 *   - Bullet lists with "-" or "*"
 *   - Nested bullets via leading 2-space indentation
 *   - **bold**, *italic*, `code`
 *   - Blank lines = paragraph break
 *   - Lines without bullets = plain text
 *
 * Nothing else: no headings, no tables, no images, no numbered lists. The
 * prompt is explicit about this so the LLM stays within the supported subset.
 */

type MarkdownProps = {
  source: string;
  emptyPlaceholder?: string;
};

export function Markdown(props: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(props.source), [props.source]);

  if (blocks.length === 0) {
    return props.emptyPlaceholder != null ? (
      <Text style={styles.empty}>{props.emptyPlaceholder}</Text>
    ) : null;
  }

  return (
    <View style={styles.container}>
      {blocks.map((block, index) => {
        if (block.kind === 'bullet') {
          return (
            <View
              key={index}
              style={[
                styles.bulletRow,
                block.indent > 0 ? {marginLeft: 16 * block.indent} : null,
              ]}>
              <Text style={styles.bulletMarker}>{block.indent > 0 ? '◦' : '•'}</Text>
              <View style={styles.bulletBody}>
                <InlineText spans={block.spans} />
              </View>
            </View>
          );
        }
        if (block.kind === 'paragraph') {
          return (
            <View key={index} style={styles.paragraph}>
              <InlineText spans={block.spans} />
            </View>
          );
        }
        return <View key={index} style={styles.spacer} />;
      })}
    </View>
  );
}

type InlineSpan = {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
};

type ParsedBlock =
  | {kind: 'bullet'; indent: number; spans: InlineSpan[]}
  | {kind: 'paragraph'; spans: InlineSpan[]}
  | {kind: 'spacer'};

function InlineText({spans}: {spans: InlineSpan[]}) {
  return (
    <Text style={styles.bodyText}>
      {spans.map((span, index) => (
        <Text
          key={index}
          style={spansToStyle(span) as TextStyle}>
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

function spansToStyle(span: InlineSpan): TextStyle {
  const combined: TextStyle = {};
  if (span.bold) combined.fontWeight = '700';
  if (span.italic) combined.fontStyle = 'italic';
  if (span.code) {
    combined.fontFamily = 'Menlo';
    combined.backgroundColor = '#f1ece1';
    combined.fontSize = 12;
  }
  return combined;
}

function parseMarkdown(source: string): ParsedBlock[] {
  if (source == null) return [];
  const lines = source.split(/\r?\n/);
  const blocks: ParsedBlock[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, '');
    if (line.length === 0) {
      if (blocks.length > 0 && blocks[blocks.length - 1].kind !== 'spacer') {
        blocks.push({kind: 'spacer'});
      }
      continue;
    }

    const bulletMatch = /^(\s*)[-*•]\s+(.+)$/.exec(line);
    if (bulletMatch != null) {
      const leading = bulletMatch[1] ?? '';
      const indent = Math.min(3, Math.floor(leading.replace(/\t/g, '  ').length / 2));
      blocks.push({
        kind: 'bullet',
        indent,
        spans: parseInline(bulletMatch[2]),
      });
      continue;
    }

    blocks.push({
      kind: 'paragraph',
      spans: parseInline(line.trim()),
    });
  }

  // Collapse leading/trailing spacers.
  while (blocks.length > 0 && blocks[0].kind === 'spacer') blocks.shift();
  while (blocks.length > 0 && blocks[blocks.length - 1].kind === 'spacer') blocks.pop();
  return blocks;
}

function parseInline(source: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const next = findNextDelimiter(source, cursor);
    if (next == null) {
      spans.push({text: source.slice(cursor), bold: false, italic: false, code: false});
      break;
    }
    if (next.start > cursor) {
      spans.push({
        text: source.slice(cursor, next.start),
        bold: false,
        italic: false,
        code: false,
      });
    }
    spans.push({
      text: next.inner,
      bold: next.kind === 'bold',
      italic: next.kind === 'italic',
      code: next.kind === 'code',
    });
    cursor = next.end;
  }
  return spans.length > 0
    ? spans
    : [{text: source, bold: false, italic: false, code: false}];
}

type Delimited = {
  kind: 'bold' | 'italic' | 'code';
  start: number;
  end: number;
  inner: string;
};

function findNextDelimiter(source: string, from: number): Delimited | null {
  // Scan in parallel for the next bold **..**, italic *..* / _.._, or code `..`.
  const patterns: Array<{kind: Delimited['kind']; open: string; close: string}> = [
    {kind: 'code', open: '`', close: '`'},
    {kind: 'bold', open: '**', close: '**'},
    {kind: 'italic', open: '*', close: '*'},
    {kind: 'italic', open: '_', close: '_'},
  ];
  let best: Delimited | null = null;
  for (const pattern of patterns) {
    const openIdx = source.indexOf(pattern.open, from);
    if (openIdx === -1) continue;
    // Avoid matching bold ** as italic *.
    if (
      pattern.open === '*' &&
      source.slice(openIdx, openIdx + 2) === '**'
    ) {
      continue;
    }
    const innerStart = openIdx + pattern.open.length;
    const closeIdx = source.indexOf(pattern.close, innerStart);
    if (closeIdx === -1) continue;
    // Italic needs non-empty, non-whitespace content.
    if (pattern.kind === 'italic' && closeIdx === innerStart) continue;
    const candidate: Delimited = {
      kind: pattern.kind,
      start: openIdx,
      end: closeIdx + pattern.close.length,
      inner: source.slice(innerStart, closeIdx),
    };
    if (best == null || candidate.start < best.start) {
      best = candidate;
    }
  }
  return best;
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 2,
  },
  bulletMarker: {
    width: 10,
    fontSize: 14,
    lineHeight: 20,
    color: '#6f3bf5',
    textAlign: 'center',
  },
  bulletBody: {
    flex: 1,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#1a1a1a',
  },
  paragraph: {
    paddingVertical: 2,
  },
  spacer: {
    height: 4,
  },
  empty: {
    fontSize: 13,
    color: '#8a8478',
    fontStyle: 'italic',
  },
});
