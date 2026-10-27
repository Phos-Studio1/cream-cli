import stringWidth from 'string-width';

type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; items: { indent: number; marker: string; text: string }[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'rule' }
  | { kind: 'para'; lines: string[] };

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const unescape = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const tableLine = /^\s*\|.*\|\s*$/;
const tableSeparator = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const listItem = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;

function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', lines: para });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(/^\s*```\s*([\w+#.-]*)\s*$/);
    if (fence) {
      flush();
      const body: string[] = [];
      while (++i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i]!);
      blocks.push({ kind: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }
    if (tableLine.test(line) && tableSeparator.test(lines[i + 1] ?? '')) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && tableLine.test(lines[i]!); i++) {
        if (tableSeparator.test(lines[i]!)) continue;
        rows.push(lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
      }
      i--;
      blocks.push({ kind: 'table', rows });
      continue;
    }
    const item = line.match(listItem);
    if (item) {
      flush();
      const last = blocks.at(-1);
      const entry = { indent: Math.floor(item[1]!.replace(/\t/g, '  ').length / 2), marker: item[2]!, text: item[3]! };
      if (last?.kind === 'list') last.items.push(entry);
      else blocks.push({ kind: 'list', items: [entry] });
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flush();
      const last = blocks.at(-1);
      if (last?.kind === 'quote') last.lines.push(quote[1]!);
      else blocks.push({ kind: 'quote', lines: [quote[1]!] });
      continue;
    }
    const last = blocks.at(-1);
    if (!para.length && last?.kind === 'list' && /^\s{2,}\S/.test(line)) {
      last.items.at(-1)!.text += ` ${line.trim()}`;
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

function inline(text: string): string {
  return text
    .split(/(`[^`\n]+`)/g)
    .map((part) => {
      if (/^`[^`\n]+`$/.test(part)) return `<code>${escape(part.slice(1, -1))}</code>`;
      return escape(part)
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => `<a href="${url.replace(/"/g, '&quot;')}">${label}</a>`)
        .replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, '<b>$1</b>')
        .replace(/(?<![\w])__(?=\S)([\s\S]+?)(?<=\S)__(?![\w])/g, '<b>$1</b>')
        .replace(/~~(?=\S)([\s\S]+?)(?<=\S)~~/g, '<s>$1</s>')
        .replace(/(?<![\w*/])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*/])/g, '<i>$1</i>')
        .replace(/(?<![\w])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w])/g, '<i>$1</i>');
    })
    .join('');
}

const plainCell = (text: string) => unescape(inline(text).replace(/<[^>]+>/g, ''));

function fit(cell: string, width: number): string {
  let text = cell;
  if (stringWidth(text) > width) {
    while (text && stringWidth(`${text}…`) > width) text = Array.from(text).slice(0, -1).join('');
    text = `${text}…`;
  }
  return text + ' '.repeat(Math.max(0, width - stringWidth(text)));
}

function renderTable(rows: string[][]): string {
  const cells = rows.map((row) => row.map(plainCell));
  const columns = Math.max(...cells.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, c) => Math.min(24, Math.max(...cells.map((row) => stringWidth(row[c] ?? '')))));
  const line = (row: string[]) =>
    widths
      .map((width, c) => fit(row[c] ?? '', width))
      .join(' │ ')
      .trimEnd();
  const [head, ...body] = cells;
  const separator = widths.map((w) => '─'.repeat(w)).join('─┼─');
  return [line(head ?? []), separator, ...body.map(line)].join('\n');
}

function pre(text: string, lang: string, limit: number): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && escape(`${current}\n${line}`).length > limit - 64) {
      pieces.push(current);
      current = line;
    } else current = current ? `${current}\n${line}` : line;
  }
  pieces.push(current);
  return pieces.map((piece) => (lang ? `<pre><code class="language-${escape(lang)}">${escape(piece)}</code></pre>` : `<pre>${escape(piece)}</pre>`));
}

function units(block: Block, limit: number): string[] {
  switch (block.kind) {
    case 'code':
      return pre(block.text || ' ', block.lang, limit);
    case 'heading':
      return [block.level <= 2 ? `<b>✦ ${inline(block.text)}</b>` : `<b>${inline(block.text)}</b>`];
    case 'list': {
      let counter = 0;
      return block.items.map((item) => {
        const numbered = /\d/.test(item.marker);
        counter = numbered ? counter + 1 : counter;
        const bullet = numbered ? `${item.marker.replace(')', '.')}` : item.indent ? '◦' : '•';
        return `${'    '.repeat(item.indent)}${bullet} ${inline(item.text)}`;
      });
    }
    case 'quote':
      return [`<blockquote>${block.lines.map(inline).join('\n')}</blockquote>`];
    case 'table':
      return pre(renderTable(block.rows), '', limit);
    case 'rule':
      return ['──────────────'];
    default:
      return block.lines.map(inline);
  }
}

export function toTelegramHtml(markdown: string, limit = 3800): string[] {
  const chunks: string[] = [];
  let current = '';
  const add = (unit: string, separator: string) => {
    if (current && current.length + separator.length + unit.length > limit) {
      chunks.push(current);
      current = unit;
    } else current = current ? `${current}${separator}${unit}` : unit;
  };
  for (const block of parse(markdown)) units(block, limit).forEach((unit, index) => add(unit, index === 0 ? '\n\n' : '\n'));
  if (current) chunks.push(current);
  return chunks.length ? chunks : ['(empty)'];
}

export function tablesToCodeBlocks(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && tableLine.test(line) && tableSeparator.test(lines[i + 1] ?? '')) {
      const rows: string[][] = [];
      for (; i < lines.length && tableLine.test(lines[i]!); i++) {
        if (tableSeparator.test(lines[i]!)) continue;
        rows.push(lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
      }
      i--;
      out.push('```', renderTable(rows), '```');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

export function htmlToPlain(html: string): string {
  return unescape(html.replace(/<\/?(b|i|s|u|code|pre|a|blockquote)(\s[^>]*)?>/g, ''));
}
