import React, {useEffect, useRef, useState} from 'react';
import {
  type NativeSyntheticEvent,
  StyleSheet,
  TextInput,
  type TextInputKeyPressEventData,
  View,
} from 'react-native';
import {Text} from './Text';

/**
 * Notion-style block editor for free-form notes.
 *
 * - Each block of the underlying markdown is rendered as its own editable
 *   `TextInput`, so editing one block never blows away another.
 * - Each block is `multiline`, so long paragraphs wrap naturally instead of
 *   truncating. We intercept the `Enter` key on macOS via `submitKeyEvents`
 *   so Enter still splits blocks — Shift+Enter inserts a soft break.
 * - Typing `- ` / `* ` promotes a paragraph to a bullet; `# ` / `## ` / `### `
 *   promote to H1/H2/H3.
 * - On an empty bullet or heading, `Enter` demotes back to a paragraph —
 *   matches Notion's exit-style gesture.
 * - `Backspace` on an empty block demotes (heading/bullet -> paragraph, or
 *   outdents a nested bullet), and if already a plain paragraph deletes the
 *   block and focuses the previous one.
 * - Tab / Shift+Tab indent and outdent bullets.
 *
 * The editor is the source of truth for `blocks`. We emit a serialized
 * markdown string upward via `onChange` whenever the structure changes. The
 * parent's `value` prop is treated as authoritative only when it diverges
 * from what we last emitted (e.g. a "revert to auto" press, or a regen from
 * the LLM while the user hasn't edited).
 */

type BlockKind = 'paragraph' | 'bullet' | 'h1' | 'h2' | 'h3';

type Block = {
  id: string;
  kind: BlockKind;
  indent: number;
  text: string;
};

type NotesEditorProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
};

let _blockIdCounter = 0;
function makeId(): string {
  _blockIdCounter += 1;
  return `b${Date.now().toString(36)}_${_blockIdCounter}`;
}

const MAX_INDENT = 3;
const INDENT_PX = 18;

export function NotesEditor({value, onChange, placeholder}: NotesEditorProps) {
  const [blocks, setBlocks] = useState<Block[]>(() => {
    const parsed = parseNotes(value);
    return parsed.length > 0 ? parsed : [emptyParagraph()];
  });

  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const inputRefs = useRef<Map<string, TextInput | null>>(new Map());
  const focusTargetRef = useRef<{
    id: string;
    selection?: {start: number; end: number};
  } | null>(null);
  const lastEmittedRef = useRef(serialize(blocks));

  // Reset editor only when the parent's value diverges from what we last
  // emitted. During normal typing the parent's `value` is in lock-step with
  // our serialized state, so this effect is a no-op.
  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    const parsed = parseNotes(value);
    const next = parsed.length > 0 ? parsed : [emptyParagraph()];
    setBlocks(next);
    lastEmittedRef.current = serialize(next);
  }, [value]);

  // After structural changes (insert / delete) request focus on the target
  // block once React has remounted the input.
  useEffect(() => {
    const target = focusTargetRef.current;
    if (target == null) return;
    const ref = inputRefs.current.get(target.id);
    if (ref == null) return;
    focusTargetRef.current = null;
    requestAnimationFrame(() => {
      ref.focus();
      if (target.selection != null) {
        ref.setNativeProps({selection: target.selection});
      }
    });
  }, [blocks]);

  function commit(next: Block[]) {
    setBlocks(next);
    const text = serialize(next);
    lastEmittedRef.current = text;
    onChange(text);
  }

  function setRef(id: string) {
    return (ref: TextInput | null) => {
      if (ref == null) inputRefs.current.delete(id);
      else inputRefs.current.set(id, ref);
    };
  }

  function handleChangeText(blockId: string, text: string) {
    const current = blocksRef.current;
    const idx = current.findIndex(b => b.id === blockId);
    if (idx === -1) return;
    const block = current[idx];

    // Markdown shortcut: promote paragraph based on leading marker.
    if (block.kind === 'paragraph') {
      const promoted = detectParagraphPromotion(text);
      if (promoted != null) {
        const next = current.slice();
        next[idx] = {...block, kind: promoted.kind, text: promoted.text};
        commit(next);
        return;
      }
    }

    const next = current.slice();
    next[idx] = {...block, text};
    commit(next);
  }

  function handleSubmitEditing(blockId: string) {
    const current = blocksRef.current;
    const idx = current.findIndex(b => b.id === blockId);
    if (idx === -1) return;
    const block = current[idx];

    // Enter on an empty bullet exits the list (outdent or demote to
    // paragraph) rather than inserting another empty bullet.
    if (block.kind === 'bullet' && block.text.trim().length === 0) {
      const next = current.slice();
      if (block.indent > 0) {
        next[idx] = {...block, indent: block.indent - 1};
      } else {
        next[idx] = {...block, kind: 'paragraph', indent: 0};
      }
      commit(next);
      focusTargetRef.current = {id: blockId};
      return;
    }

    // Enter on a heading always creates a plain paragraph below, matching
    // Notion. If the heading is empty, demote it to a paragraph in place.
    if (isHeading(block.kind)) {
      if (block.text.trim().length === 0) {
        const next = current.slice();
        next[idx] = {...block, kind: 'paragraph'};
        commit(next);
        focusTargetRef.current = {id: blockId};
        return;
      }
      const newBlock: Block = emptyParagraph();
      const next = current.slice();
      next.splice(idx + 1, 0, newBlock);
      commit(next);
      focusTargetRef.current = {id: newBlock.id};
      return;
    }

    const newBlock: Block = {
      id: makeId(),
      kind: block.kind,
      indent: block.indent,
      text: '',
    };
    const next = current.slice();
    next.splice(idx + 1, 0, newBlock);
    commit(next);
    focusTargetRef.current = {id: newBlock.id};
  }

  function handleKeyPress(
    blockId: string,
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) {
    const key = e.nativeEvent.key;
    const current = blocksRef.current;
    const idx = current.findIndex(b => b.id === blockId);
    if (idx === -1) return;
    const block = current[idx];

    if (key === 'Backspace') {
      if (block.text.length !== 0) return;
      // Demote heading / bullet before removing the row.
      if (isHeading(block.kind)) {
        const next = current.slice();
        next[idx] = {...block, kind: 'paragraph'};
        commit(next);
        focusTargetRef.current = {id: blockId};
        return;
      }
      if (block.kind === 'bullet') {
        const next = current.slice();
        if (block.indent > 0) {
          next[idx] = {...block, indent: block.indent - 1};
        } else {
          next[idx] = {...block, kind: 'paragraph', indent: 0};
        }
        commit(next);
        focusTargetRef.current = {id: blockId};
        return;
      }
      // Empty paragraph: delete and focus previous. Always keep at least one.
      if (idx === 0) return;
      const prev = current[idx - 1];
      const next = current.slice();
      next.splice(idx, 1);
      commit(next);
      focusTargetRef.current = {
        id: prev.id,
        selection: {start: prev.text.length, end: prev.text.length},
      };
      return;
    }

    // Tab / Shift+Tab: indent / outdent bullets. macOS RN delivers Tab as a
    // key press; we silently ignore Tab on non-bullets so focus traversal
    // still works in the rest of the UI.
    if (key === 'Tab') {
      if (block.kind !== 'bullet') return;
      const shift = (e.nativeEvent as {shiftKey?: boolean}).shiftKey === true;
      const dir = shift ? -1 : 1;
      const newIndent = Math.max(0, Math.min(MAX_INDENT, block.indent + dir));
      if (newIndent === block.indent) return;
      const next = current.slice();
      next[idx] = {...block, indent: newIndent};
      commit(next);
      focusTargetRef.current = {id: blockId};
      return;
    }
  }

  return (
    <View style={styles.container}>
      {blocks.map(block => (
        <BlockRow
          key={block.id}
          block={block}
          inputRef={setRef(block.id)}
          isFirst={blocks[0]?.id === block.id}
          placeholder={placeholder}
          onChangeText={text => handleChangeText(block.id, text)}
          onSubmitEditing={() => handleSubmitEditing(block.id)}
          onKeyPress={e => handleKeyPress(block.id, e)}
        />
      ))}
    </View>
  );
}

type BlockRowProps = {
  block: Block;
  inputRef: (ref: TextInput | null) => void;
  isFirst: boolean;
  placeholder?: string;
  onChangeText: (text: string) => void;
  onSubmitEditing: () => void;
  onKeyPress: (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => void;
};

function BlockRow(props: BlockRowProps) {
  const {
    block,
    inputRef,
    isFirst,
    placeholder,
    onChangeText,
    onSubmitEditing,
    onKeyPress,
  } = props;
  const indentPad = block.indent * INDENT_PX;
  const showPlaceholder = isFirst && block.text.length === 0;
  const inputStyle = styleForKind(block.kind);
  const rowStyle = rowStyleForKind(block.kind);

  return (
    <View style={[rowStyle, {paddingLeft: indentPad}]}>
      {block.kind === 'bullet' ? (
        <Text
          style={[
            styles.bulletMarker,
            block.indent > 0 ? styles.bulletMarkerNested : null,
          ]}>
          {block.indent > 0 ? '◦' : '•'}
        </Text>
      ) : (
        <View style={styles.gutter} />
      )}
      <TextInput
        ref={inputRef}
        value={block.text}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        onKeyPress={onKeyPress}
        placeholder={
          showPlaceholder
            ? placeholder ??
              "Write a note · '-' for a bullet · '#' for a heading"
            : placeholderForKind(block.kind)
        }
        placeholderTextColor="#b5ad9a"
        blurOnSubmit={false}
        multiline
        // Let long paragraphs wrap naturally instead of clipping a single
        // line. macOS-only `submitKeyEvents` restricts onSubmitEditing to
        // Enter only — Shift+Enter still inserts a soft break within the
        // block, matching Notion.
        // @ts-ignore – macOS-only prop.
        submitKeyEvents={[{key: 'Enter'}]}
        autoCorrect
        spellCheck
        style={inputStyle}
        // macOS: suppress the native blue focus halo around NSTextView.
        // @ts-ignore – `enableFocusRing` is a react-native-macos-only prop.
        enableFocusRing={false}
      />
    </View>
  );
}

function isHeading(kind: BlockKind): boolean {
  return kind === 'h1' || kind === 'h2' || kind === 'h3';
}

function placeholderForKind(kind: BlockKind): string | undefined {
  switch (kind) {
    case 'h1':
      return 'Heading 1';
    case 'h2':
      return 'Heading 2';
    case 'h3':
      return 'Heading 3';
    case 'bullet':
      return undefined;
    default:
      return undefined;
  }
}

function styleForKind(kind: BlockKind) {
  switch (kind) {
    case 'h1':
      return [styles.input, styles.h1];
    case 'h2':
      return [styles.input, styles.h2];
    case 'h3':
      return [styles.input, styles.h3];
    default:
      return styles.input;
  }
}

function rowStyleForKind(kind: BlockKind) {
  switch (kind) {
    case 'h1':
      return styles.rowH1;
    case 'h2':
      return styles.rowH2;
    case 'h3':
      return styles.rowH3;
    default:
      return styles.row;
  }
}

function detectParagraphPromotion(
  text: string,
): {kind: BlockKind; text: string} | null {
  if (text.startsWith('- ') || text.startsWith('* ')) {
    return {kind: 'bullet', text: text.slice(2)};
  }
  if (text.startsWith('### ')) {
    return {kind: 'h3', text: text.slice(4)};
  }
  if (text.startsWith('## ')) {
    return {kind: 'h2', text: text.slice(3)};
  }
  if (text.startsWith('# ')) {
    return {kind: 'h1', text: text.slice(2)};
  }
  return null;
}

function emptyParagraph(): Block {
  return {id: makeId(), kind: 'paragraph', indent: 0, text: ''};
}

function parseNotes(source: string): Block[] {
  if (source == null || source.length === 0) return [];
  const lines = source.split(/\r?\n/);
  const blocks: Block[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, '');
    const bulletMatch = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    if (bulletMatch != null) {
      const leading = bulletMatch[1] ?? '';
      const indent = Math.min(
        MAX_INDENT,
        Math.floor(leading.replace(/\t/g, '  ').length / 2),
      );
      blocks.push({
        id: makeId(),
        kind: 'bullet',
        indent,
        text: bulletMatch[2] ?? '',
      });
      continue;
    }
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch != null) {
      const level = headingMatch[1].length;
      const kind: BlockKind = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
      blocks.push({
        id: makeId(),
        kind,
        indent: 0,
        text: headingMatch[2] ?? '',
      });
      continue;
    }
    blocks.push({
      id: makeId(),
      kind: 'paragraph',
      indent: 0,
      text: line,
    });
  }
  return blocks;
}

function serialize(blocks: Block[]): string {
  return blocks
    .map(block => {
      if (block.kind === 'bullet') {
        return `${'  '.repeat(block.indent)}- ${block.text}`;
      }
      if (block.kind === 'h1') return `# ${block.text}`;
      if (block.kind === 'h2') return `## ${block.text}`;
      if (block.kind === 'h3') return `### ${block.text}`;
      return block.text;
    })
    .join('\n');
}

const styles = StyleSheet.create({
  container: {
    gap: 1,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 2,
    width: '100%',
  },
  rowH1: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 12,
    paddingBottom: 4,
    width: '100%',
  },
  rowH2: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 10,
    paddingBottom: 3,
    width: '100%',
  },
  rowH3: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 8,
    paddingBottom: 2,
    width: '100%',
  },
  gutter: {
    width: 14,
  },
  bulletMarker: {
    width: 14,
    fontSize: 14,
    lineHeight: 22,
    color: '#6f3bf5',
    textAlign: 'center',
  },
  bulletMarkerNested: {
    color: '#8a8478',
    fontSize: 12,
  },
  input: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
    color: '#1a1a1a',
    paddingVertical: 0,
    paddingHorizontal: 0,
    minHeight: 22,
    // Let the multiline input size vertically to its content and wrap long
    // lines rather than clipping at the row edge.
    textAlignVertical: 'top',
  },
  h1: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.4,
    minHeight: 32,
  },
  h2: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
    minHeight: 26,
  },
  h3: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
    letterSpacing: -0.2,
    minHeight: 23,
  },
});
