import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, usePaste } from 'ink';
import type { ImageInput } from '../lib/attachments.js';
import { readClipboard } from '../lib/clipboard.js';
import { commands, matchCommands, type Command } from '../lib/commands.js';
import { theme } from '../lib/theme.js';

export type Attachment = ImageInput;

type Props = {
  history: string[];
  extraCommands?: Command[];
  disabled: boolean;
  onSubmit: (text: string, attachments: Attachment[]) => void;
};

const maxVisibleLines = 8;

const clean = (text: string) =>
  text
    .replace(/﻿/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');

const prevBoundary = (text: string, index: number) => {
  if (index <= 0) return 0;
  const code = text.charCodeAt(index - 1);
  return code >= 0xdc00 && code <= 0xdfff && index > 1 ? index - 2 : index - 1;
};

const nextBoundary = (text: string, index: number) => {
  if (index >= text.length) return text.length;
  const code = text.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff ? index + 2 : index + 1;
};

const wordLeft = (text: string, index: number) => {
  let i = index;
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
  return i;
};

const wordRight = (text: string, index: number) => {
  let i = index;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  while (i < text.length && !/\s/.test(text[i]!)) i++;
  return i;
};

export function InputBar({ history, extraCommands = [], disabled, onSubmit }: Props) {
  const [, rerender] = useState(0);
  const buffer = useRef({ value: '', cursor: 0 });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const statusTimer = useRef<NodeJS.Timeout | undefined>(undefined);

  const { value, cursor } = buffer.current;
  const suggestions = (disabled ? [] : matchCommands(value, extraCommands)).slice(0, 8);
  const exact = [...commands, ...extraCommands].some((c) => c.name === value.trim());

  useEffect(() => () => clearTimeout(statusTimer.current), []);

  const flash = (text: string | null, ms = 2500) => {
    clearTimeout(statusTimer.current);
    setStatus(text);
    if (text) statusTimer.current = setTimeout(() => setStatus(null), ms);
  };

  const set = (next: string, nextCursor = next.length) => {
    buffer.current = { value: next, cursor: Math.max(0, Math.min(nextCursor, next.length)) };
    setSelected(0);
    rerender((n) => n + 1);
  };

  const move = (nextCursor: number) => {
    buffer.current = { ...buffer.current, cursor: Math.max(0, Math.min(nextCursor, buffer.current.value.length)) };
    rerender((n) => n + 1);
  };

  const insert = (text: string) => {
    const piece = clean(text);
    if (!piece) return;
    const { value: v, cursor: c } = buffer.current;
    set(v.slice(0, c) + piece + v.slice(c), c + piece.length);
  };

  const pasteFromClipboard = () => {
    flash('reading clipboard…', 10000);
    readClipboard()
      .then((content) => {
        if (content.type === 'image') {
          setAttachments((prev) => [...prev, content]);
          flash(null);
        } else if (content.type === 'text') {
          insert(content.text);
          flash(null);
        } else flash('Clipboard is empty');
      })
      .catch(() => flash('Could not read the clipboard'));
  };

  const submit = () => {
    const { value: v } = buffer.current;
    const picked = suggestions.length && !exact ? suggestions[selected]?.name : undefined;
    const final = (picked ?? v).trim();
    if (!final && !attachments.length) return;
    onSubmit(final, attachments);
    setAttachments([]);
    setHistoryIndex(-1);
    set('');
  };

  usePaste(
    (text) => {
      if (text) insert(text);
      else pasteFromClipboard();
    },
    { isActive: !disabled },
  );

  useInput(
    (input, key) => {
      const { value: v, cursor: c } = buffer.current;

      if (key.pageUp || key.pageDown || key.escape) return;
      if ((key.ctrl || key.meta) && input.toLowerCase() === 'v') return pasteFromClipboard();

      if (key.return) {
        if (key.shift || key.meta) return insert('\n');
        return submit();
      }

      if (key.tab) {
        if (!suggestions.length) return;
        const command = suggestions[selected] ?? suggestions[0]!;
        return set(command.args ? `${command.name} ` : command.name);
      }

      if (key.upArrow || key.downArrow) {
        if (key.ctrl) return;
        if (suggestions.length && !exact) {
          const step = key.upArrow ? -1 : 1;
          return setSelected((s) => (s + step + suggestions.length) % suggestions.length);
        }
        if (v.includes('\n')) {
          const lineStart = v.lastIndexOf('\n', c - 1) + 1;
          const column = c - lineStart;
          if (key.upArrow && lineStart > 0) {
            const prevStart = v.lastIndexOf('\n', lineStart - 2) + 1;
            return move(Math.min(prevStart + column, lineStart - 1));
          }
          const lineEnd = v.indexOf('\n', c);
          if (key.downArrow && lineEnd !== -1) {
            const nextEnd = v.indexOf('\n', lineEnd + 1);
            return move(Math.min(lineEnd + 1 + column, nextEnd === -1 ? v.length : nextEnd));
          }
          return;
        }
        if (key.upArrow && history.length) {
          const next = Math.min(history.length - 1, historyIndex + 1);
          setHistoryIndex(next);
          return set(history[history.length - 1 - next]!);
        }
        if (key.downArrow && historyIndex >= 0) {
          const next = historyIndex - 1;
          setHistoryIndex(next);
          return set(next < 0 ? '' : history[history.length - 1 - next]!);
        }
        return;
      }

      if (key.leftArrow) return move(key.ctrl || key.meta ? wordLeft(v, c) : prevBoundary(v, c));
      if (key.rightArrow) return move(key.ctrl || key.meta ? wordRight(v, c) : nextBoundary(v, c));
      if (key.home || (key.ctrl && input === 'a')) return move(v.lastIndexOf('\n', c - 1) + 1);
      if (key.end || (key.ctrl && input === 'e')) {
        const end = v.indexOf('\n', c);
        return move(end === -1 ? v.length : end);
      }

      if (key.backspace) {
        if (!v && attachments.length) return setAttachments((prev) => prev.slice(0, -1));
        if (c === 0) return;
        const start = key.ctrl || key.meta ? wordLeft(v, c) : prevBoundary(v, c);
        return set(v.slice(0, start) + v.slice(c), start);
      }
      if (key.delete) {
        if (c >= v.length) return;
        return set(v.slice(0, c) + v.slice(nextBoundary(v, c)), c);
      }
      if (key.ctrl && input === 'w') {
        const start = wordLeft(v, c);
        return set(v.slice(0, start) + v.slice(c), start);
      }
      if (key.ctrl && input === 'u') return set(v.slice(c), 0);
      if (key.ctrl || key.meta) return;

      if (input) insert(input);
    },
    { isActive: !disabled },
  );

  const renderLines = () => {
    if (!value) {
      const placeholder = disabled
        ? 'Cream is answering… press esc to stop'
        : 'Ask Cream anything';
      return disabled ? (
        <Text color={theme.cocoa}>{placeholder}</Text>
      ) : (
        <Text>
          <Text inverse> </Text>
          <Text color={theme.muted}>{placeholder}</Text>
        </Text>
      );
    }

    const lines = value.split('\n');
    const before = value.slice(0, cursor);
    const cursorLine = before.split('\n').length - 1;
    const cursorCol = before.length - (before.lastIndexOf('\n') + 1);
    const first = Math.max(0, Math.min(cursorLine - Math.floor(maxVisibleLines / 2), lines.length - maxVisibleLines));
    const visible = lines.slice(first, first + maxVisibleLines);

    return (
      <Box flexDirection="column">
        {first > 0 ? <Text color={theme.muted}>… {first} more lines above</Text> : null}
        {visible.map((line, i) => {
          const index = first + i;
          if (index !== cursorLine || disabled) return <Text key={index} color={theme.vanilla}>{line || ' '}</Text>;
          const at = nextBoundary(line, cursorCol);
          return (
            <Text key={index} color={theme.vanilla}>
              {line.slice(0, cursorCol)}
              <Text inverse>{line.slice(cursorCol, at) || ' '}</Text>
              {line.slice(at)}
            </Text>
          );
        })}
        {first + maxVisibleLines < lines.length ? (
          <Text color={theme.muted}>… {lines.length - first - maxVisibleLines} more lines below</Text>
        ) : null}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
        {attachments.length ? (
          <Box gap={1} flexWrap="wrap">
            {attachments.map((a, i) => (
              <Text key={i} color={theme.caramel} backgroundColor="#3A302A">
                {` 🖼 Image ${i + 1}${a.width ? ` ${a.width}×${a.height}` : ''} `}
              </Text>
            ))}
            <Text color={theme.muted}>backspace on an empty input removes it</Text>
          </Box>
        ) : null}
        <Box>
          <Text color={disabled ? theme.cocoa : theme.strawberry} bold>
            {'❯ '}
          </Text>
          <Box flexGrow={1}>{renderLines()}</Box>
        </Box>
      </Box>
      {status ? <Text color={theme.muted}>{`  ${status}`}</Text> : null}
      {suggestions.length && !exact ? (
        <Box flexDirection="column" paddingX={2}>
          {suggestions.map((c, i) => (
            <Text key={c.name} color={i === selected ? theme.cream : theme.muted} bold={i === selected} wrap="truncate-end">
              <Text color={theme.strawberry}>{i === selected ? '› ' : '  '}</Text>
              <Text color={i === selected ? theme.caramel : theme.muted}>{c.name}</Text>
              {c.args ? <Text color={theme.cocoa}> {c.args}</Text> : null}
              <Text color={theme.muted}>  {c.description}</Text>
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
