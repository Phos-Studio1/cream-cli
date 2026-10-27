import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../lib/theme.js';

type Block =
  | { type: 'code'; lang: string; lines: string[] }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; marker: string; indent: number; text: string }
  | { type: 'quote'; text: string }
  | { type: 'rule' }
  | { type: 'blank' }
  | { type: 'text'; text: string };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  let code: Extract<Block, { type: 'code' }> | null = null;

  for (const line of source.replace(/\r/g, '').split('\n')) {
    const fence = line.match(/^\s*```\s*([\w+#.-]*)/);
    if (fence) {
      if (code) {
        blocks.push(code);
        code = null;
      } else {
        code = { type: 'code', lang: fence[1] ?? '', lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const list = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);

    if (heading) blocks.push({ type: 'heading', level: heading[1]!.length, text: heading[2]! });
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) blocks.push({ type: 'rule' });
    else if (list) {
      const marker = /\d/.test(list[2]!) ? list[2]! : '•';
      blocks.push({ type: 'list', marker, indent: Math.floor(list[1]!.length / 2), text: list[3]! });
    } else if (quote) blocks.push({ type: 'quote', text: quote[1]! });
    else if (!line.trim()) {
      if (blocks.at(-1)?.type !== 'blank') blocks.push({ type: 'blank' });
    } else blocks.push({ type: 'text', text: line });
  }

  if (code) blocks.push(code);
  while (blocks.at(-1)?.type === 'blank') blocks.pop();
  return blocks;
}

function Inline({ text, color }: { text: string; color?: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]+\))/g);
  return (
    <Text color={color}>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith('**') && part.endsWith('**'))
          return <Text key={i} bold color={theme.cream}>{part.slice(2, -2)}</Text>;
        if (part.startsWith('`') && part.endsWith('`'))
          return <Text key={i} color={theme.caramel} backgroundColor="#3A302A">{` ${part.slice(1, -1)} `}</Text>;
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
          return <Text key={i} italic>{part.slice(1, -1)}</Text>;
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link)
          return (
            <Text key={i}>
              <Text color={theme.mint} underline>{link[1]}</Text>
              <Text color={theme.muted}>{` (${link[2]})`}</Text>
            </Text>
          );
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

function CodeBlock({ lang, lines }: { lang: string; lines: string[] }) {
  return (
    <Box flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={theme.cocoa} paddingX={1}>
      {lang ? <Text color={theme.caramel} bold>{lang}</Text> : null}
      {lines.map((line, i) => (
        <Text key={i} color={theme.code}>{line || ' '}</Text>
      ))}
    </Box>
  );
}

export function Markdown({ source }: { source: string }) {
  const blocks = parse(source);
  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'code':
            return <CodeBlock key={i} lang={block.lang} lines={block.lines} />;
          case 'heading':
            return (
              <Text key={i} bold color={block.level <= 2 ? theme.strawberry : theme.caramel}>
                {block.level <= 2 ? '▌ ' : ''}
                {block.text}
              </Text>
            );
          case 'list':
            return (
              <Box key={i} paddingLeft={block.indent * 2}>
                <Text color={theme.caramel}>{`${block.marker} `}</Text>
                <Inline text={block.text} />
              </Box>
            );
          case 'quote':
            return (
              <Box key={i}>
                <Text color={theme.cocoa}>│ </Text>
                <Inline text={block.text} color={theme.muted} />
              </Box>
            );
          case 'rule':
            return <Text key={i} color={theme.cocoa}>{'─'.repeat(24)}</Text>;
          case 'blank':
            return <Text key={i}> </Text>;
          default:
            return <Inline key={i} text={block.text} />;
        }
      })}
    </Box>
  );
}
