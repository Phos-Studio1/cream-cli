import { describe, expect, it } from 'vitest';
import { htmlToPlain, tablesToCodeBlocks, toTelegramHtml } from '../src/lib/remote/format.js';

const allowed = new Set(['b', 'i', 's', 'u', 'code', 'pre', 'a', 'blockquote']);

function validate(html: string): string {
  const stack: string[] = [];
  for (const match of html.matchAll(/<(\/?)([a-z]+)([^>]*)>/g)) {
    const [, closing, tag] = match;
    if (!allowed.has(tag!)) return `disallowed <${tag}>`;
    if (!closing) stack.push(tag!);
    else if (stack.pop() !== tag) return `mis-nested </${tag}>`;
  }
  return stack.length ? `unclosed ${stack.join(',')}` : 'valid';
}

describe('toTelegramHtml', () => {
  const sample = [
    '## Summary',
    'This is **bold**, *italic*, ~~old~~ and `npm run build`. file_name_ok and 2*3*4 stay intact.',
    '',
    '1. First',
    '   - nested `<App />`',
    '- bullet',
    '',
    '> quoted',
    '',
    '```ts',
    'const x = a < b && c > d;',
    '/*test*/',
    '```',
    '',
    '| Name | Status |',
    '|------|--------|',
    '| build | ✅ |',
    '',
    'See [docs](https://example.com/?a=1&b=2).',
  ].join('\n');

  it('produces valid, symbol-free Telegram HTML', () => {
    const [html] = toTelegramHtml(sample);
    expect(validate(html!)).toBe('valid');
    expect(html).toContain('<b>✦ Summary</b>');
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('<i>italic</i>');
    expect(html).toContain('<code>npm run build</code>');
    expect(html).toContain('file_name_ok and 2*3*4');
    expect(html).toContain('<code>&lt;App /&gt;</code>');
    expect(html).toContain('<blockquote>quoted</blockquote>');
    expect(html).toContain('<pre><code class="language-ts">const x = a &lt; b &amp;&amp; c &gt; d;\n/*test*/</code></pre>');
    expect(html).toContain('<a href="https://example.com/?a=1&amp;b=2">docs</a>');
    expect(html!.replace(/<pre>[\s\S]*?<\/pre>|<code[^>]*>[\s\S]*?<\/code>/g, '')).not.toMatch(/\*\*|~~|^#+ /m);
  });

  it('splits long messages into valid chunks under the limit', () => {
    const long = Array.from({ length: 300 }, (_, i) => `- item **${i}** with enough text to fill the message`).join('\n');
    const chunks = toTelegramHtml(`${long}\n\n\`\`\`py\n${'print(1)\n'.repeat(600)}\`\`\``);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(3800);
      expect(validate(chunk)).toBe('valid');
    }
  });

  it('strips tags for the plain-text fallback', () => {
    expect(htmlToPlain('<b>Hi</b> &lt;x&gt; <code>a &amp; b</code>')).toBe('Hi <x> a & b');
  });
});

describe('tablesToCodeBlocks', () => {
  it('converts tables outside code fences only', () => {
    const out = tablesToCodeBlocks('| A | B |\n|---|---|\n| 1 | 2 |\n\n```\n| x | y |\n|---|---|\n```');
    expect(out.startsWith('```\nA │ B\n──┼──\n1 │ 2\n```')).toBe(true);
    expect(out).toContain('```\n| x | y |\n|---|---|\n```');
  });
});
