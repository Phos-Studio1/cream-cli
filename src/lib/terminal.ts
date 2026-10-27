import { EventEmitter } from 'node:events';
import { useEffect, useRef } from 'react';
import { useStdin, useStdout } from 'ink';
import stringWidth from 'string-width';
import { writeClipboard } from './clipboard.js';

type Point = { row: number; col: number };

const mouseOn = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
const mouseOff = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';
const highlight = '\x1b[48;2;224;164;88m\x1b[38;2;35;24;16m';

const inkInstances: WeakMap<object, { lastOutput?: string }> = (
  await import(new URL('./instances.js', import.meta.resolve('ink')).href)
).default;

export const renders = new EventEmitter();

export function disableMouse(): void {
  process.stdout.write(mouseOff);
}

const stripAnsi = (text: string) =>
  text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;:?<=>]*[ -/]*[@-~]/g, '');

function toCells(line: string): string[] {
  const cells: string[] = [];
  for (const char of Array.from(stripAnsi(line))) {
    const width = stringWidth(char);
    if (width === 0 && cells.length) cells[cells.length - 1] += char;
    else {
      cells.push(char);
      if (width === 2) cells.push('');
    }
  }
  return cells;
}

const before = (a: Point, b: Point) => a.row < b.row || (a.row === b.row && a.col <= b.col);

export function useMouse(
  options: { onWheel: (delta: number) => void; onCopied: (chars: number) => void },
  enabled: boolean,
): { clear: () => void } {
  const { stdin } = useStdin();
  const { stdout } = useStdout();
  const handlers = useRef(options);
  handlers.current = options;
  const state = useRef({ anchor: null as Point | null, focus: null as Point | null, dragging: false, moved: false, painted: new Set<number>() });

  const frame = () => (inkInstances.get(stdout)?.lastOutput ?? '').split('\n');

  const ranges = () => {
    const { anchor, focus } = state.current;
    if (!anchor || !focus) return [];
    const [start, end] = before(anchor, focus) ? [anchor, focus] : [focus, anchor];
    const lines = frame();
    const result: { row: number; from: number; to: number; cells: string[] }[] = [];
    for (let row = start.row; row <= end.row; row++) {
      const cells = toCells(lines[row - 1] ?? '');
      let from = row === start.row ? start.col : 1;
      const to = Math.min(row === end.row ? end.col : cells.length, cells.length);
      if (cells[from - 1] === '' && from > 1) from--;
      if (to >= from) result.push({ row, from, to, cells });
    }
    return result;
  };

  const restore = (rows: Iterable<number>) => {
    const lines = frame();
    let out = '';
    for (const row of rows) out += `\x1b[${row};1H\x1b[0m${lines[row - 1] ?? ''}\x1b[0m\x1b[K`;
    if (out) stdout.write(`\x1b7${out}\x1b8`);
  };

  const paint = () => {
    const next = ranges();
    const rows = new Set(next.map((r) => r.row));
    restore([...state.current.painted].filter((row) => !rows.has(row)));
    let out = '';
    for (const { row, from, to, cells } of next) out += `\x1b[${row};${from}H${highlight}${cells.slice(from - 1, to).join('')}\x1b[0m`;
    if (out) stdout.write(`\x1b7${out}\x1b8`);
    state.current.painted = rows;
  };

  const clear = () => {
    const s = state.current;
    if (!s.anchor && !s.painted.size) return;
    restore(s.painted);
    state.current = { anchor: null, focus: null, dragging: false, moved: false, painted: new Set() };
  };

  const copy = () => {
    const text = ranges()
      .map(({ from, to, cells }) => cells.slice(from - 1, to).join('').replace(/\s+$/, ''))
      .join('\n')
      .trim();
    if (!text) return clear();
    void writeClipboard(text).then((ok) => ok && handlers.current.onCopied(text.length));
  };

  useEffect(() => {
    if (!enabled) return;
    stdout.write(mouseOn);

    const onData = (data: Buffer | string) => {
      for (const match of data.toString().matchAll(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g)) {
        const code = Number(match[1]);
        const point = { col: Number(match[2]), row: Number(match[3]) };
        const released = match[4] === 'm';
        const s = state.current;

        if (code & 64) {
          clear();
          handlers.current.onWheel((code & 3) === 0 ? -3 : 3);
        } else if ((code & 3) !== 0) {
          continue;
        } else if (released) {
          if (!s.dragging) continue;
          s.dragging = false;
          if (s.moved) {
            s.focus = point;
            paint();
            copy();
          } else clear();
        } else if (code & 32) {
          if (!s.dragging) continue;
          s.focus = point;
          s.moved = true;
          paint();
        } else {
          clear();
          state.current = { anchor: point, focus: point, dragging: true, moved: false, painted: new Set() };
        }
      }
    };

    const onRender = () => {
      if (state.current.painted.size) paint();
    };

    stdin.on('data', onData);
    renders.on('render', onRender);
    return () => {
      stdin.off('data', onData);
      renders.off('render', onRender);
      stdout.write(mouseOff);
    };
  }, [enabled, stdin, stdout]);

  return { clear };
}
